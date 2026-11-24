import { describe, expect, it } from "vitest";
import {
    batchIdentityMatches,
    findLogicalBatchMatches,
    type inventoryBatch
} from "./inventoryBatch";

function batch(
    batchId: string,
    overrides: Partial<inventoryBatch> = {}
): inventoryBatch {
    return {
        batchId,
        productId: "medicine",
        variantId: "tablets",
        batchNumber: "LOT-1",
        expiryDate: new Date("2027-12-31T00:00:00.000Z"),
        pricingByPackagingLevel: [],
        ...overrides
    };
}

describe("logical inventory batch identity", () => {
    it("matches numbered batches only by product, variant, number, and expiry", () => {
        const first = batch("batch-1");
        expect(batchIdentityMatches(first, batch("batch-2"))).toBe(true);
        expect(batchIdentityMatches(first, batch("batch-3", {
            expiryDate: new Date("2028-01-31T00:00:00.000Z")
        }))).toBe(false);
        expect(batchIdentityMatches(first, batch("batch-4", {
            batchNumber: "LOT-2"
        }))).toBe(false);
    });

    it("keeps unnumbered batches with matching expiry mergeable", () => {
        const first = batch("batch-1", {
            batchNumber: null
        });
        expect(batchIdentityMatches(first, batch("batch-2", {
            batchNumber: null
        }))).toBe(true);
        expect(batchIdentityMatches(first, batch("batch-3", {
            batchNumber: null,
            expiryDate: new Date("2028-01-31T00:00:00.000Z")
        }))).toBe(false);
    });

    it("never merges no-number/no-expiry batches", () => {
        const first = batch("batch-1", {
            batchNumber: null,
            expiryDate: null
        });
        expect(batchIdentityMatches(first, batch("batch-2", {
            batchNumber: null,
            expiryDate: null
        }))).toBe(false);
    });

    it("separates identities across products and variants", () => {
        const first = batch("batch-1");
        expect(findLogicalBatchMatches([batch("batch-2", {
            productId: "different-product"
        })], first)).toHaveLength(0);
        expect(findLogicalBatchMatches([batch("batch-3", {
            variantId: "different-variant"
        })], first)).toHaveLength(0);
    });
});
