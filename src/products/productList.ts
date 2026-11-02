
import type { productStructure } from "./productStructure";

export const products: productStructure = {
    id: crypto.randomUUID(),
    name: "Panadol",

    variant: [
        {
            id: crypto.randomUUID(),
            variantName: "Panadol 500mg Tablets",
            batches: [
                {
                    batchId: crypto.randomUUID(),
                    batchNumber: "B1-1001",
                    expiryDate: new Date("2027-03-31")
                },
                {
                    batchId: crypto.randomUUID(),
                    batchNumber: "B1-1002",
                    expiryDate: new Date("2027-06-30")
                }
            ],
            packagingHierarchy: [
                {
                    id: "box",
                    name: "Box",
                    costPrice: 40000,
                    sellingPrice: 45000,
                    quantityofNextLevel: 5,
                    nextLevel: "Pack"
                },
                {
                    id: "pack",
                    name: "Pack",
                    costPrice: null,
                    sellingPrice: 15000,
                    quantityofNextLevel: 6,
                    nextLevel: "Card"
                },
                {
                    id: "card",
                    name: "Card",
                    costPrice: 4800,
                    sellingPrice: 5000,
                    quantityofNextLevel: null,
                    nextLevel: null
                }
            ]
        },
        {
            id: crypto.randomUUID(),
            variantName: "Panadol Extra Tablets",
            batches: [
                {
                    batchId: crypto.randomUUID(),
                    batchNumber: "E1-1001",
                    expiryDate: new Date("2027-08-31")
                },
                {
                    batchId: crypto.randomUUID(),
                    batchNumber: "E1-1002",
                    expiryDate: new Date("2027-12-31")
                }
            ],
            packagingHierarchy: [
                {
                    id: "extra-box",
                    name: "Box",
                    costPrice: 50000,
                    sellingPrice: 55000,
                    quantityofNextLevel: 5,
                    nextLevel: "Pack"
                },
                {
                    id: "extra-pack",
                    name: "Pack",
                    costPrice: null,
                    sellingPrice: 18000,
                    quantityofNextLevel: 6,
                    nextLevel: "Card"
                },
                {
                    id: "extra-card",
                    name: "Card",
                    costPrice: 5500,
                    sellingPrice: 6000,
                    quantityofNextLevel: null,
                    nextLevel: null
                }
            ]
        },
        {
            id: crypto.randomUUID(),
            variantName: "Panadol Syrup",
            batches: [
                {
                    batchId: crypto.randomUUID(),
                    batchNumber: null,
                    expiryDate: new Date("2027-09-30")
                }
            ],
            packagingHierarchy: [
                {
                    id: "bottle",
                    name: "Bottle",
                    costPrice: 1200,
                    sellingPrice: 1500,
                    quantityofNextLevel: null,
                    nextLevel: null
                }
            ]
        }
    ]
};

const amoxicillin: productStructure = {
    id: crypto.randomUUID(),
    name: "Amoxicillin",
    variant: [
        {
            id: crypto.randomUUID(),
            variantName: "Amoxicillin 500mg Capsules",
            batches: [
                {
                    batchId: crypto.randomUUID(),
                    batchNumber: "AM-1001",
                    expiryDate: new Date("2027-05-31")
                }
            ],
            packagingHierarchy: [
                {
                    id: "am-carton",
                    name: "Carton",
                    costPrice: 60000,
                    sellingPrice: 70000,
                    quantityofNextLevel: 10,
                    nextLevel: "Box"
                },
                {
                    id: "am-box",
                    name: "Box",
                    costPrice: 6000,
                    sellingPrice: 7500,
                    quantityofNextLevel: 10,
                    nextLevel: "Capsule"
                },
                {
                    id: "am-capsule",
                    name: "Capsule",
                    costPrice: 600,
                    sellingPrice: 800,
                    quantityofNextLevel: null,
                    nextLevel: null
                }
            ]
        },
        {
            id: crypto.randomUUID(),
            variantName: "Amoxicillin Suspension",
            batches: [
                {
                    batchId: crypto.randomUUID(),
                    batchNumber: "AM-1002",
                    expiryDate: new Date("2027-07-31")
                }
            ],
            packagingHierarchy: [
                {
                    id: "am-suspension-bottle",
                    name: "Bottle",
                    costPrice: 1800,
                    sellingPrice: 2200,
                    quantityofNextLevel: null,
                    nextLevel: null
                }
            ]
        }
    ]
};

const vitaminC: productStructure = {
    id: crypto.randomUUID(),
    name: "Vitamin C",
    variant: [
        {
            id: crypto.randomUUID(),
            variantName: "Vitamin C 100mg Tablets",
            batches: [
                {
                    batchId: crypto.randomUUID(),
                    batchNumber: "VC-1001",
                    expiryDate: new Date("2028-01-31")
                }
            ],
            packagingHierarchy: [
                {
                    id: "vc-tube",
                    name: "Tube",
                    costPrice: 1500,
                    sellingPrice: 2000,
                    quantityofNextLevel: 10,
                    nextLevel: "Tablet"
                },
                {
                    id: "vc-tablet",
                    name: "Tablet",
                    costPrice: 150,
                    sellingPrice: 200,
                    quantityofNextLevel: null,
                    nextLevel: null
                }
            ]
        }
    ]
};

const paracetamol: productStructure = {
    id: crypto.randomUUID(),
    name: "Paracetamol",
    variant: [
        {
            id: crypto.randomUUID(),
            variantName: "Paracetamol 500mg Tablets",
            batches: [
                {
                    batchId: crypto.randomUUID(),
                    batchNumber: "PAR-1001",
                    expiryDate: new Date("2027-11-30")
                }
            ],
            packagingHierarchy: [
                {
                    id: "par-carton",
                    name: "Carton",
                    costPrice: 40000,
                    sellingPrice: 48000,
                    quantityofNextLevel: 20,
                    nextLevel: "Pack"
                },
                {
                    id: "par-pack",
                    name: "Pack",
                    costPrice: 2000,
                    sellingPrice: 2500,
                    quantityofNextLevel: 10,
                    nextLevel: "Card"
                },
                {
                    id: "par-card",
                    name: "Card",
                    costPrice: 200,
                    sellingPrice: 300,
                    quantityofNextLevel: null,
                    nextLevel: null
                }
            ]
        }
    ]
};

// All demo products
export const productList: productStructure[] = [
    products,
    amoxicillin,
    vitaminC,
    paracetamol
];
