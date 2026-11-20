import { describe, expect, it } from "vitest";
import { prepareActivityEvents } from "../activity/activity";
import {
    applicationReducer,
    createInitialApplicationState
} from "../applicationState";
import type { ApplicationState } from "../applicationState";
import {
    addDeliveryDraftItem,
    createDeliveryDraft,
    type DeliveryDraft,
    type DeliveryDraftItem,
    updateDeliveryDraftItem
} from "./deliveryDraft";
import { prepareDeliveryApproval } from "./deliveryApproval";
import type { productStructure } from "../products/productStructure";
import { resolveDefaultSellingPrice } from "../sales/salesEngine";

const product: productStructure = {
    id: "medicine",
    name: "Medicine",
    variant: [{
        id: "tablets",
        variantName: "Tablets",
        packagingHierarchy: [{
            id: "box",
            name: "Box",
            costPrice: null,
            sellingPrice: 10,
            quantityofNextLevel: 10,
            nextLevelId: "unit"
        }, {
            id: "unit",
            name: "Unit",
            costPrice: null,
            sellingPrice: 1,
            quantityofNextLevel: null,
            nextLevelId: null
        }]
    }]
};

function makeDraft(
    id: string,
    deliveryDate = "2026-11-07",
    receivedBy = "Pharmacist"
): DeliveryDraft {
    return createDeliveryDraft({
        deliveryDate,
        receivedBy,
        supplier: "Supplier",
        invoiceNumber: "INV-1"
    }, {
        makeId: () => id,
        now: () => new Date("2026-11-07T10:00:00.000Z")
    });
}

function makeItem(
    id: string,
    overrides: Partial<DeliveryDraftItem> = {}
): DeliveryDraftItem {
    return {
        deliveryItemId: id,
        productId: product.id,
        variantId: product.variant[0].id,
        packagingLevelId: "box",
        quantity: 3,
        batchNumber: "LOT-1",
        expiryDate: "2027-12-31",
        costPrice: null,
        sellingPrice: null,
        ...overrides
    };
}

function withItems(
    draft: DeliveryDraft,
    items: DeliveryDraftItem[]
): DeliveryDraft {
    return items.reduce(
        (current, item, index) => addDeliveryDraftItem(
            current,
            item,
            new Date(Date.parse(draft.updatedAt) + (index + 1) * 60_000)
                .toISOString()
        ),
        draft
    );
}

function initialState(deliveryDrafts: DeliveryDraft[]): ApplicationState {
    return {
        ...createInitialApplicationState(),
        products: [product],
        inventoryRecords: [],
        inventoryBatches: [],
        deliveryDrafts,
        activityEvents: []
    };
}

function makePlan(
    draft: DeliveryDraft,
    state: ApplicationState,
    ids = ["batch-new", "inventory-new"]
) {
    let index = 0;
    return prepareDeliveryApproval(
        draft,
        state.products,
        state.inventoryRecords,
        state.inventoryBatches,
        {
            makeId: () => ids[index++] ?? `generated-${index}`,
            now: () => new Date("2026-11-08T12:00:00.000Z")
        }
    );
}

function makeApprovalEvent(
    plan: ReturnType<typeof makePlan>
) {
    return prepareActivityEvents([plan.activity], {
        now: () => new Date(plan.draft.updatedAt)
    })[0]!;
}

