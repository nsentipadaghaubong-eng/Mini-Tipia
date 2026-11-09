import { describe, expect, it } from "vitest";
import {
    applicationReducer,
    createInitialApplicationState
} from "../applicationState";
import type { ApplicationState } from "../applicationState";
import {
    addSaleDraftItem,
    cancelSaleDraft,
    createSaleDraft,
    removeSaleDraftItem,
    updateSaleDraftDetails,
    updateSaleDraftItem,
    validateSaleDraft,
    type SaleDraft,
    type SaleDraftItem
} from "./salesDraft";

const start = "2026-11-06T18:00:00.000Z";
const later = "2026-11-06T18:01:00.000Z";

function makeDraft(id = "draft-1"): SaleDraft {
    return createSaleDraft({
        makeId: () => id,
        now: () => new Date(start)
    });
}

function makeItem(
    lineId: string,
    overrides: Partial<SaleDraftItem> = {}
): SaleDraftItem {
    return {
        lineId,
        productId: "product-1",
        variantId: "variant-1",
        inventoryRecordId: "inventory-1",
        batchId: "batch-1",
        packagingLevelId: "box",
        quantity: 2,
        defaultSellingPrice: 10,
        appliedSellingPrice: 9,
        discountAmount: 2,
        ...overrides
    };
}

function stateWithDrafts(...saleDrafts: SaleDraft[]): ApplicationState {
    return {
        ...createInitialApplicationState(),
        saleDrafts
    };
}

