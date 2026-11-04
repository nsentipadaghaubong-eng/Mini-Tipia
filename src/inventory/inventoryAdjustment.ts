import type { inventory } from "./inventoryStock";
import { adjustStock, getStockQuantity } from "./inventoryStock";

export interface stockAdjustment {
    id: string;
    inventoryId: string;
    productId: string;
    variantId: string;
    batchId: string;
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

export function adjustInventoryStock(
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
    const previousQuantity = getStockQuantity(inventoryRecord, normalizedPackagingId);
    

    if (previousQuantity === actualQuantity) {
        throw new Error("The new quantity is the same as the existing quantity");
    }

    const updatedInventory = adjustStock(
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
