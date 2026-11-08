import { products } from "./productList.ts";

import { getVariantById, getPackagingLevelById } from "./productValidation.ts";
import { getInventoryBatchById } from "../inventory/inventoryBatch.ts";
import { demoInventoryBatches } from "../inventory/inventoryBatchList.ts";

// Get Panadol 500mg tablets
const panadolVariant = getVariantById(
    products,
    products.variant[0].id
);

// Get its first batch
const panadolBatch = getInventoryBatchById(
    demoInventoryBatches,
    demoInventoryBatches[0].batchId
);

// Get its Box packaging level
const box = getPackagingLevelById(
    panadolVariant,
    "box"
);

console.log("Valid variant:", panadolVariant);
console.log("Valid batch:", panadolBatch);
console.log("Valid packaging level:", box);


// Test an invalid batch relationship
try {
    const batch = getInventoryBatchById(
        demoInventoryBatches,
        demoInventoryBatches[2].batchId
    );
    if (batch.variantId !== panadolVariant.id) {
        throw new Error("Batch does not belong to this variant.");
    }
} catch (error) {
    console.log("Expected batch error:", (error as Error).message);
}


// Test an invalid packaging relationship
try {
    getPackagingLevelById(
        panadolVariant,
        "extra-box"
    );
} catch (error) {
    console.log("Expected packaging error:", (error as Error).message);
}