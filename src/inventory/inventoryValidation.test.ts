import { describe, it, expect } from "vitest";

import type { productStructure } from "../products/productStructure.ts";
import type { inventory } from "./inventoryStock.ts";
import type { inventoryBatch } from "./inventoryBatch.ts";

import { validateBatchPricingCollection } from "./inventoryBatch.ts";
import { validateInventoryRelationships } from "./inventoryValidation.ts";

// 1. Create test product data
const product: productStructure = {
    id: "PROD001",
    name: "Panadol",

    variant: [
        {
            id: "VAR001",
            variantName: "Panadol 500mg Tablets",

            packagingHierarchy: [
                {
                    id: "BOX001",
                    name: "Box",
                    costPrice: 40000,
                    sellingPrice: 45000,
                    quantityofNextLevel: 5,
                    nextLevelId: "PACK001"
                },
                {
                    id: "PACK001",
                    name: "Pack",
                    costPrice: null,
                    sellingPrice: 15000,
                    quantityofNextLevel: 6,
                    nextLevelId: "CARD001"
                },
                {
                    id: "CARD001",
                    name: "Card",
                    costPrice: 4800,
                    sellingPrice: 5000,
                    quantityofNextLevel: null,
                    nextLevelId: null
                }
            ]
        },

        {
            id: "VAR002",
            variantName: "Panadol Syrup",

            packagingHierarchy: [
                {
                    id: "BOTTLE001",
                    name: "Bottle",
                    costPrice: 1000,
                    sellingPrice: 1500,
                    quantityofNextLevel: null,
                    nextLevelId: null
                }
            ]
        }
    ]
};

const batches: inventoryBatch[] = [
    {
        batchId: "BATCH001",
        productId: "PROD001",
        variantId: "VAR001",
        batchNumber: "B1-1001",
        expiryDate: new Date("2027-12-31"),
        pricingByPackagingLevel: []
    },
    {
        batchId: "BATCH002",
        productId: "PROD001",
        variantId: "VAR002",
        batchNumber: "S1-1001",
        expiryDate: new Date("2027-10-31"),
        pricingByPackagingLevel: []
    }
];

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
            validateInventoryRelationships(product, validInventory, batches);
        }).not.toThrow();

    });


    it("should reject an inventory record belonging to another product", () => {

        const invalidInventory = {
            ...validInventory,
            productId: "PROD999"
        };

        expect(() => {
            validateInventoryRelationships(product, invalidInventory, batches);
        }).toThrow("The inventory record doesn't belong to this product");

    });


    it("should reject a variant that doesn't belong to the product", () => {

        const invalidInventory = {
            ...validInventory,
            variantId: "VAR999"
        };

        expect(() => {
            validateInventoryRelationships(product, invalidInventory, batches);
        }).toThrow("Variant does not belong to this product.");

    });


    it("should reject a batch that doesn't belong to the selected variant", () => {

        const invalidInventory = {
            ...validInventory,
            batchId: "BATCH999"
        };

        expect(() => {
            validateInventoryRelationships(product, invalidInventory, batches);
        }).toThrow("Batch does not belong to this variant.");

    });

    it("should reject a batch record that belongs to another variant", () => {
        const invalidInventory = {
            ...validInventory,
            batchId: "BATCH002"
        };

        expect(() => {
            validateInventoryRelationships(product, invalidInventory, batches);
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
            validateInventoryRelationships(product, invalidInventory, batches);
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
            validateInventoryRelationships(product, invalidInventory, batches);
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
            validateInventoryRelationships(product, invalidInventory, batches);
        }).toThrow();

    });

    it("should reject invalid packaging hierarchies even when stock references a known level", () => {
        const invalidProduct: productStructure = {
            ...product,
            variant: [{
                ...product.variant[0],
                packagingHierarchy: [
                    {
                        ...product.variant[0].packagingHierarchy[0],
                        nextLevelId: "BOX001"
                    },
                    ...product.variant[0].packagingHierarchy.slice(1)
                ]
            }]
        };

        expect(() =>
            validateInventoryRelationships(invalidProduct, validInventory, batches)
        ).toThrow();
    });

    it("rejects duplicate stock packaging references and unsafe quantities", () => {
        expect(() =>
            validateInventoryRelationships(product, {
                ...validInventory,
                stockQuantities: [
                    { packagingLevelId: "BOX001", quantity: 2 },
                    { packagingLevelId: "BOX001", quantity: 3 }
                ]
            }, batches)
        ).toThrow("Duplicate stock quantity");

        expect(() =>
            validateInventoryRelationships(product, {
                ...validInventory,
                stockQuantities: [{
                    packagingLevelId: "BOX001",
                    quantity: Number.MAX_SAFE_INTEGER + 1
                }]
            }, batches)
        ).toThrow("non-negative safe integers");
    });

    it("validates batch prices as nullable finite non-negative values", () => {
        expect(() => validateBatchPricingCollection([{
            packagingLevelId: "BOX001",
            costPrice: null,
            sellingPrice: 0
        }], ["BOX001"])).not.toThrow();

        for (const price of [-1, Number.POSITIVE_INFINITY, Number.NaN, "10", undefined]) {
            expect(() => validateBatchPricingCollection([{
                packagingLevelId: "BOX001",
                costPrice: price,
                sellingPrice: null
            }], ["BOX001"])).toThrow("Cost price");
        }
    });

    it.each(["costPrice", "sellingPrice"] as const)(
        "rejects batch %s with more than two decimal places",
        (priceField) => {
            expect(() => validateBatchPricingCollection([{
                packagingLevelId: "BOX001",
                costPrice: null,
                sellingPrice: null,
                [priceField]: 12.345
            }], ["BOX001"])).toThrow("at most two decimal places");
        }
    );

    it("rejects malformed, duplicate, and unknown batch pricing entries", () => {
        expect(() => validateBatchPricingCollection(null, ["BOX001"]))
            .toThrow("Batch pricing must be an array.");
        expect(() => validateBatchPricingCollection([null], ["BOX001"]))
            .toThrow("Batch pricing entries must be objects.");
        expect(() => validateBatchPricingCollection([{
            packagingLevelId: "BOX001",
            costPrice: null,
            sellingPrice: null,
            unexpected: true
        }], ["BOX001"])).toThrow("invalid packaging level");
        expect(() => validateBatchPricingCollection([
            { packagingLevelId: "BOX001", costPrice: null, sellingPrice: 2 },
            { packagingLevelId: "BOX001", costPrice: 1, sellingPrice: null }
        ], ["BOX001"])).toThrow("Duplicate batch pricing");
        expect(() => validateBatchPricingCollection([{
            packagingLevelId: "UNKNOWN001",
            costPrice: null,
            sellingPrice: 2
        }], ["BOX001"])).toThrow("invalid packaging level");
    });

    it("validates batch pricing against the inventory record's product variant", () => {
        const batchWithUnknownPricing = {
            ...batches[0],
            pricingByPackagingLevel: [{
                packagingLevelId: "BOTTLE001",
                costPrice: null,
                sellingPrice: 2
            }]
        };

        expect(() =>
            validateInventoryRelationships(
                product,
                validInventory,
                [batchWithUnknownPricing]
            )
        ).toThrow("invalid packaging level");
    });

});