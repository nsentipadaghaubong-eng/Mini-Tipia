
import type { productStructure } from "./productStructure";

export const products: productStructure = {
    id: "product-panadol",
    name: "Panadol",

    variant: [
        {
            id: "variant-panadol-500mg-tablets",
            variantName: "Panadol 500mg Tablets",
            lowStockThreshold: {
                quantity: 6,
                packagingLevelId: "box"
            },
            packagingHierarchy: [
                {
                    id: "box",
                    name: "Box",
                    costPrice: 40000,
                    sellingPrice: 45000,
                    quantityofNextLevel: 5,
                    nextLevelId: "pack"
                },
                {
                    id: "pack",
                    name: "Pack",
                    costPrice: null,
                    sellingPrice: 15000,
                    quantityofNextLevel: 6,
                    nextLevelId: "card"
                },
                {
                    id: "card",
                    name: "Card",
                    costPrice: 4800,
                    sellingPrice: 5000,
                    quantityofNextLevel: null,
                    nextLevelId: null
                }
            ]
        },
        {
            id: "variant-panadol-extra-tablets",
            variantName: "Panadol Extra Tablets",
            lowStockThreshold: {
                quantity: 26,
                packagingLevelId: "extra-pack"
            },
            packagingHierarchy: [
                {
                    id: "extra-box",
                    name: "Box",
                    costPrice: 50000,
                    sellingPrice: 55000,
                    quantityofNextLevel: 5,
                    nextLevelId: "extra-pack"
                },
                {
                    id: "extra-pack",
                    name: "Pack",
                    costPrice: null,
                    sellingPrice: 18000,
                    quantityofNextLevel: 6,
                    nextLevelId: "extra-card"
                },
                {
                    id: "extra-card",
                    name: "Card",
                    costPrice: 5500,
                    sellingPrice: 6000,
                    quantityofNextLevel: null,
                    nextLevelId: null
                }
            ]
        },
        {
            id: "variant-panadol-syrup",
            variantName: "Panadol Syrup",
            lowStockThreshold: {
                quantity: 16,
                packagingLevelId: "bottle"
            },
            packagingHierarchy: [
                {
                    id: "bottle",
                    name: "Bottle",
                    costPrice: 1200,
                    sellingPrice: 1500,
                    quantityofNextLevel: null,
                    nextLevelId: null
                }
            ]
        }
    ]
};

const amoxicillin: productStructure = {
    id: "product-amoxicillin",
    name: "Amoxicillin",
    variant: [
        {
            id: "variant-amoxicillin-500mg-capsules",
            variantName: "Amoxicillin 500mg Capsules",
            lowStockThreshold: {
                quantity: 3,
                packagingLevelId: "am-carton"
            },
            packagingHierarchy: [
                {
                    id: "am-carton",
                    name: "Carton",
                    costPrice: 60000,
                    sellingPrice: 70000,
                    quantityofNextLevel: 10,
                    nextLevelId: "am-box"
                },
                {
                    id: "am-box",
                    name: "Box",
                    costPrice: 6000,
                    sellingPrice: 7500,
                    quantityofNextLevel: 10,
                    nextLevelId: "am-capsule"
                },
                {
                    id: "am-capsule",
                    name: "Capsule",
                    costPrice: 600,
                    sellingPrice: 800,
                    quantityofNextLevel: null,
                    nextLevelId: null
                }
            ]
        },
        {
            id: "variant-amoxicillin-suspension",
            variantName: "Amoxicillin Suspension",
            lowStockThreshold: {
                quantity: 7,
                packagingLevelId: "am-suspension-bottle"
            },
            packagingHierarchy: [
                {
                    id: "am-suspension-bottle",
                    name: "Bottle",
                    costPrice: 1800,
                    sellingPrice: 2200,
                    quantityofNextLevel: null,
                    nextLevelId: null
                }
            ]
        }
    ]
};

const vitaminC: productStructure = {
    id: "product-vitamin-c",
    name: "Vitamin C",
    variant: [
        {
            id: "variant-vitamin-c-100mg-tablets",
            variantName: "Vitamin C 100mg Tablets",
            lowStockThreshold: {
                quantity: 5,
                packagingLevelId: "vc-tube"
            },
            packagingHierarchy: [
                {
                    id: "vc-tube",
                    name: "Tube",
                    costPrice: 1500,
                    sellingPrice: 2000,
                    quantityofNextLevel: 10,
                    nextLevelId: "vc-tablet"
                },
                {
                    id: "vc-tablet",
                    name: "Tablet",
                    costPrice: 150,
                    sellingPrice: 200,
                    quantityofNextLevel: null,
                    nextLevelId: null
                }
            ]
        }
    ]
};

