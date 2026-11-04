
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
        ],
        "inventory-panadol-b1-1001"
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
        ],
        "inventory-panadol-b1-1002"
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
        ],
        "inventory-panadol-e1-1001"
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
        ],
        "inventory-panadol-e1-1002"
    ),

    // Panadol Syrup
    createInventory(
        products.id,
        products.variant[2].id,
        products.variant[2].batches[0].batchId,
        [
            { packagingLevelId: "bottle", quantity: 15 }
        ],
        "inventory-panadol-syrup-001"
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
        ],
        "inventory-amoxicillin-am-1001"
    ),

    // Amoxicillin Suspension
    createInventory(
        productList[1].id,
        productList[1].variant[1].id,
        productList[1].variant[1].batches[0].batchId,
        [
            { packagingLevelId: "am-suspension-bottle", quantity: 8 }
        ],
        "inventory-amoxicillin-am-1002"
    ),

    // Vitamin C
    createInventory(
        productList[2].id,
        productList[2].variant[0].id,
        productList[2].variant[0].batches[0].batchId,
        [
            { packagingLevelId: "vc-tube", quantity: 6 },
            { packagingLevelId: "vc-tablet", quantity: 15 }
        ],
        "inventory-vitamin-c-vc-1001"
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
        ],
        "inventory-paracetamol-par-1001"
    ),

    // Ibuprofen
    createInventory(
        productList[4].id,
        productList[4].variant[0].id,
        productList[4].variant[0].batches[0].batchId,
        [
            { packagingLevelId: "ib-carton", quantity: 2 },
            { packagingLevelId: "ib-pack", quantity: 6 },
            { packagingLevelId: "ib-tablet", quantity: 18 }
        ],
        "inventory-ibuprofen-ib-1001"
    ),

    // Cetirizine
    createInventory(
        productList[5].id,
        productList[5].variant[0].id,
        productList[5].variant[0].batches[0].batchId,
        [
            { packagingLevelId: "cet-box", quantity: 8 },
            { packagingLevelId: "cet-tablet", quantity: 24 }
        ],
        "inventory-cetirizine-cet-1001"
    ),

    // Omeprazole
    createInventory(
        productList[6].id,
        productList[6].variant[0].id,
        productList[6].variant[0].batches[0].batchId,
        [
            { packagingLevelId: "ome-box", quantity: 5 },
            { packagingLevelId: "ome-capsule", quantity: 16 }
        ],
        "inventory-omeprazole-ome-1001"
    ),

    // Metformin
    createInventory(
        productList[7].id,
        productList[7].variant[0].id,
        productList[7].variant[0].batches[0].batchId,
        [
            { packagingLevelId: "met-box", quantity: 7 },
            { packagingLevelId: "met-tablet", quantity: 20 }
        ],
        "inventory-metformin-met-1001"
    ),

    // Oral Rehydration Salts
    createInventory(
        productList[8].id,
        productList[8].variant[0].id,
        productList[8].variant[0].batches[0].batchId,
        [
            { packagingLevelId: "ors-sachet", quantity: 30 }
        ],
        "inventory-ors-ors-1001"
    ),

    // Amlodipine
    createInventory(
        productList[9].id,
        productList[9].variant[0].id,
        productList[9].variant[0].batches[0].batchId,
        [
            { packagingLevelId: "aml-box", quantity: 4 },
            { packagingLevelId: "aml-tablet", quantity: 12 }
        ],
        "inventory-amlodipine-aml-1001"
    ),

    // Ibuprofen 200mg - Batch IB-1002
    createInventory(
        productList[4].id,
        productList[4].variant[0].id,
        productList[4].variant[0].batches[1].batchId,
        [
            { packagingLevelId: "ib-carton", quantity: 1 },
            { packagingLevelId: "ib-pack", quantity: 8 },
            { packagingLevelId: "ib-tablet", quantity: 24 }
        ],
        "inventory-ibuprofen-ib-1002"
    ),

    // Ibuprofen 400mg - Batch IB4-1001
    createInventory(
        productList[4].id,
        productList[4].variant[1].id,
        productList[4].variant[1].batches[0].batchId,
        [
            { packagingLevelId: "ib400-carton", quantity: 2 },
            { packagingLevelId: "ib400-pack", quantity: 5 },
            { packagingLevelId: "ib400-tablet", quantity: 10 }
        ],
        "inventory-ibuprofen-ib4-1001"
    ),

    // Ibuprofen 400mg - Batch IB4-1002
    createInventory(
        productList[4].id,
        productList[4].variant[1].id,
        productList[4].variant[1].batches[1].batchId,
        [
            { packagingLevelId: "ib400-carton", quantity: 1 },
            { packagingLevelId: "ib400-pack", quantity: 7 },
            { packagingLevelId: "ib400-tablet", quantity: 14 }
        ],
        "inventory-ibuprofen-ib4-1002"
    ),

    // Cetirizine 10mg - Batch CET-1002
    createInventory(
        productList[5].id,
        productList[5].variant[0].id,
        productList[5].variant[0].batches[1].batchId,
        [
            { packagingLevelId: "cet-box", quantity: 6 },
            { packagingLevelId: "cet-tablet", quantity: 18 }
        ],
        "inventory-cetirizine-cet-1002"
    ),

    // Cetirizine solution - Batch CET-S-1001
    createInventory(
        productList[5].id,
        productList[5].variant[1].id,
        productList[5].variant[1].batches[0].batchId,
        [
            { packagingLevelId: "cet-s-bottle", quantity: 12 }
        ],
        "inventory-cetirizine-cet-s-1001"
    ),

    // Cetirizine solution - Batch CET-S-1002
    createInventory(
        productList[5].id,
        productList[5].variant[1].id,
        productList[5].variant[1].batches[1].batchId,
        [
            { packagingLevelId: "cet-s-bottle", quantity: 9 }
        ],
        "inventory-cetirizine-cet-s-1002"
    ),

    // Omeprazole 20mg - Batch OME-1002
    createInventory(
        productList[6].id,
        productList[6].variant[0].id,
        productList[6].variant[0].batches[1].batchId,
        [
            { packagingLevelId: "ome-box", quantity: 4 },
            { packagingLevelId: "ome-capsule", quantity: 20 }
        ],
        "inventory-omeprazole-ome-1002"
    ),

    // Omeprazole 40mg - Batch OME40-1001
    createInventory(
        productList[6].id,
        productList[6].variant[1].id,
        productList[6].variant[1].batches[0].batchId,
        [
            { packagingLevelId: "ome40-box", quantity: 3 },
            { packagingLevelId: "ome40-capsule", quantity: 12 }
        ],
        "inventory-omeprazole-ome40-1001"
    ),

    // Omeprazole 40mg - Batch OME40-1002
    createInventory(
        productList[6].id,
        productList[6].variant[1].id,
        productList[6].variant[1].batches[1].batchId,
        [
            { packagingLevelId: "ome40-box", quantity: 6 },
            { packagingLevelId: "ome40-capsule", quantity: 15 }
        ],
        "inventory-omeprazole-ome40-1002"
    ),

    // Metformin 500mg - Batch MET-1002
    createInventory(
        productList[7].id,
        productList[7].variant[0].id,
        productList[7].variant[0].batches[1].batchId,
        [
            { packagingLevelId: "met-box", quantity: 5 },
            { packagingLevelId: "met-tablet", quantity: 25 }
        ],
        "inventory-metformin-met-1002"
    ),

    // Metformin 850mg - Batch MET850-1001
    createInventory(
        productList[7].id,
        productList[7].variant[1].id,
        productList[7].variant[1].batches[0].batchId,
        [
            { packagingLevelId: "met850-box", quantity: 4 },
            { packagingLevelId: "met850-tablet", quantity: 16 }
        ],
        "inventory-metformin-met850-1001"
    ),

    // Metformin 850mg - Batch MET850-1002
    createInventory(
        productList[7].id,
        productList[7].variant[1].id,
        productList[7].variant[1].batches[1].batchId,
        [
            { packagingLevelId: "met850-box", quantity: 8 },
            { packagingLevelId: "met850-tablet", quantity: 22 }
        ],
        "inventory-metformin-met850-1002"
    ),

    // Oral Rehydration Salts - Batch ORS-1002
    createInventory(
        productList[8].id,
        productList[8].variant[0].id,
        productList[8].variant[0].batches[1].batchId,
        [
            { packagingLevelId: "ors-sachet", quantity: 24 }
        ],
        "inventory-ors-ors-1002"
    ),

    // Orange Oral Rehydration Salts - Batch ORS-O-1001
    createInventory(
        productList[8].id,
        productList[8].variant[1].id,
        productList[8].variant[1].batches[0].batchId,
        [
            { packagingLevelId: "ors-orange-sachet", quantity: 32 }
        ],
        "inventory-ors-ors-o-1001"
    ),

    // Orange Oral Rehydration Salts - Batch ORS-O-1002
    createInventory(
        productList[8].id,
        productList[8].variant[1].id,
        productList[8].variant[1].batches[1].batchId,
        [
            { packagingLevelId: "ors-orange-sachet", quantity: 27 }
        ],
        "inventory-ors-ors-o-1002"
    ),

    // Amlodipine 5mg - Batch AML-1002
    createInventory(
        productList[9].id,
        productList[9].variant[0].id,
        productList[9].variant[0].batches[1].batchId,
        [
            { packagingLevelId: "aml-box", quantity: 5 },
            { packagingLevelId: "aml-tablet", quantity: 15 }
        ],
        "inventory-amlodipine-aml-1002"
    ),

    // Amlodipine 10mg - Batch AML10-1001
    createInventory(
        productList[9].id,
        productList[9].variant[1].id,
        productList[9].variant[1].batches[0].batchId,
        [
            { packagingLevelId: "aml10-box", quantity: 3 },
            { packagingLevelId: "aml10-tablet", quantity: 18 }
        ],
        "inventory-amlodipine-aml10-1001"
    ),

    // Amlodipine 10mg - Batch AML10-1002
    createInventory(
        productList[9].id,
        productList[9].variant[1].id,
        productList[9].variant[1].batches[1].batchId,
        [
            { packagingLevelId: "aml10-box", quantity: 6 },
            { packagingLevelId: "aml10-tablet", quantity: 20 }
        ],
        "inventory-amlodipine-aml10-1002"
    )

];
