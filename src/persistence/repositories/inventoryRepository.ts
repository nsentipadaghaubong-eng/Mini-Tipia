import {
    querySqlite,
    type SqliteQueryExecutor,
    type SqliteQueryResult,
    type SqliteQueryValue
} from "../query";
import type { inventory } from "../../inventory/inventoryStock";
import type { inventoryBatch } from "../../inventory/inventoryBatch";

const INVENTORY_QUERY = `
    SELECT
        'inventory' AS row_type,
        product.product_position AS product_position,
        variant.variant_position AS variant_position,
        record.inventory_position AS record_position,
        stock.stock_position AS stock_position,
        NULL AS batch_position,
        NULL AS pricing_position,
        record.inventory_id AS inventory_id,
        record.product_id AS product_id,
        record.variant_id AS variant_id,
        record.batch_id AS inventory_batch_id,
        stock.packaging_level_id AS stock_packaging_level_id,
        stock.quantity AS stock_quantity,
        stock.product_id AS stock_product_id,
        stock.variant_id AS stock_variant_id,
        stock_level.product_id AS stock_level_product_id,
        stock_level.variant_id AS stock_level_variant_id,
        NULL AS batch_id,
        NULL AS batch_number,
        NULL AS expiry_date,
        NULL AS received_date,
        NULL AS pricing_packaging_level_id,
        NULL AS cost_price_minor_units,
        NULL AS selling_price_minor_units,
        NULL AS pricing_product_id,
        NULL AS pricing_variant_id,
        NULL AS pricing_level_product_id,
        NULL AS pricing_level_variant_id
    FROM inventory_records AS record
    LEFT JOIN products AS product
        ON product.product_id = record.product_id
    LEFT JOIN variants AS variant
        ON variant.product_id = record.product_id
        AND variant.variant_id = record.variant_id
    LEFT JOIN inventory_stock AS stock
        ON stock.inventory_id = record.inventory_id
    LEFT JOIN packaging_levels AS stock_level
        ON stock_level.packaging_level_id = stock.packaging_level_id

    UNION ALL

    SELECT
        'batch' AS row_type,
        product.product_position AS product_position,
        variant.variant_position AS variant_position,
        NULL AS record_position,
        NULL AS stock_position,
        batch.batch_position AS batch_position,
        pricing.pricing_position AS pricing_position,
        NULL AS inventory_id,
        batch.product_id AS product_id,
        batch.variant_id AS variant_id,
        NULL AS inventory_batch_id,
        NULL AS stock_packaging_level_id,
        NULL AS stock_quantity,
        NULL AS stock_product_id,
        NULL AS stock_variant_id,
        NULL AS stock_level_product_id,
        NULL AS stock_level_variant_id,
        batch.batch_id AS batch_id,
        batch.batch_number AS batch_number,
        batch.expiry_date AS expiry_date,
        batch.received_date AS received_date,
        pricing.packaging_level_id AS pricing_packaging_level_id,
        pricing.cost_price_minor_units AS cost_price_minor_units,
        pricing.selling_price_minor_units AS selling_price_minor_units,
        pricing.product_id AS pricing_product_id,
        pricing.variant_id AS pricing_variant_id,
        pricing_level.product_id AS pricing_level_product_id,
        pricing_level.variant_id AS pricing_level_variant_id
    FROM batches AS batch
    LEFT JOIN products AS product
        ON product.product_id = batch.product_id
    LEFT JOIN variants AS variant
        ON variant.product_id = batch.product_id
        AND variant.variant_id = batch.variant_id
    LEFT JOIN batch_pricing AS pricing
        ON pricing.batch_id = batch.batch_id
    LEFT JOIN packaging_levels AS pricing_level
        ON pricing_level.packaging_level_id = pricing.packaging_level_id
    ORDER BY
        product_position,
        variant_position,
        row_type,
        record_position,
        stock_position,
        batch_position,
        pricing_position
`;

type InventoryRow = ReadonlyMap<string, SqliteQueryValue>;

export interface InventoryRepositoryData {
    inventoryRecords: inventory[];
    inventoryBatches: inventoryBatch[];
}

