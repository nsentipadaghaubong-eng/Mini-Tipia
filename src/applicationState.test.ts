import { describe, expect, it } from "vitest";
import {
    buildProductCreationActivityInputs,
    prepareActivityEvents,
    snapshotProduct,
    type ActivityEventInput
} from "./activity/activity";
import {
    applicationReducer,
    createInitialApplicationState
} from "./applicationState";
import { createProductFromDraft } from "./products/productCreation";
import {
    addVariantToUpdateDraft,
    buildUpdatedProduct,
    createProductUpdateDraft
} from "./products/productUpdate";

function createProductResult() {
    return createProductFromDraft({
        name: "Medicine",
        genericName: "Generic medicine",
        manufacturer: "Pharma",
        category: "Medicine",
        addVariants: false,
        variants: [{
            key: "variant-draft",
            name: "",
            nafdacRegistrationNumber: "REG-1",
            packaging: [{
                key: "box-draft",
                name: "Box",
                quantityOfNextLevel: "",
                costPrice: "10",
                sellingPrice: "15"
            }],
            batches: [{
                batchNumber: "LOT-1",
                expiryDate: "2027-01-31",
                stock: { "box-draft": "4" }
            }],
            unbatchedStock: {}
        }]
    });
}

describe("application-level Activity state", () => {
    it("commits product, initial inventory, batches and Activity together exactly once", () => {
        const result = createProductResult();
        const events = prepareActivityEvents(
            buildProductCreationActivityInputs(
                result.product,
                result.inventoryRecords,
                result.inventoryBatches
            ),
            { makeId: () => crypto.randomUUID() }
        );
        const initial = {
            ...createInitialApplicationState(),
            products: [],
            inventoryRecords: [],
            inventoryBatches: [],
            activityEvents: []
        };
        const action = { type: "product.created" as const, result, events };
        const committed = applicationReducer(initial, action);

        expect(committed.products).toEqual([result.product]);
        expect(committed.inventoryRecords).toEqual(result.inventoryRecords);
        expect(committed.inventoryBatches).toEqual(result.inventoryBatches);
        expect(committed.activityEvents.map((event) => event.type)).toEqual([
            "product.created",
            "inventory.batch_created"
        ]);
        expect(applicationReducer(committed, action)).toBe(committed);
    });

    it("does not commit or record when product creation fails validation", () => {
        const initial = {
            ...createInitialApplicationState(),
            products: [],
            inventoryRecords: [],
            inventoryBatches: [],
            activityEvents: []
        };

        expect(() => createProductFromDraft({
            name: " ",
            genericName: "",
            manufacturer: "",
            category: "",
            addVariants: false,
            variants: [{
                key: "variant-draft",
                name: "",
                nafdacRegistrationNumber: "",
                packaging: [],
                batches: [],
                unbatchedStock: {}
            }]
        })).toThrow("Product name is required.");
        expect(initial.activityEvents).toEqual([]);
        expect(initial.products).toEqual([]);
    });

    it("commits inventory changes and adjustment events atomically and idempotently", () => {
        const initial = createInitialApplicationState();
        const state = {
            ...initial,
            inventoryRecords: [],
            inventoryBatches: [],
            activityEvents: []
        };
        const eventInputs: ActivityEventInput[] = [{
            type: "inventory.stock_adjusted",
            operationKey: "inventory.stock_adjusted:adjustment-1",
            inventoryId: "inventory-1",
            productId: "product-1",
            productName: "Medicine",
            variantId: "variant-1",
            variantName: "Tablets",
            batch: null,
            packagingLevel: {
                packagingLevelId: "box-1",
                name: "Box",
                costPrice: null,
                sellingPrice: null,
                quantityOfNextLevel: null,
                nextLevelId: null,
                nextLevelName: null
            },
            previousQuantity: 4,
            newQuantity: 6,
            quantityDifference: 2,
            reason: "Physical count"
        }];
        const events = prepareActivityEvents(eventInputs);
        const action = {
            type: "inventory.saved" as const,
            inventoryRecords: [{
                id: "inventory-1",
                productId: "product-1",
                variantId: "variant-1",
                batchId: null,
                stockQuantities: [{ packagingLevelId: "box-1", quantity: 6 }]
            }],
            inventoryBatches: [],
            events
        };
        const committed = applicationReducer(state, action);

        expect(committed.inventoryRecords[0].stockQuantities[0].quantity).toBe(6);
        expect(committed.products).toBe(state.products);
        expect(committed.activityEvents).toHaveLength(1);
        expect(applicationReducer(committed, action)).toBe(committed);
    });

    it("commits a product update with before-and-after Activity snapshots only", () => {
        const state = createInitialApplicationState();
        const original = state.products[0];
        const updated = {
            ...original,
            name: `${original.name} updated`,
            variant: original.variant.map((productVariant, index) =>
                index === 0
                    ? {
                        ...productVariant,
                        packagingHierarchy:
                            productVariant.packagingHierarchy.map((level) =>
                                level.nextLevelId
                                    ? { ...level, quantityofNextLevel: 12 }
                                    : level
                            )
                    }
                    : productVariant
            )
        };
        const events = prepareActivityEvents([{
            type: "product.updated",
            operationKey: "product.updated:test-operation",
            productId: original.id,
            productName: updated.name,
            before: snapshotProduct(original),
            after: snapshotProduct(updated),
            reason: "Updated product details"
        }]);
        const action = {
            type: "product.updated" as const,
            product: updated,
            events
        };

        const committed = applicationReducer(state, action);

        expect(committed.products.find((product) => product.id === original.id))
            .toEqual(updated);
        expect(committed.activityEvents.at(-1)).toMatchObject({
            type: "product.updated",
            before: snapshotProduct(original),
            after: snapshotProduct(updated),
            reason: "Updated product details"
        });
        expect(committed.inventoryRecords).toBe(state.inventoryRecords);
        expect(committed.inventoryBatches).toBe(state.inventoryBatches);
        expect(applicationReducer(committed, action)).toBe(committed);
    });

    it("keeps all inventory records and batches unchanged when a product conversion changes", () => {
        const initial = createInitialApplicationState();
        const original = initial.products[0];
        const state = {
            ...initial,
            inventoryRecords: [{
                id: "inventory-keep-quantity",
                productId: original.id,
                variantId: original.variant[0].id,
                batchId: "batch-keep",
                stockQuantities: [{
                    packagingLevelId: original.variant[0].packagingHierarchy[0].id,
                    quantity: 5
                }]
            }],
            inventoryBatches: [{
                batchId: "batch-keep",
                productId: original.id,
                variantId: original.variant[0].id,
                batchNumber: "KEEP-1",
                expiryDate: new Date("2027-01-01")
            }]
        };
        const inventoryBefore = structuredClone(state.inventoryRecords);
        const batchesBefore = structuredClone(state.inventoryBatches);
        const otherProductsBefore = state.products.filter(
            (product) => product.id !== original.id
        );
        const otherVariantsBefore = structuredClone(original.variant.slice(1));
        const draft = createProductUpdateDraft(original);
        draft.variants[0].packaging[0].quantityofNextLevel = "6";
        draft.reason = "Update Box conversion";
        const updated = buildUpdatedProduct(original, draft);
        const events = prepareActivityEvents([{
            type: "product.updated",
            operationKey: "product.updated:conversion-change",
            productId: original.id,
            productName: updated.name,
            before: snapshotProduct(original),
            after: snapshotProduct(updated),
            reason: "Update conversion"
        }]);

        const committed = applicationReducer(state, {
            type: "product.updated",
            product: updated,
            events
        });

        expect(committed.products[0].variant[0].packagingHierarchy[0]
            .quantityofNextLevel).toBe(6);
        expect(committed.products[0].variant[0].packagingHierarchy.slice(1))
            .toEqual(original.variant[0].packagingHierarchy.slice(1));
        expect(committed.products[0].variant.slice(1)).toEqual(otherVariantsBefore);
        expect(committed.products.filter((product) => product.id !== original.id))
            .toEqual(otherProductsBefore);
        expect(committed.inventoryRecords).toEqual(inventoryBefore);
        expect(committed.inventoryRecords[0].stockQuantities).toEqual(
            inventoryBefore[0].stockQuantities
        );
        expect(committed.inventoryBatches).toEqual(batchesBefore);

        const reopenedProduct = committed.products.find(
            (product) => product.id === original.id
        );
        expect(reopenedProduct).toBeDefined();
        const reopenedDraft = createProductUpdateDraft(reopenedProduct!);
        expect(reopenedDraft.variants[0].packaging[0].quantityofNextLevel)
            .toBe("6");
    });

    it("persists product fields and a new variant without creating inventory or batches", () => {
        const state = createInitialApplicationState();
        const original = state.products[0];
        const draft = addVariantToUpdateDraft(
            createProductUpdateDraft(original),
            () => "variant-added"
        );
        draft.name = "Updated medicine";
        draft.genericName = "Updated generic";
        draft.manufacturer = "Updated manufacturer";
        draft.category = "Updated category";
        draft.variants[0].name = "Updated existing variant";
        draft.variants[0].nafdacRegistrationNumber = "REG-UPDATED";
        draft.variants[0].packaging[0].name = "Updated box";
        draft.variants[0].packaging[0].costPrice = "25";
        draft.variants[0].packaging[0].sellingPrice = "35";
        const addedVariant = draft.variants.at(-1)!;
        addedVariant.name = "Added variant";
        addedVariant.nafdacRegistrationNumber = "REG-ADDED";
        addedVariant.packaging.push({
            id: "added-packaging",
            name: "Added unit",
            nextLevelId: "",
            quantityofNextLevel: "",
            costPrice: "5",
            sellingPrice: "8"
        });
        draft.reason = "Add a product variant";
        const updated = buildUpdatedProduct(original, draft);
        const events = prepareActivityEvents([{
            type: "product.updated",
            operationKey: "product.updated:add-variant",
            productId: original.id,
            productName: updated.name,
            before: snapshotProduct(original),
            after: snapshotProduct(updated),
            reason: draft.reason
        }]);

        const committed = applicationReducer(state, {
            type: "product.updated",
            product: updated,
            events
        });

        expect(committed.products[0].variant.at(-1)).toMatchObject({
            id: "variant-added",
            variantName: "Added variant",
            nafdacRegistrationNumber: "REG-ADDED",
            packagingHierarchy: [{
                id: "added-packaging",
                name: "Added unit",
                costPrice: 5,
                sellingPrice: 8
            }]
        });
        expect(committed.products[0].variant.slice(1, -1))
            .toEqual(original.variant.slice(1));
        expect(committed.inventoryRecords).toBe(state.inventoryRecords);
        expect(committed.inventoryBatches).toBe(state.inventoryBatches);
        expect(committed.activityEvents.map((event) => event.type))
            .toEqual(["product.updated"]);

        const reopenedProduct = committed.products.find(
            (product) => product.id === original.id
        );
        expect(reopenedProduct).toBeDefined();
        const reopenedDraft = createProductUpdateDraft(reopenedProduct!);
        expect(reopenedDraft).toMatchObject({
            name: "Updated medicine",
            genericName: "Updated generic",
            manufacturer: "Updated manufacturer",
            category: "Updated category"
        });
        expect(reopenedDraft.variants[0]).toMatchObject({
            name: "Updated existing variant",
            nafdacRegistrationNumber: "REG-UPDATED"
        });
        expect(reopenedDraft.variants[0].packaging[0]).toMatchObject({
            name: "Updated box",
            costPrice: "25",
            sellingPrice: "35"
        });
        expect(reopenedDraft.variants.at(-1)).toMatchObject({
            id: "variant-added",
            name: "Added variant",
            nafdacRegistrationNumber: "REG-ADDED",
            packaging: [{
                id: "added-packaging",
                name: "Added unit",
                costPrice: "5",
                sellingPrice: "8"
            }]
        });
    });

    it("rejects product updates that lack matching Activity without changing state", () => {
        const state = createInitialApplicationState();
        const action = {
            type: "product.updated" as const,
            product: { ...state.products[0], name: "Changed" },
            events: []
        };

        expect(() => applicationReducer(state, action)).toThrow(
            "A product update requires matching update Activity."
        );
        expect(state.products[0].name).not.toBe("Changed");
    });
});