describe("Sales draft domain", () => {
    it("creates an empty draft with a unique ID, draft status, and timestamps", () => {
        expect(makeDraft()).toEqual({
            draftId: "draft-1",
            status: "draft",
            createdAt: start,
            updatedAt: start,
            items: []
        });
    });

    it("supports multiple lines and adding, updating, and removing items immutably", () => {
        const draft = makeDraft();
        const withFirst = addSaleDraftItem(draft, makeItem("line-1"), later);
        const withSecond = addSaleDraftItem(
            withFirst,
            makeItem("line-2", {
                productId: "product-2",
                variantId: "variant-2",
                inventoryRecordId: "inventory-2",
                batchId: null,
                packagingLevelId: "unit"
            }),
            "2026-11-06T18:02:00.000Z"
        );
        const updated = updateSaleDraftItem(
            withSecond,
            "line-1",
            { quantity: 3, appliedSellingPrice: 8, discountAmount: 1 },
            "2026-11-06T18:03:00.000Z"
        );
        const removed = removeSaleDraftItem(
            updated,
            "line-2",
            "2026-11-06T18:04:00.000Z"
        );

        expect(draft.items).toEqual([]);
        expect(withFirst.items).toHaveLength(1);
        expect(withSecond.items).toHaveLength(2);
        expect(updated.items[0]).toMatchObject({
            lineId: "line-1",
            quantity: 3,
            appliedSellingPrice: 8,
            discountAmount: 1
        });
        expect(removed.items.map((item) => item.lineId)).toEqual(["line-1"]);
        expect(removed.updatedAt).toBe("2026-11-06T18:04:00.000Z");
    });

    it("updates and clears optional customer, date, staff, and notes details", () => {
        const draft = updateSaleDraftDetails(makeDraft(), {
            customerName: "  Customer Name ",
            customerAddress: " 1 Main Street ",
            saleDate: "2026-10-25",
            staffMember: {
                userId: " staff-1 ",
                displayName: " Pharmacist "
            },
            notes: "  Prescription checked "
        }, later);
        const cleared = updateSaleDraftDetails(draft, {
            customerName: null,
            customerAddress: "",
            saleDate: null,
            staffMember: null,
            notes: null
        }, "2026-11-06T18:02:00.000Z");

        expect(draft).toMatchObject({
            customerName: "Customer Name",
            customerAddress: "1 Main Street",
            saleDate: "2026-10-25",
            staffMember: {
                userId: "staff-1",
                displayName: "Pharmacist"
            },
            notes: "Prescription checked"
        });
        expect(cleared).not.toHaveProperty("customerName");
        expect(cleared).not.toHaveProperty("customerAddress");
        expect(cleared).not.toHaveProperty("saleDate");
        expect(cleared).not.toHaveProperty("staffMember");
        expect(cleared).not.toHaveProperty("notes");
    });

    it("rejects malformed optional text and staff values", () => {
        expect(() => updateSaleDraftDetails(makeDraft(), {
            customerName: 42 as unknown as string
        }, later)).toThrow("Optional sale draft details must be strings");
        expect(() => updateSaleDraftDetails(makeDraft(), {
            saleDate: "2026-02-30"
        }, later)).toThrow("Sale date must be a valid date");
        expect(() => updateSaleDraftDetails(makeDraft(), {
            staffMember: "staff" as unknown as { displayName: string }
        }, later)).toThrow("Sale draft staff member must be an object");
        expect(() => updateSaleDraftDetails(makeDraft(), {
            staffMember: [] as unknown as { displayName: string }
        }, later)).toThrow("Sale draft staff member must be an object");
        expect(() => validateSaleDraft({
            ...makeDraft(),
            notes: { text: "invalid" } as unknown as string
        })).toThrow("Optional sale draft details must be strings");
    });

    it("copies caller-supplied items and staff member values", () => {
        const draft = makeDraft();
        const item = makeItem("line-1");
        const withItem = addSaleDraftItem(draft, item, later);
        item.quantity = 9;
        item.productId = "changed";

        const staffMember = {
            userId: " staff-1 ",
            displayName: " Pharmacist "
        };
        const withStaff = updateSaleDraftDetails(withItem, {
            staffMember
        }, "2026-11-06T18:02:00.000Z");
        staffMember.userId = "changed";
        staffMember.displayName = "changed";

        expect(withItem.items[0].quantity).toBe(2);
        expect(withItem.items[0].productId).toBe("product-1");
        expect(withStaff.staffMember).toEqual({
            userId: "staff-1",
            displayName: "Pharmacist"
        });
        expect(withStaff.staffMember).not.toBe(staffMember);
    });

    it("cancels a draft and rejects further edits", () => {
        const draft = addSaleDraftItem(makeDraft(), makeItem("line-1"), later);
        const cancelled = cancelSaleDraft(
            draft,
            "2026-11-06T18:02:00.000Z"
        );

        expect(cancelled.status).toBe("cancelled");
        expect(cancelled.items).toEqual(draft.items);
        expect(() => updateSaleDraftItem(
            cancelled,
            "line-1",
            { quantity: 4 },
            "2026-11-06T18:03:00.000Z"
        )).toThrow("Cannot edit a cancelled sale draft");
        expect(() => cancelSaleDraft(
            cancelled,
            "2026-11-06T18:03:00.000Z"
        )).toThrow("Cannot edit a cancelled sale draft");
    });

    it.each([
        ["zero quantity", { quantity: 0 }],
        ["fractional quantity", { quantity: 1.5 }],
        ["unsafe quantity", { quantity: Number.MAX_SAFE_INTEGER + 1 }],
        ["negative default price", { defaultSellingPrice: -1 }],
        ["infinite applied price", { appliedSellingPrice: Number.POSITIVE_INFINITY }],
        ["negative discount", { discountAmount: -1 }],
        ["discount above subtotal", { discountAmount: 19 }]
    ])("rejects invalid %s", (_label, changes) => {
        expect(() => addSaleDraftItem(
            makeDraft(),
            makeItem("line-1", changes),
            later
        )).toThrow();
    });

    it("rejects blank IDs, duplicate line IDs, and duplicate draft IDs", () => {
        expect(() => addSaleDraftItem(
            makeDraft(),
            makeItem(" "),
            later
        )).toThrow("Sale draft line ID must not be empty");

        const draftWithLine = addSaleDraftItem(
            makeDraft(),
            makeItem("line-1"),
            later
        );
        expect(() => addSaleDraftItem(
            draftWithLine,
            makeItem("line-1"),
            "2026-11-06T18:02:00.000Z"
        )).toThrow("Duplicate sale draft line ID");
        expect(() => validateSaleDraft({
            ...draftWithLine,
            items: [...draftWithLine.items, makeItem("line-1")]
        })).toThrow("Duplicate sale draft line ID");
    });

    it("rejects malformed draft containers and item field types", () => {
        expect(() => validateSaleDraft(null as unknown as SaleDraft))
            .toThrow("Sale draft must be an object");
        expect(() => validateSaleDraft({
            ...makeDraft(),
            items: {} as unknown as SaleDraftItem[]
        })).toThrow("Sale draft items must be an array");

        const malformedItem = makeItem("line-1");
        expect(() => validateSaleDraft({
            ...makeDraft(),
            items: [null as unknown as SaleDraftItem]
        })).toThrow("Sale draft item must be an object");
        expect(() => validateSaleDraft({
            ...makeDraft(),
            items: [{
                ...malformedItem,
                quantity: "2" as unknown as number
            }]
        })).toThrow("Sale draft quantity must be a number");
        expect(() => validateSaleDraft({
            ...makeDraft(),
            items: [{
                ...malformedItem,
                productId: 7 as unknown as string
            }]
        })).toThrow("Product ID must be a string");
        expect(() => validateSaleDraft({
            ...makeDraft(),
            draftId: 3 as unknown as string
        })).toThrow("Sale draft ID must be a string");
    });

    it("rejects editing a draft whose status is approved", () => {
        const approved = {
            ...makeDraft(),
            status: "approved" as const
        };
        expect(() => addSaleDraftItem(
            approved,
            makeItem("line-1"),
            later
        )).toThrow("Cannot edit a approved sale draft");
        expect(() => updateSaleDraftDetails(
            approved,
            { notes: "changed" },
            later
        )).toThrow("Cannot edit a approved sale draft");
    });
});

