import type { inventory } from "./inventoryStock";
import {
    adjustStock,
    getStockQuantityOrZero
} from "./inventoryStock";
import type { productStructure } from "../products/productStructure";
import {
    validateInventoryPackagingRelationships,
    validateInventoryRelationships
} from "./inventoryValidation";
import { getVariantById, getPackagingLevelById } from "../products/productValidation";

export interface unbatchedInventoryChange {
    inventoryId: string;
    variantId: string;
    stockQuantities: {
        packagingLevelId: string;
        quantity: number;
    }[];
}

export interface stockAdjustment {
    id: string;
    inventoryId: string;
    productId: string;
    variantId: string;
    batchId: string | null;
    packagingLevelId: string;
    previousQuantity: number;
    newQuantity: number;
    quantityDifference: number;
    reason: string;
    createdAt: Date;
}

export interface stockAdjustmentResult {
    updatedInventory: inventory;
    adjustment: stockAdjustment;
}

export interface unbatchedInventoryChangesResult {
    updatedInventory: inventory[];
    adjustments: stockAdjustment[];
}

export function adjustInventoryStock(
    product: productStructure,
    inventoryRecord: inventory,
    packagingLevelId: string,
    actualQuantity: number,
    reason: string
): stockAdjustmentResult {
    const normalizedReason = reason.trim();
    if (normalizedReason === "") {
        throw new Error("An adjustment reason is required");
    }

    const normalizedPackagingId = packagingLevelId.trim();
    if(normalizedPackagingId === ""){
        throw new Error("Packaging Level Id cannot be empty")
    }
    validateInventoryPackagingRelationships(product, inventoryRecord);
    getPackagingLevelById(
        getVariantById(product, inventoryRecord.variantId),
        normalizedPackagingId
    );
    const previousQuantity = getStockQuantityOrZero(
        inventoryRecord,
        normalizedPackagingId
    );

    if (previousQuantity === actualQuantity) {
        throw new Error("The new quantity is the same as the existing quantity");
    }

    const updatedInventory = adjustStock(
        product,
        inventoryRecord,
        normalizedPackagingId,
        actualQuantity
    );

    const adjustment: stockAdjustment = {
        id: crypto.randomUUID(),
        inventoryId: inventoryRecord.id,
        productId: inventoryRecord.productId,
        variantId: inventoryRecord.variantId,
        batchId: inventoryRecord.batchId,
        packagingLevelId: normalizedPackagingId,
        previousQuantity,
        newQuantity: actualQuantity,
        quantityDifference: actualQuantity - previousQuantity,
        reason: normalizedReason,
        createdAt: new Date()
    };

    return { updatedInventory, adjustment };
}

export function applyUnbatchedInventoryChanges(
    product: productStructure,
    inventoryRecords: inventory[],
    changes: unbatchedInventoryChange[],
    reason: string,
    previouslyProcessedInventoryIds: ReadonlySet<string> = new Set()
): unbatchedInventoryChangesResult {
    const normalizedReason = reason.trim();
    if (normalizedReason === "") {
        throw new Error("An adjustment reason is required");
    }

    const updatedInventory = [...inventoryRecords];
    const adjustments: stockAdjustment[] = [];
    const seenInventoryIds = new Set(previouslyProcessedInventoryIds);

    for (const inventoryChange of changes) {
        if (inventoryChange.inventoryId.trim() === "") {
            throw new Error("Inventory ID must not be empty.");
        }

        if (seenInventoryIds.has(inventoryChange.inventoryId)) {
            throw new Error(
                `Duplicate inventory record in changes: ${inventoryChange.inventoryId}`
            );
        }
        seenInventoryIds.add(inventoryChange.inventoryId);

        const inventoryIndex = updatedInventory.findIndex(
            (record) =>
                record.id === inventoryChange.inventoryId &&
                record.productId === product.id &&
                record.variantId === inventoryChange.variantId &&
                record.batchId === null
        );

        if (inventoryIndex === -1) {
            throw new Error(
                `Unbatched inventory record not found: ${inventoryChange.inventoryId}`
            );
        }

        let updatedRecord = updatedInventory[inventoryIndex];
        validateInventoryRelationships(product, updatedRecord);

        const seenPackagingLevels = new Set<string>();
        for (const stock of inventoryChange.stockQuantities) {
            const packagingLevelId = stock.packagingLevelId.trim();
            if (packagingLevelId === "") {
                throw new Error("Packaging level ID must not be empty.");
            }

            if (seenPackagingLevels.has(packagingLevelId)) {
                throw new Error(
                    `Duplicate stock quantity for packaging level: ${packagingLevelId}`
                );
            }
            seenPackagingLevels.add(packagingLevelId);

            const previousQuantity = getStockQuantityOrZero(
                updatedRecord,
                packagingLevelId
            );
            if (previousQuantity === stock.quantity) {
                continue;
            }

            const result = adjustInventoryStock(
                product,
                updatedRecord,
                packagingLevelId,
                stock.quantity,
                normalizedReason
            );
            updatedRecord = result.updatedInventory;
            adjustments.push(result.adjustment);
        }

        updatedInventory[inventoryIndex] = updatedRecord;
    }

    return { updatedInventory, adjustments };
}
