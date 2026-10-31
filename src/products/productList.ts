import type { productStructure, } from "./productStructure";

export const products: productStructure = {
    id: crypto.randomUUID(),
    name: "Panadol",
    variant: [
        {
            id: crypto.randomUUID(),
            variantName:"500mg",
            batches: [
                {
                    batchId:"batch-001",
                    batchNumber:"B1-1001",
                    expiryDate: new Date(),
                }
            ],
            //quantity:5,
            packagingHierarchy: [{
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
            },
            ]
        }
    ]

};
