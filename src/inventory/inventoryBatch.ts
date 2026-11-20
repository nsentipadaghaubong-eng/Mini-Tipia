import { hasAtMostTwoDecimalPlaces } from "../pricing/pricePrecision";

export interface BatchPackagingPricing {
    packagingLevelId: string;
    costPrice: number | null;
    sellingPrice: number | null;
}

export interface inventoryBatch {
    batchId: string;
    productId: string;
    variantId: string;
    batchNumber: string | null;
    expiryDate: Date | null;
    receivedDate?: string;
    pricingByPackagingLevel: BatchPackagingPricing[];
}

export function validateBatchPricingCollection(
    value: unknown,
    validPackagingLevelIds: readonly string[]
): asserts value is BatchPackagingPricing[] {
    if (!Array.isArray(value)) {
        throw new Error("Batch pricing must be an array.");
    }

    const validIds = new Set(validPackagingLevelIds);
    const seenIds = new Set<string>();
    for (const entry of value as unknown[]) {
        if (
            entry === null ||
            typeof entry !== "object" ||
            Array.isArray(entry)
        ) {
            throw new Error("Batch pricing entries must be objects.");
        }

        const pricing = entry as Record<string, unknown>;
        const keys = Object.keys(pricing).sort();
        if (
            keys.length !== 3 ||
            keys[0] !== "costPrice" ||
            keys[1] !== "packagingLevelId" ||
            keys[2] !== "sellingPrice" ||
            typeof pricing.packagingLevelId !== "string" ||
            pricing.packagingLevelId.trim() === "" ||
            pricing.packagingLevelId !== pricing.packagingLevelId.trim() ||
            !validIds.has(pricing.packagingLevelId)
        ) {
            throw new Error("Batch pricing contains an invalid packaging level.");
        }

        if (seenIds.has(pricing.packagingLevelId)) {
            throw new Error(
                `Duplicate batch pricing for packaging level: ${pricing.packagingLevelId}`
            );
        }
        seenIds.add(pricing.packagingLevelId);

        for (const [label, price] of [
            ["Cost", pricing.costPrice],
            ["Selling", pricing.sellingPrice]
        ] as const) {
            if (
                price !== null &&
                (typeof price !== "number" ||
                    !Number.isFinite(price) ||
                    price < 0 ||
                    !hasAtMostTwoDecimalPlaces(price))
            ) {
                throw new Error(
                    `${label} price must be null or a finite non-negative number with at most two decimal places.`
                );
            }
        }
    }
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
