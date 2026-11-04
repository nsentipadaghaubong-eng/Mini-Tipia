import type { inventory, stockQuantity } from "./inventoryStock";
import type {
    batch,
    productStructure,
    variant
} from "../products/productStructure";
import type { packagingLevel } from "../packaging/packagingHierarchy";
import { demoInventory, demoProducts } from "../data/demoInventory";

export interface inventoryDisplay {
    inventoryId: string;
    productId: string;
    variantId: string;
    batchId: string;
    productName: string;
    variantName: string;
    batchNumber: string | null;
    expiryDate: Date;
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
    productsCollection: productStructure[] = demoProducts
): batch | undefined {
    const matchingVariant = getVariantForInventory(
        inventoryRecord,
        productsCollection
    );

    if (!matchingVariant) {
        return undefined;
    }

    return matchingVariant.batches.find(
        (item) => item.batchId === inventoryRecord.batchId
    );
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

    const matchingPackagingLevels: packagingLevel[] = [];

    for (const stockQuantity of inventoryRecord.stockQuantities) {
        const matchingPackagingLevel =
            matchingVariant.packagingHierarchy.find(
                (level) => level.id === stockQuantity.packagingLevelId
            );

        if (!matchingPackagingLevel) {
            throw new Error(
                `Packaging level not found: ${stockQuantity.packagingLevelId}`
            );
        }

        matchingPackagingLevels.push(matchingPackagingLevel);
    }

    return matchingPackagingLevels;
}

export function getInventoryDisplay(
    inventoryRecord: inventory,
    productsCollection: productStructure[] = demoProducts
): inventoryDisplay {
    const product = getProductForInventory(
        inventoryRecord,
        productsCollection
    );

    const variant = getVariantForInventory(
        inventoryRecord,
        productsCollection
    );

    const batch = getBatchForInventory(
        inventoryRecord,
        productsCollection
    );

    if (!product || !variant || !batch) {
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
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate,
        packagingLevels: getPackagingLevelForInventory(
            inventoryRecord,
            productsCollection
        ),
        stockQuantities: inventoryRecord.stockQuantities
    };
}

export function getAllInventoryDisplay(
    inventoryRecords: inventory[] = demoInventory,
    productsCollection: productStructure[] = demoProducts
): inventoryDisplay[] {
    return inventoryRecords.map((inventoryRecord) =>
        getInventoryDisplay(inventoryRecord, productsCollection)
    );
} 