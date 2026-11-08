import type { productStructure } from "../products/productStructure";
import type { inventory } from "./inventoryStock";
import type { inventoryBatch } from "./inventoryBatch";
import {
   getVariantById
} from "../products/productValidation";
import { getInventoryBatchById } from "./inventoryBatch";
import { validatePackagingHierarchy } from "../packaging/packagingValidation";

export function validateInventoryPackagingRelationships(
   product: productStructure,
   inventoryRecord: inventory
): void {
   if (inventoryRecord.productId !== product.id) {
      throw new Error("The inventory record doesn't belong to this product");
   }

   const selectedVariant = getVariantById(product, inventoryRecord.variantId);
   validatePackagingHierarchy(selectedVariant.packagingHierarchy);

   const validPackagingIds = new Set(
      selectedVariant.packagingHierarchy.map((level) => level.id)
   );
   const packagingIds = new Set<string>();
   for (const stockQuantity of inventoryRecord.stockQuantities) {
      if (packagingIds.has(stockQuantity.packagingLevelId)) {
         throw new Error(
            `Duplicate stock quantity for packaging level: ${stockQuantity.packagingLevelId}`
         );
      }
      packagingIds.add(stockQuantity.packagingLevelId);

      if (
         !Number.isSafeInteger(stockQuantity.quantity) ||
         stockQuantity.quantity < 0
      ) {
         throw new Error(
            "Stock quantities must be non-negative safe integers."
         );
      }

      if (!validPackagingIds.has(stockQuantity.packagingLevelId)) {
         throw new Error("Packaging level does not belong to this variant.");
      }
   }
}

export function validateInventoryRelationships(
   product: productStructure,
   inventoryRecord: inventory,
   batchesCollection: inventoryBatch[] = []

) {
   //Validation 1: Product relationship
   const match = inventoryRecord.productId === product.id
   if (!match) {
      throw new Error("The inventory record doesn't belong to this product")
   }

   //Validation 2: Variant relationship
   getVariantById(product, inventoryRecord.variantId)

   //Validation 3: Batch relationship
   if (inventoryRecord.batchId !== null) {
      const batch = getInventoryBatchById(
         batchesCollection,
         inventoryRecord.batchId
      );
      if (
         batch.productId !== inventoryRecord.productId ||
         batch.variantId !== inventoryRecord.variantId
      ) {
         throw new Error("Batch does not belong to this variant.");
      }
   }

   //Validation 4: Packaging relationship
   validateInventoryPackagingRelationships(product, inventoryRecord);

}
