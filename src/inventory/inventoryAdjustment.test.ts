import { describe, expect, it } from "vitest";
import type { inventory } from "./inventoryStock";
import { adjustInventoryStock } from "./inventoryAdjustment";

function createInventory(): inventory {
    return {
        id: "inventory-1",
        productId: "product-1",
        variantId: "variant-1",
        batchId: "batch-1",
        stockQuantities: [
            { packagingLevelId: "box-1", quantity: 12 },
            { packagingLevelId: "pack-1", quantity: 24 }
        ]
    };
}

describe("adjustInventoryStock", () => {
    it("reduces stock to the actual quantity", () => {
        const result = adjustInventoryStock(createInventory(), "box-1", 8, "Stock count");

        expect(result.updatedInventory.stockQuantities).toEqual([
            { packagingLevelId: "box-1", quantity: 8 },
            { packagingLevelId: "pack-1", quantity: 24 }
        ]);
        expect(result.adjustment.previousQuantity).toBe(12);
        expect(result.adjustment.newQuantity).toBe(8);
        expect(result.adjustment.quantityDifference).toBe(-4);
    });

    it("increases stock to the actual quantity", () => {
        const result = adjustInventoryStock(createInventory(), "box-1", 17, "Stock count");

        expect(result.updatedInventory.stockQuantities[0].quantity).toBe(17);
        expect(result.adjustment.quantityDifference).toBe(5);
    });

    it("rejects an empty adjustment reason", () => {
        expect(() =>
            adjustInventoryStock(createInventory(), "box-1", 8, "   ")
        ).toThrow("An adjustment reason is required");
    });

    it("rejects a quantity that is unchanged", () => {
        expect(() =>
            adjustInventoryStock(createInventory(), "box-1", 12, "Stock count")
        ).toThrow("The new quantity is the same as the existing quantity");
    });

    it("rejects a negative quantity", () => {
        expect(() =>
            adjustInventoryStock(createInventory(), "box-1", -1, "Stock count")
        ).toThrow("Quantity must be a safe non-negative integer");
    });

    it("rejects a decimal quantity", () => {
        expect(() =>
            adjustInventoryStock(createInventory(), "box-1", 8.5, "Stock count")
        ).toThrow("Quantity must be a safe non-negative integer");
    });

    it("rejects an invalid packaging-level ID", () => {
        expect(() =>
            adjustInventoryStock(createInventory(), "unknown", 8, "Stock count")
        ).toThrow("doesn't exist");
    });

    it("does not mutate the original inventory object", () => {
        const original = createInventory();
        const originalSnapshot = structuredClone(original);

        const result = adjustInventoryStock(original, "box-1", 8, "Stock count");

        expect(original).toEqual(originalSnapshot);
        expect(result.updatedInventory).not.toBe(original);
        expect(result.updatedInventory.stockQuantities).not.toBe(original.stockQuantities);
    });

    it("records the inventory, product, variant, batch, and packaging-level IDs", () => {
        const result = adjustInventoryStock(createInventory(), "box-1", 8, "Stock count");

        expect(result.adjustment).toMatchObject({
            inventoryId: "inventory-1",
            productId: "product-1",
            variantId: "variant-1",
            batchId: "batch-1",
            packagingLevelId: "box-1"
        });
    });

    it("calculates quantityDifference as new quantity minus previous quantity", () => {
        const result = adjustInventoryStock(createInventory(), "pack-1", 31, "Stock count");

        expect(result.adjustment.previousQuantity).toBe(24);
        expect(result.adjustment.newQuantity).toBe(31);
        expect(result.adjustment.quantityDifference).toBe(7);
    });
});
