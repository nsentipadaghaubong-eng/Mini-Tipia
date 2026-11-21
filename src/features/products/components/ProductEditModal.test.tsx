// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
    afterEach,
    describe,
    expect,
    it,
    vi
} from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    within
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { inventory } from "../../../inventory/inventoryStock";
import type { inventoryBatch } from "../../../inventory/inventoryBatch";
import type { productStructure } from "../../../products/productStructure";
import {
    prepareProductRecordDeletionPlan,
    type ProductRecordDeletionDraft
} from "../../../products/productDeletion";
import ProductEditModal from "./ProductEditModal";

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

const product: productStructure = {
    id: "product-1",
    name: "Medicine",
    genericName: "Generic medicine",
    manufacturer: "Pharma",
    category: "Medicine",
    variant: [
        {
            id: "variant-1",
            variantName: "Tablets",
            nafdacRegistrationNumber: "REG-TAB",
            lowStockThreshold: {
                quantity: 5,
                packagingLevelId: "pack"
            },
            packagingHierarchy: [
                {
                    id: "box",
                    name: "Box",
                    costPrice: 40,
                    sellingPrice: 45,
                    quantityofNextLevel: 10,
                    nextLevelId: "pack"
                },
                {
                    id: "pack",
                    name: "Pack",
                    costPrice: null,
                    sellingPrice: 15,
                    quantityofNextLevel: null,
                    nextLevelId: null
                }
            ]
        },
        {
            id: "variant-2",
            variantName: "Syrup",
            packagingHierarchy: []
        }
    ]
};

