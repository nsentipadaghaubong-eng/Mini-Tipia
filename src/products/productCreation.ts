import type { packagingLevel } from "../packaging/packagingHierarchy";
import type { inventory } from "../inventory/inventoryStock";
import type { inventoryBatch } from "../inventory/inventoryBatch";
import type { productStructure, variant } from "./productStructure";
import { validatePackagingHierarchy } from "../packaging/packagingValidation";

export interface PackagingCreationDraft {
    key: string;
    name: string;
    quantityOfNextLevel: string;
    costPrice: string;
    sellingPrice: string;
}

export interface StockCreationDraft {
    [packagingKey: string]: string;
}
export interface BatchCreationDraft {
    batchNumber: string;
    expiryDate: string;
    stock: StockCreationDraft;
}

export interface VariantCreationDraft {
    key: string;
    name: string;
    nafdacRegistrationNumber: string;
    packaging: PackagingCreationDraft[];
    batches: BatchCreationDraft[];
    unbatchedStock: StockCreationDraft;
}

export interface ProductCreationDraft {
    name: string;
    genericName: string;
    manufacturer: string;
    category: string;
    addVariants: boolean;
    variants: VariantCreationDraft[];
}

export function createEmptyVariantCreationDraft(): VariantCreationDraft {
    return {
        key: crypto.randomUUID(),
        name: "",
        nafdacRegistrationNumber: "",
        packaging: [],
        batches: [],
        unbatchedStock: {}
    };
}

export function addVariantCreationDraft(
    variants: VariantCreationDraft[]
): VariantCreationDraft[] {
    return [...variants, createEmptyVariantCreationDraft()];
}

export function removeVariantCreationDraft(
    variants: VariantCreationDraft[],
    indexToRemove: number
): VariantCreationDraft[] {
    return variants.filter((_, index) => index !== indexToRemove);
}

export type ProductCreationErrors = Record<string, string>;

