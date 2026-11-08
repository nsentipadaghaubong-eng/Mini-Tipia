import { describe, expect, it } from "vitest";
import {
    applicationReducer,
    createInitialApplicationState
} from "../applicationState";
import {
    addDeliveryDraftItem,
    createDeliveryDraft,
    removeDeliveryDraftItem,
    updateDeliveryDraftDetails,
    updateDeliveryDraftItem,
    validateDeliveryApprovalDetails,
    validateDeliveryDraft,
    type DeliveryDraft,
    type DeliveryDraftItem
} from "./deliveryDraft";

const createdAt = "2026-11-07T12:00:00.000Z";
const later = "2026-11-07T12:01:00.000Z";
const laterAgain = "2026-11-07T12:02:00.000Z";

function makeDraft(
    input: Partial<Parameters<typeof createDeliveryDraft>[0]> = {}
): DeliveryDraft {
    return createDeliveryDraft({
        ...input,
        receivedBy: input.receivedBy ?? "Pharmacist"
    }, {
        makeId: () => "delivery-1",
        now: () => new Date(createdAt)
    });
}

function makeItem(
    deliveryItemId: string,
    overrides: Partial<DeliveryDraftItem> = {}
): DeliveryDraftItem {
    return {
        deliveryItemId,
        productId: "product-1",
        variantId: "variant-1",
        packagingLevelId: "box",
        quantity: 3,
        batchNumber: "LOT-1",
        expiryDate: "2027-12-31",
        ...overrides
    };
}

describe("Delivery draft domain", () => {
    it("creates a draft with today's date, required recipient, and optional fields omitted", () => {
        expect(makeDraft()).toEqual({
            deliveryId: "delivery-1",
            status: "draft",
            createdAt,
            updatedAt: createdAt,
            deliveryDate: "2026-11-07",
            receivedBy: "Pharmacist",
            items: []
        });
    });

    it("accepts and normalizes optional supplier and invoice number", () => {
        expect(makeDraft({
            deliveryDate: "2026-11-06",
            receivedBy: "  Pharmacist A ",
            supplier: "  Supplier Ltd ",
            invoiceNumber: " INV-104 "
        })).toMatchObject({
            deliveryDate: "2026-11-06",
            receivedBy: "Pharmacist A",
            supplier: "Supplier Ltd",
            invoiceNumber: "INV-104"
        });
    });

    it("allows incomplete approval fields while drafting and validates them for approval", () => {
        expect(makeDraft({
            deliveryDate: "",
            receivedBy: ""
        })).toMatchObject({
            deliveryDate: "",
            receivedBy: ""
        });
        expect(() => validateDeliveryApprovalDetails("", "Pharmacist"))
            .toThrow("Delivery date must be a valid date");
        expect(() => validateDeliveryApprovalDetails("2026-02-30", "Pharmacist"))
            .toThrow("Delivery date must be a valid date");
        expect(() => validateDeliveryApprovalDetails("2026-11-07", " "))
            .toThrow("Received by is required");
    });

    it("preserves invalid header fields during draft edits", () => {
        expect(() => makeDraft({
            deliveryDate: "not-a-date",
            receivedBy: ""
        })).not.toThrow();
        expect(updateDeliveryDraftDetails(
            makeDraft(),
            { receivedBy: "", deliveryDate: "" },
            later
        )).toMatchObject({
            receivedBy: "",
            deliveryDate: ""
        });
    });

    it("updates delivery information immutably and clears optional fields", () => {
        const draft = makeDraft({
            supplier: "Supplier",
            invoiceNumber: "INV-1"
        });
        const updated = updateDeliveryDraftDetails(draft, {
            deliveryDate: "2026-11-06",
            receivedBy: "  Pharmacist B ",
            supplier: null,
            invoiceNumber: " "
        }, later);

        expect(draft).toMatchObject({
            deliveryDate: "2026-11-07",
            receivedBy: "Pharmacist",
            supplier: "Supplier",
            invoiceNumber: "INV-1",
            updatedAt: createdAt
        });
        expect(updated).toMatchObject({
            deliveryDate: "2026-11-06",
            receivedBy: "Pharmacist B",
            updatedAt: later
        });
        expect(updated).not.toHaveProperty("supplier");
        expect(updated).not.toHaveProperty("invoiceNumber");
    });

    it("adds multiple items, updates an item in place, and removes an item immutably", () => {
        const draft = makeDraft();
        const withFirst = addDeliveryDraftItem(
            draft,
            makeItem("item-1"),
            later
        );
        const withSecond = addDeliveryDraftItem(
            withFirst,
            makeItem("item-2", {
                productId: "product-2",
                variantId: "variant-2",
                packagingLevelId: "unit",
                batchNumber: null,
                expiryDate: null
            }),
            laterAgain
        );
        const updated = updateDeliveryDraftItem(
            withSecond,
            "item-1",
            { quantity: 5, batchNumber: " LOT-2 " },
            "2026-11-07T12:03:00.000Z"
        );
        const removed = removeDeliveryDraftItem(
            updated,
            "item-2",
            "2026-11-07T12:04:00.000Z"
        );

        expect(draft.items).toEqual([]);
        expect(withFirst.items).toHaveLength(1);
        expect(withSecond.items).toHaveLength(2);
        expect(updated.items[0]).toEqual(makeItem("item-1", {
            quantity: 5,
            batchNumber: "LOT-2"
        }));
        expect(removed.items.map((item) => item.deliveryItemId))
            .toEqual(["item-1"]);
        expect(removed.updatedAt).toBe("2026-11-07T12:04:00.000Z");
    });

    it.each([
        ["zero", 0],
        ["negative", -1],
        ["fractional", 1.5],
        ["unsafe", Number.MAX_SAFE_INTEGER + 1],
        ["not a number", Number.NaN]
    ])("rejects %s quantities", (_label, quantity) => {
        expect(() => addDeliveryDraftItem(
            makeDraft(),
            makeItem("item-1", { quantity }),
            later
        )).toThrow("Delivery quantity must be a positive safe integer");
    });

    it("rejects invalid item and delivery identifiers and duplicate item IDs", () => {
        const draft = makeDraft();
        expect(() => addDeliveryDraftItem(
            draft,
            makeItem(" "),
            later
        )).toThrow("Delivery item ID must not be empty");
        expect(() => addDeliveryDraftItem(
            draft,
            makeItem("item-1", { productId: " " }),
            later
        )).toThrow("Product ID must not be empty");
        expect(() => addDeliveryDraftItem(
            draft,
            makeItem("item-1", { variantId: "" }),
            later
        )).toThrow("Variant ID must not be empty");
        expect(() => addDeliveryDraftItem(
            draft,
            makeItem("item-1", { packagingLevelId: " " }),
            later
        )).toThrow("Packaging level ID must not be empty");

        const withItem = addDeliveryDraftItem(
            draft,
            makeItem("item-1"),
            later
        );
        expect(() => addDeliveryDraftItem(
            withItem,
            makeItem("item-1"),
            laterAgain
        )).toThrow("Duplicate delivery item ID");
        expect(() => validateDeliveryDraft({
            ...draft,
            deliveryId: " "
        })).toThrow("Delivery ID must not be empty");
    });

    it("rejects invalid optional dates and malformed optional text", () => {
        expect(() => addDeliveryDraftItem(
            makeDraft(),
            makeItem("item-1", { expiryDate: "2027-02-30" }),
            later
        )).toThrow("Expiry date must be a valid date");
        expect(() => makeDraft({
            supplier: 42 as unknown as string
        })).toThrow("Supplier must be a string");
        expect(() => makeDraft({
            invoiceNumber: {} as unknown as string
        })).toThrow("Invoice number must be a string");
    });

    it("rejects editing a non-draft or an item that does not exist", () => {
        const draft = addDeliveryDraftItem(
            makeDraft(),
            makeItem("item-1"),
            later
        );
        expect(() => removeDeliveryDraftItem(
            draft,
            "missing",
            laterAgain
        )).toThrow("Delivery item not found");
        expect(() => updateDeliveryDraftItem({
            ...draft,
            status: "received"
        }, "item-1", { quantity: 4 }, laterAgain))
            .toThrow("Cannot edit a received delivery draft");
    });
});

