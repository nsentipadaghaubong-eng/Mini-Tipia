import { describe, expect, it } from "vitest";
import {
    buildProductCreationActivityInputs,
    buildProductDeletionActivityInput,
    buildProductUpdateActivityInputs,
    prepareActivityEvents,
    snapshotBatch,
    snapshotPackagingLevel,
    snapshotProduct,
    snapshotVariant,
    type ActivityEventInput
} from "./activity/activity";
import {
    applicationReducer,
    createInitialApplicationState
} from "./applicationState";
import type { ApplicationState } from "./applicationState";
import type { SaleDraft } from "./sales/salesDraft";
import type { DeliveryDraft } from "./deliveries/deliveryDraft";
import type { CompletedSale } from "./sales/salesEngine";
import { createProductFromDraft } from "./products/productCreation";
import {
    addPackagingLevelToUpdateDraft,
    addVariantToUpdateDraft,
    applyPackagingLevelInitialStock,
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

function makeProductDeletionState(): ApplicationState {
    const result = createProductResult();
    return {
        ...createInitialApplicationState(),
        products: [result.product],
        inventoryRecords: result.inventoryRecords,
        inventoryBatches: result.inventoryBatches,
        activityEvents: []
    };
}

function makeProductDeletionAction(state: ApplicationState) {
    const product = state.products[0];
    if (!product) {
        throw new Error("Deletion fixture requires a product.");
    }

    return {
        type: "product.deleted" as const,
        productId: product.id,
        events: prepareActivityEvents([
            buildProductDeletionActivityInput(
                product,
                state.inventoryRecords,
                state.inventoryBatches,
                `product.deleted:${product.id}:test`
            )
        ], {
            makeId: () => "product-deleted-event",
            now: () => new Date("2026-02-03T04:05:06.000Z")
        })
    };
}

function makeSalesDraft(productId: string): SaleDraft {
    return {
        draftId: "sale-draft-active",
        status: "draft",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        items: [{
            lineId: "sale-line",
            productId,
            variantId: "variant-draft",
            inventoryRecordId: "inventory-draft",
            batchId: null,
            packagingLevelId: "packaging-draft",
            quantity: 1,
            defaultSellingPrice: 1,
            appliedSellingPrice: 1,
            discountAmount: 0
        }]
    };
}

function makeDeliveryDraft(
    productId: string,
    status: DeliveryDraft["status"] = "draft"
): DeliveryDraft {
    return {
        deliveryId: "delivery-draft",
        status,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        deliveryDate: "2026-01-01",
        receivedBy: "Staff",
        items: [{
            deliveryItemId: "delivery-item",
            productId,
            variantId: "variant-draft",
            packagingLevelId: "packaging-draft",
            quantity: 3,
            batchNumber: "DELIVERY-LOT",
            expiryDate: "2027-01-01"
        }]
    };
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

    it("records catalogue-only product creation exactly once without inventory events", () => {
        const product = createProductResult().product;
        const state = {
            ...createInitialApplicationState(),
            products: [],
            inventoryRecords: [],
            inventoryBatches: [],
            activityEvents: []
        };
        const action = {
            type: "product.catalogue_created" as const,
            product,
            events: prepareActivityEvents(
                buildProductCreationActivityInputs(product, [], [])
            )
        };

        const committed = applicationReducer(state, action);

        expect(committed.products).toEqual([product]);
        expect(committed.inventoryRecords).toEqual([]);
        expect(committed.inventoryBatches).toEqual([]);
        expect(committed.activityEvents).toHaveLength(1);
        expect(committed.activityEvents[0]).toMatchObject({
            type: "product.created",
            operationKey: `product.created:${product.id}`,
            product: snapshotProduct(product),
            initialInventory: []
        });
        expect(applicationReducer(committed, action)).toBe(committed);
    });

    it("records a Receive Delivery variant creation exactly once", () => {
        const state = createInitialApplicationState();
        const product = state.products[0];
        const productVariant = {
            id: "delivery-created-variant",
            variantName: "Delivery variant",
            packagingHierarchy: [{
                id: "delivery-created-packaging",
                name: "Unit",
                costPrice: null,
                sellingPrice: null,
                quantityofNextLevel: null,
                nextLevelId: null
            }]
        };
        const action = {
            type: "product.variant_added" as const,
            productId: product.id,
            variant: productVariant,
            events: prepareActivityEvents([{
                type: "product.variant_added",
                operationKey:
                    `product.variant_added:${product.id}:${productVariant.id}`,
                productId: product.id,
                productName: product.name,
                variant: snapshotVariant(productVariant),
                reason: "Added through Receive Delivery"
            }])
        };

        const committed = applicationReducer(state, action);

        expect(committed.products[0].variant.at(-1)).toEqual(productVariant);
        expect(committed.activityEvents).toHaveLength(1);
        expect(committed.activityEvents[0]).toMatchObject({
            type: "product.variant_added",
            operationKey:
                `product.variant_added:${product.id}:${productVariant.id}`,
            productId: product.id,
            productName: product.name,
            variant: snapshotVariant(productVariant)
        });
        expect(applicationReducer(committed, action)).toBe(committed);
    });

    it("records actual initial stock for a new packaging level, but not zero stock", () => {
        const product = createProductResult().product;
        const productVariant = product.variant[0];
        const inventoryBatches = [{
            batchId: "initial-packaging-batch",
            productId: product.id,
            variantId: productVariant.id,
            batchNumber: "INIT-1",
            expiryDate: new Date("2027-01-31")
        }];
        const draft = addPackagingLevelToUpdateDraft(
            createProductUpdateDraft(product),
            0,
            () => "initial-packaging-level"
        );
        draft.reason = "Add a packaging level";
        const previousTerminal = draft.variants[0].packaging.at(-2)!;
        previousTerminal.quantityofNextLevel = "2";
        const newLevel = draft.variants[0].packaging.at(-1)!;
        newLevel.name = "Unit";
        const updatedProduct = buildUpdatedProduct(product, draft);
        const inventoryRecords = applyPackagingLevelInitialStock(
            product,
            [],
            inventoryBatches,
            productVariant.id,
            newLevel.id,
            "7",
            inventoryBatches[0].batchId
        );
        const record = inventoryRecords[0];
        const operationId = "product.updated:packaging-stock";
        const state = {
            ...createInitialApplicationState(),
            products: [product],
            inventoryRecords: [],
            inventoryBatches,
            activityEvents: []
        };
        const action = {
            type: "product.updated" as const,
            product: updatedProduct,
            inventoryRecords,
            inventoryBatches,
            events: prepareActivityEvents(buildProductUpdateActivityInputs(
                product,
                updatedProduct,
                [],
                inventoryRecords,
                inventoryBatches,
                operationId,
                draft.reason
            ))
        };

        const committed = applicationReducer(state, action);

        expect(committed.inventoryRecords[0].stockQuantities).toContainEqual({
            packagingLevelId: newLevel.id,
            quantity: 7
        });
        expect(committed.activityEvents.filter(
            (event) => event.type === "inventory.stock_adjusted"
        )).toMatchObject([{
            inventoryId: record.id,
            productId: product.id,
            variantId: productVariant.id,
            batch: {
                batchId: inventoryBatches[0].batchId,
                batchNumber: "INIT-1"
            },
            packagingLevel: {
                packagingLevelId: newLevel.id,
                name: "Unit"
            },
            previousQuantity: 0,
            newQuantity: 7,
            quantityDifference: 7,
            reason: "Initial stock added for packaging level Unit"
        }]);

        const zeroStockRecords = applyPackagingLevelInitialStock(
            product,
            [],
            inventoryBatches,
            productVariant.id,
            newLevel.id,
            "0"
        );
        const zeroStockAction = {
            ...action,
            inventoryRecords: zeroStockRecords,
            events: prepareActivityEvents(buildProductUpdateActivityInputs(
                product,
                updatedProduct,
                [],
                zeroStockRecords,
                inventoryBatches,
                "product.updated:zero-packaging-stock",
                draft.reason
            ))
        };
        const zeroStockCommitted = applicationReducer(state, zeroStockAction);

        expect(zeroStockCommitted.inventoryRecords).toEqual([]);
        expect(zeroStockCommitted.activityEvents.map((event) => event.type))
            .toEqual(["product.updated"]);
    });

    it("does not append Activity when catalogue, variant, or stock commits fail", () => {
        const state = createInitialApplicationState();
        const duplicateProduct = {
            ...createProductResult().product,
            id: state.products[0].id
        };
        const invalidCatalogueAction = {
            type: "product.catalogue_created" as const,
            product: duplicateProduct,
            events: prepareActivityEvents(
                buildProductCreationActivityInputs(duplicateProduct, [], [])
            )
        };
        expect(() => applicationReducer(state, invalidCatalogueAction))
            .toThrow("Catalogue product contains an invalid or duplicate ID.");
        expect(state.activityEvents).toEqual([]);

        const invalidVariantAction = {
            type: "product.variant_added" as const,
            productId: "missing-product",
            variant: state.products[0].variant[0],
            events: prepareActivityEvents([{
                type: "product.variant_added",
                operationKey:
                    `product.variant_added:missing-product:${state.products[0].variant[0].id}`,
                productId: "missing-product",
                productName: "Missing",
                variant: snapshotVariant(state.products[0].variant[0]),
                reason: "Test failed operation"
            }])
        };
        expect(() => applicationReducer(state, invalidVariantAction))
            .toThrow("Product not found: missing-product");
        expect(state.activityEvents).toEqual([]);

        const product = createProductResult().product;
        const productVariant = product.variant[0];
        const draft = addPackagingLevelToUpdateDraft(
            createProductUpdateDraft(product),
            0,
            () => "failed-packaging-level"
        );
        draft.reason = "Add packaging";
        draft.variants[0].packaging.at(-2)!.quantityofNextLevel = "2";
        draft.variants[0].packaging.at(-1)!.name = "Unit";
        const updatedProduct = buildUpdatedProduct(product, draft);
        const inventoryRecords = applyPackagingLevelInitialStock(
            product,
            [],
            [],
            productVariant.id,
            "failed-packaging-level",
            "3"
        );
        const stockInputs = buildProductUpdateActivityInputs(
            product,
            updatedProduct,
            [],
            inventoryRecords,
            [],
            "product.updated:failed-stock",
            "Test failed operation"
        );
        const stockState = {
            ...createInitialApplicationState(),
            products: [product],
            inventoryRecords: [],
            inventoryBatches: [],
            activityEvents: []
        };
        const invalidStockAction = {
            type: "product.updated" as const,
            product: updatedProduct,
            inventoryRecords: inventoryRecords.map((record) => ({
                ...record,
                stockQuantities: record.stockQuantities.map((stock) => ({
                    ...stock,
                    quantity: 4
                }))
            })),
            events: prepareActivityEvents(stockInputs)
        };
        expect(() => applicationReducer(stockState, invalidStockAction))
            .toThrow("Packaging stock Activity does not match the committed quantity.");
        expect(stockState.activityEvents).toEqual([]);
        expect(stockState.products[0]).toBe(product);
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

    it("permanently deletes a product and commits its complete historical snapshot", () => {
        const state = makeProductDeletionState();
        const product = state.products[0];
        const action = makeProductDeletionAction(state);

        const committed = applicationReducer(state, action);

        expect(committed.products).toEqual([]);
        expect(committed.inventoryRecords).toEqual([]);
        expect(committed.inventoryBatches).toEqual([]);
        expect(committed.activityEvents).toHaveLength(1);
        const [event] = committed.activityEvents;
        expect(event.type).toBe("product.deleted");
        if (event.type !== "product.deleted") {
            throw new Error("Expected product deletion Activity.");
        }
        expect(event.productId).toBe(product.id);
        expect(event.productName).toBe(product.name);
        expect(event.product).toEqual(snapshotProduct(product));
        expect(event.occurredAt).toBe("2026-02-03T04:05:06.000Z");
        expect(event.product.variants[0].packaging[0]).toMatchObject({
            packagingLevelId: product.variant[0].packagingHierarchy[0].id,
            quantityOfNextLevel: null
        });
        expect(event.inventory).toHaveLength(state.inventoryRecords.length);
        expect(event.inventory[0].stock[0]).toMatchObject({
            quantity: state.inventoryRecords[0].stockQuantities[0].quantity,
            packagingLevel: {
                packagingLevelId:
                    state.inventoryRecords[0].stockQuantities[0].packagingLevelId
            }
        });
        expect(event.batches).toEqual(state.inventoryBatches.map(
            (batch) => snapshotBatch(batch, product)
        ));
        expect(event.batches[0]).toMatchObject({
            batchNumber: "LOT-1",
            expiryDate: "2027-01-31T00:00:00.000Z"
        });
    });

    it.each([
        ["active Sales draft", (productId: string) => ({
            saleDrafts: [makeSalesDraft(productId)]
        })],
        ["active Receive Delivery draft", (productId: string) => ({
            deliveryDrafts: [makeDeliveryDraft(productId)]
        })],
        ["both active drafts", (productId: string) => ({
            saleDrafts: [makeSalesDraft(productId)],
            deliveryDrafts: [makeDeliveryDraft(productId)]
        })]
    ])("rejects deletion referenced by an %s without recording Activity", (_label, drafts) => {
        const state = makeProductDeletionState();
        const blockedState = {
            ...state,
            ...drafts(state.products[0].id)
        };
        const action = makeProductDeletionAction(blockedState);

        expect(() => applicationReducer(blockedState, action)).toThrow(
            /cannot be deleted/
        );
        expect(blockedState.products).toHaveLength(1);
        expect(blockedState.inventoryRecords).toHaveLength(state.inventoryRecords.length);
        expect(blockedState.inventoryBatches).toHaveLength(state.inventoryBatches.length);
        expect(blockedState.activityEvents).toEqual([]);
    });

    it("allows deletion with completed sale and received delivery history and preserves both", () => {
        const state = makeProductDeletionState();
        const product = state.products[0];
        const productVariant = product.variant[0];
        const packagingLevel = productVariant.packagingHierarchy[0];
        const batch = state.inventoryBatches[0];
        const sale: CompletedSale = {
            saleId: "completed-sale",
            completedAt: "2026-02-01T10:00:00.000Z",
            items: [{
                lineId: "completed-sale-line",
                product: snapshotProduct(product),
                variant: snapshotVariant(productVariant),
                batch: batch ? snapshotBatch(batch, product) : null,
                inventoryRecordId: state.inventoryRecords[0].id,
                packagingLevel: snapshotPackagingLevel(
                    packagingLevel,
                    productVariant.packagingHierarchy
                ),
                quantity: 1,
                defaultSellingPrice: 15,
                appliedSellingPrice: 15,
                subtotal: 15,
                discountAmount: 0,
                finalAmount: 15,
                expiredBatch: false
            }],
            subtotal: 15,
            discountAmount: 0,
            finalAmount: 15,
            expiredBatchConfirmed: false
        };
        const receivedDelivery = makeDeliveryDraft(product.id, "received");
        const historyState = {
            ...state,
            sales: [sale],
            deliveryDrafts: [receivedDelivery]
        };
        const action = makeProductDeletionAction(historyState);

        const committed = applicationReducer(historyState, action);

        expect(committed.products).toEqual([]);
        expect(committed.sales).toBe(historyState.sales);
        expect(committed.sales[0]).toEqual(sale);
        expect(committed.deliveryDrafts).toBe(historyState.deliveryDrafts);
        expect(committed.deliveryDrafts[0]).toEqual(receivedDelivery);
        expect(committed.activityEvents).toHaveLength(1);
    });

    it("rejects mismatched deletion snapshots atomically without recording an event", () => {
        const state = makeProductDeletionState();
        const action = makeProductDeletionAction(state);
        const [event] = action.events;
        if (event.type !== "product.deleted") {
            throw new Error("Expected product deletion Activity.");
        }
        const invalidAction = {
            ...action,
            events: [{
                ...event,
                product: {
                    ...event.product,
                    productName: "Tampered historical snapshot"
                }
            }]
        };

        expect(() => applicationReducer(state, invalidAction)).toThrow(
            "Product deletion Activity does not match the current product and inventory."
        );
        expect(state.products).toHaveLength(1);
        expect(state.inventoryRecords).toHaveLength(1);
        expect(state.inventoryBatches).toHaveLength(1);
        expect(state.activityEvents).toEqual([]);
    });
});
