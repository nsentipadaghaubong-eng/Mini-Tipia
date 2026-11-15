// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { productStructure } from "../../../products/productStructure";
import type { DeliveryDraft } from "../../../deliveries/deliveryDraft";
import type { InventoryCommit } from "./InventoryPage";
import InventoryPage from "./InventoryPage";

afterEach(cleanup);

const editableProduct: productStructure = {
    id: "product-editable",
    name: "Medicine",
    variant: [{
        id: "variant-editable",
        variantName: "Tablets",
        packagingHierarchy: [{
            id: "box-editable",
            name: "Box",
            costPrice: null,
            sellingPrice: null,
            quantityofNextLevel: null,
            nextLevelId: null
        }]
    }]
};

const editableBatch = {
    batchId: "batch-editable",
    productId: editableProduct.id,
    variantId: editableProduct.variant[0].id,
    batchNumber: "LOT-1",
    expiryDate: new Date("2027-01-31T00:00:00.000Z")
};

const editableRecord = {
    id: "inventory-editable",
    productId: editableProduct.id,
    variantId: editableProduct.variant[0].id,
    batchId: editableBatch.batchId,
    stockQuantities: [{ packagingLevelId: "box-editable", quantity: 4 }]
};

function renderInventoryEditor(options: {
    inventoryRecords?: typeof editableRecord[];
    inventoryBatches?: typeof editableBatch[];
    saleDrafts?: {
        draftId: string;
        status: "draft";
        createdAt: string;
        updatedAt: string;
        items: {
            lineId: string;
            productId: string;
            variantId: string;
            inventoryRecordId: string;
            batchId: string | null;
            packagingLevelId: string;
            quantity: number;
            defaultSellingPrice: number;
            appliedSellingPrice: number;
            discountAmount: number;
        }[];
    }[];
    deliveryDrafts?: DeliveryDraft[];
} = {}) {
    const onInventoryCommit = vi.fn<(commit: InventoryCommit) => void>();
    render(createElement(InventoryPage, {
        products: [editableProduct],
        inventoryRecords: options.inventoryRecords ?? [editableRecord],
        inventoryBatches: options.inventoryBatches ?? [editableBatch],
        onInventoryCommit,
        saleDrafts: options.saleDrafts,
        deliveryDrafts: options.deliveryDrafts,
        navigationRequest: {
            requestId: 1,
            intent: {
                type: "inventory.manage",
                productId: editableProduct.id,
                variantId: editableProduct.variant[0].id,
                inventoryId: editableRecord.id,
                batchId: editableBatch.batchId
            },
            consumed: true
        },
        onNavigate: () => undefined,
        onNavigationConsumed: () => undefined,
        onNavigationDismissed: () => undefined
    }));
    return onInventoryCommit;
}

function renderInventoryDetails(options: {
    inventoryRecords?: typeof editableRecord[];
    inventoryBatches?: typeof editableBatch[];
    saleDrafts?: {
        draftId: string;
        status: "draft";
        createdAt: string;
        updatedAt: string;
        items: {
            lineId: string;
            productId: string;
            variantId: string;
            inventoryRecordId: string;
            batchId: string | null;
            packagingLevelId: string;
            quantity: number;
            defaultSellingPrice: number;
            appliedSellingPrice: number;
            discountAmount: number;
        }[];
    }[];
    deliveryDrafts?: DeliveryDraft[];
} = {}) {
    const onInventoryCommit = vi.fn<(commit: InventoryCommit) => void>();
    render(createElement(InventoryPage, {
        products: [editableProduct],
        inventoryRecords: options.inventoryRecords ?? [editableRecord],
        inventoryBatches: options.inventoryBatches ?? [editableBatch],
        onInventoryCommit,
        saleDrafts: options.saleDrafts,
        deliveryDrafts: options.deliveryDrafts,
        navigationRequest: null,
        onNavigate: () => undefined,
        onNavigationConsumed: () => undefined,
        onNavigationDismissed: () => undefined
    }));
    fireEvent.click(screen.getAllByRole("button", { name: "Edit Stock" })[0]);
    return onInventoryCommit;
}