const paracetamol: productStructure = {
    id: "product-paracetamol",
    name: "Paracetamol",
    variant: [
        {
            id: "variant-paracetamol-500mg-tablets",
            variantName: "Paracetamol 500mg Tablets",
            lowStockThreshold: {
                quantity: 280,
                packagingLevelId: "par-card"
            },
            packagingHierarchy: [
                {
                    id: "par-carton",
                    name: "Carton",
                    costPrice: 40000,
                    sellingPrice: 48000,
                    quantityofNextLevel: 20,
                    nextLevelId: "par-pack"
                },
                {
                    id: "par-pack",
                    name: "Pack",
                    costPrice: 2000,
                    sellingPrice: 2500,
                    quantityofNextLevel: 10,
                    nextLevelId: "par-card"
                },
                {
                    id: "par-card",
                    name: "Card",
                    costPrice: 200,
                    sellingPrice: 300,
                    quantityofNextLevel: null,
                    nextLevelId: null
                }
            ]
        }
    ]
};

const ibuprofen: productStructure = {
    id: "product-ibuprofen",
    name: "Ibuprofen",
    variant: [
        {
            id: "variant-ibuprofen-200mg-tablets",
            variantName: "Ibuprofen 200mg Tablets",
            lowStockThreshold: {
                quantity: 77,
                packagingLevelId: "ib-pack"
            },
            packagingHierarchy: [
                {
                    id: "ib-carton",
                    name: "Carton",
                    costPrice: 45000,
                    sellingPrice: 50000,
                    quantityofNextLevel: 20,
                    nextLevelId: "ib-pack"
                },
                {
                    id: "ib-pack",
                    name: "Pack",
                    costPrice: 2250,
                    sellingPrice: 2500,
                    quantityofNextLevel: 10,
                    nextLevelId: "ib-tablet"
                },
                {
                    id: "ib-tablet",
                    name: "Tablet",
                    costPrice: 225,
                    sellingPrice: 300,
                    quantityofNextLevel: null,
                    nextLevelId: null
                }
            ]
        },
        {
            id: "variant-ibuprofen-400mg-tablets",
            variantName: "Ibuprofen 400mg Tablets",
            lowStockThreshold: {
                quantity: 750,
                packagingLevelId: "ib400-tablet"
            },
            packagingHierarchy: [
                {
                    id: "ib400-carton",
                    name: "Carton",
                    costPrice: 60000,
                    sellingPrice: 68000,
                    quantityofNextLevel: 20,
                    nextLevelId: "ib400-pack"
                },
                {
                    id: "ib400-pack",
                    name: "Pack",
                    costPrice: 3000,
                    sellingPrice: 3400,
                    quantityofNextLevel: 10,
                    nextLevelId: "ib400-tablet"
                },
                {
                    id: "ib400-tablet",
                    name: "Tablet",
                    costPrice: 300,
                    sellingPrice: 350,
                    quantityofNextLevel: null,
                    nextLevelId: null
                }
            ]
        }
    ]
};

const cetirizine: productStructure = {
    id: "product-cetirizine",
    name: "Cetirizine",
    variant: [
        {
            id: "variant-cetirizine-10mg-tablets",
            variantName: "Cetirizine 10mg Tablets",
            lowStockThreshold: {
                quantity: 19,
                packagingLevelId: "cet-box"
            },
            packagingHierarchy: [
                {
                    id: "cet-box",
                    name: "Box",
                    costPrice: 12000,
                    sellingPrice: 15000,
                    quantityofNextLevel: 10,
                    nextLevelId: "cet-tablet"
                },
                {
                    id: "cet-tablet",
                    name: "Tablet",
                    costPrice: 1200,
                    sellingPrice: 1500,
                    quantityofNextLevel: null,
                    nextLevelId: null
                }
            ]
        },
        {
            id: "variant-cetirizine-5mg-5ml-solution",
            variantName: "Cetirizine 5mg/5mL Oral Solution",
            lowStockThreshold: {
                quantity: 20,
                packagingLevelId: "cet-s-bottle"
            },
            packagingHierarchy: [
                {
                    id: "cet-s-bottle",
                    name: "Bottle",
                    costPrice: 3500,
                    sellingPrice: 4200,
                    quantityofNextLevel: null,
                    nextLevelId: null
                }
            ]
        }
    ]
};

const omeprazole: productStructure = {
    id: "product-omeprazole",
    name: "Omeprazole",
    variant: [
        {
            id: "variant-omeprazole-20mg-capsules",
            variantName: "Omeprazole 20mg Capsules",
            lowStockThreshold: {
                quantity: 13,
                packagingLevelId: "ome-box"
            },
            packagingHierarchy: [
                {
                    id: "ome-box",
                    name: "Box",
                    costPrice: 18000,
                    sellingPrice: 22000,
                    quantityofNextLevel: 10,
                    nextLevelId: "ome-capsule"
                },
                {
                    id: "ome-capsule",
                    name: "Capsule",
                    costPrice: 1800,
                    sellingPrice: 2200,
                    quantityofNextLevel: null,
                    nextLevelId: null
                }
            ]
        },
        {
            id: "variant-omeprazole-40mg-capsules",
            variantName: "Omeprazole 40mg Capsules",
            lowStockThreshold: {
                quantity: 110,
                packagingLevelId: "ome40-capsule"
            },
            packagingHierarchy: [
                {
                    id: "ome40-box",
                    name: "Box",
                    costPrice: 30000,
                    sellingPrice: 36000,
                    quantityofNextLevel: 10,
                    nextLevelId: "ome40-capsule"
                },
                {
                    id: "ome40-capsule",
                    name: "Capsule",
                    costPrice: 3000,
                    sellingPrice: 3600,
                    quantityofNextLevel: null,
                    nextLevelId: null
                }
            ]
        }
    ]
};

