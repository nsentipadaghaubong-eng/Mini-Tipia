import { describe, expect, it } from "vitest";
import type { inventory } from "./inventoryStock";
import {
    adjustInventoryStock,
    applyUnbatchedInventoryChanges
} from "./inventoryAdjustment";
import type { productStructure } from "../products/productStructure";

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

function createUnbatchedProduct(): productStructure {
    return {
        id: "product-1",
        name: "Medicine",
        variant: [
            {
                id: "variant-1",
                variantName: "Medicine 500mg",
                packagingHierarchy: [
                    {
                        id: "box-1",
                        name: "Box",
                        costPrice: null,
                        sellingPrice: null,
                        quantityofNextLevel: 2,
                        nextLevelId: "pack-1"
                    },
                    {
                        id: "pack-1",
                        name: "Pack",
                        costPrice: null,
                        sellingPrice: null,
                        quantityofNextLevel: null,
                        nextLevelId: null
                    }
                ]
            },
            {
                id: "variant-2",
                variantName: "Medicine 250mg",
                packagingHierarchy: [
                    {
                        id: "bottle-1",
                        name: "Bottle",
                        costPrice: null,
                        sellingPrice: null,
                        quantityofNextLevel: null,
                        nextLevelId: null
                    }
                ]
            }
        ]
    };
}

