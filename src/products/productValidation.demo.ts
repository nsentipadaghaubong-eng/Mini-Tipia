import { products } from "./productList.ts";

import {
    getVariantById,
    getBatchById,
    getPackagingLevelById
} from "./productValidation.ts";

// Get Panadol 500mg tablets
const panadolVariant = getVariantById(
    products,
    products.variant[0].id
);

// Get its first batch
const panadolBatch = getBatchById(
    panadolVariant,
    panadolVariant.batches[0].batchId
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
    getBatchById(
        panadolVariant,
        products.variant[1].batches[0].batchId
    );
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