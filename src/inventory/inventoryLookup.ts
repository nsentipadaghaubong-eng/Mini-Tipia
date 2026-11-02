import { demoProducts } from "../data/demoInventory";
import type{ inventory,stockQuantity } from "./inventoryStock";
import type{ batch, productStructure, variant } from "../products/productStructure";
import type { packagingLevel } from "../packaging/packagingHierarchy";

export interface inventoryDisplay{
productName:string;
variantName: string;
batchNumber:string|null;
expiryDate:Date;
packagingLevels:packagingLevel[]
stockQuantities:stockQuantity[]
}

export function getProductForInventory(
inventoryRecord:inventory
):productStructure|undefined{

const matchingProduct = demoProducts.find((product)=>
    product.id === inventoryRecord.productId
)


return matchingProduct;
}

export function getVariantForInventory(
    inventoryRecord:inventory
):variant|undefined{
   const matchingProduct = getProductForInventory(inventoryRecord)
    if(!matchingProduct){
        return undefined
    }

    const matchingVariant = matchingProduct.variant.find(
        (variant)=> variant.id===inventoryRecord.variantId
    )

    //Not really needed, but it's fine
     if(!matchingVariant){
        return undefined
    }

    return matchingVariant;
}

export function getBatchForInventory(
    inventoryRecord:inventory,
):batch|undefined{
const matchingVariant = getVariantForInventory(inventoryRecord)
 if(!matchingVariant){
        return undefined
    }

    const matchingBatch = matchingVariant.batches.find(
        (item)=> item.batchId===inventoryRecord.batchId
    )

    return matchingBatch;
}

export function getPackagingLevelForInventory(
    inventoryRecord: inventory
): packagingLevel[] {
    const matchingVariant = getVariantForInventory(inventoryRecord);

    if (!matchingVariant) {
        return [];
    }

    const matchingPackagingLevels: packagingLevel[] = [];

    for (const stockQuantity of inventoryRecord.stockQuantities) {
        const matchingPackagingLevel = matchingVariant.packagingHierarchy.find(
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
    inventoryRecord: inventory
): inventoryDisplay {

    const product = getProductForInventory(inventoryRecord);
    const variant = getVariantForInventory(inventoryRecord);
    const batch = getBatchForInventory(inventoryRecord);

    if (!product || !variant || !batch) {
        throw new Error("Inventory references invalid product, variant or batch.");
    }

    return {
        productName: product.name,
        variantName: variant.variantName,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate,
        packagingLevels: getPackagingLevelForInventory(inventoryRecord),
        stockQuantities: inventoryRecord.stockQuantities
    };
}