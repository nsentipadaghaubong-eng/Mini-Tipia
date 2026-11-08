export interface BatchReceivedPricing {
    packagingLevelId: string;
    sellingPrice: number;
}

export interface inventoryBatch {
    batchId: string;
    productId: string;
    variantId: string;
    batchNumber: string | null;
    expiryDate: Date | null;
    receivedDate?: string;
    receivedPricing?: BatchReceivedPricing;
}

export function getInventoryBatchById(
    batches: inventoryBatch[],
    batchId: string
): inventoryBatch {
    const normalizedBatchId = batchId.trim();
    const matchingBatches = batches.filter(
        (batch) => batch.batchId === normalizedBatchId
    );

    if (matchingBatches.length === 0) {
        throw new Error("Batch does not belong to this variant.");
    }

    if (matchingBatches.length > 1) {
        throw new Error("Duplicate batch ID found in inventory.");
    }

    return matchingBatches[0];
}
