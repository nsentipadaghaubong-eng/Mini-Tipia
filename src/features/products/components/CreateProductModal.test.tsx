import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CreateProductModal from "./CreateProductModal";
import {
    addVariantCreationDraft,
    createEmptyVariantCreationDraft,
    removeVariantCreationDraft,
    type VariantCreationDraft
} from "../../../products/productCreation";

function variantDraft(
    key: string,
    nafdacRegistrationNumber: string
): VariantCreationDraft {
    return {
        key,
        name: key,
        nafdacRegistrationNumber,
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
