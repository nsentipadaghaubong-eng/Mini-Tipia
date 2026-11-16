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
    snapshotProductInventoryState,
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

function makeProductCreationAction(
    result: ReturnType<typeof createProductResult>,
    eventIdPrefix: string,
    occurredAt: string
) {
    let eventIndex = 0;
    return {
        type: "product.created" as const,
        result,
        events: prepareActivityEvents(
            buildProductCreationActivityInputs(
                result.product,
                result.inventoryRecords,
                result.inventoryBatches
            ),
            {
                makeId: () => `${eventIdPrefix}-${eventIndex++}`,
                now: () => new Date(occurredAt)
            }
        )
    };
}

function makeCatalogueCreationAction(
    product: ReturnType<typeof createProductResult>["product"],
    eventIdPrefix: string,
    occurredAt: string
) {
    let eventIndex = 0;
    return {
        type: "product.catalogue_created" as const,
        product,
        events: prepareActivityEvents(
            buildProductCreationActivityInputs(product, [], []),
            {
                makeId: () => `${eventIdPrefix}-${eventIndex++}`,
                now: () => new Date(occurredAt)
            }
        )
    };
}

function makeCommittedProductUpdate() {
    const state = createInitialApplicationState();
    const product = state.products[0];
    if (!product) {
        throw new Error("Product update fixture requires a product.");
    }
    const updatedProduct = {
        ...product,
        description: "Updated for replay validation"
    };
    const operationKey = `product.updated:${product.id}:replay-fixture`;
    const reason = "Update product description";
    const activityInputs = buildProductUpdateActivityInputs(
        product,
        updatedProduct,
        state.inventoryRecords,
        state.inventoryRecords,
        state.inventoryBatches,
        operationKey,
        reason
    );
    let eventId = 0;
    const events = prepareActivityEvents(activityInputs, {
        makeId: () => `update-original-${eventId++}`,
        now: () => new Date("2026-03-04T05:06:07.000Z")
    });
    const action = {
        type: "product.updated" as const,
        product: updatedProduct,
        inventoryRecords: state.inventoryRecords,
        inventoryBatches: state.inventoryBatches,
        events
    };
    const committed = applicationReducer(state, action);

    return {
        state,
        product,
        updatedProduct,
        operationKey,
        reason,
        activityInputs,
        action,
        committed
    };
}

function makeCommittedPackagingStockUpdate() {
    const product = createProductResult().product;
    const productVariant = product.variant[0];
    if (!productVariant) {
        throw new Error("Packaging stock fixture requires a variant.");
    }
    const state = {
        ...createInitialApplicationState(),
        products: [product],
        inventoryRecords: [],
        inventoryBatches: [],
        activityEvents: []
    };
    const draft = addPackagingLevelToUpdateDraft(
        createProductUpdateDraft(product),
        0,
        () => "replay-packaging-level"
    );
    draft.reason = "Add packaging with initial stock";
    draft.variants[0]!.packaging.at(-2)!.quantityofNextLevel = "2";
    draft.variants[0]!.packaging.at(-1)!.name = "Unit";
    const updatedProduct = buildUpdatedProduct(product, draft);
    const inventoryRecords = applyPackagingLevelInitialStock(
        product,
        [],
        [],
        productVariant.id,
        "replay-packaging-level",
        "3"
    );
    const operationKey = "product.updated:packaging-stock-replay";
    const reason = draft.reason;
    const activityInputs = buildProductUpdateActivityInputs(
        product,
        updatedProduct,
        [],
        inventoryRecords,
        [],
        operationKey,
        reason
    );
    let eventId = 0;
    const events = prepareActivityEvents(activityInputs, {
        makeId: () => `packaging-stock-original-${eventId++}`,
        now: () => new Date("2026-03-04T05:06:07.000Z")
    });
    const action = {
        type: "product.updated" as const,
        product: updatedProduct,
        inventoryRecords,
        inventoryBatches: [],
        events
    };
    const committed = applicationReducer(state, action);

    return {
        state,
        product,
        updatedProduct,
        inventoryRecords,
        operationKey,
        reason,
        activityInputs,
        action,
        committed
    };
}

function makeEmptyProductCreationState(): ApplicationState {
    return {
        ...createInitialApplicationState(),
        products: [],
        inventoryRecords: [],
        inventoryBatches: [],
        activityEvents: []
    };
}

function makeCommittedProductCreationReplay() {
    const result = createProductResult();
    const originalAction = makeProductCreationAction(
        result,
        "product-created-evidence-original",
        "2026-02-03T04:05:06.000Z"
    );
    const committed = applicationReducer(
        makeEmptyProductCreationState(),
        originalAction
    );
    const replay = makeProductCreationAction(
        result,
        "product-created-evidence-replay",
        "2027-03-04T05:06:07.000Z"
    );

    return { result, originalAction, committed, replay };
}

