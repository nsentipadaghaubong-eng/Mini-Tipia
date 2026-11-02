
import { describe, it, expect } from "vitest";

import type { productStructure } from "../products/productStructure.ts";

import {
    createInventory,
    addStock,
    removeStock,
    breakdownPackaging,
    buildUpPackaging,
    adjustStock,
    getStockQuantity
} from "./inventoryStock.ts";

import { validateInventoryRelationships } from "./inventoryValidation.ts";

// --------------------------------------------------
// 1. Test product data
// --------------------------------------------------

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
                    batchNumber: null,
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


// --------------------------------------------------
// 2. Helper for relationship validation
// --------------------------------------------------

function expectValidInventory(
    inventoryRecord: ReturnType<typeof createInventory>
): void {
    expect(() => {
        validateInventoryRelationships(product, inventoryRecord);
    }).not.toThrow();
}


// --------------------------------------------------
// 3. Integration tests
// --------------------------------------------------

describe("Inventory Stock and Relationship Integration", () => {

    // ----------------------------------------------
    // Test 1: Inventory creation
    // ----------------------------------------------

    it("should create inventory with valid product relationships", () => {

        const inventoryRecord = createInventory(
            product.id,
            product.variant[0].id,
            product.variant[0].batches[0].batchId,
            [
                { packagingLevelId: "BOX001", quantity: 2 },
                { packagingLevelId: "PACK001", quantity: 3 },
                { packagingLevelId: "CARD001", quantity: 10 }
            ]
        );

        expectValidInventory(inventoryRecord);

        expect(getStockQuantity(inventoryRecord, "BOX001")).toBe(2);
        expect(getStockQuantity(inventoryRecord, "PACK001")).toBe(3);
        expect(getStockQuantity(inventoryRecord, "CARD001")).toBe(10);
    });


    // ----------------------------------------------
    // Test 2: Adding stock
    // ----------------------------------------------

    it("should preserve valid relationships after adding stock", () => {

        const inventoryRecord = createInventory(
            product.id,
            product.variant[0].id,
            product.variant[0].batches[0].batchId,
            [
                { packagingLevelId: "BOX001", quantity: 2 },
                { packagingLevelId: "PACK001", quantity: 3 },
                { packagingLevelId: "CARD001", quantity: 10 }
            ]
        );

        const updatedInventory = addStock(
            inventoryRecord,
            "CARD001",
            5
        );

        expectValidInventory(updatedInventory);

        expect(getStockQuantity(updatedInventory, "CARD001")).toBe(15);

        // Original inventory must remain unchanged.
        expect(getStockQuantity(inventoryRecord, "CARD001")).toBe(10);
    });


    // ----------------------------------------------
    // Test 3: Removing stock
    // ----------------------------------------------

    it("should preserve valid relationships after removing stock", () => {

        const inventoryRecord = createInventory(
            product.id,
            product.variant[0].id,
            product.variant[0].batches[0].batchId,
            [
                { packagingLevelId: "BOX001", quantity: 2 },
                { packagingLevelId: "PACK001", quantity: 3 },
                { packagingLevelId: "CARD001", quantity: 10 }
            ]
        );

        const updatedInventory = removeStock(
            inventoryRecord,
            "CARD001",
            4
        );

        expectValidInventory(updatedInventory);

        expect(getStockQuantity(updatedInventory, "CARD001")).toBe(6);
    });


    // ----------------------------------------------
    // Test 4: Packaging breakdown
    // ----------------------------------------------

    it("should preserve valid relationships after breaking down packaging", () => {

        const inventoryRecord = createInventory(
            product.id,
            product.variant[0].id,
            product.variant[0].batches[0].batchId,
            [
                { packagingLevelId: "BOX001", quantity: 2 },
                { packagingLevelId: "PACK001", quantity: 3 },
                { packagingLevelId: "CARD001", quantity: 10 }
            ]
        );

        const updatedInventory = breakdownPackaging(
            inventoryRecord,
            "BOX001",
            "PACK001",
            5,
            1
        );

        expectValidInventory(updatedInventory);

        expect(getStockQuantity(updatedInventory, "BOX001")).toBe(1);
        expect(getStockQuantity(updatedInventory, "PACK001")).toBe(8);
        expect(getStockQuantity(updatedInventory, "CARD001")).toBe(10);

        // Original inventory must remain unchanged.
        expect(getStockQuantity(inventoryRecord, "BOX001")).toBe(2);
        expect(getStockQuantity(inventoryRecord, "PACK001")).toBe(3);
    });


    // ----------------------------------------------
    // Test 5: Packaging build-up
    // ----------------------------------------------

    it("should preserve valid relationships after building up packaging", () => {

        const inventoryRecord = createInventory(
            product.id,
            product.variant[0].id,
            product.variant[0].batches[0].batchId,
            [
                { packagingLevelId: "BOX001", quantity: 2 },
                { packagingLevelId: "PACK001", quantity: 17 },
                { packagingLevelId: "CARD001", quantity: 4 }
            ]
        );

        const updatedInventory = buildUpPackaging(
            inventoryRecord,
            "BOX001",
            "PACK001",
            5
        );

        expectValidInventory(updatedInventory);

        expect(getStockQuantity(updatedInventory, "BOX001")).toBe(5);
        expect(getStockQuantity(updatedInventory, "PACK001")).toBe(2);
        expect(getStockQuantity(updatedInventory, "CARD001")).toBe(4);
    });


    // ----------------------------------------------
    // Test 6: Stock adjustment
    // ----------------------------------------------

    it("should preserve valid relationships after adjusting stock", () => {

        const inventoryRecord = createInventory(
            product.id,
            product.variant[0].id,
            product.variant[0].batches[0].batchId,
            [
                { packagingLevelId: "BOX001", quantity: 2 },
                { packagingLevelId: "PACK001", quantity: 3 },
                { packagingLevelId: "CARD001", quantity: 10 }
            ]
        );

        const updatedInventory = adjustStock(
            inventoryRecord,
            "CARD001",
            2
        );

        expectValidInventory(updatedInventory);

        expect(getStockQuantity(updatedInventory, "CARD001")).toBe(2);
    });


    // ----------------------------------------------
    // Test 7: Invalid product relationship
    // ----------------------------------------------

    it("should reject inventory with an invalid product relationship", () => {

        const inventoryRecord = createInventory(
            "PROD999",
            product.variant[0].id,
            product.variant[0].batches[0].batchId,
            [
                { packagingLevelId: "BOX001", quantity: 2 }
            ]
        );

        expect(() => {
            validateInventoryRelationships(product, inventoryRecord);
        }).toThrow("The inventory record doesn't belong to this product");
    });


    // ----------------------------------------------
    // Test 8: Invalid variant relationship
    // ----------------------------------------------

    it("should reject inventory with an invalid variant relationship", () => {

        const inventoryRecord = createInventory(
            product.id,
            "VAR999",
            product.variant[0].batches[0].batchId,
            [
                { packagingLevelId: "BOX001", quantity: 2 }
            ]
        );

        expect(() => {
            validateInventoryRelationships(product, inventoryRecord);
        }).toThrow("Variant does not belong to this product.");
    });


    // ----------------------------------------------
    // Test 9: Invalid batch relationship
    // ----------------------------------------------

    it("should reject inventory with an invalid batch relationship", () => {

        const inventoryRecord = createInventory(
            product.id,
            product.variant[0].id,
            "BATCH999",
            [
                { packagingLevelId: "BOX001", quantity: 2 }
            ]
        );

        expect(() => {
            validateInventoryRelationships(product, inventoryRecord);
        }).toThrow("Batch does not belong to this variant.");
    });


    // ----------------------------------------------
    // Test 10: Invalid packaging relationship
    // ----------------------------------------------

    it("should reject inventory with an invalid packaging relationship", () => {

        const inventoryRecord = createInventory(
            product.id,
            product.variant[0].id,
            product.variant[0].batches[0].batchId,
            [
                { packagingLevelId: "BOTTLE001", quantity: 2 }
            ]
        );

        expect(() => {
            validateInventoryRelationships(product, inventoryRecord);
        }).toThrow("Packaging level does not belong to this variant.");
    });

});
