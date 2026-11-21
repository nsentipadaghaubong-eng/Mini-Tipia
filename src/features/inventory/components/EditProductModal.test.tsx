// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    within
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { inventoryDisplay } from "../../../inventory/inventoryLookup";
import type { inventoryBatch } from "../../../inventory/inventoryBatch";
import type { productStructure } from "../../../products/productStructure";
import { getExpiryDisplay } from "../../../expiry/expiryDisplay";
import EditProductModal from "./EditProductModal";

const packagingLevel = {
    id: "box-1",
    name: "Box",
    costPrice: null,
    sellingPrice: null,
    quantityofNextLevel: null,
    nextLevelId: null
};

const product: productStructure = {
    id: "product-1",
    name: "Medicine",
    variant: [{
        id: "variant-1",
        variantName: "Medicine 500mg",
        packagingHierarchy: [packagingLevel]
    }]
};

const batches: inventoryBatch[] = [{
    batchId: "batch-1",
    productId: product.id,
    variantId: product.variant[0].id,
    batchNumber: "B1",
    expiryDate: new Date("2027-01-01"),
    pricingByPackagingLevel: []
}];

afterEach(cleanup);

function inventoryRecord(
    inventoryId: string,
    batchId: string | null,
    quantity: number
): inventoryDisplay {
    return {
        inventoryId,
        productId: product.id,
        variantId: product.variant[0].id,
        batchId,
        productName: product.name,
        variantName: product.variant[0].variantName,
        batchNumber: batchId === null ? null : "B1",
        expiryDate: batchId === null ? null : new Date("2027-01-01"),
        packagingLevels: [packagingLevel],
        stockQuantities: [{ packagingLevelId: packagingLevel.id, quantity }]
    };
}

function renderModal(inventoryRecords: inventoryDisplay[]) {
    return renderToStaticMarkup(createElement(EditProductModal, {
        product,
        batches,
        inventoryRecords,
        initialVariantId: null,
        onEditProductDetails: () => undefined,
        onClose: () => undefined,
        onSave: () => undefined
    }));
}

