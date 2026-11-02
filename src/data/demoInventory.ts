
import type { productStructure } from "../products/productStructure";
import type { inventory } from "../inventory/inventoryStock";

import { products } from "../products/productList";
import { createInventory } from "../inventory/inventoryStock";

// Temporary product collection
export const demoProducts: productStructure[] = [
    products
];

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

    // Panadol Syrup - Batch E1-1001
    createInventory(
        products.id,
        products.variant[2].id,
        products.variant[2].batches[0].batchId,
        [
            { packagingLevelId: "bottle", quantity: 15 }
        ]
    )

];
