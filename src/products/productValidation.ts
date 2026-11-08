import type {
    productStructure,
    variant
} from "./productStructure.ts";

import type { packagingLevel } from "../packaging/packagingHierarchy";
import { getPackagingLevelFromHierarchy } from "../packaging/packagingValidation";

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