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
import CreateProductModal from "./CreateProductModal";
import {
    addVariantCreationDraft,
    createEmptyVariantCreationDraft,
    removeVariantCreationDraft,
    type ProductCreationResult,
    type VariantCreationDraft
} from "../../../products/productCreation";

afterEach(cleanup);

function variantDraft(
    key: string,
    nafdacRegistrationNumber: string
): VariantCreationDraft {
    return {
        key,
        name: key,
        nafdacRegistrationNumber,
        lowStockThresholdQuantity: "",
        lowStockThresholdPackagingLevelId: "",
        packaging: [],
        batches: [],
        unbatchedStock: {}
    };
}

describe("CreateProductModal NAFDAC field", () => {
    it("places one registration field after Manufacturer when variants are disabled", () => {
        const markup = renderToStaticMarkup(createElement(CreateProductModal, {
            products: [],
            inventoryRecords: [],
            inventoryBatches: [],
            onCreate: () => undefined,
            onClose: () => undefined
        }));

        const manufacturerPosition = markup.indexOf("<span>Manufacturer</span>");
        const registrationPosition = markup.indexOf(
            "<span>NAFDAC Registration Number</span>"
        );
        const categoryPosition = markup.indexOf("<span>Category</span>");

        expect(manufacturerPosition).toBeGreaterThanOrEqual(0);
        expect(registrationPosition).toBeGreaterThan(manufacturerPosition);
        expect(categoryPosition).toBeGreaterThan(registrationPosition);
        expect(markup.match(/NAFDAC Registration Number/g)).toHaveLength(1);
    });

    it("adds a variant with an independent empty registration value", () => {
        const existing = variantDraft("existing", "REG-1");
        const added = addVariantCreationDraft([existing]);

        expect(added).toHaveLength(2);
        expect(added[0]).toBe(existing);
        expect(added[0].nafdacRegistrationNumber).toBe("REG-1");
        expect(added[1].nafdacRegistrationNumber).toBe("");
        expect(added[1].key).not.toBe(existing.key);
        expect(createEmptyVariantCreationDraft().nafdacRegistrationNumber).toBe("");
    });

    it("removes only the selected variant and preserves other registration values", () => {
        const variants = [
            variantDraft("first", "REG-1"),
            variantDraft("removed", "REG-2"),
            variantDraft("last", "REG-3")
        ];

        expect(removeVariantCreationDraft(variants, 1)).toEqual([
            variants[0],
            variants[2]
        ]);
    });
});

describe("CreateProductModal validation warning", () => {
    it("lists actual errors, preserves entered values, and creates after correction", () => {
        const onCreate = vi.fn<(result: ProductCreationResult) => void>();
        const onClose = vi.fn();
        render(createElement(CreateProductModal, {
            products: [],
            inventoryRecords: [],
            inventoryBatches: [],
            onCreate,
            onClose
        }));

        fireEvent.change(screen.getByLabelText(/Product name/), {
            target: { value: "New Medicine" }
        });
        fireEvent.change(screen.getByLabelText("Manufacturer"), {
            target: { value: "Preserved Manufacturer" }
        });
        fireEvent.click(screen.getByRole("checkbox", { name: "Add Variants" }));
        fireEvent.click(screen.getByRole("button", { name: "Create Product" }));

        const warning = screen.getByRole("alertdialog", {
            name: "Unable to Create Product"
        });
        expect(within(warning).getAllByRole("listitem").map((item) =>
            item.textContent
        )).toEqual([
            "Enter a name or description.",
            "Enter a non-negative whole-number low-stock threshold.",
            "Add a packaging level to configure the low-stock threshold."
        ]);
        expect(within(warning).getAllByRole("button").map((button) =>
            button.textContent
        )).toEqual(["Cancel"]);
        expect(onCreate).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();

        fireEvent.click(within(warning).getByRole("button", { name: "Cancel" }));

        expect(screen.getByRole("dialog", { name: "Create Product" }))
            .toBeInTheDocument();
        expect(screen.getByLabelText(/Product name/)).toHaveValue("New Medicine");
        expect(screen.getByLabelText("Manufacturer"))
            .toHaveValue("Preserved Manufacturer");

        fireEvent.change(screen.getByLabelText(/Name or description/), {
            target: { value: "Tablets" }
        });
        fireEvent.change(screen.getByLabelText(/Threshold quantity/), {
            target: { value: "5" }
        });
        fireEvent.click(screen.getByRole("button", {
            name: "Add Packaging Level"
        }));
        fireEvent.change(screen.getByLabelText(/Packaging name/), {
            target: { value: "Box" }
        });
        fireEvent.click(screen.getByRole("button", { name: "Create Product" }));

        expect(onCreate).toHaveBeenCalledOnce();
        expect(onCreate.mock.calls[0][0].product.name).toBe("New Medicine");
        expect(onCreate.mock.calls[0][0].product.variant[0]?.variantName)
            .toBe("Tablets");
        expect(onClose).toHaveBeenCalledOnce();
    });
});
