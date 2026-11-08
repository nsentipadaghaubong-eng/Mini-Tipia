import { describe, expect, it } from "vitest";
import type { inventoryBatch } from "../inventory/inventoryBatch";
import type { inventory } from "../inventory/inventoryStock";
import type { productStructure } from "../products/productStructure";
import {
    applicationReducer,
    createInitialApplicationState
} from "../applicationState";
import {
    completeSale,
    prepareSaleDraft,
    prepareSale,
    recommendInventoryByFefo,
    resolveDefaultSellingPrice,
    type SaleContext,
    type SaleRequest
} from "./salesEngine";
import type { SaleDraft } from "./salesDraft";

const product: productStructure = {
    id: "medicine-1",
    name: "Medicine",
    genericName: "Generic medicine",
    variant: [{
        id: "tablet-500",
        variantName: "500 mg tablet",
        packagingHierarchy: [
            {
                id: "box",
                name: "Box",
                costPrice: 3000,
                sellingPrice: 5000,
                quantityofNextLevel: 5,
                nextLevelId: "pack"
            },
            {
                id: "pack",
                name: "Pack",
                costPrice: 1200,
                sellingPrice: 2000,
                quantityofNextLevel: 6,
                nextLevelId: "card"
            },
            {
                id: "card",
                name: "Card",
                costPrice: 300,
                sellingPrice: 500,
                quantityofNextLevel: null,
                nextLevelId: null
            }
        ]
    }, {
        id: "tablet-250",
        variantName: "250 mg tablet",
        packagingHierarchy: [{
            id: "bottle",
            name: "Bottle",
            costPrice: 1,
            sellingPrice: 10,
            quantityofNextLevel: null,
            nextLevelId: null
        }]
    }]
};

function makeRecord(
    id: string,
    batchId: string | null,
    quantities: inventory["stockQuantities"],
    variantId = product.variant[0].id
): inventory {
    return {
        id,
        productId: product.id,
        variantId,
        batchId,
        stockQuantities: quantities
    };
}

function makeBatch(
    batchId: string,
    expiryDate: Date | null,
    receivedPricing?: inventoryBatch["receivedPricing"],
    variantId = product.variant[0].id
): inventoryBatch {
    return {
        batchId,
        productId: product.id,
        variantId,
        batchNumber: `LOT-${batchId}`,
        expiryDate,
        ...(receivedPricing ? { receivedPricing } : {})
    };
}

function makeContext(
    records: inventory[],
    batches: inventoryBatch[]
): SaleContext {
    return {
        products: [product],
        inventoryRecords: records,
        inventoryBatches: batches
    };
}

function makeRequest(
    record: inventory,
    overrides: Partial<SaleRequest> = {}
): SaleRequest {
    return {
        productId: product.id,
        variantId: product.variant[0].id,
        inventoryRecordId: record.id,
        batchId: record.batchId,
        packagingLevelId: "card",
        quantity: 1,
        ...overrides
    };
}

function makeSalePlan(
    record: inventory,
    batches: inventoryBatch[] = [],
    overrides: Partial<SaleRequest> = {}
) {
    return prepareSale(
        makeRequest(record, overrides),
        makeContext([record], batches),
        {
            makeId: () => "sale-1",
            now: () => new Date("2026-11-06T10:00:00.000Z")
        }
    );
}

function makeDraft(
    items: SaleDraft["items"],
    overrides: Partial<SaleDraft> = {}
): SaleDraft {
    return {
        draftId: "draft-1",
        status: "draft",
        createdAt: "2026-11-06T09:00:00.000Z",
        updatedAt: "2026-11-06T09:30:00.000Z",
        items,
        ...overrides
    };
}

function makeDraftItem(
    lineId: string,
    record: inventory,
    overrides: Partial<SaleDraft["items"][number]> = {}
): SaleDraft["items"][number] {
    return {
        lineId,
        productId: record.productId,
        variantId: record.variantId,
        inventoryRecordId: record.id,
        batchId: record.batchId,
        packagingLevelId: "card",
        quantity: 1,
        defaultSellingPrice: 500,
        appliedSellingPrice: 500,
        discountAmount: 0,
        ...overrides
    };
}