describe("Sales draft application-state lifecycle", () => {
    it("creates multiple drafts and changes only the addressed draft", () => {
        const first = makeDraft("draft-1");
        const second = makeDraft("draft-2");
        const initial = stateWithDrafts();
        const withFirst = applicationReducer(initial, {
            type: "sale.draft_created",
            draft: first
        });
        const withBoth = applicationReducer(withFirst, {
            type: "sale.draft_created",
            draft: second
        });
        const withLine = applicationReducer(withBoth, {
            type: "sale.draft_item_added",
            draftId: first.draftId,
            item: makeItem("line-1"),
            updatedAt: later
        });
        const withDetails = applicationReducer(withLine, {
            type: "sale.draft_details_updated",
            draftId: first.draftId,
            changes: {
                customerName: "Customer",
                staffMember: { displayName: "Staff" },
                notes: "Note"
            },
            updatedAt: "2026-11-06T18:02:00.000Z"
        });

        expect(withBoth.saleDrafts.map((draft) => draft.draftId)).toEqual([
            "draft-1",
            "draft-2"
        ]);
        expect(withDetails.saleDrafts[0].items).toHaveLength(1);
        expect(withDetails.saleDrafts[0].customerName).toBe("Customer");
        expect(withDetails.saleDrafts[1]).toEqual(second);
        expect(withDetails.sales).toBe(initial.sales);
        expect(withDetails.inventoryRecords).toBe(initial.inventoryRecords);
        expect(withDetails.inventoryBatches).toBe(initial.inventoryBatches);
        expect(withDetails.activityEvents).toBe(initial.activityEvents);
    });

    it("allows reducer add, update, remove, and cancel operations for drafts", () => {
        const initial = stateWithDrafts(makeDraft());
        const added = applicationReducer(initial, {
            type: "sale.draft_item_added",
            draftId: "draft-1",
            item: makeItem("line-1"),
            updatedAt: later
        });
        const secondAdded = applicationReducer(added, {
            type: "sale.draft_item_added",
            draftId: "draft-1",
            item: makeItem("line-2"),
            updatedAt: "2026-11-06T18:02:00.000Z"
        });
        const updated = applicationReducer(secondAdded, {
            type: "sale.draft_item_updated",
            draftId: "draft-1",
            lineId: "line-1",
            changes: { quantity: 4 },
            updatedAt: "2026-11-06T18:03:00.000Z"
        });
        const removed = applicationReducer(updated, {
            type: "sale.draft_item_removed",
            draftId: "draft-1",
            lineId: "line-2",
            updatedAt: "2026-11-06T18:04:00.000Z"
        });
        const cancelled = applicationReducer(removed, {
            type: "sale.draft_cancelled",
            draftId: "draft-1",
            updatedAt: "2026-11-06T18:05:00.000Z"
        });

        expect(added.saleDrafts[0].items).toHaveLength(1);
        expect(updated.saleDrafts[0].items[0].quantity).toBe(4);
        expect(removed.saleDrafts[0].items.map((item) => item.lineId))
            .toEqual(["line-1"]);
        expect(cancelled.saleDrafts[0].status).toBe("cancelled");
    });

    it("rejects duplicate drafts and changes to cancelled or approved drafts", () => {
        const draft = makeDraft();
        const initial = stateWithDrafts(draft);
        expect(() => applicationReducer(initial, {
            type: "sale.draft_created",
            draft
        })).toThrow("Sale draft already exists");

        const cancelled = cancelSaleDraft(draft, later);
        expect(() => applicationReducer(
            stateWithDrafts(cancelled),
            {
                type: "sale.draft_item_added",
                draftId: draft.draftId,
                item: makeItem("line-1"),
                updatedAt: "2026-11-06T18:02:00.000Z"
            }
        )).toThrow("Cannot edit a cancelled sale draft");

        const approved = { ...draft, status: "approved" as const };
        expect(() => applicationReducer(
            stateWithDrafts(approved),
            {
                type: "sale.draft_details_updated",
                draftId: draft.draftId,
                changes: { notes: "changed" },
                updatedAt: later
            }
        )).toThrow("Cannot edit a approved sale draft");
    });

    it("does not mutate Inventory, batches, completed sales, or Activity on any draft operation", () => {
        const initial = createInitialApplicationState();
        const draft = makeDraft();
        const created = applicationReducer(initial, {
            type: "sale.draft_created",
            draft
        });
        const firstItemAdded = applicationReducer(created, {
            type: "sale.draft_item_added",
            draftId: draft.draftId,
            item: makeItem("line-1"),
            updatedAt: later
        });
        const secondItemAdded = applicationReducer(firstItemAdded, {
            type: "sale.draft_item_added",
            draftId: draft.draftId,
            item: makeItem("line-2", {
                productId: "product-2",
                variantId: "variant-2",
                inventoryRecordId: "inventory-2",
                batchId: null,
                packagingLevelId: "unit"
            }),
            updatedAt: "2026-11-06T18:02:00.000Z"
        });
        const itemUpdated = applicationReducer(secondItemAdded, {
            type: "sale.draft_item_updated",
            draftId: draft.draftId,
            lineId: "line-1",
            changes: { quantity: 3 },
            updatedAt: "2026-11-06T18:03:00.000Z"
        });
        const detailsUpdated = applicationReducer(itemUpdated, {
            type: "sale.draft_details_updated",
            draftId: draft.draftId,
            changes: { customerName: "Customer", notes: "Draft only" },
            updatedAt: "2026-11-06T18:04:00.000Z"
        });
        const itemRemoved = applicationReducer(detailsUpdated, {
            type: "sale.draft_item_removed",
            draftId: draft.draftId,
            lineId: "line-2",
            updatedAt: "2026-11-06T18:05:00.000Z"
        });
        const cancelled = applicationReducer(itemRemoved, {
            type: "sale.draft_cancelled",
            draftId: draft.draftId,
            updatedAt: "2026-11-06T18:06:00.000Z"
        });

        for (const state of [
            created,
            firstItemAdded,
            secondItemAdded,
            itemUpdated,
            detailsUpdated,
            itemRemoved,
            cancelled
        ]) {
            expect(state.inventoryRecords).toBe(initial.inventoryRecords);
            expect(state.inventoryBatches).toBe(initial.inventoryBatches);
            expect(state.sales).toBe(initial.sales);
            expect(state.activityEvents).toBe(initial.activityEvents);
        }
        expect(itemRemoved.saleDrafts[0].items).toHaveLength(1);
        expect(cancelled.activityEvents.some(
            (event) => event.type === "sale.completed"
        )).toBe(false);
    });
});
