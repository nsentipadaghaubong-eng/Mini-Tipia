import type {
    productStructure,
    variant
} from "./productStructure.ts";

import type { packagingLevel } from "../packaging/packagingHierarchy";
import {
    getLowestPackagingLevel,
    getPackagingLevelFromHierarchy,
    validatePackagingHierarchy
} from "../packaging/packagingValidation";

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


export function getPackagingLevelById(
    selectedVariant: variant,
    packagingLevelId: string
): packagingLevel {
    return getPackagingLevelFromHierarchy(
        selectedVariant.packagingHierarchy,
        packagingLevelId
    );
}

export function validateVariantLowStockThreshold(
    selectedVariant: variant
): void {
    const threshold = selectedVariant.lowStockThreshold;
    if (threshold === undefined) {
        return;
    }
    if (
        threshold === null ||
        typeof threshold !== "object" ||
        Array.isArray(threshold) ||
        !Number.isSafeInteger(threshold.quantity) ||
        threshold.quantity < 0 ||
        Object.keys(threshold).some((key) =>
            key !== "quantity" && key !== "packagingLevelId"
        )
    ) {
        throw new Error("Low-stock threshold must be a non-negative safe integer.");
    }

    validatePackagingHierarchy(selectedVariant.packagingHierarchy);
    if (threshold.packagingLevelId === undefined) {
        getLowestPackagingLevel(selectedVariant.packagingHierarchy);
        return;
    }
    if (
        typeof threshold.packagingLevelId !== "string" ||
        threshold.packagingLevelId.trim() === "" ||
        threshold.packagingLevelId !== threshold.packagingLevelId.trim()
    ) {
        throw new Error("Low-stock threshold packaging level is invalid.");
    }
    getPackagingLevelFromHierarchy(
        selectedVariant.packagingHierarchy,
        threshold.packagingLevelId
    );
}