describe("Sales price resolution", () => {
    const batchWithBoxPrice = makeBatch(
        "batch-priced",
        new Date("2027-01-31T00:00:00.000Z"),
        { packagingLevelId: "box", sellingPrice: 6000 }
    );

    it("uses normal variant prices when no batch-specific price exists", () => {
        expect(resolveDefaultSellingPrice(
            product,
            "tablet-500",
            "box",
            makeBatch("regular", null)
        )).toBe(5000);
    });

    it("uses the batch received price only for its recorded packaging level", () => {
        expect(resolveDefaultSellingPrice(
            product,
            "tablet-500",
            "box",
            batchWithBoxPrice
        )).toBe(6000);
        expect(resolveDefaultSellingPrice(
            product,
            "tablet-500",
            "pack",
            batchWithBoxPrice
        )).toBe(2000);
        expect(resolveDefaultSellingPrice(
            product,
            "tablet-500",
            "card",
            batchWithBoxPrice
        )).toBe(500);
        expect(resolveDefaultSellingPrice(
            product,
            "tablet-500",
            "box",
            makeBatch("another", null)
        )).toBe(5000);
        expect(product.variant[0].packagingHierarchy[0].sellingPrice).toBe(5000);
    });

    it("keeps a sale-specific price override separate from stored defaults", () => {
        const record = makeRecord("priced-stock", batchWithBoxPrice.batchId, [
            { packagingLevelId: "box", quantity: 1 },
            { packagingLevelId: "pack", quantity: 0 },
            { packagingLevelId: "card", quantity: 0 }
        ]);
        const plan = makeSalePlan(record, [batchWithBoxPrice], {
            packagingLevelId: "box",
            appliedSellingPrice: 6500
        });

        expect(plan.defaultSellingPrice).toBe(6000);
        expect(plan.appliedSellingPrice).toBe(6500);
        expect(product.variant[0].packagingHierarchy[0].sellingPrice).toBe(5000);
        expect(batchWithBoxPrice.receivedPricing?.sellingPrice).toBe(6000);
    });
});

describe("FEFO and inventory selection", () => {
    it("orders known expiry dates first, keeps expired batches visible, and puts unknown expiry last", () => {
        const records = [
            makeRecord("unknown-stock", "unknown", [
                { packagingLevelId: "card", quantity: 3 }
            ]),
            makeRecord("late-stock", "late", [
                { packagingLevelId: "card", quantity: 4 }
            ]),
            makeRecord("expired-stock", "expired", [
                { packagingLevelId: "card", quantity: 2 }
            ]),
            makeRecord("unbatched-stock", null, [
                { packagingLevelId: "card", quantity: 5 }
            ]),
            makeRecord("empty-stock", "empty", [
                { packagingLevelId: "card", quantity: 0 }
            ]),
            makeRecord("other-variant-stock", "other-variant", [
                { packagingLevelId: "bottle", quantity: 10 }
            ], "tablet-250")
        ];
        const batches = [
            makeBatch("unknown", null),
            makeBatch("late", new Date("2027-01-31T00:00:00.000Z")),
            makeBatch("expired", new Date("2026-10-31T00:00:00.000Z")),
            makeBatch("empty", new Date("2026-12-01T00:00:00.000Z")),
            makeBatch("other-variant", new Date("2026-11-07T00:00:00.000Z"), undefined, "tablet-250")
        ];

        const result = recommendInventoryByFefo(
            product,
            "tablet-500",
            records,
            batches,
            new Date("2026-11-06T12:00:00.000Z")
        );

        expect(result.batches.map(({ inventoryRecord }) => inventoryRecord.id))
            .toEqual(["expired-stock", "late-stock", "unknown-stock"]);
        expect(result.batches[0].expired).toBe(true);
        expect(result.batches[2].batch.batchId).toBe("unknown");
        expect(result.unbatched.map((record) => record.id)).toEqual([
            "unbatched-stock"
        ]);
    });

    it("requires the explicitly selected variant, batch, and inventory record to match", () => {
        const record = makeRecord("selected", "batch-a", [
            { packagingLevelId: "card", quantity: 4 }
        ]);
        const batch = makeBatch("batch-a", null);

        expect(() => makeSalePlan(record, [batch], {
            variantId: "tablet-250"
        })).toThrow("explicitly selected product, variant, and batch");
        expect(() => makeSalePlan(record, [batch], {
            batchId: "different-batch"
        })).toThrow("explicitly selected product, variant, and batch");
    });
});