describe("InventoryPage navigation", () => {
    it("opens a locked inventory editor with an explanation for an active product draft", () => {
        const saleDraft = {
            draftId: "active-sale",
            status: "draft" as const,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            items: [{
                lineId: "sale-item",
                productId: editableProduct.id,
                variantId: editableProduct.variant[0].id,
                inventoryRecordId: editableRecord.id,
                batchId: editableBatch.batchId,
                packagingLevelId: "box-editable",
                quantity: 1,
                defaultSellingPrice: 1,
                appliedSellingPrice: 1,
                discountAmount: 0
            }]
        };
        const onInventoryCommit = renderInventoryEditor({ saleDrafts: [saleDraft] });

        expect(screen.getByRole("dialog", { name: "Edit Inventory" })).toBeVisible();
        expect(screen.getByLabelText("Batch number")).toBeDisabled();
        expect(screen.getByLabelText("Expiry date")).toBeDisabled();
        expect(screen.getByLabelText("Box")).toBeDisabled();
        expect(screen.getByRole("button", { name: "Add batch" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Edit Product Details" })).toBeEnabled();
        expect(screen.getByRole("alert")).toHaveTextContent(
            "This product is currently in a Sales draft. Its inventory and product structure cannot be modified until the draft is completed or cancelled. You can still edit its name and description."
        );
        expect(onInventoryCommit).not.toHaveBeenCalled();
    });

    it("opens inventory editing for the exact product and prioritizes its requested variant", () => {
        const product: productStructure = {
            id: "product-1",
            name: "Medicine",
            variant: [
                { id: "variant-1", variantName: "Tablets", packagingHierarchy: [] },
                {
                    id: "variant-2",
                    variantName: "Syrup",
                    packagingHierarchy: [{
                        id: "bottle",
                        name: "Bottle",
                        costPrice: null,
                        sellingPrice: null,
                        quantityofNextLevel: null,
                        nextLevelId: null
                    }]
                }
            ]
        };
        const inventoryRecords = [{
            id: "inventory-2",
            productId: product.id,
            variantId: "variant-2",
            batchId: "batch-2",
            stockQuantities: [{ packagingLevelId: "bottle", quantity: 8 }]
        }];
        const inventoryBatches = [{
            batchId: "batch-2",
            productId: product.id,
            variantId: "variant-2",
            batchNumber: "B2",
            expiryDate: null
        }];
        const onInventoryCommit = vi.fn();
        const markup = renderToStaticMarkup(createElement(InventoryPage, {
            products: [product],
            inventoryRecords,
            inventoryBatches,
            onInventoryCommit,
            navigationRequest: {
                requestId: 1,
                intent: {
                    type: "inventory.manage",
                    productId: product.id,
                    variantId: "variant-2",
                    inventoryId: "inventory-2",
                    batchId: "batch-2"
                },
                consumed: true
            },
            onNavigate: () => undefined,
            onNavigationConsumed: () => undefined,
            onNavigationDismissed: () => undefined
        }));

        expect(markup).toContain('role="dialog"');
        expect(markup).toContain("<h2 id=\"edit-modal-title\">Edit Inventory</h2>");
        expect(markup).toContain("<p>Medicine</p>");
        expect(markup.indexOf("Syrup")).toBeLessThan(markup.indexOf("Tablets"));
        expect(markup).toContain("B2");
        expect(markup).toContain('value="8"');
        expect(onInventoryCommit).not.toHaveBeenCalled();
    });

    it("does not open an inventory modal for a missing product", () => {
        const markup = renderToStaticMarkup(createElement(InventoryPage, {
            products: [],
            inventoryRecords: [],
            inventoryBatches: [],
            onInventoryCommit: () => undefined,
            navigationRequest: {
                requestId: 2,
                intent: {
                    type: "inventory.manage",
                    productId: "deleted-product",
                    variantId: "variant-1",
                    inventoryId: "inventory-1",
                    batchId: "batch-1"
                },
                consumed: true
            },
            onNavigate: () => undefined,
            onNavigationConsumed: () => undefined,
            onNavigationDismissed: () => undefined
        }));

        expect(markup).not.toContain('role="dialog"');
    });

    it("shows View and Edit Stock actions for each inventory item", () => {
        const product: productStructure = {
            id: "product-1",
            name: "Medicine",
            variant: [
                { id: "variant-1", variantName: "Tablets", packagingHierarchy: [] }
            ]
        };
        const markup = renderToStaticMarkup(createElement(InventoryPage, {
            products: [product],
            inventoryRecords: [{
                id: "inventory-1",
                productId: product.id,
                variantId: product.variant[0].id,
                batchId: null,
                stockQuantities: []
            }],
            inventoryBatches: [],
            onInventoryCommit: () => undefined,
            navigationRequest: null,
            onNavigate: () => undefined,
            onNavigationConsumed: () => undefined,
            onNavigationDismissed: () => undefined
        }));
        const actionsMarkup =
            markup.match(/<div class="product-card-actions">([\s\S]*?)<\/div>/)?.[1] ?? "";
        const actionLabels = Array.from(
            actionsMarkup.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g),
            ([, label]) => label.trim()
        );

        expect(actionLabels).toEqual(["View", "Edit Stock"]);
        expect(markup).not.toContain("Delete");
        expect(markup).not.toContain("Edit Product");
        expect(markup).not.toContain("Adjust Stock");
    });

    it("adds a batch with initial stock and records its Activity snapshot", () => {
        const onInventoryCommit = renderInventoryEditor();

        fireEvent.click(screen.getByRole("button", { name: "Add batch" }));
        const batchNumberInputs = screen.getAllByLabelText("Batch number");
        fireEvent.change(batchNumberInputs[1], { target: { value: "LOT-2" } });
        const stockInputs = screen.getAllByLabelText("Box");
        fireEvent.change(stockInputs[1], { target: { value: "7" } });
        fireEvent.change(screen.getByLabelText("Why are you making these changes?"), {
            target: { value: "Received additional stock" }
        });
        fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

        expect(onInventoryCommit).toHaveBeenCalledOnce();
        const commit = onInventoryCommit.mock.calls[0][0];
        expect(commit.inventoryBatches).toHaveLength(2);
        expect(commit.inventoryRecords).toHaveLength(2);
        expect(commit.inventoryRecords).toContainEqual(expect.objectContaining({
            batchId: expect.any(String),
            stockQuantities: [{ packagingLevelId: "box-editable", quantity: 7 }]
        }));
        expect(commit.activityEvents).toContainEqual(expect.objectContaining({
            type: "inventory.batch_created",
            source: "inventory_edit",
            inventory: expect.objectContaining({
                stock: [{
                    packagingLevel: expect.objectContaining({ name: "Box" }),
                    quantity: 7
                }]
            })
        }));
    });

    it("keeps products without inventory records available for the first batch", () => {
        render(createElement(InventoryPage, {
            products: [editableProduct],
            inventoryRecords: [],
            inventoryBatches: [],
            onInventoryCommit: () => undefined,
            navigationRequest: null,
            onNavigate: () => undefined,
            onNavigationConsumed: () => undefined,
            onNavigationDismissed: () => undefined
        }));

        fireEvent.click(screen.getByRole("button", { name: "View" }));
        fireEvent.click(screen.getByRole("button", { name: /Tablets/ }));
        expect(screen.getByText("No stock recorded")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Close product details" }));
        fireEvent.click(screen.getByRole("button", { name: "Edit Stock" }));
        expect(screen.getByRole("button", { name: "Add batch" })).toBeInTheDocument();
    });

    it("confirms batch deletion, supports cancellation, and removes stock on save", () => {
        const onInventoryCommit = renderInventoryDetails();

        fireEvent.click(screen.getByRole("button", { name: "Delete Batch" }));
        let confirmation = screen.getByRole("alertdialog", {
            name: "Delete batch?"
        });
        expect(confirmation).toHaveTextContent("LOT-1");
        expect(confirmation).toHaveTextContent("only be removed when you save");
        fireEvent.click(within(confirmation).getByRole("button", { name: "Cancel" }));
        expect(onInventoryCommit).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole("button", { name: "Delete Batch" }));
        confirmation = screen.getByRole("alertdialog", {
            name: "Delete batch?"
        });
        fireEvent.click(within(confirmation).getByRole("button", { name: "Confirm Delete" }));
        expect(onInventoryCommit).not.toHaveBeenCalled();
        const saveButton = screen.getByRole("button", { name: "Save Changes" });
        expect(saveButton).toBeDisabled();
        fireEvent.change(screen.getByLabelText("Reason for deleting Tablets / LOT-1"), {
            target: { value: "Remove recalled batch" }
        });
        fireEvent.change(screen.getByLabelText("Why are you making these changes?"), {
            target: { value: "Remove recalled batch" }
        });
        expect(saveButton).toBeEnabled();
        fireEvent.click(saveButton);

        expect(onInventoryCommit).toHaveBeenCalledOnce();
        const commit = onInventoryCommit.mock.calls[0][0];
        expect(commit.inventoryRecords).toEqual([]);
        expect(commit.inventoryBatches).toEqual([]);
        expect(commit.activityEvents).toContainEqual(expect.objectContaining({
            type: "inventory.batch_removed",
            reason: "Remove recalled batch",
            removedBatch: expect.objectContaining({ batchId: editableBatch.batchId }),
            affectedInventory: [expect.objectContaining({
                inventoryId: editableRecord.id,
                stock: [expect.objectContaining({ quantity: 4 })]
            })]
        }));
    });

    it("explains when a Sales draft prevents batch deletion", () => {
        const saleDraft = {
            draftId: "active-sale",
            status: "draft" as const,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            items: [{
                lineId: "sale-item",
                productId: editableProduct.id,
                variantId: editableProduct.variant[0].id,
                inventoryRecordId: editableRecord.id,
                batchId: editableBatch.batchId,
                packagingLevelId: "box-editable",
                quantity: 1,
                defaultSellingPrice: 1,
                appliedSellingPrice: 1,
                discountAmount: 0
            }]
        };
        const onInventoryCommit = renderInventoryDetails({ saleDrafts: [saleDraft] });

        expect(screen.getByRole("alert")).toHaveTextContent(
            "This product is currently in a Sales draft. Its inventory and product structure cannot be modified until the draft is completed or cancelled. You can still edit its name and description."
        );
        expect(screen.queryByRole("button", { name: "Delete Batch" }))
            .not.toBeInTheDocument();
        expect(onInventoryCommit).not.toHaveBeenCalled();
    });

    it("explains when a Receive Delivery draft matches the batch being deleted", () => {
        const deliveryDraft: DeliveryDraft = {
            deliveryId: "active-delivery",
            status: "draft",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            deliveryDate: "2026-01-01",
            receivedBy: "Pharmacist",
            items: [{
                deliveryItemId: "delivery-item",
                productId: editableProduct.id,
                variantId: editableProduct.variant[0].id,
                packagingLevelId: "box-editable",
                quantity: 3,
                batchNumber: "LOT-1",
                expiryDate: "2027-01-31"
            }]
        };
        const onInventoryCommit = renderInventoryDetails({
            deliveryDrafts: [deliveryDraft]
        });

        expect(screen.getByRole("alert")).toHaveTextContent(
            "This product is currently in a Receive Delivery draft. Its inventory and product structure cannot be modified until the draft is completed or cancelled. You can still edit its name and description."
        );
        expect(screen.queryByRole("button", { name: "Delete Batch" }))
            .not.toBeInTheDocument();
        expect(onInventoryCommit).not.toHaveBeenCalled();
    });

    it("requires a separate reason for every staged batch deletion", () => {
        const secondBatch = {
            ...editableBatch,
            batchId: "batch-editable-2",
            batchNumber: "LOT-2"
        };
        const secondRecord = {
            ...editableRecord,
            id: "inventory-editable-2",
            batchId: secondBatch.batchId,
            stockQuantities: [{ packagingLevelId: "box-editable", quantity: 6 }]
        };
        const onInventoryCommit = renderInventoryDetails({
            inventoryRecords: [editableRecord, secondRecord],
            inventoryBatches: [editableBatch, secondBatch]
        });

        fireEvent.click(screen.getAllByRole("button", { name: "Delete Batch" })[0]);
        fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", {
            name: "Confirm Delete"
        }));
        fireEvent.click(screen.getByRole("button", { name: "Delete Batch" }));
        fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", {
            name: "Confirm Delete"
        }));

        const saveButton = screen.getByRole("button", { name: "Save Changes" });
        expect(saveButton).toBeDisabled();
        fireEvent.change(screen.getByLabelText("Reason for deleting Tablets / LOT-1"), {
            target: { value: "Remove first lot" }
        });
        expect(saveButton).toBeDisabled();
        fireEvent.change(screen.getByLabelText("Reason for deleting Tablets / LOT-2"), {
            target: { value: "Remove second lot" }
        });
        fireEvent.change(screen.getByLabelText("Why are you making these changes?"), {
            target: { value: "Remove recalled stock" }
        });
        expect(saveButton).toBeEnabled();
        fireEvent.click(saveButton);

        expect(onInventoryCommit).toHaveBeenCalledOnce();
        expect(onInventoryCommit.mock.calls[0][0].activityEvents
            .filter((event) => event.type === "inventory.batch_removed")
            .map((event) => event.reason)
        ).toEqual(["Remove first lot", "Remove second lot"]);
    });

    it("discards a staged batch deletion when the inventory edit session is cancelled", () => {
        const onInventoryCommit = renderInventoryDetails();
        fireEvent.click(screen.getByRole("button", { name: "Delete Batch" }));
        fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", {
            name: "Confirm Delete"
        }));
        fireEvent.change(screen.getByLabelText("Reason for deleting Tablets / LOT-1"), {
            target: { value: "Remove recalled lot" }
        });
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

        expect(onInventoryCommit).not.toHaveBeenCalled();
        expect(screen.queryByRole("dialog", { name: "Edit Inventory" }))
            .not.toBeInTheDocument();
    });
});
