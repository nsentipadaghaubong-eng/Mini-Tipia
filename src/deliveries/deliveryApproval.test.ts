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
    type DeliveryDraftItem
} from "./deliveryDraft";
import { prepareDeliveryApproval } from "./deliveryApproval";
import type { productStructure } from "../products/productStructure";

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
        expect(plan.inventoryRecords).toHaveLength(2);
        expect(plan.inventoryRecords.map((record) => record.stockQuantities))
            .toEqual([
                [{ packagingLevelId: "box", quantity: 2 }],
                [{ packagingLevelId: "box", quantity: 5 }]
            ]);
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
        const [event] = prepareActivityEvents([plan.activity]);
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
    });

    it("commits inventory, batches, received status, and one Activity event atomically", () => {
        const draft = withItems(makeDraft("delivery-atomic"), [
            makeItem("item-1")
        ]);
        const state = initialState([draft]);
        const plan = makePlan(draft, state);
        const [event] = prepareActivityEvents([plan.activity]);
        const action = {
            type: "delivery.approved" as const,
            plan,
            event
        };
        const committed = applicationReducer(state, action);

        expect(committed.deliveryDrafts[0].status).toBe("received");
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
            invoiceNumber: "INV-1"
        });
        expect(applicationReducer(committed, action)).toBe(committed);
        expect(committed.inventoryRecords[0].stockQuantities[0].quantity).toBe(3);
    });

    it("does not commit any state if the atomic approval action is invalid", () => {
        const draft = withItems(makeDraft("delivery-rejected"), [
            makeItem("item-1")
        ]);
        const state = initialState([draft]);
        const plan = makePlan(draft, state);
        const [event] = prepareActivityEvents([plan.activity]);
        if (event.type !== "delivery.received") {
            throw new Error("Expected a delivery completion event.");
        }
        expect(() => applicationReducer(state, {
            type: "delivery.approved",
            plan,
            event: { ...event, deliveryId: "different-delivery" }
        })).toThrow("Delivery approval does not match the active draft.");
        expect(state.deliveryDrafts).toEqual([draft]);
        expect(state.inventoryRecords).toEqual([]);
        expect(state.inventoryBatches).toEqual([]);
        expect(state.activityEvents).toEqual([]);
    });
});