describe("Sales allocation and completion", () => {
    it("sells unbatched stock without creating batch details", () => {
        const record = makeRecord("unbatched", null, [
            { packagingLevelId: "box", quantity: 0 },
            { packagingLevelId: "pack", quantity: 0 },
            { packagingLevelId: "card", quantity: 4 }
        ]);
        const completion = completeSale(makeSalePlan(record), {
            now: () => new Date("2026-11-06T10:01:00.000Z"),
            makeEventId: () => "event-1"
        });

        expect(completion.sale.items[0].batch).toBeNull();
        expect(completion.sale.finalAmount).toBe(500);
        expect(completion.updatedInventory[0].batchId).toBeNull();
        expect(completion.updatedInventory[0].stockQuantities[2].quantity).toBe(3);
    });

    it("breaks down 10 Boxes into 9 Boxes, 4 Packs, and 4 Cards for a 2-Card sale", () => {
        const record = makeRecord("batch-stock", "batch-1", [
            { packagingLevelId: "box", quantity: 10 },
            { packagingLevelId: "pack", quantity: 0 },
            { packagingLevelId: "card", quantity: 0 }
        ]);
        const batch = makeBatch("batch-1", new Date("2027-01-31T00:00:00.000Z"));
        const plan = makeSalePlan(record, [batch], { quantity: 2 });

        expect(plan.updatedInventory.stockQuantities).toEqual([
            { packagingLevelId: "box", quantity: 9 },
            { packagingLevelId: "pack", quantity: 4 },
            { packagingLevelId: "card", quantity: 4 }
        ]);
        expect(record.stockQuantities).toEqual([
            { packagingLevelId: "box", quantity: 10 },
            { packagingLevelId: "pack", quantity: 0 },
            { packagingLevelId: "card", quantity: 0 }
        ]);
    });

    it("recursively breaks down only as much as required across multiple packaging levels", () => {
        const record = makeRecord("recursive-stock", "batch-recursive", [
            { packagingLevelId: "box", quantity: 5 },
            { packagingLevelId: "pack", quantity: 0 },
            { packagingLevelId: "card", quantity: 7 }
        ]);
        const plan = makeSalePlan(record, [
            makeBatch("batch-recursive", new Date("2027-01-31T00:00:00.000Z"))
        ], { quantity: 8 });

        expect(plan.updatedInventory.stockQuantities).toEqual([
            { packagingLevelId: "box", quantity: 4 },
            { packagingLevelId: "pack", quantity: 4 },
            { packagingLevelId: "card", quantity: 5 }
        ]);
        expect(record.stockQuantities).toEqual([
            { packagingLevelId: "box", quantity: 5 },
            { packagingLevelId: "pack", quantity: 0 },
            { packagingLevelId: "card", quantity: 7 }
        ]);
    });

    it("plans multiple draft lines sequentially against the same inventory record", () => {
        const record = makeRecord("shared-stock", null, [
            { packagingLevelId: "card", quantity: 10 }
        ]);
        const draft = makeDraft([
            makeDraftItem("line-1", record, { quantity: 6 }),
            makeDraftItem("line-2", record, { quantity: 4 })
        ]);
        const plan = prepareSaleDraft(draft, makeContext([record], []), {
            now: () => new Date("2026-11-06T10:00:00.000Z")
        });

        expect(plan.linePlans).toHaveLength(2);
        expect(plan.expectedInventory).toEqual([record]);
        expect(plan.updatedInventory[0].stockQuantities).toEqual([
            { packagingLevelId: "card", quantity: 0 }
        ]);
        expect(record.stockQuantities[0].quantity).toBe(10);
    });

    it("rejects combined draft demand that exceeds a shared record's stock", () => {
        const record = makeRecord("oversold-shared-stock", null, [
            { packagingLevelId: "card", quantity: 10 }
        ]);
        const draft = makeDraft([
            makeDraftItem("line-1", record, { quantity: 6 }),
            makeDraftItem("line-2", record, { quantity: 6 })
        ]);
        const original = structuredClone(record);

        expect(() => prepareSaleDraft(
            draft,
            makeContext([record], [])
        )).toThrow("Insufficient stock");
        expect(record).toEqual(original);
    });

    it("rejects an empty draft and a stale default selling price", () => {
        const record = makeRecord("stale-price-stock", "priced-batch", [
            { packagingLevelId: "box", quantity: 1 }
        ]);
        const batch = makeBatch(
            "priced-batch",
            new Date("2027-01-31T00:00:00.000Z"),
            { packagingLevelId: "box", sellingPrice: 6000 }
        );
        const context = makeContext([record], [batch]);

        expect(() => prepareSaleDraft(makeDraft([]), context)).toThrow(
            "empty sale draft"
        );
        expect(() => prepareSaleDraft(makeDraft([
            makeDraftItem("stale-price-line", record, {
                packagingLevelId: "box",
                defaultSellingPrice: 5000,
                appliedSellingPrice: 6000
            })
        ]), context)).toThrow("Default selling price changed");
        expect(record.stockQuantities[0].quantity).toBe(1);
    });

    it("rejects insufficient stock without changing the source record", () => {
        const record = makeRecord("short-stock", "batch-1", [
            { packagingLevelId: "box", quantity: 0 },
            { packagingLevelId: "pack", quantity: 0 },
            { packagingLevelId: "card", quantity: 1 }
        ]);
        const original = structuredClone(record);

        expect(() => makeSalePlan(record, [
            makeBatch("batch-1", null)
        ], { quantity: 2 })).toThrow("Insufficient stock");
        expect(record).toEqual(original);
    });

    it("requires explicit continuation for an expired batch and records that choice", () => {
        const record = makeRecord("expired-sale", "expired", [
            { packagingLevelId: "box", quantity: 0 },
            { packagingLevelId: "pack", quantity: 0 },
            { packagingLevelId: "card", quantity: 2 }
        ]);
        const plan = makeSalePlan(record, [
            makeBatch("expired", new Date("2026-10-31T00:00:00.000Z"))
        ]);

        expect(plan.expiredBatch).toBe(true);
        expect(() => completeSale(plan)).toThrow(
            "Explicit confirmation is required"
        );
        const completion = completeSale(plan, {
            continueWithExpiredBatch: true,
            now: () => new Date("2026-11-06T10:00:00.000Z"),
            makeEventId: () => "expired-event"
        });
        expect(completion.sale.expiredBatchConfirmed).toBe(true);
        expect(completion.sale.items[0].appliedSellingPrice).toBe(500);
    });

    it("rechecks expiry at completion if the selected batch expires after planning", () => {
        const record = makeRecord("expires-during-sale", "expiring", [
            { packagingLevelId: "box", quantity: 0 },
            { packagingLevelId: "pack", quantity: 0 },
            { packagingLevelId: "card", quantity: 2 }
        ]);
        const plan = prepareSale(
            makeRequest(record),
            makeContext(
                [record],
                [makeBatch("expiring", new Date("2026-11-06T00:00:00.000Z"))]
            ),
            {
                makeId: () => "sale-expiring",
                now: () => new Date("2026-11-06T10:00:00.000Z")
            }
        );

        expect(plan.expiredBatch).toBe(false);
        expect(() => completeSale(plan, {
            now: () => new Date("2026-11-07T00:00:00.000Z")
        })).toThrow("Explicit confirmation is required");
    });

    it("keeps cancellation and failed completion free of stock and Activity changes", () => {
        const record = makeRecord("cancelled", null, [
            { packagingLevelId: "box", quantity: 0 },
            { packagingLevelId: "pack", quantity: 0 },
            { packagingLevelId: "card", quantity: 2 }
        ]);
        const initial = {
            ...createInitialApplicationState(),
            products: [product],
            inventoryRecords: [record],
            inventoryBatches: [],
            activityEvents: [],
            sales: []
        };
        const plan = makeSalePlan(record);

        expect(initial.inventoryRecords[0]).toBe(record);
        expect(initial.activityEvents).toEqual([]);
        expect(() => completeSale(plan, {
            now: () => new Date(Number.NaN)
        })).toThrow("Sale completion date");
        expect(initial.inventoryRecords[0]).toEqual(record);
        expect(initial.activityEvents).toEqual([]);
    });

    it("commits Inventory, sale record, and self-contained Activity once", () => {
        const record = makeRecord("activity-stock", "batch-a", [
            { packagingLevelId: "box", quantity: 0 },
            { packagingLevelId: "pack", quantity: 0 },
            { packagingLevelId: "card", quantity: 3 }
        ]);
        const batch = makeBatch("batch-a", new Date("2027-01-31T00:00:00.000Z"));
        const plan = makeSalePlan(record, [batch], {
            appliedSellingPrice: 450,
            discountAmount: 25,
            customerName: "Customer One",
            customerAddress: "1 Pharmacy Road",
            staffMember: { userId: "staff-1", displayName: "Pharmacist" },
            notes: "Prescription checked"
        });
        const completion = completeSale(plan, {
            now: () => new Date("2026-11-06T10:01:00.000Z"),
            makeEventId: () => "sale-event"
        });
        const state = {
            ...createInitialApplicationState(),
            products: [product],
            inventoryRecords: [record],
            inventoryBatches: [batch],
            activityEvents: [],
            sales: []
        };
        const action = {
            type: "sale.completed" as const,
            completion
        };
        const committed = applicationReducer(state, action);
        const event = committed.activityEvents[0];

        expect(committed.inventoryRecords[0].stockQuantities[2].quantity).toBe(2);
        expect(committed.sales[0]).toMatchObject({
            customerName: "Customer One",
            customerAddress: "1 Pharmacy Road",
            staffMember: { userId: "staff-1", displayName: "Pharmacist" },
            notes: "Prescription checked",
            subtotal: 450,
            discountAmount: 25,
            finalAmount: 425,
            completedAt: "2026-11-06T10:01:00.000Z"
        });
        expect(committed.sales[0].items[0]).toMatchObject({
            defaultSellingPrice: 500,
            appliedSellingPrice: 450,
            discountAmount: 25
        });
        expect(event.type).toBe("sale.completed");
        if (event.type === "sale.completed") {
            expect(event.items[0]).toMatchObject({
                product: { productName: "Medicine" },
                variant: { variantName: "500 mg tablet" },
                appliedSellingPrice: 450,
                discountAmount: 25,
                finalAmount: 425,
                allocations: [{
                    inventoryId: "activity-stock",
                    batch: { batchId: "batch-a", batchNumber: "LOT-batch-a" },
                    quantity: 1
                }]
            });
        }
        expect(applicationReducer(committed, action)).toBe(committed);
        expect(committed.inventoryRecords[0].stockQuantities[2].quantity).toBe(2);
        expect(committed.sales).toHaveLength(1);
        expect(committed.activityEvents).toHaveLength(1);
    });

    it("approves a multi-item draft atomically and records one complete Activity event", () => {
        const cards = makeRecord("multi-cards", null, [
            { packagingLevelId: "box", quantity: 0 },
            { packagingLevelId: "pack", quantity: 0 },
            { packagingLevelId: "card", quantity: 5 }
        ]);
        const bottle = makeRecord("multi-bottle", null, [
            { packagingLevelId: "bottle", quantity: 2 }
        ], "tablet-250");
        const draft = makeDraft([
            makeDraftItem("line-card", cards, { quantity: 2 }),
            makeDraftItem("line-bottle", bottle, {
                variantId: "tablet-250",
                packagingLevelId: "bottle",
                quantity: 1,
                defaultSellingPrice: 10,
                appliedSellingPrice: 10
            })
        ], {
            customerName: "Customer Two",
            staffMember: { userId: "staff-2", displayName: "Pharmacist Two" }
        });
        const context = {
            products: [product],
            inventoryRecords: [cards, bottle],
            inventoryBatches: []
        };
        const plan = prepareSaleDraft(draft, context, {
            now: () => new Date("2026-11-06T10:00:00.000Z")
        });
        const completion = completeSale(plan, {
            now: () => new Date("2026-11-06T10:01:00.000Z"),
            makeId: () => "multi-sale",
            makeEventId: () => "multi-event"
        });
        const state = {
            ...createInitialApplicationState(),
            products: [product],
            inventoryRecords: [cards, bottle],
            inventoryBatches: [],
            activityEvents: [],
            sales: [],
            saleDrafts: [draft]
        };
        const committed = applicationReducer(state, {
            type: "sale.completed",
            completion
        });

        expect(committed.inventoryRecords.map((record) =>
            record.stockQuantities.map((stock) => stock.quantity)
        )).toEqual([[0, 0, 3], [1]]);
        expect(committed.sales).toHaveLength(1);
        expect(committed.sales[0].items).toHaveLength(2);
        expect(committed.sales[0]).toMatchObject({
            subtotal: 1010,
            discountAmount: 0,
            finalAmount: 1010,
            customerName: "Customer Two"
        });
        expect(committed.activityEvents).toHaveLength(1);
        expect(committed.activityEvents[0].type).toBe("sale.completed");
        expect(committed.saleDrafts[0]).toMatchObject({
            status: "approved",
            updatedAt: "2026-11-06T10:01:00.000Z"
        });
        expect(applicationReducer(committed, {
            type: "sale.completed",
            completion
        })).toBe(committed);
    });

    it("rejects an expired line without explicit continuation and commits no draft changes", () => {
        const expired = makeRecord("expired-multi", "expired-batch", [
            { packagingLevelId: "card", quantity: 2 }
        ]);
        const draft = makeDraft([
            makeDraftItem("expired-line", expired)
        ]);
        const batch = makeBatch(
            "expired-batch",
            new Date("2026-10-31T00:00:00.000Z")
        );
        const plan = prepareSaleDraft(
            draft,
            makeContext([expired], [batch]),
            { now: () => new Date("2026-11-06T10:00:00.000Z") }
        );

        expect(() => completeSale(plan, {
            now: () => new Date("2026-11-06T10:01:00.000Z")
        })).toThrow("Explicit confirmation is required");
        expect(expired.stockQuantities[0].quantity).toBe(2);
    });

    it("rejects stale later inventory atomically without completing or approving a draft", () => {
        const first = makeRecord("stale-first", null, [
            { packagingLevelId: "card", quantity: 5 }
        ]);
        const later = makeRecord("stale-later", null, [
            { packagingLevelId: "bottle", quantity: 3 }
        ], "tablet-250");
        const draft = makeDraft([
            makeDraftItem("first-line", first),
            makeDraftItem("later-line", later, {
                variantId: "tablet-250",
                packagingLevelId: "bottle",
                defaultSellingPrice: 10,
                appliedSellingPrice: 10
            })
        ]);
        const plan = prepareSaleDraft(
            draft,
            {
                products: [product],
                inventoryRecords: [first, later],
                inventoryBatches: []
            }
        );
        const completion = completeSale(plan, {
            makeId: () => "stale-multi-sale",
            makeEventId: () => "stale-multi-event"
        });
        const changedLater = {
            ...later,
            stockQuantities: [{ packagingLevelId: "bottle", quantity: 2 }]
        };
        const state = {
            ...createInitialApplicationState(),
            products: [product],
            inventoryRecords: [first, changedLater],
            inventoryBatches: [],
            activityEvents: [],
            sales: [],
            saleDrafts: [draft]
        };

        expect(() => applicationReducer(state, {
            type: "sale.completed",
            completion
        })).toThrow("Inventory changed after the sale was prepared");
        expect(state.inventoryRecords).toEqual([first, changedLater]);
        expect(state.sales).toEqual([]);
        expect(state.activityEvents).toEqual([]);
        expect(state.saleDrafts[0].status).toBe("draft");
    });

    it("rejects changed product definitions without committing sale state", () => {
        const record = makeRecord("stale-product-stock", null, [
            { packagingLevelId: "card", quantity: 5 }
        ]);
        const plan = makeSalePlan(record);
        const completion = completeSale(plan, {
            makeEventId: () => "stale-product-event"
        });
        const changedProduct = { ...product, name: "Changed medicine" };
        const state = {
            ...createInitialApplicationState(),
            products: [changedProduct],
            inventoryRecords: [record],
            inventoryBatches: [],
            activityEvents: [],
            sales: []
        };

        expect(() => applicationReducer(state, {
            type: "sale.completed",
            completion
        })).toThrow("Product definitions changed");
        expect(state.inventoryRecords[0]).toBe(record);
        expect(state.activityEvents).toEqual([]);
        expect(state.sales).toEqual([]);
    });

    it("rejects mismatched Activity without partially updating any inventory", () => {
        const first = makeRecord("activity-first", null, [
            { packagingLevelId: "card", quantity: 5 }
        ]);
        const second = makeRecord("activity-second", null, [
            { packagingLevelId: "card", quantity: 5 }
        ]);
        const draft = makeDraft([
            makeDraftItem("first-line", first),
            makeDraftItem("second-line", second)
        ]);
        const plan = prepareSaleDraft(
            draft,
            makeContext([first, second], [])
        );
        const completion = completeSale(plan, {
            makeId: () => "mismatched-sale",
            makeEventId: () => "mismatched-event"
        });
        const tampered = {
            ...completion,
            events: completion.events.map((event) =>
                event.type === "sale.completed"
                    ? { ...event, finalAmount: 0 }
                    : event
            )
        };
        const state = {
            ...createInitialApplicationState(),
            products: [product],
            inventoryRecords: [first, second],
            inventoryBatches: [],
            activityEvents: [],
            sales: [],
            saleDrafts: [draft]
        };

        expect(() => applicationReducer(state, {
            type: "sale.completed",
            completion: tampered
        })).toThrow("Sale Activity does not match");
        expect(state.inventoryRecords).toEqual([first, second]);
        expect(state.activityEvents).toEqual([]);
        expect(state.sales).toEqual([]);
        expect(state.saleDrafts[0].status).toBe("draft");
    });

    it("rejects an existing sale operation when its completed sale is missing", () => {
        const record = makeRecord("orphaned-operation-stock", null, [
            { packagingLevelId: "card", quantity: 4 }
        ]);
        const draft = makeDraft([]);
        const plan = makeSalePlan(record);
        const completion = completeSale(plan, {
            makeEventId: () => "orphaned-operation-event"
        });
        const state = {
            ...createInitialApplicationState(),
            products: [product],
            inventoryRecords: [record],
            inventoryBatches: [],
            activityEvents: [completion.events[0]],
            sales: [],
            saleDrafts: [draft]
        };
        const before = structuredClone(state);

        expect(() => applicationReducer(state, {
            type: "sale.completed",
            completion
        })).toThrow(
            "Sale operation key already exists without a matching completed sale."
        );
        expect(state.inventoryRecords).toEqual(before.inventoryRecords);
        expect(state.sales).toEqual(before.sales);
        expect(state.activityEvents).toEqual(before.activityEvents);
        expect(state.saleDrafts).toEqual(before.saleDrafts);
    });

    it("rejects an existing sale operation with a mismatched Activity payload", () => {
        const record = makeRecord("mismatched-operation-stock", null, [
            { packagingLevelId: "card", quantity: 4 }
        ]);
        const draft = makeDraft([]);
        const plan = makeSalePlan(record);
        const completion = completeSale(plan, {
            makeEventId: () => "mismatched-operation-event"
        });
        const matchingEvent = completion.events[0];
        if (matchingEvent.type !== "sale.completed") {
            throw new Error("Expected sale completion Activity.");
        }
        const mismatchedEvent = {
            ...matchingEvent,
            finalAmount: matchingEvent.finalAmount + 1
        };
        const state = {
            ...createInitialApplicationState(),
            products: [product],
            inventoryRecords: [record],
            inventoryBatches: [],
            activityEvents: [mismatchedEvent],
            sales: [completion.sale],
            saleDrafts: [draft]
        };
        const before = structuredClone(state);

        expect(() => applicationReducer(state, {
            type: "sale.completed",
            completion
        })).toThrow(
            "Sale operation key already exists without a matching completed sale."
        );
        expect(state.inventoryRecords).toEqual(before.inventoryRecords);
        expect(state.sales).toEqual(before.sales);
        expect(state.activityEvents).toEqual(before.activityEvents);
        expect(state.saleDrafts).toEqual(before.saleDrafts);
    });

    it("rejects an existing sale operation key belonging to another sale", () => {
        const record = makeRecord("conflicting-operation-stock", null, [
            { packagingLevelId: "card", quantity: 4 }
        ]);
        const draft = makeDraft([]);
        const plan = makeSalePlan(record);
        const completion = completeSale(plan, {
            makeEventId: () => "conflicting-operation-event"
        });
        const originalOperation = completion.events[0];
        if (originalOperation.type !== "sale.completed") {
            throw new Error("Expected sale completion Activity.");
        }
        const conflictingOperation = {
            ...originalOperation,
            saleId: "different-sale"
        };
        const state = {
            ...createInitialApplicationState(),
            products: [product],
            inventoryRecords: [record],
            inventoryBatches: [],
            activityEvents: [conflictingOperation],
            sales: [],
            saleDrafts: [draft]
        };
        const before = structuredClone(state);

        expect(() => applicationReducer(state, {
            type: "sale.completed",
            completion
        })).toThrow(
            "Sale operation key already exists without a matching completed sale."
        );
        expect(state.inventoryRecords).toEqual(before.inventoryRecords);
        expect(state.sales).toEqual(before.sales);
        expect(state.activityEvents).toEqual(before.activityEvents);
        expect(state.saleDrafts).toEqual(before.saleDrafts);
    });

    it("rejects a stale plan atomically when stock changed before commit", () => {
        const record = makeRecord("stale-stock", null, [
            { packagingLevelId: "box", quantity: 0 },
            { packagingLevelId: "pack", quantity: 0 },
            { packagingLevelId: "card", quantity: 3 }
        ]);
        const plan = makeSalePlan(record);
        const changedRecord = {
            ...record,
            stockQuantities: [
                ...record.stockQuantities.slice(0, 2),
                { packagingLevelId: "card", quantity: 2 }
            ]
        };
        const state = {
            ...createInitialApplicationState(),
            products: [product],
            inventoryRecords: [changedRecord],
            inventoryBatches: [],
            activityEvents: [],
            sales: []
        };
        const completion = completeSale(plan, {
            now: () => new Date("2026-11-06T10:01:00.000Z"),
            makeEventId: () => "stale-event"
        });

        expect(() => applicationReducer(state, {
            type: "sale.completed",
            completion
        })).toThrow("Inventory changed after the sale was prepared");
        expect(state.inventoryRecords[0].stockQuantities[2].quantity).toBe(2);
        expect(state.activityEvents).toEqual([]);
        expect(state.sales).toEqual([]);
    });

    it("rejects a stale plan atomically when selected batch metadata changed", () => {
        const record = makeRecord("stale-batch-stock", "batch-stale", [
            { packagingLevelId: "box", quantity: 0 },
            { packagingLevelId: "pack", quantity: 0 },
            { packagingLevelId: "card", quantity: 3 }
        ]);
        const originalBatch = makeBatch(
            "batch-stale",
            new Date("2027-01-31T00:00:00.000Z")
        );
        const plan = makeSalePlan(record, [originalBatch]);
        const changedBatch = {
            ...originalBatch,
            expiryDate: new Date("2027-02-28T00:00:00.000Z")
        };
        const state = {
            ...createInitialApplicationState(),
            products: [product],
            inventoryRecords: [record],
            inventoryBatches: [changedBatch],
            activityEvents: [],
            sales: []
        };
        const completion = completeSale(plan, {
            now: () => new Date("2026-11-06T10:01:00.000Z"),
            makeEventId: () => "stale-batch-event"
        });

        expect(() => applicationReducer(state, {
            type: "sale.completed",
            completion
        })).toThrow("Batch information changed after the sale was prepared");
        expect(state.inventoryRecords[0]).toBe(record);
        expect(state.activityEvents).toEqual([]);
        expect(state.sales).toEqual([]);
    });
});
