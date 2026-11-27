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
import type { productStructure } from "./products/productStructure";
import type { inventory } from "./inventory/inventoryStock";
import { adjustInventoryStock } from "./inventory/inventoryAdjustment";
import { aggregateVariantStock } from "./inventory/inventoryAggregation";
import { getAllInventoryDisplay } from "./inventory/inventoryLookup";
import { getVariantLowStockStatus } from "./inventory/lowStock";
import {
    prepareProductRecordDeletionPlan,
    type ProductRecordDeletionRequest
} from "./products/productDeletion";
import {
    addSaleDraftItem,
    createSaleDraft,
    type SaleDraft
} from "./sales/salesDraft";
import {
    addDeliveryDraftItem,
    createDeliveryDraft,
    type DeliveryDraft
} from "./deliveries/deliveryDraft";
import { prepareDeliveryApproval } from "./deliveries/deliveryApproval";
import { removePackagingLevelFromHierarchy } from "./packaging/packagingValidation";
import {
    recommendInventoryByFefo,
    type CompletedSale
} from "./sales/salesEngine";
import {
    completeSale,
    prepareSaleDraft,
    resolveDefaultSellingPrice
} from "./sales/salesEngine";
import { getProductRecordDeletionBlockMessages } from "./products/productDeletion";
import { createProductFromDraft } from "./products/productCreation";
import {
    addPackagingLevelToUpdateDraft,
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
            lowStockThresholdQuantity: "2",
            lowStockThresholdPackagingLevelId: "",
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

function makeMultiEventInventorySaveAction(
    state: ApplicationState,
    operationId: string,
    batchNumber: string,
    newQuantity: number
) {
    const record = state.inventoryRecords[0];
    const batch = state.inventoryBatches[0];
    const product = record
        ? state.products.find((candidate) => candidate.id === record.productId)
        : undefined;
    const stock = record?.stockQuantities[0];
    if (!record || !batch || !product || !stock) {
        throw new Error("Multi-event Inventory replay fixture is incomplete.");
    }

    const updatedBatch = { ...batch, batchNumber };
    const adjustment = adjustInventoryStock(
        product,
        record,
        stock.packagingLevelId,
        newQuantity,
        "Multi-event replay fixture"
    );
    let eventIndex = 0;
    const events = prepareActivityEvents([
        buildBatchUpdatedActivityInput(
            operationId,
            batch,
            updatedBatch,
            product,
            "Multi-event replay fixture"
        )!,
        buildStockAdjustmentActivityInput(
            adjustment.adjustment,
            product,
            state.inventoryBatches,
            operationId
        )
    ], {
        makeId: () => `${operationId}-event-${eventIndex++}`,
        now: () => new Date("2026-03-04T05:06:07.000Z")
    });

    return {
        type: "inventory.saved" as const,
        inventoryRecords: state.inventoryRecords.map((candidate) =>
            candidate.id === record.id
                ? adjustment.updatedInventory
                : candidate
        ),
        inventoryBatches: state.inventoryBatches.map((candidate) =>
            candidate.batchId === batch.batchId ? updatedBatch : candidate
        ),
        events
    };
}

function createApplicationStateWithConfiguredThresholds() {
    const state = createInitialApplicationState();
    return {
        ...state,
        products: state.products.map((product) => ({
            ...product,
            variant: product.variant.map((productVariant) =>
                productVariant.packagingHierarchy.length > 0 &&
                productVariant.lowStockThreshold === undefined
                    ? {
                        ...productVariant,
                        lowStockThreshold: { quantity: 0 }
                    }
                    : productVariant
            )
        }))
    };
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
    const state = createApplicationStateWithConfiguredThresholds();
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

function makeCommittedPackagingStructureUpdate() {
    const result = createProductResult();
    const product = result.product;
    const productVariant = product.variant[0];
    if (!productVariant) {
        throw new Error("Packaging structure fixture requires a variant.");
    }
    const state = {
        ...createInitialApplicationState(),
        products: [product],
        inventoryRecords: result.inventoryRecords,
        inventoryBatches: result.inventoryBatches,
        activityEvents: []
    };
    const draft = addPackagingLevelToUpdateDraft(
        createProductUpdateDraft(product),
        0,
        () => "replay-packaging-level"
    );
    draft.reason = "Add a packaging level";
    draft.variants[0]!.packaging.at(-2)!.quantityofNextLevel = "2";
    draft.variants[0]!.packaging.at(-1)!.name = "Unit";
    const updatedProduct = buildUpdatedProduct(product, draft);
    const operationKey = "product.updated:packaging-structure-replay";
    const reason = draft.reason;
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
        makeId: () => `packaging-structure-original-${eventId++}`,
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
        productVariant,
        updatedProduct,
        inventoryRecords: state.inventoryRecords,
        inventoryBatches: state.inventoryBatches,
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

function makeUnbatchedConversionState() {
    const baseState = makeProductDeletionState();
    const product = baseState.products[0];
    const productVariant = product?.variant[0];
    const box = productVariant?.packagingHierarchy[0];
    if (!product || !productVariant || !box) {
        throw new Error("Unbatched conversion fixture requires a packaged variant.");
    }

    const packId = `${productVariant.id}-conversion-pack`;
    const unitId = `${productVariant.id}-conversion-unit`;
    const convertedProduct: productStructure = {
        ...product,
        variant: product.variant.map((variant) =>
            variant.id === productVariant.id
                ? {
                    ...variant,
                    packagingHierarchy: [{
                        ...box,
                        name: "Box",
                        quantityofNextLevel: 10,
                        nextLevelId: packId
                    }, {
                        id: packId,
                        name: "Pack",
                        costPrice: null,
                        sellingPrice: 3,
                        quantityofNextLevel: 6,
                        nextLevelId: unitId
                    }, {
                        id: unitId,
                        name: "Unit",
                        costPrice: null,
                        sellingPrice: 1,
                        quantityofNextLevel: null,
                        nextLevelId: null
                    }]
                }
                : variant
        )
    };
    const unbatchedRecord: inventory = {
        id: "unbatched-conversion-source",
        productId: product.id,
        variantId: productVariant.id,
        batchId: null,
        stockQuantities: [
            { packagingLevelId: box.id, quantity: 2 },
            { packagingLevelId: packId, quantity: 3 },
            { packagingLevelId: unitId, quantity: 4 }
        ]
    };
    const state: ApplicationState = {
        ...baseState,
        products: [convertedProduct],
        inventoryRecords: [...baseState.inventoryRecords, unbatchedRecord]
    };

    return {
        state,
        product: convertedProduct,
        variantId: productVariant.id,
        unbatchedRecord
    };
}

function makeThresholdDeletionState() {
    const state = makeProductDeletionState();
    const product = state.products[0];
    const productVariant = product?.variant[0];
    const box = productVariant?.packagingHierarchy[0];
    if (!product || !productVariant || !box) {
        throw new Error("Threshold deletion fixture requires a packaged variant.");
    }

    const packId = `${productVariant.id}-pack-level`;
    const cardId = `${productVariant.id}-card-level`;
    const packagingHierarchy = [{
        ...box,
        name: "Box",
        quantityofNextLevel: 10,
        nextLevelId: packId
    }, {
        id: packId,
        name: "Pack",
        costPrice: null,
        sellingPrice: 3,
        quantityofNextLevel: 6,
        nextLevelId: cardId
    }, {
        id: cardId,
        name: "Card",
        costPrice: null,
        sellingPrice: 1,
        quantityofNextLevel: null,
        nextLevelId: null
    }];
    const thresholdVariant = {
        ...productVariant,
        lowStockThreshold: {
            quantity: 2,
            packagingLevelId: box.id
        },
        packagingHierarchy
    };
    const thresholdProduct = {
        ...product,
        variant: product.variant.map((candidate) =>
            candidate.id === productVariant.id ? thresholdVariant : candidate
        )
    };

    return {
        state: { ...state, products: [thresholdProduct] },
        product: thresholdProduct,
        productVariant: thresholdVariant,
        boxId: box.id,
        packId,
        cardId
    };
}

function makeLegacyPackagingRemovalAction(
    state: ApplicationState,
    product: ApplicationState["products"][number],
    variantId: string,
    packagingLevelId: string,
    operationId: string,
    reason: string
) {
    const productVariant = product.variant.find(
        (candidate) => candidate.id === variantId
    );
    const packagingLevel = productVariant?.packagingHierarchy.find(
        (level) => level.id === packagingLevelId
    );
    if (!productVariant || !packagingLevel) {
        throw new Error("Packaging removal fixture requires a matching level.");
    }

    const nextHierarchy = removePackagingLevelFromHierarchy(
        productVariant.packagingHierarchy,
        packagingLevelId
    );
    return {
        type: "product.packaging_removed" as const,
        product,
        variantId,
        packagingLevelId,
        inventoryRecords: state.inventoryRecords.flatMap((record) => {
            if (
                record.productId !== product.id ||
                record.variantId !== variantId ||
                !record.stockQuantities.some(
                    (stock) => stock.packagingLevelId === packagingLevelId
                )
            ) {
                return [record];
            }
            const stockQuantities = record.stockQuantities.filter(
                (stock) => stock.packagingLevelId !== packagingLevelId
            );
            return stockQuantities.length > 0
                ? [{ ...record, stockQuantities }]
                : [];
        }),
        inventoryBatches: state.inventoryBatches.map((batch) =>
            batch.productId !== product.id ||
            batch.variantId !== variantId
                ? batch
                : {
                    ...batch,
                    pricingByPackagingLevel:
                        batch.pricingByPackagingLevel.filter(
                            (pricing) =>
                                pricing.packagingLevelId !== packagingLevelId
                        )
                }
        ),
        events: prepareActivityEvents([buildPackagingRemovalActivityInput(
            operationId,
            product,
            productVariant,
            packagingLevel,
            nextHierarchy,
            state.inventoryRecords,
            state.inventoryBatches,
            reason
        )])
    };
}

function makeProductUpdateAction(
    state: ApplicationState,
    updatedProduct: ApplicationState["products"][number],
    operationKey: string,
    reason: string
) {
    const previousProduct = state.products.find(
        (product) => product.id === updatedProduct.id
    );
    if (!previousProduct) {
        throw new Error("Product update fixture requires a current product.");
    }
    return {
        type: "product.updated" as const,
        product: updatedProduct,
        events: prepareActivityEvents(buildProductUpdateActivityInputs(
            previousProduct,
            updatedProduct,
            state.inventoryRecords,
            state.inventoryRecords,
            state.inventoryBatches,
            operationKey,
            reason
        ))
    };
}

function makeProductDeletionAction(
    state: ApplicationState,
    reason = "Discontinue product"
) {
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
                `product.deleted:${product.id}:test`,
                reason
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

function makeCommittedSaleReplay() {
    const result = createProductResult();
    const productVariant = result.product.variant[0];
    const packagingLevel = productVariant?.packagingHierarchy[0];
    const inventoryRecord = result.inventoryRecords[0];
    if (!productVariant || !packagingLevel || !inventoryRecord) {
        throw new Error("Sale replay fixture requires product inventory.");
    }
    const batch = result.inventoryBatches.find(
        (candidate) => candidate.batchId === inventoryRecord.batchId
    ) ?? null;
    const defaultSellingPrice = resolveDefaultSellingPrice(
        result.product,
        productVariant.id,
        packagingLevel.id,
        batch
    );
    const appliedSellingPrice =
        defaultSellingPrice ?? packagingLevel.sellingPrice;
    if (appliedSellingPrice === null) {
        throw new Error("Sale replay fixture requires a selling price.");
    }
    const createdAt = "2026-03-04T05:06:07.000Z";
    const updatedAt = "2026-03-04T05:06:08.000Z";
    const draft = addSaleDraftItem(
        createSaleDraft({
            makeId: () => "sale-replay-draft",
            now: () => new Date(createdAt)
        }),
        {
            lineId: "sale-replay-line",
            productId: result.product.id,
            variantId: productVariant.id,
            inventoryRecordId: inventoryRecord.id,
            batchId: inventoryRecord.batchId,
            packagingLevelId: packagingLevel.id,
            quantity: 1,
            defaultSellingPrice,
            appliedSellingPrice,
            discountAmount: 0
        },
        updatedAt
    );
    const state: ApplicationState = {
        ...createInitialApplicationState(),
        products: [result.product],
        inventoryRecords: result.inventoryRecords,
        inventoryBatches: result.inventoryBatches,
        activityEvents: [],
        sales: [],
        saleDrafts: [draft]
    };
    const plan = prepareSaleDraft(draft, {
        products: state.products,
        inventoryRecords: state.inventoryRecords,
        inventoryBatches: state.inventoryBatches
    }, {
        now: () => new Date(updatedAt)
    });
    const completion = completeSale(plan, {
        now: () => new Date("2026-03-04T05:06:09.000Z"),
        makeId: () => "sale-replay-sale",
        makeEventId: () => "sale-replay-event"
    });
    const action = {
        type: "sale.completed" as const,
        completion
    };
    const committed = applicationReducer(state, action);

    return { state, action, committed };
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
            expiryDate: "2027-01-01",
            costPrice: null,
            sellingPrice: null
        }]
    };
}

describe("application-level Activity state", () => {
    it("validates Delivery associations for a newly created batch and Inventory record", () => {
        const result = createProductResult();
        const productVariant = result.product.variant[0];
        const packagingLevel = productVariant?.packagingHierarchy[0];
        if (!productVariant || !packagingLevel) {
            throw new Error("New Delivery association fixture is incomplete.");
        }
        const deliveryDraft = addDeliveryDraftItem(
            createDeliveryDraft({
                deliveryDate: "2026-03-05",
                receivedBy: "Pharmacist"
            }, {
                makeId: () => "new-association-delivery",
                now: () => new Date("2026-03-05T09:00:00.000Z")
            }),
            {
                deliveryItemId: "new-association-item",
                productId: result.product.id,
                variantId: productVariant.id,
                packagingLevelId: packagingLevel.id,
                quantity: 2,
                batchNumber: "NEW-LOT",
                expiryDate: "2029-12-31",
                costPrice: null,
                sellingPrice: null
            },
            "2026-03-05T09:01:00.000Z"
        );
        const state: ApplicationState = {
            ...createInitialApplicationState(),
            products: [result.product],
            inventoryRecords: result.inventoryRecords,
            inventoryBatches: result.inventoryBatches,
            activityEvents: [],
            deliveryDrafts: [deliveryDraft]
        };
        let generatedId = 0;
        const plan = prepareDeliveryApproval(
            deliveryDraft,
            state.products,
            state.inventoryRecords,
            state.inventoryBatches,
            {
                makeId: () => ["new-association-batch", "new-association-inventory"][
                    generatedId++
                ] ?? `new-association-extra-${generatedId}`,
                now: () => new Date("2026-03-05T09:02:00.000Z")
            }
        );
        const [event] = prepareActivityEvents([plan.activity], {
            makeId: () => "new-association-event",
            now: () => new Date(plan.draft.updatedAt)
        });
        if (!event) {
            throw new Error("New Delivery association fixture has no Activity event.");
        }

        const committed = applicationReducer(state, {
            type: "delivery.approved",
            plan,
            event
        });

        expect(plan.receivedItemAssociations).toEqual([{
            deliveryItemId: "new-association-item",
            inventoryRecordId: "new-association-inventory",
            batchId: "new-association-batch"
        }]);
        expect(committed.inventoryRecords.some(
            (record) => record.id === "new-association-inventory"
        )).toBe(true);
        expect(committed.deliveryDrafts[0]?.status).toBe("received");
    });

    it("preserves batch pricing and Product defaults during a stock-only adjustment", () => {
        const initial = createInitialApplicationState();
        const record = initial.inventoryRecords[0];
        if (!record || record.batchId === null) {
            throw new Error("Stock adjustment fixture requires a batched record.");
        }
        const product = initial.products.find(
            (candidate) => candidate.id === record.productId
        );
        const productVariant = product?.variant.find(
            (candidate) => candidate.id === record.variantId
        );
        if (!product || !productVariant || productVariant.packagingHierarchy.length < 2) {
            throw new Error("Stock adjustment fixture requires a multi-level product.");
        }
        const batch = initial.inventoryBatches.find(
            (candidate) => candidate.batchId === record.batchId
        );
        if (!batch) {
            throw new Error("Stock adjustment fixture requires a batch.");
        }

        const pricingByPackagingLevel = productVariant.packagingHierarchy.map(
            (level, index) => ({
                packagingLevelId: level.id,
                costPrice: index === 1 ? null : 20 + index,
                sellingPrice: index === 0 ? null : 40 + index
            })
        );
        const pricedBatch = { ...batch, pricingByPackagingLevel };
        const productRecords = initial.inventoryRecords.filter(
            (candidate) => candidate.productId === product.id
        );
        const productBatches = initial.inventoryBatches.filter(
            (candidate) => candidate.productId === product.id
        );
        if (productRecords.length < 2 || productBatches.length < 2) {
            throw new Error("Stock adjustment fixture requires unrelated product stock.");
        }
        const state = {
            ...initial,
            products: [product],
            inventoryRecords: productRecords,
            inventoryBatches: productBatches.map((candidate) =>
                candidate.batchId === batch.batchId ? pricedBatch : candidate
            ),
            activityEvents: []
        };
        const packagingLevel = productVariant.packagingHierarchy[0];
        if (!packagingLevel) {
            throw new Error("Stock adjustment fixture requires a packaging level.");
        }
        const targetStock = record.stockQuantities.find(
            (stock) => stock.packagingLevelId === packagingLevel.id
        );
        if (!targetStock) {
            throw new Error("Stock adjustment fixture requires matching stock.");
        }
        const adjustment = adjustInventoryStock(
            product,
            record,
            packagingLevel.id,
            targetStock.quantity + 1,
            "Physical count"
        );
        const operationId = "stock-only-pricing-preservation";
        const adjustmentEvents = prepareActivityEvents([
            buildStockAdjustmentActivityInput(
                adjustment.adjustment,
                product,
                state.inventoryBatches,
                operationId
            )
        ], {
            makeId: () => "stock-only-pricing-event",
            now: () => new Date("2026-03-04T05:06:07.000Z")
        });
        const [adjustmentEvent] = adjustmentEvents;
        if (adjustmentEvent?.type !== "inventory.stock_adjusted") {
            throw new Error("Stock adjustment Activity was not created.");
        }
        const updatedRecords = state.inventoryRecords.map((candidate) =>
            candidate.id === record.id
                ? adjustment.updatedInventory
                : candidate
        );
        const stateBeforeRejectedSave = structuredClone(state);

        expect(() => applicationReducer(state, {
            type: "inventory.saved",
            inventoryRecords: updatedRecords,
            inventoryBatches: state.inventoryBatches,
            events: [{
            ...adjustmentEvent,
            previousQuantity: adjustmentEvent.previousQuantity + 1
            }]
        })).toThrow("Stock adjustment Activity does not match current quantity.");
        expect(state).toEqual(stateBeforeRejectedSave);

        const committed = applicationReducer(state, {
            type: "inventory.saved",
            inventoryRecords: updatedRecords,
            inventoryBatches: state.inventoryBatches,
            events: adjustmentEvents
        });

        expect(committed.inventoryRecords).toEqual(updatedRecords);
        expect(committed.inventoryRecords.filter(
            (candidate) => candidate.id !== record.id
        )).toEqual(state.inventoryRecords.filter(
            (candidate) => candidate.id !== record.id
        ));
        expect(committed.inventoryBatches).toEqual(state.inventoryBatches);
        expect(committed.inventoryRecords.find(
            (candidate) => candidate.id === record.id
        )?.stockQuantities).toEqual(record.stockQuantities.map((stock) =>
            stock.packagingLevelId === packagingLevel.id
                ? { ...stock, quantity: targetStock.quantity + 1 }
                : stock
        ));
        expect(adjustment.updatedInventory.stockQuantities.find(
            (stock) => stock.packagingLevelId === packagingLevel.id
        )?.quantity).toBe(targetStock.quantity + 1);
        expect(committed.inventoryBatches.find(
            (candidate) => candidate.batchId === batch.batchId
        )?.pricingByPackagingLevel).toEqual(pricingByPackagingLevel);
        expect(pricingByPackagingLevel).toHaveLength(
            productVariant.packagingHierarchy.length
        );
        expect(pricingByPackagingLevel).toContainEqual({
            packagingLevelId: productVariant.packagingHierarchy[1]?.id,
            costPrice: null,
            sellingPrice: 41
        });
        expect(committed.products.find(
            (candidate) => candidate.id === product.id
        )).toEqual(product);
        expect(committed.products).toBe(state.products);
        const committedAdjustmentEvent = committed.activityEvents.find(
            (event) => event.operationKey === adjustmentEvent.operationKey
        );
        if (committedAdjustmentEvent?.type !== "inventory.stock_adjusted") {
            throw new Error("Committed stock adjustment Activity was not found.");
        }
        expect(committedAdjustmentEvent).toMatchObject({
            inventoryId: record.id,
            batch: {
                batchId: batch.batchId,
                pricingByPackagingLevel: pricingByPackagingLevel.map(
                    (pricing) => ({
                        ...pricing,
                        packagingLevelName: productVariant.packagingHierarchy.find(
                            (level) => level.id === pricing.packagingLevelId
                        )?.name
                    })
                )
            },
            packagingLevel: { packagingLevelId: packagingLevel.id },
            previousQuantity: targetStock.quantity,
            newQuantity: targetStock.quantity + 1,
            quantityDifference: 1,
            reason: "Physical count"
        });
    });

    it("replays an exact committed sale without changing state or deducting stock twice", () => {
        const fixture = makeCommittedSaleReplay();
        const beforeInventory = structuredClone(fixture.committed.inventoryRecords);

        const replayed = applicationReducer(fixture.committed, fixture.action);

        expect(replayed).toBe(fixture.committed);
        expect(replayed.inventoryRecords).toEqual(beforeInventory);
        expect(replayed.sales).toHaveLength(1);
        expect(replayed.activityEvents.filter(
            (event) => event.operationKey === "sale.completed:sale-replay-sale"
        )).toHaveLength(1);
        expect(replayed.saleDrafts).toHaveLength(1);
        expect(replayed.saleDrafts[0]).toMatchObject({
            draftId: "sale-replay-draft",
            status: "approved",
            updatedAt: fixture.action.completion.sale.completedAt
        });
    });

    it("rejects a sale replay with a changed completed sale", () => {
        const fixture = makeCommittedSaleReplay();
        const replay = {
            ...fixture.action,
            completion: {
                ...fixture.action.completion,
                sale: {
                    ...fixture.action.completion.sale,
                    finalAmount:
                        fixture.action.completion.sale.finalAmount + 1
                }
            }
        };
        const before = structuredClone(fixture.committed);

        expect(() => applicationReducer(fixture.committed, replay)).toThrow(
            "Sale operation key already exists without a matching completed sale."
        );
        expect(fixture.committed).toEqual(before);
    });

    it("rejects a sale replay with a changed Activity event", () => {
        const fixture = makeCommittedSaleReplay();
        const replay = {
            ...fixture.action,
            completion: {
                ...fixture.action.completion,
                events: fixture.action.completion.events.map((event) =>
                    event.type === "sale.completed"
                        ? { ...event, notes: "Changed Activity evidence" }
                        : event
                )
            }
        };
        const before = structuredClone(fixture.committed);

        expect(() => applicationReducer(fixture.committed, replay)).toThrow(
            "Sale operation key already exists without a matching completed sale."
        );
        expect(fixture.committed).toEqual(before);
    });

    it("rejects a sale replay with changed updated inventory", () => {
        const fixture = makeCommittedSaleReplay();
        const replay = {
            ...fixture.action,
            completion: {
                ...fixture.action.completion,
                updatedInventory:
                    fixture.action.completion.updatedInventory.map((record) => ({
                        ...record,
                        stockQuantities: record.stockQuantities.map(
                            (stock, index) => index === 0
                                ? { ...stock, quantity: stock.quantity + 1 }
                                : stock
                        )
                    }))
            }
        };
        const before = structuredClone(fixture.committed);

        expect(() => applicationReducer(fixture.committed, replay)).toThrow(
            "Sale replay inventory does not match the committed inventory."
        );
        expect(fixture.committed).toEqual(before);
    });

    it("rejects a sale replay with changed expected inventory quantities", () => {
        const fixture = makeCommittedSaleReplay();
        const replay = {
            ...fixture.action,
            completion: {
                ...fixture.action.completion,
                expectedInventory:
                    fixture.action.completion.expectedInventory.map((record) => ({
                        ...record,
                        stockQuantities: record.stockQuantities.map(
                            (stock, index) => index === 0
                                ? { ...stock, quantity: stock.quantity + 1 }
                                : stock
                        )
                    }))
            }
        };
        const before = structuredClone(fixture.committed);

        expect(() => applicationReducer(fixture.committed, replay)).toThrow(
            "Sale replay allocation does not match the committed inventory."
        );
        expect(fixture.committed).toEqual(before);
    });

    it("replays multiple sale lines against the same inventory record", () => {
        const fixture = makeCommittedSaleReplay();
        const draft = fixture.state.saleDrafts[0];
        const draftItem = draft?.items[0];
        if (!draft || !draftItem) {
            throw new Error("Sale replay fixture requires an active draft item.");
        }
        const multiLineDraft = addSaleDraftItem(
            draft,
            { ...draftItem, lineId: "sale-replay-line-2" },
            "2026-03-04T05:06:10.000Z"
        );
        const state = {
            ...fixture.state,
            saleDrafts: [multiLineDraft]
        };
        const plan = prepareSaleDraft(multiLineDraft, {
            products: state.products,
            inventoryRecords: state.inventoryRecords,
            inventoryBatches: state.inventoryBatches
        }, {
            now: () => new Date("2026-03-04T05:06:10.000Z")
        });
        const completion = completeSale(plan, {
            now: () => new Date("2026-03-04T05:06:11.000Z"),
            makeId: () => "sale-replay-multi-line",
            makeEventId: () => "sale-replay-multi-line-event"
        });
        const action = {
            type: "sale.completed" as const,
            completion
        };
        const committed = applicationReducer(state, action);

        expect(completion.expectedInventory).toHaveLength(1);
        expect(completion.updatedInventory).toHaveLength(1);
        expect(committed.inventoryRecords[0]?.stockQuantities[0]?.quantity)
            .toBe(2);
        expect(applicationReducer(committed, action)).toBe(committed);
    });

    it("rejects sale replays with missing or invalid draft evidence", () => {
        const fixture = makeCommittedSaleReplay();
        const missingDraftId = {
            ...fixture.action,
            completion: {
                ...fixture.action.completion,
                draftId: ""
            }
        };
        const invalidExpectedDraft = {
            ...fixture.action,
            completion: {
                ...fixture.action.completion,
                expectedDraft: {
                    ...fixture.action.completion.expectedDraft,
                    status: "approved" as const
                }
            }
        };
        const missingExpectedDraft = {
            ...fixture.action,
            completion: {
                ...fixture.action.completion,
                expectedDraft: undefined
            }
        } as unknown as Parameters<typeof applicationReducer>[1];
        const before = structuredClone(fixture.committed);

        for (const replay of [
            missingDraftId,
            invalidExpectedDraft,
            missingExpectedDraft
        ]) {
            expect(() => applicationReducer(fixture.committed, replay)).toThrow();
            expect(fixture.committed).toEqual(before);
        }
    });

    it("preserves sale pricing history through a Product update and later same-batch delivery", () => {
        const initial = createApplicationStateWithConfiguredThresholds();
        const originalProduct = initial.products[0];
        const productVariant = originalProduct?.variant[0];
        const selectedLevel = productVariant?.packagingHierarchy[0];
        const inventoryRecord = initial.inventoryRecords.find(
            (record) =>
                record.productId === originalProduct?.id &&
                record.variantId === productVariant?.id &&
                record.batchId !== null
        );
        const sourceBatch = inventoryRecord?.batchId
            ? initial.inventoryBatches.find(
                (batch) => batch.batchId === inventoryRecord.batchId
            )
            : undefined;
        if (
            !originalProduct ||
            !productVariant ||
            !selectedLevel ||
            productVariant.packagingHierarchy.length < 2 ||
            !inventoryRecord ||
            !sourceBatch ||
            sourceBatch.batchNumber === null ||
            sourceBatch.expiryDate === null ||
            selectedLevel.sellingPrice === null
        ) {
            throw new Error("Historical pricing fixture requires a numbered multi-level batch.");
        }

        const productDefaultBefore = selectedLevel.sellingPrice;
        const batchExpiryDate = sourceBatch.expiryDate.toISOString().slice(0, 10);
        const batchSellingPriceBefore = productDefaultBefore + 100;
        const initialBatchPricing = productVariant.packagingHierarchy.map(
            (level, index) => ({
                packagingLevelId: level.id,
                costPrice: level.id === selectedLevel.id
                    ? 7
                    : index === 1
                        ? null
                        : 12 + index,
                sellingPrice: level.id === selectedLevel.id
                    ? batchSellingPriceBefore
                    : index === productVariant.packagingHierarchy.length - 1
                        ? null
                        : 20 + index
            })
        );
        const originalBatch = {
            ...sourceBatch,
            pricingByPackagingLevel: initialBatchPricing
        };
        let state: ApplicationState = {
            ...initial,
            inventoryBatches: initial.inventoryBatches.map((batch) =>
                batch.batchId === originalBatch.batchId ? originalBatch : batch
            ),
            activityEvents: [],
            sales: [],
            saleDrafts: [],
            deliveryDrafts: []
        };

        const saleDraftId = "historical-pricing-sale-draft";
        const saleDraft = createSaleDraft({
            makeId: () => saleDraftId,
            now: () => new Date("2026-03-04T05:06:07.000Z")
        });
        state = applicationReducer(state, {
            type: "sale.draft_created",
            draft: saleDraft
        });
        const resolvedBatchPrice = resolveDefaultSellingPrice(
            originalProduct,
            productVariant.id,
            selectedLevel.id,
            originalBatch
        );
        if (resolvedBatchPrice === null) {
            throw new Error("Historical pricing fixture requires a batch price.");
        }
        state = applicationReducer(state, {
            type: "sale.draft_item_added",
            draftId: saleDraftId,
            item: {
                lineId: "historical-pricing-sale-line",
                productId: originalProduct.id,
                variantId: productVariant.id,
                inventoryRecordId: inventoryRecord.id,
                batchId: originalBatch.batchId,
                packagingLevelId: selectedLevel.id,
                quantity: 1,
                defaultSellingPrice: resolvedBatchPrice,
                appliedSellingPrice: resolvedBatchPrice,
                discountAmount: 0
            },
            updatedAt: "2026-03-04T05:06:08.000Z"
        });
        const activeSaleDraft = state.saleDrafts.find(
            (draft) => draft.draftId === saleDraftId
        );
        if (!activeSaleDraft) {
            throw new Error("Historical pricing fixture requires an active sale draft.");
        }
        const saleCompletion = completeSale(
            prepareSaleDraft(activeSaleDraft, {
                products: state.products,
                inventoryRecords: state.inventoryRecords,
                inventoryBatches: state.inventoryBatches
            }, {
                now: () => new Date("2026-03-04T05:06:08.000Z")
            }),
            {
                makeId: () => "historical-pricing-sale",
                makeEventId: () => "historical-pricing-sale-event",
                now: () => new Date("2026-03-04T05:06:09.000Z")
            }
        );
        state = applicationReducer(state, {
            type: "sale.completed",
            completion: saleCompletion
        });

        const completedSale = structuredClone(state.sales[0]);
        const saleEvent = state.activityEvents.find(
            (event) =>
                event.type === "sale.completed" &&
                event.saleId === saleCompletion.sale.saleId
        );
        if (!completedSale || saleEvent?.type !== "sale.completed") {
            throw new Error("Historical pricing fixture requires a completed sale and event.");
        }
        const originalSaleEvent = structuredClone(saleEvent);
        expect(completedSale.items[0]?.appliedSellingPrice)
            .toBe(batchSellingPriceBefore);
        expect(originalSaleEvent.items[0]?.appliedSellingPrice)
            .toBe(batchSellingPriceBefore);

        const productDefaultAfter = productDefaultBefore + 200;
        const updatedProduct = {
            ...originalProduct,
            variant: originalProduct.variant.map((candidate) =>
                candidate.id === productVariant.id
                    ? {
                        ...candidate,
                        packagingHierarchy: candidate.packagingHierarchy.map(
                            (level) => level.id === selectedLevel.id
                                ? { ...level, sellingPrice: productDefaultAfter }
                                : level
                        )
                    }
                    : candidate
            )
        };
        const productUpdateEvents = prepareActivityEvents(
            buildProductUpdateActivityInputs(
                originalProduct,
                updatedProduct,
                state.inventoryRecords,
                state.inventoryRecords,
                state.inventoryBatches,
                "product.updated:historical-pricing-sale",
                "Update default selling price"
            ),
            {
                makeId: () => "historical-pricing-product-update-event",
                now: () => new Date("2026-03-04T05:06:10.000Z")
            }
        );
        state = applicationReducer(state, {
            type: "product.updated",
            product: updatedProduct,
            inventoryRecords: state.inventoryRecords,
            inventoryBatches: state.inventoryBatches,
            events: productUpdateEvents
        });

        const batchAfterProductUpdate = state.inventoryBatches.find(
            (batch) => batch.batchId === originalBatch.batchId
        );
        if (!batchAfterProductUpdate) {
            throw new Error("Product update fixture lost the selected batch.");
        }
        expect(state.products.find(
            (candidate) => candidate.id === originalProduct.id
        )?.variant.find(
            (candidate) => candidate.id === productVariant.id
        )?.packagingHierarchy.find(
            (level) => level.id === selectedLevel.id
        )?.sellingPrice).toBe(productDefaultAfter);
        expect(batchAfterProductUpdate.pricingByPackagingLevel)
            .toEqual(initialBatchPricing);
        expect(state.activityEvents.find(
            (event) =>
                event.type === "sale.completed" &&
                event.saleId === completedSale.saleId
        )).toEqual(originalSaleEvent);

        const priorActivityEvents = structuredClone(state.activityEvents);
        const deliveryId = "historical-pricing-follow-up-delivery";
        const deliveryQuantity = 3;
        const receiptCostPrice = 27;
        const receiptSellingPrice = productDefaultBefore + 300;
        const deliveryDraft = addDeliveryDraftItem(
            createDeliveryDraft({
                deliveryDate: "2026-03-05",
                receivedBy: "Pharmacist",
                supplier: "Supplier"
            }, {
                makeId: () => deliveryId,
                now: () => new Date("2026-03-05T09:00:00.000Z")
            }),
            {
                deliveryItemId: "historical-pricing-delivery-item",
                productId: originalProduct.id,
                variantId: productVariant.id,
                packagingLevelId: selectedLevel.id,
                quantity: deliveryQuantity,
                batchNumber: originalBatch.batchNumber,
                expiryDate: batchExpiryDate,
                costPrice: receiptCostPrice,
                sellingPrice: receiptSellingPrice
            },
            "2026-03-05T09:01:00.000Z"
        );
        state = applicationReducer(state, {
            type: "delivery.draft_created",
            draft: deliveryDraft
        });
        const inventoryBeforeReceipt = state.inventoryRecords.find(
            (record) => record.id === inventoryRecord.id
        );
        const stockBeforeReceipt = inventoryBeforeReceipt?.stockQuantities.find(
            (stock) => stock.packagingLevelId === selectedLevel.id
        );
        if (!inventoryBeforeReceipt || !stockBeforeReceipt) {
            throw new Error("Historical pricing fixture requires selected stock.");
        }
        const approvalPlan = prepareDeliveryApproval(
            deliveryDraft,
            state.products,
            state.inventoryRecords,
            state.inventoryBatches,
            {
                makeId: () => "unused-batch-id",
                now: () => new Date("2026-03-05T09:02:00.000Z")
            }
        );
        const [deliveryEvent] = prepareActivityEvents(
            [approvalPlan.activity],
            {
                makeId: () => "historical-pricing-delivery-event",
                now: () => new Date(approvalPlan.draft.updatedAt)
            }
        );
        if (deliveryEvent?.type !== "delivery.received") {
            throw new Error("Historical pricing fixture requires receipt Activity.");
        }
        const tamperedPlan = {
            ...approvalPlan,
            inventoryBatches: approvalPlan.inventoryBatches.map((batch) =>
                batch.batchId === originalBatch.batchId
                    ? {
                        ...batch,
                        pricingByPackagingLevel:
                            batch.pricingByPackagingLevel.map((pricing) =>
                                pricing.packagingLevelId === selectedLevel.id
                                    ? { ...pricing, sellingPrice: receiptSellingPrice + 1 }
                                    : pricing
                            )
                    }
                    : batch
            )
        };
        const stateBeforeRejectedApproval = structuredClone(state);

        expect(() => applicationReducer(state, {
            type: "delivery.approved",
            plan: tamperedPlan,
            event: deliveryEvent
        })).toThrow("Delivery approval does not match the active draft.");
        expect(state).toEqual(stateBeforeRejectedApproval);

        const tamperedAssociationPlan = {
            ...approvalPlan,
            receivedItemAssociations: approvalPlan.receivedItemAssociations.map(
                (association) => ({
                    ...association,
                    inventoryRecordId: "forged-inventory-id"
                })
            )
        };
        expect(() => applicationReducer(state, {
            type: "delivery.approved",
            plan: tamperedAssociationPlan,
            event: deliveryEvent
        })).toThrow("Delivery approval does not match the active draft.");
        expect(state).toEqual(stateBeforeRejectedApproval);

        state = applicationReducer(state, {
            type: "delivery.approved",
            plan: approvalPlan,
            event: deliveryEvent
        });

        const receivedRecord = state.inventoryRecords.find(
            (record) => record.id === inventoryRecord.id
        );
        const receivedStock = receivedRecord?.stockQuantities.find(
            (stock) => stock.packagingLevelId === selectedLevel.id
        );
        const expectedBatchPricing = initialBatchPricing.map((pricing) =>
            pricing.packagingLevelId === selectedLevel.id
                ? {
                    ...pricing,
                    costPrice: receiptCostPrice,
                    sellingPrice: receiptSellingPrice
                }
                : pricing
        );
        expect(receivedStock?.quantity)
            .toBe(stockBeforeReceipt.quantity + deliveryQuantity);
        expect(receivedRecord?.stockQuantities).toEqual(
            inventoryBeforeReceipt.stockQuantities.map((stock) =>
                stock.packagingLevelId === selectedLevel.id
                    ? { ...stock, quantity: stock.quantity + deliveryQuantity }
                    : stock
            )
        );
        expect(state.inventoryBatches.find(
            (batch) => batch.batchId === originalBatch.batchId
        )?.pricingByPackagingLevel).toEqual(expectedBatchPricing);
        expect(state.products.find(
            (candidate) => candidate.id === originalProduct.id
        )?.variant.find(
            (candidate) => candidate.id === productVariant.id
        )?.packagingHierarchy.find(
            (level) => level.id === selectedLevel.id
        )?.sellingPrice).toBe(productDefaultAfter);

        const saleAfterReceipt = state.sales.find(
            (sale) => sale.saleId === completedSale.saleId
        );
        const saleEventAfterReceipt = state.activityEvents.find(
            (event) =>
                event.type === "sale.completed" &&
                event.saleId === completedSale.saleId
        );
        expect(saleAfterReceipt).toEqual(completedSale);
        expect(saleEventAfterReceipt).toEqual(originalSaleEvent);
        expect(state.activityEvents.slice(0, priorActivityEvents.length))
            .toEqual(priorActivityEvents);
        const historicalSaleItem = completedSale.items[0];
        const historicalSaleBatch = historicalSaleItem?.batch;
        const historicalProductLevel = historicalSaleItem?.product.variants
            .find((candidate) => candidate.variantId === productVariant.id)
            ?.packaging.find((level) => level.packagingLevelId === selectedLevel.id);
        if (!historicalSaleItem || !historicalSaleBatch || !historicalProductLevel) {
            throw new Error("Completed sale is missing its historical pricing snapshots.");
        }
        expect(historicalSaleItem.appliedSellingPrice).toBe(batchSellingPriceBefore);
        expect(historicalProductLevel.sellingPrice).toBe(productDefaultBefore);
        expect(historicalSaleBatch.pricingByPackagingLevel.map(
            (pricing) => ({
                packagingLevelId: pricing.packagingLevelId,
                costPrice: pricing.costPrice,
                sellingPrice: pricing.sellingPrice
            })
        )).toEqual(initialBatchPricing);
        const historicalSaleActivityItem = originalSaleEvent.items[0];
        expect(historicalSaleActivityItem?.appliedSellingPrice)
            .toBe(batchSellingPriceBefore);
        expect(historicalSaleActivityItem?.allocations[0]?.batch?.pricingByPackagingLevel)
            .toEqual(historicalSaleBatch.pricingByPackagingLevel);
        expect(historicalSaleActivityItem?.product.variants
            .find((candidate) => candidate.variantId === productVariant.id)
            ?.packaging.find((level) => level.packagingLevelId === selectedLevel.id)
            ?.sellingPrice).toBe(productDefaultBefore);
        const recordedDelivery = state.activityEvents.find(
            (event) => event.operationKey === `delivery.received:${deliveryId}`
        );
        if (recordedDelivery?.type !== "delivery.received") {
            throw new Error("Approved delivery Activity was not committed.");
        }
        expect(recordedDelivery.items[0]?.pricingAtReceipt).toEqual({
            packagingLevelId: selectedLevel.id,
            costPrice: receiptCostPrice,
            sellingPrice: receiptSellingPrice
        });
        expect(recordedDelivery.items[0]?.batch?.pricingByPackagingLevel)
            .toEqual(expectedBatchPricing.map((pricing) => ({
                ...pricing,
                packagingLevelName: productVariant.packagingHierarchy.find(
                    (level) => level.id === pricing.packagingLevelId
                )?.name
            })));
    });

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
            expiryDate: new Date("2027-01-31T00:00:00.000Z"),
            pricingByPackagingLevel: []
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
                    ...(variant.lowStockThreshold === undefined
                        ? {}
                        : { lowStockThreshold: variant.lowStockThreshold }),
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
            expiryDate: new Date("2028-01-31T00:00:00.000Z"),
            pricingByPackagingLevel: []
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

    it("rejects empty-variant products through both product creation actions atomically", () => {
        const result = createProductResult();
        const product = { ...result.product, variant: [] };
        const state = makeEmptyProductCreationState();
        const before = structuredClone(state);
        const productCreation = makeProductCreationAction(
            { product, inventoryRecords: [], inventoryBatches: [] },
            "empty-variant-product-creation",
            "2026-02-03T04:05:06.000Z"
        );
        const catalogueCreation = makeCatalogueCreationAction(
            product,
            "empty-variant-catalogue-creation",
            "2026-02-03T04:05:06.000Z"
        );

        expect(() => applicationReducer(state, productCreation)).toThrow(
            "Product must contain at least one variant."
        );
        expect(state).toEqual(before);
        expect(() => applicationReducer(state, catalogueCreation)).toThrow(
            "Product must contain at least one variant."
        );
        expect(state).toEqual(before);
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
            expiryDate: new Date("2028-01-01T00:00:00.000Z"),
            pricingByPackagingLevel: []
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
                lowStockThreshold: {
                    quantity: productVariant.lowStockThreshold?.quantity ?? 2,
                    packagingLevelId:
                        productVariant.packagingHierarchy[0].id
                },
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
        const batchWithPackagingPrices = {
            ...baseState.inventoryBatches[0],
            pricingByPackagingLevel: [{
                packagingLevelId: productVariant.packagingHierarchy[0].id,
                costPrice: 1,
                sellingPrice: 2
            }, {
                packagingLevelId: packagingLevel.id,
                costPrice: 3,
                sellingPrice: 5
            }]
        };
        const state = {
            ...baseState,
            products: [updatedProduct],
            inventoryRecords: [retainedStockRecord, removedOnlyStockRecord],
            inventoryBatches: [batchWithPackagingPrices]
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
            inventoryBatches: state.inventoryBatches.map((batch) => ({
                ...batch,
                pricingByPackagingLevel: batch.pricingByPackagingLevel.filter(
                    (pricing) => pricing.packagingLevelId !== packagingLevel.id
                )
            })),
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
        expect(committed.inventoryBatches).toEqual([{
            ...batchWithPackagingPrices,
            pricingByPackagingLevel: [{
                packagingLevelId: productVariant.packagingHierarchy[0].id,
                costPrice: 1,
                sellingPrice: 2
            }]
        }]);
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

    it("rejects legacy packaging removal of an explicitly selected threshold level atomically", () => {
        const fixture = makeThresholdDeletionState();
        const state = fixture.state;
        const action = makeLegacyPackagingRemovalAction(
            state,
            fixture.product,
            fixture.productVariant.id,
            fixture.boxId,
            "legacy-remove-threshold-box",
            "Remove Box"
        );
        const before = structuredClone(state);

        expect(() => applicationReducer(state, action)).toThrow(
            "This packaging level is currently used by the variant's low-stock threshold."
        );
        expect(state).toEqual(before);
        expect(state.products[0].variant[0].lowStockThreshold).toEqual({
            quantity: 2,
            packagingLevelId: fixture.boxId
        });
    });

    it("rejects legacy packaging removal of the implicit lowest threshold level atomically", () => {
        const fixture = makeThresholdDeletionState();
        const defaultThresholdVariant = {
            ...fixture.productVariant,
            lowStockThreshold: { quantity: 2 }
        };
        const product = {
            ...fixture.product,
            variant: fixture.product.variant.map((candidate) =>
                candidate.id === defaultThresholdVariant.id
                    ? defaultThresholdVariant
                    : candidate
            )
        };
        const state = { ...fixture.state, products: [product] };
        const action = makeLegacyPackagingRemovalAction(
            state,
            product,
            defaultThresholdVariant.id,
            fixture.cardId,
            "legacy-remove-default-card",
            "Remove default Card level"
        );
        const before = structuredClone(state);

        expect(() => applicationReducer(state, action)).toThrow(
            "This packaging level is currently used by the variant's low-stock threshold."
        );
        expect(state).toEqual(before);
        expect(state.products[0].variant[0].lowStockThreshold).toEqual({
            quantity: 2
        });
    });

    it("rejects legacy packaging removal when the threshold reference is already dangling", () => {
        const fixture = makeThresholdDeletionState();
        const danglingVariant = {
            ...fixture.productVariant,
            lowStockThreshold: {
                quantity: 2,
                packagingLevelId: "missing-threshold-level"
            }
        };
        const product = {
            ...fixture.product,
            variant: fixture.product.variant.map((candidate) =>
                candidate.id === danglingVariant.id
                    ? danglingVariant
                    : candidate
            )
        };
        const state = { ...fixture.state, products: [product] };
        const action = makeLegacyPackagingRemovalAction(
            state,
            product,
            danglingVariant.id,
            fixture.cardId,
            "legacy-remove-with-dangling-threshold",
            "Remove Card"
        );
        const before = structuredClone(state);

        expect(() => applicationReducer(state, action)).toThrow(
            "Packaging level does not belong to this variant."
        );
        expect(state).toEqual(before);
    });

    it("rejects deletion of a packaging level used by the threshold without mutating the product", () => {
        const fixture = makeThresholdDeletionState();
        const deletion: ProductRecordDeletionRequest = {
            type: "packaging",
            variantId: fixture.productVariant.id,
            packagingLevelId: fixture.boxId,
            reason: "Remove Box",
            operationId: "remove-threshold-box"
        };
        const before = structuredClone(fixture.state);
        const expectedMessage =
            "This packaging level is currently used by the variant's low-stock threshold. Change and save the threshold to another existing packaging level before deleting it.";

        expect(() => prepareProductRecordDeletionPlan(
            fixture.product,
            fixture.state.inventoryRecords,
            fixture.state.inventoryBatches,
            [deletion]
        )).toThrow(expectedMessage);
        expect(fixture.state).toEqual(before);
        expect(fixture.product).toEqual(before.products[0]);
    });

    it("blocks deletion of the implicit lowest-level threshold packaging", () => {
        const fixture = makeThresholdDeletionState();
        const defaultThresholdVariant = {
            ...fixture.productVariant,
            lowStockThreshold: { quantity: 2 }
        };
        const product = {
            ...fixture.product,
            variant: fixture.product.variant.map((candidate) =>
                candidate.id === defaultThresholdVariant.id
                    ? defaultThresholdVariant
                    : candidate
            )
        };
        const deletion: ProductRecordDeletionRequest = {
            type: "packaging",
            variantId: defaultThresholdVariant.id,
            packagingLevelId: fixture.cardId,
            reason: "Remove default level",
            operationId: "remove-default-threshold-level"
        };

        expect(defaultThresholdVariant.lowStockThreshold).toEqual({ quantity: 2 });
        expect(() => prepareProductRecordDeletionPlan(
            product,
            fixture.state.inventoryRecords,
            fixture.state.inventoryBatches,
            [deletion]
        )).toThrow(
            "This packaging level is currently used by the variant's low-stock threshold."
        );
    });

    it("rejects reducer actions that would delete the threshold packaging atomically", () => {
        const fixture = makeThresholdDeletionState();
        const state = fixture.state;
        const product = fixture.product;
        const productVariant = fixture.productVariant;
        const packagingLevel = productVariant.packagingHierarchy.find(
            (level) => level.id === fixture.boxId
        );
        if (!packagingLevel) {
            throw new Error("Threshold deletion fixture requires its Box level.");
        }
        const deletion: ProductRecordDeletionRequest = {
            type: "packaging",
            variantId: productVariant.id,
            packagingLevelId: fixture.boxId,
            reason: "Remove Box",
            operationId: "reducer-remove-threshold-box"
        };
        const nextHierarchy = removePackagingLevelFromHierarchy(
            productVariant.packagingHierarchy,
            fixture.boxId
        );
        const candidateProduct = {
            ...product,
            variant: product.variant.map((candidate) =>
                candidate.id === productVariant.id
                    ? { ...candidate, packagingHierarchy: nextHierarchy }
                    : candidate
            )
        };
        const candidateInventoryRecords = state.inventoryRecords
            .map((record) => ({
                ...record,
                stockQuantities: record.stockQuantities.filter(
                    (stock) => stock.packagingLevelId !== fixture.boxId
                )
            }))
            .filter((record) => record.stockQuantities.length > 0);
        const candidateInventoryBatches = state.inventoryBatches.map((batch) => ({
            ...batch,
            pricingByPackagingLevel: batch.pricingByPackagingLevel.filter(
                (pricing) => pricing.packagingLevelId !== fixture.boxId
            )
        }));
        const action = {
            type: "product.records_deleted" as const,
            productId: product.id,
            deletions: [deletion],
            product: candidateProduct,
            inventoryRecords: candidateInventoryRecords,
            inventoryBatches: candidateInventoryBatches,
            events: prepareActivityEvents([buildPackagingRemovalActivityInput(
                deletion.operationId,
                product,
                productVariant,
                packagingLevel,
                nextHierarchy,
                state.inventoryRecords,
                state.inventoryBatches,
                deletion.reason
            )])
        };
        const before = structuredClone(state);

        expect(() => applicationReducer(state, action)).toThrow(
            "This packaging level is currently used by the variant's low-stock threshold."
        );
        expect(state).toEqual(before);
    });

    it("allows deleting an unreferenced packaging level and preserves a valid threshold", () => {
        const fixture = makeThresholdDeletionState();
        const deletion: ProductRecordDeletionRequest = {
            type: "packaging",
            variantId: fixture.productVariant.id,
            packagingLevelId: fixture.cardId,
            reason: "Remove unused Card level",
            operationId: "remove-unreferenced-card"
        };

        const plan = prepareProductRecordDeletionPlan(
            fixture.product,
            fixture.state.inventoryRecords,
            fixture.state.inventoryBatches,
            [deletion]
        );
        const resultingVariant = plan.product.variant[0];

        expect(resultingVariant.packagingHierarchy.map((level) => level.id))
            .toEqual([fixture.boxId, fixture.packId]);
        expect(resultingVariant.lowStockThreshold).toEqual({
            quantity: 2,
            packagingLevelId: fixture.boxId
        });
        expect(resultingVariant.packagingHierarchy.some(
            (level) => level.id === resultingVariant.lowStockThreshold?.packagingLevelId
        )).toBe(true);
    });

    it("allows deleting the old level after saving another threshold and keeps inventory valid", () => {
        const fixture = makeThresholdDeletionState();
        const savedVariant = {
            ...fixture.productVariant,
            lowStockThreshold: {
                quantity: fixture.productVariant.lowStockThreshold?.quantity ?? 2,
                packagingLevelId: fixture.packId
            }
        };
        const savedProduct = {
            ...fixture.product,
            variant: fixture.product.variant.map((candidate) =>
                candidate.id === savedVariant.id ? savedVariant : candidate
            )
        };
        const inventoryRecords = fixture.state.inventoryRecords.map(
            (record, index) => index === 0
                ? {
                    ...record,
                    stockQuantities: [
                        ...record.stockQuantities,
                        { packagingLevelId: fixture.cardId, quantity: 3 }
                    ]
                }
                : record
        );
        const deletion: ProductRecordDeletionRequest = {
            type: "packaging",
            variantId: savedVariant.id,
            packagingLevelId: fixture.boxId,
            reason: "Remove Box after changing threshold",
            operationId: "remove-box-after-threshold-change"
        };

        const plan = prepareProductRecordDeletionPlan(
            savedProduct,
            inventoryRecords,
            fixture.state.inventoryBatches,
            [deletion]
        );
        const resultingVariant = plan.product.variant[0];
        const validPackagingIds = new Set(
            resultingVariant.packagingHierarchy.map((level) => level.id)
        );
        const thresholdPackagingLevelId =
            resultingVariant.lowStockThreshold?.packagingLevelId;
        const inventoryDisplay = getAllInventoryDisplay(
            plan.inventoryRecords,
            [plan.product],
            plan.inventoryBatches
        );

        expect(resultingVariant.lowStockThreshold).toEqual({
            quantity: 2,
            packagingLevelId: fixture.packId
        });
        expect(thresholdPackagingLevelId).toBe(fixture.packId);
        expect(validPackagingIds.has(thresholdPackagingLevelId ?? "")).toBe(true);
        expect(plan.inventoryRecords.flatMap((record) =>
            record.stockQuantities.map((stock) => stock.packagingLevelId)
        ).every((id) => validPackagingIds.has(id))).toBe(true);
        expect(getVariantLowStockStatus(
            resultingVariant,
            aggregateVariantStock(inventoryDisplay)
        )).toMatchObject({
            thresholdConfigured: true,
            thresholdPackagingLevelId: fixture.packId,
            thresholdQuantity: 2,
            hasStock: true,
            isLowStock: true
        });
    });

    it("rejects a product update that removes the selected level while changing the threshold", () => {
        const fixture = makeThresholdDeletionState();
        const state = {
            ...fixture.state,
            inventoryRecords: [],
            inventoryBatches: []
        };
        const updatedVariant = {
            ...fixture.productVariant,
            lowStockThreshold: {
                quantity: 2,
                packagingLevelId: fixture.packId
            },
            packagingHierarchy: removePackagingLevelFromHierarchy(
                fixture.productVariant.packagingHierarchy,
                fixture.boxId
            )
        };
        const updatedProduct = {
            ...fixture.product,
            variant: fixture.product.variant.map((candidate) =>
                candidate.id === updatedVariant.id ? updatedVariant : candidate
            )
        };
        const action = makeProductUpdateAction(
            state,
            updatedProduct,
            "product.updated:remove-selected-and-remap",
            "Change threshold and remove Box"
        );
        const before = structuredClone(state);

        expect(() => applicationReducer(state, action)).toThrow(
            "This packaging level is currently used by the variant's low-stock threshold."
        );
        expect(state).toEqual(before);
    });

    it("rejects a product update that removes the implicit lowest threshold level", () => {
        const fixture = makeThresholdDeletionState();
        const defaultThresholdVariant = {
            ...fixture.productVariant,
            lowStockThreshold: { quantity: 2 }
        };
        const product = {
            ...fixture.product,
            variant: fixture.product.variant.map((candidate) =>
                candidate.id === defaultThresholdVariant.id
                    ? defaultThresholdVariant
                    : candidate
            )
        };
        const state = {
            ...fixture.state,
            products: [product],
            inventoryRecords: [],
            inventoryBatches: []
        };
        const updatedVariant = {
            ...defaultThresholdVariant,
            packagingHierarchy: removePackagingLevelFromHierarchy(
                defaultThresholdVariant.packagingHierarchy,
                fixture.cardId
            )
        };
        const updatedProduct = {
            ...product,
            variant: product.variant.map((candidate) =>
                candidate.id === updatedVariant.id
                    ? updatedVariant
                    : candidate
            )
        };
        const action = makeProductUpdateAction(
            state,
            updatedProduct,
            "product.updated:remove-default-lowest",
            "Remove current default level"
        );
        const before = structuredClone(state);

        expect(() => applicationReducer(state, action)).toThrow(
            "This packaging level is currently used by the variant's low-stock threshold."
        );
        expect(state).toEqual(before);
    });

    it("allows saving a threshold change before a later packaging deletion", () => {
        const fixture = makeThresholdDeletionState();
        let state: ApplicationState = {
            ...fixture.state,
            inventoryRecords: [],
            inventoryBatches: []
        };
        const changedVariant = {
            ...fixture.productVariant,
            lowStockThreshold: {
                quantity: 2,
                packagingLevelId: fixture.packId
            }
        };
        const changedProduct = {
            ...fixture.product,
            variant: fixture.product.variant.map((candidate) =>
                candidate.id === changedVariant.id ? changedVariant : candidate
            )
        };

        state = applicationReducer(state, makeProductUpdateAction(
            state,
            changedProduct,
            "product.updated:save-pack-threshold-first",
            "Change threshold to Pack"
        ));

        const savedProduct = state.products[0];
        const deletion: ProductRecordDeletionRequest = {
            type: "packaging",
            variantId: changedVariant.id,
            packagingLevelId: fixture.boxId,
            reason: "Remove Box after changing threshold",
            operationId: "remove-box-after-saved-threshold"
        };
        const plan = prepareProductRecordDeletionPlan(
            savedProduct,
            state.inventoryRecords,
            state.inventoryBatches,
            [deletion]
        );
        const committed = applicationReducer(state, {
            type: "product.records_deleted",
            productId: savedProduct.id,
            deletions: [deletion],
            product: plan.product,
            inventoryRecords: plan.inventoryRecords,
            inventoryBatches: plan.inventoryBatches,
            events: prepareActivityEvents(plan.events)
        });

        expect(committed.products[0].variant[0].packagingHierarchy.map(
            (level) => level.id
        )).toEqual([fixture.packId, fixture.cardId]);
        expect(committed.products[0].variant[0].lowStockThreshold).toEqual({
            quantity: 2,
            packagingLevelId: fixture.packId
        });
    });

    it("allows ordinary product updates that retain the selected packaging level", () => {
        const fixture = makeThresholdDeletionState();
        const updatedProduct = {
            ...fixture.product,
            description: "Updated without changing packaging"
        };
        const action = makeProductUpdateAction(
            fixture.state,
            updatedProduct,
            "product.updated:ordinary-product-edit",
            "Update product description"
        );

        const committed = applicationReducer(fixture.state, action);

        expect(committed.products[0].description)
            .toBe("Updated without changing packaging");
        expect(committed.products[0].variant[0].lowStockThreshold).toEqual({
            quantity: 2,
            packagingLevelId: fixture.boxId
        });
        expect(committed.products[0].variant[0].packagingHierarchy)
            .toEqual(fixture.productVariant.packagingHierarchy);
        expect(committed.inventoryRecords).toEqual(fixture.state.inventoryRecords);
        expect(committed.inventoryBatches).toEqual(fixture.state.inventoryBatches);
    });

    it("blocks variant and packaging removal when an active workflow references them", () => {
        const baseState = makeProductDeletionState();
        const originalProduct = baseState.products[0];
        const originalVariant = originalProduct.variant[0];
        const productVariant = {
            ...originalVariant,
            lowStockThreshold: undefined
        };
        const product = {
            ...originalProduct,
            variant: originalProduct.variant.map((candidate) =>
                candidate.id === productVariant.id ? productVariant : candidate
            )
        };
        const state = { ...baseState, products: [product] };
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
            expiryDate: new Date("2028-01-31T00:00:00.000Z"),
            pricingByPackagingLevel: []
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

    it("rejects deletion of the final variant without changing application state", () => {
        const state = makeProductDeletionState();
        const product = state.products[0];
        const productVariant = product?.variant[0];
        if (!product || !productVariant) {
            throw new Error("Final variant deletion fixture requires a variant.");
        }

        const deletion: ProductRecordDeletionRequest = {
            type: "variant",
            variantId: productVariant.id,
            operationId: "remove-final-variant",
            reason: "Discontinue final variant"
        };
        const action = {
            type: "product.records_deleted" as const,
            productId: product.id,
            deletions: [deletion],
            product: { ...product, variant: [] },
            inventoryRecords: [],
            inventoryBatches: [],
            events: prepareActivityEvents([buildVariantRemovalActivityInput(
                deletion.operationId,
                product,
                productVariant,
                state.inventoryRecords,
                state.inventoryBatches,
                deletion.reason
            )])
        };
        const before = structuredClone(state);

        expect(() => applicationReducer(state, action)).toThrow(
            "At least one variant must remain. Add another variant before deleting this one."
        );
        expect(state).toEqual(before);
    });

    it("rejects a multi-deletion save atomically when a later deletion is invalid", () => {
        const baseState = makeProductDeletionState();
        const baseProduct = baseState.products[0];
        const existingVariant = baseProduct?.variant[0];
        if (!baseProduct || !existingVariant) {
            throw new Error("Staged deletion fixture requires an existing variant.");
        }

        const nextVariant = {
            id: "variant-next",
            variantName: "Syrup",
            lowStockThreshold: {
                quantity: 5,
                packagingLevelId: "bottle-next"
            },
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
            products: [product],
            inventoryRecords: [...baseState.inventoryRecords, nextRecord]
        };
        const validDeletion: ProductRecordDeletionRequest = {
            type: "variant",
            variantId: existingVariant.id,
            operationId: "remove-tablets-before-invalid",
            reason: "Remove tablets"
        };
        const invalidDeletion: ProductRecordDeletionRequest = {
            type: "packaging",
            variantId: nextVariant.id,
            packagingLevelId: "bottle-next",
            operationId: "remove-threshold-level",
            reason: "Remove threshold packaging"
        };
        const afterHierarchy = removePackagingLevelFromHierarchy(
            nextVariant.packagingHierarchy,
            invalidDeletion.packagingLevelId
        );
        const thresholdLevel = nextVariant.packagingHierarchy.find(
            (level) => level.id === invalidDeletion.packagingLevelId
        );
        if (!thresholdLevel) {
            throw new Error("Atomic deletion fixture requires its threshold level.");
        }
        const action = {
            type: "product.records_deleted" as const,
            productId: product.id,
            deletions: [validDeletion, invalidDeletion],
            product,
            inventoryRecords: state.inventoryRecords,
            inventoryBatches: state.inventoryBatches,
            events: prepareActivityEvents([
                buildVariantRemovalActivityInput(
                    validDeletion.operationId,
                    product,
                    existingVariant,
                    state.inventoryRecords,
                    state.inventoryBatches,
                    validDeletion.reason
                ),
                buildPackagingRemovalActivityInput(
                    invalidDeletion.operationId,
                    product,
                    nextVariant,
                    thresholdLevel,
                    afterHierarchy,
                    state.inventoryRecords,
                    state.inventoryBatches,
                    invalidDeletion.reason
                )
            ])
        };
        const before = structuredClone(state);

        expect(() => applicationReducer(state, action)).toThrow(
            /currently used by the variant's low-stock threshold/
        );
        expect(state).toEqual(before);
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
        const fixture = makeThresholdDeletionState();
        const productVariant = {
            ...fixture.productVariant,
            lowStockThreshold: {
                quantity: 2,
                packagingLevelId: fixture.packId
            }
        };
        const product = {
            ...fixture.product,
            variant: fixture.product.variant.map((candidate) =>
                candidate.id === productVariant.id ? productVariant : candidate
            )
        };
        const state = { ...fixture.state, products: [product] };
        const level = productVariant.packagingHierarchy.find(
            (candidate) => candidate.id === fixture.boxId
        );
        if (!level) {
            throw new Error("Fixture requires a packaging level.");
        }
        const deletions: ProductRecordDeletionRequest[] = [{
            type: "packaging",
            variantId: productVariant.id,
            packagingLevelId: level.id,
            reason: "Remove obsolete Box",
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

    it("rejects staged deletion combined with retained packaging price edits atomically", () => {
        const baseState = makeProductDeletionState();
        const originalProduct = baseState.products[0];
        const originalVariant = originalProduct.variant[0];
        const originalLevel = originalVariant.packagingHierarchy[0];
        if (!originalLevel) {
            throw new Error("Deletion fixture requires a packaging level.");
        }
        const product = {
            ...originalProduct,
            variant: originalProduct.variant.map((productVariant) =>
                productVariant.id === originalVariant.id
                    ? {
                        ...productVariant,
                        lowStockThreshold: {
                            quantity: 2,
                            packagingLevelId: originalLevel.id
                        },
                        packagingHierarchy: [{
                            ...originalLevel,
                            nextLevelId: "unit",
                            quantityofNextLevel: 10
                        }, {
                            id: "unit",
                            name: "Unit",
                            costPrice: null,
                            sellingPrice: 1.25,
                            quantityofNextLevel: null,
                            nextLevelId: null
                        }]
                    }
                    : productVariant
            )
        };
        const state = { ...baseState, products: [product] };
        const deletion: ProductRecordDeletionRequest = {
            type: "packaging",
            variantId: originalVariant.id,
            packagingLevelId: "unit",
            reason: "Remove obsolete unit",
            operationId: "remove-unit-with-price-edit"
        };
        const plan = prepareProductRecordDeletionPlan(
            product,
            state.inventoryRecords,
            state.inventoryBatches,
            [deletion]
        );
        const updatedProduct = {
            ...plan.product,
            variant: plan.product.variant.map((productVariant) =>
                productVariant.id === originalVariant.id
                    ? {
                        ...productVariant,
                        packagingHierarchy: productVariant.packagingHierarchy.map(
                            (level) => level.id === originalLevel.id
                                ? { ...level, sellingPrice: 16.25 }
                                : level
                        )
                    }
                    : productVariant
            )
        };
        const events = prepareActivityEvents([
            ...plan.events,
            ...buildProductUpdateActivityInputs(
                plan.product,
                updatedProduct,
                plan.inventoryRecords,
                plan.inventoryRecords,
                plan.inventoryBatches,
                "product.updated:deletion-with-price-edit",
                "Update retained packaging price"
            )
        ]);
        const action = {
            type: "product.records_deleted" as const,
            productId: product.id,
            deletions: [deletion],
            product: plan.product,
            updatedProduct,
            inventoryRecords: plan.inventoryRecords,
            inventoryBatches: plan.inventoryBatches,
            events
        };
        const before = structuredClone(state);

        expect(() => applicationReducer(state, action)).toThrow(
            "A product update accompanying deletion must preserve the deletion plan."
        );
        expect(state).toEqual(before);
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
            expiryDate: new Date("2028-01-31T00:00:00.000Z"),
            pricingByPackagingLevel: []
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

        const duplicateNumberedBatch = {
            ...newBatch,
            batchId: "duplicate-numbered-batch"
        };
        const duplicateNumberedRecord = {
            ...newRecord,
            id: "duplicate-numbered-record",
            batchId: duplicateNumberedBatch.batchId
        };
        const duplicateNumberedEvent = prepareActivityEvents([
            buildBatchCreatedActivityInput(
                "duplicate-numbered-batch-create",
                product,
                duplicateNumberedBatch,
                duplicateNumberedRecord
            )
        ]);
        const beforeDuplicateNumbered = structuredClone(committed);
        expect(() => applicationReducer(committed, {
            type: "inventory.saved",
            inventoryRecords: [
                ...committed.inventoryRecords,
                duplicateNumberedRecord
            ],
            inventoryBatches: [
                ...committed.inventoryBatches,
                duplicateNumberedBatch
            ],
            events: duplicateNumberedEvent
        })).toThrow(/collides|Duplicate logical/i);
        expect(committed).toEqual(beforeDuplicateNumbered);

        const noExpiryBatch = {
            ...newBatch,
            batchId: "no-expiry-batch-one",
            batchNumber: null,
            expiryDate: null
        };
        const noExpiryRecord = {
            ...newRecord,
            id: "no-expiry-record-one",
            batchId: noExpiryBatch.batchId
        };
        const noExpiryEvent = prepareActivityEvents([
            buildBatchCreatedActivityInput(
                "no-expiry-batch-create",
                product,
                noExpiryBatch,
                noExpiryRecord
            )
        ]);
        expect(applicationReducer(state, {
            type: "inventory.saved",
            inventoryRecords: [...state.inventoryRecords, noExpiryRecord],
            inventoryBatches: [...state.inventoryBatches, noExpiryBatch],
            events: noExpiryEvent
        }).inventoryBatches).toContainEqual(noExpiryBatch);

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

    it("converts unbatched stock in place, preserves totals, and permits the next batch", () => {
        const { state, product, variantId, unbatchedRecord } =
            makeUnbatchedConversionState();
        const newBatch = {
            batchId: "batch-converted-unbatched",
            productId: product.id,
            variantId,
            batchNumber: "LOT-CONVERTED",
            expiryDate: new Date("2026-08-31T00:00:00.000Z"),
            pricingByPackagingLevel: []
        };
        const convertedRecord = {
            ...unbatchedRecord,
            batchId: newBatch.batchId
        };
        const stockBefore = aggregateVariantStock(getAllInventoryDisplay(
            state.inventoryRecords,
            state.products,
            state.inventoryBatches
        ));
        const conversionAction = {
            type: "inventory.saved" as const,
            inventoryRecords: state.inventoryRecords.map((record) =>
                record.id === unbatchedRecord.id ? convertedRecord : record
            ),
            inventoryBatches: [...state.inventoryBatches, newBatch],
            events: prepareActivityEvents([buildBatchCreatedActivityInput(
                "convert-unbatched-stock",
                product,
                newBatch,
                convertedRecord
            )])
        };

        const converted = applicationReducer(state, conversionAction);
        const stockAfter = aggregateVariantStock(getAllInventoryDisplay(
            converted.inventoryRecords,
            converted.products,
            converted.inventoryBatches
        ));
        expect(converted.inventoryRecords).toHaveLength(state.inventoryRecords.length);
        expect(converted.inventoryRecords).toContainEqual(convertedRecord);
        expect(converted.inventoryRecords).not.toContainEqual(unbatchedRecord);
        expect(converted.inventoryRecords[0]).toEqual(state.inventoryRecords[0]);
        expect(converted.inventoryBatches).toContainEqual(state.inventoryBatches[0]);
        expect(converted.inventoryBatches).toContainEqual(newBatch);
        expect(stockAfter?.stockQuantities).toEqual(stockBefore?.stockQuantities);
        expect(converted.activityEvents).toContainEqual(expect.objectContaining({
            type: "inventory.batch_created",
            source: "inventory_edit",
            inventory: expect.objectContaining({
                inventoryId: unbatchedRecord.id,
                stock: [
                    expect.objectContaining({ quantity: 2 }),
                    expect.objectContaining({ quantity: 3 }),
                    expect.objectContaining({ quantity: 4 })
                ]
            })
        }));

        const fefo = recommendInventoryByFefo(
            product,
            variantId,
            converted.inventoryRecords,
            converted.inventoryBatches,
            new Date("2026-01-01T00:00:00.000Z")
        );
        expect(fefo.unbatched).toEqual([]);
        expect(fefo.batches[0]?.inventoryRecord.id).toBe(unbatchedRecord.id);

        const secondBatch = {
            batchId: "batch-second-after-conversion",
            productId: product.id,
            variantId,
            batchNumber: "LOT-SECOND",
            expiryDate: new Date("2027-08-31T00:00:00.000Z"),
            pricingByPackagingLevel: []
        };
        const secondRecord = {
            id: "inventory-second-after-conversion",
            productId: product.id,
            variantId,
            batchId: secondBatch.batchId,
            stockQuantities: [{
                packagingLevelId: unbatchedRecord.stockQuantities[1].packagingLevelId,
                quantity: 7
            }]
        };
        const secondBatchAction = {
            type: "inventory.saved" as const,
            inventoryRecords: [...converted.inventoryRecords, secondRecord],
            inventoryBatches: [...converted.inventoryBatches, secondBatch],
            events: prepareActivityEvents([buildBatchCreatedActivityInput(
                "add-second-batch",
                product,
                secondBatch,
                secondRecord
            )])
        };

        const withSecondBatch = applicationReducer(converted, secondBatchAction);
        expect(withSecondBatch.inventoryRecords).toContainEqual(convertedRecord);
        expect(withSecondBatch.inventoryRecords).toContainEqual(secondRecord);
        expect(withSecondBatch.inventoryBatches).toContainEqual(newBatch);
        expect(withSecondBatch.inventoryBatches).toContainEqual(secondBatch);
    });

    it("converts zero-stock records and removes converted inventory with its batch", () => {
        const { state, product, variantId, unbatchedRecord } =
            makeUnbatchedConversionState();
        const zeroStockRecord = {
            ...unbatchedRecord,
            stockQuantities: unbatchedRecord.stockQuantities.map((stock) => ({
                ...stock,
                quantity: 0
            }))
        };
        const zeroStockState: ApplicationState = {
            ...state,
            inventoryRecords: state.inventoryRecords.map((record) =>
                record.id === unbatchedRecord.id ? zeroStockRecord : record
            )
        };
        const batch = {
            batchId: "batch-zero-stock-conversion",
            productId: product.id,
            variantId,
            batchNumber: "LOT-ZERO",
            expiryDate: new Date("2028-08-31T00:00:00.000Z"),
            pricingByPackagingLevel: []
        };
        const convertedRecord = {
            ...zeroStockRecord,
            batchId: batch.batchId
        };
        const conversionAction = {
            type: "inventory.saved" as const,
            inventoryRecords: zeroStockState.inventoryRecords.map((record) =>
                record.id === zeroStockRecord.id ? convertedRecord : record
            ),
            inventoryBatches: [...zeroStockState.inventoryBatches, batch],
            events: prepareActivityEvents([buildBatchCreatedActivityInput(
                "convert-zero-stock",
                product,
                batch,
                convertedRecord
            )])
        };
        const stockBefore = aggregateVariantStock(getAllInventoryDisplay(
            zeroStockState.inventoryRecords,
            zeroStockState.products,
            zeroStockState.inventoryBatches
        ));
        const converted = applicationReducer(zeroStockState, conversionAction);
        const stockAfter = aggregateVariantStock(getAllInventoryDisplay(
            converted.inventoryRecords,
            converted.products,
            converted.inventoryBatches
        ));

        expect(converted.inventoryRecords).toHaveLength(
            zeroStockState.inventoryRecords.length
        );
        expect(converted.inventoryRecords).toContainEqual(convertedRecord);
        expect(converted.inventoryRecords).not.toContainEqual(zeroStockRecord);
        expect(converted.inventoryRecords.some(
            (record) =>
                record.id === zeroStockRecord.id && record.batchId === null
        )).toBe(false);
        expect(stockAfter?.stockQuantities).toEqual(stockBefore?.stockQuantities);

        const bypassBatch = {
            ...batch,
            batchId: "batch-zero-stock-bypass"
        };
        const bypassRecord = {
            ...zeroStockRecord,
            id: "inventory-zero-stock-bypass",
            batchId: bypassBatch.batchId
        };
        const bypassAction = {
            type: "inventory.saved" as const,
            inventoryRecords: [...zeroStockState.inventoryRecords, bypassRecord],
            inventoryBatches: [...zeroStockState.inventoryBatches, bypassBatch],
            events: prepareActivityEvents([buildBatchCreatedActivityInput(
                "bypass-zero-stock-conversion",
                product,
                bypassBatch,
                bypassRecord
            )])
        };
        const beforeBypass = structuredClone(zeroStockState);
        expect(() => applicationReducer(zeroStockState, bypassAction)).toThrow(
            /Unbatched inventory must be converted before adding another batch/
        );
        expect(zeroStockState).toEqual(beforeBypass);

        const removalAction = {
            type: "inventory.saved" as const,
            inventoryRecords: converted.inventoryRecords.filter(
                (record) => record.batchId !== batch.batchId
            ),
            inventoryBatches: converted.inventoryBatches.filter(
                (candidate) => candidate.batchId !== batch.batchId
            ),
            events: prepareActivityEvents([buildBatchRemovalActivityInput(
                "delete-zero-stock-conversion",
                product,
                batch,
                converted.inventoryRecords,
                converted.inventoryBatches,
                "Remove converted empty batch"
            )])
        };
        const activeSale = makeSalesDraft(product.id);
        activeSale.items[0].variantId = variantId;
        activeSale.items[0].inventoryRecordId = convertedRecord.id;
        activeSale.items[0].batchId = batch.batchId;
        activeSale.items[0].packagingLevelId =
            zeroStockRecord.stockQuantities[0].packagingLevelId;
        const lockedState = {
            ...converted,
            saleDrafts: [activeSale]
        };
        const beforeLockedDeletion = structuredClone(lockedState);
        expect(() => applicationReducer(lockedState, removalAction)).toThrow(
            /currently in a Sales draft/
        );
        expect(lockedState).toEqual(beforeLockedDeletion);

        const deleted = applicationReducer(converted, removalAction);
        expect(deleted.inventoryRecords).toEqual(
            zeroStockState.inventoryRecords.filter(
                (record) => record.id !== zeroStockRecord.id
            )
        );
        expect(deleted.inventoryBatches).toEqual(zeroStockState.inventoryBatches);
    });

    it("rejects incomplete or stock-changing conversions and enforces the product lock", () => {
        const { state, product, variantId, unbatchedRecord } =
            makeUnbatchedConversionState();
        const batchId = "batch-invalid-conversion";

        function makeConversionAction(options: {
            batchNumber?: string | null;
            expiryDate?: Date | null;
            stockQuantities?: inventory["stockQuantities"];
            reuseSourceRecord?: boolean;
        } = {}) {
            const batch = {
                batchId,
                productId: product.id,
                variantId,
                batchNumber: options.batchNumber === undefined
                    ? "LOT-CONVERTED"
                    : options.batchNumber,
                expiryDate: options.expiryDate === undefined
                    ? new Date("2028-08-31T00:00:00.000Z")
                    : options.expiryDate,
                pricingByPackagingLevel: []
            };
            const record = {
                ...unbatchedRecord,
                id: options.reuseSourceRecord === false
                    ? "inventory-duplicate-conversion"
                    : unbatchedRecord.id,
                batchId: batch.batchId,
                stockQuantities: options.stockQuantities ??
                    unbatchedRecord.stockQuantities
            };
            return {
                type: "inventory.saved" as const,
                inventoryRecords: options.reuseSourceRecord === false
                    ? [...state.inventoryRecords, record]
                    : state.inventoryRecords.map((candidate) =>
                        candidate.id === unbatchedRecord.id ? record : candidate
                    ),
                inventoryBatches: [...state.inventoryBatches, batch],
                events: prepareActivityEvents([buildBatchCreatedActivityInput(
                    `invalid-conversion-${options.batchNumber ?? "missing-number"}`,
                    product,
                    batch,
                    record
                )])
            };
        }

        const changedQuantities = unbatchedRecord.stockQuantities.map(
            (stock, index) => index === 0
                ? { ...stock, quantity: stock.quantity + 1 }
                : stock
        );
        const before = structuredClone(state);

        expect(() => applicationReducer(
            state,
            makeConversionAction({ batchNumber: null })
        )).not.toThrow();
        expect(() => applicationReducer(
            state,
            makeConversionAction({ expiryDate: null })
        )).not.toThrow();
        expect(() => applicationReducer(
            state,
            makeConversionAction({ stockQuantities: changedQuantities })
        )).toThrow(/preserve the existing quantities/);
        expect(() => applicationReducer(
            state,
            makeConversionAction({ reuseSourceRecord: false })
        )).toThrow(/must be converted before adding another batch/);
        expect(state).toEqual(before);

        const lockedState = {
            ...state,
            saleDrafts: [makeSalesDraft(product.id)]
        };
        const lockedBefore = structuredClone(lockedState);
        expect(() => applicationReducer(
            lockedState,
            makeConversionAction()
        )).toThrow(/currently in a Sales draft/);
        expect(lockedState).toEqual(lockedBefore);
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
                expiryDate: new Date("2028-01-31T00:00:00.000Z"),
                pricingByPackagingLevel: []
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
            expiryDate: new Date("2028-01-31T00:00:00.000Z"),
            pricingByPackagingLevel: []
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

    it("rejects Inventory creation of a duplicate unnumbered batch with expiry atomically", () => {
        const state = makeProductDeletionState();
        const product = state.products[0];
        const productVariant = product.variant[0];
        const existingBatch = {
            batchId: "unnumbered-expiry-existing",
            productId: product.id,
            variantId: productVariant.id,
            batchNumber: null,
            expiryDate: new Date("2028-02-29T00:00:00.000Z"),
            pricingByPackagingLevel: []
        };
        const existingRecord = {
            id: "unnumbered-expiry-record",
            productId: product.id,
            variantId: productVariant.id,
            batchId: existingBatch.batchId,
            stockQuantities: [{
                packagingLevelId: productVariant.packagingHierarchy[0].id,
                quantity: 4
            }]
        };
        const duplicateBatch = {
            ...existingBatch,
            batchId: "unnumbered-expiry-duplicate"
        };
        const duplicateRecord = {
            ...existingRecord,
            id: "unnumbered-expiry-duplicate-record",
            batchId: duplicateBatch.batchId
        };
        const duplicateEvent = prepareActivityEvents([
            buildBatchCreatedActivityInput(
                "unnumbered-expiry-create-collision",
                product,
                duplicateBatch,
                duplicateRecord
            )
        ]);
        const stateWithExisting = {
            ...state,
            inventoryRecords: [existingRecord],
            inventoryBatches: [existingBatch]
        };
        const before = structuredClone(stateWithExisting);

        expect(() => applicationReducer(stateWithExisting, {
            type: "inventory.saved",
            inventoryRecords: [existingRecord, duplicateRecord],
            inventoryBatches: [existingBatch, duplicateBatch],
            events: duplicateEvent
        })).toThrow(/collides|logical batch/i);
        expect(stateWithExisting).toEqual(before);
    });

    it("rejects an unnumbered-with-expiry batch metadata collision atomically", () => {
        const state = makeProductDeletionState();
        const product = state.products[0];
        const productVariant = product.variant[0];
        const first = {
            batchId: "unnumbered-expiry-one",
            productId: product.id,
            variantId: productVariant.id,
            batchNumber: null,
            expiryDate: new Date("2028-02-29T00:00:00.000Z"),
            pricingByPackagingLevel: []
        };
        const second = {
            ...first,
            batchId: "unnumbered-expiry-two",
            expiryDate: new Date("2029-03-31T00:00:00.000Z")
        };
        const stateWithTwo = {
            ...state,
            inventoryRecords: [],
            inventoryBatches: [first, second]
        };
        const collidingUpdate = {
            ...second,
            expiryDate: first.expiryDate
        };
        const updateInput = buildBatchUpdatedActivityInput(
            "unnumbered-expiry-update-collision",
            second,
            collidingUpdate,
            product,
            "Correct expiry collision"
        );
        if (!updateInput) {
            throw new Error("Unnumbered expiry update fixture could not be created.");
        }
        const [event] = prepareActivityEvents([updateInput]);
        const before = structuredClone(stateWithTwo);

        expect(() => applicationReducer(stateWithTwo, {
            type: "inventory.saved",
            inventoryRecords: [],
            inventoryBatches: [first, collidingUpdate],
            events: [event]
        })).toThrow(/collides|logical batch/i);
        expect(stateWithTwo).toEqual(before);
        expect(stateWithTwo.inventoryBatches.find(
            (batch) => batch.batchId === second.batchId
        )?.expiryDate).toEqual(second.expiryDate);
        expect(stateWithTwo.inventoryRecords).toEqual([]);
    });

    it("rejects batch metadata edits that collide with another logical identity", () => {
        const state = makeProductDeletionState();
        const product = state.products[0];
        const first = state.inventoryBatches[0];
        const second = {
            ...first,
            batchId: "second-batch",
            batchNumber: "LOT-COLLISION"
        };
        const stateWithSecond = {
            ...state,
            inventoryBatches: [...state.inventoryBatches, second]
        };
        const collidingUpdate = {
            ...second,
            batchNumber: first.batchNumber,
            expiryDate: first.expiryDate
        };
        const updateInput = buildBatchUpdatedActivityInput(
            "batch-update-collision",
            second,
            collidingUpdate,
            product,
            "Attempted collision"
        );
        if (!updateInput) {
            throw new Error("Batch update fixture could not be created.");
        }
        const [event] = prepareActivityEvents([updateInput]);
        const before = structuredClone(stateWithSecond);

        expect(() => applicationReducer(stateWithSecond, {
            type: "inventory.saved",
            inventoryRecords: stateWithSecond.inventoryRecords,
            inventoryBatches: stateWithSecond.inventoryBatches.map((batch) =>
                batch.batchId === second.batchId ? collidingUpdate : batch
            ),
            events: [event]
        })).toThrow(/collides|logical batch/i);
        expect(stateWithSecond).toEqual(before);
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
            expiryDate: new Date("2028-01-01T00:00:00.000Z"),
            pricingByPackagingLevel: []
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
                lowStockThresholdQuantity: "2",
                lowStockThresholdPackagingLevelId: "",
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
            expiryDate: new Date("2028-01-31T00:00:00.000Z"),
            pricingByPackagingLevel: []
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
            lowStockThreshold: { quantity: 2 },
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

        const beforeConflictingReplay = structuredClone(committed);
        const conflictingVariantAction = {
            ...action,
            variant: {
                ...productVariant,
                variantName: "Changed variant metadata"
            },
            events: [{
                ...action.events[0],
                variant: snapshotVariant({
                    ...productVariant,
                    variantName: "Changed variant metadata"
                })
            }]
        };
        expect(() => applicationReducer(committed, conflictingVariantAction))
            .toThrow("Variant replay does not match the previously committed variant.");
        expect(committed).toEqual(beforeConflictingReplay);

        const conflictingEventAction = {
            ...action,
            events: [{
                ...action.events[0],
                reason: "Changed variant reason"
            }]
        };
        expect(() => applicationReducer(committed, conflictingEventAction))
            .toThrow("Variant replay does not match the previously committed variant.");
        expect(committed).toEqual(beforeConflictingReplay);
        expect(committed.products).toEqual(beforeConflictingReplay.products);
        expect(committed.activityEvents).toEqual(beforeConflictingReplay.activityEvents);
    });

    it("saves packaging structure without changing stock or batch expiry", () => {
        const fixture = makeCommittedPackagingStructureUpdate();

        expect(fixture.committed.products[0]?.variant[0]?.packagingHierarchy.map(
            (level) => level.id
        )).toContain("replay-packaging-level");
        expect(fixture.committed.inventoryRecords).toEqual(fixture.inventoryRecords);
        expect(fixture.committed.inventoryBatches).toEqual(fixture.inventoryBatches);
        expect(fixture.committed.inventoryBatches[0]?.expiryDate)
            .toEqual(new Date("2027-01-31"));
        expect(fixture.committed.activityEvents.map((event) => event.type))
            .toEqual(["product.updated"]);

        const changedStock = structuredClone(fixture.inventoryRecords);
        const record = changedStock.find(
            (candidate) => candidate.variantId === fixture.productVariant.id
        );
        if (!record) {
            throw new Error("Packaging structure fixture requires an inventory record.");
        }
        record.stockQuantities[0]!.quantity += 1;
        const before = structuredClone(fixture.committed);

        expect(() => applicationReducer(fixture.committed, {
            ...fixture.action,
            inventoryRecords: changedStock
        })).toThrow(
            "Product update replay does not match the previously committed operation."
        );
        expect(fixture.committed).toEqual(before);
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
        const stockInputs = buildProductUpdateActivityInputs(
            product,
            updatedProduct,
            [],
            [],
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
            inventoryRecords: [{
                id: "forged-inventory",
                productId: product.id,
                variantId: productVariant.id,
                batchId: null,
                stockQuantities: [{
                    packagingLevelId: "failed-packaging-level",
                    quantity: 4
                }]
            }],
            events: prepareActivityEvents(stockInputs)
        };
        expect(() => applicationReducer(stockState, invalidStockAction))
            .toThrow("Product update cannot modify inventory records or batches.");
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

        const beforeConflictingReplay = structuredClone(committed);
        const conflictingQuantity = {
            ...action,
            inventoryRecords: action.inventoryRecords.map((item) =>
                item.id === record.id
                    ? {
                        ...item,
                        stockQuantities: item.stockQuantities.map((stock) =>
                            stock.packagingLevelId === packagingLevel.id
                                ? { ...stock, quantity: 7 }
                                : stock
                        )
                    }
                    : item
            )
        };
        expect(() => applicationReducer(committed, conflictingQuantity))
            .toThrow("Inventory replay payload does not match the committed operation.");
        expect(committed).toEqual(beforeConflictingReplay);

        const conflictingBatch = {
            ...action,
            inventoryBatches: action.inventoryBatches.map((batch) =>
                batch.batchId === record.batchId
                    ? { ...batch, batchNumber: "CHANGED-LOT" }
                    : batch
            )
        };
        expect(() => applicationReducer(committed, conflictingBatch))
            .toThrow("Inventory replay payload does not match the committed operation.");
        expect(committed).toEqual(beforeConflictingReplay);

        const [originalEvent] = events;
        if (!originalEvent) {
            throw new Error("Inventory replay fixture requires an original event.");
        }
        const conflictingEvent = {
            ...action,
            events: [{
                ...originalEvent,
                reason: "Changed physical count reason"
            }]
        };
        expect(() => applicationReducer(committed, conflictingEvent))
            .toThrow("Inventory replay Activity does not match the committed operation.");
        expect(committed).toEqual(beforeConflictingReplay);
        expect(committed.inventoryRecords).toEqual(beforeConflictingReplay.inventoryRecords);
        expect(committed.inventoryBatches).toEqual(beforeConflictingReplay.inventoryBatches);
        expect(committed.activityEvents).toEqual(beforeConflictingReplay.activityEvents);
    });

    it("replays the complete multi-event Inventory save without duplication", () => {
        const fixture = createProductResult();
        const initial = createInitialApplicationState();
        const state: ApplicationState = {
            ...initial,
            products: [fixture.product],
            inventoryRecords: fixture.inventoryRecords,
            inventoryBatches: fixture.inventoryBatches,
            activityEvents: []
        };
        const action = makeMultiEventInventorySaveAction(
            state,
            "multi:event:save",
            "LOT-1-UPDATED",
            5
        );
        const committed = applicationReducer(state, action);
        const replayEvents = action.events.map((event, index) => ({
            ...event,
            eventId: `multi-event-replay-${index}`,
            occurredAt: "2026-03-05T05:06:07.000Z"
        }));

        const replayed = applicationReducer(committed, {
            ...action,
            events: replayEvents
        });

        expect(replayed).toBe(committed);
        expect(replayed.activityEvents).toHaveLength(action.events.length);
        expect(replayed.inventoryRecords).toEqual(action.inventoryRecords);
        expect(replayed.inventoryBatches).toEqual(action.inventoryBatches);
    });

    it("rejects a multi-event Inventory replay that omits a sibling event", () => {
        const fixture = createProductResult();
        const initial = createInitialApplicationState();
        const state: ApplicationState = {
            ...initial,
            products: [fixture.product],
            inventoryRecords: fixture.inventoryRecords,
            inventoryBatches: fixture.inventoryBatches,
            activityEvents: []
        };
        const action = makeMultiEventInventorySaveAction(
            state,
            "multi-event-omitted-sibling",
            "LOT-1-UPDATED",
            5
        );
        const committed = applicationReducer(state, action);
        const beforeConflictingReplay = structuredClone(committed);

        expect(() => applicationReducer(committed, {
            ...action,
            events: [action.events[0]]
        })).toThrow(
            "Inventory replay does not match the complete committed operation."
        );
        expect(committed).toEqual(beforeConflictingReplay);
    });

    it("rejects an extra Inventory event that is not part of the committed save", () => {
        const fixture = createProductResult();
        const initial = createInitialApplicationState();
        const state: ApplicationState = {
            ...initial,
            products: [fixture.product],
            inventoryRecords: fixture.inventoryRecords,
            inventoryBatches: fixture.inventoryBatches,
            activityEvents: []
        };
        const action = makeMultiEventInventorySaveAction(
            state,
            "multi-event-original-save",
            "LOT-1-UPDATED",
            5
        );
        const committed = applicationReducer(state, action);
        const unrelatedAction = makeMultiEventInventorySaveAction(
            state,
            "multi-event-unrelated-save",
            "LOT-1-UNRELATED",
            6
        );
        const beforeConflictingReplay = structuredClone(committed);

        expect(() => applicationReducer(committed, {
            ...action,
            events: [...action.events, ...unrelatedAction.events]
        })).toThrow("Inventory save Activity must share one operation ID.");
        expect(committed).toEqual(beforeConflictingReplay);
    });

    it("rejects replay events mixed from different committed Inventory saves", () => {
        const fixture = createProductResult();
        const initial = createInitialApplicationState();
        const state: ApplicationState = {
            ...initial,
            products: [fixture.product],
            inventoryRecords: fixture.inventoryRecords,
            inventoryBatches: fixture.inventoryBatches,
            activityEvents: []
        };
        const firstAction = makeMultiEventInventorySaveAction(
            state,
            "multi-event-first-save",
            "LOT-1-FIRST",
            5
        );
        const afterFirstSave = applicationReducer(state, firstAction);
        const secondAction = makeMultiEventInventorySaveAction(
            afterFirstSave,
            "multi-event-second-save",
            "LOT-1-SECOND",
            6
        );
        const committed = applicationReducer(afterFirstSave, secondAction);
        const beforeConflictingReplay = structuredClone(committed);

        expect(() => applicationReducer(committed, {
            ...secondAction,
            events: [...firstAction.events, ...secondAction.events]
        })).toThrow(
            "Inventory replay contains invalid or mixed operation evidence."
        );
        expect(committed).toEqual(beforeConflictingReplay);
    });

    it("rejects a new Inventory save with mixed operation IDs atomically", () => {
        const fixture = createProductResult();
        const record = fixture.inventoryRecords[0];
        const batch = fixture.inventoryBatches[0];
        const product = fixture.product;
        const stock = record?.stockQuantities[0];
        if (!record || !batch || !stock) {
            throw new Error("Mixed-operation Inventory fixture is incomplete.");
        }
        const initial = createInitialApplicationState();
        const state: ApplicationState = {
            ...initial,
            products: [product],
            inventoryRecords: fixture.inventoryRecords,
            inventoryBatches: fixture.inventoryBatches,
            activityEvents: []
        };
        const updatedBatch = { ...batch, batchNumber: "LOT-MIXED-UPDATED" };
        const adjustment = adjustInventoryStock(
            product,
            record,
            stock.packagingLevelId,
            stock.quantity + 1,
            "Mixed operation fixture"
        );
        const action = {
            type: "inventory.saved" as const,
            inventoryRecords: state.inventoryRecords.map((candidate) =>
                candidate.id === record.id
                    ? adjustment.updatedInventory
                    : candidate
            ),
            inventoryBatches: state.inventoryBatches.map((candidate) =>
                candidate.batchId === batch.batchId ? updatedBatch : candidate
            ),
            events: prepareActivityEvents([
                buildBatchUpdatedActivityInput(
                    "mixed-operation-A",
                    batch,
                    updatedBatch,
                    product,
                    "Mixed operation fixture"
                )!,
                buildStockAdjustmentActivityInput(
                    adjustment.adjustment,
                    product,
                    state.inventoryBatches,
                    "mixed-operation-B"
                )
            ])
        };
        const beforeRejectedSave = structuredClone(state);

        expect(() => applicationReducer(state, action)).toThrow(
            "Inventory save Activity must share one operation ID."
        );
        expect(state).toEqual(beforeRejectedSave);
    });

    it("rejects empty or malformed Inventory operation IDs atomically", () => {
        const fixture = createProductResult();
        const initial = createInitialApplicationState();
        const state: ApplicationState = {
            ...initial,
            products: [fixture.product],
            inventoryRecords: fixture.inventoryRecords,
            inventoryBatches: fixture.inventoryBatches,
            activityEvents: []
        };
        const emptyOperationAction = makeMultiEventInventorySaveAction(
            state,
            "",
            "LOT-EMPTY-OPERATION",
            5
        );
        const validOperationAction = makeMultiEventInventorySaveAction(
            state,
            "malformed-operation-check",
            "LOT-MALFORMED-OPERATION",
            5
        );
        const malformedOperationAction = {
            ...validOperationAction,
            events: validOperationAction.events.map((event) =>
                event.type === "inventory.batch_updated"
                    ? {
                        ...event,
                        operationKey:
                            "inventory.batch_updated:malformed-operation-check:wrong-batch"
                    }
                    : event
            )
        };
        const beforeRejectedSave = structuredClone(state);

        for (const action of [emptyOperationAction, malformedOperationAction]) {
            expect(() => applicationReducer(state, action)).toThrow(
                "Inventory save Activity contains an invalid operation ID."
            );
            expect(state).toEqual(beforeRejectedSave);
        }
    });

    it("rejects reuse of a committed Inventory operation ID but accepts its exact replay", () => {
        const fixture = createProductResult();
        const originalBatch = fixture.inventoryBatches[0];
        const originalRecord = fixture.inventoryRecords[0];
        if (!originalBatch || !originalRecord) {
            throw new Error("Operation-ID reuse fixture is incomplete.");
        }
        const siblingBatch = {
            ...originalBatch,
            batchId: "operation-reuse-sibling-batch",
            batchNumber: "LOT-REUSE-SIBLING"
        };
        const siblingRecord = {
            ...originalRecord,
            id: "operation-reuse-sibling-inventory",
            batchId: siblingBatch.batchId
        };
        const initial = createInitialApplicationState();
        const state: ApplicationState = {
            ...initial,
            products: [fixture.product],
            inventoryRecords: [...fixture.inventoryRecords, siblingRecord],
            inventoryBatches: [...fixture.inventoryBatches, siblingBatch],
            activityEvents: []
        };
        const operationId = "reused-inventory-operation";
        const makeBatchUpdateAction = (
            currentState: ApplicationState,
            batchId: string,
            batchNumber: string,
            eventId: string
        ) => {
            const batch = currentState.inventoryBatches.find(
                (candidate) => candidate.batchId === batchId
            );
            if (!batch) {
                throw new Error(`Operation-ID reuse batch not found: ${batchId}`);
            }
            const updatedBatch = { ...batch, batchNumber };
            return {
                type: "inventory.saved" as const,
                inventoryRecords: currentState.inventoryRecords,
                inventoryBatches: currentState.inventoryBatches.map((candidate) =>
                    candidate.batchId === batchId ? updatedBatch : candidate
                ),
                events: prepareActivityEvents([
                    buildBatchUpdatedActivityInput(
                        operationId,
                        batch,
                        updatedBatch,
                        fixture.product,
                        "Operation-ID reuse fixture"
                    )!
                ], {
                    makeId: () => eventId,
                    now: () => new Date("2026-03-06T05:06:07.000Z")
                })
            };
        };
        const firstAction = makeBatchUpdateAction(
            state,
            originalBatch.batchId,
            "LOT-REUSE-FIRST",
            "operation-reuse-first-event"
        );
        const committed = applicationReducer(state, firstAction);

        expect(applicationReducer(committed, firstAction)).toBe(committed);

        const secondAction = makeBatchUpdateAction(
            committed,
            siblingBatch.batchId,
            "LOT-REUSE-SECOND",
            "operation-reuse-second-event"
        );
        const beforeRejectedSave = structuredClone(committed);
        expect(() => applicationReducer(committed, secondAction)).toThrow(
            "Inventory save operation ID has already been used."
        );
        expect(committed).toEqual(beforeRejectedSave);
    });

    it("replays batch creation with complete event evidence only", () => {
        const fixture = createProductResult();
        const originalRecord = fixture.inventoryRecords[0];
        const originalBatch = fixture.inventoryBatches[0];
        const stock = originalRecord?.stockQuantities[0];
        if (!originalRecord || !originalBatch || !stock) {
            throw new Error("Batch-creation replay fixture is incomplete.");
        }
        const initial = createInitialApplicationState();
        const state: ApplicationState = {
            ...initial,
            products: [fixture.product],
            inventoryRecords: fixture.inventoryRecords,
            inventoryBatches: fixture.inventoryBatches,
            activityEvents: []
        };
        const createdBatch = {
            ...originalBatch,
            batchId: "batch-created-replay",
            batchNumber: "LOT-CREATED-REPLAY",
            expiryDate: new Date("2028-01-31T00:00:00.000Z")
        };
        const createdRecord = {
            ...originalRecord,
            id: "inventory-created-replay",
            batchId: createdBatch.batchId
        };
        const adjustment = adjustInventoryStock(
            fixture.product,
            originalRecord,
            stock.packagingLevelId,
            stock.quantity + 1,
            "Batch creation replay fixture"
        );
        const operationId = "batch-created-replay-operation";
        const action = {
            type: "inventory.saved" as const,
            inventoryRecords: [
                ...state.inventoryRecords.map((candidate) =>
                    candidate.id === originalRecord.id
                        ? adjustment.updatedInventory
                        : candidate
                ),
                createdRecord
            ],
            inventoryBatches: [...state.inventoryBatches, createdBatch],
            events: prepareActivityEvents([
                buildBatchCreatedActivityInput(
                    operationId,
                    fixture.product,
                    createdBatch,
                    createdRecord
                ),
                buildStockAdjustmentActivityInput(
                    adjustment.adjustment,
                    fixture.product,
                    state.inventoryBatches,
                    operationId
                )
            ])
        };
        const committed = applicationReducer(state, action);

        expect(applicationReducer(committed, action)).toBe(committed);

        const beforeRejectedReplay = structuredClone(committed);
        expect(() => applicationReducer(committed, {
            ...action,
            events: [action.events[0]]
        })).toThrow(
            "Inventory replay does not match the complete committed operation."
        );
        expect(committed).toEqual(beforeRejectedReplay);
    });

    it("replays batch removal with complete event evidence only", () => {
        const fixture = createProductResult();
        const targetBatch = fixture.inventoryBatches[0];
        const targetRecord = fixture.inventoryRecords[0];
        if (!targetBatch || !targetRecord) {
            throw new Error("Batch-removal replay fixture is incomplete.");
        }
        const siblingBatch = {
            ...targetBatch,
            batchId: "batch-removal-replay-sibling",
            batchNumber: "LOT-REMOVAL-SIBLING"
        };
        const siblingRecord = {
            ...targetRecord,
            id: "inventory-removal-replay-sibling",
            batchId: siblingBatch.batchId
        };
        const initial = createInitialApplicationState();
        const state: ApplicationState = {
            ...initial,
            products: [fixture.product],
            inventoryRecords: [...fixture.inventoryRecords, siblingRecord],
            inventoryBatches: [...fixture.inventoryBatches, siblingBatch],
            activityEvents: []
        };
        const stock = siblingRecord.stockQuantities[0];
        if (!stock) {
            throw new Error("Batch-removal replay fixture requires sibling stock.");
        }
        const adjustment = adjustInventoryStock(
            fixture.product,
            siblingRecord,
            stock.packagingLevelId,
            stock.quantity + 1,
            "Batch removal replay fixture"
        );
        const operationId = "batch-removed-replay-operation";
        const action = {
            type: "inventory.saved" as const,
            inventoryRecords: state.inventoryRecords
                .filter((candidate) => candidate.id !== targetRecord.id)
                .map((candidate) =>
                    candidate.id === siblingRecord.id
                        ? adjustment.updatedInventory
                        : candidate
                ),
            inventoryBatches: state.inventoryBatches.filter(
                (candidate) => candidate.batchId !== targetBatch.batchId
            ),
            events: prepareActivityEvents([
                buildBatchRemovalActivityInput(
                    operationId,
                    fixture.product,
                    targetBatch,
                    state.inventoryRecords,
                    state.inventoryBatches,
                    "Remove replay target"
                ),
                buildStockAdjustmentActivityInput(
                    adjustment.adjustment,
                    fixture.product,
                    state.inventoryBatches,
                    operationId
                )
            ])
        };
        const committed = applicationReducer(state, action);

        expect(applicationReducer(committed, action)).toBe(committed);

        const beforeRejectedReplay = structuredClone(committed);
        expect(() => applicationReducer(committed, {
            ...action,
            events: [action.events[0]]
        })).toThrow(
            "Inventory replay does not match the complete committed operation."
        );
        expect(committed).toEqual(beforeRejectedReplay);
    });

    it("rejects duplicated event keys in an Inventory replay atomically", () => {
        const fixture = createProductResult();
        const initial = createInitialApplicationState();
        const state: ApplicationState = {
            ...initial,
            products: [fixture.product],
            inventoryRecords: fixture.inventoryRecords,
            inventoryBatches: fixture.inventoryBatches,
            activityEvents: []
        };
        const action = makeMultiEventInventorySaveAction(
            state,
            "duplicate-replay-event",
            "LOT-DUPLICATE-REPLAY",
            5
        );
        const committed = applicationReducer(state, action);
        const beforeRejectedReplay = structuredClone(committed);

        expect(() => applicationReducer(committed, {
            ...action,
            events: [...action.events, action.events[0]!]
        })).toThrow("Inventory replay contains duplicate operation evidence.");
        expect(committed).toEqual(beforeRejectedReplay);
    });

    it("rejects a valid non-Inventory Activity type in an inventory.saved action", () => {
        const fixture = createProductResult();
        const initial = createInitialApplicationState();
        const state: ApplicationState = {
            ...initial,
            products: [fixture.product],
            inventoryRecords: fixture.inventoryRecords,
            inventoryBatches: fixture.inventoryBatches,
            activityEvents: []
        };
        const action = makeMultiEventInventorySaveAction(
            state,
            "unsupported-event-save",
            "LOT-UNSUPPORTED-EVENT",
            5
        );
        const unsupportedEvent = makeCatalogueCreationAction(
            fixture.product,
            "unsupported-inventory-event",
            "2026-03-07T05:06:07.000Z"
        ).events.find((event) => event.type === "product.created");
        if (!unsupportedEvent) {
            throw new Error("Unsupported-event fixture requires product Activity.");
        }
        const beforeRejectedSave = structuredClone(state);

        expect(() => applicationReducer(state, {
            ...action,
            events: [...action.events, unsupportedEvent]
        })).toThrow(
            "Inventory save Activity contains an invalid operation ID."
        );
        expect(state).toEqual(beforeRejectedSave);
    });

    it("accepts a reordered complete Inventory replay without changing state", () => {
        const fixture = createProductResult();
        const initial = createInitialApplicationState();
        const state: ApplicationState = {
            ...initial,
            products: [fixture.product],
            inventoryRecords: fixture.inventoryRecords,
            inventoryBatches: fixture.inventoryBatches,
            activityEvents: []
        };
        const action = makeMultiEventInventorySaveAction(
            state,
            "reordered-inventory-replay",
            "LOT-REORDERED-REPLAY",
            5
        );
        const committed = applicationReducer(state, action);

        const replayed = applicationReducer(committed, {
            ...action,
            events: [...action.events].reverse()
        });

        expect(replayed).toBe(committed);
        expect(replayed.activityEvents).toHaveLength(action.events.length);
        expect(replayed.inventoryRecords).toEqual(action.inventoryRecords);
        expect(replayed.inventoryBatches).toEqual(action.inventoryBatches);
    });

    it("replays Inventory saves when batch and Inventory IDs contain colons", () => {
        const fixture = createProductResult();
        const originalBatch = fixture.inventoryBatches[0];
        const originalRecord = fixture.inventoryRecords[0];
        if (!originalBatch || !originalRecord) {
            throw new Error("Colon-ID replay fixture is incomplete.");
        }
        const batchId = `${originalBatch.batchId}:lot`;
        const inventoryId = `${originalRecord.id}:stock`;
        const initial = createInitialApplicationState();
        const state: ApplicationState = {
            ...initial,
            products: [fixture.product],
            inventoryRecords: fixture.inventoryRecords.map((record) =>
                record.id === originalRecord.id
                    ? { ...record, id: inventoryId, batchId }
                    : record
            ),
            inventoryBatches: fixture.inventoryBatches.map((batch) =>
                batch.batchId === originalBatch.batchId
                    ? { ...batch, batchId }
                    : batch
            ),
            activityEvents: []
        };
        const action = makeMultiEventInventorySaveAction(
            state,
            "colon:operation:id",
            "LOT-COLON-REPLAY",
            5
        );
        const committed = applicationReducer(state, action);

        expect(applicationReducer(committed, action)).toBe(committed);
        expect(committed.inventoryRecords[0]?.id).toBe(inventoryId);
        expect(committed.inventoryBatches[0]?.batchId).toBe(batchId);
    });

    it("rejects historical Inventory replay after a distinct save changes its payload", () => {
        const fixture = createProductResult();
        const initial = createInitialApplicationState();
        const state: ApplicationState = {
            ...initial,
            products: [fixture.product],
            inventoryRecords: fixture.inventoryRecords,
            inventoryBatches: fixture.inventoryBatches,
            activityEvents: []
        };
        const firstAction = makeMultiEventInventorySaveAction(
            state,
            "historical-replay-first-save",
            "LOT-HISTORICAL-FIRST",
            5
        );
        const afterFirstSave = applicationReducer(state, firstAction);
        const secondAction = makeMultiEventInventorySaveAction(
            afterFirstSave,
            "historical-replay-second-save",
            "LOT-HISTORICAL-SECOND",
            6
        );
        const currentState = applicationReducer(afterFirstSave, secondAction);
        const beforeRejectedReplay = structuredClone(currentState);

        expect(() => applicationReducer(currentState, firstAction)).toThrow(
            "Inventory replay payload does not match the committed operation."
        );
        expect(currentState).toEqual(beforeRejectedReplay);
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
        const state = createApplicationStateWithConfiguredThresholds();
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

    it("rejects updating a valid product to have no variants without changing state", () => {
        const state = createApplicationStateWithConfiguredThresholds();
        const original = state.products[0];
        if (!original) {
            throw new Error("Product update fixture requires a product.");
        }
        const updated = { ...original, variant: [] };
        const action = {
            type: "product.updated" as const,
            product: updated,
            events: prepareActivityEvents(buildProductUpdateActivityInputs(
                original,
                updated,
                state.inventoryRecords,
                state.inventoryRecords,
                state.inventoryBatches,
                `product.updated:${original.id}:remove-all-variants`,
                "Remove all variants"
            ))
        };
        const before = structuredClone(state);

        expect(() => applicationReducer(state, action)).toThrow(
            "Product must contain at least one variant."
        );
        expect(state).toEqual(before);
    });

    it("rejects an unrelated edit that leaves a packaged variant without a threshold", () => {
        const original: productStructure = {
            id: "product-without-threshold",
            name: "Product without threshold",
            variant: [{
                id: "variant-without-threshold",
                variantName: "Packaged variant without threshold",
                packagingHierarchy: [{
                    id: "unit-without-threshold",
                    name: "Unit",
                    costPrice: null,
                    sellingPrice: null,
                    quantityofNextLevel: null,
                    nextLevelId: null
                }]
            }]
        };
        const initialState = createInitialApplicationState();
        const state = {
            ...initialState,
            products: [original],
            inventoryRecords: [],
            inventoryBatches: []
        };
        const updated = {
            ...original,
            description: "Updated without configuring the threshold"
        };
        const events = prepareActivityEvents(buildProductUpdateActivityInputs(
            original,
            updated,
            state.inventoryRecords,
            state.inventoryRecords,
            state.inventoryBatches,
            `product.updated:${original.id}:missing-threshold`,
            "Update product description"
        ));

        expect(() => applicationReducer(state, {
            type: "product.updated",
            product: updated,
            events
        })).toThrow(
            "A low-stock threshold is required for variants with packaging."
        );
    });

    it("keeps all inventory records and batches unchanged when a product conversion changes", () => {
        const initial = createApplicationStateWithConfiguredThresholds();
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
                expiryDate: new Date("2027-01-01"),
                pricingByPackagingLevel: []
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
        const state = createApplicationStateWithConfiguredThresholds();
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
        addedVariant.lowStockThresholdQuantity = "5";
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
            lowStockThreshold: { quantity: 5 },
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
        const state = createApplicationStateWithConfiguredThresholds();
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
        })).toThrow("Product update cannot modify inventory records or batches.");
        expect(() => applicationReducer(state, {
            ...action,
            inventoryRecords: changedExistingStock
        })).toThrow("Product update cannot modify inventory records or batches.");
        expect(() => applicationReducer(state, {
            ...action,
            inventoryRecords: changedUnrelatedStock
        })).toThrow("Product update cannot modify inventory records or batches.");
        expect(() => applicationReducer(state, {
            ...action,
            inventoryBatches: state.inventoryBatches.slice(1)
        })).toThrow("Product update cannot modify inventory records or batches.");
        expect(state).toEqual(before);
    });

    it("stores the complete committed product-scoped inventory and batch snapshot", () => {
        const initial = createApplicationStateWithConfiguredThresholds();
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
                    pricingByPackagingLevel: [{
                        packagingLevelId,
                        costPrice: null,
                        sellingPrice: 18
                    }]
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
        const state = createApplicationStateWithConfiguredThresholds();
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

    it("replays Product Edit structure updates without inventory changes", () => {
        const fixture = makeCommittedPackagingStructureUpdate();
        const primaryEvent = fixture.action.events[0];
        if (primaryEvent?.type !== "product.updated") {
            throw new Error("Packaging structure update fixture requires update Activity.");
        }
        expect(fixture.action.events).toHaveLength(1);

        let replayId = 0;
        const validReplayEvents = prepareActivityEvents(fixture.activityInputs, {
            makeId: () => `packaging-structure-replay-${replayId++}`,
            now: () => new Date("2027-04-05T06:07:08.000Z")
        });
        expect(applicationReducer(fixture.committed, {
            ...fixture.action,
            events: validReplayEvents
        })).toBe(fixture.committed);

        const candidates = [
            { ...fixture.action, events: [] },
            {
                ...fixture.action,
                events: [
                    primaryEvent,
                    { ...primaryEvent, eventId: "duplicate-update-event" }
                ]
            },
            {
                ...fixture.action,
                events: [{ ...primaryEvent, inventoryStateAfter: undefined }]
            },
            {
                ...fixture.action,
                events: [{
                    ...primaryEvent,
                    after: { ...primaryEvent.after, productName: "Forged" }
                }]
            }
        ];
        const before = structuredClone(fixture.committed);
        for (const candidate of candidates) {
            expect(() => applicationReducer(fixture.committed, candidate))
                .toThrow();
            expect(fixture.committed).toEqual(before);
        }
    });

    it("rejects invalid and duplicate metadata in product update replay events", () => {
        const fixture = makeCommittedPackagingStructureUpdate();
        const primaryEvent = fixture.action.events.find(
            (event) => event.type === "product.updated"
        );
        if (primaryEvent?.type !== "product.updated") {
            throw new Error("Packaging structure update fixture requires update Activity.");
        }
        const candidates = [
            {
                ...fixture.action,
                events: fixture.action.events.map((event) =>
                    event.type === "product.updated"
                        ? { ...event, eventId: " " }
                        : event
                )
            },
            {
                ...fixture.action,
                events: fixture.action.events.map((event) =>
                    event.type === "product.updated"
                        ? { ...event, operationKey: " " }
                        : event
                )
            },
            {
                ...fixture.action,
                events: fixture.action.events.map((event) =>
                    event.type === "product.updated"
                        ? { ...event, occurredAt: "not-a-date" }
                        : event
                )
            },
            {
                ...fixture.action,
                events: fixture.action.events.map((event) =>
                    event.type === "product.updated"
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
        expect(event.reason).toBe("Discontinue product");
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

    it.each(["", "  \t "])(
        "rejects whole-product deletion with a blank reason %s",
        (reason) => {
            const state = makeProductDeletionState();
            const action = makeProductDeletionAction(state);
            const [event] = action.events;
            if (event?.type !== "product.deleted") {
                throw new Error("Expected product deletion Activity.");
            }
            const invalidAction = {
                ...action,
                events: [{ ...event, reason }]
            };
            const before = structuredClone(state);

            expect(() => applicationReducer(state, invalidAction)).toThrow(
                "A reason is required to delete a product."
            );
            expect(state).toEqual(before);
        }
    );

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

    it("rejects legacy removal of the final variant without changing application state", () => {
        const state = makeProductDeletionState();
        const product = state.products[0];
        const productVariant = product.variant[0];
        const action = {
            type: "product.variant_removed" as const,
            product,
            variantId: productVariant.id,
            inventoryRecords: state.inventoryRecords.filter(
                (record) => record.variantId !== productVariant.id
            ),
            inventoryBatches: state.inventoryBatches.filter(
                (batch) => batch.variantId !== productVariant.id
            ),
            events: prepareActivityEvents([buildVariantRemovalActivityInput(
                "remove-final-variant-through-legacy-action",
                product,
                productVariant,
                state.inventoryRecords,
                state.inventoryBatches,
                "Discontinue final variant"
            )])
        };
        const before = structuredClone(state);

        expect(() => applicationReducer(state, action)).toThrow(
            "At least one variant must remain. Add another variant before deleting this one."
        );
        expect(state).toEqual(before);
    });
});
