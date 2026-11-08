import { describe, expect, it } from "vitest";
import type { productStructure } from "../products/productStructure";
import type { inventory } from "../inventory/inventoryStock";
import type { inventoryBatch } from "../inventory/inventoryBatch";
import {
    consumeNavigationRequest,
    createInventoryManageIntent,
    createProductEditIntent,
    dismissNavigationRequest,
    getNavigationDestination,
    isProductEditContextValid,
    resolveInventoryManageTarget,
    resolveNavigationProduct,
    type NavigationRequest
} from "./navigationIntent";

const products: productStructure[] = [
    {
        id: "product-1",
        name: "First",
        variant: [{ id: "variant-1", variantName: "Tablets", packagingHierarchy: [] }]
    },
    {
        id: "product-2",
        name: "Second",
        variant: [{ id: "variant-2", variantName: "Syrup", packagingHierarchy: [] }]
    }
];
const inventoryRecords: inventory[] = [{
    id: "inventory-2",
    productId: "product-2",
    variantId: "variant-2",
    batchId: "batch-2",
    stockQuantities: []
}];
const inventoryBatches: inventoryBatch[] = [{
    batchId: "batch-2",
    productId: "product-2",
    variantId: "variant-2",
    batchNumber: "B2",
    expiryDate: null
}];

describe("navigation intents", () => {
    it("routes ordinary page, product view/edit, and inventory intents", () => {
        expect(getNavigationDestination({
            type: "page.navigate",
            page: "inventory"
        })).toBe("inventory");
        expect(getNavigationDestination({
            type: "product.view",
            productId: "product-1"
        })).toBe("products");
        expect(getNavigationDestination({
            type: "product.edit",
            productId: "product-1"
        })).toBe("products");
        expect(getNavigationDestination({
            type: "inventory.manage",
            productId: "product-2",
            variantId: "variant-2",
            inventoryId: "inventory-2",
            batchId: "batch-2"
        })).toBe("inventory");
    });

    it("resolves only the exact stable product ID and tolerates missing IDs", () => {
        const selectedProduct = products[1];
        const request: NavigationRequest = {
            requestId: 1,
            intent: { type: "product.edit", productId: "product-2" },
            consumed: false
        };

        expect(resolveNavigationProduct(request.intent, products)).toBe(selectedProduct);
        expect(resolveNavigationProduct(
            {
                type: "inventory.manage",
                productId: "deleted-product",
                variantId: "variant-2",
                inventoryId: "inventory-2",
                batchId: "batch-2"
            },
            products
        )).toBeUndefined();
        expect(products[0].name).toBe("First");
    });

    it("validates a Product Edit variant context", () => {
        expect(isProductEditContextValid({
            type: "product.edit",
            productId: "product-2",
            variantId: "variant-2"
        }, products[1])).toBe(true);
        expect(isProductEditContextValid({
            type: "product.edit",
            productId: "product-2",
            variantId: "deleted-variant"
        }, products[1])).toBe(false);
    });

    it("creates typed intents with product, variant, batch, and inventory context", () => {
        expect(createInventoryManageIntent(
            "product-2",
            "variant-2",
            "inventory-2",
            "batch-2"
        )).toEqual({
            type: "inventory.manage",
            productId: "product-2",
            variantId: "variant-2",
            inventoryId: "inventory-2",
            batchId: "batch-2"
        });
        expect(createProductEditIntent("product-2", "variant-2")).toEqual({
            type: "product.edit",
            productId: "product-2",
            variantId: "variant-2"
        });
    });

    it("resolves exact inventory targets and rejects mismatched or missing context", () => {
        const intent = createInventoryManageIntent(
            "product-2",
            "variant-2",
            "inventory-2",
            "batch-2"
        );
        expect(resolveInventoryManageTarget(
            intent,
            products,
            inventoryRecords,
            inventoryBatches
        )).toMatchObject({
            product: products[1],
            inventoryRecord: inventoryRecords[0],
            batch: inventoryBatches[0]
        });
        expect(resolveInventoryManageTarget(
            { ...intent, inventoryId: "other-record" },
            products,
            inventoryRecords,
            inventoryBatches
        )).toBeUndefined();
        expect(resolveInventoryManageTarget(
            { ...intent, batchId: "other-batch" },
            products,
            inventoryRecords,
            inventoryBatches
        )).toBeUndefined();
        expect(resolveInventoryManageTarget(
            intent,
            products,
            inventoryRecords,
            []
        )).toBeUndefined();
        expect(inventoryRecords[0].stockQuantities).toEqual([]);
    });

    it("supports exact unbatched inventory context", () => {
        const record = {
            ...inventoryRecords[0],
            batchId: null
        };
        expect(resolveInventoryManageTarget(
            createInventoryManageIntent(
                record.productId,
                record.variantId,
                record.id,
                null
            ),
            products,
            [record],
            inventoryBatches
        )).toMatchObject({ inventoryRecord: record, batch: null });
    });

    it("does not resolve duplicate matching inventory identifiers", () => {
        const intent = createInventoryManageIntent(
            "product-2",
            "variant-2",
            "inventory-2",
            "batch-2"
        );
        expect(resolveInventoryManageTarget(
            intent,
            products,
            [...inventoryRecords, inventoryRecords[0]],
            inventoryBatches
        )).toBeUndefined();
    });

    it("consumes only the matching request and cannot consume it twice", () => {
        const request: NavigationRequest = {
            requestId: 2,
            intent: {
                type: "inventory.manage",
                productId: "product-2",
                variantId: "variant-2",
                inventoryId: "inventory-2",
                batchId: "batch-2"
            },
            consumed: false
        };
        const newerRequest: NavigationRequest = {
            requestId: 3,
            intent: { type: "product.view", productId: "product-2" },
            consumed: false
        };

        expect(consumeNavigationRequest(newerRequest, request.requestId))
            .toBe(newerRequest);
        const consumed = consumeNavigationRequest(request, request.requestId);
        expect(consumed?.consumed).toBe(true);
        expect(consumeNavigationRequest(consumed, request.requestId)).toEqual(consumed);
        expect(dismissNavigationRequest(consumed, request.requestId)).toBeNull();
        expect(dismissNavigationRequest(newerRequest, request.requestId))
            .toBe(newerRequest);
    });
});
