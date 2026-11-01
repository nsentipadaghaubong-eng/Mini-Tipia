import type {
    productStructure,
    variant,
    batch
} from "./productStructure.ts";

import type { packagingLevel } from "../packaging/packagingHierarchy";

export function getVariantById(
    product: productStructure,
    variantId: string
): variant {

    const normalizedVariantId = variantId.trim()

    const matchingVariants = product.variant.filter(
        variant => variant.id === normalizedVariantId
    );

    if (matchingVariants.length === 0) {
        throw new Error("Variant does not belong to this product.");
    }

    if (matchingVariants.length > 1) {
        throw new Error("Duplicate variant ID found in product.");
    }


    //Return the first matching 
    //variant object to whoever called this function.
    return matchingVariants[0];
}


export function getBatchById(
    selectedVariant: variant,
    batchId: string
): batch {

    const normalizedBatchId = batchId.trim()

    const matchingBatches = selectedVariant.batches.filter(
        batch => batch.batchId === normalizedBatchId
    );

    if (matchingBatches.length === 0) {
        throw new Error("Batch does not belong to this variant.");
    }

    if (matchingBatches.length > 1) {
        throw new Error("Duplicate batch ID found in variant.");
    }

    return matchingBatches[0];
}


export function getPackagingLevelById(
    selectedVariant: variant,
    packagingLevelId: string
): packagingLevel {

    const normalizedPackagingId = packagingLevelId.trim()

    const matchingPackagingLevels = selectedVariant.packagingHierarchy.filter(
        level => level.id === normalizedPackagingId
    );

    if (matchingPackagingLevels.length === 0) {
        throw new Error("Packaging level does not belong to this variant.");
    }

    if (matchingPackagingLevels.length > 1) {
        throw new Error("Duplicate packaging level ID found in variant.");
    }

    return matchingPackagingLevels[0];
}