function toInventoryRows(result: SqliteQueryResult): InventoryRow[] {
    return result.rows.map((values) => {
        if (values.length !== result.columns.length) {
            throw new Error("SQLite Inventory query returned an invalid row shape.");
        }

        const row = new Map<string, SqliteQueryValue>();
        result.columns.forEach((column, index) => {
            if (row.has(column)) {
                throw new Error("SQLite Inventory query returned duplicate columns.");
            }
            row.set(column, values[index]);
        });
        return row;
    });
}

function requiredValue(row: InventoryRow, column: string): SqliteQueryValue {
    const value = row.get(column);
    if (value === undefined) {
        throw new Error(`SQLite Inventory query is missing the ${column} column.`);
    }
    return value;
}

function requiredText(row: InventoryRow, column: string): string {
    const value = requiredValue(row, column);
    if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`SQLite Inventory query returned an invalid ${column}.`);
    }
    return value;
}

function nullableText(row: InventoryRow, column: string): string | null {
    const value = requiredValue(row, column);
    if (value === null) {
        return null;
    }
    if (typeof value !== "string") {
        throw new Error(`SQLite Inventory query returned an invalid ${column}.`);
    }
    return value;
}

function nullableSafeInteger(row: InventoryRow, column: string): number | null {
    const value = requiredValue(row, column);
    if (value === null) {
        return null;
    }
    if (typeof value !== "number" || !Number.isSafeInteger(value)) {
        throw new Error(`SQLite Inventory query returned an invalid ${column}.`);
    }
    return value;
}

function requiredPosition(row: InventoryRow, column: string): number {
    const value = nullableSafeInteger(row, column);
    if (value === null || value < 0) {
        throw new Error(`SQLite Inventory query returned an invalid ${column}.`);
    }
    return value;
}

function priceFromMinorUnits(row: InventoryRow, column: string): number | null {
    const minorUnits = nullableSafeInteger(row, column);
    if (minorUnits === null) {
        return null;
    }
    if (minorUnits < 0) {
        throw new Error(`SQLite Inventory query returned an invalid ${column}.`);
    }

    const price = minorUnits / 100;
    if (Math.round(price * 100) !== minorUnits) {
        throw new Error(
            `SQLite Inventory query returned a ${column} value that cannot be represented in the Inventory domain.`
        );
    }
    return price;
}

function nullableDate(row: InventoryRow, column: string): Date | null {
    const value = nullableText(row, column);
    if (value === null) {
        return null;
    }

    const date = new Date(`${value}T00:00:00.000Z`);
    if (
        !Number.isFinite(date.getTime()) ||
        date.toISOString().slice(0, 10) !== value
    ) {
        throw new Error(`SQLite Inventory query returned an invalid ${column}.`);
    }
    return date;
}

function requireNullColumns(
    row: InventoryRow,
    columns: readonly string[]
): void {
    if (columns.some((column) => requiredValue(row, column) !== null)) {
        throw new Error("SQLite Inventory query returned an incomplete child row.");
    }
}

