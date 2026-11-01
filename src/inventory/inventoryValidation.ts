import type { productStructure } from "../products/productStructure";
import type { inventory } from "./inventoryStock";
import {
   getVariantById,
   getBatchById,
   getPackagingLevelById

} from "../products/productValidation";

export function validateInventoryRelationships(
   product: productStructure,
   inventoryRecord: inventory

) {
   //Validation 1: Product relationship
   const match = inventoryRecord.productId === product.id
   if (!match) {
      throw new Error("The inventory record doesn't belong to this product")
   }

   //Validation 2: Variant relationship
   const selectedVariant = getVariantById(product, inventoryRecord.variantId)

   //Validation 3: Batch relationship
   getBatchById(selectedVariant, inventoryRecord.batchId)

   //Validation 4: Packaging relationship
   for (const stockQuantity of inventoryRecord.stockQuantities) {
      getPackagingLevelById(selectedVariant, stockQuantity.packagingLevelId);


   }

}
