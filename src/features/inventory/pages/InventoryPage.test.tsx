// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { productStructure } from "../../../products/productStructure";
import type { inventory } from "../../../inventory/inventoryStock";
import type { inventoryBatch } from "../../../inventory/inventoryBatch";
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

const editableBatch: inventoryBatch = {
    batchId: "batch-editable",
    productId: editableProduct.id,
    variantId: editableProduct.variant[0].id,
    batchNumber: "LOT-1",
    expiryDate: new Date("2027-01-31T00:00:00.000Z"),
    pricingByPackagingLevel: []
};

const editableRecord = {
    id: "inventory-editable",
    productId: editableProduct.id,
    variantId: editableProduct.variant[0].id,
    batchId: editableBatch.batchId,
    stockQuantities: [{ packagingLevelId: "box-editable", quantity: 4 }]
};

function renderInventoryEditor(options: {
    product?: productStructure;
    inventoryRecords?: inventory[];
    inventoryBatches?: inventoryBatch[];
    withoutNavigationRequest?: boolean;
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
    const product = options.product ?? editableProduct;
    const selectedRecord = options.inventoryRecords?.[0] ?? editableRecord;
    render(createElement(InventoryPage, {
        products: [product],
        inventoryRecords: options.inventoryRecords ?? [editableRecord],
        inventoryBatches: options.inventoryBatches ?? [editableBatch],
        onInventoryCommit,
        saleDrafts: options.saleDrafts,
        deliveryDrafts: options.deliveryDrafts,
        navigationRequest: options.withoutNavigationRequest ? null : {
            requestId: 1,
            intent: {
                type: "inventory.manage",
                productId: selectedRecord.productId,
                variantId: selectedRecord.variantId,
                inventoryId: selectedRecord.id,
                batchId: selectedRecord.batchId
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
    product?: productStructure;
    inventoryRecords?: inventory[];
    inventoryBatches?: inventoryBatch[];
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
    const product = options.product ?? editableProduct;
    render(createElement(InventoryPage, {
        products: [product],
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

function renderLowStockStatusPage(
    quantity: number,
    threshold: number | null = 10
) {
    const productId = "product-low-stock";
    const variantId = "variant-low-stock";
    const product: productStructure = {
        id: productId,
        name: "Low-stock medicine",
        variant: [{
            id: variantId,
            variantName: "Cards",
            packagingHierarchy: [{
                id: "card",
                name: "Card",
                costPrice: null,
                sellingPrice: null,
                quantityofNextLevel: null,
                nextLevelId: null
            }],
            ...(threshold === null ? {} : {
                lowStockThreshold: {
                    quantity: threshold,
                    packagingLevelId: "card"
                }
            })
        }]
    };

    render(createElement(InventoryPage, {
        products: [product],
        inventoryRecords: [{
            id: "inventory-low-stock",
            productId,
            variantId,
            batchId: null,
            stockQuantities: [{ packagingLevelId: "card", quantity }]
        }],
        inventoryBatches: [],
        onInventoryCommit: () => undefined,
        navigationRequest: null,
        onNavigate: () => undefined,
        onNavigationConsumed: () => undefined,
        onNavigationDismissed: () => undefined
    }));
}

describe("InventoryPage navigation", () => {
    it("shows a Cancel-only warning instead of opening inventory editing for an active Sales draft", () => {
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
        const unbatchedRecord: inventory = {
            ...editableRecord,
            id: "inventory-unbatched-locked",
            batchId: null
        };
        const onInventoryCommit = renderInventoryEditor({
            saleDrafts: [saleDraft],
            inventoryRecords: [editableRecord, unbatchedRecord],
            withoutNavigationRequest: true
        });
        fireEvent.click(screen.getByRole("button", { name: "View" }));
        fireEvent.click(screen.getByRole("button", { name: "Close product details" }));
        fireEvent.click(screen.getByRole("button", { name: "Edit Stock" }));

        const warning = screen.getByRole("alertdialog", {
            name: "Product Currently Locked"
        });
        expect(warning).toHaveTextContent(
            "This product is currently in an active draft. You cannot edit its inventory until the draft is completed or cancelled."
        );
        expect(
            within(warning).getAllByRole("button").map((button) => button.textContent)
        ).toEqual(["Cancel"]);
        expect(
            screen.queryByRole("dialog", { name: "Edit Inventory" })
        ).not.toBeInTheDocument();

        fireEvent.click(within(warning).getByRole("button", { name: "Cancel" }));

        expect(screen.queryByRole("alertdialog", {
            name: "Product Currently Locked"
        })).not.toBeInTheDocument();
        expect(onInventoryCommit).not.toHaveBeenCalled();
    });

    it("shows the same warning instead of opening inventory editing for an active Receive Delivery draft", () => {
        const deliveryDraft: DeliveryDraft = {
            deliveryId: "active-delivery",
            status: "draft",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            deliveryDate: "2026-01-01",
            receivedBy: "Staff",
            items: [{
                deliveryItemId: "delivery-item",
                productId: editableProduct.id,
                variantId: editableProduct.variant[0].id,
                packagingLevelId: "box-editable",
                quantity: 1,
                batchNumber: "LOT-1",
                expiryDate: "2027-01-31",
                costPrice: null,
                sellingPrice: null
            }]
        };
        renderInventoryEditor({
            deliveryDrafts: [deliveryDraft],
            withoutNavigationRequest: true
        });
        fireEvent.click(screen.getByRole("button", { name: "Edit Stock" }));

        const warning = screen.getByRole("alertdialog", {
            name: "Product Currently Locked"
        });
        expect(warning).toHaveTextContent(
            "This product is currently in an active draft. You cannot edit its inventory until the draft is completed or cancelled."
        );
        expect(
            screen.queryByRole("dialog", { name: "Edit Inventory" })
        ).not.toBeInTheDocument();
        expect(
            within(warning).getAllByRole("button").map((button) => button.textContent)
        ).toEqual(["Cancel"]);
    });

    it("locks editing of another variant when an active Sales draft contains the product", () => {
        const otherVariant = {
            id: "variant-other",
            variantName: "Syrup",
            packagingHierarchy: []
        };
        const product = {
            ...editableProduct,
            variant: [...editableProduct.variant, otherVariant]
        };
        const otherVariantRecord: inventory = {
            id: "inventory-other-variant",
            productId: product.id,
            variantId: otherVariant.id,
            batchId: null,
            stockQuantities: []
        };
        const saleDraft = {
            draftId: "active-sale",
            status: "draft" as const,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            items: [{
                lineId: "sale-item",
                productId: product.id,
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

        renderInventoryEditor({
            product,
            inventoryRecords: [otherVariantRecord],
            inventoryBatches: [],
            saleDrafts: [saleDraft]
        });

        expect(screen.getByRole("alertdialog", {
            name: "Product Currently Locked"
        })).toBeVisible();
        expect(
            screen.queryByRole("dialog", { name: "Edit Inventory" })
        ).not.toBeInTheDocument();
    });

    it("opens the existing inventory editor for an unlocked product", () => {
        renderInventoryEditor({ withoutNavigationRequest: true });
        fireEvent.click(screen.getByRole("button", { name: "Edit Stock" }));

        expect(screen.getByRole("dialog", { name: "Edit Inventory" })).toBeVisible();
        expect(screen.queryByRole("alertdialog", {
            name: "Product Currently Locked"
        })).not.toBeInTheDocument();
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
            expiryDate: null,
            pricingByPackagingLevel: []
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
        const dialogMarkup = markup.slice(
            markup.indexOf('aria-labelledby="edit-modal-title"')
        );
        expect(dialogMarkup.indexOf("Syrup"))
            .toBeLessThan(dialogMarkup.indexOf("Tablets"));
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
        const expiryInputs = screen.getAllByLabelText("Expiry date");
        fireEvent.change(expiryInputs[1], { target: { value: "2028-03-31" } });
        const stockInputs = screen.getAllByLabelText("Box");
        fireEvent.change(stockInputs[1], { target: { value: "7" } });
        fireEvent.change(screen.getByLabelText("Why are you making these changes?"), {
            target: { value: "Received additional stock" }
        });
        fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

        expect(onInventoryCommit).toHaveBeenCalledOnce();
        const commit = onInventoryCommit.mock.calls[0][0];
        expect(commit.inventoryBatches).toHaveLength(2);
        expect(commit.inventoryBatches[1]?.pricingByPackagingLevel).toEqual([]);
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

    it("converts unbatched stock into a batch without changing any packaging quantities", () => {
        const product: productStructure = {
            id: "product-unbatched",
            name: "Unbatched medicine",
            variant: [{
                id: "variant-unbatched",
                variantName: "Tablets",
                packagingHierarchy: [{
                    id: "box-unbatched",
                    name: "Box",
                    costPrice: null,
                    sellingPrice: null,
                    quantityofNextLevel: 10,
                    nextLevelId: "pack-unbatched"
                }, {
                    id: "pack-unbatched",
                    name: "Pack",
                    costPrice: null,
                    sellingPrice: null,
                    quantityofNextLevel: 6,
                    nextLevelId: "unit-unbatched"
                }, {
                    id: "unit-unbatched",
                    name: "Unit",
                    costPrice: null,
                    sellingPrice: null,
                    quantityofNextLevel: null,
                    nextLevelId: null
                }]
            }]
        };
        const unbatchedRecord: inventory = {
            id: "unbatched-inventory",
            productId: product.id,
            variantId: product.variant[0].id,
            batchId: null,
            stockQuantities: [
                { packagingLevelId: "box-unbatched", quantity: 2 },
                { packagingLevelId: "pack-unbatched", quantity: 3 },
                { packagingLevelId: "unit-unbatched", quantity: 4 }
            ]
        };
        const onInventoryCommit = renderInventoryEditor({
            product,
            inventoryRecords: [unbatchedRecord],
            inventoryBatches: []
        });

        fireEvent.click(screen.getByRole("button", { name: "Add batch" }));

        const stockInputs = [
            screen.getByLabelText("Box"),
            screen.getByLabelText("Pack"),
            screen.getByLabelText("Unit")
        ];
        expect(stockInputs.map((input) => (input as HTMLInputElement).value))
            .toEqual(["2", "3", "4"]);
        expect(stockInputs.every((input) => (input as HTMLInputElement).readOnly))
            .toBe(true);
        expect(screen.queryByRole("region", { name: "Unbatched Inventory" }))
            .not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Add batch" })).toBeDisabled();

        fireEvent.change(screen.getByLabelText("Why are you making these changes?"), {
            target: { value: "Convert existing stock to a batch" }
        });
        const saveButton = screen.getByRole("button", { name: "Save Changes" });
        expect(saveButton).toBeEnabled();
        fireEvent.click(saveButton);

        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(onInventoryCommit).toHaveBeenCalledOnce();
        const commit = onInventoryCommit.mock.calls[0][0];
        const convertedRecord = commit.inventoryRecords.find(
            (record) => record.id === unbatchedRecord.id
        );
        expect(commit.inventoryRecords).toHaveLength(1);
        expect(convertedRecord).toEqual(expect.objectContaining({
            id: unbatchedRecord.id,
            batchId: expect.any(String),
            stockQuantities: unbatchedRecord.stockQuantities
        }));
        expect(commit.activityEvents).toContainEqual(expect.objectContaining({
            type: "inventory.batch_created",
            inventory: expect.objectContaining({
                inventoryId: unbatchedRecord.id,
                stock: [
                    expect.objectContaining({ quantity: 2 }),
                    expect.objectContaining({ quantity: 3 }),
                    expect.objectContaining({ quantity: 4 })
                ]
            })
        }));
        expect(commit.activityEvents.some(
            (event) => event.type === "inventory.stock_adjusted"
        )).toBe(false);

        cleanup();
        const onDeleteCommit = renderInventoryDetails({
            product,
            inventoryRecords: commit.inventoryRecords,
            inventoryBatches: commit.inventoryBatches
        });
        expect(screen.getByRole("button", { name: "Delete Batch" }))
            .toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Delete Batch" }));
        fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", {
            name: "Confirm Delete"
        }));
        fireEvent.change(screen.getByLabelText("Why are you making these changes?"), {
            target: { value: "Remove converted batch" }
        });
        fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

        expect(onDeleteCommit).toHaveBeenCalledOnce();
        const deletionCommit = onDeleteCommit.mock.calls[0][0];
        expect(deletionCommit.inventoryRecords).toEqual([]);
        expect(deletionCommit.inventoryBatches).toEqual([]);
        expect(deletionCommit.activityEvents).toContainEqual(expect.objectContaining({
            type: "inventory.batch_removed",
            reason: "Remove converted batch",
            removedBatch: expect.objectContaining({
                batchId: convertedRecord?.batchId
            }),
            affectedInventory: [expect.objectContaining({
                inventoryId: unbatchedRecord.id
            })]
        }));
    });

    it("converts a zero-quantity unbatched record instead of creating another record", () => {
        const zeroStockRecord: inventory = {
            ...editableRecord,
            id: "inventory-unbatched-zero",
            batchId: null,
            stockQuantities: [{ packagingLevelId: "box-editable", quantity: 0 }]
        };
        const onInventoryCommit = renderInventoryEditor({
            inventoryRecords: [zeroStockRecord],
            inventoryBatches: []
        });

        fireEvent.click(screen.getByRole("button", { name: "Add batch" }));
        const stockInput = screen.getByLabelText("Box") as HTMLInputElement;
        expect(stockInput.value).toBe("0");
        expect(stockInput.readOnly).toBe(true);

        fireEvent.change(screen.getByLabelText("Batch number"), {
            target: { value: "LOT-ZERO" }
        });
        fireEvent.change(screen.getByLabelText("Expiry date"), {
            target: { value: "2028-04-30" }
        });
        fireEvent.change(screen.getByLabelText("Why are you making these changes?"), {
            target: { value: "Convert zero-stock record to Batch 1" }
        });
        fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

        expect(onInventoryCommit).toHaveBeenCalledOnce();
        const commit = onInventoryCommit.mock.calls[0][0];
        expect(commit.inventoryRecords).toHaveLength(1);
        expect(commit.inventoryRecords[0]).toEqual({
            ...zeroStockRecord,
            batchId: expect.any(String)
        });
        expect(commit.inventoryRecords[0]?.stockQuantities).toEqual([
            { packagingLevelId: "box-editable", quantity: 0 }
        ]);
    });

    it("adds a subsequent batch as new stock after unbatched stock was converted", () => {
        const convertedBatch: inventoryBatch = {
            ...editableBatch,
            batchId: "batch-converted",
            batchNumber: "LOT-1"
        };
        const convertedRecord: inventory = {
            ...editableRecord,
            batchId: convertedBatch.batchId,
            stockQuantities: [{ packagingLevelId: "box-editable", quantity: 4 }]
        };
        const onInventoryCommit = renderInventoryEditor({
            inventoryRecords: [convertedRecord],
            inventoryBatches: [convertedBatch]
        });

        fireEvent.click(screen.getByRole("button", { name: "Add batch" }));
        const batchNumberInputs = screen.getAllByLabelText("Batch number");
        fireEvent.change(batchNumberInputs[1], { target: { value: "LOT-2" } });
        const stockInputs = screen.getAllByLabelText("Box");
        fireEvent.change(stockInputs[1], { target: { value: "7" } });
        fireEvent.change(screen.getByLabelText("Why are you making these changes?"), {
            target: { value: "Receive second batch" }
        });
        const saveButton = screen.getByRole("button", { name: "Save Changes" });
        expect(saveButton).toBeEnabled();
        fireEvent.click(saveButton);

        expect(onInventoryCommit).toHaveBeenCalledOnce();
        const commit = onInventoryCommit.mock.calls[0][0];
        expect(commit.inventoryRecords).toHaveLength(2);
        expect(commit.inventoryRecords.every((record) => record.batchId !== null))
            .toBe(true);
        expect(commit.inventoryRecords).toContainEqual(convertedRecord);
        const newRecord = commit.inventoryRecords.find(
            (record) => record.id !== convertedRecord.id
        );
        expect(newRecord).toEqual(expect.objectContaining({
            stockQuantities: [{ packagingLevelId: "box-editable", quantity: 7 }]
        }));
        expect(newRecord?.batchId).not.toBe(convertedBatch.batchId);
        expect(commit.inventoryBatches).toContainEqual(convertedBatch);
        expect(commit.activityEvents).toContainEqual(expect.objectContaining({
            type: "inventory.batch_created",
            inventory: expect.objectContaining({
                stock: [expect.objectContaining({ quantity: 7 })]
            })
        }));
    });

    it("allows two no-number/no-expiry batches to coexist with distinct IDs and records", () => {
        const onInventoryCommit = renderInventoryEditor({
            inventoryRecords: [],
            inventoryBatches: [],
            withoutNavigationRequest: true
        });

        fireEvent.click(screen.getByRole("button", { name: "Edit Stock" }));
        fireEvent.click(screen.getByRole("button", { name: "Add batch" }));
        const firstStock = screen.getAllByLabelText("Box")[0];
        fireEvent.change(firstStock, { target: { value: "4" } });

        fireEvent.click(screen.getByRole("button", { name: "Add batch" }));
        const secondStockInputs = screen.getAllByLabelText("Box");
        fireEvent.change(secondStockInputs[1], { target: { value: "7" } });

        fireEvent.change(screen.getByLabelText("Why are you making these changes?"), {
            target: { value: "Create separate unidentified batches" }
        });
        const saveButton = screen.getByRole("button", { name: "Save Changes" });
        expect(saveButton).toBeEnabled();
        fireEvent.click(saveButton);

        expect(onInventoryCommit).toHaveBeenCalledOnce();
        const commit = onInventoryCommit.mock.calls[0][0];
        expect(commit.inventoryBatches).toHaveLength(2);
        expect(commit.inventoryRecords).toHaveLength(2);

        expect(commit.inventoryBatches.map((batch) => batch.batchNumber))
            .toEqual([null, null]);
        expect(commit.inventoryBatches.map((batch) => batch.expiryDate))
            .toEqual([null, null]);
        expect(new Set(commit.inventoryBatches.map((batch) => batch.batchId)).size)
            .toBe(2);
        expect(new Set(commit.inventoryRecords.map((record) => record.id)).size)
            .toBe(2);

        for (const record of commit.inventoryRecords) {
            expect(commit.inventoryBatches.some(
                (batch) => batch.batchId === record.batchId
            )).toBe(true);
        }
        expect(commit.inventoryRecords.map((record) =>
            record.stockQuantities[0]?.quantity
        ).sort()).toEqual([4, 7]);
    });

    it("does not partially convert unbatched stock when the edit is cancelled", () => {
        const unbatchedRecord: inventory = {
            ...editableRecord,
            batchId: null
        };
        const onInventoryCommit = renderInventoryEditor({
            inventoryRecords: [unbatchedRecord],
            inventoryBatches: [],
            withoutNavigationRequest: true
        });

        fireEvent.click(screen.getAllByRole("button", { name: "Edit Stock" })[0]);
        fireEvent.click(screen.getByRole("button", { name: "Add batch" }));
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

        expect(onInventoryCommit).not.toHaveBeenCalled();
        expect(screen.queryByRole("dialog", { name: "Edit Inventory" }))
            .not.toBeInTheDocument();
    });

    it("preserves existing batch and Inventory record IDs during a valid metadata edit", () => {
        const existingPricing = [{
            packagingLevelId: "box-editable",
            costPrice: 12,
            sellingPrice: 18
        }];
        const activityPricing = [{
            ...existingPricing[0],
            packagingLevelName: "Box"
        }];
        const batchWithPricing = {
            ...editableBatch,
            pricingByPackagingLevel: existingPricing
        };
        const onInventoryCommit = renderInventoryEditor({
            inventoryBatches: [batchWithPricing]
        });
        const existingBatchId = batchWithPricing.batchId;
        const existingRecordId = editableRecord.id;

        fireEvent.change(screen.getByLabelText("Batch number"), {
            target: { value: "LOT-UPDATED" }
        });
        fireEvent.change(screen.getByLabelText("Why are you making these changes?"), {
            target: { value: "Corrected batch number" }
        });
        fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

        expect(onInventoryCommit).toHaveBeenCalledOnce();
        const commit = onInventoryCommit.mock.calls[0][0];
        expect(commit.inventoryBatches[0]?.batchId).toBe(existingBatchId);
        expect(commit.inventoryRecords[0]?.id).toBe(existingRecordId);
        expect(commit.inventoryBatches[0]?.pricingByPackagingLevel)
            .toEqual(existingPricing);
        expect(commit.activityEvents).toContainEqual(expect.objectContaining({
            type: "inventory.batch_updated",
            before: expect.objectContaining({
                pricingByPackagingLevel: activityPricing
            }),
            after: expect.objectContaining({
                pricingByPackagingLevel: activityPricing
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

    it("shows each batch expiry date and its remaining or elapsed days", () => {
        const healthyBatch: inventoryBatch = {
            ...editableBatch,
            expiryDate: new Date("2027-03-31T00:00:00.000Z")
        };
        const expiredBatch: inventoryBatch = {
            ...editableBatch,
            batchId: "batch-expired",
            batchNumber: "LOT-EXPIRED",
            expiryDate: new Date("2026-11-15T00:00:00.000Z")
        };
        const expiredRecord = {
            ...editableRecord,
            id: "inventory-expired",
            batchId: expiredBatch.batchId
        };
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-11-20T12:00:00.000Z"));

        try {
            render(createElement(InventoryPage, {
                products: [editableProduct],
                inventoryRecords: [editableRecord, expiredRecord],
                inventoryBatches: [healthyBatch, expiredBatch],
                onInventoryCommit: () => undefined,
                navigationRequest: null,
                onNavigate: () => undefined,
                onNavigationConsumed: () => undefined,
                onNavigationDismissed: () => undefined
            }));

            fireEvent.click(screen.getByRole("button", { name: "View" }));
            fireEvent.click(screen.getByRole("button", { name: /Tablets/ }));

            expect(screen.getByText(/Expires: 31 Mar 2027/)).toBeInTheDocument();
            expect(screen.getByText("131 days remaining")).toBeInTheDocument();
            expect(screen.getByText("131 days remaining").parentElement)
                .toHaveClass("expiry-display--healthy");
            expect(screen.getByText(/Expires: 15 Nov 2026/)).toBeInTheDocument();
            expect(screen.getByText("Expired 5 days ago")).toBeInTheDocument();
            expect(screen.getByText("Expired 5 days ago").parentElement)
                .toHaveClass("expiry-display--expired");
        } finally {
            vi.useRealTimers();
        }
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
        expect(screen.queryByRole("button", { name: "Delete Batch" }))
            .not.toBeInTheDocument();
        expect(screen.queryByLabelText("Reason for deleting Tablets / LOT-1"))
            .not.toBeInTheDocument();
        const saveButton = screen.getByRole("button", { name: "Save Changes" });
        expect(saveButton).toBeDisabled();
        fireEvent.click(saveButton);
        expect(onInventoryCommit).not.toHaveBeenCalled();
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

        expect(screen.getByRole("alertdialog", {
            name: "Product Currently Locked"
        })).toBeVisible();
        expect(
            screen.queryByRole("dialog", { name: "Edit Inventory" })
        ).not.toBeInTheDocument();
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
                expiryDate: "2027-01-31",
                costPrice: null,
                sellingPrice: null
            }]
        };
        const onInventoryCommit = renderInventoryDetails({
            deliveryDrafts: [deliveryDraft]
        });

        expect(screen.getByRole("alertdialog", {
            name: "Product Currently Locked"
        })).toBeVisible();
        expect(
            screen.queryByRole("dialog", { name: "Edit Inventory" })
        ).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Delete Batch" }))
            .not.toBeInTheDocument();
        expect(onInventoryCommit).not.toHaveBeenCalled();
    });

    it("uses one reason for all staged batch deletions and commits only on save", () => {
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

        expect(screen.getAllByRole("button", { name: "Delete Batch" }))
            .toHaveLength(2);
        fireEvent.click(screen.getAllByRole("button", { name: "Delete Batch" })[0]);
        fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", {
            name: "Confirm Delete"
        }));
        expect(screen.getAllByRole("button", { name: "Delete Batch" }))
            .toHaveLength(1);
        fireEvent.click(screen.getByRole("button", { name: "Delete Batch" }));
        fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", {
            name: "Confirm Delete"
        }));

        const saveButton = screen.getByRole("button", { name: "Save Changes" });
        expect(saveButton).toBeDisabled();
        expect(screen.queryByRole("button", { name: "Delete Batch" }))
            .not.toBeInTheDocument();
        expect(onInventoryCommit).not.toHaveBeenCalled();
        expect(editableRecord.stockQuantities[0]?.quantity).toBe(4);
        expect(secondRecord.stockQuantities[0]?.quantity).toBe(6);
        fireEvent.change(screen.getByLabelText("Why are you making these changes?"), {
            target: { value: "Remove recalled stock" }
        });
        expect(saveButton).toBeEnabled();
        fireEvent.click(saveButton);

        expect(onInventoryCommit).toHaveBeenCalledOnce();
        expect(onInventoryCommit.mock.calls[0][0].activityEvents
            .filter((event) => event.type === "inventory.batch_removed")
            .map((event) => event.reason)
        ).toEqual(["Remove recalled stock", "Remove recalled stock"]);
    });

    it("discards a staged batch deletion when the inventory edit session is cancelled", () => {
        const onInventoryCommit = renderInventoryDetails();
        fireEvent.click(screen.getByRole("button", { name: "Delete Batch" }));
        fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", {
            name: "Confirm Delete"
        }));
        expect(screen.queryByRole("button", { name: "Delete Batch" }))
            .not.toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

        expect(onInventoryCommit).not.toHaveBeenCalled();
        expect(screen.queryByRole("dialog", { name: "Edit Inventory" }))
            .not.toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Edit Stock" }));
        expect(screen.getByRole("button", { name: "Delete Batch" }))
            .toBeInTheDocument();
        expect(editableRecord.stockQuantities[0]?.quantity).toBe(4);
    });
});

describe("InventoryPage low-stock status", () => {
    it("shows Out of stock for zero stock even when no threshold is configured", () => {
        renderLowStockStatusPage(0, null);

        expect(screen.getByText("Out of stock", { selector: "strong" }))
            .toBeInTheDocument();
        expect(screen.queryByText("Threshold not configured"))
            .not.toBeInTheDocument();
    });

    describe("Inventory View low-stock threshold", () => {
        it("shows the selected variant's configured threshold and packaging level", () => {
            const product: productStructure = {
                id: "threshold-product",
                name: "Threshold medicine",
                variant: [{
                    id: "threshold-tablets",
                    variantName: "Tablets",
                    packagingHierarchy: [{
                        id: "tablet-boxes",
                        name: "Boxes",
                        costPrice: null,
                        sellingPrice: null,
                        quantityofNextLevel: 10,
                        nextLevelId: "tablet-packs"
                    }, {
                        id: "tablet-packs",
                        name: "Packs",
                        costPrice: null,
                        sellingPrice: null,
                        quantityofNextLevel: 10,
                        nextLevelId: "tablet-units"
                    }, {
                        id: "tablet-units",
                        name: "Tablets",
                        costPrice: null,
                        sellingPrice: null,
                        quantityofNextLevel: null,
                        nextLevelId: null
                    }],
                    lowStockThreshold: {
                        quantity: 10,
                        packagingLevelId: "tablet-packs"
                    }
                }, {
                    id: "threshold-syrup",
                    variantName: "Syrup",
                    packagingHierarchy: [{
                        id: "syrup-bottles",
                        name: "Bottles",
                        costPrice: null,
                        sellingPrice: null,
                        quantityofNextLevel: null,
                        nextLevelId: null
                    }],
                    lowStockThreshold: {
                        quantity: 4,
                        packagingLevelId: "syrup-bottles"
                    }
                }]
            };
            const inventoryRecords: inventory[] = [{
                id: "threshold-tablet-inventory",
                productId: product.id,
                variantId: "threshold-tablets",
                batchId: "threshold-tablet-batch",
                stockQuantities: [
                    { packagingLevelId: "tablet-boxes", quantity: 0 },
                    { packagingLevelId: "tablet-packs", quantity: 7 },
                    { packagingLevelId: "tablet-units", quantity: 0 }
                ]
            }, {
                id: "threshold-syrup-inventory",
                productId: product.id,
                variantId: "threshold-syrup",
                batchId: "threshold-syrup-batch",
                stockQuantities: [{ packagingLevelId: "syrup-bottles", quantity: 2 }]
            }];
            const inventoryBatches: inventoryBatch[] = [{
                batchId: "threshold-tablet-batch",
                productId: product.id,
                variantId: "threshold-tablets",
                batchNumber: "TABLET-LOT",
                expiryDate: null,
                pricingByPackagingLevel: []
            }, {
                batchId: "threshold-syrup-batch",
                productId: product.id,
                variantId: "threshold-syrup",
                batchNumber: "SYRUP-LOT",
                expiryDate: null,
                pricingByPackagingLevel: []
            }];
            render(createElement(InventoryPage, {
                products: [product],
                inventoryRecords,
                inventoryBatches,
                onInventoryCommit: () => undefined,
                navigationRequest: null,
                onNavigate: () => undefined,
                onNavigationConsumed: () => undefined,
                onNavigationDismissed: () => undefined
            }));

            fireEvent.click(screen.getByRole("button", { name: "View" }));
            fireEvent.click(screen.getByRole("button", { name: /Syrup/ }));
            let thresholdLabel = screen.getByText("Low Stock Threshold:");
            expect(thresholdLabel.parentElement).toHaveTextContent("4 Bottles");
            expect(thresholdLabel.parentElement).not.toHaveTextContent("10 Packs");
            expect(screen.getByText("SYRUP-LOT")).toBeInTheDocument();

            fireEvent.click(screen.getByRole("button", {
                name: /Back to variants/
            }));
            fireEvent.click(screen.getByRole("button", { name: /Tablets/ }));
            thresholdLabel = screen.getByText("Low Stock Threshold:");
            expect(thresholdLabel.parentElement).toHaveTextContent("10 Packs");
            expect(thresholdLabel.parentElement).not.toHaveTextContent("4 Bottles");
            expect(screen.getByText("TABLET-LOT")).toBeInTheDocument();
        });

        it("shows Not configured without changing the existing stock-record view", () => {
            render(createElement(InventoryPage, {
                products: [editableProduct],
                inventoryRecords: [editableRecord],
                inventoryBatches: [editableBatch],
                onInventoryCommit: () => undefined,
                navigationRequest: null,
                onNavigate: () => undefined,
                onNavigationConsumed: () => undefined,
                onNavigationDismissed: () => undefined
            }));

            fireEvent.click(screen.getByRole("button", { name: "View" }));
            fireEvent.click(screen.getByRole("button", { name: /Tablets/ }));

            expect(screen.getByText("Low Stock Threshold:").parentElement)
                .toHaveTextContent("Not configured");
            expect(screen.getByText("Stock records")).toBeInTheDocument();
            expect(screen.getByText("LOT-1")).toBeInTheDocument();
            expect(screen.getAllByText("4")).toHaveLength(2);
        });
    });

    it("excludes zero-stock variants from Low stock results", () => {
        renderLowStockStatusPage(0);

        expect(screen.getByText("Out of stock", { selector: "strong" }))
            .toBeInTheDocument();
        fireEvent.change(screen.getByLabelText("Filter by stock level"), {
            target: { value: "low-stock" }
        });

        expect(screen.queryByRole("heading", {
            name: "Low-stock medicine"
        })).not.toBeInTheDocument();
    });

    it("shows positive stock within the threshold as Low stock in filtered results", () => {
        renderLowStockStatusPage(1);

        fireEvent.change(screen.getByLabelText("Filter by stock level"), {
            target: { value: "low-stock" }
        });

        expect(screen.getByRole("heading", {
            name: "Low-stock medicine"
        })).toBeInTheDocument();
        expect(screen.getByText("Low stock", { selector: "strong" }))
            .toBeInTheDocument();
    });

    it("shows positive stock above the threshold as In stock", () => {
        renderLowStockStatusPage(11);

        expect(screen.getByText("In stock", { selector: "strong" }))
            .toBeInTheDocument();
    });
});
