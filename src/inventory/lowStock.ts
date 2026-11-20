import type { aggregatedVariantStock } from "./inventoryAggregation";
import type { variant } from "../products/productStructure";
import {
    getLowestPackagingLevel,
    getPackagingConversionQuantity,
    getPackagingLevelFromHierarchy,
    validatePackagingHierarchy
} from "../packaging/packagingValidation";
import { validateVariantLowStockThreshold } from "../products/productValidation";

export interface VariantLowStockStatus {
    thresholdConfigured: boolean;
    isLowStock: boolean;
    hasStock: boolean;
    thresholdQuantity?: number;
    thresholdPackagingLevelId?: string;
}

function unitsAtLowestLevel(
    selectedVariant: variant,
    packagingLevelId: string
): bigint {
    const levels = selectedVariant.packagingHierarchy;
    let current = getPackagingLevelFromHierarchy(levels, packagingLevelId);
    let factor = 1n;
    while (current.nextLevelId !== null) {
        factor *= BigInt(getPackagingConversionQuantity(
            levels,
            current.id,
            current.nextLevelId
        ));
        current = getPackagingLevelFromHierarchy(levels, current.nextLevelId);
    }
    return factor;
}

export function getVariantLowStockStatus(
    selectedVariant: variant,
    aggregatedStock: aggregatedVariantStock | null
): VariantLowStockStatus {
    const levels = selectedVariant.packagingHierarchy;
    validatePackagingHierarchy(levels);
    if (
        aggregatedStock &&
        (
            aggregatedStock.variantId !== selectedVariant.id ||
            aggregatedStock.packagingLevels.length !== levels.length ||
            levels.some((level, index) => {
                const aggregateLevel = aggregatedStock.packagingLevels[index];
                return !aggregateLevel ||
                    aggregateLevel.id !== level.id ||
                    aggregateLevel.nextLevelId !== level.nextLevelId ||
                    aggregateLevel.quantityofNextLevel !==
                        level.quantityofNextLevel;
            })
        )
    ) {
        throw new Error("Aggregated stock does not match the selected variant.");
    }

    let availableSmallestUnits = 0n;
    for (const stock of aggregatedStock?.stockQuantities ?? []) {
        if (
            !Number.isSafeInteger(stock.quantity) ||
            stock.quantity < 0
        ) {
            throw new Error("Aggregated stock must use non-negative safe integers.");
        }
        availableSmallestUnits +=
            BigInt(stock.quantity) *
            unitsAtLowestLevel(selectedVariant, stock.packagingLevelId);
    }

    const hasStock = availableSmallestUnits > 0n;
    const threshold = selectedVariant.lowStockThreshold;
    if (threshold === undefined) {
        return {
            thresholdConfigured: false,
            isLowStock: false,
            hasStock
        };
    }

    validateVariantLowStockThreshold(selectedVariant);
    const thresholdPackagingLevel = threshold.packagingLevelId
        ? getPackagingLevelFromHierarchy(
            levels,
            threshold.packagingLevelId
        )
        : getLowestPackagingLevel(levels);
    const thresholdSmallestUnits =
        BigInt(threshold.quantity) *
        unitsAtLowestLevel(selectedVariant, thresholdPackagingLevel.id);

    return {
        thresholdConfigured: true,
        isLowStock: hasStock &&
            availableSmallestUnits <= thresholdSmallestUnits,
        hasStock,
        thresholdQuantity: threshold.quantity,
        thresholdPackagingLevelId: thresholdPackagingLevel.id
    };
}
