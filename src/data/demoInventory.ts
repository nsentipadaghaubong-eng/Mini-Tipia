
import type { productStructure } from "../products/productStructure";
import type { inventory } from "../inventory/inventoryStock";

import { products, productList } from "../products/productList";
import { createInventory } from "../inventory/inventoryStock";

// Temporary product collection
export const demoProducts: productStructure[] = productList;

// Temporary inventory collection
export const demoInventory: inventory[] = [

    // Panadol 500mg - Batch B1-1001
    createInventory(
        products.id,
        products.variant[0].id,
        products.variant[0].batches[0].batchId,
        [
            { packagingLevelId: "box", quantity: 2 },
            { packagingLevelId: "pack", quantity: 3 },
            { packagingLevelId: "card", quantity: 7 }
        ]
    ),

    // Panadol 500mg - Batch B1-1002
    createInventory(
        products.id,
        products.variant[0].id,
        products.variant[0].batches[1].batchId,
        [
            { packagingLevelId: "box", quantity: 1 },
            { packagingLevelId: "pack", quantity: 4 },
            { packagingLevelId: "card", quantity: 12 }
        ]
    ),

    // Panadol Extra - Batch E1-1001
    createInventory(
        products.id,
        products.variant[1].id,
        products.variant[1].batches[0].batchId,
        [
            { packagingLevelId: "extra-box", quantity: 3 },
            { packagingLevelId: "extra-pack", quantity: 2 },
            { packagingLevelId: "extra-card", quantity: 5 }
        ]
    ),

    // Panadol Extra - Batch E1-1002
    createInventory(
        products.id,
        products.variant[1].id,
        products.variant[1].batches[1].batchId,
        [
            { packagingLevelId: "extra-box", quantity: 1 },
            { packagingLevelId: "extra-pack", quantity: 3 },
            { packagingLevelId: "extra-card", quantity: 8 }
        ]
    ),

    // Panadol Syrup
    createInventory(
        products.id,
        products.variant[2].id,
        products.variant[2].batches[0].batchId,
        [
            { packagingLevelId: "bottle", quantity: 15 }
        ]
    ),

    // Amoxicillin Capsules
    createInventory(
        productList[1].id,
        productList[1].variant[0].id,
        productList[1].variant[0].batches[0].batchId,
        [
            { packagingLevelId: "am-carton", quantity: 2 },
            { packagingLevelId: "am-box", quantity: 4 },
            { packagingLevelId: "am-capsule", quantity: 12 }
        ]
    ),

    // Amoxicillin Suspension
    createInventory(
        productList[1].id,
        productList[1].variant[1].id,
        productList[1].variant[1].batches[0].batchId,
        [
            { packagingLevelId: "am-suspension-bottle", quantity: 8 }
        ]
    ),

    // Vitamin C
    createInventory(
        productList[2].id,
        productList[2].variant[0].id,
        productList[2].variant[0].batches[0].batchId,
        [
            { packagingLevelId: "vc-tube", quantity: 6 },
            { packagingLevelId: "vc-tablet", quantity: 15 }
        ]
    ),

    // Paracetamol
    createInventory(
        productList[3].id,
        productList[3].variant[0].id,
        productList[3].variant[0].batches[0].batchId,
        [
            { packagingLevelId: "par-carton", quantity: 1 },
            { packagingLevelId: "par-pack", quantity: 5 },
            { packagingLevelId: "par-card", quantity: 20 }
        ]
    )

];
