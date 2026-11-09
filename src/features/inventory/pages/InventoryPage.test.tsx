import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { productStructure } from "../../../products/productStructure";
import InventoryPage from "./InventoryPage";

describe("InventoryPage navigation", () => {
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
});
