import { describe, it, expect } from "vitest";

import type { productStructure } from "../products/productStructure.ts";
import type { inventory } from "./inventoryStock.ts";

import { validateInventoryRelationships } from "./inventoryValidation.ts";

// 1. Create test product data
const product: productStructure = {
    id: "PROD001",
    name: "Panadol",

    variant: [
        {
            id: "VAR001",
            variantName: "Panadol 500mg Tablets",

            batches: [
                {
                    batchId: "BATCH001",
                    batchNumber: "B1-1001",
                    expiryDate: new Date("2027-12-31")
                }
            ],

            packagingHierarchy: [
                {
                    id: "BOX001",
                    name: "Box",
                    costPrice: 40000,
                    sellingPrice: 45000,
                    quantityofNextLevel: 5,
                    nextLevel: "PACK001"
                },
                {
                    id: "PACK001",
                    name: "Pack",
                    costPrice: null,
                    sellingPrice: 15000,
                    quantityofNextLevel: 6,
                    nextLevel: "CARD001"
                },
                {
                    id: "CARD001",
                    name: "Card",
                    costPrice: 4800,
                    sellingPrice: 5000,
                    quantityofNextLevel: null,
                    nextLevel: null
                }
            ]
        },

        {
            id: "VAR002",
            variantName: "Panadol Syrup",

            batches: [
                {
                    batchId: "BATCH002",
                    batchNumber: "S1-1001",
                    expiryDate: new Date("2027-10-31")
                }
            ],

            packagingHierarchy: [
                {
                    id: "BOTTLE001",
                    name: "Bottle",
                    costPrice: 1000,
                    sellingPrice: 1500,
                    quantityofNextLevel: null,
                    nextLevel: null
                }
            ]
        }
    ]
};


// 2. Create a valid inventory record
const validInventory: inventory = {
    id: "INV001",
    productId: "PROD001",
    variantId: "VAR001",
    batchId: "BATCH001",

    stockQuantities: [
        { packagingLevelId: "BOX001", quantity: 2 },
        { packagingLevelId: "PACK001", quantity: 3 },
        { packagingLevelId: "CARD001", quantity: 10 }
    ]
};


// 3. Write the tests
describe("validateInventoryRelationships", () => {

    it("should pass when all relationships are valid", () => {

        expect(() => {
            validateInventoryRelationships(product, validInventory);
        }).not.toThrow();

    });


    it("should reject an inventory record belonging to another product", () => {

        const invalidInventory = {
            ...validInventory,
            productId: "PROD999"
        };

        expect(() => {
            validateInventoryRelationships(product, invalidInventory);
        }).toThrow("The inventory record doesn't belong to this product");

    });


    it("should reject a variant that doesn't belong to the product", () => {

        const invalidInventory = {
            ...validInventory,
            variantId: "VAR999"
        };

        expect(() => {
            validateInventoryRelationships(product, invalidInventory);
        }).toThrow("Variant does not belong to this product.");

    });


    it("should reject a batch that doesn't belong to the selected variant", () => {

        const invalidInventory = {
            ...validInventory,
            batchId: "BATCH999"
        };

        expect(() => {
            validateInventoryRelationships(product, invalidInventory);
        }).toThrow("Batch does not belong to this variant.");

    });


    it("should reject a packaging level that doesn't exist in the variant", () => {

        const invalidInventory = {
            ...validInventory,
            stockQuantities: [
                ...validInventory.stockQuantities,
                { packagingLevelId: "UNKNOWN001", quantity: 5 }
            ]
        };

        expect(() => {
            validateInventoryRelationships(product, invalidInventory);
        }).toThrow("Packaging level does not belong to this variant.");

    });


    it("should reject packaging belonging to another variant", () => {

        const invalidInventory = {
            ...validInventory,
            stockQuantities: [
                { packagingLevelId: "BOX001", quantity: 2 },
                { packagingLevelId: "BOTTLE001", quantity: 5 }
            ]
        };

        expect(() => {
            validateInventoryRelationships(product, invalidInventory);
        }).toThrow("Packaging level does not belong to this variant.");

    });


    it("should reject the entire inventory if even one packaging level is invalid", () => {

        const invalidInventory = {
            ...validInventory,
            stockQuantities: [
                { packagingLevelId: "BOX001", quantity: 2 },
                { packagingLevelId: "PACK001", quantity: 3 },
                { packagingLevelId: "UNKNOWN001", quantity: 10 }
            ]
        };

        expect(() => {
            validateInventoryRelationships(product, invalidInventory);
        }).toThrow();

    });

});