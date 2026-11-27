import { describe, expect, it } from "vitest";
import type {
    PersistedDeliveryDraft,
    PersistedDeliveryDraftItem
} from "./repositories/receiveDeliveryDraftRepository";
import type {
    PersistedSaleDraft,
    PersistedSaleDraftItem
} from "./repositories/salesDraftRepository";
import {
    adaptPersistedDeliveryDraft,
    adaptPersistedDeliveryDrafts,
    adaptPersistedSaleDraft,
    adaptPersistedSaleDrafts
} from "./domainAdapters";

function saleItem(
    overrides: Partial<PersistedSaleDraftItem> = {}
): PersistedSaleDraftItem {
    return {
        lineId: "line-1",
        itemPosition: 0,
        productId: "product-1",
        variantId: "variant-1",
        inventoryRecordId: "inventory-1",
        batchId: null,
        packagingLevelId: "pack-1",
        quantity: 2,
        defaultSellingPriceMinorUnits: 125,
        appliedSellingPriceMinorUnits: 100,
        discountMinorUnits: 25,
        ...overrides
    };
}

function saleDraft(
    overrides: Partial<PersistedSaleDraft> = {}
): PersistedSaleDraft {
    return {
        draftPosition: 0,
        draftId: "sale-draft-1",
        status: "draft",
        createdAt: "2026-11-25T09:00:00.000Z",
        updatedAt: "2026-11-25T09:00:00.000Z",
        customerName: null,
        customerAddress: null,
        saleDate: null,
        staffUserId: null,
        staffDisplayName: null,
        notes: null,
        approvedSaleId: null,
        items: [saleItem()],
        ...overrides
    };
}

function deliveryItem(
    overrides: Partial<PersistedDeliveryDraftItem> = {}
): PersistedDeliveryDraftItem {
    return {
        deliveryItemId: "delivery-item-1",
        itemPosition: 0,
        productId: "product-1",
        variantId: "variant-1",
        packagingLevelId: "pack-1",
        quantity: 3,
        batchNumber: "LOT-1",
        expiryDate: "2028-04-30",
        costPriceMinorUnits: 101,
        sellingPriceMinorUnits: null,
        receivedBatchId: null,
        receiptSnapshotJson: null,
        ...overrides
    };
}

function deliveryDraft(
    overrides: Partial<PersistedDeliveryDraft> = {}
): PersistedDeliveryDraft {
    return {
        deliveryPosition: 0,
        deliveryId: "delivery-draft-1",
        status: "draft",
        createdAt: "2026-11-25T09:00:00.000Z",
        updatedAt: "2026-11-25T09:00:00.000Z",
        deliveryDate: "2026-11-25",
        receivedBy: "Pharmacist",
        supplierName: null,
        invoiceNumber: null,
        receivedEventId: null,
        items: [deliveryItem()],
        ...overrides
    };
}