describe("Delivery approval and stock-in", () => {
    it("validates the recipient, date, and at least one item before planning stock", () => {
        const state = initialState([]);
        expect(() => makePlan(makeDraft("empty", "2026-11-07", ""), state))
            .toThrow("Received by is required.");
        expect(() => makePlan(makeDraft("empty", "", "Pharmacist"), state))
            .toThrow("Delivery date must be a valid date");
        expect(() => makePlan(makeDraft("empty", "2026-02-30"), state))
            .toThrow("Delivery date must be a valid date");
        expect(() => makePlan(makeDraft("empty"), state))
            .toThrow("Add at least one valid item");
        expect(state.inventoryRecords).toEqual([]);
        expect(state.inventoryBatches).toEqual([]);
    });

    it("rejects a bad later item without mutating inventory or batches", () => {
        const state = initialState([]);
        const draft = withItems(makeDraft("invalid-items"), [
            makeItem("item-1"),
            makeItem("item-2", { productId: "missing-product" })
        ]);
        expect(() => makePlan(draft, state)).toThrow("Item 2: Product does not exist.");
        expect(state.inventoryRecords).toEqual([]);
        expect(state.inventoryBatches).toEqual([]);
        expect(state.activityEvents).toEqual([]);
    });

    it("adds stock at the received packaging level and keeps expiry variants separate", () => {
        const state = initialState([]);
        const draft = withItems(makeDraft("multiple-expiries"), [
            makeItem("item-1", { quantity: 2 }),
            makeItem("item-2", {
                quantity: 5,
                expiryDate: "2028-12-31"
            })
        ]);
        const plan = makePlan(draft, state);

        expect(plan.inventoryBatches).toHaveLength(2);
        expect(plan.inventoryBatches.map((batch) =>
            batch.expiryDate?.toISOString().slice(0, 10)
        )).toEqual(["2027-12-31", "2028-12-31"]);
        expect(plan.inventoryBatches.map((batch) =>
            batch.pricingByPackagingLevel
        )).toEqual([[
            { packagingLevelId: "box", costPrice: null, sellingPrice: null }
        ], [
            { packagingLevelId: "box", costPrice: null, sellingPrice: null }
        ]]);
        expect(plan.inventoryRecords).toHaveLength(2);
        expect(plan.inventoryRecords.map((record) => record.stockQuantities))
            .toEqual([
                [{ packagingLevelId: "box", quantity: 2 }],
                [{ packagingLevelId: "box", quantity: 5 }]
            ]);
    });

    it("records entered prices for a new batch without changing Product defaults", () => {
            const state = initialState([]);
            const productBefore = structuredClone(product);
            const draft = withItems(makeDraft("priced-new-batch"), [
                makeItem("priced-item", {
                    costPrice: 7.25,
                    sellingPrice: 11.5
                })
            ]);
            const plan = makePlan(draft, state);

            expect(plan.inventoryBatches).toHaveLength(1);
            expect(plan.inventoryBatches[0].pricingByPackagingLevel).toEqual([{
                packagingLevelId: "box",
                costPrice: 7.25,
                sellingPrice: 11.5
            }]);
            expect(plan.draft.items[0]).toMatchObject({
                costPrice: 7.25,
                sellingPrice: 11.5
            });
            expect(product).toEqual(productBefore);

            const event = makeApprovalEvent(plan);
            expect(event.type).toBe("delivery.received");
            if (event.type === "delivery.received") {
                expect(event.items[0].pricingAtReceipt).toEqual({
                    packagingLevelId: "box",
                    costPrice: 7.25,
                    sellingPrice: 11.5
                });
            }
    });

    it("adds later receipts to matching numbered batches without packaging conversion", () => {
        const state = initialState([]);
        const first = withItems(makeDraft("receipt-1"), [
            makeItem("item-1", { quantity: 2 })
        ]);
        const firstPlan = makePlan(first, state);
        const second = withItems(makeDraft("receipt-2"), [
            makeItem("item-2", { quantity: 4 })
        ]);
        const secondPlan = prepareDeliveryApproval(
            second,
            state.products,
            firstPlan.inventoryRecords,
            firstPlan.inventoryBatches,
            {
                makeId: () => "unused-id",
                now: () => new Date("2026-11-08T12:00:00.000Z")
            }
        );

        expect(secondPlan.inventoryBatches).toHaveLength(1);
        expect(secondPlan.inventoryRecords).toHaveLength(1);
        expect(secondPlan.inventoryRecords[0].stockQuantities).toEqual([
            { packagingLevelId: "box", quantity: 6 }
        ]);
    });

    it.each([
        {
            name: "original line order",
            prices: [
                { costPrice: 20, sellingPrice: 30 },
                { costPrice: 21, sellingPrice: 31 }
            ],
            expectedPrice: { costPrice: 21, sellingPrice: 31 }
        },
        {
            name: "reversed line order",
            prices: [
                { costPrice: 21, sellingPrice: 31 },
                { costPrice: 20, sellingPrice: 30 }
            ],
            expectedPrice: { costPrice: 20, sellingPrice: 30 }
        }
    ])(
        "approves repeated receipt lines using the last line's price ($name)",
        ({ prices, expectedPrice }) => {
            const draft = withItems(makeDraft(`duplicate-lines-${prices[0].costPrice}`), [
                makeItem("item-first", {
                    quantity: 2,
                    ...prices[0]
                }),
                makeItem("item-second", {
                    quantity: 4,
                    ...prices[1]
                })
            ]);
            const targetBatch = {
                batchId: "batch-target",
                productId: product.id,
                variantId: product.variant[0].id,
                batchNumber: "LOT-1",
                expiryDate: new Date("2027-12-31T00:00:00.000Z"),
                pricingByPackagingLevel: [{
                    packagingLevelId: "box",
                    costPrice: 40,
                    sellingPrice: 48
                }, {
                    packagingLevelId: "unit",
                    costPrice: null,
                    sellingPrice: 15
                }]
            };
            const otherBatch = {
                batchId: "batch-other",
                productId: product.id,
                variantId: product.variant[0].id,
                batchNumber: "LOT-2",
                expiryDate: new Date("2027-12-31T00:00:00.000Z"),
                pricingByPackagingLevel: [{
                    packagingLevelId: "box",
                    costPrice: 70,
                    sellingPrice: 80
                }]
            };
            const state = {
                ...initialState([draft]),
                inventoryBatches: [targetBatch, otherBatch],
                inventoryRecords: [{
                    id: "inventory-target",
                    productId: product.id,
                    variantId: product.variant[0].id,
                    batchId: targetBatch.batchId,
                    stockQuantities: [{ packagingLevelId: "box", quantity: 5 }]
                }, {
                    id: "inventory-other",
                    productId: product.id,
                    variantId: product.variant[0].id,
                    batchId: otherBatch.batchId,
                    stockQuantities: [{ packagingLevelId: "box", quantity: 9 }]
                }]
            };
            const productBefore = structuredClone(state.products[0]);
            const plan = makePlan(draft, state);
            const committed = applicationReducer(state, {
                type: "delivery.approved",
                plan,
                event: makeApprovalEvent(plan)
            });

            expect(committed.inventoryRecords.find(
                (record) => record.batchId === targetBatch.batchId
            )?.stockQuantities).toEqual([
                { packagingLevelId: "box", quantity: 11 }
            ]);
            expect(committed.inventoryRecords.find(
                (record) => record.batchId === otherBatch.batchId
            )?.stockQuantities).toEqual([
                { packagingLevelId: "box", quantity: 9 }
            ]);
            expect(committed.inventoryBatches.find(
                (batch) => batch.batchId === targetBatch.batchId
            )?.pricingByPackagingLevel).toEqual([
                {
                    packagingLevelId: "box",
                    ...expectedPrice
                },
                {
                    packagingLevelId: "unit",
                    costPrice: null,
                    sellingPrice: 15
                }
            ]);
            expect(committed.inventoryBatches.find(
                (batch) => batch.batchId === otherBatch.batchId
            )).toEqual(otherBatch);
            expect(committed.products[0]).toEqual(productBefore);
            expect(committed.deliveryDrafts[0].items).toEqual(draft.items);
        }
    );

    it("commits multiple products, variants, batches, and received packaging quantities together", () => {
        const capsuleVariant = {
            id: "capsules",
            variantName: "Capsules",
            packagingHierarchy: [{
                id: "pack",
                name: "Pack",
                costPrice: null,
                sellingPrice: 8,
                quantityofNextLevel: 10,
                nextLevelId: "capsule"
            }, {
                id: "capsule",
                name: "Capsule",
                costPrice: null,
                sellingPrice: 1,
                quantityofNextLevel: null,
                nextLevelId: null
            }]
        };
        const tabletsAndCapsules = {
            ...product,
            variant: [...product.variant, capsuleVariant]
        };
        const secondProduct: productStructure = {
            id: "solution",
            name: "Oral solution",
            variant: [{
                id: "bottle",
                variantName: "Bottle",
                packagingHierarchy: [{
                    id: "unit",
                    name: "Bottle",
                    costPrice: null,
                    sellingPrice: 20,
                    quantityofNextLevel: null,
                    nextLevelId: null
                }]
            }]
        };
        const state = {
            ...initialState([]),
            products: [tabletsAndCapsules, secondProduct]
        };
        const draft = withItems(makeDraft("delivery-multiple-stock-lines"), [
            makeItem("item-boxes", { quantity: 5 }),
            makeItem("item-units", {
                packagingLevelId: "unit",
                quantity: 12
            }),
            makeItem("item-second-batch", {
                packagingLevelId: "unit",
                quantity: 20,
                batchNumber: "LOT-2"
            }),
            makeItem("item-other-expiry", {
                quantity: 2,
                expiryDate: "2028-12-31"
            }),
            makeItem("item-capsules", {
                variantId: "capsules",
                packagingLevelId: "pack",
                quantity: 12,
                batchNumber: "LOT-3"
            }),
            makeItem("item-second-product", {
                productId: "solution",
                variantId: "bottle",
                packagingLevelId: "unit",
                quantity: 20,
                batchNumber: "LOT-4"
            })
        ]);
        const approvalState = {
            ...state,
            deliveryDrafts: [draft]
        };
        const plan = makePlan(draft, approvalState);
        const event = makeApprovalEvent(plan);
        const committed = applicationReducer(approvalState, {
            type: "delivery.approved",
            plan,
            event
        });
        const stockByBatch = new Map(
            committed.inventoryRecords.map((record) => [
                record.batchId,
                {
                    productId: record.productId,
                    variantId: record.variantId,
                    stock: record.stockQuantities
                }
            ])
        );

        expect(committed.deliveryDrafts[0].status).toBe("received");
        expect(committed.inventoryBatches).toHaveLength(5);
        expect(committed.inventoryRecords).toHaveLength(5);
        expect(stockByBatch.get(
            committed.inventoryBatches.find((batch) =>
                batch.batchNumber === "LOT-1" &&
                batch.expiryDate?.toISOString().slice(0, 10) === "2027-12-31"
            )?.batchId ?? ""
        )).toMatchObject({
            productId: "medicine",
            variantId: "tablets",
            stock: [
                { packagingLevelId: "box", quantity: 5 },
                { packagingLevelId: "unit", quantity: 12 }
            ]
        });
        expect([...stockByBatch.values()]).toContainEqual({
            productId: "medicine",
            variantId: "tablets",
            stock: [{ packagingLevelId: "unit", quantity: 20 }]
        });
        expect([...stockByBatch.values()]).toContainEqual({
            productId: "medicine",
            variantId: "capsules",
            stock: [{ packagingLevelId: "pack", quantity: 12 }]
        });
        expect([...stockByBatch.values()]).toContainEqual({
            productId: "solution",
            variantId: "bottle",
            stock: [{ packagingLevelId: "unit", quantity: 20 }]
        });
        expect(committed.activityEvents).toHaveLength(1);
        expect(committed.activityEvents[0]).toMatchObject({
            type: "delivery.received",
            deliveryId: draft.deliveryId,
            items: expect.arrayContaining([
                expect.objectContaining({
                    productId: "solution",
                    variantId: "bottle",
                    batch: expect.objectContaining({ batchNumber: "LOT-4" }),
                    stock: [expect.objectContaining({ quantity: 20 })]
                }),
                expect.objectContaining({
                    productId: "medicine",
                    variantId: "capsules",
                    batch: expect.objectContaining({ batchNumber: "LOT-3" }),
                    stock: [expect.objectContaining({
                        packagingLevel: expect.objectContaining({
                            packagingLevelId: "pack"
                        }),
                        quantity: 12
                    })]
                })
            ])
        });
    });

    it("keeps unnumbered batches separate by receipt date", () => {
        const state = initialState([]);
        const first = withItems(makeDraft("unnumbered-1", "2026-11-07"), [
            makeItem("item-1", {
                batchNumber: null,
                expiryDate: null
            }),
            makeItem("item-2", {
                batchNumber: null,
                expiryDate: null,
                quantity: 2
            })
        ]);
        const firstPlan = makePlan(first, state);
        const second = withItems(makeDraft("unnumbered-2", "2026-11-08"), [
            makeItem("item-2", {
                batchNumber: null,
                expiryDate: null
            })
        ]);
        let nextId = 0;
        const secondPlan = prepareDeliveryApproval(
            second,
            state.products,
            firstPlan.inventoryRecords,
            firstPlan.inventoryBatches,
            {
                makeId: () => `new-unnumbered-id-${nextId++}`,
                now: () => new Date("2026-11-08T12:00:00.000Z")
            }
        );

        expect(secondPlan.inventoryBatches.map((batch) => batch.receivedDate))
            .toEqual(["2026-11-07", "2026-11-08"]);
        expect(secondPlan.inventoryRecords).toHaveLength(2);
        expect(firstPlan.inventoryRecords[0].stockQuantities).toEqual([
            { packagingLevelId: "box", quantity: 5 }
        ]);
    });

    it("commits inventory, batches, received status, and one Activity event atomically", () => {
        const draft = withItems(makeDraft("delivery-atomic"), [
            makeItem("item-1")
        ]);
        const state = initialState([draft]);
        const plan = makePlan(draft, state);
        const event = makeApprovalEvent(plan);
        const action = {
            type: "delivery.approved" as const,
            plan,
            event
        };
        const committed = applicationReducer(state, action);

        expect(committed.deliveryDrafts[0]).toMatchObject({
            deliveryId: draft.deliveryId,
            status: "received",
            deliveryDate: draft.deliveryDate,
            receivedBy: draft.receivedBy,
            supplier: draft.supplier,
            invoiceNumber: draft.invoiceNumber,
            updatedAt: plan.draft.updatedAt
        });
        expect(committed.inventoryRecords[0].stockQuantities).toEqual([
            { packagingLevelId: "box", quantity: 3 }
        ]);
        expect(committed.inventoryBatches).toHaveLength(1);
        expect(committed.activityEvents).toHaveLength(1);
        expect(committed.activityEvents[0]).toMatchObject({
            type: "delivery.received",
            deliveryId: draft.deliveryId,
            deliveryDate: draft.deliveryDate,
            receivedBy: draft.receivedBy,
            supplierName: "Supplier",
            invoiceNumber: "INV-1",
            occurredAt: expect.any(String),
            items: [{
                productId: "medicine",
                productName: "Medicine",
                variantId: "tablets",
                variantName: "Tablets",
                batch: expect.objectContaining({
                    productId: "medicine",
                    variantId: "tablets",
                    batchNumber: "LOT-1",
                    expiryDate: "2027-12-31T00:00:00.000Z"
                }),
                stock: [{
                    packagingLevel: expect.objectContaining({
                        packagingLevelId: "box",
                        name: "Box"
                    }),
                    quantity: 3
                }]
            }]
        });
        expect(Date.parse(committed.activityEvents[0].occurredAt)).not.toBeNaN();
        expect(Date.parse(committed.activityEvents[0].occurredAt)).toBe(
            Date.parse(committed.deliveryDrafts[0].updatedAt)
        );
        expect(applicationReducer(committed, action)).toBe(committed);
        expect(committed.inventoryRecords[0].stockQuantities[0].quantity).toBe(3);
    });

    it("rechecks matching existing batches and exact inventory deltas at commit", () => {
        const draft = withItems(makeDraft("delivery-existing-batch"), [
            makeItem("item-1", {
                costPrice: 18,
                sellingPrice: 23
            })
        ]);
        const batch = {
            batchId: "batch-existing",
            productId: product.id,
            variantId: product.variant[0].id,
            batchNumber: "LOT-1",
            expiryDate: new Date("2027-12-31T00:00:00.000Z"),
            pricingByPackagingLevel: [{
                packagingLevelId: "box",
                costPrice: 10,
                sellingPrice: 15
            }, {
                packagingLevelId: "unit",
                costPrice: 1,
                sellingPrice: 2
            }]
        };
        const record = {
            id: "inventory-existing",
            productId: product.id,
            variantId: product.variant[0].id,
            batchId: batch.batchId,
            stockQuantities: [{ packagingLevelId: "box", quantity: 2 }]
        };
        const state = {
            ...initialState([draft]),
            inventoryRecords: [record],
            inventoryBatches: [batch]
        };
        const plan = makePlan(draft, state);
        const event = makeApprovalEvent(plan);
        const committed = applicationReducer(state, {
            type: "delivery.approved",
            plan,
            event
        });

        expect(committed.inventoryBatches).toEqual([{
            ...batch,
            pricingByPackagingLevel: [{
                packagingLevelId: "box",
                costPrice: 18,
                sellingPrice: 23
            }, {
                packagingLevelId: "unit",
                costPrice: 1,
                sellingPrice: 2
            }]
        }]);
        expect(committed.inventoryRecords).toEqual([{
            ...record,
            stockQuantities: [{ packagingLevelId: "box", quantity: 5 }]
        }]);
        expect(committed.activityEvents).toHaveLength(1);
    });

    it("sets empty prices to null for only the received packaging level", () => {
        const draft = withItems(makeDraft("delivery-clear-price"), [
            makeItem("item-box", {
                costPrice: null,
                sellingPrice: null
            })
        ]);
        const batch = {
            batchId: "batch-priced",
            productId: product.id,
            variantId: product.variant[0].id,
            batchNumber: "LOT-1",
            expiryDate: new Date("2027-12-31T00:00:00.000Z"),
            pricingByPackagingLevel: [{
                packagingLevelId: "box",
                costPrice: 40,
                sellingPrice: 48
            }, {
                packagingLevelId: "unit",
                costPrice: 12,
                sellingPrice: 15
            }]
        };
        const state = {
            ...initialState([draft]),
            inventoryBatches: [batch],
            inventoryRecords: [{
                id: "inventory-priced",
                productId: product.id,
                variantId: product.variant[0].id,
                batchId: batch.batchId,
                stockQuantities: [{ packagingLevelId: "box", quantity: 2 }]
            }]
        };

        const plan = makePlan(draft, state);

        expect(plan.inventoryBatches).toEqual([{
            ...batch,
            pricingByPackagingLevel: [{
                packagingLevelId: "box",
                costPrice: null,
                sellingPrice: null
            }, {
                packagingLevelId: "unit",
                costPrice: 12,
                sellingPrice: 15
            }]
        }]);

        const committed = applicationReducer(state, {
            type: "delivery.approved",
            plan,
            event: makeApprovalEvent(plan)
        });
        const committedBatch = committed.inventoryBatches[0];
        if (!committedBatch) {
            throw new Error("Expected the received batch to remain in inventory.");
        }
        expect(resolveDefaultSellingPrice(
            product,
            product.variant[0].id,
            "box",
            committedBatch
        )).toBe(10);
    });

    it("updates multiple packaging levels in one matching batch independently", () => {
        const draft = withItems(makeDraft("delivery-two-levels"), [
            makeItem("item-box", {
                costPrice: 41,
                sellingPrice: 49
            }),
            makeItem("item-unit", {
                packagingLevelId: "unit",
                costPrice: 13,
                sellingPrice: 16
            })
        ]);
        const batch = {
            batchId: "batch-multi-level",
            productId: product.id,
            variantId: product.variant[0].id,
            batchNumber: "LOT-1",
            expiryDate: new Date("2027-12-31T00:00:00.000Z"),
            pricingByPackagingLevel: [{
                packagingLevelId: "box",
                costPrice: 40,
                sellingPrice: 48
            }, {
                packagingLevelId: "unit",
                costPrice: 12,
                sellingPrice: 15
            }]
        };
        const state = {
            ...initialState([draft]),
            inventoryBatches: [batch]
        };
        const plan = makePlan(draft, state);

        expect(plan.inventoryBatches).toHaveLength(1);
        expect(plan.inventoryBatches[0].pricingByPackagingLevel).toEqual([
            { packagingLevelId: "box", costPrice: 41, sellingPrice: 49 },
            { packagingLevelId: "unit", costPrice: 13, sellingPrice: 16 }
        ]);
        if (plan.activity.type !== "delivery.received") {
            throw new Error("Expected a delivery receipt Activity.");
        }
        expect(plan.activity.items.map((item) =>
            item.batch?.pricingByPackagingLevel
        )).toEqual([
            [{
                packagingLevelId: "box",
                costPrice: 41,
                sellingPrice: 49,
                packagingLevelName: "Box"
            }, {
                packagingLevelId: "unit",
                costPrice: 13,
                sellingPrice: 16,
                packagingLevelName: "Unit"
            }],
            [{
                packagingLevelId: "box",
                costPrice: 41,
                sellingPrice: 49,
                packagingLevelName: "Box"
            }, {
                packagingLevelId: "unit",
                costPrice: 13,
                sellingPrice: 16,
                packagingLevelName: "Unit"
            }]
        ]);
        expect(plan.activity.items.map((item) => item.pricingAtReceipt))
            .toEqual([
                { packagingLevelId: "box", costPrice: 41, sellingPrice: 49 },
                { packagingLevelId: "unit", costPrice: 13, sellingPrice: 16 }
            ]);
    });

    it("keeps historical receipt prices after a later delivery changes the batch", () => {
        const firstDraft = withItems(makeDraft("first-price-receipt"), [
            makeItem("first-item", { costPrice: 5, sellingPrice: 8 })
        ]);
        const firstState = initialState([firstDraft]);
        const firstPlan = makePlan(firstDraft, firstState);
        const firstEvent = makeApprovalEvent(firstPlan);
        const afterFirst = applicationReducer(firstState, {
            type: "delivery.approved",
            plan: firstPlan,
            event: firstEvent
        });
        const secondDraft = withItems(makeDraft("second-price-receipt"), [
            makeItem("second-item", { costPrice: 7, sellingPrice: 12 })
        ]);
        const beforeSecondApproval = {
            ...afterFirst,
            deliveryDrafts: [...afterFirst.deliveryDrafts, secondDraft]
        };
        const secondPlan = makePlan(secondDraft, beforeSecondApproval);
        const secondEvent = makeApprovalEvent(secondPlan);
        const afterSecond = applicationReducer(beforeSecondApproval, {
            type: "delivery.approved",
            plan: secondPlan,
            event: secondEvent
        });

        expect(afterSecond.inventoryBatches[0].pricingByPackagingLevel).toEqual([{
            packagingLevelId: "box",
            costPrice: 7,
            sellingPrice: 12
        }]);
        expect(resolveDefaultSellingPrice(
            product,
            product.variant[0].id,
            "box",
            afterSecond.inventoryBatches[0]
        )).toBe(12);
        expect(afterSecond.deliveryDrafts[0].items[0]).toMatchObject({
            costPrice: 5,
            sellingPrice: 8
        });
        const firstHistoricalEvent = afterSecond.activityEvents[0];
        expect(firstHistoricalEvent.type).toBe("delivery.received");
        if (firstHistoricalEvent.type === "delivery.received") {
            expect(firstHistoricalEvent.items[0].pricingAtReceipt).toEqual({
                packagingLevelId: "box",
                costPrice: 5,
                sellingPrice: 8
            });
            expect(firstHistoricalEvent.items[0].batch?.pricingByPackagingLevel)
                .toEqual([{
                    packagingLevelId: "box",
                    costPrice: 5,
                    sellingPrice: 8,
                    packagingLevelName: "Box"
                }]);
        }
    });

    it("keeps existing batch prices when a receipt has a different batch identity", () => {
        const existingBatch = {
            batchId: "batch-existing-price",
            productId: product.id,
            variantId: product.variant[0].id,
            batchNumber: "LOT-1",
            expiryDate: new Date("2027-12-31T00:00:00.000Z"),
            pricingByPackagingLevel: [{
                packagingLevelId: "box",
                costPrice: null,
                sellingPrice: 15
            }]
        };
        const existingRecord = {
            id: "inventory-existing-price",
            productId: product.id,
            variantId: product.variant[0].id,
            batchId: existingBatch.batchId,
            stockQuantities: [{ packagingLevelId: "box", quantity: 2 }]
        };
        const draft = withItems(makeDraft("different-batch-receipt"), [
            makeItem("new-batch-item", {
                batchNumber: "LOT-2",
                sellingPrice: 25
            })
        ]);
        const state = {
            ...initialState([draft]),
            inventoryBatches: [existingBatch],
            inventoryRecords: [existingRecord]
        };
        const plan = makePlan(draft, state);
        const committed = applicationReducer(state, {
            type: "delivery.approved",
            plan,
            event: makeApprovalEvent(plan)
        });
        const committedExistingBatch = committed.inventoryBatches.find(
            (batch) => batch.batchId === existingBatch.batchId
        );
        const committedNewBatch = committed.inventoryBatches.find(
            (batch) => batch.batchNumber === "LOT-2"
        );

        expect(committed.inventoryBatches).toHaveLength(2);
        expect(committedExistingBatch).toEqual(existingBatch);
        if (!committedExistingBatch || !committedNewBatch) {
            throw new Error("Expected both distinct inventory batches to remain.");
        }
        expect(resolveDefaultSellingPrice(
            product,
            product.variant[0].id,
            "box",
            committedExistingBatch
        )).toBe(15);
        expect(resolveDefaultSellingPrice(
            product,
            product.variant[0].id,
            "box",
            committedNewBatch
        )).toBe(25);
    });

    it("does not commit any state if the atomic approval action is invalid", () => {
        const draft = withItems(makeDraft("delivery-rejected"), [
            makeItem("item-1")
        ]);
        const state = initialState([draft]);
        const plan = makePlan(draft, state);
        const event = makeApprovalEvent(plan);
        if (event.type !== "delivery.received") {
            throw new Error("Expected a delivery completion event.");
        }
        const before = structuredClone(state);
        expect(() => applicationReducer(state, {
            type: "delivery.approved",
            plan,
            event: { ...event, deliveryId: "different-delivery" }
        })).toThrow("Delivery approval does not match the active draft.");
        expect(() => applicationReducer(state, {
            type: "delivery.approved",
            plan,
            event: { ...event, receivedBy: "Someone Else" }
        })).toThrow("Delivery approval does not match the active draft.");
        expect(() => applicationReducer(state, {
            type: "delivery.approved",
            plan: {
                ...plan,
                inventoryRecords: plan.inventoryRecords.map((record) => ({
                    ...record,
                    stockQuantities: record.stockQuantities.map((stock) => ({
                        ...stock,
                        quantity: stock.quantity + 1
                    }))
                }))
            },
            event
        })).toThrow("Delivery approval does not match the active draft.");
        expect(() => applicationReducer(state, {
            type: "delivery.approved",
            plan: {
                ...plan,
                draft: {
                    ...plan.draft,
                    items: plan.draft.items.map((item) => ({
                        ...item,
                        costPrice: 999
                    }))
                }
            },
            event
        })).toThrow("Delivery approval does not match the active draft.");
        expect(() => applicationReducer(state, {
            type: "delivery.approved",
            plan: {
                ...plan,
                inventoryBatches: plan.inventoryBatches.map((batch) => ({
                    ...batch,
                    pricingByPackagingLevel: [{
                        packagingLevelId: "unknown-level",
                        costPrice: 1,
                        sellingPrice: 2
                    }]
                }))
            },
            event
        })).toThrow("Delivery approval does not match the active draft.");
        expect(() => applicationReducer(state, {
            type: "delivery.approved",
            plan: {
                ...plan,
                inventoryBatches: plan.inventoryBatches.map((batch) => ({
                    ...batch,
                    batchNumber: "FABRICATED-LOT"
                }))
            },
            event
        })).toThrow("Delivery approval does not match the active draft.");
        expect(() => applicationReducer(state, {
            type: "delivery.approved",
            plan: {
                ...plan,
                inventoryRecords: []
            },
            event
        })).toThrow("Delivery approval does not match the active draft.");
        expect(() => applicationReducer(state, {
            type: "delivery.approved",
            plan: {
                ...plan,
                inventoryRecords: [
                    ...plan.inventoryRecords,
                    {
                        id: "unrelated-inventory",
                        productId: product.id,
                        variantId: product.variant[0].id,
                        batchId: null,
                        stockQuantities: [{ packagingLevelId: "box", quantity: 99 }]
                    }
                ]
            },
            event
        })).toThrow("Delivery approval does not match the active draft.");
        expect(() => applicationReducer(state, {
            type: "delivery.approved",
            plan,
            event: {
                ...event,
                items: event.items.map((item) => ({
                    ...item,
                    pricingAtReceipt: {
                        ...item.pricingAtReceipt,
                        sellingPrice: 999
                    },
                    stock: item.stock.map((stock) => ({
                        ...stock,
                        quantity: stock.quantity + 1
                    }))
                }))
            }
        })).toThrow("Delivery approval does not match the active draft.");
        expect(() => applicationReducer(state, {
            type: "delivery.approved",
            plan,
            event: {
                ...event,
                occurredAt: new Date(
                    Date.parse(event.occurredAt) + 1000
                ).toISOString()
            }
        })).toThrow("Delivery approval contains invalid Activity metadata.");
        expect(state).toEqual(before);

        const cancelledState = {
            ...state,
            deliveryDrafts: [{ ...draft, status: "cancelled" as const }]
        };
        const cancelledBefore = structuredClone(cancelledState);
        expect(() => applicationReducer(cancelledState, {
            type: "delivery.approved",
            plan,
            event
        })).toThrow("Cannot approve a cancelled delivery.");
        expect(cancelledState).toEqual(cancelledBefore);
    });

    it("rejects tampered batch pricing in the Activity event without changing state", () => {
        const previousDraft = withItems(makeDraft("previous-delivery"), [
            makeItem("previous-item", {
                costPrice: 4,
                sellingPrice: 8
            })
        ]);
        const previousPlan = makePlan(previousDraft, initialState([previousDraft]));
        const previousEvent = makeApprovalEvent(previousPlan);
        const stateWithHistory = applicationReducer(
            initialState([previousDraft]),
            {
                type: "delivery.approved",
                plan: previousPlan,
                event: previousEvent
            }
        );
        const activeDraft = withItems(makeDraft("tampered-pricing-delivery"), [
            makeItem("tampered-pricing-item", {
                costPrice: 6,
                sellingPrice: 9
            })
        ]);
        const state = {
            ...stateWithHistory,
            deliveryDrafts: [...stateWithHistory.deliveryDrafts, activeDraft]
        };
        const plan = makePlan(activeDraft, state);
        const event = makeApprovalEvent(plan);
        if (event.type !== "delivery.received") {
            throw new Error("Expected a delivery completion event.");
        }
        const before = structuredClone(state);
        const tamperedEvent = {
            ...event,
            items: event.items.map((item) => item.batch
                ? {
                    ...item,
                    batch: {
                        ...item.batch,
                        pricingByPackagingLevel:
                            item.batch.pricingByPackagingLevel.map((pricing) => ({
                                ...pricing,
                                costPrice: (pricing.costPrice ?? 0) + 1
                            }))
                    }
                }
                : item)
        };

        expect(state.inventoryRecords).not.toHaveLength(0);
        expect(state.inventoryBatches).not.toHaveLength(0);
        expect(state.deliveryDrafts.some((draft) => draft.status === "received"))
            .toBe(true);
        expect(state.activityEvents).toHaveLength(1);
        expect(() => applicationReducer(state, {
            type: "delivery.approved",
            plan,
            event: tamperedEvent
        })).toThrow("Delivery approval does not match the active draft.");
        expect(state).toEqual(before);
    });

    it("rejects approval if an affected current batch price changes after planning", () => {
        const draft = withItems(makeDraft("stale-batch-price"), [
            makeItem("item-box", { costPrice: 6, sellingPrice: 9 })
        ]);
        const batch = {
            batchId: "batch-stale-price",
            productId: product.id,
            variantId: product.variant[0].id,
            batchNumber: "LOT-1",
            expiryDate: new Date("2027-12-31T00:00:00.000Z"),
            pricingByPackagingLevel: [{
                packagingLevelId: "box",
                costPrice: 4,
                sellingPrice: 8
            }, {
                packagingLevelId: "unit",
                costPrice: 1,
                sellingPrice: 2
            }]
        };
        const state = {
            ...initialState([draft]),
            inventoryBatches: [batch],
            inventoryRecords: [{
                id: "inventory-stale-price",
                productId: product.id,
                variantId: product.variant[0].id,
                batchId: batch.batchId,
                stockQuantities: [{ packagingLevelId: "box", quantity: 1 }]
            }]
        };
        const plan = makePlan(draft, state);
        const event = makeApprovalEvent(plan);
        const staleState = {
            ...state,
            inventoryBatches: [{
                ...batch,
                pricingByPackagingLevel: [
                    ...batch.pricingByPackagingLevel.slice(0, 1),
                    {
                        packagingLevelId: "unit",
                        costPrice: 1,
                        sellingPrice: 3
                    }
                ]
            }]
        };
        const before = structuredClone(staleState);

        expect(() => applicationReducer(staleState, {
            type: "delivery.approved",
            plan,
            event
        })).toThrow("Delivery approval does not match the active draft.");
        expect(staleState).toEqual(before);
    });

    it("rejects delivery items that reference a packaging level outside the variant", () => {
        const state = initialState([]);
        const invalidDraft = withItems(makeDraft("invalid-packaging-price"), [
            makeItem("invalid-item", {
                packagingLevelId: "unknown-level",
                costPrice: 1
            })
        ]);

        expect(() => makePlan(invalidDraft, state)).toThrow(
            "Item 1: Packaging level does not belong to the selected variant."
        );
        expect(state.inventoryRecords).toEqual([]);
        expect(state.inventoryBatches).toEqual([]);
        expect(state.activityEvents).toEqual([]);
    });

    it("rejects an unrelated batch added to the submitted approval plan atomically", () => {
        const draft = withItems(makeDraft("delivery-extra-batch"), [
            makeItem("item-1")
        ]);
        const state = initialState([draft]);
        const plan = makePlan(draft, state);
        const event = makeApprovalEvent(plan);
        const before = structuredClone(state);
        const action = {
            type: "delivery.approved" as const,
            plan: {
                ...plan,
                inventoryBatches: [
                    ...plan.inventoryBatches,
                    {
                        batchId: "unrelated-batch",
                        productId: product.id,
                        variantId: product.variant[0].id,
                        batchNumber: "UNRELATED-LOT",
                        expiryDate: null,
                        pricingByPackagingLevel: []
                    }
                ]
            },
            event
        };

        expect(() => applicationReducer(state, action)).toThrow(
            "Delivery approval does not match the active draft."
        );
        expect(state).toEqual(before);
    });

    it("rejects a plan prepared before the draft is edited atomically", () => {
        const draft = withItems(makeDraft("delivery-stale-plan"), [
            makeItem("item-1")
        ]);
        const state = initialState([draft]);
        const plan = makePlan(draft, state);
        const event = makeApprovalEvent(plan);
        const editedDraft = updateDeliveryDraftItem(
            draft,
            "item-1",
            { quantity: 4 },
            "2026-11-07T10:02:00.000Z"
        );
        const editedState = {
            ...state,
            deliveryDrafts: [editedDraft]
        };
        const before = structuredClone(editedState);

        expect(editedState.deliveryDrafts[0]).toMatchObject({
            status: "draft",
            updatedAt: "2026-11-07T10:02:00.000Z",
            items: [{ quantity: 4 }]
        });
        expect(() => applicationReducer(editedState, {
            type: "delivery.approved",
            plan,
            event
        })).toThrow("Delivery approval does not match the active draft.");
        expect(editedState).toEqual(before);
    });
});
