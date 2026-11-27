import {
    querySqlite,
    type SqliteQueryExecutor,
    type SqliteQueryResult,
    type SqliteQueryValue
} from "../query";
import type { packagingLevel } from "../../packaging/packagingHierarchy";
import type { productStructure, variant } from "../../products/productStructure";

const PRODUCT_CATALOG_QUERY = `
    SELECT
        p.product_id AS product_id,
        p.name AS product_name,
        p.description AS product_description,
        p.generic_name AS product_generic_name,
        p.manufacturer AS product_manufacturer,
        p.category AS product_category,
        v.variant_id AS variant_id,
        v.variant_name AS variant_name,
        v.nafdac_registration_number AS nafdac_registration_number,
        threshold.quantity AS low_stock_threshold_quantity,
        threshold.packaging_level_id AS low_stock_threshold_packaging_level_id,
        level.packaging_level_id AS level_id,
        level.name AS level_name,
        level.cost_price_minor_units AS cost_price_minor_units,
        level.selling_price_minor_units AS selling_price_minor_units,
        level.quantity_of_next_level AS quantity_of_next_level,
        level.next_level_id AS next_level_id
    FROM products AS p
    LEFT JOIN variants AS v
        ON v.product_id = p.product_id
    LEFT JOIN variant_low_stock_thresholds AS threshold
        ON threshold.product_id = v.product_id
        AND threshold.variant_id = v.variant_id
    LEFT JOIN packaging_levels AS level
        ON level.product_id = v.product_id
        AND level.variant_id = v.variant_id
    ORDER BY p.product_position, v.variant_position, level.packaging_position
`;

type ProductRow = ReadonlyMap<string, SqliteQueryValue>;

function toProductRows(result: SqliteQueryResult): ProductRow[] {
    return result.rows.map((values) => {
        if (values.length !== result.columns.length) {
            throw new Error("SQLite Product query returned an invalid row shape.");
        }

        const row = new Map<string, SqliteQueryValue>();
        result.columns.forEach((column, index) => {
            if (row.has(column)) {
                throw new Error("SQLite Product query returned duplicate columns.");
            }
            row.set(column, values[index]);
        });
        return row;
    });
}

function requiredValue(row: ProductRow, column: string): SqliteQueryValue {
    const value = row.get(column);
    if (value === undefined) {
        throw new Error(`SQLite Product query is missing the ${column} column.`);
    }
    return value;
}

function requiredText(row: ProductRow, column: string): string {
    const value = requiredValue(row, column);
    if (typeof value !== "string") {
        throw new Error(`SQLite Product query returned an invalid ${column}.`);
    }
    return value;
}

function nullableText(row: ProductRow, column: string): string | null {
    const value = requiredValue(row, column);
    if (value === null) {
        return null;
    }
    if (typeof value !== "string") {
        throw new Error(`SQLite Product query returned an invalid ${column}.`);
    }
    return value;
}

function nullableSafeInteger(row: ProductRow, column: string): number | null {
    const value = requiredValue(row, column);
    if (value === null) {
        return null;
    }
    if (typeof value !== "number" || !Number.isSafeInteger(value)) {
        throw new Error(`SQLite Product query returned an invalid ${column}.`);
    }
    return value;
}

function priceFromMinorUnits(
    row: ProductRow,
    column: string
): number | null {
    const minorUnits = nullableSafeInteger(row, column);
    if (minorUnits === null) {
        return null;
    }
    if (minorUnits < 0) {
        throw new Error(`SQLite Product query returned an invalid ${column}.`);
    }

    const price = minorUnits / 100;
    if (Math.round(price * 100) !== minorUnits) {
        throw new Error(
            `SQLite Product query returned a ${column} value that cannot be represented in the Product domain.`
        );
    }
    return price;
}

function optionalProductText(
    row: ProductRow,
    column: string
): string | undefined {
    return nullableText(row, column) ?? undefined;
}

export async function getAllProducts(
    query: SqliteQueryExecutor = querySqlite
): Promise<productStructure[]> {
    const result = await query(PRODUCT_CATALOG_QUERY);
    const products = new Map<string, productStructure>();
    const variantsByProduct = new Map<string, Map<string, variant>>();

    for (const row of toProductRows(result)) {
        const productId = requiredText(row, "product_id");
        let product = products.get(productId);
        if (!product) {
            product = {
                id: productId,
                name: requiredText(row, "product_name"),
                variant: []
            };
            const description = optionalProductText(row, "product_description");
            const genericName = optionalProductText(row, "product_generic_name");
            const manufacturer = optionalProductText(row, "product_manufacturer");
            const category = optionalProductText(row, "product_category");
            if (description !== undefined) {
                product.description = description;
            }
            if (genericName !== undefined) {
                product.genericName = genericName;
            }
            if (manufacturer !== undefined) {
                product.manufacturer = manufacturer;
            }
            if (category !== undefined) {
                product.category = category;
            }
            products.set(productId, product);
            variantsByProduct.set(productId, new Map());
        }

        const variantId = nullableText(row, "variant_id");
        if (variantId === null) {
            continue;
        }

        const productVariants = variantsByProduct.get(productId);
        if (!productVariants) {
            throw new Error("SQLite Product query returned an invalid variant group.");
        }
        let productVariant = productVariants.get(variantId);
        if (!productVariant) {
            productVariant = {
                id: variantId,
                variantName: requiredText(row, "variant_name"),
                packagingHierarchy: []
            };
            const nafdacRegistrationNumber = nullableText(
                row,
                "nafdac_registration_number"
            );
            if (nafdacRegistrationNumber !== null) {
                productVariant.nafdacRegistrationNumber =
                    nafdacRegistrationNumber;
            }

            const thresholdQuantity = nullableSafeInteger(
                row,
                "low_stock_threshold_quantity"
            );
            const thresholdPackagingLevelId = nullableText(
                row,
                "low_stock_threshold_packaging_level_id"
            );
            if (thresholdQuantity !== null) {
                productVariant.lowStockThreshold = {
                    quantity: thresholdQuantity,
                    ...(thresholdPackagingLevelId === null
                        ? {}
                        : { packagingLevelId: thresholdPackagingLevelId })
                };
            } else if (thresholdPackagingLevelId !== null) {
                throw new Error(
                    "SQLite Product query returned an incomplete low-stock threshold."
                );
            }

            productVariants.set(variantId, productVariant);
            product.variant.push(productVariant);
        }

        const packagingLevelId = nullableText(row, "level_id");
        if (packagingLevelId === null) {
            continue;
        }

        const packaging: packagingLevel = {
            id: packagingLevelId,
            name: requiredText(row, "level_name"),
            costPrice: priceFromMinorUnits(row, "cost_price_minor_units"),
            sellingPrice: priceFromMinorUnits(row, "selling_price_minor_units"),
            quantityofNextLevel: nullableSafeInteger(
                row,
                "quantity_of_next_level"
            ),
            nextLevelId: nullableText(row, "next_level_id")
        };
        productVariant.packagingHierarchy.push(packaging);
    }

    return [...products.values()];
}
