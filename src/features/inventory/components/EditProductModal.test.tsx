import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { inventoryDisplay } from "../../../inventory/inventoryLookup";
import type { inventoryBatch } from "../../../inventory/inventoryBatch";
import type { productStructure } from "../../../products/productStructure";
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
    expiryDate: new Date("2027-01-01")
}];

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
    });

    it("omits the unbatched section when no unbatched record exists", () => {
        const markup = renderModal([
            inventoryRecord("batch-record", "batch-1", 4)
        ]);

        expect(markup).not.toContain("Unbatched Inventory");
        expect(markup).toContain("Batch information");
    });
});
