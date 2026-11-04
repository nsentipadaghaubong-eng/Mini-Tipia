
import { describe, it, expect } from "vitest";
import { aggregateVariantStock } from "./inventoryAggregation";
import type { inventoryDisplay } from "./inventoryLookup";
import type { packagingLevel } from "../packaging/packagingHierarchy";

// Reusable packaging definitions
const pack: packagingLevel = {
    id: "pack",
    name: "Pack",
    costPrice: 1000,
    sellingPrice: 1500,
    quantityofNextLevel: 6,
    nextLevelId: "card"
};

const card: packagingLevel = {
    id: "card",
    name: "Card",
    costPrice: 200,
    sellingPrice: 300,
    quantityofNextLevel: null,
    nextLevelId: null
};

// Helper for creating inventory display records
function createRecord(
    batchId: string,
    stockQuantities: inventoryDisplay["stockQuantities"],
    packagingLevels: packagingLevel[] = [pack, card],
    productId = "product-1",
    variantId = "variant-1"
): inventoryDisplay {
    return {
        inventoryId: `inventory-${batchId}`,
        productId,
        variantId,
        batchId,
        productName: "Panadol",
        variantName: "Panadol 500mg Tablets",
        batchNumber: batchId,
        expiryDate: new Date("2027-06-30"),
        packagingLevels,
        stockQuantities
    };
}

describe("aggregateVariantStock", () => {

    it("should return null when the input is empty", () => {
        const result = aggregateVariantStock([]);

        expect(result).toBeNull();
    });

    it("should correctly aggregate quantities from multiple batches", () => {
        const records = [
            createRecord("batch-1", [
                { packagingLevelId: "pack", quantity: 2 },
                { packagingLevelId: "card", quantity: 3 }
            ]),
            createRecord("batch-2", [
                { packagingLevelId: "pack", quantity: 4 },
                { packagingLevelId: "card", quantity: 6 }
            ]),
            createRecord("batch-3", [
                { packagingLevelId: "pack", quantity: 1 },
                { packagingLevelId: "card", quantity: 2 }
            ])
        ];

        const result = aggregateVariantStock(records);

        expect(result?.stockQuantities).toEqual([
            { packagingLevelId: "pack", quantity: 7 },
            { packagingLevelId: "card", quantity: 11 }
        ]);
    });

    it("should correctly count the number of batches", () => {
        const records = [
            createRecord("batch-1", [
                { packagingLevelId: "pack", quantity: 2 }
            ]),
            createRecord("batch-2", [
                { packagingLevelId: "pack", quantity: 4 }
            ]),
            createRecord("batch-3", [
                { packagingLevelId: "pack", quantity: 1 }
            ])
        ];

        const result = aggregateVariantStock(records);

        expect(result?.batchCount).toBe(3);
    });

    it("should return the correct product and variant IDs", () => {
        const records = [
            createRecord(
                "batch-1",
                [{ packagingLevelId: "pack", quantity: 2 }]
            )
        ];

        const result = aggregateVariantStock(records);

        expect(result?.productId).toBe("product-1");
        expect(result?.variantId).toBe("variant-1");
    });

    it("should not duplicate packaging definitions", () => {
        const records = [
            createRecord("batch-1", [
                { packagingLevelId: "pack", quantity: 2 },
                { packagingLevelId: "card", quantity: 3 }
            ]),
            createRecord("batch-2", [
                { packagingLevelId: "pack", quantity: 4 },
                { packagingLevelId: "card", quantity: 6 }
            ])
        ];

        const result = aggregateVariantStock(records);

        expect(result?.packagingLevels).toHaveLength(2);
        expect(result?.packagingLevels.map(level => level.id))
            .toEqual(["pack", "card"]);
    });

    it("should reject records belonging to different products", () => {
        const records = [
            createRecord(
                "batch-1",
                [{ packagingLevelId: "pack", quantity: 2 }]
            ),
            createRecord(
                "batch-2",
                [{ packagingLevelId: "pack", quantity: 4 }],
                [pack, card],
                "product-2",
                "variant-1"
            )
        ];

        expect(() => aggregateVariantStock(records)).toThrow();
    });

    it("should reject records belonging to different variants", () => {
        const records = [
            createRecord(
                "batch-1",
                [{ packagingLevelId: "pack", quantity: 2 }]
            ),
            createRecord(
                "batch-2",
                [{ packagingLevelId: "pack", quantity: 4 }],
                [pack, card],
                "product-1",
                "variant-2"
            )
        ];

        expect(() => aggregateVariantStock(records)).toThrow();
    });

    it("should reject duplicate batch IDs", () => {
        const records = [
            createRecord(
                "batch-1",
                [{ packagingLevelId: "pack", quantity: 2 }]
            ),
            createRecord(
                "batch-1",
                [{ packagingLevelId: "pack", quantity: 4 }]
            )
        ];

        expect(() => aggregateVariantStock(records)).toThrow();
    });

    it("should reject stock quantities without matching packaging definitions", () => {
        const records = [
            createRecord(
                "batch-1",
                [{ packagingLevelId: "unknown", quantity: 2 }]
            )
        ];

        expect(() => aggregateVariantStock(records)).toThrow();
    });

    it("should reject conflicting packaging definitions", () => {
        const conflictingPack: packagingLevel = {
            ...pack,
            name: "Different Pack"
        };

        const records = [
            createRecord(
                "batch-1",
                [{ packagingLevelId: "pack", quantity: 2 }]
            ),
            createRecord(
                "batch-2",
                [{ packagingLevelId: "pack", quantity: 4 }],
                [conflictingPack, card]
            )
        ];

        expect(() => aggregateVariantStock(records)).toThrow();
    });

    it("should treat a missing packaging quantity in a batch as zero", () => {
        const records = [
            createRecord("batch-1", [
                { packagingLevelId: "pack", quantity: 2 },
                { packagingLevelId: "card", quantity: 5 }
            ]),
            createRecord("batch-2", [
                { packagingLevelId: "pack", quantity: 3 }
            ])
        ];

        const result = aggregateVariantStock(records);

        expect(result?.stockQuantities).toEqual([
            { packagingLevelId: "pack", quantity: 5 },
            { packagingLevelId: "card", quantity: 5 }
        ]);
    });

    it("should not modify the original inventory records", () => {
        const records = [
            createRecord("batch-1", [
                { packagingLevelId: "pack", quantity: 2 },
                { packagingLevelId: "card", quantity: 3 }
            ]),
            createRecord("batch-2", [
                { packagingLevelId: "pack", quantity: 4 },
                { packagingLevelId: "card", quantity: 6 }
            ])
        ];

        const originalRecords = structuredClone(records);

        aggregateVariantStock(records);

        expect(records).toEqual(originalRecords);
    });

});