function parsePrice(value: string): number | null | undefined {
    const trimmed = value.trim();
    if (trimmed === "") {
        return null;
    }

    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseQuantity(value: string): number | undefined {
    if (value.trim() === "") {
        return 0;
    }

    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function validDate(value: string): Date | undefined {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return undefined;
    }

    const date = new Date(`${value}T00:00:00.000Z`);
    if (
        Number.isNaN(date.getTime()) ||
        date.toISOString().slice(0, 10) !== value
    ) {
        return undefined;
    }

    return date;
}

function stockForPackaging(
    stock: StockCreationDraft,
    packagingKeys: string[],
    errorPrefix: string,
    errors: ProductCreationErrors
) {
    return packagingKeys.map((key) => {
        const quantity = parseQuantity(stock[key] ?? "");
        if (quantity === undefined) {
            errors[`${errorPrefix}.${key}`] =
                "Enter a non-negative whole number within the safe range.";
        }

        return { packagingLevelId: key, quantity: quantity ?? 0 };
    });
}

export function validateProductCreationDraft(
    draft: ProductCreationDraft
): ProductCreationErrors {
    const errors: ProductCreationErrors = {};
    if (draft.name.trim() === "") {
        errors.name = "Product name is required.";
    }

    if (draft.addVariants && draft.variants.length === 0) {
        errors.variants = "Add at least one variant.";
    }

    draft.variants.forEach((productVariant, variantIndex) => {
        const prefix = `variants.${variantIndex}`;
        if (draft.addVariants && productVariant.name.trim() === "") {
            errors[`${prefix}.name`] = "Enter a name or description.";
        }

        productVariant.packaging.forEach((level, levelIndex) => {
            const levelPrefix = `${prefix}.packaging.${levelIndex}`;
            if (level.name.trim() === "") {
                errors[`${levelPrefix}.name`] = "Packaging name is required.";
            }

            if (levelIndex < productVariant.packaging.length - 1) {
                const quantity = Number(level.quantityOfNextLevel);
                if (
                    level.quantityOfNextLevel.trim() === "" ||
                    !Number.isSafeInteger(quantity) ||
                    quantity <= 0
                ) {
                    errors[`${levelPrefix}.quantityOfNextLevel`] =
                        "Enter a positive whole number within the safe range.";
                }
            }

            for (const priceField of ["costPrice", "sellingPrice"] as const) {
                if (parsePrice(level[priceField]) === undefined) {
                    errors[`${levelPrefix}.${priceField}`] =
                        "Enter a non-negative price.";
                }
            }
        });

        const packagingKeys = productVariant.packaging.map((level) => level.key);
        if (productVariant.batches.length === 0) {
            stockForPackaging(
                productVariant.unbatchedStock,
                packagingKeys,
                `${prefix}.unbatchedStock`,
                errors
            );
        }

        productVariant.batches.forEach((batchDraft, batchIndex) => {
            if (
                batchDraft.expiryDate.trim() !== "" &&
                !validDate(batchDraft.expiryDate)
            ) {
                errors[`${prefix}.batches.${batchIndex}.expiryDate`] =
                    "Enter a valid expiry date.";
            }
            stockForPackaging(
                batchDraft.stock,
                packagingKeys,
                `${prefix}.batches.${batchIndex}.stock`,
                errors
            );
        });
    });

    return errors;
}

export interface ProductCreationResult {
    product: productStructure;
    inventoryRecords: inventory[];
    inventoryBatches: inventoryBatch[];
}

function createUniqueIdFactory(
    existingProducts: productStructure[],
    existingInventory: inventory[],
    existingInventoryBatches: inventoryBatch[],
    makeId: () => string
): () => string {
    const usedIds = new Set([
        ...existingProducts.flatMap((product) => [
            product.id,
            ...product.variant.flatMap((item) => [
                item.id,
                ...item.packagingHierarchy.map((level) => level.id)
            ])
        ]),
        ...existingInventory.map((record) => record.id),
        ...existingInventoryBatches.map((batchItem) => batchItem.batchId)
    ]);

    return () => {
        const id = makeId();
        if (id.trim() === "" || usedIds.has(id)) {
            throw new Error("Unable to create a unique product record ID.");
        }
        usedIds.add(id);
        return id;
    };
}

function createCatalogueVariant(
    variantDraft: VariantCreationDraft,
    variantName: string,
    createId: () => string
): variant {
    const variantId = createId();
    const packagingIds = variantDraft.packaging.map(() => createId());
    const packagingHierarchy: packagingLevel[] =
        variantDraft.packaging.map((level, levelIndex) => ({
            id: packagingIds[levelIndex],
            name: level.name.trim(),
            costPrice: parsePrice(level.costPrice) ?? null,
            sellingPrice: parsePrice(level.sellingPrice) ?? null,
            quantityofNextLevel:
                levelIndex < variantDraft.packaging.length - 1
                    ? Number(level.quantityOfNextLevel)
                    : null,
            nextLevelId: packagingIds[levelIndex + 1] ?? null
        }));
    validatePackagingHierarchy(packagingHierarchy);

    return {
        id: variantId,
        variantName,
        ...(variantDraft.nafdacRegistrationNumber.trim()
            ? {
                nafdacRegistrationNumber:
                    variantDraft.nafdacRegistrationNumber.trim()
            }
            : {}),
        packagingHierarchy
    };
}

function buildProductFromDraft(
    draft: ProductCreationDraft,
    existingProducts: productStructure[],
    existingInventory: inventory[],
    makeId: () => string,
    existingInventoryBatches: inventoryBatch[],
    includeStock: boolean
): ProductCreationResult {
    const errors = validateProductCreationDraft(draft);
    if (Object.keys(errors).length > 0) {
        throw new Error(Object.values(errors)[0]);
    }

    const createId = createUniqueIdFactory(
        existingProducts,
        existingInventory,
        existingInventoryBatches,
        makeId
    );

    const productId = createId();
    const inventoryRecords: inventory[] = [];
    const inventoryBatches: inventoryBatch[] = [];
    const variants: variant[] = (draft.addVariants
        ? draft.variants
        : draft.variants.slice(0, 1)
    ).map((variantDraft) => {
        const productVariant = createCatalogueVariant(
            variantDraft,
            draft.addVariants ? variantDraft.name.trim() : draft.name.trim(),
            createId
        );
        const batches: inventoryBatch[] = includeStock
            ? variantDraft.batches.map((batchDraft) => ({
                batchId: createId(),
                productId,
                variantId: productVariant.id,
                batchNumber: batchDraft.batchNumber.trim() || null,
                expiryDate: batchDraft.expiryDate.trim() === ""
                    ? null
                    : validDate(batchDraft.expiryDate) ?? null
            }))
            : [];
        inventoryBatches.push(...batches);

        if (includeStock && productVariant.packagingHierarchy.length > 0) {
            const packagingKeys = variantDraft.packaging.map((level) => level.key);
            const stockDrafts = variantDraft.batches.length > 0
                ? variantDraft.batches.map((item, index) => ({
                    batchId: batches[index].batchId,
                    stock: item.stock
                }))
                : [{ batchId: null, stock: variantDraft.unbatchedStock }];

            for (const stockDraft of stockDrafts) {
                inventoryRecords.push({
                    id: createId(),
                    productId,
                    variantId: productVariant.id,
                    batchId: stockDraft.batchId,
                    stockQuantities: productVariant.packagingHierarchy.map((level, index) => ({
                        packagingLevelId: level.id,
                        quantity:
                            parseQuantity(stockDraft.stock[packagingKeys[index]] ?? "") ??
                            0
                    }))
                });
            }
        }

        return productVariant;
    });

    return {
        product: {
            id: productId,
            name: draft.name.trim(),
            genericName: draft.genericName.trim(),
            manufacturer: draft.manufacturer.trim(),
            category: draft.category.trim(),
            variant: variants
        },
        inventoryRecords,
        inventoryBatches
    };
}

export function createProductFromDraft(
    draft: ProductCreationDraft,
    existingProducts: productStructure[] = [],
    existingInventory: inventory[] = [],
    makeId: () => string = () => crypto.randomUUID(),
    existingInventoryBatches: inventoryBatch[] = []
): ProductCreationResult {
    return buildProductFromDraft(
        draft,
        existingProducts,
        existingInventory,
        makeId,
        existingInventoryBatches,
        true
    );
}

export function createCatalogueProductFromDraft(
    draft: ProductCreationDraft,
    existingProducts: productStructure[] = [],
    existingInventory: inventory[] = [],
    makeId: () => string = () => crypto.randomUUID(),
    existingInventoryBatches: inventoryBatch[] = []
): productStructure {
    return buildProductFromDraft(
        draft,
        existingProducts,
        existingInventory,
        makeId,
        existingInventoryBatches,
        false
    ).product;
}

export function createVariantFromDraft(
    product: productStructure,
    draft: VariantCreationDraft,
    existingProducts: productStructure[] = [],
    existingInventory: inventory[] = [],
    makeId: () => string = () => crypto.randomUUID(),
    existingInventoryBatches: inventoryBatch[] = []
): variant {
    const validationDraft: ProductCreationDraft = {
        name: product.name,
        genericName: "",
        manufacturer: "",
        category: "",
        addVariants: true,
        variants: [{ ...draft, batches: [], unbatchedStock: {} }]
    };
    const errors = validateProductCreationDraft(validationDraft);
    if (Object.keys(errors).length > 0) {
        throw new Error(Object.values(errors)[0]);
    }

    const createId = createUniqueIdFactory(
        existingProducts,
        existingInventory,
        existingInventoryBatches,
        makeId
    );
    return createCatalogueVariant(draft, draft.name.trim(), createId);
}