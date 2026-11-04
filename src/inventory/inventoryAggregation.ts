import type { packagingLevel } from "../packaging/packagingHierarchy";
import type { stockQuantity } from "./inventoryStock";
import type{ inventoryDisplay } from "./inventoryLookup";

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
        if (batchIds.has(record.batchId)) {
            throw new Error(
                `Duplicate batch found: ${record.batchId}`
            );
        }

        batchIds.add(record.batchId);
    }

    const aggregatedQuantities: stockQuantity[] = [];
    const packagingDefinitions: packagingLevel[] = [];

    for (const record of inventoryRecords) {
        for (const stock of record.stockQuantities) {

            // Find the packaging definition for this stock quantity.
            const matchingDefinition = record.packagingLevels.find(
                (level) => level.id === stock.packagingLevelId
            );

            if (!matchingDefinition) {
                throw new Error(
                    `Packaging definition not found: ${stock.packagingLevelId}`
                );
            }

            // Check whether this packaging definition already exists.
            const existingDefinition = packagingDefinitions.find(
                (level) => level.id === matchingDefinition.id
            );

            if (existingDefinition) {
                // Ensure the packaging definition is consistent.
                if (
                    existingDefinition.name !== matchingDefinition.name ||
                    existingDefinition.quantityofNextLevel !== matchingDefinition.quantityofNextLevel ||
                    existingDefinition.nextLevelId !== matchingDefinition.nextLevelId
                ) {
                    throw new Error(
                        `Conflicting packaging definitions found: ${matchingDefinition.id}`
                    );
                }
            } else {
                packagingDefinitions.push(matchingDefinition);
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