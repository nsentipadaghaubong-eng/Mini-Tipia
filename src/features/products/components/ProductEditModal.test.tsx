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
                expiryDate: null
            },
            {
                batchId: "batch-2",
                productId: product.id,
                variantId: product.variant[0].id,
                batchNumber: "B2",
                expiryDate: null
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
            expiryDate: null
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
            expiryDate: new Date("2027-01-01")
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

    it("confirms variant deletion, stages it, and commits only after reasons are valid", () => {
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

        const saveButton = screen.getByRole("button", { name: "Save Changes" });
        fireEvent.change(screen.getByLabelText("Reason for deleting Tablets"), {
            target: { value: "Discontinue tablet variant" }
        });
        fireEvent.change(screen.getByRole("textbox", { name: /Reason for update/ }), {
            target: { value: "Update product details" }
        });
        expect(saveButton).toBeEnabled();
        fireEvent.click(saveButton);

        expect(onSave).toHaveBeenCalledOnce();
        expect(onSave.mock.calls[0][4]).toEqual([{
            type: "variant",
            variantId: "variant-1",
            reason: "Discontinue tablet variant"
        }]);
    });

    it("opens a packaging-specific confirmation and stages that packaging level", () => {
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
        })[0]);
        const confirmation = screen.getByRole("alertdialog", {
            name: "Delete Box packaging level?"
        });
        expect(confirmation).toHaveTextContent("Box packaging level");
        fireEvent.click(within(confirmation).getByRole("button", {
            name: "Confirm Delete"
        }));

        expect(screen.getByLabelText("Reason for deleting Box packaging level"))
            .toBeInTheDocument();
        expect(onSave).not.toHaveBeenCalled();
    });

});