describe("adjustInventoryStock", () => {
    it("reduces stock to the actual quantity", () => {
        const result = adjustInventoryStock(createUnbatchedProduct(), createInventory(), "box-1", 8, "Stock count");

        expect(result.updatedInventory.stockQuantities).toEqual([
            { packagingLevelId: "box-1", quantity: 8 },
            { packagingLevelId: "pack-1", quantity: 24 }
        ]);
        expect(result.adjustment.previousQuantity).toBe(12);
        expect(result.adjustment.newQuantity).toBe(8);
        expect(result.adjustment.quantityDifference).toBe(-4);
    });

    it("increases stock to the actual quantity", () => {
        const result = adjustInventoryStock(createUnbatchedProduct(), createInventory(), "box-1", 17, "Stock count");

        expect(result.updatedInventory.stockQuantities[0].quantity).toBe(17);
        expect(result.adjustment.quantityDifference).toBe(5);
    });

    it("rejects an empty adjustment reason", () => {
        expect(() =>
            adjustInventoryStock(createUnbatchedProduct(), createInventory(), "box-1", 8, "   ")
        ).toThrow("An adjustment reason is required");
    });

    it("rejects a quantity that is unchanged", () => {
        expect(() =>
            adjustInventoryStock(createUnbatchedProduct(), createInventory(), "box-1", 12, "Stock count")
        ).toThrow("The new quantity is the same as the existing quantity");
    });

    it("rejects a negative quantity", () => {
        expect(() =>
            adjustInventoryStock(createUnbatchedProduct(), createInventory(), "box-1", -1, "Stock count")
        ).toThrow("Quantity must be a safe non-negative integer");
    });

    it("rejects a decimal quantity", () => {
        expect(() =>
            adjustInventoryStock(createUnbatchedProduct(), createInventory(), "box-1", 8.5, "Stock count")
        ).toThrow("Quantity must be a safe non-negative integer");
    });

    it("rejects an invalid packaging-level ID", () => {
        expect(() =>
            adjustInventoryStock(createUnbatchedProduct(), createInventory(), "unknown", 8, "Stock count")
        ).toThrow("does not belong to this variant");
    });

    it("does not mutate the original inventory object", () => {
        const original = createInventory();
        const originalSnapshot = structuredClone(original);

        const result = adjustInventoryStock(createUnbatchedProduct(), original, "box-1", 8, "Stock count");

        expect(original).toEqual(originalSnapshot);
        expect(result.updatedInventory).not.toBe(original);
        expect(result.updatedInventory.stockQuantities).not.toBe(original.stockQuantities);
    });

    it("records the inventory, product, variant, batch, and packaging-level IDs", () => {
        const result = adjustInventoryStock(createUnbatchedProduct(), createInventory(), "box-1", 8, "Stock count");

        expect(result.adjustment).toMatchObject({
            inventoryId: "inventory-1",
            productId: "product-1",
            variantId: "variant-1",
            batchId: "batch-1",
            packagingLevelId: "box-1"
        });
    });

    describe("applyUnbatchedInventoryChanges", () => {
        const product = createUnbatchedProduct();
        const unbatchedRecord: inventory = {
            id: "unbatched-1",
            productId: "product-1",
            variantId: "variant-1",
            batchId: null,
            stockQuantities: [{ packagingLevelId: "box-1", quantity: 12 }]
        };

        it.each([
            ["increases", 12, 17, 5],
            ["decreases", 12, 8, -4]
        ])("%s unbatched stock", (_direction, previousQuantity, newQuantity, difference) => {
            const result = applyUnbatchedInventoryChanges(
                product,
                [unbatchedRecord],
                [{
                    inventoryId: "unbatched-1",
                    variantId: "variant-1",
                    stockQuantities: [{
                        packagingLevelId: "box-1",
                        quantity: newQuantity
                    }]
                }],
                "  Stock count  "
            );

            expect(result.updatedInventory[0].stockQuantities[0].quantity).toBe(newQuantity);
            expect(result.adjustments[0]).toMatchObject({
                inventoryId: "unbatched-1",
                productId: "product-1",
                variantId: "variant-1",
                batchId: null,
                packagingLevelId: "box-1",
                previousQuantity,
                newQuantity,
                quantityDifference: difference,
                reason: "Stock count"
            });
        });

        it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
            "rejects invalid quantity %s",
            (quantity) => {
                expect(() =>
                    applyUnbatchedInventoryChanges(
                        product,
                        [unbatchedRecord],
                        [{
                            inventoryId: "unbatched-1",
                            variantId: "variant-1",
                            stockQuantities: [{
                                packagingLevelId: "box-1",
                                quantity
                            }]
                        }],
                        "Stock count"
                    )
                ).toThrow("safe non-negative integer");
            }
        );

        it("targets only the requested unbatched record, product, variant, and packaging level", () => {
            const sameVariantBatchedRecord: inventory = {
                ...unbatchedRecord,
                id: "batched-1",
                batchId: "batch-1"
            };
            const otherVariantRecord: inventory = {
                id: "other-variant",
                productId: "product-1",
                variantId: "variant-2",
                batchId: null,
                stockQuantities: [{ packagingLevelId: "bottle-1", quantity: 3 }]
            };
            const otherProductRecord: inventory = {
                ...unbatchedRecord,
                id: "other-product",
                productId: "product-2"
            };

            const result = applyUnbatchedInventoryChanges(
                product,
                [unbatchedRecord, sameVariantBatchedRecord, otherVariantRecord, otherProductRecord],
                [{
                    inventoryId: "unbatched-1",
                    variantId: "variant-1",
                    stockQuantities: [{ packagingLevelId: "box-1", quantity: 20 }]
                }],
                "Count"
            );

            expect(result.updatedInventory.map((record) =>
                record.stockQuantities[0].quantity
            )).toEqual([20, 12, 3, 12]);
            expect(result.adjustments).toHaveLength(1);
            expect(() =>
                applyUnbatchedInventoryChanges(
                    product,
                    [unbatchedRecord],
                    [{
                        inventoryId: "unbatched-1",
                        variantId: "variant-1",
                        stockQuantities: [{ packagingLevelId: "unknown", quantity: 20 }]
                    }],
                    "Count"
                )
            ).toThrow("does not belong to this variant");
        });

        it.each([
            ["another variant", "variant-2", "Unbatched inventory record not found"],
            ["another product", "variant-1", "Unbatched inventory record not found"]
        ])("rejects a record associated with %s", (_relationship, variantId, message) => {
            const records = variantId === "variant-2"
                ? [unbatchedRecord]
                : [{
                    ...unbatchedRecord,
                    productId: "product-2"
                }];

            expect(() =>
                applyUnbatchedInventoryChanges(
                    product,
                    records,
                    [{
                        inventoryId: "unbatched-1",
                        variantId,
                        stockQuantities: [{ packagingLevelId: "box-1", quantity: 20 }]
                    }],
                    "Count"
                )
            ).toThrow(message);
        });

        it("rejects duplicate record submissions and records already handled as batches", () => {
            const change = {
                inventoryId: "unbatched-1",
                variantId: "variant-1",
                stockQuantities: [{ packagingLevelId: "box-1", quantity: 20 }]
            };

            expect(() =>
                applyUnbatchedInventoryChanges(
                    product,
                    [unbatchedRecord],
                    [change, change],
                    "Count"
                )
            ).toThrow("Duplicate inventory record");
            expect(() =>
                applyUnbatchedInventoryChanges(
                    product,
                    [unbatchedRecord],
                    [change],
                    "Count",
                    new Set(["unbatched-1"])
                )
            ).toThrow("Duplicate inventory record");
        });

        it("applies batch and unbatched changes together without creating batch records", () => {
            const batchedRecord = createInventory();
            const batchResult = adjustInventoryStock(
                product,
                batchedRecord,
                "box-1",
                10,
                "Count"
            );
            const result = applyUnbatchedInventoryChanges(
                product,
                [batchResult.updatedInventory, unbatchedRecord],
                [{
                    inventoryId: "unbatched-1",
                    variantId: "variant-1",
                    stockQuantities: [{ packagingLevelId: "box-1", quantity: 15 }]
                }],
                "Count",
                new Set([batchedRecord.id])
            );

            expect(result.updatedInventory).toHaveLength(2);
            expect(result.updatedInventory[0].batchId).toBe("batch-1");
            expect(result.updatedInventory[0].stockQuantities[0].quantity).toBe(10);
            expect(result.updatedInventory[1].batchId).toBeNull();
            expect(result.updatedInventory[1].stockQuantities[0].quantity).toBe(15);
            expect(result.adjustments[0].batchId).toBeNull();
        });
    });

    it("calculates quantityDifference as new quantity minus previous quantity", () => {
        const result = adjustInventoryStock(createUnbatchedProduct(), createInventory(), "pack-1", 31, "Stock count");

        expect(result.adjustment.previousQuantity).toBe(24);
        expect(result.adjustment.newQuantity).toBe(31);
        expect(result.adjustment.quantityDifference).toBe(7);
    });
});