export async function getAllInventory(
    query: SqliteQueryExecutor = querySqlite
): Promise<InventoryRepositoryData> {
    const result = await query(INVENTORY_QUERY);
    const inventoryRows = toInventoryRows(result);
    const inventoryRecords = new Map<string, inventory>();
    const inventoryBatches = new Map<string, inventoryBatch>();

    for (const row of inventoryRows) {
        const rowType = requiredText(row, "row_type");
        const productId = requiredText(row, "product_id");
        const variantId = requiredText(row, "variant_id");
        requiredPosition(row, "product_position");
        requiredPosition(row, "variant_position");

        if (rowType === "inventory") {
            const inventoryId = requiredText(row, "inventory_id");
            const batchId = nullableText(row, "inventory_batch_id");
            const stockProductId = nullableText(row, "stock_product_id");
            const stockVariantId = nullableText(row, "stock_variant_id");
            const stockLevelProductId = nullableText(
                row,
                "stock_level_product_id"
            );
            const stockLevelVariantId = nullableText(
                row,
                "stock_level_variant_id"
            );

            if (batchId !== null && batchId.trim() === "") {
                throw new Error("SQLite Inventory query returned an invalid batch ID.");
            }

            let record = inventoryRecords.get(inventoryId);
            if (!record) {
                record = {
                    id: inventoryId,
                    productId,
                    variantId,
                    batchId,
                    stockQuantities: []
                };
                inventoryRecords.set(inventoryId, record);
            } else if (
                record.productId !== productId ||
                record.variantId !== variantId ||
                record.batchId !== batchId
            ) {
                throw new Error("SQLite Inventory query returned conflicting inventory records.");
            }

            const packagingLevelId = nullableText(
                row,
                "stock_packaging_level_id"
            );
            const stockPosition = nullableSafeInteger(row, "stock_position");
            const quantity = nullableSafeInteger(row, "stock_quantity");

            if (packagingLevelId === null) {
                requireNullColumns(row, [
                    "stock_position",
                    "stock_quantity",
                    "stock_product_id",
                    "stock_variant_id",
                    "stock_level_product_id",
                    "stock_level_variant_id"
                ]);
                continue;
            }

            if (
                stockPosition === null ||
                stockPosition < 0 ||
                quantity === null ||
                quantity < 0 ||
                stockProductId !== productId ||
                stockVariantId !== variantId ||
                stockLevelProductId !== productId ||
                stockLevelVariantId !== variantId
            ) {
                throw new Error("SQLite Inventory query returned an invalid stock relationship.");
            }
            if (
                record.stockQuantities.some(
                    (stock) => stock.packagingLevelId === packagingLevelId
                )
            ) {
                throw new Error("SQLite Inventory query returned duplicate stock quantities.");
            }

            record.stockQuantities.push({ packagingLevelId, quantity });
            continue;
        }

        if (rowType !== "batch") {
            throw new Error("SQLite Inventory query returned an unknown row type.");
        }

        const batchId = requiredText(row, "batch_id");
        requiredPosition(row, "batch_position");
        const batchNumber = nullableText(row, "batch_number");
        const expiryDate = nullableDate(row, "expiry_date");
        const receivedDate = nullableText(row, "received_date");
        let batch = inventoryBatches.get(batchId);

        if (!batch) {
            batch = {
                batchId,
                productId,
                variantId,
                batchNumber,
                expiryDate,
                pricingByPackagingLevel: [],
                ...(receivedDate === null ? {} : { receivedDate })
            };
            inventoryBatches.set(batchId, batch);
        } else if (
            batch.productId !== productId ||
            batch.variantId !== variantId ||
            batch.batchNumber !== batchNumber ||
            batch.expiryDate?.toISOString() !== expiryDate?.toISOString() ||
            batch.receivedDate !== (receivedDate ?? undefined)
        ) {
            throw new Error("SQLite Inventory query returned conflicting batch records.");
        }

        const pricingPackagingLevelId = nullableText(
            row,
            "pricing_packaging_level_id"
        );
        if (pricingPackagingLevelId === null) {
            requireNullColumns(row, [
                "pricing_position",
                "cost_price_minor_units",
                "selling_price_minor_units",
                "pricing_product_id",
                "pricing_variant_id",
                "pricing_level_product_id",
                "pricing_level_variant_id"
            ]);
            continue;
        }

        const pricingPosition = nullableSafeInteger(row, "pricing_position");
        if (
            pricingPosition === null ||
            pricingPosition < 0 ||
            nullableText(row, "pricing_product_id") !== productId ||
            nullableText(row, "pricing_variant_id") !== variantId ||
            nullableText(row, "pricing_level_product_id") !== productId ||
            nullableText(row, "pricing_level_variant_id") !== variantId
        ) {
            throw new Error("SQLite Inventory query returned an invalid batch pricing relationship.");
        }
        if (
            batch.pricingByPackagingLevel.some(
                (pricing) =>
                    pricing.packagingLevelId === pricingPackagingLevelId
            )
        ) {
            throw new Error("SQLite Inventory query returned duplicate batch pricing.");
        }

        batch.pricingByPackagingLevel.push({
            packagingLevelId: pricingPackagingLevelId,
            costPrice: priceFromMinorUnits(row, "cost_price_minor_units"),
            sellingPrice: priceFromMinorUnits(row, "selling_price_minor_units")
        });
    }

    for (const record of inventoryRecords.values()) {
        if (record.batchId === null) {
            continue;
        }
        const batch = inventoryBatches.get(record.batchId);
        if (
            !batch ||
            batch.productId !== record.productId ||
            batch.variantId !== record.variantId
        ) {
            throw new Error("SQLite Inventory query returned an invalid inventory batch association.");
        }
    }

    return {
        inventoryRecords: [...inventoryRecords.values()],
        inventoryBatches: [...inventoryBatches.values()]
    };
}