describe("ProductEditModal", () => {
    it("blocks clearing an existing packaged variant's threshold", () => {
        const onSave = vi.fn();
        render(createElement(ProductEditModal, {
            product,
            inventoryRecords: [],
            inventoryBatches: [],
            onManageStock: () => undefined,
            onClose: () => undefined,
            onSave
        }));

        fireEvent.change(screen.getAllByLabelText(
            /Low-stock threshold quantity/
        )[0], { target: { value: "" } });
        fireEvent.change(screen.getByRole("textbox", { name: /Reason for update/ }), {
            target: { value: "Update product details" }
        });

        expect(screen.getByText(
            "A low-stock threshold is required for variants with packaging."
        )).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();
        fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
        expect(onSave).not.toHaveBeenCalled();
    });

    it("requires a threshold when an empty placeholder gains packaging", () => {
        const onSave = vi.fn();
        render(createElement(ProductEditModal, {
            product,
            inventoryRecords: [],
            inventoryBatches: [],
            onManageStock: () => undefined,
            onClose: () => undefined,
            onSave
        }));

        fireEvent.click(screen.getAllByRole("button", {
            name: "Add packaging level"
        })[1]);
        fireEvent.change(screen.getAllByRole("textbox", {
            name: /^Packaging level name/
        })[2], { target: { value: "Bottle" } });
        fireEvent.change(screen.getByRole("textbox", { name: /Reason for update/ }), {
            target: { value: "Add placeholder packaging" }
        });

        expect(screen.getByText(
            "A low-stock threshold is required for variants with packaging."
        )).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();
        expect(onSave).not.toHaveBeenCalled();
    });

    it("prepopulates product, multiple variant, packaging, conversion and price fields", () => {
        const markup = renderToStaticMarkup(createElement(ProductEditModal, {
            product,
            inventoryRecords: [],
            inventoryBatches: [],
            onManageStock: () => undefined,
            onClose: () => undefined,
            onSave: () => undefined
        }));

        expect(markup).toContain('role="dialog"');
        expect(markup).toContain("Medicine");
        expect(markup).toContain("Generic medicine");
        expect(markup).toContain("Pharma");
        expect(markup).toContain("Tablets");
        expect(markup).toContain("Syrup");
        expect(markup).toContain("REG-TAB");
        expect(markup).toContain('value="box"');
        expect(markup).toContain('value="10"');
        expect(markup).toContain('value="40"');
        expect(markup).toContain('value="45"');
        expect(markup).toContain("Save Changes");
        expect(markup).toContain("Cancel");
        expect(markup).toContain("Add variant");
        expect(markup).toContain("Add packaging level");
        expect(markup).not.toContain("Remove variant");
        expect(markup).toContain("Delete Variant");
        expect(markup).toContain("Delete Packaging Level");
        expect(markup).not.toContain("Delete batch");
        expect(markup).not.toContain(">Remove</button>");
    });

    it("requires a reason before enabling Save Changes", () => {
        const markup = renderToStaticMarkup(createElement(ProductEditModal, {
            product,
            inventoryRecords: [],
            inventoryBatches: [],
            onManageStock: () => undefined,
            onClose: () => undefined,
            onSave: () => undefined
        }));

        expect(markup).toContain('aria-label="Close product editor"');
        expect(markup).toContain("A reason for this product update is required.");
        expect(markup).toContain('disabled="" type="submit"');
    });

    it("disables saving for an empty or whitespace-only reason", () => {
        render(createElement(ProductEditModal, {
            product,
            inventoryRecords: [],
            inventoryBatches: [],
            onManageStock: () => undefined,
            onClose: () => undefined,
            onSave: () => undefined
        }));

        const saveButton = screen.getByRole("button", { name: "Save Changes" });
        const reasonInput = screen.getByRole("textbox", {
            name: /Reason for update/
        });

        expect(saveButton).toBeDisabled();
        fireEvent.change(reasonInput, { target: { value: "   " } });
        expect(saveButton).toBeDisabled();
        fireEvent.change(reasonInput, { target: { value: "Correct product details" } });
        expect(saveButton).toBeEnabled();
        fireEvent.change(reasonInput, { target: { value: "" } });
        expect(saveButton).toBeDisabled();
        fireEvent.change(reasonInput, { target: { value: "   " } });
        expect(saveButton).toBeDisabled();
    });

    it("keeps the reason section outside the independently scrollable editor", () => {
        render(createElement(ProductEditModal, {
            product,
            inventoryRecords: [],
            inventoryBatches: [],
            onManageStock: () => undefined,
            onClose: () => undefined,
            onSave: () => undefined
        }));

        const reasonInput = screen.getByRole("textbox", {
            name: /Reason for update/
        });
        const reasonLabel = reasonInput.closest("label");
        const reasonSection = reasonInput.closest("section");
        const form = reasonSection?.parentElement;
        const content = form?.querySelector<HTMLElement>(".product-edit-content");

        expect(reasonSection).not.toBeNull();
        expect(reasonLabel).not.toBeNull();
        expect(form).not.toBeNull();
        expect(content).not.toBeNull();
        expect(reasonSection).toHaveClass("product-edit-reason");
        expect(reasonLabel!).toHaveClass("product-edit-reason-label");
        expect(form?.firstElementChild).toBe(reasonSection);
        expect(content).not.toContainElement(reasonSection);
        expect(content!).toHaveClass("product-edit-content");

        content!.scrollTop = 200;
        fireEvent.scroll(content!);
        expect(reasonInput).toBeVisible();
    });

    it.each([
        [
            "Sales",
            "This product is currently in a Sales draft. Its inventory and product structure cannot be modified until the draft is completed or cancelled. You can still edit its name and description."
        ],
        [
            "Receive Delivery",
            "This product is currently in a Receive Delivery draft. Its inventory and product structure cannot be modified until the draft is completed or cancelled. You can still edit its name and description."
        ]
    ])("allows descriptive edits with stock while a %s draft locks structure", (
        _draftType,
        draftLockMessage
    ) => {
        const inventoryRecords: inventory[] = [{
            id: "inventory-1",
            productId: product.id,
            variantId: product.variant[0].id,
            batchId: null,
            stockQuantities: [{ packagingLevelId: "box", quantity: 12 }]
        }];
        const before = structuredClone(inventoryRecords);
        const onSave = vi.fn();
        render(createElement(ProductEditModal, {
            product,
            inventoryRecords,
            inventoryBatches: [],
            onManageStock: () => undefined,
            onClose: () => undefined,
            onSave,
            draftLockMessages: [draftLockMessage]
        }));

        expect(screen.getByLabelText("Product name")).toBeEnabled();
        expect(screen.getByLabelText("Description")).toBeEnabled();
        expect(screen.getAllByLabelText("Variant name")[0]).toBeDisabled();
        expect(screen.getAllByLabelText("Packaging level name")[0]).toBeDisabled();
        expect(screen.getAllByLabelText("Quantity of next level")[0]).toBeDisabled();
        expect(screen.getByRole("button", { name: "Add variant" })).toBeDisabled();
        expect(screen.getAllByRole("button", { name: "Add packaging level" })[0])
            .toBeDisabled();
        expect(screen.getAllByLabelText(/Current total stock/)[0]).toHaveValue(12);
        expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();
        expect(screen.getByRole("alert")).toHaveTextContent(
            "Its inventory and product structure cannot be modified"
        );

        fireEvent.change(screen.getByLabelText("Product name"), {
            target: { value: "Updated Medicine" }
        });
        fireEvent.change(screen.getByLabelText("Description"), {
            target: { value: "Descriptive update" }
        });
        fireEvent.change(screen.getByRole("textbox", { name: /Reason for update/ }), {
            target: { value: "Correct product description" }
        });
        expect(screen.getByRole("button", { name: "Save Changes" })).toBeEnabled();
        fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

        expect(onSave).toHaveBeenCalledOnce();
        expect(onSave.mock.calls[0][0]).toMatchObject({
            name: "Updated Medicine",
            description: "Descriptive update",
            variant: product.variant
        });
        expect(onSave.mock.calls[0][1]).toBe("Correct product description");
        expect(onSave.mock.calls[0][2]).toEqual(before);
        expect(inventoryRecords).toEqual(before);
        expect(screen.getAllByRole("button", { name: "Delete Variant" })
            .every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    });

    it("blocks a structural edit when a draft becomes active after the modal opens", () => {
        const onSave = vi.fn();
        const modalProps = {
            product,
            inventoryRecords: [],
            inventoryBatches: [],
            onManageStock: () => undefined,
            onClose: () => undefined,
            onSave
        };
        const view = render(createElement(ProductEditModal, modalProps));

        fireEvent.change(screen.getAllByLabelText("Variant name")[0], {
            target: { value: "Changed variant" }
        });
        fireEvent.change(screen.getByRole("textbox", { name: /Reason for update/ }), {
            target: { value: "Change variant" }
        });
        expect(screen.getByRole("button", { name: "Save Changes" })).toBeEnabled();

        view.rerender(createElement(ProductEditModal, {
            ...modalProps,
            draftLockMessages: [
                "This product is currently in a Receive Delivery draft. Its inventory and product structure cannot be modified until the draft is completed or cancelled. You can still edit its name and description."
            ]
        }));

        expect(screen.getAllByLabelText("Variant name")[0]).toBeDisabled();
        expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();
        fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
        expect(onSave).not.toHaveBeenCalled();

        view.rerender(createElement(ProductEditModal, modalProps));
        expect(screen.getAllByLabelText("Variant name")[0]).toBeEnabled();
        expect(screen.getByRole("button", { name: "Save Changes" })).toBeEnabled();
        fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
        expect(onSave).toHaveBeenCalledOnce();
    });

    it("does not mutate inventory records while presenting its read-only inventory context", () => {
        const records: inventory[] = [{
            id: "inventory-1",
            productId: product.id,
            variantId: product.variant[0].id,
            batchId: null,
            stockQuantities: [{ packagingLevelId: "box", quantity: 20 }]
        }];
        const before = structuredClone(records);
        const onSave = vi.fn();

        render(createElement(ProductEditModal, {
            product,
            inventoryRecords: records,
            inventoryBatches: [],
            onManageStock: () => undefined,
            onClose: () => undefined,
            onSave
        }));

        expect(records).toEqual(before);
        expect(onSave).not.toHaveBeenCalled();
    });

    it("shows a clear total for each existing packaging level across matching batches and variants", () => {
        const productWithMultipleVariants: productStructure = {
            ...product,
            variant: [
                product.variant[0],
                {
                    ...product.variant[1],
                    lowStockThreshold: {
                        quantity: 4,
                        packagingLevelId: "bottle"
                    },
                    packagingHierarchy: [{
                        id: "bottle",
                        name: "Bottle",
                        costPrice: null,
                        sellingPrice: 20,
                        quantityofNextLevel: null,
                        nextLevelId: null
                    }]
                }
            ]
        };
        const inventoryBatches: inventoryBatch[] = [
            {
                batchId: "batch-1",
                productId: product.id,
                variantId: product.variant[0].id,
                batchNumber: "B1",
                expiryDate: null,
                pricingByPackagingLevel: []
            },
            {
                batchId: "batch-2",
                productId: product.id,
                variantId: product.variant[0].id,
                batchNumber: "B2",
                expiryDate: null,
                pricingByPackagingLevel: []
            }
        ];
        const records: inventory[] = [
            {
                id: "inventory-box-b1",
                productId: product.id,
                variantId: product.variant[0].id,
                batchId: "batch-1",
                stockQuantities: [{ packagingLevelId: "box", quantity: 4 }]
            },
            {
                id: "inventory-box-b2",
                productId: product.id,
                variantId: product.variant[0].id,
                batchId: "batch-2",
                stockQuantities: [{ packagingLevelId: "box", quantity: 5 }]
            },
            {
                id: "inventory-pack",
                productId: product.id,
                variantId: product.variant[0].id,
                batchId: null,
                stockQuantities: [{ packagingLevelId: "pack", quantity: 6 }]
            },
            {
                id: "inventory-other-product",
                productId: "product-2",
                variantId: product.variant[0].id,
                batchId: null,
                stockQuantities: [{ packagingLevelId: "box", quantity: 100 }]
            },
            {
                id: "inventory-second-variant",
                productId: product.id,
                variantId: product.variant[1].id,
                batchId: null,
                stockQuantities: [{ packagingLevelId: "bottle", quantity: 50 }]
            }
        ];
        const before = structuredClone(records);
        const onSave = vi.fn();

        render(createElement(ProductEditModal, {
            product: productWithMultipleVariants,
            inventoryRecords: records,
            inventoryBatches,
            onManageStock: () => undefined,
            onClose: () => undefined,
            onSave
        }));

        expect(screen.getAllByLabelText(/Current total stock/).map((input) =>
            (input as HTMLInputElement).value
        )).toEqual(["9", "6", "50"]);
        expect(screen.getAllByText(
            "Across matching batches and unbatched stock."
        )).toHaveLength(3);
        expect(screen.queryByLabelText("Initial stock batch")).not.toBeInTheDocument();
        expect(records).toEqual(before);
        expect(onSave).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText("Product name"), {
            target: { value: "Updated Medicine" }
        });
        fireEvent.change(screen.getByRole("textbox", { name: /Reason for update/ }), {
            target: { value: "Update product details" }
        });
        fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

        expect(onSave).toHaveBeenCalledOnce();
        expect(onSave.mock.calls[0][2]).toEqual(before);
        expect(records).toEqual(before);
    });

    it("shows zero for existing packaging levels with no inventory", () => {
        render(createElement(ProductEditModal, {
            product,
            inventoryRecords: [],
            inventoryBatches: [],
            onManageStock: () => undefined,
            onClose: () => undefined,
            onSave: () => undefined
        }));

        expect(screen.getAllByLabelText(/Current total stock/).map((input) =>
            (input as HTMLInputElement).value
        )).toEqual(["0", "0"]);
    });

    it("keeps initial-stock entry for newly added packaging without batch selection", () => {
        vi.stubGlobal("crypto", {
            randomUUID: () => "new-packaging-level"
        });
        const inventoryBatches: inventoryBatch[] = [{
            batchId: "batch-1",
            productId: product.id,
            variantId: product.variant[0].id,
            batchNumber: "B1",
            expiryDate: null,
            pricingByPackagingLevel: []
        }];
        const inventoryRecords: inventory[] = [{
            id: "inventory-1",
            productId: product.id,
            variantId: product.variant[0].id,
            batchId: "batch-1",
            stockQuantities: [{ packagingLevelId: "box", quantity: 4 }]
        }];
        const onSave = vi.fn();

        render(createElement(ProductEditModal, {
            product,
            inventoryRecords,
            inventoryBatches,
            onManageStock: () => undefined,
            onClose: () => undefined,
            onSave
        }));

        const addPackagingButton = screen.getAllByRole("button", {
            name: "Add packaging level"
        })[0];
        expect(addPackagingButton).toBeEnabled();
        fireEvent.click(addPackagingButton);
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        const packagingNameInputs = screen.getAllByRole("textbox", {
            name: /^Packaging level name/
        });
        expect(packagingNameInputs).toHaveLength(3);
        fireEvent.change(packagingNameInputs[2], {
            target: { value: "Unit" }
        });
        fireEvent.change(screen.getAllByRole("spinbutton", {
            name: /^Quantity of next level/
        })[1], {
            target: { value: "12" }
        });
        const initialStockInput = screen.getByLabelText("Initial stock quantity");
        expect(initialStockInput).toBeInTheDocument();
        expect(screen.queryByLabelText("Initial stock batch")).not.toBeInTheDocument();
        fireEvent.change(initialStockInput, {
            target: { value: "3" }
        });
        fireEvent.change(screen.getByRole("textbox", { name: /Reason for update/ }), {
            target: { value: "Add unit packaging with initial stock" }
        });
        fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

        expect(onSave).toHaveBeenCalledOnce();
        const updatedProduct = onSave.mock.calls[0][0] as productStructure;
        const newPackagingId =
            updatedProduct.variant[0].packagingHierarchy.at(-1)?.id;
        expect(onSave.mock.calls[0][2]).toEqual([{
            ...inventoryRecords[0],
            stockQuantities: [
                { packagingLevelId: "box", quantity: 4 },
                { packagingLevelId: newPackagingId, quantity: 3 }
            ]
        }]);
        expect(inventoryRecords[0].stockQuantities).toEqual([
            { packagingLevelId: "box", quantity: 4 }
        ]);
    });

    it("does not save or create stock Activity when a packaging change is cancelled", () => {
        const onSave = vi.fn();
        const onClose = vi.fn();
        render(createElement(ProductEditModal, {
            product,
            inventoryRecords: [],
            inventoryBatches: [],
            onManageStock: () => undefined,
            onClose,
            onSave
        }));

        fireEvent.click(screen.getAllByRole("button", {
            name: "Add packaging level"
        })[0]);
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

        expect(onSave).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalledOnce();
    });

    it("shows read-only inventory and sends the exact record context to Manage Stock", () => {
        const inventoryBatches: inventoryBatch[] = [{
            batchId: "batch-1",
            productId: product.id,
            variantId: product.variant[0].id,
            batchNumber: "B1-1001",
            expiryDate: new Date("2027-01-01"),
            pricingByPackagingLevel: []
        }];
        const records: inventory[] = [{
            id: "inventory-1",
            productId: product.id,
            variantId: product.variant[0].id,
            batchId: "batch-1",
            stockQuantities: [{ packagingLevelId: "box", quantity: 10 }]
        }];
        const onManageStock = vi.fn();
        const markup = renderToStaticMarkup(createElement(ProductEditModal, {
            product,
            inventoryRecords: records,
            inventoryBatches,
            onManageStock,
            onClose: () => undefined,
            onSave: () => undefined
        }));

        expect(markup).toContain("B1-1001");
        expect(markup).toContain("10 Box");
        expect(markup).toContain("Manage Stock");
        expect(records[0].stockQuantities[0].quantity).toBe(10);
        expect(onManageStock).not.toHaveBeenCalled();
    });

    it("does not offer Manage Stock when batch context cannot be resolved", () => {
        const records: inventory[] = [{
            id: "inventory-1",
            productId: product.id,
            variantId: product.variant[0].id,
            batchId: "missing-batch",
            stockQuantities: [{ packagingLevelId: "box", quantity: 10 }]
        }];
        const markup = renderToStaticMarkup(createElement(ProductEditModal, {
            product,
            inventoryRecords: records,
            inventoryBatches: [],
            onManageStock: () => undefined,
            onClose: () => undefined,
            onSave: () => undefined
        }));

        expect(markup).toContain("Batch details unavailable");
        expect(markup).not.toContain("Manage Stock");
    });

    it("stages variant deletion, hides it, and commits with one reason", () => {
        const onSave = vi.fn();
        render(createElement(ProductEditModal, {
            product,
            inventoryRecords: [],
            inventoryBatches: [],
            onManageStock: () => undefined,
            onClose: () => undefined,
            onSave
        }));

        fireEvent.click(screen.getAllByRole("button", { name: "Delete Variant" })[0]);
        let confirmation = screen.getByRole("alertdialog", { name: "Delete Tablets?" });
        fireEvent.click(within(confirmation).getByRole("button", { name: "Cancel" }));
        expect(screen.queryByLabelText("Reason for deleting Tablets"))
            .not.toBeInTheDocument();
        expect(onSave).not.toHaveBeenCalled();

        fireEvent.click(screen.getAllByRole("button", { name: "Delete Variant" })[0]);
        confirmation = screen.getByRole("alertdialog", { name: "Delete Tablets?" });
        fireEvent.click(within(confirmation).getByRole("button", {
            name: "Confirm Delete"
        }));
        expect(onSave).not.toHaveBeenCalled();
        expect(screen.queryByRole("heading", { name: "Tablets" }))
            .not.toBeInTheDocument();
        expect(screen.queryByLabelText("Reason for deleting Tablets"))
            .not.toBeInTheDocument();
        expect(product.variant).toHaveLength(2);

        const saveButton = screen.getByRole("button", { name: "Save Changes" });
        expect(saveButton).toBeDisabled();
        fireEvent.click(saveButton);
        expect(onSave).not.toHaveBeenCalled();
        fireEvent.change(screen.getByRole("textbox", { name: /Reason for update/ }), {
            target: { value: "Discontinue tablet variant" }
        });
        expect(saveButton).toBeEnabled();
        fireEvent.click(saveButton);

        expect(onSave).toHaveBeenCalledOnce();
        expect(onSave.mock.calls[0][4]).toEqual([{
            type: "variant",
            variantId: "variant-1",
            reason: "Discontinue tablet variant"
        }]);
        expect(product.variant).toHaveLength(2);
    });

    it("hides staged packaging without changing persisted inventory", () => {
        const onSave = vi.fn();
        const record: inventory = {
            id: "inventory-1",
            productId: product.id,
            variantId: product.variant[0].id,
            batchId: "batch-1",
            stockQuantities: [{ packagingLevelId: "box", quantity: 8 }]
        };
        const batch: inventoryBatch = {
            batchId: "batch-1",
            productId: product.id,
            variantId: product.variant[0].id,
            batchNumber: "LOT-1",
            expiryDate: null,
            pricingByPackagingLevel: []
        };
        render(createElement(ProductEditModal, {
            product,
            inventoryRecords: [record],
            inventoryBatches: [batch],
            onManageStock: () => undefined,
            onClose: () => undefined,
            onSave
        }));

        fireEvent.click(screen.getAllByRole("button", {
            name: "Delete Packaging Level"
        })[0]);
        const confirmation = screen.getByRole("alertdialog", {
            name: "Delete Box packaging level?"
        });
        expect(confirmation).toHaveTextContent("Box packaging level");
        fireEvent.click(within(confirmation).getByRole("button", {
            name: "Confirm Delete"
        }));

        expect(screen.queryByText("Box", {
            selector: ".product-edit-packaging strong"
        })).not.toBeInTheDocument();
        expect(screen.getByText("Pack", {
            selector: ".product-edit-packaging strong"
        })).toBeInTheDocument();
        expect(screen.queryByLabelText("Reason for deleting Box packaging level"))
            .not.toBeInTheDocument();
        expect(onSave).not.toHaveBeenCalled();
        expect(product.variant[0].packagingHierarchy).toHaveLength(2);
        expect(record.stockQuantities).toEqual([
            { packagingLevelId: "box", quantity: 8 }
        ]);
        expect(batch.batchId).toBe("batch-1");

        fireEvent.change(screen.getByRole("textbox", { name: /Reason for update/ }), {
            target: { value: "Remove Box packaging level" }
        });
        fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

        expect(onSave).toHaveBeenCalledOnce();
        expect(onSave.mock.calls[0][4]).toEqual([{
            type: "packaging",
            variantId: "variant-1",
            packagingLevelId: "box",
            reason: "Remove Box packaging level"
        }]);
    });

    it("blocks deletion of the packaging level currently used by the threshold", () => {
        const onSave = vi.fn();
        render(createElement(ProductEditModal, {
            product,
            inventoryRecords: [],
            inventoryBatches: [],
            onManageStock: () => undefined,
            onClose: () => undefined,
            onSave
        }));

        fireEvent.click(screen.getAllByRole("button", {
            name: "Delete Packaging Level"
        })[1]);

        expect(screen.getByRole("alert")).toHaveTextContent(
            "This packaging level is currently used by the variant's low-stock threshold."
        );
        expect(screen.queryByRole("alertdialog", {
            name: "Delete Pack packaging level?"
        })).not.toBeInTheDocument();
        expect(screen.queryByLabelText(
            "Reason for deleting Pack packaging level"
        )).not.toBeInTheDocument();
        expect(onSave).not.toHaveBeenCalled();
    });

    it("saves a new threshold level before allowing deletion of the old one", () => {
        const initialVariant = product.variant[0];
        const [box, pack] = initialVariant.packagingHierarchy;
        if (!box || !pack) {
            throw new Error("Threshold edit fixture requires Box and Pack levels.");
        }
        const card = {
            id: "card",
            name: "Card",
            costPrice: null,
            sellingPrice: 1,
            quantityofNextLevel: null,
            nextLevelId: null
        };
        const threeLevelProduct: productStructure = {
            ...product,
            variant: [{
                ...initialVariant,
                lowStockThreshold: {
                    quantity: 5,
                    packagingLevelId: box.id
                },
                packagingHierarchy: [
                    { ...box, quantityofNextLevel: 6, nextLevelId: pack.id },
                    { ...pack, quantityofNextLevel: 10, nextLevelId: card.id },
                    card
                ]
            }, ...product.variant.slice(1)]
        };
        const savedProducts: productStructure[] = [];
        render(createElement(ProductEditModal, {
            product: threeLevelProduct,
            inventoryRecords: [],
            inventoryBatches: [],
            onManageStock: () => undefined,
            onClose: () => undefined,
            onSave: (updatedProduct) => savedProducts.push(updatedProduct)
        }));

        fireEvent.change(screen.getAllByLabelText(
            "Threshold packaging level"
        )[0], { target: { value: pack.id } });
        fireEvent.change(screen.getByRole("textbox", { name: /Reason for update/ }), {
            target: { value: "Change threshold to Pack" }
        });
        fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

        const savedProduct = savedProducts[0];
        if (!savedProduct) {
            throw new Error("Saving the threshold change did not update the product.");
        }
        expect(savedProduct.variant[0].lowStockThreshold).toEqual({
            quantity: 5,
            packagingLevelId: pack.id
        });

        cleanup();
        const stagedDeletions: ProductRecordDeletionDraft[][] = [];
        const deletionProducts: productStructure[] = [];
        render(createElement(ProductEditModal, {
            product: savedProduct,
            inventoryRecords: [],
            inventoryBatches: [],
            onManageStock: () => undefined,
            onClose: () => undefined,
            onSave: (updatedProduct, _reason, _records, _batches, deletions = []) => {
                deletionProducts.push(updatedProduct);
                stagedDeletions.push(deletions);
            }
        }));

        fireEvent.click(screen.getAllByRole("button", {
            name: "Delete Packaging Level"
        })[0]);
        const confirmation = screen.getByRole("alertdialog", {
            name: "Delete Box packaging level?"
        });
        fireEvent.click(within(confirmation).getByRole("button", {
            name: "Confirm Delete"
        }));
        fireEvent.change(screen.getByRole("textbox", { name: /Reason for update/ }), {
            target: { value: "Remove Box after changing threshold" }
        });
        fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

        const deletionProduct = deletionProducts[0];
        const stagedDeletion = stagedDeletions[0]?.[0];
        if (!deletionProduct || !stagedDeletion) {
            throw new Error("The unreferenced Box level was not staged for deletion.");
        }
        const plan = prepareProductRecordDeletionPlan(
            deletionProduct,
            [],
            [],
            [{ ...stagedDeletion, operationId: "remove-saved-threshold-box" }]
        );

        expect(plan.product.variant[0].packagingHierarchy.map((level) => level.id))
            .toEqual([pack.id, card.id]);
        expect(plan.product.variant[0].lowStockThreshold).toEqual({
            quantity: 5,
            packagingLevelId: pack.id
        });

        cleanup();
        render(createElement(ProductEditModal, {
            product: plan.product,
            inventoryRecords: [],
            inventoryBatches: [],
            onManageStock: () => undefined,
            onClose: () => undefined,
            onSave: () => undefined
        }));
        expect(screen.getAllByLabelText("Threshold packaging level")[0])
            .toHaveValue(pack.id);
        expect(screen.getAllByLabelText(/Low-stock threshold quantity/)[0])
            .toHaveValue(5);
    });

    it("rejects staging a packaging deletion while retained pricing edits are unsaved", () => {
        const inventoryRecords: inventory[] = [{
            id: "inventory-1",
            productId: product.id,
            variantId: product.variant[0].id,
            batchId: "batch-1",
            stockQuantities: [
                { packagingLevelId: "box", quantity: 4 },
                { packagingLevelId: "pack", quantity: 6 }
            ]
        }];
        const inventoryBatches: inventoryBatch[] = [{
            batchId: "batch-1",
            productId: product.id,
            variantId: product.variant[0].id,
            batchNumber: "LOT-1",
            expiryDate: null,
            pricingByPackagingLevel: [
                { packagingLevelId: "box", costPrice: null, sellingPrice: 44.75 },
                { packagingLevelId: "pack", costPrice: 3.25, sellingPrice: null }
            ]
        }];
        const state = {
            products: [product],
            inventoryRecords,
            inventoryBatches,
            activityEvents: []
        };
        const before = structuredClone(state);
        const onSave = vi.fn();
        render(createElement(ProductEditModal, {
            product,
            inventoryRecords,
            inventoryBatches,
            onManageStock: () => undefined,
            onClose: () => undefined,
            onSave
        }));

        fireEvent.change(screen.getAllByLabelText("Selling price")[0], {
            target: { value: "46.25" }
        });
        fireEvent.change(screen.getByRole("textbox", { name: /Reason for update/ }), {
            target: { value: "Correct Box selling price" }
        });
        fireEvent.click(screen.getAllByRole("button", {
            name: "Delete Packaging Level"
        })[1]);

        expect(screen.getByRole("alert")).toHaveTextContent(
            "Product structure edits and deletions must be saved separately"
        );
        expect(screen.queryByRole("alertdialog", {
            name: "Delete Pack packaging level?"
        })).not.toBeInTheDocument();
        expect(screen.queryByLabelText(
            "Reason for deleting Pack packaging level"
        )).not.toBeInTheDocument();
        expect(onSave).not.toHaveBeenCalled();
        expect(state).toEqual(before);
    });

});