const metformin: productStructure = {
    id: "product-metformin",
    name: "Metformin",
    variant: [
        {
            id: "variant-metformin-500mg-tablets",
            variantName: "Metformin 500mg Tablets",
            lowStockThreshold: {
                quantity: 170,
                packagingLevelId: "met-tablet"
            },
            packagingHierarchy: [
                {
                    id: "met-box",
                    name: "Box",
                    costPrice: 15000,
                    sellingPrice: 18000,
                    quantityofNextLevel: 10,
                    nextLevelId: "met-tablet"
                },
                {
                    id: "met-tablet",
                    name: "Tablet",
                    costPrice: 1500,
                    sellingPrice: 1800,
                    quantityofNextLevel: null,
                    nextLevelId: null
                }
            ]
        },
        {
            id: "variant-metformin-850mg-tablets",
            variantName: "Metformin 850mg Tablets",
            lowStockThreshold: {
                quantity: 150,
                packagingLevelId: "met850-tablet"
            },
            packagingHierarchy: [
                {
                    id: "met850-box",
                    name: "Box",
                    costPrice: 20000,
                    sellingPrice: 24000,
                    quantityofNextLevel: 10,
                    nextLevelId: "met850-tablet"
                },
                {
                    id: "met850-tablet",
                    name: "Tablet",
                    costPrice: 2000,
                    sellingPrice: 2400,
                    quantityofNextLevel: null,
                    nextLevelId: null
                }
            ]
        }
    ]
};

const oralRehydrationSalts: productStructure = {
    id: "product-oral-rehydration-salts",
    name: "Oral Rehydration Salts",
    variant: [
        {
            id: "variant-ors-original-sachets",
            variantName: "Oral Rehydration Salts Sachets",
            lowStockThreshold: {
                quantity: 55,
                packagingLevelId: "ors-sachet"
            },
            packagingHierarchy: [
                {
                    id: "ors-sachet",
                    name: "Sachet",
                    costPrice: 500,
                    sellingPrice: 700,
                    quantityofNextLevel: null,
                    nextLevelId: null
                }
            ]
        },
        {
            id: "variant-ors-orange-sachets",
            variantName: "Orange Oral Rehydration Salts Sachets",
            lowStockThreshold: {
                quantity: 58,
                packagingLevelId: "ors-orange-sachet"
            },
            packagingHierarchy: [
                {
                    id: "ors-orange-sachet",
                    name: "Sachet",
                    costPrice: 600,
                    sellingPrice: 800,
                    quantityofNextLevel: null,
                    nextLevelId: null
                }
            ]
        }
    ]
};

const amlodipine: productStructure = {
    id: "product-amlodipine",
    name: "Amlodipine",
    variant: [
        {
            id: "variant-amlodipine-5mg-tablets",
            variantName: "Amlodipine 5mg Tablets",
            lowStockThreshold: {
                quantity: 120,
                packagingLevelId: "aml-tablet"
            },
            packagingHierarchy: [
                {
                    id: "aml-box",
                    name: "Box",
                    costPrice: 10000,
                    sellingPrice: 12500,
                    quantityofNextLevel: 10,
                    nextLevelId: "aml-tablet"
                },
                {
                    id: "aml-tablet",
                    name: "Tablet",
                    costPrice: 1000,
                    sellingPrice: 1250,
                    quantityofNextLevel: null,
                    nextLevelId: null
                }
            ]
        },
        {
            id: "variant-amlodipine-10mg-tablets",
            variantName: "Amlodipine 10mg Tablets",
            lowStockThreshold: {
                quantity: 12,
                packagingLevelId: "aml10-box"
            },
            packagingHierarchy: [
                {
                    id: "aml10-box",
                    name: "Box",
                    costPrice: 16000,
                    sellingPrice: 20000,
                    quantityofNextLevel: 10,
                    nextLevelId: "aml10-tablet"
                },
                {
                    id: "aml10-tablet",
                    name: "Tablet",
                    costPrice: 1600,
                    sellingPrice: 2000,
                    quantityofNextLevel: null,
                    nextLevelId: null
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
    paracetamol,
    ibuprofen,
    cetirizine,
    omeprazole,
    metformin,
    oralRehydrationSalts,
    amlodipine
];