describe("EditProductModal unbatched inventory display", () => {
    it("preserves a selected expiry date through save and reopening", () => {
        const onSave = vi.fn();
        const record = inventoryRecord("batch-record", "batch-1", 4);
        const view = render(createElement(EditProductModal, {
            product,
            batches,
            inventoryRecords: [record],
            onEditProductDetails: () => undefined,
            onClose: () => undefined,
            onSave
        }));

        fireEvent.change(screen.getByLabelText("Expiry date"), {
            target: { value: "2026-11-20" }
        });
        fireEvent.change(screen.getByLabelText("Why are you making these changes?"), {
            target: { value: "Correct expiry date" }
        });
        fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

        expect(onSave).toHaveBeenCalledOnce();
        const savedChanges = onSave.mock.calls[0][0];
        const savedExpiryDate = savedChanges.batches[0].expiryDate;
        expect(savedExpiryDate).toBeInstanceOf(Date);
        expect(savedExpiryDate.toISOString()).toBe("2026-11-20T00:00:00.000Z");
        expect(getExpiryDisplay(
            savedExpiryDate,
            new Date("2026-11-20T12:00:00.000Z")
        ).classification).toBe("expires-today");

        view.unmount();
        render(createElement(EditProductModal, {
            product,
            batches: [{
                ...batches[0],
                expiryDate: savedExpiryDate
            }],
            inventoryRecords: [{
                ...record,
                expiryDate: savedExpiryDate
            }],
            onEditProductDetails: () => undefined,
            onClose: () => undefined,
            onSave
        }));

        expect(screen.getByLabelText("Expiry date"))
            .toHaveValue("2026-11-20");
    });

    it("does not shift an existing expiry date when stock is edited", () => {
        const onSave = vi.fn();
        const existingExpiryDate = new Date("2026-11-20T00:00:00.000Z");
        const existingBatch: inventoryBatch = {
            ...batches[0],
            expiryDate: existingExpiryDate
        };
        const record = {
            ...inventoryRecord("batch-record", "batch-1", 4),
            expiryDate: existingExpiryDate
        };
        render(createElement(EditProductModal, {
            product,
            batches: [existingBatch],
            inventoryRecords: [record],
            onEditProductDetails: () => undefined,
            onClose: () => undefined,
            onSave
        }));

        expect(screen.getByLabelText("Expiry date"))
            .toHaveValue("2026-11-20");
        fireEvent.change(screen.getByLabelText("Box"), {
            target: { value: "5" }
        });
        fireEvent.change(screen.getByLabelText("Why are you making these changes?"), {
            target: { value: "Correct stock quantity" }
        });
        fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

        expect(onSave).toHaveBeenCalledOnce();
        const savedExpiryDate =
            onSave.mock.calls[0][0].batches[0].expiryDate;
        expect(savedExpiryDate.toISOString())
            .toBe("2026-11-20T00:00:00.000Z");
    });

    it("keeps the reason section outside the independently scrollable editor", () => {
        render(createElement(EditProductModal, {
            product,
            batches,
            inventoryRecords: [inventoryRecord("batch-record", "batch-1", 4)],
            onEditProductDetails: () => undefined,
            onClose: () => undefined,
            onSave: () => undefined
        }));

        const reasonInput = screen.getByLabelText(
            "Why are you making these changes?"
        );
        const reasonLabel = reasonInput.closest(".edit-field")?.querySelector("label");
        const reasonSection = reasonInput.closest("section");
        const dialog = reasonSection?.parentElement;
        const content = dialog?.querySelector<HTMLElement>(".edit-modal-content");

        expect(reasonSection).not.toBeNull();
        expect(reasonLabel).not.toBeNull();
        expect(dialog).not.toBeNull();
        expect(content).not.toBeNull();
        expect(reasonSection).toHaveClass("edit-reason-section");
        expect(reasonLabel!).toHaveClass("edit-reason-label");
        expect(reasonSection?.nextElementSibling).toBe(content);
        expect(content).not.toContainElement(reasonSection);
        expect(content!).toHaveClass("edit-modal-content");

        content!.scrollTop = 200;
        fireEvent.scroll(content!);
        expect(reasonInput).toBeVisible();
    });

    it("renders unbatched packaging and current quantity separately from batch cards", () => {
        const markup = renderModal([
            inventoryRecord("batch-record", "batch-1", 4),
            inventoryRecord("unbatched-record", null, 12)
        ]);

        expect(markup).toContain("Unbatched Inventory");
        expect(markup).toContain('value="12"');
        expect(markup).toContain("Batch information");
        expect(markup).toContain('value="4"');
        expect(markup).not.toContain("No batch association");
        expect(markup).toContain("Delete Batch");
        expect(markup).not.toContain("Remove new batch");
        expect(markup).not.toContain(">Remove</button>");
        expect(markup).toContain("Add batch");
        expect(markup).toContain("Save Changes");
        expect(markup).toContain("Cancel");
    });

    it("omits the unbatched section when no unbatched record exists", () => {
        const markup = renderModal([
            inventoryRecord("batch-record", "batch-1", 4)
        ]);

        expect(markup).not.toContain("Unbatched Inventory");
        expect(markup).toContain("Batch information");
    });

    it("locks batch and stock edits when a draft becomes active after opening", () => {
        const onEditProductDetails = vi.fn();
        const onSave = vi.fn();
        const modalProps = {
            product,
            batches,
            inventoryRecords: [inventoryRecord("batch-record", "batch-1", 4)],
            initialVariantId: null,
            onEditProductDetails,
            onClose: () => undefined,
            onSave
        };
        const view = render(createElement(EditProductModal, modalProps));

        expect(screen.getByRole("button", { name: "Add batch" })).toBeEnabled();
        view.rerender(createElement(EditProductModal, {
            ...modalProps,
            draftLockMessages: [
                "This product is currently in a Receive Delivery draft. Its inventory and product structure cannot be modified until the draft is completed or cancelled. You can still edit its name and description."
            ]
        }));

        expect(screen.getByLabelText("Batch number")).toBeDisabled();
        expect(screen.getByLabelText("Expiry date")).toBeDisabled();
        expect(screen.getByLabelText("Box")).toBeDisabled();
        expect(screen.getByRole("button", { name: "Add batch" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Delete Batch" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Edit Product Details" })).toBeEnabled();
        expect(screen.getByRole("alert")).toHaveTextContent(
            "Its inventory and product structure cannot be modified"
        );

        fireEvent.click(screen.getByRole("button", { name: "Edit Product Details" }));
        expect(onEditProductDetails).toHaveBeenCalledWith("variant-1");
        expect(onSave).not.toHaveBeenCalled();
    });

    it("stages batch deletion without changing stock and saves with one reason", () => {
        const onSave = vi.fn();
        const record = inventoryRecord("batch-record", "batch-1", 4);
        render(createElement(EditProductModal, {
            product,
            batches,
            inventoryRecords: [record],
            onEditProductDetails: () => undefined,
            onClose: () => undefined,
            onSave
        }));

        fireEvent.click(screen.getByRole("button", { name: "Delete Batch" }));
        let confirmation = screen.getByRole("alertdialog", { name: "Delete batch?" });
        expect(confirmation).toHaveTextContent("B1");
        fireEvent.click(within(confirmation).getByRole("button", { name: "Cancel" }));
        expect(screen.queryByLabelText("Reason for deleting Medicine 500mg / B1"))
            .not.toBeInTheDocument();
        expect(onSave).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole("button", { name: "Delete Batch" }));
        confirmation = screen.getByRole("alertdialog", { name: "Delete batch?" });
        fireEvent.click(within(confirmation).getByRole("button", {
            name: "Confirm Delete"
        }));
        expect(onSave).not.toHaveBeenCalled();
        expect(screen.queryByRole("button", { name: "Delete Batch" }))
            .not.toBeInTheDocument();
        expect(screen.queryByLabelText("Reason for deleting Medicine 500mg / B1"))
            .not.toBeInTheDocument();
        expect(record.stockQuantities).toEqual([
            { packagingLevelId: packagingLevel.id, quantity: 4 }
        ]);
        expect(batches).toHaveLength(1);

        const saveButton = screen.getByRole("button", { name: "Save Changes" });
        expect(saveButton).toBeDisabled();
        fireEvent.click(saveButton);
        expect(onSave).not.toHaveBeenCalled();
        const reasonInput = screen.getByLabelText("Why are you making these changes?");
        fireEvent.change(reasonInput, { target: { value: " \t " } });
        expect(saveButton).toBeDisabled();
        fireEvent.click(saveButton);
        expect(onSave).not.toHaveBeenCalled();
        fireEvent.change(screen.getByLabelText("Why are you making these changes?"), {
            target: { value: "  Remove recalled batch  " }
        });
        expect(saveButton).toBeEnabled();
        fireEvent.click(saveButton);

        expect(onSave).toHaveBeenCalledOnce();
        expect(onSave.mock.calls[0][0].deletedBatches).toEqual([{
            variantId: "variant-1",
            batchId: "batch-1",
            reason: "Remove recalled batch"
        }]);
        expect(onSave.mock.calls[0][0].batches).toEqual([]);
    });

    it("discards a staged batch deletion when the edit modal is cancelled", () => {
        const onSave = vi.fn();
        const onClose = vi.fn();
        render(createElement(EditProductModal, {
            product,
            batches,
            inventoryRecords: [inventoryRecord("batch-record", "batch-1", 4)],
            onEditProductDetails: () => undefined,
            onClose,
            onSave
        }));

        fireEvent.click(screen.getByRole("button", { name: "Delete Batch" }));
        fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", {
            name: "Confirm Delete"
        }));
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

        expect(onClose).toHaveBeenCalledOnce();
        expect(onSave).not.toHaveBeenCalled();
    });
});