describe("Delivery draft application state", () => {
    it("stores draft changes without changing inventory, batches, or Activity", () => {
        const initial = createInitialApplicationState();
        const draft = makeDraft();
        const created = applicationReducer(initial, {
            type: "delivery.draft_created",
            draft
        });
        const withItem = applicationReducer(created, {
            type: "delivery.draft_item_added",
            deliveryId: draft.deliveryId,
            item: makeItem("item-1"),
            updatedAt: later
        });
        const updated = applicationReducer(withItem, {
            type: "delivery.draft_details_updated",
            deliveryId: draft.deliveryId,
            changes: {
                supplier: "Supplier",
                invoiceNumber: "INV-1",
                deliveryDate: "2026-11-06"
            },
            updatedAt: laterAgain
        });
        const itemUpdated = applicationReducer(updated, {
            type: "delivery.draft_item_updated",
            deliveryId: draft.deliveryId,
            deliveryItemId: "item-1",
            changes: { quantity: 4 },
            updatedAt: "2026-11-07T12:03:00.000Z"
        });
        const removed = applicationReducer(itemUpdated, {
            type: "delivery.draft_item_removed",
            deliveryId: draft.deliveryId,
            deliveryItemId: "item-1",
            updatedAt: "2026-11-07T12:04:00.000Z"
        });

        expect(removed.deliveryDrafts[0].items).toEqual([]);
        expect(removed.deliveryDrafts[0]).toMatchObject({
            supplier: "Supplier",
            invoiceNumber: "INV-1",
            deliveryDate: "2026-11-06"
        });
        expect(removed.inventoryRecords).toBe(initial.inventoryRecords);
        expect(removed.inventoryBatches).toBe(initial.inventoryBatches);
        expect(removed.activityEvents).toBe(initial.activityEvents);
        expect(removed.sales).toBe(initial.sales);
        expect(initial.deliveryDrafts).toEqual([]);
    });

    it("rejects duplicate delivery drafts without changing state", () => {
        const initial = createInitialApplicationState();
        const draft = makeDraft();
        const created = applicationReducer(initial, {
            type: "delivery.draft_created",
            draft
        });
        expect(() => applicationReducer(created, {
            type: "delivery.draft_created",
            draft
        })).toThrow("Delivery draft already exists");
        expect(created.deliveryDrafts).toHaveLength(1);
    });
});