function withFirstPackagingCostPrice(
    result: ReturnType<typeof createProductResult>,
    costPrice: number | null
): ReturnType<typeof createProductResult> {
    return {
        ...result,
        product: {
            ...result.product,
            variant: result.product.variant.map((productVariant, variantIndex) =>
                variantIndex === 0
                    ? {
                        ...productVariant,
                        packagingHierarchy: productVariant.packagingHierarchy.map(
                            (level, levelIndex) =>
                                levelIndex === 0 ? { ...level, costPrice } : level
                        )
                    }
                    : productVariant
            )
        }
    };
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
        const initial = makeEmptyProductCreationState();
        const action = makeProductCreationAction(
            result,
            "product-created-initial",
            "2026-02-03T04:05:06.000Z"
        );
        const committed = applicationReducer(initial, action);

        expect(committed.products).toEqual([result.product]);
        expect(committed.inventoryRecords).toEqual(result.inventoryRecords);
        expect(committed.inventoryBatches).toEqual(result.inventoryBatches);
        expect(committed.activityEvents.map((event) => event.type)).toEqual([
            "product.created",
            "inventory.batch_created"
        ]);
        const replay = makeProductCreationAction(
            result,
            "product-created-replay",
            "2027-03-04T05:06:07.000Z"
        );
        const stateBeforeReplay = structuredClone(committed);
        const replayed = applicationReducer(committed, replay);

        expect(replay.events.map((event) => event.eventId)).not.toEqual(
            action.events.map((event) => event.eventId)
        );
        expect(replay.events.map((event) => event.occurredAt)).not.toEqual(
            action.events.map((event) => event.occurredAt)
        );
        expect(replayed).toBe(committed);
        expect(committed).toEqual(stateBeforeReplay);
    });

    it("accepts product creation replays with reordered Activity object properties", () => {
        const result = createProductResult();
        const initialAction = makeProductCreationAction(
            result,
            "product-created-original",
            "2026-02-03T04:05:06.000Z"
        );
        const committed = applicationReducer(
            makeEmptyProductCreationState(),
            initialAction
        );
        const replay = makeProductCreationAction(
            result,
            "product-created-replay",
            "2027-03-04T05:06:07.000Z"
        );
        const productCreatedEvent = replay.events.find(
            (event) => event.type === "product.created"
        );
        if (!productCreatedEvent) {
            throw new Error("Product creation fixture requires a product Activity event.");
        }
        const reorderedProductCreatedEvent = {
            initialInventory: productCreatedEvent.initialInventory,
            product: {
                variants: productCreatedEvent.product.variants.map((variant) => ({
                    packaging: variant.packaging.map((level) => ({
                        nextLevelName: level.nextLevelName,
                        nextLevelId: level.nextLevelId,
                        quantityOfNextLevel: level.quantityOfNextLevel,
                        sellingPrice: level.sellingPrice,
                        costPrice: level.costPrice,
                        name: level.name,
                        packagingLevelId: level.packagingLevelId
                    })),
                    nafdacRegistrationNumber: variant.nafdacRegistrationNumber,
                    variantName: variant.variantName,
                    variantId: variant.variantId
                })),
                category: productCreatedEvent.product.category,
                manufacturer: productCreatedEvent.product.manufacturer,
                genericName: productCreatedEvent.product.genericName,
                description: productCreatedEvent.product.description,
                productName: productCreatedEvent.product.productName,
                productId: productCreatedEvent.product.productId
            },
            operationKey: productCreatedEvent.operationKey,
            type: productCreatedEvent.type,
            eventId: productCreatedEvent.eventId,
            occurredAt: productCreatedEvent.occurredAt
        };
        const reorderedReplay = {
            ...replay,
            events: replay.events.map((event) =>
                event.type === "product.created"
                    ? reorderedProductCreatedEvent
                    : event
            )
        };
        const before = structuredClone(committed);

        expect(applicationReducer(committed, reorderedReplay)).toBe(committed);
        expect(committed).toEqual(before);
    });

    it("rejects a null packaging price replayed as NaN atomically", () => {
        const result = withFirstPackagingCostPrice(createProductResult(), null);
        const initialAction = makeProductCreationAction(
            result,
            "product-created-original",
            "2026-02-03T04:05:06.000Z"
        );
        const committed = applicationReducer(
            makeEmptyProductCreationState(),
            initialAction
        );
        const changedResult = withFirstPackagingCostPrice(result, Number.NaN);
        const replay = makeProductCreationAction(
            changedResult,
            "product-created-nan-price",
            "2027-03-04T05:06:07.000Z"
        );
        const before = structuredClone(committed);

        expect(() => applicationReducer(committed, replay)).toThrow(
            "Product creation replay does not match the previously committed operation."
        );
        expect(committed).toEqual(before);
    });

    it("rejects infinite packaging prices that differ from the original atomically", () => {
        const result = createProductResult();
        const initialAction = makeProductCreationAction(
            result,
            "product-created-original",
            "2026-02-03T04:05:06.000Z"
        );
        const committed = applicationReducer(
            makeEmptyProductCreationState(),
            initialAction
        );
        const before = structuredClone(committed);

        for (const [index, costPrice] of [
            Number.POSITIVE_INFINITY,
            Number.NEGATIVE_INFINITY
        ].entries()) {
            const replay = makeProductCreationAction(
                withFirstPackagingCostPrice(result, costPrice),
                `product-created-infinite-price-${index}`,
                "2027-03-04T05:06:07.000Z"
            );
            expect(() => applicationReducer(committed, replay)).toThrow(
                "Product creation replay does not match the previously committed operation."
            );
            expect(committed).toEqual(before);
        }
    });

    it("rejects product creation replays with reordered Activity arrays atomically", () => {
        const result = createProductResult();
        const firstVariant = result.product.variant[0];
        if (!firstVariant) {
            throw new Error("Product creation fixture requires a product variant.");
        }
        const secondVariant = {
            ...firstVariant,
            id: "replay-array-variant",
            packagingHierarchy: firstVariant.packagingHierarchy.map(
                (level, index) => ({
                    ...level,
                    id: `replay-array-packaging-${index}`
                })
            )
        };
        const resultWithTwoVariants = {
            ...result,
            product: {
                ...result.product,
                variant: [...result.product.variant, secondVariant]
            }
        };
        const initialAction = makeProductCreationAction(
            resultWithTwoVariants,
            "product-created-original",
            "2026-02-03T04:05:06.000Z"
        );
        const committed = applicationReducer(
            makeEmptyProductCreationState(),
            initialAction
        );
        const replay = makeProductCreationAction(
            resultWithTwoVariants,
            "product-created-replay",
            "2027-03-04T05:06:07.000Z"
        );
        const reorderedReplay = {
            ...replay,
            events: replay.events.map((event) =>
                event.type === "product.created"
                    ? {
                        ...event,
                        product: {
                            ...event.product,
                            variants: [...event.product.variants].reverse()
                        }
                    }
                    : event
            )
        };
        const before = structuredClone(committed);

        expect(() => applicationReducer(committed, reorderedReplay)).toThrow(
            "Product creation replay does not match the previously committed operation."
        );
        expect(committed).toEqual(before);
    });

    it("rejects sparse product variant Activity arrays atomically", () => {
        const result = createProductResult();
        const firstVariant = result.product.variant[0];
        if (!firstVariant) {
            throw new Error("Product creation fixture requires a product variant.");
        }
        const secondVariant = {
            ...firstVariant,
            id: "sparse-replay-variant",
            packagingHierarchy: firstVariant.packagingHierarchy.map(
                (level, index) => ({
                    ...level,
                    id: `sparse-replay-packaging-${index}`
                })
            )
        };
        const resultWithTwoVariants = {
            ...result,
            product: {
                ...result.product,
                variant: [...result.product.variant, secondVariant]
            }
        };
        const initialAction = makeProductCreationAction(
            resultWithTwoVariants,
            "product-created-original",
            "2026-02-03T04:05:06.000Z"
        );
        const committed = applicationReducer(
            makeEmptyProductCreationState(),
            initialAction
        );
        const replay = makeProductCreationAction(
            resultWithTwoVariants,
            "product-created-replay",
            "2027-03-04T05:06:07.000Z"
        );
        const productCreatedEvent = replay.events.find(
            (event) => event.type === "product.created"
        );
        if (!productCreatedEvent) {
            throw new Error("Product creation fixture requires a product Activity event.");
        }
        const sparseVariants = new Array(
            productCreatedEvent.product.variants.length
        );
        sparseVariants[0] = productCreatedEvent.product.variants[0];
        expect(sparseVariants).toHaveLength(
            productCreatedEvent.product.variants.length
        );
        expect(Object.prototype.hasOwnProperty.call(sparseVariants, 1)).toBe(false);
        const sparseReplay = {
            ...replay,
            events: replay.events.map((event) =>
                event.type === "product.created"
                    ? {
                        ...event,
                        product: {
                            ...event.product,
                            variants: sparseVariants
                        }
                    }
                    : event
            )
        };
        const before = structuredClone(committed);

        expect(() => applicationReducer(committed, sparseReplay)).toThrow(
            "Product creation replay does not match the previously committed operation."
        );
        expect(committed).toEqual(before);
    });

    it("rejects product creation replays with invalid or duplicate Activity metadata atomically", () => {
        const result = createProductResult();
        const initialAction = makeProductCreationAction(
            result,
            "product-created-original",
            "2026-02-03T04:05:06.000Z"
        );
        const committed = applicationReducer(
            makeEmptyProductCreationState(),
            initialAction
        );
        const replay = makeProductCreationAction(
            result,
            "product-created-replay",
            "2027-03-04T05:06:07.000Z"
        );
        const firstEvent = replay.events[0];
        const secondEvent = replay.events[1];
        if (!firstEvent || !secondEvent) {
            throw new Error("Product creation fixture requires multiple Activity events.");
        }
        const invalidMetadataReplays = [
            {
                ...replay,
                events: replay.events.map((event, index) =>
                    index === 1
                        ? { ...event, eventId: firstEvent.eventId }
                        : event
                )
            },
            {
                ...replay,
                events: replay.events.map((event, index) =>
                    index === 0
                        ? { ...event, eventId: " " }
                        : event
                )
            },
            {
                ...replay,
                events: replay.events.map((event, index) =>
                    index === 0
                        ? { ...event, occurredAt: "not-a-timestamp" }
                        : event
                )
            },
            {
                ...replay,
                events: replay.events.map((event, index) =>
                    index === 0
                        ? { ...event, occurredAt: "2027-03-04T05:06:07Z" }
                        : event
                )
            }
        ];
        const before = structuredClone(committed);

        for (const invalidReplay of invalidMetadataReplays) {
            expect(() => applicationReducer(committed, invalidReplay)).toThrow(
                "Product Activity contains invalid or duplicate metadata."
            );
            expect(committed).toEqual(before);
        }
    });

    it("rejects product creation replays with changed product fields atomically", () => {
        const result = createProductResult();
        const committed = applicationReducer(
            makeEmptyProductCreationState(),
            makeProductCreationAction(
                result,
                "product-created-original",
                "2026-02-03T04:05:06.000Z"
            )
        );
        const changedResult = {
            ...result,
            product: { ...result.product, name: "Changed medicine" }
        };
        const replay = makeProductCreationAction(
            changedResult,
            "product-created-changed",
            "2027-03-04T05:06:07.000Z"
        );
        const before = structuredClone(committed);

        expect(() => applicationReducer(committed, replay)).toThrow(
            "Product creation replay does not match the previously committed operation."
        );
        expect(committed).toEqual(before);
    });

    it("rejects product creation replays with changed variants or packaging atomically", () => {
        const result = createProductResult();
        const committed = applicationReducer(
            makeEmptyProductCreationState(),
            makeProductCreationAction(
                result,
                "product-created-original",
                "2026-02-03T04:05:06.000Z"
            )
        );
        const changedVariantResult = {
            ...result,
            product: {
                ...result.product,
                variant: result.product.variant.map((productVariant) => ({
                    ...productVariant,
                    variantName: `${productVariant.variantName} changed`
                }))
            }
        };
        const changedPackagingResult = {
            ...result,
            product: {
                ...result.product,
                variant: result.product.variant.map((productVariant) => ({
                    ...productVariant,
                    packagingHierarchy: productVariant.packagingHierarchy.map(
                        (level, index) => index === 0
                            ? { ...level, name: `${level.name} changed` }
                            : level
                    )
                }))
            }
        };
        const before = structuredClone(committed);

        for (const [index, changedResult] of [
            changedVariantResult,
            changedPackagingResult
        ].entries()) {
            const replay = makeProductCreationAction(
                changedResult,
                `product-created-structure-${index}`,
                "2027-03-04T05:06:07.000Z"
            );
            expect(() => applicationReducer(committed, replay)).toThrow(
                "Product creation replay does not match the previously committed operation."
            );
            expect(committed).toEqual(before);
        }
    });

    it("rejects product creation replays with changed initial inventory atomically", () => {
        const result = createProductResult();
        const committed = applicationReducer(
            makeEmptyProductCreationState(),
            makeProductCreationAction(
                result,
                "product-created-original",
                "2026-02-03T04:05:06.000Z"
            )
        );
        const changedResult = {
            ...result,
            inventoryRecords: result.inventoryRecords.map((record, recordIndex) =>
                recordIndex === 0
                    ? {
                        ...record,
                        stockQuantities: record.stockQuantities.map(
                            (stock, stockIndex) => stockIndex === 0
                                ? { ...stock, quantity: stock.quantity + 1 }
                                : stock
                        )
                    }
                    : record
            )
        };
        const replay = makeProductCreationAction(
            changedResult,
            "product-created-stock-changed",
            "2027-03-04T05:06:07.000Z"
        );
        const before = structuredClone(committed);

        expect(() => applicationReducer(committed, replay)).toThrow(
            "Product creation replay does not match the previously committed operation."
        );
        expect(committed).toEqual(before);
    });

    it("rejects product creation replays with changed batch information atomically", () => {
        const result = createProductResult();
        const committed = applicationReducer(
            makeEmptyProductCreationState(),
            makeProductCreationAction(
                result,
                "product-created-original",
                "2026-02-03T04:05:06.000Z"
            )
        );
        const changedResult = {
            ...result,
            inventoryBatches: result.inventoryBatches.map((batch) => ({
                ...batch,
                batchNumber: `${batch.batchNumber ?? "LOT"}-changed`
            }))
        };
        const replay = makeProductCreationAction(
            changedResult,
            "product-created-batch-changed",
            "2027-03-04T05:06:07.000Z"
        );
        const before = structuredClone(committed);

        expect(() => applicationReducer(committed, replay)).toThrow(
            "Product creation replay does not match the previously committed operation."
        );
        expect(committed).toEqual(before);
    });

    it("rejects product creation replays with missing or extra batch Activity atomically", () => {
        const result = createProductResult();
        const initialAction = makeProductCreationAction(
            result,
            "product-created-original",
            "2026-02-03T04:05:06.000Z"
        );
        const committed = applicationReducer(
            makeEmptyProductCreationState(),
            initialAction
        );
        const batchEvent = initialAction.events.find(
            (event) => event.type === "inventory.batch_created"
        );
        if (!batchEvent) {
            throw new Error("Product creation fixture requires a batch Activity event.");
        }
        const missingBatchEventReplay = {
            ...initialAction,
            events: initialAction.events.filter(
                (event) => event.type !== "inventory.batch_created"
            )
        };
        const extraBatch = {
            ...result.inventoryBatches[0]!,
            batchId: "unexpected-created-batch",
            batchNumber: "UNEXPECTED-LOT"
        };
        let extraEventId = 0;
        const extraBatchEvents = prepareActivityEvents(
            buildProductCreationActivityInputs(
                result.product,
                result.inventoryRecords,
                [...result.inventoryBatches, extraBatch]
            ),
            {
                makeId: () => `product-created-extra-batch-${extraEventId++}`,
                now: () => new Date("2027-03-04T05:06:07.000Z")
            }
        );
        const extraBatchEventReplay = {
            ...initialAction,
            events: extraBatchEvents
        };
        const before = structuredClone(committed);

        for (const replay of [missingBatchEventReplay, extraBatchEventReplay]) {
            expect(() => applicationReducer(committed, replay)).toThrow(
                "Product creation replay does not match the previously committed operation."
            );
            expect(committed).toEqual(before);
        }
    });

    it("rejects product creation replays with forged product or batch Activity atomically", () => {
        const result = createProductResult();
        const initialAction = makeProductCreationAction(
            result,
            "product-created-original",
            "2026-02-03T04:05:06.000Z"
        );
        const committed = applicationReducer(
            makeEmptyProductCreationState(),
            initialAction
        );
        const forgedProductReplay = {
            ...initialAction,
            events: initialAction.events.map((event) =>
                event.type === "product.created"
                    ? {
                        ...event,
                        product: { ...event.product, productName: "Forged name" }
                    }
                    : event
            )
        };
        const forgedBatchReplay = {
            ...initialAction,
            events: initialAction.events.map((event) =>
                event.type === "inventory.batch_created"
                    ? {
                        ...event,
                        batch: { ...event.batch, batchNumber: "FORGED-LOT" }
                    }
                    : event
            )
        };
        const before = structuredClone(committed);

        for (const replay of [forgedProductReplay, forgedBatchReplay]) {
            expect(() => applicationReducer(committed, replay)).toThrow(
                "Product creation replay does not match the previously committed operation."
            );
            expect(committed).toEqual(before);
        }
    });

    it("rejects conflicting original creation evidence by operation key atomically", () => {
        const fixture = makeCommittedProductCreationReplay();
        const primaryEvent = fixture.originalAction.events.find(
            (event) => event.type === "product.created"
        );
        const batchEvent = fixture.originalAction.events.find(
            (event) => event.type === "inventory.batch_created"
        );
        if (
            primaryEvent?.type !== "product.created" ||
            batchEvent?.type !== "inventory.batch_created"
        ) {
            throw new Error("Product creation fixture requires primary and batch events.");
        }

        const makeWrongTypeEvent = (operationKey: string) => {
            const [event] = prepareActivityEvents(
                buildProductUpdateActivityInputs(
                    fixture.result.product,
                    fixture.result.product,
                    [],
                    [],
                    [],
                    operationKey,
                    "Conflicting event type"
                ),
                {
                    makeId: () => `wrong-type-${operationKey}`,
                    now: () => new Date("2026-02-04T05:06:07.000Z")
                }
            );
            if (event?.type !== "product.updated") {
                throw new Error("Expected a conflicting product update event.");
            }
            return event;
        };
        const conflictingPrimaryType = {
            ...fixture.committed,
            activityEvents: [
                ...fixture.committed.activityEvents,
                makeWrongTypeEvent(primaryEvent.operationKey)
            ]
        };
        const conflictingBatchType = {
            ...fixture.committed,
            activityEvents: [
                ...fixture.committed.activityEvents,
                makeWrongTypeEvent(batchEvent.operationKey)
            ]
        };
        const wrongBatchSource = {
            ...fixture.committed,
            activityEvents: fixture.committed.activityEvents.map((event) =>
                event.operationKey === batchEvent.operationKey &&
                event.type === "inventory.batch_created"
                    ? { ...event, source: "inventory_edit" as const }
                    : event
            )
        };
        const wrongBatchProduct = {
            ...fixture.committed,
            activityEvents: fixture.committed.activityEvents.map((event) =>
                event.operationKey === batchEvent.operationKey &&
                event.type === "inventory.batch_created"
                    ? {
                        ...event,
                        batch: {
                            ...event.batch,
                            productId: "different-product"
                        }
                    }
                    : event
            )
        };
        const appendedWrongBatchSource = {
            ...fixture.committed,
            activityEvents: [
                ...fixture.committed.activityEvents,
                {
                    ...batchEvent,
                    eventId: "appended-wrong-batch-source",
                    source: "inventory_edit" as const
                }
            ]
        };
        const appendedWrongBatchProduct = {
            ...fixture.committed,
            activityEvents: [
                ...fixture.committed.activityEvents,
                {
                    ...batchEvent,
                    eventId: "appended-wrong-batch-product",
                    batch: {
                        ...batchEvent.batch,
                        productId: "different-product"
                    }
                }
            ]
        };

        expect(applicationReducer(
            fixture.committed,
            fixture.replay
        )).toBe(fixture.committed);

        for (const invalidState of [
            conflictingPrimaryType,
            conflictingBatchType,
            wrongBatchSource,
            wrongBatchProduct,
            appendedWrongBatchSource,
            appendedWrongBatchProduct
        ]) {
            const before = structuredClone(invalidState);
            expect(() => applicationReducer(invalidState, fixture.replay)).toThrow(
                "Product creation replay does not match the previously committed operation."
            );
            expect(invalidState).toEqual(before);
        }
    });

    it("does not associate later inventory-edit batch Activity with product creation replay", () => {
        const result = createProductResult();
        const originalCreation = makeProductCreationAction(
            result,
            "product-created-original",
            "2026-02-03T04:05:06.000Z"
        );
        const created = applicationReducer(
            makeEmptyProductCreationState(),
            originalCreation
        );
        const productVariant = result.product.variant[0];
        const packagingLevel = productVariant.packagingHierarchy[0];
        if (!productVariant || !packagingLevel) {
            throw new Error("Product creation fixture requires a packaging level.");
        }
        const laterBatch = {
            batchId: "later-inventory-edit-batch",
            productId: result.product.id,
            variantId: productVariant.id,
            batchNumber: "LATER-LOT",
            expiryDate: new Date("2028-01-31T00:00:00.000Z")
        };
        const laterRecord = {
            id: "later-inventory-edit-record",
            productId: result.product.id,
            variantId: productVariant.id,
            batchId: laterBatch.batchId,
            stockQuantities: [{
                packagingLevelId: packagingLevel.id,
                quantity: 1
            }]
        };
        const withLaterBatch = applicationReducer(created, {
            type: "inventory.saved",
            inventoryRecords: [...created.inventoryRecords, laterRecord],
            inventoryBatches: [...created.inventoryBatches, laterBatch],
            events: prepareActivityEvents([buildBatchCreatedActivityInput(
                "later-inventory-edit",
                result.product,
                laterBatch,
                laterRecord
            )])
        });
        const replay = makeProductCreationAction(
            result,
            "product-created-replay",
            "2027-03-04T05:06:07.000Z"
        );

        expect(() => applicationReducer(withLaterBatch, replay)).not.toThrow();
        expect(applicationReducer(withLaterBatch, replay)).toBe(withLaterBatch);
        expect(withLaterBatch.inventoryBatches).toContainEqual(laterBatch);
    });

    it("allows product creation with a different product identity", () => {
        const firstResult = createProductResult();
        const secondResult = createProductResult();
        expect(secondResult.product.id).not.toBe(firstResult.product.id);
        const firstAction = makeProductCreationAction(
            firstResult,
            "first-product-creation",
            "2026-02-03T04:05:06.000Z"
        );
        const secondAction = makeProductCreationAction(
            secondResult,
            "second-product-creation",
            "2026-02-03T04:05:06.000Z"
        );
        const initial = makeEmptyProductCreationState();
        const committedFirst = applicationReducer(initial, firstAction);

        const committedSecond = applicationReducer(committedFirst, secondAction);

        expect(committedSecond.products).toEqual([
            secondResult.product,
            firstResult.product
        ]);
        expect(committedSecond.activityEvents).toHaveLength(
            firstAction.events.length + secondAction.events.length
        );
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
        const state = makeEmptyProductCreationState();
        const action = makeCatalogueCreationAction(
            product,
            "catalogue-creation-original",
            "2026-02-03T04:05:06.000Z"
        );

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
        const replay = makeCatalogueCreationAction(
            product,
            "catalogue-creation-replay",
            "2027-03-04T05:06:07.000Z"
        );
        const beforeReplay = structuredClone(committed);
        expect(replay.events[0]?.eventId).not.toBe(
            committed.activityEvents[0]?.eventId
        );
        expect(replay.events[0]?.occurredAt).not.toBe(
            committed.activityEvents[0]?.occurredAt
        );
        expect(applicationReducer(committed, replay)).toBe(committed);
        expect(committed).toEqual(beforeReplay);
    });

    it("rejects catalogue replays with changed product, variant, or packaging data atomically", () => {
        const product = createProductResult().product;
        const committed = applicationReducer(
            makeEmptyProductCreationState(),
            makeCatalogueCreationAction(
                product,
                "catalogue-replay-original",
                "2026-02-03T04:05:06.000Z"
            )
        );
        const changedVariant = {
            ...product,
            variant: product.variant.map((productVariant, index) =>
                index === 0
                    ? { ...productVariant, variantName: "Changed variant" }
                    : productVariant
            )
        };
        const changedPackaging = {
            ...product,
            variant: product.variant.map((productVariant, index) =>
                index === 0
                    ? {
                        ...productVariant,
                        packagingHierarchy:
                            productVariant.packagingHierarchy.map(
                                (packagingLevel, levelIndex) =>
                                    levelIndex === 0
                                        ? { ...packagingLevel, name: "Changed packaging" }
                                        : packagingLevel
                            )
                    }
                    : productVariant
            )
        };
        const changedProducts = [
            { ...product, name: "Changed product name" },
            changedVariant,
            changedPackaging
        ];
        const before = structuredClone(committed);

        for (const changedProduct of changedProducts) {
            expect(() => applicationReducer(
                committed,
                makeCatalogueCreationAction(
                    changedProduct,
                    `catalogue-replay-changed-${changedProducts.indexOf(changedProduct)}`,
                    "2027-03-04T05:06:07.000Z"
                )
            )).toThrow(
                "Catalogue product creation replay does not match the previously committed operation."
            );
            expect(committed).toEqual(before);
        }
    });

    it("rejects forged submitted or original catalogue Activity snapshots atomically", () => {
        const product = createProductResult().product;
        const action = makeCatalogueCreationAction(
            product,
            "catalogue-forged-original",
            "2026-02-03T04:05:06.000Z"
        );
        const committed = applicationReducer(
            makeEmptyProductCreationState(),
            action
        );
        const replay = makeCatalogueCreationAction(
            product,
            "catalogue-forged-replay",
            "2027-03-04T05:06:07.000Z"
        );
        const forgedSubmittedReplay = {
            ...replay,
            events: replay.events.map((event) =>
                event.type === "product.created"
                    ? {
                        ...event,
                        product: { ...event.product, productName: "Forged name" }
                    }
                    : event
            )
        };
        const forgedOriginalState = {
            ...committed,
            activityEvents: committed.activityEvents.map((event) =>
                event.type === "product.created"
                    ? {
                        ...event,
                        product: { ...event.product, productName: "Forged history" }
                    }
                    : event
            )
        };
        const beforeCommitted = structuredClone(committed);
        const beforeForgedOriginal = structuredClone(forgedOriginalState);

        expect(() => applicationReducer(committed, forgedSubmittedReplay))
            .toThrow(
                "Catalogue product creation replay does not match the previously committed operation."
            );
        expect(committed).toEqual(beforeCommitted);
        expect(() => applicationReducer(
            forgedOriginalState,
            makeCatalogueCreationAction(
                product,
                "catalogue-forged-history-replay",
                "2027-03-04T05:06:07.000Z"
            )
        )).toThrow(
            "Catalogue product creation replay does not match the previously committed operation."
        );
        expect(forgedOriginalState).toEqual(beforeForgedOriginal);
    });

    it("rejects missing, extra, or duplicate submitted catalogue events atomically", () => {
        const product = createProductResult().product;
        const committed = applicationReducer(
            makeEmptyProductCreationState(),
            makeCatalogueCreationAction(
                product,
                "catalogue-submitted-events-original",
                "2026-02-03T04:05:06.000Z"
            )
        );
        const replay = makeCatalogueCreationAction(
            product,
            "catalogue-submitted-events-replay",
            "2027-03-04T05:06:07.000Z"
        );
        const submittedEvent = replay.events[0];
        if (!submittedEvent) {
            throw new Error("Catalogue replay fixture requires a creation event.");
        }
        const replays = [
            { ...replay, events: [] },
            {
                ...replay,
                events: [
                    submittedEvent,
                    {
                        ...submittedEvent,
                        eventId: "catalogue-extra-submitted-event",
                        operationKey: "product.created:unexpected"
                    }
                ]
            },
            {
                ...replay,
                events: [
                    submittedEvent,
                    {
                        ...submittedEvent,
                        eventId: "catalogue-duplicate-submitted-event"
                    }
                ]
            }
        ];
        const before = structuredClone(committed);

        for (const invalidReplay of replays) {
            expect(() => applicationReducer(committed, invalidReplay)).toThrow();
            expect(committed).toEqual(before);
        }
    });

    it("rejects missing, duplicated, or wrong-type original catalogue evidence atomically", () => {
        const product = createProductResult().product;
        const replay = makeCatalogueCreationAction(
            product,
            "catalogue-original-evidence-replay",
            "2027-03-04T05:06:07.000Z"
        );
        const withoutEvidence = {
            ...makeEmptyProductCreationState(),
            products: [product]
        };
        const duplicatedCommit = applicationReducer(
            makeEmptyProductCreationState(),
            makeCatalogueCreationAction(
                product,
                "catalogue-original-evidence",
                "2026-02-03T04:05:06.000Z"
            )
        );
        const duplicateEvent = makeCatalogueCreationAction(
            product,
            "catalogue-original-evidence-duplicate",
            "2026-02-04T04:05:06.000Z"
        ).events[0];
        if (!duplicateEvent) {
            throw new Error("Catalogue replay fixture requires a creation event.");
        }
        const withDuplicateEvidence = {
            ...duplicatedCommit,
            activityEvents: [...duplicatedCommit.activityEvents, duplicateEvent]
        };
        const wrongTypeEvidence = prepareActivityEvents([{
            type: "product.updated",
            operationKey: `product.created:${product.id}`,
            productId: product.id,
            productName: product.name,
            before: snapshotProduct(product),
            after: snapshotProduct(product),
            reason: "Wrong event type"
        }], {
            makeId: () => "catalogue-wrong-type-evidence",
            now: () => new Date("2026-02-03T04:05:06.000Z")
        });
        const withWrongTypeEvidence = {
            ...makeEmptyProductCreationState(),
            products: [product],
            activityEvents: wrongTypeEvidence
        };
        const invalidStates = [
            withoutEvidence,
            withDuplicateEvidence,
            withWrongTypeEvidence
        ];

        for (const invalidState of invalidStates) {
            const before = structuredClone(invalidState);
            expect(() => applicationReducer(invalidState, replay)).toThrow();
            expect(invalidState).toEqual(before);
        }
    });

    it("accepts a catalogue replay after later inventory-edit Activity", () => {
        const product = createProductResult().product;
        const originalCreation = makeCatalogueCreationAction(
            product,
            "catalogue-inventory-edit-original",
            "2026-02-03T04:05:06.000Z"
        );
        const created = applicationReducer(
            makeEmptyProductCreationState(),
            originalCreation
        );
        const productVariant = product.variant[0];
        const packagingLevel = productVariant?.packagingHierarchy[0];
        if (!productVariant || !packagingLevel) {
            throw new Error("Catalogue fixture requires a packaging level.");
        }
        const laterBatch = {
            batchId: "catalogue-later-inventory-edit-batch",
            productId: product.id,
            variantId: productVariant.id,
            batchNumber: "LATER-LOT",
            expiryDate: new Date("2028-01-31T00:00:00.000Z")
        };
        const laterRecord = {
            id: "catalogue-later-inventory-edit-record",
            productId: product.id,
            variantId: productVariant.id,
            batchId: laterBatch.batchId,
            stockQuantities: [{
                packagingLevelId: packagingLevel.id,
                quantity: 1
            }]
        };
        const withLaterBatch = applicationReducer(created, {
            type: "inventory.saved",
            inventoryRecords: [...created.inventoryRecords, laterRecord],
            inventoryBatches: [...created.inventoryBatches, laterBatch],
            events: prepareActivityEvents([buildBatchCreatedActivityInput(
                "catalogue-later-inventory-edit",
                product,
                laterBatch,
                laterRecord
            )])
        });
        const replay = makeCatalogueCreationAction(
            product,
            "catalogue-inventory-edit-replay",
            "2027-03-04T05:06:07.000Z"
        );
        const beforeReplay = structuredClone(withLaterBatch);

        expect(applicationReducer(withLaterBatch, replay)).toBe(withLaterBatch);
        expect(withLaterBatch).toEqual(beforeReplay);
        expect(withLaterBatch.inventoryBatches).toContainEqual(laterBatch);
    });

    it("validates catalogue replay against the original snapshot after a legitimate product edit", () => {
        const product = createProductResult().product;
        const originalCreation = makeCatalogueCreationAction(
            product,
            "catalogue-history-original",
            "2026-02-03T04:05:06.000Z"
        );
        const created = applicationReducer(
            makeEmptyProductCreationState(),
            originalCreation
        );
        const updateDraft = createProductUpdateDraft(product);
        updateDraft.name = "Edited catalogue product";
        updateDraft.reason = "Correct the product name";
        const updatedProduct = buildUpdatedProduct(product, updateDraft);
        const updated = applicationReducer(created, {
            type: "product.updated",
            product: updatedProduct,
            events: prepareActivityEvents(buildProductUpdateActivityInputs(
                product,
                updatedProduct,
                [],
                [],
                [],
                "product.updated:catalogue-history-edit",
                updateDraft.reason
            ))
        });
        const replay = makeCatalogueCreationAction(
            product,
            "catalogue-history-replay",
            "2027-03-04T05:06:07.000Z"
        );
        const beforeReplay = structuredClone(updated);

        expect(updated.products[0]?.name).toBe("Edited catalogue product");
        expect(applicationReducer(updated, replay)).toBe(updated);
        expect(updated).toEqual(beforeReplay);
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
        const zeroStockEvent = zeroStockCommitted.activityEvents[0];
        expect(zeroStockEvent?.type).toBe("product.updated");
        if (zeroStockEvent?.type !== "product.updated") {
            throw new Error("Zero-stock update event was not committed.");
        }
        expect(zeroStockEvent.after.variants[0]?.packaging.map(
            (level) => level.packagingLevelId
        )).toContain(newLevel.id);
        expect(zeroStockEvent.inventoryStateAfter?.inventoryRecords).toEqual([]);
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

    it("commits a product update with historical product and inventory snapshots", () => {
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
        const events = prepareActivityEvents(buildProductUpdateActivityInputs(
            original,
            updated,
            state.inventoryRecords,
            state.inventoryRecords,
            state.inventoryBatches,
            "product.updated:test-operation",
            "Updated product details"
        ));
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
            reason: "Updated product details",
            inventoryStateAfter: snapshotProductInventoryState(
                original.id,
                state.inventoryRecords,
                state.inventoryBatches
            )
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
        const events = prepareActivityEvents(buildProductUpdateActivityInputs(
            original,
            updated,
            state.inventoryRecords,
            state.inventoryRecords,
            state.inventoryBatches,
            "product.updated:conversion-change",
            "Update conversion"
        ));

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
        const events = prepareActivityEvents(buildProductUpdateActivityInputs(
            original,
            updated,
            state.inventoryRecords,
            state.inventoryRecords,
            state.inventoryBatches,
            "product.updated:add-variant",
            draft.reason
        ));

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

    it("stores the complete committed product-scoped inventory and batch snapshot", () => {
        const initial = createInitialApplicationState();
        const product = initial.products[0];
        if (!product) {
            throw new Error("Product update fixture requires a product.");
        }
        const batchIndex = initial.inventoryBatches.findIndex(
            (batch) => batch.productId === product.id
        );
        const packagingLevelId =
            product.variant[0]?.packagingHierarchy[0]?.id;
        const batch = initial.inventoryBatches[batchIndex];
        if (batchIndex < 0 || !batch || !packagingLevelId) {
            throw new Error("Product update fixture requires a target batch.");
        }
        const inventoryBatches = initial.inventoryBatches.map(
            (candidate, index) => index === batchIndex
                ? {
                    ...candidate,
                    receivedDate: "2026-02-01T00:00:00.000Z",
                    receivedPricing: {
                        packagingLevelId,
                        sellingPrice: 18
                    }
                }
                : candidate
        );
        const state = { ...initial, inventoryBatches };
        const updatedProduct = { ...product, description: "Snapshot check" };
        const events = prepareActivityEvents(buildProductUpdateActivityInputs(
            product,
            updatedProduct,
            state.inventoryRecords,
            state.inventoryRecords,
            state.inventoryBatches,
            "product.updated:product-scoped-snapshot",
            "Verify historical snapshot"
        ));
        const action = {
            type: "product.updated" as const,
            product: updatedProduct,
            inventoryRecords: state.inventoryRecords,
            inventoryBatches: state.inventoryBatches,
            events
        };

        const committed = applicationReducer(state, action);
        const primaryEvent = committed.activityEvents.find(
            (event) => event.operationKey === "product.updated:product-scoped-snapshot"
        );

        expect(primaryEvent?.type).toBe("product.updated");
        if (primaryEvent?.type !== "product.updated") {
            throw new Error("Product update event was not committed.");
        }
        expect(primaryEvent.inventoryStateAfter).toEqual(
            snapshotProductInventoryState(
                product.id,
                committed.inventoryRecords,
                committed.inventoryBatches
            )
        );
        expect(primaryEvent.inventoryStateAfter?.inventoryRecords.length)
            .toBeGreaterThan(0);
        expect(primaryEvent.inventoryStateAfter?.inventoryBatches.length)
            .toBeGreaterThan(0);
        expect(primaryEvent.inventoryStateAfter?.inventoryRecords.every(
            (record) => record.productId === product.id
        )).toBe(true);
        expect(primaryEvent.inventoryStateAfter?.inventoryBatches.every(
            (batch) => batch.productId === product.id
        )).toBe(true);
        expect(primaryEvent.inventoryStateAfter?.inventoryRecords)
            .toContainEqual(expect.objectContaining({
                id: state.inventoryRecords.find(
                    (record) => record.productId === product.id
                )?.id
            }));
        expect(primaryEvent.inventoryStateAfter?.inventoryRecords.length)
            .toBe(state.inventoryRecords.filter(
                (record) => record.productId === product.id
            ).length);
        expect(primaryEvent.inventoryStateAfter?.inventoryBatches.length)
            .toBe(state.inventoryBatches.filter(
                (batch) => batch.productId === product.id
            ).length);
    });

    it("rejects a forged first-time product inventory snapshot atomically", () => {
        const state = createInitialApplicationState();
        const product = state.products[0];
        if (!product) {
            throw new Error("Product update fixture requires a product.");
        }
        const updatedProduct = { ...product, description: "Snapshot check" };
        const events = prepareActivityEvents(buildProductUpdateActivityInputs(
            product,
            updatedProduct,
            state.inventoryRecords,
            state.inventoryRecords,
            state.inventoryBatches,
            "product.updated:forged-snapshot",
            "Verify historical snapshot"
        ));
        const forgedEvents = events.map((event) =>
            event.type === "product.updated"
                ? {
                    ...event,
                    inventoryStateAfter: {
                        ...event.inventoryStateAfter!,
                        inventoryRecords:
                            event.inventoryStateAfter!.inventoryRecords.map(
                                (record, index) => index === 0
                                    ? {
                                        ...record,
                                        stockQuantities: record.stockQuantities.map(
                                            (stock, stockIndex) => stockIndex === 0
                                                ? { ...stock, quantity: stock.quantity + 1 }
                                                : stock
                                        )
                                    }
                                    : record
                            )
                    }
                }
                : event
        );
        const action = {
            type: "product.updated" as const,
            product: updatedProduct,
            inventoryRecords: state.inventoryRecords,
            inventoryBatches: state.inventoryBatches,
            events: forgedEvents
        };
        const before = structuredClone(state);

        expect(() => applicationReducer(state, action)).toThrow(
            "Product update Activity does not match the committed changes."
        );
        expect(state).toEqual(before);
    });

    it("accepts a product update replay with regenerated event IDs and timestamps", () => {
        const fixture = makeCommittedProductUpdate();
        let eventId = 0;
        const replayEvents = prepareActivityEvents(fixture.activityInputs, {
            makeId: () => `update-replay-${eventId++}`,
            now: () => new Date("2027-04-05T06:07:08.000Z")
        });

        const replayed = applicationReducer(fixture.committed, {
            ...fixture.action,
            events: replayEvents
        });

        expect(replayed).toBe(fixture.committed);
        expect(replayed.activityEvents).toHaveLength(
            fixture.committed.activityEvents.length
        );
    });

    it("rejects product update replay mismatches in submitted product and event evidence atomically", () => {
        const fixture = makeCommittedProductUpdate();
        const originalEvent = fixture.action.events[0];
        if (originalEvent?.type !== "product.updated") {
            throw new Error("Product update fixture requires a primary event.");
        }
        const changedVariant = {
            ...fixture.updatedProduct,
            variant: fixture.updatedProduct.variant.map((productVariant, index) =>
                index === 0
                    ? { ...productVariant, variantName: "Changed variant" }
                    : productVariant
            )
        };
        const changedPackaging = {
            ...fixture.updatedProduct,
            variant: fixture.updatedProduct.variant.map((productVariant, index) =>
                index === 0
                    ? {
                        ...productVariant,
                        packagingHierarchy: productVariant.packagingHierarchy.map(
                            (level, levelIndex) => levelIndex === 0
                                ? {
                                    ...level,
                                    sellingPrice: (level.sellingPrice ?? 0) + 1
                                }
                                : level
                        )
                    }
                    : productVariant
            )
        };
        const candidates = [
            { ...fixture.action, product: { ...fixture.updatedProduct, name: "Changed" } },
            { ...fixture.action, product: changedVariant },
            { ...fixture.action, product: changedPackaging },
            {
                ...fixture.action,
                events: fixture.action.events.map((event) =>
                    event.type === "product.updated"
                        ? { ...event, before: { ...event.before, productName: "Forged" } }
                        : event
                )
            },
            {
                ...fixture.action,
                events: fixture.action.events.map((event) =>
                    event.type === "product.updated"
                        ? { ...event, after: { ...event.after, productName: "Forged" } }
                        : event
                )
            },
            {
                ...fixture.action,
                events: fixture.action.events.map((event) =>
                    event.type === "product.updated"
                        ? { ...event, reason: "Different reason" }
                        : event
                )
            }
        ];
        const before = structuredClone(fixture.committed);

        for (const candidate of candidates) {
            expect(() => applicationReducer(fixture.committed, candidate))
                .toThrow();
            expect(fixture.committed).toEqual(before);
        }
        expect(originalEvent.after).toEqual(snapshotProduct(fixture.updatedProduct));
    });

    it("rejects product update replay inventory and batch mismatches atomically", () => {
        const fixture = makeCommittedProductUpdate();
        const productId = fixture.product.id;
        const recordIndex = fixture.action.inventoryRecords.findIndex(
            (record) => record.productId === productId
        );
        const batchIndex = fixture.action.inventoryBatches.findIndex(
            (batch) => batch.productId === productId
        );
        const targetRecord = fixture.action.inventoryRecords[recordIndex];
        const targetBatch = fixture.action.inventoryBatches[batchIndex];
        if (!targetRecord || !targetBatch) {
            throw new Error("Product update fixture requires inventory and a batch.");
        }
        const candidates = [
            {
                ...fixture.action,
                inventoryRecords: fixture.action.inventoryRecords.map((record, index) =>
                    index === recordIndex
                        ? {
                            ...record,
                            stockQuantities: record.stockQuantities.map(
                                (stock, stockIndex) => stockIndex === 0
                                    ? { ...stock, quantity: stock.quantity + 1 }
                                    : stock
                            )
                        }
                        : record
                )
            },
            {
                ...fixture.action,
                inventoryRecords: fixture.action.inventoryRecords.filter(
                    (_, index) => index !== recordIndex
                )
            },
            {
                ...fixture.action,
                inventoryRecords: [
                    ...fixture.action.inventoryRecords,
                    { ...targetRecord, id: `${targetRecord.id}-extra` }
                ]
            },
            {
                ...fixture.action,
                inventoryRecords: fixture.action.inventoryRecords.map((record, index) =>
                    index === recordIndex
                        ? { ...record, batchId: null }
                        : record
                )
            },
            {
                ...fixture.action,
                inventoryBatches: fixture.action.inventoryBatches.map((batch, index) =>
                    index === batchIndex
                        ? { ...batch, batchNumber: "Forged batch" }
                        : batch
                )
            },
            {
                ...fixture.action,
                inventoryBatches: fixture.action.inventoryBatches.filter(
                    (_, index) => index !== batchIndex
                )
            },
            {
                ...fixture.action,
                inventoryBatches: [
                    ...fixture.action.inventoryBatches,
                    { ...targetBatch, batchId: `${targetBatch.batchId}-extra` }
                ]
            },
            {
                ...fixture.action,
                inventoryBatches: fixture.action.inventoryBatches.map((batch, index) =>
                    index === batchIndex
                        ? { ...batch, variantId: "other-variant" }
                        : batch
                )
            }
        ];
        const before = structuredClone(fixture.committed);

        for (const candidate of candidates) {
            expect(() => applicationReducer(fixture.committed, candidate))
                .toThrow();
            expect(fixture.committed).toEqual(before);
        }
    });

    it("validates the complete stock-adjustment event set for new packaging stock", () => {
        const fixture = makeCommittedPackagingStockUpdate();
        const primaryEvent = fixture.action.events.find(
            (event) => event.type === "product.updated"
        );
        const stockEvent = fixture.action.events.find(
            (event) => event.type === "inventory.stock_adjusted"
        );
        if (
            primaryEvent?.type !== "product.updated" ||
            stockEvent?.type !== "inventory.stock_adjusted"
        ) {
            throw new Error("Packaging stock update fixture requires both event types.");
        }
        expect(fixture.action.events).toHaveLength(2);
        expect(primaryEvent.inventoryStateAfter?.inventoryRecords)
            .toEqual(snapshotProductInventoryState(
                fixture.product.id,
                fixture.inventoryRecords,
                []
            ).inventoryRecords);

        let replayId = 0;
        const validReplayEvents = prepareActivityEvents(fixture.activityInputs, {
            makeId: () => `packaging-stock-replay-${replayId++}`,
            now: () => new Date("2027-04-05T06:07:08.000Z")
        });
        expect(applicationReducer(fixture.committed, {
            ...fixture.action,
            events: validReplayEvents
        })).toBe(fixture.committed);

        const forgedAdjustment = {
            ...stockEvent,
            newQuantity: stockEvent.newQuantity + 1,
            quantityDifference: stockEvent.quantityDifference + 1
        };
        const forgedReference = {
            ...stockEvent,
            inventoryId: `${stockEvent.inventoryId}-forged`
        };
        const forgedPackaging = {
            ...stockEvent,
            packagingLevel: {
                ...stockEvent.packagingLevel,
                packagingLevelId: "forged-packaging"
            }
        };
        const forgedBeforeAfter = {
            ...stockEvent,
            previousQuantity: stockEvent.previousQuantity + 1
        };
        const extraAdjustment = {
            ...stockEvent,
            eventId: "packaging-stock-extra-event",
            operationKey: `${stockEvent.operationKey}:extra`
        };
        const wrongTypeAdjustment = {
            ...primaryEvent,
            eventId: "packaging-stock-wrong-type",
            operationKey: stockEvent.operationKey
        };
        const candidates = [
            { ...fixture.action, events: [primaryEvent] },
            { ...fixture.action, events: [...fixture.action.events, extraAdjustment] },
            { ...fixture.action, events: [...fixture.action.events, stockEvent] },
            {
                ...fixture.action,
                events: fixture.action.events.map((event) =>
                    event.type === "inventory.stock_adjusted"
                        ? forgedAdjustment
                        : event
                )
            },
            {
                ...fixture.action,
                events: fixture.action.events.map((event) =>
                    event.type === "inventory.stock_adjusted"
                        ? forgedReference
                        : event
                )
            },
            {
                ...fixture.action,
                events: fixture.action.events.map((event) =>
                    event.type === "inventory.stock_adjusted"
                        ? forgedPackaging
                        : event
                )
            },
            {
                ...fixture.action,
                events: fixture.action.events.map((event) =>
                    event.type === "inventory.stock_adjusted"
                        ? forgedBeforeAfter
                        : event
                )
            },
            {
                ...fixture.action,
                events: [primaryEvent, wrongTypeAdjustment]
            }
        ];
        const before = structuredClone(fixture.committed);

        for (const candidate of candidates) {
            expect(() => applicationReducer(fixture.committed, candidate))
                .toThrow();
            expect(fixture.committed).toEqual(before);
        }
    });

    it("fails closed for missing, duplicate, wrong-type, or legacy update evidence", () => {
        const fixture = makeCommittedPackagingStockUpdate();
        const primaryEvent = fixture.action.events.find(
            (event) => event.type === "product.updated"
        );
        const stockEvent = fixture.action.events.find(
            (event) => event.type === "inventory.stock_adjusted"
        );
        if (
            primaryEvent?.type !== "product.updated" ||
            stockEvent?.type !== "inventory.stock_adjusted"
        ) {
            throw new Error("Packaging stock update fixture requires both event types.");
        }
        const duplicatePrimary = {
            ...primaryEvent,
            eventId: "duplicate-original-primary"
        };
        const duplicateEvidenceState = {
            ...fixture.committed,
            activityEvents: [...fixture.committed.activityEvents, duplicatePrimary]
        };
        const missingPrimaryState = {
            ...fixture.committed,
            activityEvents: fixture.committed.activityEvents.filter(
                (event) => event.operationKey !== fixture.operationKey
            )
        };
        const wrongTypePrimary = {
            ...stockEvent,
            eventId: "wrong-type-original-primary",
            operationKey: fixture.operationKey
        };
        const wrongTypeState = {
            ...fixture.committed,
            activityEvents: fixture.committed.activityEvents.map((event) =>
                event.operationKey === fixture.operationKey
                    ? wrongTypePrimary
                    : event
            )
        };
        const legacyPrimary = {
            ...primaryEvent,
            inventoryStateAfter: undefined
        };
        const legacyState = {
            ...fixture.committed,
            activityEvents: fixture.committed.activityEvents.map((event) =>
                event.operationKey === fixture.operationKey
                    ? legacyPrimary
                    : event
            )
        };
        const missingStockState = {
            ...fixture.committed,
            activityEvents: fixture.committed.activityEvents.filter(
                (event) => event.operationKey !== stockEvent.operationKey
            )
        };
        const duplicateStockState = {
            ...fixture.committed,
            activityEvents: [
                ...fixture.committed.activityEvents,
                { ...stockEvent, eventId: "duplicate-original-adjustment" }
            ]
        };
        const extraStockState = {
            ...fixture.committed,
            activityEvents: [
                ...fixture.committed.activityEvents,
                {
                    ...stockEvent,
                    eventId: "extra-original-adjustment",
                    operationKey: `${stockEvent.operationKey}:extra`
                }
            ]
        };
        const wrongTypeStockState = {
            ...fixture.committed,
            activityEvents: fixture.committed.activityEvents.map((event) =>
                event.operationKey === stockEvent.operationKey
                    ? {
                        ...primaryEvent,
                        eventId: "wrong-type-original-adjustment",
                        operationKey: stockEvent.operationKey
                    }
                    : event
            )
        };
        const states = [
            duplicateEvidenceState,
            missingPrimaryState,
            wrongTypeState,
            legacyState,
            missingStockState,
            duplicateStockState,
            extraStockState,
            wrongTypeStockState
        ];

        for (const state of states) {
            const before = structuredClone(state);
            expect(() => applicationReducer(state, fixture.action)).toThrow();
            expect(state).toEqual(before);
        }
    });

    it("rejects invalid and duplicate metadata in product update replay events", () => {
        const fixture = makeCommittedPackagingStockUpdate();
        const primaryEvent = fixture.action.events.find(
            (event) => event.type === "product.updated"
        );
        const stockEvent = fixture.action.events.find(
            (event) => event.type === "inventory.stock_adjusted"
        );
        if (
            primaryEvent?.type !== "product.updated" ||
            stockEvent?.type !== "inventory.stock_adjusted"
        ) {
            throw new Error("Packaging stock update fixture requires both event types.");
        }
        const candidates = [
            {
                ...fixture.action,
                events: fixture.action.events.map((event) =>
                    event.type === "inventory.stock_adjusted"
                        ? { ...event, eventId: " " }
                        : event
                )
            },
            {
                ...fixture.action,
                events: fixture.action.events.map((event) =>
                    event.type === "inventory.stock_adjusted"
                        ? { ...event, operationKey: " " }
                        : event
                )
            },
            {
                ...fixture.action,
                events: fixture.action.events.map((event) =>
                    event.type === "inventory.stock_adjusted"
                        ? { ...event, eventId: primaryEvent.eventId }
                        : event
                )
            },
            {
                ...fixture.action,
                events: fixture.action.events.map((event) =>
                    event.type === "inventory.stock_adjusted"
                        ? { ...event, operationKey: primaryEvent.operationKey }
                        : event
                )
            },
            {
                ...fixture.action,
                events: fixture.action.events.map((event) =>
                    event.type === "inventory.stock_adjusted"
                        ? { ...event, occurredAt: "not-a-date" }
                        : event
                )
            },
            {
                ...fixture.action,
                events: fixture.action.events.map((event) =>
                    event.type === "inventory.stock_adjusted"
                        ? { ...event, occurredAt: "2027-04-05T06:07:08Z" }
                        : event
                )
            }
        ];
        const before = structuredClone(fixture.committed);

        for (const candidate of candidates) {
            expect(() => applicationReducer(fixture.committed, candidate))
                .toThrow();
            expect(fixture.committed).toEqual(before);
        }
    });

    it("ignores later unrelated inventory and batch changes during product update replay", () => {
        const fixture = makeCommittedProductUpdate();
        const unrelatedRecordIndex = fixture.committed.inventoryRecords.findIndex(
            (record) => record.productId !== fixture.product.id
        );
        const unrelatedBatchIndex = fixture.committed.inventoryBatches.findIndex(
            (batch) => batch.productId !== fixture.product.id
        );
        if (unrelatedRecordIndex < 0 || unrelatedBatchIndex < 0) {
            throw new Error("Replay fixture requires unrelated inventory and batches.");
        }
        const currentInventory = fixture.committed.inventoryRecords.map(
            (record, index) => index === unrelatedRecordIndex
                ? {
                    ...record,
                    stockQuantities: record.stockQuantities.map((stock, stockIndex) =>
                        stockIndex === 0
                            ? { ...stock, quantity: stock.quantity + 1 }
                            : stock
                    )
                }
                : record
        );
        const currentBatches = fixture.committed.inventoryBatches.map(
            (batch, index) => index === unrelatedBatchIndex
                ? { ...batch, batchNumber: "Unrelated later batch edit" }
                : batch
        );
        const currentState = {
            ...fixture.committed,
            inventoryRecords: currentInventory,
            inventoryBatches: currentBatches
        };
        let eventId = 0;
        const replayEvents = prepareActivityEvents(fixture.activityInputs, {
            makeId: () => `unrelated-replay-${eventId++}`,
            now: () => new Date("2027-04-05T06:07:08.000Z")
        });

        const replayed = applicationReducer(currentState, {
            ...fixture.action,
            inventoryRecords: currentInventory,
            inventoryBatches: currentBatches,
            events: replayEvents
        });

        expect(replayed).toBe(currentState);
        expect(replayed.inventoryRecords).toBe(currentInventory);
        expect(replayed.inventoryBatches).toBe(currentBatches);
    });

    it("replays an earlier product update after later product and inventory changes", () => {
        const fixture = makeCommittedProductUpdate();
        const updatedAgain = {
            ...fixture.updatedProduct,
            description: "A later product update"
        };
        const laterOperationKey = `product.updated:${fixture.product.id}:later`;
        const laterEvents = prepareActivityEvents(buildProductUpdateActivityInputs(
            fixture.updatedProduct,
            updatedAgain,
            fixture.committed.inventoryRecords,
            fixture.committed.inventoryRecords,
            fixture.committed.inventoryBatches,
            laterOperationKey,
            "Update description again"
        ));
        const afterLaterUpdate = applicationReducer(fixture.committed, {
            type: "product.updated",
            product: updatedAgain,
            inventoryRecords: fixture.committed.inventoryRecords,
            inventoryBatches: fixture.committed.inventoryBatches,
            events: laterEvents
        });
        const updatedThird = {
            ...updatedAgain,
            manufacturer: "Updated a second time"
        };
        const secondLaterEvents = prepareActivityEvents(
            buildProductUpdateActivityInputs(
                updatedAgain,
                updatedThird,
                afterLaterUpdate.inventoryRecords,
                afterLaterUpdate.inventoryRecords,
                afterLaterUpdate.inventoryBatches,
                `product.updated:${fixture.product.id}:later-again`,
                "Update manufacturer"
            )
        );
        const afterSecondLaterUpdate = applicationReducer(afterLaterUpdate, {
            type: "product.updated",
            product: updatedThird,
            inventoryRecords: afterLaterUpdate.inventoryRecords,
            inventoryBatches: afterLaterUpdate.inventoryBatches,
            events: secondLaterEvents
        });
        const record = afterSecondLaterUpdate.inventoryRecords.find(
            (candidate) => candidate.productId === fixture.product.id
        );
        const stock = record?.stockQuantities[0];
        if (!record || !stock) {
            throw new Error("Historical replay fixture requires target-product stock.");
        }
        const updatedInventory = afterSecondLaterUpdate.inventoryRecords.map(
            (candidate) => candidate.id === record.id
                ? {
                    ...candidate,
                    stockQuantities: candidate.stockQuantities.map((quantity) =>
                        quantity.packagingLevelId === stock.packagingLevelId
                            ? { ...quantity, quantity: quantity.quantity + 1 }
                            : quantity
                    )
                }
                : candidate
        );
        const inventoryEvents = prepareActivityEvents([buildStockAdjustmentActivityInput({
            id: "later-stock-adjustment",
            inventoryId: record.id,
            productId: record.productId,
            variantId: record.variantId,
            batchId: record.batchId,
            packagingLevelId: stock.packagingLevelId,
            previousQuantity: stock.quantity,
            newQuantity: stock.quantity + 1,
            quantityDifference: 1,
            reason: "Later physical count",
            createdAt: new Date("2027-04-05T06:07:08.000Z")
        }, updatedThird, afterSecondLaterUpdate.inventoryBatches, "later-stock-adjustment")]);
        const afterInventoryChange = applicationReducer(afterSecondLaterUpdate, {
            type: "inventory.saved",
            inventoryRecords: updatedInventory,
            inventoryBatches: afterSecondLaterUpdate.inventoryBatches,
            events: inventoryEvents
        });
        let replayId = 0;
        const replayEvents = prepareActivityEvents(fixture.activityInputs, {
            makeId: () => `historical-replay-${replayId++}`,
            now: () => new Date("2027-04-05T06:07:08.000Z")
        });

        const replayed = applicationReducer(afterInventoryChange, {
            ...fixture.action,
            events: replayEvents
        });

        expect(replayed).toBe(afterInventoryChange);
        expect(replayed.products.find(
            (product) => product.id === fixture.product.id
        )).toMatchObject({
            description: "A later product update",
            manufacturer: "Updated a second time"
        });
        expect(replayed.inventoryRecords).toBe(updatedInventory);
    });

    it("replays an earlier product update after a later target batch change", () => {
        const fixture = makeCommittedProductUpdate();
        const batch = fixture.committed.inventoryBatches.find(
            (candidate) => candidate.productId === fixture.product.id
        );
        if (!batch) {
            throw new Error("Historical replay fixture requires a target-product batch.");
        }
        const updatedBatch = { ...batch, batchNumber: "Later batch correction" };
        const batchInput = buildBatchUpdatedActivityInput(
            "later-batch-edit",
            batch,
            updatedBatch,
            fixture.product,
            "Correct batch number"
        );
        if (!batchInput) {
            throw new Error("Batch correction fixture requires an Activity event.");
        }
        const afterBatchChange = applicationReducer(fixture.committed, {
            type: "inventory.saved",
            inventoryRecords: fixture.committed.inventoryRecords,
            inventoryBatches: fixture.committed.inventoryBatches.map(
                (candidate) => candidate.batchId === batch.batchId
                    ? updatedBatch
                    : candidate
            ),
            events: prepareActivityEvents([batchInput])
        });
        let replayId = 0;
        const replayEvents = prepareActivityEvents(fixture.activityInputs, {
            makeId: () => `batch-history-replay-${replayId++}`,
            now: () => new Date("2027-04-05T06:07:08.000Z")
        });

        const replayed = applicationReducer(afterBatchChange, {
            ...fixture.action,
            events: replayEvents
        });

        expect(replayed).toBe(afterBatchChange);
        expect(replayed.inventoryBatches.find(
            (candidate) => candidate.batchId === batch.batchId
        )?.batchNumber).toBe("Later batch correction");
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
