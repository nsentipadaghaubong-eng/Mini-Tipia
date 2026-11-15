import { describe, expect, it } from "vitest";
import {
    buildProductCreationActivityInputs,
    buildProductDeletionActivityInput,
    buildBatchCreatedActivityInput,
    buildBatchRemovalActivityInput,
    buildBatchUpdatedActivityInput,
    buildStockAdjustmentActivityInput,
    buildPackagingRemovalActivityInput,
    buildVariantRemovalActivityInput,
    buildProductUpdateActivityInputs,
    prepareActivityEvents,
    snapshotBatch,
    snapshotPackagingLevel,
    snapshotProduct,
    snapshotVariant,
} from "./activity/activity";
import {
    applicationReducer,
    createInitialApplicationState
} from "./applicationState";
import type { ApplicationState } from "./applicationState";
import {
    prepareProductRecordDeletionPlan,
    type ProductRecordDeletionRequest
} from "./products/productDeletion";
import type { SaleDraft } from "./sales/salesDraft";
import type { DeliveryDraft } from "./deliveries/deliveryDraft";
import { removePackagingLevelFromHierarchy } from "./packaging/packagingValidation";
import type { CompletedSale } from "./sales/salesEngine";
import { getProductRecordDeletionBlockMessages } from "./products/productDeletion";
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
    it("identifies active Sales and Delivery draft references by record", () => {
        const saleDraft = makeSalesDraft("product-1");
        const deliveryDraft = makeDeliveryDraft("product-1");
        const variantTarget = {
            kind: "variant" as const,
            productId: "product-1",
            variantId: "variant-draft"
        };
        const packagingTarget = {
            kind: "packaging" as const,
            productId: variantTarget.productId,
            variantId: variantTarget.variantId,
            packagingLevelId: "packaging-draft"
        };

        expect(getProductRecordDeletionBlockMessages(
            variantTarget,
            [saleDraft],
            [deliveryDraft]
        )).toHaveLength(2);
        expect(getProductRecordDeletionBlockMessages(
            packagingTarget,
            [saleDraft],
            [deliveryDraft]
        )).toHaveLength(2);
        expect(getProductRecordDeletionBlockMessages({
            kind: "batch",
            productId: "product-1",
            variantId: "variant-draft",
            batchId: "batch-1"
        }, [
            {
                ...saleDraft,
                items: saleDraft.items.map((item) => ({
                    ...item,
                    batchId: "batch-1"
                }))
            }
        ], [deliveryDraft])).toHaveLength(2);
        expect(getProductRecordDeletionBlockMessages(
            variantTarget,
            [{ ...saleDraft, status: "cancelled" }],
            [{ ...deliveryDraft, status: "cancelled" }]
        )).toEqual([]);
    });

    it("applies product-wide draft protection and exact messages to every record kind", () => {
        const saleDraft = makeSalesDraft("product-1");
        const deliveryDraft = makeDeliveryDraft("product-1");
        const differentVariant = {
            kind: "variant" as const,
            productId: "product-1",
            variantId: "variant-not-in-draft"
        };
        const packagingTarget = {
            kind: "packaging" as const,
            productId: "product-1",
            variantId: "variant-not-in-draft",
            packagingLevelId: "pack-not-in-draft"
        };
        const batchTarget = {
            kind: "batch" as const,
            productId: "product-1",
            variantId: "variant-not-in-draft",
            batchId: "batch-not-in-draft"
        };
        const expected = [
            "This product is currently in a Sales draft. Its inventory and product structure cannot be modified until the draft is completed or cancelled. You can still edit its name and description.",
            "This product is currently in a Receive Delivery draft. Its inventory and product structure cannot be modified until the draft is completed or cancelled. You can still edit its name and description."
        ];

        for (const target of [differentVariant, packagingTarget, batchTarget]) {
            expect(getProductRecordDeletionBlockMessages(
                target,
                [saleDraft],
                [deliveryDraft]
            )).toEqual(expected);
        }
        expect(getProductRecordDeletionBlockMessages(
            differentVariant,
            [makeSalesDraft("other-product")],
            [makeDeliveryDraft("other-product")]
        )).toEqual([]);
        expect(getProductRecordDeletionBlockMessages(
            differentVariant,
            [{ ...saleDraft, status: "approved" }],
            [{ ...deliveryDraft, status: "received" }]
        )).toEqual([]);
        expect(getProductRecordDeletionBlockMessages(
            differentVariant,
            [{ ...saleDraft, status: "cancelled" }],
            [{ ...deliveryDraft, status: "cancelled" }]
        )).toEqual([]);
    });

    it("matches active Receive Delivery drafts to numbered and unnumbered batches", () => {
        const product = makeProductDeletionState().products[0];
        const productVariant = product.variant[0];
        const numberedBatch = {
            batchId: "numbered-batch",
            productId: product.id,
            variantId: productVariant.id,
            batchNumber: "LOT-1",
            expiryDate: new Date("2027-01-31T00:00:00.000Z")
        };
        const numberedDraft = makeDeliveryDraft(product.id);
        numberedDraft.items[0].variantId = productVariant.id;
        numberedDraft.items[0].batchNumber = "LOT-1";
        numberedDraft.items[0].expiryDate = "2027-01-31";

        expect(getProductRecordDeletionBlockMessages({
            kind: "batch",
            productId: product.id,
            variantId: productVariant.id,
            batchId: numberedBatch.batchId
        }, [], [numberedDraft], [numberedBatch])).toEqual([
            "This product is currently in a Receive Delivery draft. Its inventory and product structure cannot be modified until the draft is completed or cancelled. You can still edit its name and description."
        ]);

        const unrelatedDraft = makeDeliveryDraft(product.id);
        unrelatedDraft.items[0].productId = "other-product";
        unrelatedDraft.items[0].variantId = productVariant.id;
        unrelatedDraft.items[0].batchNumber = "OTHER-LOT";
        unrelatedDraft.items[0].expiryDate = "2027-01-31";
        expect(getProductRecordDeletionBlockMessages({
            kind: "batch",
            productId: product.id,
            variantId: productVariant.id,
            batchId: numberedBatch.batchId
        }, [], [unrelatedDraft], [numberedBatch])).toEqual([]);

        const unnumberedBatch = {
            ...numberedBatch,
            batchId: "unnumbered-batch",
            batchNumber: null,
            receivedDate: "2026-01-01"
        };
        const unnumberedDraft = makeDeliveryDraft(product.id, "draft");
        unnumberedDraft.items[0].variantId = productVariant.id;
        unnumberedDraft.items[0].batchNumber = null;
        unnumberedDraft.items[0].expiryDate = "2027-01-31";
        expect(getProductRecordDeletionBlockMessages({
            kind: "batch",
            productId: product.id,
            variantId: productVariant.id,
            batchId: unnumberedBatch.batchId
        }, [], [unnumberedDraft], [unnumberedBatch])).toHaveLength(1);

        const otherDateDraft = {
            ...unnumberedDraft,
            deliveryDate: "2026-01-02"
        };
        expect(getProductRecordDeletionBlockMessages({
            kind: "batch",
            productId: product.id,
            variantId: productVariant.id,
            batchId: unnumberedBatch.batchId
        }, [], [otherDateDraft], [unnumberedBatch])).toHaveLength(1);
        expect(getProductRecordDeletionBlockMessages({
            kind: "batch",
            productId: product.id,
            variantId: productVariant.id,
            batchId: numberedBatch.batchId
        }, [], [{ ...numberedDraft, status: "received" }], [numberedBatch])).toEqual([]);
        expect(getProductRecordDeletionBlockMessages({
            kind: "batch",
            productId: product.id,
            variantId: productVariant.id,
            batchId: numberedBatch.batchId
        }, [], [{ ...numberedDraft, status: "cancelled" }], [numberedBatch])).toEqual([]);
    });

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

    it("rejects invalid product creation payloads and Activity without changing state", () => {
        const result = createProductResult();
        const state = {
            ...createInitialApplicationState(),
            products: [],
            inventoryRecords: [],
            inventoryBatches: [],
            activityEvents: []
        };
        const events = prepareActivityEvents(
            buildProductCreationActivityInputs(
                result.product,
                result.inventoryRecords,
                result.inventoryBatches
            )
        );
        const before = structuredClone(state);
        const duplicateVariantId = {
            ...result.product,
            variant: result.product.variant.map((productVariant) => ({
                ...productVariant,
                id: result.product.id
            }))
        };
        const malformedHierarchy = {
            ...result.product,
            variant: result.product.variant.map((productVariant) => ({
                ...productVariant,
                packagingHierarchy: productVariant.packagingHierarchy.map(
                    (level) => ({
                        ...level,
                        quantityofNextLevel: 1
                    })
                )
            }))
        };
        const badInventoryReference = {
            ...result,
            inventoryRecords: result.inventoryRecords.map((record) => ({
                ...record,
                variantId: "missing-variant"
            }))
        };
        const duplicateRecordId = {
            ...result,
            inventoryRecords: result.inventoryRecords.map((record) => ({
                ...record,
                id: result.product.id
            }))
        };
        const fabricatedActivity = events.map((event) =>
            event.type === "product.created"
                ? { ...event, initialInventory: [] }
                : event
        );
        const fabricatedBatchSnapshot = events.map((event) =>
            event.type === "inventory.batch_created"
                ? {
                    ...event,
                    batch: { ...event.batch, batchNumber: "FABRICATED" }
                }
                : event
        );
        const actions = [
            {
                type: "product.created" as const,
                result: { ...result, product: duplicateVariantId },
                events
            },
            {
                type: "product.created" as const,
                result: { ...result, product: malformedHierarchy },
                events
            },
            {
                type: "product.created" as const,
                result: badInventoryReference,
                events
            },
            {
                type: "product.created" as const,
                result: duplicateRecordId,
                events
            },
            {
                type: "product.created" as const,
                result,
                events: []
            },
            {
                type: "product.created" as const,
                result,
                events: fabricatedActivity
            },
            {
                type: "product.created" as const,
                result,
                events: fabricatedBatchSnapshot
            }
        ];

        for (const action of actions) {
            expect(() => applicationReducer(state, action)).toThrow();
            expect(state).toEqual(before);
        }
    });

    it("blocks product.created from reusing an ID referenced by an active draft", () => {
        const result = createProductResult();
        const state = {
            ...createInitialApplicationState(),
            products: [],
            inventoryRecords: [],
            inventoryBatches: [],
            activityEvents: [],
            saleDrafts: [makeSalesDraft(result.product.id)]
        };
        const before = structuredClone(state);
        const action = {
            type: "product.created" as const,
            result,
            events: prepareActivityEvents(buildProductCreationActivityInputs(
                result.product,
                result.inventoryRecords,
                result.inventoryBatches
            ))
        };

        expect(() => applicationReducer(state, action)).toThrow(
            /Sales draft/
        );
        expect(state.products).toEqual([]);
        expect(state.inventoryRecords).toEqual([]);
        expect(state.inventoryBatches).toEqual([]);
        expect(state.activityEvents).toEqual([]);
        expect(state).toEqual(before);
    });

    it("deletes a variant with its batches and stock while preserving other variants", () => {
        const baseState = makeProductDeletionState();
        const baseProduct = baseState.products[0];
        const removedVariant = baseProduct.variant[0];
        const retainedVariant = {
            id: "variant-retained",
            variantName: "Syrup",
            packagingHierarchy: [{
                id: "bottle",
                name: "Bottle",
                costPrice: null,
                sellingPrice: null,
                quantityofNextLevel: null,
                nextLevelId: null
            }]
        };
        const retainedProduct = {
            ...baseProduct,
            variant: [...baseProduct.variant, retainedVariant]
        };
        const retainedBatch = {
            batchId: "batch-retained",
            productId: baseProduct.id,
            variantId: retainedVariant.id,
            batchNumber: "SYRUP-LOT",
            expiryDate: new Date("2028-01-01T00:00:00.000Z")
        };
        const retainedRecord = {
            id: "inventory-retained",
            productId: baseProduct.id,
            variantId: retainedVariant.id,
            batchId: retainedBatch.batchId,
            stockQuantities: [{ packagingLevelId: "bottle", quantity: 6 }]
        };
        const state = {
            ...baseState,
            products: [retainedProduct],
            inventoryRecords: [...baseState.inventoryRecords, retainedRecord],
            inventoryBatches: [...baseState.inventoryBatches, retainedBatch]
        };
        const action = {
            type: "product.variant_removed" as const,
            product: retainedProduct,
            variantId: removedVariant.id,
            inventoryRecords: state.inventoryRecords.filter(
                (record) => record.variantId !== removedVariant.id
            ),
            inventoryBatches: state.inventoryBatches.filter(
                (batch) => batch.variantId !== removedVariant.id
            ),
            events: prepareActivityEvents([buildVariantRemovalActivityInput(
                "variant-delete-test",
                retainedProduct,
                removedVariant,
                state.inventoryRecords,
                state.inventoryBatches,
                "Remove incorrect variant"
            )])
        };
        const invalidReasonAction = {
            ...action,
            events: action.events.map((event) => ({ ...event, reason: "   " }))
        };

        expect(() => applicationReducer(state, invalidReasonAction)).toThrow(
            "A reason is required for every deletion."
        );
        expect(state.products[0].variant).toHaveLength(2);
        expect(state.inventoryRecords).toHaveLength(2);
        expect(state.inventoryBatches).toHaveLength(2);
        expect(state.activityEvents).toEqual([]);

        const committed = applicationReducer(state, action);

        expect(committed.products[0].variant.map((item) => item.id)).toEqual([
            retainedVariant.id
        ]);
        expect(committed.inventoryRecords).toEqual([retainedRecord]);
        expect(committed.inventoryBatches).toEqual([retainedBatch]);
        expect(committed.activityEvents[0]).toMatchObject({
            type: "product.variant_removed",
            removedVariant: { variantId: removedVariant.id },
            removedBatches: [{ batchId: baseState.inventoryBatches[0].batchId }],
            affectedInventory: [{ inventoryId: baseState.inventoryRecords[0].id }]
        });
    });

    it("deletes packaging stock while preserving other packaging quantities and batches", () => {
        const baseState = makeProductDeletionState();
        const baseProduct = baseState.products[0];
        const productVariant = baseProduct.variant[0];
        const packagingLevel = {
            id: "pack-level",
            name: "Pack",
            costPrice: 3,
            sellingPrice: 5,
            quantityofNextLevel: null,
            nextLevelId: null
        };
        const updatedProduct = {
            ...baseProduct,
            variant: [{
                ...productVariant,
                packagingHierarchy: [
                    {
                        ...productVariant.packagingHierarchy[0],
                        quantityofNextLevel: 10,
                        nextLevelId: packagingLevel.id
                    },
                    packagingLevel
                ]
            }]
        };
        const retainedStockRecord = {
            ...baseState.inventoryRecords[0],
            stockQuantities: [
                ...baseState.inventoryRecords[0].stockQuantities,
                { packagingLevelId: packagingLevel.id, quantity: 7 }
            ]
        };
        const removedOnlyStockRecord = {
            id: "inventory-pack-only",
            productId: baseProduct.id,
            variantId: productVariant.id,
            batchId: null,
            stockQuantities: [{ packagingLevelId: packagingLevel.id, quantity: 2 }]
        };
        const state = {
            ...baseState,
            products: [updatedProduct],
            inventoryRecords: [retainedStockRecord, removedOnlyStockRecord]
        };
        const action = {
            type: "product.packaging_removed" as const,
            product: updatedProduct,
            variantId: productVariant.id,
            packagingLevelId: packagingLevel.id,
            inventoryRecords: [{
                ...retainedStockRecord,
                stockQuantities: retainedStockRecord.stockQuantities.filter(
                    (stock) => stock.packagingLevelId !== packagingLevel.id
                )
            }],
            inventoryBatches: state.inventoryBatches,
            events: prepareActivityEvents([buildPackagingRemovalActivityInput(
                "packaging-delete-test",
                updatedProduct,
                updatedProduct.variant[0],
                packagingLevel,
                removePackagingLevelFromHierarchy(
                    updatedProduct.variant[0].packagingHierarchy,
                    packagingLevel.id
                ),
                state.inventoryRecords,
                state.inventoryBatches,
                "Remove discontinued packaging"
            )])
        };

        const invalidAction = {
            ...action,
            inventoryRecords: []
        };
        expect(() => applicationReducer(state, invalidAction)).toThrow(
            "Packaging removal does not match its inventory records."
        );
        const invalidReasonAction = {
            ...action,
            events: action.events.map((event) => ({ ...event, reason: " \t " }))
        };
        expect(() => applicationReducer(state, invalidReasonAction)).toThrow(
            "A reason is required for every deletion."
        );
        expect(state.products[0].variant[0].packagingHierarchy).toHaveLength(2);
        expect(state.inventoryRecords).toHaveLength(2);
        expect(state.activityEvents).toEqual([]);

        const committed = applicationReducer(state, action);

        expect(committed.products[0].variant[0].packagingHierarchy).toEqual(
            productVariant.packagingHierarchy
        );
        expect(committed.inventoryRecords).toEqual([{
            ...retainedStockRecord,
            stockQuantities: retainedStockRecord.stockQuantities.filter(
                (stock) => stock.packagingLevelId !== packagingLevel.id
            )
        }]);
        expect(committed.inventoryBatches).toBe(state.inventoryBatches);
        expect(committed.activityEvents[0]).toMatchObject({
            type: "product.packaging_removed",
            removedPackaging: { packagingLevelId: packagingLevel.id },
            beforeHierarchy: [
                { packagingLevelId: productVariant.packagingHierarchy[0].id },
                { packagingLevelId: packagingLevel.id }
            ],
            afterHierarchy: [
                {
                    packagingLevelId: productVariant.packagingHierarchy[0].id,
                    nextLevelId: null,
                    quantityOfNextLevel: null
                }
            ],
            removedStock: [
                { quantity: 7, batch: { batchId: baseState.inventoryBatches[0].batchId } },
                { quantity: 2, batch: null }
            ]
        });
    });

    it("blocks variant and packaging removal when an active workflow references them", () => {
        const state = makeProductDeletionState();
        const product = state.products[0];
        const productVariant = product.variant[0];
        const level = productVariant.packagingHierarchy[0];
        const variantAction = {
            type: "product.variant_removed" as const,
            product,
            variantId: productVariant.id,
            inventoryRecords: [],
            inventoryBatches: [],
            events: prepareActivityEvents([buildVariantRemovalActivityInput(
                "blocked-variant-delete",
                product,
                productVariant,
                state.inventoryRecords,
                state.inventoryBatches,
                "Delete variant"
            )])
        };
        const packagingAction = {
            type: "product.packaging_removed" as const,
            product,
            variantId: productVariant.id,
            packagingLevelId: level.id,
            inventoryRecords: [],
            inventoryBatches: state.inventoryBatches,
            events: prepareActivityEvents([buildPackagingRemovalActivityInput(
                "blocked-packaging-delete",
                product,
                productVariant,
                level,
                [],
                state.inventoryRecords,
                state.inventoryBatches,
                "Delete packaging"
            )])
        };
        const saleDraft = makeSalesDraft(product.id);
        saleDraft.items[0].variantId = productVariant.id;
        saleDraft.items[0].packagingLevelId = level.id;
        const deliveryDraft = makeDeliveryDraft(product.id);
        deliveryDraft.items[0].variantId = productVariant.id;
        deliveryDraft.items[0].packagingLevelId = level.id;
        const blockedBySale = {
            ...state,
            saleDrafts: [saleDraft]
        };
        const blockedByDelivery = {
            ...state,
            deliveryDrafts: [deliveryDraft]
        };

        expect(() => applicationReducer(blockedBySale, variantAction)).toThrow(
            /This product is currently in a Sales draft/
        );
        expect(() => applicationReducer(blockedByDelivery, packagingAction)).toThrow(
            /This product is currently in a Receive Delivery draft/
        );
        expect(blockedBySale.products).toHaveLength(1);
        expect(blockedBySale.inventoryRecords).toHaveLength(1);
        expect(blockedBySale.activityEvents).toEqual([]);
        expect(blockedByDelivery.products).toHaveLength(1);
        expect(blockedByDelivery.inventoryRecords).toHaveLength(1);
        expect(blockedByDelivery.activityEvents).toEqual([]);
    });

    it("blocks cross-variant record deletion when an active draft contains the product", () => {
        const baseState = makeProductDeletionState();
        const product = baseState.products[0];
        const secondVariant = {
            id: "variant-second",
            variantName: "Syrup",
            packagingHierarchy: [{
                id: "bottle-second",
                name: "Bottle",
                costPrice: null,
                sellingPrice: null,
                quantityofNextLevel: null,
                nextLevelId: null
            }]
        };
        const updatedProduct = {
            ...product,
            variant: [...product.variant, secondVariant]
        };
        const state = { ...baseState, products: [updatedProduct] };
        const requests: ProductRecordDeletionRequest[] = [{
            type: "variant",
            variantId: secondVariant.id,
            operationId: "cross-variant-delete",
            reason: "Remove duplicate variant"
        }];
        const plan = prepareProductRecordDeletionPlan(
            updatedProduct,
            state.inventoryRecords,
            state.inventoryBatches,
            requests
        );
        const action = {
            type: "product.records_deleted" as const,
            productId: product.id,
            deletions: requests,
            product: plan.product,
            inventoryRecords: plan.inventoryRecords,
            inventoryBatches: plan.inventoryBatches,
            events: prepareActivityEvents(plan.events)
        };
        const saleDraft = makeSalesDraft(product.id);
        saleDraft.items[0].variantId = product.variant[0].id;
        const deliveryDraft = makeDeliveryDraft(product.id);
        deliveryDraft.items[0].variantId = product.variant[0].id;
        const salesBlockedState = { ...state, saleDrafts: [saleDraft] };
        const deliveryBlockedState = { ...state, deliveryDrafts: [deliveryDraft] };
        const originalSalesState = structuredClone(salesBlockedState);
        const originalDeliveryState = structuredClone(deliveryBlockedState);

        expect(() => applicationReducer(salesBlockedState, action)).toThrow(
            "This product is currently in a Sales draft. Its inventory and product structure cannot be modified until the draft is completed or cancelled. You can still edit its name and description."
        );
        expect(() => applicationReducer(deliveryBlockedState, action)).toThrow(
            "This product is currently in a Receive Delivery draft. Its inventory and product structure cannot be modified until the draft is completed or cancelled. You can still edit its name and description."
        );
        expect(salesBlockedState).toEqual(originalSalesState);
        expect(deliveryBlockedState).toEqual(originalDeliveryState);

        const committed = applicationReducer(state, action);
        expect(committed.products[0].variant).toEqual([product.variant[0]]);
        expect(committed.activityEvents[0]).toMatchObject({
            type: "product.variant_removed",
            reason: "Remove duplicate variant",
            removedVariant: { variantId: secondVariant.id }
        });
    });

    it.each(["sales", "delivery"] as const)(
        "rejects stock, batch, and product-structure mutations for an active %s draft",
        (draftType) => {
            const baseState = makeProductDeletionState();
            const product = baseState.products[0];
            const productVariant = product.variant[0];
            const activeSale = makeSalesDraft(product.id);
            activeSale.items[0].variantId = productVariant.id;
            const activeDelivery = makeDeliveryDraft(product.id);
            activeDelivery.items[0].variantId = productVariant.id;
            const state = {
                ...baseState,
                saleDrafts: draftType === "sales" ? [activeSale] : [],
                deliveryDrafts: draftType === "delivery" ? [activeDelivery] : []
            };
            const existingRecord = state.inventoryRecords[0];
            const existingBatch = state.inventoryBatches[0];
            const updatedInventoryAction = {
                type: "inventory.saved" as const,
                inventoryRecords: state.inventoryRecords.map((record) => ({
                    ...record,
                    stockQuantities: record.stockQuantities.map((stock) => ({
                        ...stock,
                        quantity: stock.quantity + 1
                    }))
                })),
                inventoryBatches: state.inventoryBatches,
                events: []
            };
            const updatedBatchAction = {
                type: "inventory.saved" as const,
                inventoryRecords: state.inventoryRecords,
                inventoryBatches: state.inventoryBatches.map((batch) => ({
                    ...batch,
                    batchNumber: `${batch.batchNumber ?? "LOT"}-EDITED`
                })),
                events: []
            };
            const addedBatch = {
                ...existingBatch,
                batchId: "batch-added-while-locked"
            };
            const addedRecord = {
                ...existingRecord,
                id: "inventory-added-while-locked",
                batchId: addedBatch.batchId
            };
            const addedBatchAction = {
                type: "inventory.saved" as const,
                inventoryRecords: [...state.inventoryRecords, addedRecord],
                inventoryBatches: [...state.inventoryBatches, addedBatch],
                events: []
            };
            const changedProduct = {
                ...product,
                variant: product.variant.map((candidate) =>
                    candidate.id === productVariant.id
                        ? {
                            ...candidate,
                            packagingHierarchy: candidate.packagingHierarchy.map(
                                (level) => ({ ...level, name: `${level.name} Updated` })
                            )
                        }
                        : candidate
                )
            };
            const updatedProductAction = {
                type: "product.updated" as const,
                product: changedProduct,
                inventoryRecords: state.inventoryRecords,
                inventoryBatches: state.inventoryBatches,
                events: prepareActivityEvents(buildProductUpdateActivityInputs(
                    product,
                    changedProduct,
                    state.inventoryRecords,
                    state.inventoryRecords,
                    state.inventoryBatches,
                    `product.updated:locked-${draftType}`,
                    "Update description only"
                ))
            };
            const addedVariant = {
                id: "variant-added-while-locked",
                variantName: "New variant",
                packagingHierarchy: []
            };
            const addedVariantAction = {
                type: "product.variant_added" as const,
                productId: product.id,
                variant: addedVariant,
                events: prepareActivityEvents([{
                    type: "product.variant_added" as const,
                    operationKey: `product.variant_added:${product.id}:${addedVariant.id}`,
                    productId: product.id,
                    productName: product.name,
                    variant: snapshotVariant(addedVariant),
                    reason: "Add variant"
                }])
            };
            const actions = [
                updatedInventoryAction,
                updatedBatchAction,
                addedBatchAction,
                updatedProductAction,
                addedVariantAction
            ];
            const expectedMessage = draftType === "sales"
                ? "This product is currently in a Sales draft. Its inventory and product structure cannot be modified until the draft is completed or cancelled. You can still edit its name and description."
                : "This product is currently in a Receive Delivery draft. Its inventory and product structure cannot be modified until the draft is completed or cancelled. You can still edit its name and description.";

            for (const action of actions) {
                const before = structuredClone(state);
                expect(
                    () => applicationReducer(state, action),
                    action.type
                ).toThrow(expectedMessage);
                expect(state).toEqual(before);
            }
        }
    );

    it("allows descriptive product edits while a draft is active", () => {
        const state = makeProductDeletionState();
        const product = state.products[0];
        const lockedState = {
            ...state,
            saleDrafts: [makeSalesDraft(product.id)]
        };
        const updatedProduct = {
            ...product,
            name: "Updated Medicine",
            description: "Updated descriptive information"
        };
        const action = {
            type: "product.updated" as const,
            product: updatedProduct,
            inventoryRecords: state.inventoryRecords,
            inventoryBatches: state.inventoryBatches,
            events: prepareActivityEvents(buildProductUpdateActivityInputs(
                product,
                updatedProduct,
                state.inventoryRecords,
                state.inventoryRecords,
                state.inventoryBatches,
                "product.updated:descriptive-while-locked",
                "Update product description"
            ))
        };

        const committed = applicationReducer(lockedState, action);

        expect(committed.products[0]).toMatchObject({
            name: "Updated Medicine",
            description: "Updated descriptive information",
            variant: product.variant
        });
        expect(committed.activityEvents[0]).toMatchObject({
            type: "product.updated",
            after: {
                productName: "Updated Medicine",
                description: "Updated descriptive information"
            }
        });
    });

    it.each(
        (["variant", "packaging", "batch"] as const).flatMap((deletionType) =>
            (["sales", "delivery"] as const).map((draftType) => [
                deletionType,
                draftType
            ] as const)
        )
    )("blocks cross-variant %s deletion for an active %s draft atomically", (
        deletionType,
        draftType
    ) => {
        const baseState = makeProductDeletionState();
        const product = baseState.products[0];
        const firstVariant = product.variant[0];
        const secondVariant = {
            id: "variant-record-deletion-target",
            variantName: "Syrup",
            packagingHierarchy: [{
                id: "packaging-record-deletion-target",
                name: "Bottle",
                costPrice: null,
                sellingPrice: null,
                quantityofNextLevel: null,
                nextLevelId: null
            }]
        };
        const secondBatch = {
            batchId: "batch-record-deletion-target",
            productId: product.id,
            variantId: secondVariant.id,
            batchNumber: "SYRUP-LOT",
            expiryDate: new Date("2028-01-31T00:00:00.000Z")
        };
        const secondRecord = {
            id: "inventory-record-deletion-target",
            productId: product.id,
            variantId: secondVariant.id,
            batchId: secondBatch.batchId,
            stockQuantities: [{
                packagingLevelId: secondVariant.packagingHierarchy[0].id,
                quantity: 6
            }]
        };
        const updatedProduct = {
            ...product,
            variant: [...product.variant, secondVariant]
        };
        const state = {
            ...baseState,
            products: [updatedProduct],
            inventoryRecords: [...baseState.inventoryRecords, secondRecord],
            inventoryBatches: [...baseState.inventoryBatches, secondBatch]
        };
        const saleDraft = makeSalesDraft(product.id);
        saleDraft.items[0].variantId = firstVariant.id;
        const deliveryDraft = makeDeliveryDraft(product.id);
        deliveryDraft.items[0].variantId = firstVariant.id;
        const blockedState = {
            ...state,
            saleDrafts: draftType === "sales" ? [saleDraft] : [],
            deliveryDrafts: draftType === "delivery" ? [deliveryDraft] : []
        };
        const action = deletionType === "batch"
            ? {
                type: "inventory.saved" as const,
                inventoryRecords: state.inventoryRecords.filter(
                    (record) => record.id !== secondRecord.id
                ),
                inventoryBatches: state.inventoryBatches.filter(
                    (batch) => batch.batchId !== secondBatch.batchId
                ),
                events: prepareActivityEvents([buildBatchRemovalActivityInput(
                    "cross-variant-batch-delete",
                    updatedProduct,
                    secondBatch,
                    state.inventoryRecords,
                    state.inventoryBatches,
                    "Remove recalled syrup"
                )])
            }
            : (() => {
                const deletions: ProductRecordDeletionRequest[] =
                    deletionType === "variant"
                        ? [{
                            type: "variant",
                            variantId: secondVariant.id,
                            operationId: "cross-variant-record-delete",
                            reason: "Remove duplicate syrup"
                        }]
                        : [{
                            type: "packaging",
                            variantId: secondVariant.id,
                            packagingLevelId: secondVariant.packagingHierarchy[0].id,
                            operationId: "cross-variant-record-delete",
                            reason: "Remove obsolete bottle"
                        }];
                const plan = prepareProductRecordDeletionPlan(
                    updatedProduct,
                    state.inventoryRecords,
                    state.inventoryBatches,
                    deletions
                );
                return {
                    type: "product.records_deleted" as const,
                    productId: product.id,
                    deletions,
                    product: plan.product,
                    inventoryRecords: plan.inventoryRecords,
                    inventoryBatches: plan.inventoryBatches,
                    events: prepareActivityEvents(plan.events)
                };
            })();
        const before = structuredClone(blockedState);
        const expectedMessage = draftType === "sales"
            ? "This product is currently in a Sales draft. Its inventory and product structure cannot be modified until the draft is completed or cancelled. You can still edit its name and description."
            : "This product is currently in a Receive Delivery draft. Its inventory and product structure cannot be modified until the draft is completed or cancelled. You can still edit its name and description.";

        expect(() => applicationReducer(blockedState, action)).toThrow(expectedMessage);
        expect(blockedState).toEqual(before);
    });

    it("commits staged variant and packaging deletions with distinct reasons atomically", () => {
        const baseState = makeProductDeletionState();
        const baseProduct = baseState.products[0];
        const existingVariant = baseProduct.variant[0];
        const nextVariant = {
            id: "variant-next",
            variantName: "Syrup",
            packagingHierarchy: [{
                id: "case-next",
                name: "Case",
                costPrice: null,
                sellingPrice: null,
                quantityofNextLevel: 8,
                nextLevelId: "bottle-next"
            }, {
                id: "bottle-next",
                name: "Bottle",
                costPrice: null,
                sellingPrice: null,
                quantityofNextLevel: null,
                nextLevelId: null
            }]
        };
        const product = {
            ...baseProduct,
            variant: [...baseProduct.variant, nextVariant]
        };
        const nextRecord = {
            id: "inventory-next",
            productId: product.id,
            variantId: nextVariant.id,
            batchId: null,
            stockQuantities: [
                { packagingLevelId: "case-next", quantity: 2 },
                { packagingLevelId: "bottle-next", quantity: 5 }
            ]
        };
        const state = {
            ...baseState,
            products: [{
                id: "unrelated-product",
                name: "Unrelated medicine",
                variant: []
            }, product],
            inventoryRecords: [...baseState.inventoryRecords, nextRecord]
        };
        const deletions: ProductRecordDeletionRequest[] = [{
            type: "variant",
            variantId: existingVariant.id,
            operationId: "remove-tablets",
            reason: "  Discontinue tablets  "
        }, {
            type: "packaging",
            variantId: nextVariant.id,
            packagingLevelId: "bottle-next",
            operationId: "remove-bottle-level",
            reason: "Remove obsolete bottle unit"
        }];
        const beforeState = structuredClone(state);
        const plan = prepareProductRecordDeletionPlan(
            product,
            state.inventoryRecords,
            state.inventoryBatches,
            deletions
        );
        expect(state).toEqual(beforeState);
        const action = {
            type: "product.records_deleted" as const,
            productId: product.id,
            deletions: deletions.map((deletion) => ({
                ...deletion,
                reason: deletion.reason.trim()
            })),
            product: plan.product,
            inventoryRecords: plan.inventoryRecords,
            inventoryBatches: plan.inventoryBatches,
            events: prepareActivityEvents(plan.events)
        };
        const committed = applicationReducer(state, action);

        expect(committed.products[0]).toEqual(state.products[0]);
        expect(committed.products[1].variant.map((item) => item.id)).toEqual([
            nextVariant.id
        ]);
        expect(committed.products[1].variant[0].packagingHierarchy).toEqual([{
            ...nextVariant.packagingHierarchy[0],
            nextLevelId: null,
            quantityofNextLevel: null
        }]);
        expect(committed.inventoryRecords).toEqual([{
            ...nextRecord,
            stockQuantities: [{ packagingLevelId: "case-next", quantity: 2 }]
        }]);
        expect(committed.inventoryBatches).toEqual([]);
        expect(committed.activityEvents).toHaveLength(2);
        expect(committed.activityEvents[0]).toMatchObject({
            type: "product.variant_removed",
            reason: "Discontinue tablets",
            removedVariant: { variantId: existingVariant.id }
        });
        const packagingEvent = committed.activityEvents[1];
        expect(packagingEvent.type).toBe("product.packaging_removed");
        if (packagingEvent.type !== "product.packaging_removed") {
            throw new Error("Expected packaging deletion Activity.");
        }
        expect(packagingEvent.reason).toBe("Remove obsolete bottle unit");
        expect(packagingEvent.removedPackaging.packagingLevelId).toBe("bottle-next");
        expect(packagingEvent.beforeHierarchy.map((level) => level.packagingLevelId)).toEqual([
            "case-next",
            "bottle-next"
        ]);
        expect(packagingEvent.afterHierarchy).toMatchObject([{
            packagingLevelId: "case-next",
            nextLevelId: null,
            quantityOfNextLevel: null
        }]);
        expect(packagingEvent.removedStock).toMatchObject([{ quantity: 5 }]);
    });

    it("commits staged deletion and descriptive edits in one reducer action", () => {
        const state = makeProductDeletionState();
        const product = state.products[0];
        const productVariant = product.variant[0];
        const level = productVariant.packagingHierarchy[0];
        if (!level) {
            throw new Error("Fixture requires a packaging level.");
        }
        const deletions: ProductRecordDeletionRequest[] = [{
            type: "packaging",
            variantId: productVariant.id,
            packagingLevelId: level.id,
            reason: "Remove obsolete pack",
            operationId: "remove-obsolete-pack"
        }];
        const plan = prepareProductRecordDeletionPlan(
            product,
            state.inventoryRecords,
            state.inventoryBatches,
            deletions
        );
        const updatedProduct = {
            ...plan.product,
            name: "Updated medicine",
            description: "Updated product description"
        };
        const events = prepareActivityEvents([
            ...plan.events,
            ...buildProductUpdateActivityInputs(
                plan.product,
                updatedProduct,
                plan.inventoryRecords,
                plan.inventoryRecords,
                plan.inventoryBatches,
                "product.updated:product-and-deletion",
                "Update product details"
            )
        ]);
        const action = {
            type: "product.records_deleted" as const,
            productId: product.id,
            deletions,
            product: plan.product,
            updatedProduct,
            inventoryRecords: plan.inventoryRecords,
            inventoryBatches: plan.inventoryBatches,
            events
        };

        const committed = applicationReducer(state, action);

        expect(committed.products[0]).toEqual(updatedProduct);
        expect(committed.inventoryRecords).toEqual(plan.inventoryRecords);
        expect(committed.activityEvents.map((event) => event.type)).toEqual([
            "product.packaging_removed",
            "product.updated"
        ]);
    });

    it("commits batch creation with stock and blocks batch deletion atomically", () => {
        const state = makeProductDeletionState();
        const product = state.products[0];
        const productVariant = product.variant[0];
        const newBatch = {
            batchId: "batch-added",
            productId: product.id,
            variantId: productVariant.id,
            batchNumber: "LOT-2",
            expiryDate: new Date("2028-01-31T00:00:00.000Z")
        };
        const newRecord = {
            id: "inventory-added",
            productId: product.id,
            variantId: productVariant.id,
            batchId: newBatch.batchId,
            stockQuantities: [{
                packagingLevelId: productVariant.packagingHierarchy[0].id,
                quantity: 9
            }]
        };
        const creationAction = {
            type: "inventory.saved" as const,
            inventoryRecords: [...state.inventoryRecords, newRecord],
            inventoryBatches: [...state.inventoryBatches, newBatch],
            events: prepareActivityEvents([buildBatchCreatedActivityInput(
                "batch-create-test",
                product,
                newBatch,
                newRecord
            )])
        };
        const committed = applicationReducer(state, creationAction);

        expect(committed.inventoryBatches).toContainEqual(newBatch);
        expect(committed.inventoryRecords).toContainEqual(newRecord);
        expect(committed.activityEvents[0]).toMatchObject({
            type: "inventory.batch_created",
            source: "inventory_edit",
            inventory: { stock: [{ quantity: 9 }] }
        });

        const removedBatch = state.inventoryBatches[0];
        const activeSale = makeSalesDraft(product.id);
        activeSale.items[0].variantId = productVariant.id;
        activeSale.items[0].batchId = removedBatch.batchId;
        activeSale.items[0].packagingLevelId = productVariant.packagingHierarchy[0].id;
        const blockedState = { ...state, saleDrafts: [activeSale] };
        const removalEvent = prepareActivityEvents([buildBatchRemovalActivityInput(
            "batch-delete-test",
            product,
            removedBatch,
            state.inventoryRecords,
            state.inventoryBatches,
            "Remove recalled stock"
        )]);
        const removalAction = {
            type: "inventory.saved" as const,
            inventoryRecords: [],
            inventoryBatches: [],
            events: removalEvent
        };
        const invalidReasonAction = {
            ...removalAction,
            events: removalAction.events.map((event) => ({
                ...event,
                reason: " \t "
            }))
        };
        const beforeInvalidReason = structuredClone(state);

        expect(() => applicationReducer(state, invalidReasonAction)).toThrow(
            "A reason is required for every deletion."
        );
        expect(state).toEqual(beforeInvalidReason);

        const removed = applicationReducer(state, removalAction);
        expect(removed.inventoryRecords).toEqual([]);
        expect(removed.inventoryBatches).toEqual([]);
        expect(removed.activityEvents[0]).toMatchObject({
            type: "inventory.batch_removed",
            reason: "Remove recalled stock",
            removedBatch: { batchId: removedBatch.batchId },
            affectedInventory: [{ inventoryId: state.inventoryRecords[0].id }]
        });

        expect(() => applicationReducer(blockedState, removalAction)).toThrow(
            /This product is currently in a Sales draft/
        );
        expect(blockedState.inventoryRecords).toEqual(state.inventoryRecords);
        expect(blockedState.inventoryBatches).toEqual(state.inventoryBatches);
        expect(blockedState.activityEvents).toEqual([]);
    });

    it("rejects duplicate or invalid identifiers during batch creation atomically", () => {
        const state = makeProductDeletionState();
        const product = state.products[0];
        const productVariant = product.variant[0];
        const existingRecord = state.inventoryRecords[0]!;
        const existingBatch = state.inventoryBatches[0]!;

        function makeCreationAction(batchId: string, inventoryId: string) {
            const batch = {
                batchId,
                productId: product.id,
                variantId: productVariant.id,
                batchNumber: "LOT-NEW",
                expiryDate: new Date("2028-01-31T00:00:00.000Z")
            };
            const record = {
                id: inventoryId,
                productId: product.id,
                variantId: productVariant.id,
                batchId,
                stockQuantities: [{
                    packagingLevelId: productVariant.packagingHierarchy[0].id,
                    quantity: 9
                }]
            };
            return {
                type: "inventory.saved" as const,
                inventoryRecords: [...state.inventoryRecords, record],
                inventoryBatches: [...state.inventoryBatches, batch],
                events: prepareActivityEvents([buildBatchCreatedActivityInput(
                    "batch-creation-invalid-id",
                    product,
                    batch,
                    record
                )])
            };
        }

        const rejectedActions = [
            makeCreationAction(existingBatch.batchId, "inventory-new"),
            makeCreationAction("batch-new", existingRecord.id),
            makeCreationAction(" ", "inventory-new"),
            makeCreationAction("batch-new", " ")
        ];
        const before = structuredClone(state);

        for (const action of rejectedActions) {
            expect(() => applicationReducer(state, action)).toThrow();
            expect(state).toEqual(before);
        }
    });

    it("rejects a forged batch creation Activity snapshot atomically", () => {
        const state = makeProductDeletionState();
        const product = state.products[0];
        const productVariant = product.variant[0];
        const batch = {
            batchId: "batch-forged-snapshot",
            productId: product.id,
            variantId: productVariant.id,
            batchNumber: "LOT-NEW",
            expiryDate: new Date("2028-01-31T00:00:00.000Z")
        };
        const record = {
            id: "inventory-forged-snapshot",
            productId: product.id,
            variantId: productVariant.id,
            batchId: batch.batchId,
            stockQuantities: [{
                packagingLevelId: productVariant.packagingHierarchy[0].id,
                quantity: 9
            }]
        };
        const [createdEvent] = prepareActivityEvents([buildBatchCreatedActivityInput(
            "batch-creation-forged-snapshot",
            product,
            batch,
            record
        )]);
        if (createdEvent.type !== "inventory.batch_created" || !createdEvent.inventory) {
            throw new Error("Batch creation Activity was not created.");
        }
        const action = {
            type: "inventory.saved" as const,
            inventoryRecords: [...state.inventoryRecords, record],
            inventoryBatches: [...state.inventoryBatches, batch],
            events: [{
                ...createdEvent,
                inventory: {
                    ...createdEvent.inventory,
                    stock: createdEvent.inventory.stock.map((stock) => ({
                        ...stock,
                        quantity: stock.quantity + 1
                    }))
                }
            }]
        };
        const before = structuredClone(state);

        expect(() => applicationReducer(state, action)).toThrow();
        expect(state).toEqual(before);
    });

    it("rejects mismatched batch update snapshots atomically", () => {
        const state = makeProductDeletionState();
        const product = state.products[0];
        const batch = state.inventoryBatches[0]!;
        const updatedBatch = { ...batch, batchNumber: "LOT-UPDATED" };
        const updateInput = buildBatchUpdatedActivityInput(
            "batch-update-snapshot",
            batch,
            updatedBatch,
            product,
            "Correct batch details"
        );
        if (!updateInput || updateInput.type !== "inventory.batch_updated") {
            throw new Error("Batch update Activity was not created.");
        }
        const [updateEvent] = prepareActivityEvents([updateInput]);
        if (updateEvent.type !== "inventory.batch_updated") {
            throw new Error("Batch update Activity was not prepared.");
        }
        const action = {
            type: "inventory.saved" as const,
            inventoryRecords: state.inventoryRecords,
            inventoryBatches: state.inventoryBatches.map((candidate) =>
                candidate.batchId === batch.batchId ? updatedBatch : candidate
            ),
            events: [updateEvent]
        };
        const before = structuredClone(state);
        const forgedEvents = [
            {
                ...updateEvent,
                before: { ...updateEvent.before, batchNumber: "FORGED-BEFORE" }
            },
            {
                ...updateEvent,
                after: { ...updateEvent.after, batchNumber: "FORGED-AFTER" }
            }
        ];

        for (const event of forgedEvents) {
            expect(() => applicationReducer(state, {
                ...action,
                events: [event]
            })).toThrow();
            expect(state).toEqual(before);
        }
    });

    it("rejects a forged batch deletion affected-inventory snapshot atomically", () => {
        const state = makeProductDeletionState();
        const product = state.products[0];
        const batch = state.inventoryBatches[0]!;
        const [removalEvent] = prepareActivityEvents([buildBatchRemovalActivityInput(
            "batch-deletion-forged-snapshot",
            product,
            batch,
            state.inventoryRecords,
            state.inventoryBatches,
            "Remove recalled stock"
        )]);
        if (
            removalEvent.type !== "inventory.batch_removed" ||
            removalEvent.affectedInventory.length === 0
        ) {
            throw new Error("Batch removal Activity was not created.");
        }
        const action = {
            type: "inventory.saved" as const,
            inventoryRecords: state.inventoryRecords.filter(
                (record) => record.batchId !== batch.batchId
            ),
            inventoryBatches: state.inventoryBatches.filter(
                (candidate) => candidate.batchId !== batch.batchId
            ),
            events: [{
                ...removalEvent,
                affectedInventory: removalEvent.affectedInventory.map(
                    (inventorySnapshot) => ({
                        ...inventorySnapshot,
                        stock: inventorySnapshot.stock.map((stock) => ({
                            ...stock,
                            quantity: stock.quantity + 1
                        }))
                    })
                )
            }]
        };
        const before = structuredClone(state);

        expect(() => applicationReducer(state, action)).toThrow(
            "Batch removal Activity does not match current stock."
        );
        expect(state).toEqual(before);
    });

    it("blocks batch deletion for active deliveries matching numbered or unnumbered lots", () => {
        const baseState = makeProductDeletionState();
        const product = baseState.products[0];
        const productVariant = product.variant[0];
        const originalBatch = baseState.inventoryBatches[0];

        function deletionAction(
            state: ApplicationState,
            batch: typeof originalBatch,
            operationId: string
        ) {
            return {
                type: "inventory.saved" as const,
                inventoryRecords: state.inventoryRecords.filter(
                    (record) => record.batchId !== batch.batchId
                ),
                inventoryBatches: state.inventoryBatches.filter(
                    (candidate) => candidate.batchId !== batch.batchId
                ),
                events: prepareActivityEvents([buildBatchRemovalActivityInput(
                    operationId,
                    product,
                    batch,
                    state.inventoryRecords,
                    state.inventoryBatches,
                    "Remove lot"
                )])
            };
        }

        const numberedDraft = makeDeliveryDraft(product.id);
        numberedDraft.items[0].variantId = productVariant.id;
        numberedDraft.items[0].batchNumber = originalBatch.batchNumber;
        numberedDraft.items[0].expiryDate = "2027-01-31";
        const numberedState = { ...baseState, deliveryDrafts: [numberedDraft] };
        const numberedAction = deletionAction(baseState, originalBatch, "delete-numbered");
        const beforeNumberedState = structuredClone(numberedState);
        expect(() => applicationReducer(numberedState, numberedAction)).toThrow(
            /This product is currently in a Receive Delivery draft/
        );
        expect(numberedState).toEqual(beforeNumberedState);

        const unnumberedBatch = {
            ...originalBatch,
            batchNumber: null,
            receivedDate: "2026-01-01"
        };
        const unnumberedState: ApplicationState = {
            ...baseState,
            inventoryBatches: [unnumberedBatch],
            deliveryDrafts: []
        };
        const unnumberedDraft = makeDeliveryDraft(product.id);
        unnumberedDraft.items[0].variantId = productVariant.id;
        unnumberedDraft.items[0].batchNumber = null;
        unnumberedDraft.items[0].expiryDate = "2027-01-31";
        unnumberedState.deliveryDrafts = [unnumberedDraft];
        const unnumberedAction = deletionAction(
            unnumberedState,
            unnumberedBatch,
            "delete-unnumbered"
        );
        const beforeUnnumberedState = structuredClone(unnumberedState);
        expect(() => applicationReducer(unnumberedState, unnumberedAction)).toThrow(
            /This product is currently in a Receive Delivery draft/
        );
        expect(unnumberedState).toEqual(beforeUnnumberedState);

        for (const status of ["received", "cancelled"] as const) {
            const inactiveDraft = makeDeliveryDraft(product.id, status);
            inactiveDraft.items[0].variantId = productVariant.id;
            inactiveDraft.items[0].batchNumber = originalBatch.batchNumber;
            inactiveDraft.items[0].expiryDate = "2027-01-31";
            const inactiveState = { ...baseState, deliveryDrafts: [inactiveDraft] };
            expect(() => applicationReducer(
                inactiveState,
                deletionAction(baseState, originalBatch, `delete-${status}`)
            )).not.toThrow();
        }

        const unrelatedDraft = makeDeliveryDraft(product.id);
        unrelatedDraft.items[0].productId = "other-product";
        unrelatedDraft.items[0].variantId = productVariant.id;
        unrelatedDraft.items[0].batchNumber = "OTHER-LOT";
        unrelatedDraft.items[0].expiryDate = "2027-01-31";
        const unrelatedState = { ...baseState, deliveryDrafts: [unrelatedDraft] };
        const unrelatedCommitted = applicationReducer(
            unrelatedState,
            deletionAction(baseState, originalBatch, "delete-unrelated")
        );
        expect(unrelatedCommitted.inventoryBatches).toEqual([]);
    });

    it("removes a confirmed batch and its stock while preserving sibling batch records", () => {
        const baseState = makeProductDeletionState();
        const product = baseState.products[0];
        const targetBatch = baseState.inventoryBatches[0];
        const otherProduct = {
            id: "other-product",
            name: "Other medicine",
            variant: [{
                id: "other-variant",
                variantName: "Bottle",
                packagingHierarchy: [{
                    id: "other-packaging",
                    name: "Bottle",
                    costPrice: null,
                    sellingPrice: null,
                    quantityofNextLevel: null,
                    nextLevelId: null
                }]
            }]
        };
        const unrelatedBatch = {
            batchId: "unrelated-batch",
            productId: otherProduct.id,
            variantId: otherProduct.variant[0].id,
            batchNumber: "OTHER-LOT",
            expiryDate: new Date("2028-01-01T00:00:00.000Z")
        };
        const unrelatedRecord = {
            id: "unrelated-inventory",
            productId: otherProduct.id,
            variantId: otherProduct.variant[0].id,
            batchId: unrelatedBatch.batchId,
            stockQuantities: [{ packagingLevelId: "other-packaging", quantity: 13 }]
        };
        const siblingBatch = {
            ...targetBatch,
            batchId: "batch-sibling",
            batchNumber: "LOT-SIBLING"
        };
        const siblingRecord = {
            ...baseState.inventoryRecords[0],
            id: "inventory-sibling",
            batchId: siblingBatch.batchId,
            stockQuantities: [{
                ...baseState.inventoryRecords[0].stockQuantities[0],
                quantity: 11
            }]
        };
        const updatedSiblingBatch = {
            ...siblingBatch,
            batchNumber: "LOT-SIBLING-UPDATED"
        };
        const adjustedSiblingRecord = {
            ...siblingRecord,
            stockQuantities: [{
                ...siblingRecord.stockQuantities[0],
                quantity: 12
            }]
        };
        const state = {
            ...baseState,
            products: [...baseState.products, otherProduct],
            inventoryRecords: [
                ...baseState.inventoryRecords,
                siblingRecord,
                unrelatedRecord
            ],
            inventoryBatches: [
                ...baseState.inventoryBatches,
                siblingBatch,
                unrelatedBatch
            ]
        };
        const action = {
            type: "inventory.saved" as const,
            inventoryRecords: [adjustedSiblingRecord, unrelatedRecord],
            inventoryBatches: [updatedSiblingBatch, unrelatedBatch],
            events: prepareActivityEvents([
                buildBatchRemovalActivityInput(
                    "batch-delete-commit",
                    product,
                    targetBatch,
                    state.inventoryRecords,
                    state.inventoryBatches,
                    "Remove recalled lot"
                ),
                buildBatchUpdatedActivityInput(
                    "batch-delete-commit",
                    siblingBatch,
                    updatedSiblingBatch,
                    product,
                    "Correct sibling lot number"
                )!,
                buildStockAdjustmentActivityInput({
                    id: "adjust-sibling-stock",
                    inventoryId: siblingRecord.id,
                    productId: product.id,
                    variantId: siblingRecord.variantId,
                    batchId: siblingBatch.batchId,
                    packagingLevelId: siblingRecord.stockQuantities[0].packagingLevelId,
                    previousQuantity: 11,
                    newQuantity: 12,
                    quantityDifference: 1,
                    reason: "Stock count",
                    createdAt: new Date("2026-01-01T00:00:00.000Z")
                }, product, state.inventoryBatches, "batch-delete-commit")
            ])
        };

        const beforeState = structuredClone(state);
        expect(() => applicationReducer(state, {
            ...action,
            inventoryRecords: [adjustedSiblingRecord]
        })).toThrow("Inventory save would remove or alter unrelated records.");
        expect(() => applicationReducer(state, {
            ...action,
            inventoryRecords: [
                adjustedSiblingRecord,
                { ...unrelatedRecord, stockQuantities: [{
                    packagingLevelId: "other-packaging",
                    quantity: 99
                }] }
            ]
        })).toThrow("Inventory save would remove or alter unrelated records.");
        expect(state).toEqual(beforeState);

        const committed = applicationReducer(state, action);

        expect(committed.inventoryBatches).toEqual([updatedSiblingBatch, unrelatedBatch]);
        expect(committed.inventoryRecords).toEqual([adjustedSiblingRecord, unrelatedRecord]);
        expect(committed.inventoryRecords[0].stockQuantities[0].quantity).toBe(12);
        expect(committed.inventoryRecords[1].stockQuantities[0].quantity).toBe(13);
        expect(committed.products).toEqual(state.products);
        expect(committed.activityEvents[0]).toMatchObject({
            type: "inventory.batch_removed",
            removedBatch: { batchId: targetBatch.batchId },
            affectedInventory: [expect.objectContaining({
                inventoryId: baseState.inventoryRecords[0].id,
                stock: [expect.objectContaining({ quantity: 4 })]
            })]
        });
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

    it("validates catalogue creation structure and exact creation Activity atomically", () => {
        const product = createProductResult().product;
        const state = {
            ...createInitialApplicationState(),
            products: [],
            inventoryRecords: [],
            inventoryBatches: [],
            activityEvents: []
        };
        const events = prepareActivityEvents(
            buildProductCreationActivityInputs(product, [], [])
        );
        const before = structuredClone(state);
        const malformedProduct = {
            ...product,
            variant: product.variant.map((productVariant) => ({
                ...productVariant,
                packagingHierarchy: productVariant.packagingHierarchy.map(
                    (level) => ({
                        ...level,
                        nextLevelId: level.id,
                        quantityofNextLevel: 1
                    })
                )
            }))
        };
        const tamperedEvents = events.map((event) =>
            event.type === "product.created"
                ? {
                    ...event,
                    product: { ...event.product, productName: "Forged name" }
                }
                : event
        );

        expect(() => applicationReducer(state, {
            type: "product.catalogue_created",
            product: malformedProduct,
            events
        })).toThrow();
        expect(() => applicationReducer(state, {
            type: "product.catalogue_created",
            product,
            events: []
        })).toThrow("A catalogue product creation requires matching product Activity.");
        expect(() => applicationReducer(state, {
            type: "product.catalogue_created",
            product,
            events: tamperedEvents
        })).toThrow("A catalogue product creation requires matching product Activity.");
        expect(state).toEqual(before);
    });

    it("blocks catalogue creation from reusing an ID referenced by an active delivery draft", () => {
        const product = createProductResult().product;
        const state = {
            ...createInitialApplicationState(),
            products: [],
            inventoryRecords: [],
            inventoryBatches: [],
            activityEvents: [],
            deliveryDrafts: [makeDeliveryDraft(product.id)]
        };
        const before = structuredClone(state);
        const action = {
            type: "product.catalogue_created" as const,
            product,
            events: prepareActivityEvents(
                buildProductCreationActivityInputs(product, [], [])
            )
        };

        expect(() => applicationReducer(state, action)).toThrow(
            /Receive Delivery draft/
        );
        expect(state.products).toEqual([]);
        expect(state.activityEvents).toEqual([]);
        expect(state).toEqual(before);
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
            .toThrow("Product update Activity does not match the committed changes.");
        expect(stockState.activityEvents).toEqual([]);
        expect(stockState.products[0]).toBe(product);
    });

    it("commits inventory changes and adjustment events atomically and idempotently", () => {
        const fixture = createProductResult();
        const initial = createInitialApplicationState();
        const state = {
            ...initial,
            products: [fixture.product],
            inventoryRecords: fixture.inventoryRecords,
            inventoryBatches: fixture.inventoryBatches,
            activityEvents: []
        };
        const record = fixture.inventoryRecords[0];
        const packagingLevel = fixture.product.variant[0].packagingHierarchy[0];
        if (!record || !packagingLevel) {
            throw new Error("Inventory adjustment fixture is incomplete.");
        }
        const events = prepareActivityEvents([buildStockAdjustmentActivityInput({
            id: "adjustment-1",
            inventoryId: record.id,
            productId: record.productId,
            variantId: record.variantId,
            batchId: record.batchId,
            packagingLevelId: packagingLevel.id,
            previousQuantity: 4,
            newQuantity: 6,
            quantityDifference: 2,
            reason: "Physical count",
            createdAt: new Date("2026-02-03T04:05:06.000Z")
        }, fixture.product, fixture.inventoryBatches, "adjustment-1")]);
        const action = {
            type: "inventory.saved" as const,
            inventoryRecords: fixture.inventoryRecords.map((item) => item.id === record.id
                ? {
                    ...item,
                    stockQuantities: item.stockQuantities.map((stock) =>
                        stock.packagingLevelId === packagingLevel.id
                            ? { ...stock, quantity: 6 }
                            : stock
                    )
                }
                : item),
            inventoryBatches: fixture.inventoryBatches,
            events
        };
        const committed = applicationReducer(state, action);

        expect(committed.inventoryRecords[0].stockQuantities[0].quantity).toBe(6);
        expect(committed.products).toBe(state.products);
        expect(committed.activityEvents).toHaveLength(1);
        expect(applicationReducer(committed, action)).toBe(committed);
    });

    it("rejects inventory changes without matching Activity and preserves the full state", () => {
        const fixture = createProductResult();
        const record = fixture.inventoryRecords[0];
        const packagingLevel = fixture.product.variant[0].packagingHierarchy[0];
        if (!record || !packagingLevel) {
            throw new Error("Inventory adjustment fixture is incomplete.");
        }
        const unrelatedRecord = {
            id: "unrelated-inventory",
            productId: record.productId,
            variantId: record.variantId,
            batchId: null,
            stockQuantities: [{ packagingLevelId: packagingLevel.id, quantity: 1 }]
        };
        const state = {
            ...createInitialApplicationState(),
            products: [fixture.product],
            inventoryRecords: [...fixture.inventoryRecords, unrelatedRecord],
            inventoryBatches: fixture.inventoryBatches,
            activityEvents: []
        };
        const updatedRecords = state.inventoryRecords.map((item) =>
            item.id === record.id
                ? {
                    ...item,
                    stockQuantities: item.stockQuantities.map((stock) =>
                        stock.packagingLevelId === packagingLevel.id
                            ? { ...stock, quantity: 6 }
                            : stock
                    )
                }
                : item
        );
        const [event] = prepareActivityEvents([buildStockAdjustmentActivityInput({
            id: "adjustment-1",
            inventoryId: record.id,
            productId: record.productId,
            variantId: record.variantId,
            batchId: record.batchId,
            packagingLevelId: packagingLevel.id,
            previousQuantity: 4,
            newQuantity: 6,
            quantityDifference: 2,
            reason: "Physical count",
            createdAt: new Date("2026-02-03T04:05:06.000Z")
        }, fixture.product, fixture.inventoryBatches, "adjustment-1")]);
        if (event?.type !== "inventory.stock_adjusted") {
            throw new Error("Inventory adjustment event was not created.");
        }
        const before = structuredClone(state);

        expect(() => applicationReducer(state, {
            type: "inventory.saved",
            inventoryRecords: updatedRecords,
            inventoryBatches: state.inventoryBatches,
            events: []
        })).toThrow("Inventory save would remove or alter unrelated records.");
        expect(() => applicationReducer(state, {
            type: "inventory.saved",
            inventoryRecords: updatedRecords,
            inventoryBatches: state.inventoryBatches,
            events: [{
                ...event,
                previousQuantity: 3,
                quantityDifference: 3
            }]
        })).toThrow("Stock adjustment Activity does not match current quantity.");
        expect(() => applicationReducer(state, {
            type: "inventory.saved",
            inventoryRecords: updatedRecords,
            inventoryBatches: state.inventoryBatches,
            events: [{
                ...event,
                newQuantity: 7,
                quantityDifference: 3
            }]
        })).toThrow("Inventory save would remove or alter unrelated records.");
        expect(() => applicationReducer(state, {
            type: "inventory.saved",
            inventoryRecords: [updatedRecords[0]!],
            inventoryBatches: state.inventoryBatches,
            events: [event]
        })).toThrow("Inventory save would remove or alter unrelated records.");
        expect(state).toEqual(before);
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
        const before = structuredClone(state);
        const action = {
            type: "product.updated" as const,
            product: { ...state.products[0], name: "Changed" },
            events: []
        };

        expect(() => applicationReducer(state, action)).toThrow(
            "A product update requires matching update Activity."
        );
        expect(state).toEqual(before);
    });

    it("validates product update snapshots, structure, and complete inventory atomically", () => {
        const state = createInitialApplicationState();
        const original = state.products[0];
        const updated = { ...original, name: "Updated medicine" };
        const events = prepareActivityEvents(buildProductUpdateActivityInputs(
            original,
            updated,
            state.inventoryRecords,
            state.inventoryRecords,
            state.inventoryBatches,
            "product.updated:integrity-check",
            "Update product name"
        ));
        const action = {
            type: "product.updated" as const,
            product: updated,
            inventoryRecords: state.inventoryRecords,
            inventoryBatches: state.inventoryBatches,
            events
        };
        const before = structuredClone(state);
        const tamperedSnapshots = events.map((event) =>
            event.type === "product.updated"
                ? { ...event, before: { ...event.before, productName: "Forged" } }
                : event
        );
        const malformedHierarchy = {
            ...updated,
            variant: updated.variant.map((productVariant) => ({
                ...productVariant,
                packagingHierarchy: productVariant.packagingHierarchy.map(
                    (level) => ({
                        ...level,
                        nextLevelId: level.id,
                        quantityofNextLevel: 1
                    })
                )
            }))
        };
        const duplicateIds = {
            ...updated,
            variant: updated.variant.map((productVariant, index) =>
                index === 0
                    ? { ...productVariant, id: updated.id }
                    : productVariant
            )
        };
        const firstProductRecord = state.inventoryRecords.find(
            (record) => record.productId === original.id
        );
        const otherProductRecord = state.inventoryRecords.find(
            (record) => record.productId !== original.id
        );
        if (!firstProductRecord || !otherProductRecord) {
            throw new Error("Product update fixture requires product inventory records.");
        }
        const changedExistingStock = state.inventoryRecords.map((record) =>
            record.id === firstProductRecord.id
                ? {
                    ...record,
                    stockQuantities: record.stockQuantities.map((stock, index) =>
                        index === 0
                            ? { ...stock, quantity: stock.quantity + 1 }
                            : stock
                    )
                }
                : record
        );
        const changedUnrelatedStock = state.inventoryRecords.map((record) =>
            record.id === otherProductRecord.id
                ? {
                    ...record,
                    stockQuantities: record.stockQuantities.map((stock, index) =>
                        index === 0
                            ? { ...stock, quantity: stock.quantity + 1 }
                            : stock
                    )
                }
                : record
        );

        expect(() => applicationReducer(state, {
            ...action,
            events: tamperedSnapshots
        })).toThrow("Product update Activity does not match the committed changes.");
        expect(() => applicationReducer(state, {
            ...action,
            product: malformedHierarchy
        })).toThrow();
        expect(() => applicationReducer(state, {
            ...action,
            product: duplicateIds
        })).toThrow();
        expect(() => applicationReducer(state, {
            ...action,
            inventoryRecords: state.inventoryRecords.filter(
                (record) => record.id !== firstProductRecord.id
            )
        })).toThrow("Product update cannot remove inventory records.");
        expect(() => applicationReducer(state, {
            ...action,
            inventoryRecords: changedExistingStock
        })).toThrow(
            "Product update may only add initial stock for new packaging levels."
        );
        expect(() => applicationReducer(state, {
            ...action,
            inventoryRecords: changedUnrelatedStock
        })).toThrow("Product update cannot alter unrelated inventory records.");
        expect(() => applicationReducer(state, {
            ...action,
            inventoryBatches: state.inventoryBatches.slice(1)
        })).toThrow("Product update cannot modify or omit inventory batches.");
        expect(state).toEqual(before);
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
            /inventory and product structure cannot be modified/
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
