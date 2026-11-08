import type { packagingLevel } from "../packaging/packagingHierarchy";
import type { stockQuantity } from "./inventoryStock";
import type{ inventoryDisplay } from "./inventoryLookup";
import { validatePackagingHierarchy } from "../packaging/packagingValidation";

export interface aggregatedVariantStock{
productId:string;
variantId:string;
batchCount:	number;
stockQuantities: stockQuantity[];
packagingLevels: packagingLevel[];

}



export function aggregateVariantStock(
    inventoryRecords: inventoryDisplay[]
): aggregatedVariantStock | null {

    if (inventoryRecords.length === 0) {
        return null;
    }

    const firstRecord = inventoryRecords[0];

    // Validate that all records belong to the same product and variant.
    const hasDifferentProductOrVariant = inventoryRecords.some(
        (record) =>
            record.productId !== firstRecord.productId ||
            record.variantId !== firstRecord.variantId
    );

    if (hasDifferentProductOrVariant) {
        throw new Error(
            "Cannot aggregate inventory records from different products or variants."
        );
    }

    // Prevent the same batch from being counted more than once.
    const batchIds = new Set<string>();

    for (const record of inventoryRecords) {
        if (record.batchId === null) {
            continue;
        }
        if (batchIds.has(record.batchId)) {
            throw new Error(
                `Duplicate batch found: ${record.batchId}`
            );
        }

        batchIds.add(record.batchId);
    }

    const packagingDefinitions = firstRecord.packagingLevels.map(
        (level) => ({ ...level })
    );
    validatePackagingHierarchy(packagingDefinitions);

    const aggregatedQuantities: stockQuantity[] = [];

    for (const record of inventoryRecords) {
        validatePackagingHierarchy(record.packagingLevels);
        if (
            record.packagingLevels.length !== packagingDefinitions.length ||
            packagingDefinitions.some((definition, index) => {
                const candidate = record.packagingLevels[index];
                return (
                    !candidate ||
                    definition.id !== candidate.id ||
                    definition.name !== candidate.name ||
                    definition.costPrice !== candidate.costPrice ||
                    definition.sellingPrice !== candidate.sellingPrice ||
                    definition.quantityofNextLevel !==
                        candidate.quantityofNextLevel ||
                    definition.nextLevelId !== candidate.nextLevelId
                );
            })
        ) {
            throw new Error(
                "Conflicting packaging definitions found for this variant."
            );
        }

        for (const stock of record.stockQuantities) {
            if (
                !packagingDefinitions.some(
                    (level) => level.id === stock.packagingLevelId
                )
            ) {
                throw new Error(
                    `Packaging definition not found: ${stock.packagingLevelId}`
                );
            }

            if (
                !Number.isSafeInteger(stock.quantity) ||
                stock.quantity < 0
            ) {
                throw new Error(
                    "Stock quantities must be non-negative safe integers."
                );
            }

            // Find an existing aggregated quantity for this packaging level.
            const existingQuantity = aggregatedQuantities.find(
                (item) => item.packagingLevelId === stock.packagingLevelId
            );

            if (existingQuantity) {
                existingQuantity.quantity += stock.quantity;
            } else {
                aggregatedQuantities.push({
                    packagingLevelId: stock.packagingLevelId,
                    quantity: stock.quantity
                });
            }
        }
    }

    return {
        productId: firstRecord.productId,
        variantId: firstRecord.variantId,
        batchCount: batchIds.size,
        stockQuantities: aggregatedQuantities,
        packagingLevels: packagingDefinitions
    };
}