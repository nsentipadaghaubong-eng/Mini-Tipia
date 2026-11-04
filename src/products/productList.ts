
import type { productStructure } from "./productStructure";

export const products: productStructure = {
    id: "product-panadol",
    name: "Panadol",

    variant: [
        {
            id: "variant-panadol-500mg-tablets",
            variantName: "Panadol 500mg Tablets",
            batches: [
                {
                    batchId: "batch-panadol-b1-1001",
                    batchNumber: "B1-1001",
                    expiryDate: new Date("2027-03-31")
                },
                {
                    batchId: "batch-panadol-b1-1002",
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
            id: "variant-panadol-extra-tablets",
            variantName: "Panadol Extra Tablets",
            batches: [
                {
                    batchId: "batch-panadol-e1-1001",
                    batchNumber: "E1-1001",
                    expiryDate: new Date("2027-08-31")
                },
                {
                    batchId: "batch-panadol-e1-1002",
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
            id: "variant-panadol-syrup",
            variantName: "Panadol Syrup",
            batches: [
                {
                    batchId: "batch-panadol-syrup-001",
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
    id: "product-amoxicillin",
    name: "Amoxicillin",
    variant: [
        {
            id: "variant-amoxicillin-500mg-capsules",
            variantName: "Amoxicillin 500mg Capsules",
            batches: [
                {
                    batchId: "batch-amoxicillin-am-1001",
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
            id: "variant-amoxicillin-suspension",
            variantName: "Amoxicillin Suspension",
            batches: [
                {
                    batchId: "batch-amoxicillin-am-1002",
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
    id: "product-vitamin-c",
    name: "Vitamin C",
    variant: [
        {
            id: "variant-vitamin-c-100mg-tablets",
            variantName: "Vitamin C 100mg Tablets",
            batches: [
                {
                    batchId: "batch-vitamin-c-vc-1001",
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
    id: "product-paracetamol",
    name: "Paracetamol",
    variant: [
        {
            id: "variant-paracetamol-500mg-tablets",
            variantName: "Paracetamol 500mg Tablets",
            batches: [
                {
                    batchId: "batch-paracetamol-par-1001",
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

const ibuprofen: productStructure = {
    id: "product-ibuprofen",
    name: "Ibuprofen",
    variant: [
        {
            id: "variant-ibuprofen-200mg-tablets",
            variantName: "Ibuprofen 200mg Tablets",
            batches: [
                {
                    batchId: "batch-ibuprofen-ib-1001",
                    batchNumber: "IB-1001",
                    expiryDate: new Date("2028-04-30")
                },
                {
                    batchId: "batch-ibuprofen-ib-1002",
                    batchNumber: "IB-1002",
                    expiryDate: new Date("2028-09-30")
                }
            ],
            packagingHierarchy: [
                {
                    id: "ib-carton",
                    name: "Carton",
                    costPrice: 45000,
                    sellingPrice: 50000,
                    quantityofNextLevel: 20,
                    nextLevel: "Pack"
                },
                {
                    id: "ib-pack",
                    name: "Pack",
                    costPrice: 2250,
                    sellingPrice: 2500,
                    quantityofNextLevel: 10,
                    nextLevel: "Tablet"
                },
                {
                    id: "ib-tablet",
                    name: "Tablet",
                    costPrice: 225,
                    sellingPrice: 300,
                    quantityofNextLevel: null,
                    nextLevel: null
                }
            ]
        },
        {
            id: "variant-ibuprofen-400mg-tablets",
            variantName: "Ibuprofen 400mg Tablets",
            batches: [
                {
                    batchId: "batch-ibuprofen-ib4-1001",
                    batchNumber: "IB4-1001",
                    expiryDate: new Date("2028-07-31")
                },
                {
                    batchId: "batch-ibuprofen-ib4-1002",
                    batchNumber: "IB4-1002",
                    expiryDate: new Date("2029-01-31")
                }
            ],
            packagingHierarchy: [
                {
                    id: "ib400-carton",
                    name: "Carton",
                    costPrice: 60000,
                    sellingPrice: 68000,
                    quantityofNextLevel: 20,
                    nextLevel: "Pack"
                },
                {
                    id: "ib400-pack",
                    name: "Pack",
                    costPrice: 3000,
                    sellingPrice: 3400,
                    quantityofNextLevel: 10,
                    nextLevel: "Tablet"
                },
                {
                    id: "ib400-tablet",
                    name: "Tablet",
                    costPrice: 300,
                    sellingPrice: 350,
                    quantityofNextLevel: null,
                    nextLevel: null
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
            batches: [
                {
                    batchId: "batch-cetirizine-cet-1001",
                    batchNumber: "CET-1001",
                    expiryDate: new Date("2028-06-30")
                },
                {
                    batchId: "batch-cetirizine-cet-1002",
                    batchNumber: "CET-1002",
                    expiryDate: new Date("2028-11-30")
                }
            ],
            packagingHierarchy: [
                {
                    id: "cet-box",
                    name: "Box",
                    costPrice: 12000,
                    sellingPrice: 15000,
                    quantityofNextLevel: 10,
                    nextLevel: "Tablet"
                },
                {
                    id: "cet-tablet",
                    name: "Tablet",
                    costPrice: 1200,
                    sellingPrice: 1500,
                    quantityofNextLevel: null,
                    nextLevel: null
                }
            ]
        },
        {
            id: "variant-cetirizine-5mg-5ml-solution",
            variantName: "Cetirizine 5mg/5mL Oral Solution",
            batches: [
                {
                    batchId: "batch-cetirizine-cet-s-1001",
                    batchNumber: "CET-S-1001",
                    expiryDate: new Date("2028-08-31")
                },
                {
                    batchId: "batch-cetirizine-cet-s-1002",
                    batchNumber: "CET-S-1002",
                    expiryDate: new Date("2029-02-28")
                }
            ],
            packagingHierarchy: [
                {
                    id: "cet-s-bottle",
                    name: "Bottle",
                    costPrice: 3500,
                    sellingPrice: 4200,
                    quantityofNextLevel: null,
                    nextLevel: null
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
            batches: [
                {
                    batchId: "batch-omeprazole-ome-1001",
                    batchNumber: "OME-1001",
                    expiryDate: new Date("2028-08-31")
                },
                {
                    batchId: "batch-omeprazole-ome-1002",
                    batchNumber: "OME-1002",
                    expiryDate: new Date("2029-02-28")
                }
            ],
            packagingHierarchy: [
                {
                    id: "ome-box",
                    name: "Box",
                    costPrice: 18000,
                    sellingPrice: 22000,
                    quantityofNextLevel: 10,
                    nextLevel: "Capsule"
                },
                {
                    id: "ome-capsule",
                    name: "Capsule",
                    costPrice: 1800,
                    sellingPrice: 2200,
                    quantityofNextLevel: null,
                    nextLevel: null
                }
            ]
        },
        {
            id: "variant-omeprazole-40mg-capsules",
            variantName: "Omeprazole 40mg Capsules",
            batches: [
                {
                    batchId: "batch-omeprazole-ome40-1001",
                    batchNumber: "OME40-1001",
                    expiryDate: new Date("2028-10-31")
                },
                {
                    batchId: "batch-omeprazole-ome40-1002",
                    batchNumber: "OME40-1002",
                    expiryDate: new Date("2029-04-30")
                }
            ],
            packagingHierarchy: [
                {
                    id: "ome40-box",
                    name: "Box",
                    costPrice: 30000,
                    sellingPrice: 36000,
                    quantityofNextLevel: 10,
                    nextLevel: "Capsule"
                },
                {
                    id: "ome40-capsule",
                    name: "Capsule",
                    costPrice: 3000,
                    sellingPrice: 3600,
                    quantityofNextLevel: null,
                    nextLevel: null
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
            batches: [
                {
                    batchId: "batch-metformin-met-1001",
                    batchNumber: "MET-1001",
                    expiryDate: new Date("2028-10-31")
                },
                {
                    batchId: "batch-metformin-met-1002",
                    batchNumber: "MET-1002",
                    expiryDate: new Date("2029-04-30")
                }
            ],
            packagingHierarchy: [
                {
                    id: "met-box",
                    name: "Box",
                    costPrice: 15000,
                    sellingPrice: 18000,
                    quantityofNextLevel: 10,
                    nextLevel: "Tablet"
                },
                {
                    id: "met-tablet",
                    name: "Tablet",
                    costPrice: 1500,
                    sellingPrice: 1800,
                    quantityofNextLevel: null,
                    nextLevel: null
                }
            ]
        },
        {
            id: "variant-metformin-850mg-tablets",
            variantName: "Metformin 850mg Tablets",
            batches: [
                {
                    batchId: "batch-metformin-met850-1001",
                    batchNumber: "MET850-1001",
                    expiryDate: new Date("2028-12-31")
                },
                {
                    batchId: "batch-metformin-met850-1002",
                    batchNumber: "MET850-1002",
                    expiryDate: new Date("2029-06-30")
                }
            ],
            packagingHierarchy: [
                {
                    id: "met850-box",
                    name: "Box",
                    costPrice: 20000,
                    sellingPrice: 24000,
                    quantityofNextLevel: 10,
                    nextLevel: "Tablet"
                },
                {
                    id: "met850-tablet",
                    name: "Tablet",
                    costPrice: 2000,
                    sellingPrice: 2400,
                    quantityofNextLevel: null,
                    nextLevel: null
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
            batches: [
                {
                    batchId: "batch-ors-ors-1001",
                    batchNumber: "ORS-1001",
                    expiryDate: new Date("2028-12-31")
                },
                {
                    batchId: "batch-ors-ors-1002",
                    batchNumber: "ORS-1002",
                    expiryDate: new Date("2029-06-30")
                }
            ],
            packagingHierarchy: [
                {
                    id: "ors-sachet",
                    name: "Sachet",
                    costPrice: 500,
                    sellingPrice: 700,
                    quantityofNextLevel: null,
                    nextLevel: null
                }
            ]
        },
        {
            id: "variant-ors-orange-sachets",
            variantName: "Orange Oral Rehydration Salts Sachets",
            batches: [
                {
                    batchId: "batch-ors-ors-o-1001",
                    batchNumber: "ORS-O-1001",
                    expiryDate: new Date("2029-01-31")
                },
                {
                    batchId: "batch-ors-ors-o-1002",
                    batchNumber: "ORS-O-1002",
                    expiryDate: new Date("2029-07-31")
                }
            ],
            packagingHierarchy: [
                {
                    id: "ors-orange-sachet",
                    name: "Sachet",
                    costPrice: 600,
                    sellingPrice: 800,
                    quantityofNextLevel: null,
                    nextLevel: null
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
            batches: [
                {
                    batchId: "batch-amlodipine-aml-1001",
                    batchNumber: "AML-1001",
                    expiryDate: new Date("2029-01-31")
                },
                {
                    batchId: "batch-amlodipine-aml-1002",
                    batchNumber: "AML-1002",
                    expiryDate: new Date("2029-07-31")
                }
            ],
            packagingHierarchy: [
                {
                    id: "aml-box",
                    name: "Box",
                    costPrice: 10000,
                    sellingPrice: 12500,
                    quantityofNextLevel: 10,
                    nextLevel: "Tablet"
                },
                {
                    id: "aml-tablet",
                    name: "Tablet",
                    costPrice: 1000,
                    sellingPrice: 1250,
                    quantityofNextLevel: null,
                    nextLevel: null
                }
            ]
        },
        {
            id: "variant-amlodipine-10mg-tablets",
            variantName: "Amlodipine 10mg Tablets",
            batches: [
                {
                    batchId: "batch-amlodipine-aml10-1001",
                    batchNumber: "AML10-1001",
                    expiryDate: new Date("2029-03-31")
                },
                {
                    batchId: "batch-amlodipine-aml10-1002",
                    batchNumber: "AML10-1002",
                    expiryDate: new Date("2029-09-30")
                }
            ],
            packagingHierarchy: [
                {
                    id: "aml10-box",
                    name: "Box",
                    costPrice: 16000,
                    sellingPrice: 20000,
                    quantityofNextLevel: 10,
                    nextLevel: "Tablet"
                },
                {
                    id: "aml10-tablet",
                    name: "Tablet",
                    costPrice: 1600,
                    sellingPrice: 2000,
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
    paracetamol,
    ibuprofen,
    cetirizine,
    omeprazole,
    metformin,
    oralRehydrationSalts,
    amlodipine
];