describe("persistence/domain adapters", () => {
    it("converts active Sale drafts without losing persisted identifiers, NULLs, or positions", () => {
        const source = saleDraft({
            draftPosition: 4,
            customerName: null,
            staffUserId: null,
            staffDisplayName: "Pharmacist",
            items: [
                saleItem({
                    lineId: "line-second",
                    itemPosition: 5,
                    productId: "persisted-product",
                    variantId: "persisted-variant",
                    inventoryRecordId: "persisted-inventory",
                    batchId: "persisted-batch",
                    packagingLevelId: "persisted-pack"
                }),
                saleItem({
                    lineId: "line-first",
                    itemPosition: 2,
                    appliedSellingPriceMinorUnits: 1,
                    discountMinorUnits: 0
                })
            ]
        });

        const result = adaptPersistedSaleDraft(source);

        expect(result.persistence).toBe(source);
        expect(result.domain.items.map((item) => item.lineId)).toEqual([
            "line-first",
            "line-second"
        ]);
        expect(result.domain.items[1]).toMatchObject({
            lineId: "line-second",
            productId: "persisted-product",
            variantId: "persisted-variant",
            inventoryRecordId: "persisted-inventory",
            batchId: "persisted-batch",
            packagingLevelId: "persisted-pack",
            defaultSellingPrice: 1.25,
            appliedSellingPrice: 1,
            discountAmount: 0.25
        });
        expect(result.domain.customerName).toBeUndefined();
        expect(result.domain.staffMember).toEqual({
            displayName: "Pharmacist"
        });
        expect(result.persistenceOnlyFields).toContain("draftPosition");
        expect(result.persistenceOnlyFields).toContain("itemPositions");
        expect(result.persistence.customerName).toBeNull();
    });

    it("sorts Sale draft projections by stored positions without mutating input", () => {
        const later = saleDraft({ draftId: "later", draftPosition: 9 });
        const earlier = saleDraft({ draftId: "earlier", draftPosition: 2 });
        const sources = [later, earlier];

        const results = adaptPersistedSaleDrafts(sources);

        expect(results.map((result) => result.domain.draftId)).toEqual([
            "earlier",
            "later"
        ]);
        expect(sources).toEqual([later, earlier]);
    });

    it("rejects unsafe Sale money and domain-invalid discounts", () => {
        expect(() => adaptPersistedSaleDraft(saleDraft({
            items: [saleItem({ appliedSellingPriceMinorUnits: 1.5 })]
        }))).toThrow("non-negative safe integer");
        expect(() => adaptPersistedSaleDraft(saleDraft({
            items: [saleItem({
                appliedSellingPriceMinorUnits: Number.MAX_SAFE_INTEGER + 1
            })]
        }))).toThrow("non-negative safe integer");
        expect(() => adaptPersistedSaleDraft(saleDraft({
            items: [saleItem({
                quantity: 1,
                appliedSellingPriceMinorUnits: 100,
                discountMinorUnits: 101
            })]
        }))).toThrow("Discount amount cannot exceed");
    });

    it("preserves references without resolving them through live Product or Inventory data", () => {
        const source = saleDraft({
            items: [saleItem({
                productId: "deleted-product",
                variantId: "deleted-variant",
                inventoryRecordId: "deleted-inventory",
                batchId: "deleted-batch",
                packagingLevelId: "deleted-packaging"
            })]
        });

        const result = adaptPersistedSaleDraft(source);

        expect(result.domain.items[0]).toMatchObject({
            productId: "deleted-product",
            variantId: "deleted-variant",
            inventoryRecordId: "deleted-inventory",
            batchId: "deleted-batch",
            packagingLevelId: "deleted-packaging"
        });
        expect(result.persistence).toBe(source);
    });

    it("projects compatible Delivery drafts and keeps opaque receipt data in the source DTO", () => {
        const source = deliveryDraft({
            deliveryPosition: 6,
            supplierName: "Supplier",
            invoiceNumber: "INV-6",
            receivedEventId: "historical-event-id",
            items: [deliveryItem({
                deliveryItemId: "item-opaque",
                receivedBatchId: "historical-batch-id",
                receiptSnapshotJson: "{opaque historical text"
            })]
        });

        const result = adaptPersistedDeliveryDraft(source);

        expect(result.domain).not.toBeNull();
        if (result.domain === null) {
            throw new Error("Expected a compatible Delivery draft projection.");
        }
        expect(result.domain.items[0]).toMatchObject({
            deliveryItemId: "item-opaque",
            productId: "product-1",
            variantId: "variant-1",
            packagingLevelId: "pack-1",
            quantity: 3,
            costPrice: 1.01,
            sellingPrice: null
        });
        expect(result.domain.supplier).toBe("Supplier");
        expect(result.domain.invoiceNumber).toBe("INV-6");
        expect(result.persistence).toBe(source);
        expect(result.persistence.items[0]?.receiptSnapshotJson)
            .toBe("{opaque historical text");
        expect(result.persistenceOnlyFields).toContain("receivedEventId");
        expect(result.persistenceOnlyFields).toContain("receivedBatchId");
    });

    it("leaves Delivery drafts persistence-only when required domain headers are NULL", () => {
        const source = deliveryDraft({
            deliveryDate: null,
            receivedBy: null,
            supplierName: null
        });

        const result = adaptPersistedDeliveryDraft(source);

        expect(result).toMatchObject({
            domain: null,
            persistence: source,
            incompatibleFields: ["deliveryDate", "receivedBy"]
        });
        expect(result.persistence.deliveryDate).toBeNull();
        expect(result.persistence.receivedBy).toBeNull();
    });

    it("sorts Delivery draft and item projections by persisted positions", () => {
        const later = deliveryDraft({
            deliveryId: "later",
            deliveryPosition: 8,
            items: [
                deliveryItem({
                    deliveryItemId: "later-item",
                    itemPosition: 4
                }),
                deliveryItem({
                    deliveryItemId: "first-item",
                    itemPosition: 1
                })
            ]
        });
        const earlier = deliveryDraft({
            deliveryId: "earlier",
            deliveryPosition: 3
        });

        const results = adaptPersistedDeliveryDrafts([later, earlier]);

        expect(results.map((result) => result.persistence.deliveryId)).toEqual([
            "earlier",
            "later"
        ]);
        const laterResult = results[1];
        expect(laterResult?.domain?.items.map((item) => item.deliveryItemId))
            .toEqual(["first-item", "later-item"]);
    });

    it("rejects unsafe Delivery prices, quantities, duplicate positions, and invalid IDs", () => {
        expect(() => adaptPersistedDeliveryDraft(deliveryDraft({
            items: [deliveryItem({ costPriceMinorUnits: 2.5 })]
        }))).toThrow("non-negative safe integer");
        expect(() => adaptPersistedDeliveryDraft(deliveryDraft({
            items: [deliveryItem({
                sellingPriceMinorUnits: Number.MAX_SAFE_INTEGER + 1
            })]
        }))).toThrow("non-negative safe integer");
        expect(() => adaptPersistedDeliveryDraft(deliveryDraft({
            items: [deliveryItem({ quantity: 0 })]
        }))).toThrow("safe integer");
        expect(() => adaptPersistedDeliveryDraft(deliveryDraft({
            deliveryId: "  "
        }))).toThrow("must not be empty");
        expect(() => adaptPersistedSaleDraft(saleDraft({
            items: [
                saleItem({ lineId: "same-position-1", itemPosition: 0 }),
                saleItem({ lineId: "same-position-2", itemPosition: 0 })
            ]
        }))).toThrow("duplicate item IDs or positions");
    });
});
