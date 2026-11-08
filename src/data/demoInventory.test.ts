import { describe, expect, it, vi } from "vitest";
import { demoInventory, demoInventoryBatches } from "./demoInventory";
import { productList } from "../products/productList";
import { createInventory } from "../inventory/inventoryStock";

function getDemoIdSnapshot(
    products: typeof productList,
    inventoryRecords: typeof demoInventory,
    batches: typeof demoInventoryBatches
) {
    return {
        products: products.map((product) => ({
            id: product.id,
            variants: product.variant.map((variant) => ({
                id: variant.id,
                packagingLevels: variant.packagingHierarchy.map(
                    (level) => level.id
                )
            }))
        })),
        batches: batches.map((batch) => ({
            batchId: batch.batchId,
            productId: batch.productId,
            variantId: batch.variantId,
            batchNumber: batch.batchNumber,
            expiryDate: batch.expiryDate
        })),
        inventory: inventoryRecords.map((record) => ({
            id: record.id,
            productId: record.productId,
            variantId: record.variantId,
            batchId: record.batchId,
            packagingLevelIds: record.stockQuantities.map(
                (stock) => stock.packagingLevelId
            )
        }))
    };
}

describe("demo inventory identifiers", () => {
    it("keeps demo IDs stable across repeated module imports", async () => {
        const importDemoData = async () => {
            vi.resetModules();
            const [
                { productList: importedProducts },
                {
                    demoInventory: importedInventory,
                    demoInventoryBatches: importedBatches
                }
            ] =
                await Promise.all([
                    import("../products/productList"),
                    import("./demoInventory")
                ]);

            return getDemoIdSnapshot(
                importedProducts,
                importedInventory,
                importedBatches
            );
        };

        const firstImport = await importDemoData();
        const secondImport = await importDemoData();

        expect(secondImport).toEqual(firstImport);
    });

    it("uses unique IDs for each demo entity type", () => {
        const productIds = productList.map((product) => product.id);
        const variantIds = productList.flatMap((product) =>
            product.variant.map((variant) => variant.id)
        );
        const batchIds = demoInventoryBatches.map((batch) => batch.batchId);
        const packagingLevelIds = productList.flatMap((product) =>
            product.variant.flatMap((variant) =>
                variant.packagingHierarchy.map((level) => level.id)
            )
        );
        const inventoryIds = demoInventory.map((record) => record.id);

        for (const ids of [
            productIds,
            variantIds,
            batchIds,
            packagingLevelIds,
            inventoryIds
        ]) {
            expect(new Set(ids).size).toBe(ids.length);
            expect(ids.every((id) => id.length > 0)).toBe(true);
        }
    });

    it("preserves all product, variant, batch, and packaging references", () => {
        for (const record of demoInventory) {
            const product = productList.find(
                (item) => item.id === record.productId
            );
            expect(product).toBeDefined();

            const variant = product?.variant.find(
                (item) => item.id === record.variantId
            );
            expect(variant).toBeDefined();
            expect(
                demoInventoryBatches.some(
                    (batch) =>
                        batch.batchId === record.batchId &&
                        batch.productId === record.productId &&
                        batch.variantId === record.variantId
                )
            ).toBe(true);

            const packagingIds = new Set(
                variant?.packagingHierarchy.map((level) => level.id)
            );
            expect(
                record.stockQuantities.every((stock) =>
                    packagingIds.has(stock.packagingLevelId)
                )
            ).toBe(true);
        }
    });

    it("generates a UUID when createInventory receives no ID", () => {
        const record = createInventory(
            "product-1",
            "variant-1",
            "batch-1",
            [{ packagingLevelId: "box-1", quantity: 3 }]
        );

        expect(record.id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        );
    });

    it("preserves an explicitly supplied inventory ID", () => {
        const record = createInventory(
            "product-1",
            "variant-1",
            "batch-1",
            [{ packagingLevelId: "box-1", quantity: 3 }],
            "inventory-fixed"
        );

        expect(record.id).toBe("inventory-fixed");
    });
});
