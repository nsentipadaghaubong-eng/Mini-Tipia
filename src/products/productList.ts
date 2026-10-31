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