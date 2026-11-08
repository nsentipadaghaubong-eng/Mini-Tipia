import type { inventory, stockQuantity } from "./inventoryStock";
import type { productStructure, variant } from "../products/productStructure";
import type { inventoryBatch } from "./inventoryBatch";
import type { packagingLevel } from "../packaging/packagingHierarchy";
import { demoInventory, demoProducts } from "../data/demoInventory";
import { demoInventoryBatches } from "./inventoryBatchList";
import { validateInventoryPackagingRelationships } from "./inventoryValidation";

export interface inventoryDisplay {
    inventoryId: string;
    productId: string;
    variantId: string;
    batchId: string | null;
    productName: string;
    variantName: string;
    batchNumber: string | null;
    expiryDate: Date | null;
    packagingLevels: packagingLevel[];
    stockQuantities: stockQuantity[];
}

export function getProductForInventory(
    inventoryRecord: inventory,
    productsCollection: productStructure[] = demoProducts
): productStructure | undefined {
    return productsCollection.find(
        (product) => product.id === inventoryRecord.productId
    );
}

export function getVariantForInventory(
    inventoryRecord: inventory,
    productsCollection: productStructure[] = demoProducts
): variant | undefined {
    const matchingProduct = getProductForInventory(
        inventoryRecord,
        productsCollection
    );

    if (!matchingProduct) {
        return undefined;
    }

    return matchingProduct.variant.find(
        (item) => item.id === inventoryRecord.variantId
    );
}

export function getBatchForInventory(
    inventoryRecord: inventory,
    batchesCollection: inventoryBatch[] = demoInventoryBatches
): inventoryBatch | undefined {
    if (inventoryRecord.batchId === null) {
        return undefined;
    }

    const matchingBatches = batchesCollection.filter(
        (batch) => batch.batchId === inventoryRecord.batchId
    );

    if (matchingBatches.length !== 1) {
        return undefined;
    }

    const [batch] = matchingBatches;
    return batch.productId === inventoryRecord.productId &&
        batch.variantId === inventoryRecord.variantId
        ? batch
        : undefined;
}

export function getPackagingLevelForInventory(
    inventoryRecord: inventory,
    productsCollection: productStructure[] = demoProducts
): packagingLevel[] {
    const matchingVariant = getVariantForInventory(
        inventoryRecord,
        productsCollection
    );

    if (!matchingVariant) {
        return [];
    }

    const product = getProductForInventory(inventoryRecord, productsCollection);
    if (!product) {
        return [];
    }

    validateInventoryPackagingRelationships(product, inventoryRecord);
    return matchingVariant.packagingHierarchy.map((level) => ({ ...level }));
}

export function getInventoryDisplay(
    inventoryRecord: inventory,
    productsCollection: productStructure[] = demoProducts,
    batchesCollection: inventoryBatch[] = demoInventoryBatches
): inventoryDisplay {
    const product = getProductForInventory(
        inventoryRecord,
        productsCollection
    );

    const variant = getVariantForInventory(
        inventoryRecord,
        productsCollection
    );

    const batch = getBatchForInventory(inventoryRecord, batchesCollection);

    if (!product || !variant || (inventoryRecord.batchId !== null && !batch)) {
        throw new Error(
            "Inventory references invalid product, variant or batch."
        );
    }

    return {
        inventoryId: inventoryRecord.id,
        productId: inventoryRecord.productId,
        variantId: inventoryRecord.variantId,
        batchId: inventoryRecord.batchId,
        productName: product.name,
        variantName: variant.variantName,
        batchNumber: batch?.batchNumber ?? null,
        expiryDate: batch?.expiryDate ?? null,
        packagingLevels: getPackagingLevelForInventory(
            inventoryRecord,
            productsCollection
        ),
        stockQuantities: inventoryRecord.stockQuantities
    };
}

export function getAllInventoryDisplay(
    inventoryRecords: inventory[] = demoInventory,
    productsCollection: productStructure[] = demoProducts,
    batchesCollection: inventoryBatch[] = demoInventoryBatches
): inventoryDisplay[] {
    return inventoryRecords.map((inventoryRecord) =>
        getInventoryDisplay(
            inventoryRecord,
            productsCollection,
            batchesCollection
        )
    );
}