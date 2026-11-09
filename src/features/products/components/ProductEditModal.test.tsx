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
    screen
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { inventory } from "../../../inventory/inventoryStock";
import type { inventoryBatch } from "../../../inventory/inventoryBatch";
import type { productStructure } from "../../../products/productStructure";
import ProductEditModal from "./ProductEditModal";

afterEach(cleanup);

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
        expect(markup).toContain("Remove variant");
        expect(markup).toContain("Remove</button>");
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

        renderToStaticMarkup(createElement(ProductEditModal, {
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
});
