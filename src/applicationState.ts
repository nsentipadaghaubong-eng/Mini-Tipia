import {
    appendActivityEvents,
    buildProductDeletionActivityInput,
    snapshotBatch,
    snapshotPackagingLevel,
    snapshotProduct,
    snapshotVariant,
    type ActivityEvent
} from "./activity/activity";
import type { inventory } from "./inventory/inventoryStock";
import { getStockQuantityOrZero } from "./inventory/inventoryStock";
import type { inventoryBatch } from "./inventory/inventoryBatch";
import { validateInventoryRelationships } from "./inventory/inventoryValidation";
import { demoInventory, demoInventoryBatches, demoProducts } from "./data/demoInventory";
import type { ProductCreationResult } from "./products/productCreation";
import type { productStructure } from "./products/productStructure";
import type { variant } from "./products/productStructure";
import { getPackagingLevelById, getVariantById } from "./products/productValidation";
import { validatePackagingHierarchy } from "./packaging/packagingValidation";
import {
    prepareSaleDraft,
    type CompletedSale,
    type SaleCompletion
} from "./sales/salesEngine";
import {
    addSaleDraftItem,
    cancelSaleDraft,
    removeSaleDraftItem,
    updateSaleDraftDetails,
    updateSaleDraftItem,
    validateSaleDraft,
    type SaleDraft,
    type SaleDraftDetailsChanges,
    type SaleDraftItem,
    type SaleDraftItemChanges
} from "./sales/salesDraft";
import {
    addDeliveryDraftItem,
    removeDeliveryDraftItem,
    updateDeliveryDraftDetails,
    updateDeliveryDraftItem,
    validateDeliveryDraft,
    type DeliveryDraft,
    type DeliveryDraftDetailsChanges,
    type DeliveryDraftItem,
    type DeliveryDraftItemChanges
} from "./deliveries/deliveryDraft";
import type { DeliveryApprovalPlan } from "./deliveries/deliveryApproval";
import { getProductDeletionBlockMessages } from "./products/productDeletion";

export interface ApplicationState {
    products: productStructure[];
    inventoryRecords: inventory[];
    inventoryBatches: inventoryBatch[];
    activityEvents: ActivityEvent[];
    sales: CompletedSale[];
    saleDrafts: SaleDraft[];
    deliveryDrafts: DeliveryDraft[];
}

export type ApplicationAction =
    | {
        type: "product.catalogue_created";
        product: productStructure;
        events: ActivityEvent[];
    }
    | {
        type: "product.variant_added";
        productId: string;
        variant: variant;
        events: ActivityEvent[];
    }
    | {
        type: "product.created";
        result: ProductCreationResult;
        events: ActivityEvent[];
    }
    | {
        type: "product.updated";
        product: productStructure;
        inventoryRecords?: inventory[];
        inventoryBatches?: inventoryBatch[];
        events: ActivityEvent[];
    }
    | {
        type: "product.deleted";
        productId: string;
        events: ActivityEvent[];
    }
    | {
        type: "product.variant_removed";
        product: productStructure;
        variantId: string;
        inventoryRecords: inventory[];
        inventoryBatches: inventoryBatch[];
        events: ActivityEvent[];
    }
    | {
        type: "product.packaging_removed";
        product: productStructure;
        variantId: string;
        packagingLevelId: string;
        inventoryRecords: inventory[];
        inventoryBatches: inventoryBatch[];
        events: ActivityEvent[];
    }
    | {
        type: "inventory.batch_removed";
        productId: string;
        variantId: string;
        batchId: string;
        inventoryRecords: inventory[];
        inventoryBatches: inventoryBatch[];
        events: ActivityEvent[];
    }
    | {
        type: "inventory.saved";
        inventoryRecords: inventory[];
        inventoryBatches: inventoryBatch[];
        events: ActivityEvent[];
    }
    | {
        type: "sale.completed";
        completion: SaleCompletion;
    }
    | {
        type: "sale.draft_created";
        draft: SaleDraft;
    }
    | {
        type: "sale.draft_item_added";
        draftId: string;
        item: SaleDraftItem;
        updatedAt: string;
    }
    | {
        type: "sale.draft_item_updated";
        draftId: string;
        lineId: string;
        changes: SaleDraftItemChanges;
        updatedAt: string;
    }
    | {
        type: "sale.draft_item_removed";
        draftId: string;
        lineId: string;
        updatedAt: string;
    }
    | {
        type: "sale.draft_details_updated";
        draftId: string;
        changes: SaleDraftDetailsChanges;
        updatedAt: string;
    }
    | {
        type: "sale.draft_cancelled";
        draftId: string;
        updatedAt: string;
    }
    | {
        type: "delivery.draft_created";
        draft: DeliveryDraft;
    }
    | {
        type: "delivery.draft_details_updated";
        deliveryId: string;
        changes: DeliveryDraftDetailsChanges;
        updatedAt: string;
    }
    | {
        type: "delivery.draft_item_added";
        deliveryId: string;
        item: DeliveryDraftItem;
        updatedAt: string;
    }
    | {
        type: "delivery.draft_item_updated";
        deliveryId: string;
        deliveryItemId: string;
        changes: DeliveryDraftItemChanges;
        updatedAt: string;
    }
    | {
        type: "delivery.draft_item_removed";
        deliveryId: string;
        deliveryItemId: string;
        updatedAt: string;
    }
    | {
        type: "delivery.approved";
        plan: DeliveryApprovalPlan;
        event: ActivityEvent;
    };

export function createInitialApplicationState(): ApplicationState {
    return {
        products: demoProducts,
        inventoryRecords: demoInventory,
        inventoryBatches: demoInventoryBatches,
        activityEvents: [],
        sales: [],
        saleDrafts: [],
        deliveryDrafts: []
    };
}

export function applicationReducer(
    state: ApplicationState,
    action: ApplicationAction
): ApplicationState {
    switch (action.type) {
        case "product.catalogue_created": {
            const event = action.events[0];
            const operationKey = `product.created:${action.product.id}`;
            if (
                action.events.length !== 1 ||
                event?.type !== "product.created" ||
                event.operationKey !== operationKey ||
                event.initialInventory.length !== 0 ||
                JSON.stringify(event.product) !==
                    JSON.stringify(snapshotProduct(action.product))
            ) {
                throw new Error(
                    "A catalogue product creation requires matching product Activity."
                );
            }
            const alreadyRecorded = state.activityEvents.some(
                (existing) => existing.operationKey === operationKey
            );
            const productAlreadyExists = state.products.some(
                (product) => product.id === action.product.id
            );
            if (alreadyRecorded && productAlreadyExists) {
                return state;
            }

            const existingIds = new Set([
                ...state.products.flatMap((product) => [
                    product.id,
                    ...product.variant.flatMap((item) => [
                        item.id,
                        ...item.packagingHierarchy.map((level) => level.id)
                    ])
                ]),
                ...state.inventoryRecords.map((record) => record.id),
                ...state.inventoryBatches.map((batch) => batch.batchId)
            ]);
            const productIds = [
                action.product.id,
                ...action.product.variant.flatMap((item) => [
                    item.id,
                    ...item.packagingHierarchy.map((level) => level.id)
                ])
            ];
            if (productIds.some((id) => !id.trim() || existingIds.has(id))) {
                throw new Error("Catalogue product contains an invalid or duplicate ID.");
            }
            if (new Set(productIds).size !== productIds.length) {
                throw new Error("Catalogue product contains duplicate IDs.");
            }
            action.product.variant.forEach((item) =>
                validatePackagingHierarchy(item.packagingHierarchy)
            );
            return {
                ...state,
                products: [action.product, ...state.products],
                activityEvents: appendActivityEvents(
                    state.activityEvents,
                    action.events
                )
            };
        }
        case "product.variant_added": {
            const event = action.events[0];
            const operationKey =
                `product.variant_added:${action.productId}:${action.variant.id}`;
            if (
                action.events.length !== 1 ||
                event?.type !== "product.variant_added" ||
                event.operationKey !== operationKey ||
                event.productId !== action.productId ||
                JSON.stringify(event.variant) !==
                    JSON.stringify(snapshotVariant(action.variant))
            ) {
                throw new Error(
                    "A variant creation requires matching variant Activity."
                );
            }
            const productIndex = state.products.findIndex(
                (product) => product.id === action.productId
            );
            if (productIndex === -1) {
                throw new Error(`Product not found: ${action.productId}`);
            }
            const product = state.products[productIndex];
            const variantAlreadyExists = product.variant.some(
                (productVariant) => productVariant.id === action.variant.id
            );
            const alreadyRecorded = state.activityEvents.some(
                (existing) => existing.operationKey === operationKey
            );
            if (alreadyRecorded && variantAlreadyExists) {
                return state;
            }
            if (event.productName !== product.name) {
                throw new Error(
                    "A variant creation requires matching product Activity."
                );
            }
            const existingIds = new Set([
                ...state.products.flatMap((item) => [
                    item.id,
                    ...item.variant.flatMap((productVariant) => [
                        productVariant.id,
                        ...productVariant.packagingHierarchy.map((level) => level.id)
                    ])
                ]),
                ...state.inventoryRecords.map((record) => record.id),
                ...state.inventoryBatches.map((batch) => batch.batchId)
            ]);
            const newIds = [
                action.variant.id,
                ...action.variant.packagingHierarchy.map((level) => level.id)
            ];
            if (
                newIds.some((id) => !id.trim() || existingIds.has(id)) ||
                new Set(newIds).size !== newIds.length
            ) {
                throw new Error("Catalogue variant contains an invalid or duplicate ID.");
            }
            validatePackagingHierarchy(action.variant.packagingHierarchy);
            const products = [...state.products];
            products[productIndex] = {
                ...product,
                variant: [...product.variant, action.variant]
            };
            return {
                ...state,
                products,
                activityEvents: appendActivityEvents(
                    state.activityEvents,
                    action.events
                )
            };
        }
        case "product.created": {
            const operationKey = `product.created:${action.result.product.id}`;
            const alreadyRecorded = state.activityEvents.some(
                (event) => event.operationKey === operationKey
            );
            const productAlreadyExists = state.products.some(
                (product) => product.id === action.result.product.id
            );

            if (alreadyRecorded && productAlreadyExists) {
                return state;
            }
            if (productAlreadyExists) {
                throw new Error(
                    `Product already exists: ${action.result.product.id}`
                );
            }

            return {
                ...state,
                products: [action.result.product, ...state.products],
                inventoryRecords: [
                    ...action.result.inventoryRecords,
                    ...state.inventoryRecords
                ],
                inventoryBatches: [
                    ...action.result.inventoryBatches,
                    ...state.inventoryBatches
                ],
                activityEvents: appendActivityEvents(
                    state.activityEvents,
                    action.events
                )
            };
        }
        case "product.deleted": {
            const productMatches = state.products.filter(
                (product) => product.id === action.productId
            );
            if (productMatches.length !== 1) {
                throw new Error(`Product not found: ${action.productId}`);
            }
            const [product] = productMatches;
            const blockers = getProductDeletionBlockMessages(
                action.productId,
                state.saleDrafts,
                state.deliveryDrafts
            );
            if (blockers.length > 0) {
                throw new Error(blockers.join(" "));
            }

            const [event] = action.events;
            const operationKeyPrefix = `product.deleted:${product.id}:`;
            if (
                action.events.length !== 1 ||
                event?.type !== "product.deleted" ||
                event.productId !== product.id ||
                event.productName !== product.name ||
                !event.operationKey.startsWith(operationKeyPrefix) ||
                event.operationKey.length === operationKeyPrefix.length ||
                !event.eventId.trim() ||
                !Number.isFinite(Date.parse(event.occurredAt))
            ) {
                throw new Error("A product deletion requires matching Activity.");
            }

            const expectedEvent = buildProductDeletionActivityInput(
                product,
                state.inventoryRecords,
                state.inventoryBatches,
                event.operationKey
            );
            if (
                expectedEvent.type !== "product.deleted" ||
                JSON.stringify(event.product) !==
                    JSON.stringify(expectedEvent.product) ||
                JSON.stringify(event.inventory) !==
                    JSON.stringify(expectedEvent.inventory) ||
                JSON.stringify(event.batches) !==
                    JSON.stringify(expectedEvent.batches)
            ) {
                throw new Error(
                    "Product deletion Activity does not match the current product and inventory."
                );
            }
            if (state.activityEvents.some(
                (existing) => existing.operationKey === event.operationKey
            )) {
                throw new Error("Product deletion Activity was already recorded.");
            }

            const activityEvents = appendActivityEvents(
                state.activityEvents,
                [event]
            );
            if (activityEvents.length !== state.activityEvents.length + 1) {
                throw new Error("Product deletion Activity could not be recorded.");
            }

            return {
                ...state,
                products: state.products.filter(
                    (candidate) => candidate.id !== product.id
                ),
                inventoryRecords: state.inventoryRecords.filter(
                    (record) => record.productId !== product.id
                ),
                inventoryBatches: state.inventoryBatches.filter(
                    (batch) => batch.productId !== product.id
                ),
                activityEvents
            };
        }
        case "product.updated": {
            const updateEvents = action.events.filter(
                (event) => event.type === "product.updated"
            );
            if (
                updateEvents.length !== 1 ||
                updateEvents[0].productId !== action.product.id ||
                action.events.some(
                    (event) =>
                        event.type !== "product.updated" &&
                        event.type !== "inventory.stock_adjusted"
                )
            ) {
                throw new Error("A product update requires matching update Activity.");
            }

            if (
                action.events.every((event) =>
                    state.activityEvents.some(
                        (existing) =>
                            existing.operationKey === event.operationKey
                    )
                )
            ) {
                return state;
            }

            const productIndex = state.products.findIndex(
                (product) => product.id === action.product.id
            );
            if (productIndex === -1) {
                throw new Error(`Product not found: ${action.product.id}`);
            }

            const nextInventoryRecords =
                action.inventoryRecords ?? state.inventoryRecords;
            const nextInventoryBatches =
                action.inventoryBatches ?? state.inventoryBatches;
            const previousProduct = state.products[productIndex];
            for (const event of action.events) {
                if (event.type !== "inventory.stock_adjusted") {
                    continue;
                }

                const record = nextInventoryRecords.find(
                    (candidate) => candidate.id === event.inventoryId
                );
                const previousRecord = state.inventoryRecords.find(
                    (candidate) => candidate.id === event.inventoryId
                );
                const productVariant = action.product.variant.find(
                    (candidate) => candidate.id === event.variantId
                );
                const previousVariant = previousProduct.variant.find(
                    (candidate) => candidate.id === event.variantId
                );
                const packagingLevel = productVariant?.packagingHierarchy.find(
                    (candidate) =>
                        candidate.id === event.packagingLevel.packagingLevelId
                );
                const wasExistingPackaging = previousVariant?.packagingHierarchy.some(
                    (candidate) => candidate.id === event.packagingLevel.packagingLevelId
                ) ?? false;
                const batch = record?.batchId === null
                    ? null
                    : nextInventoryBatches.find(
                        (candidate) =>
                            candidate.batchId === record?.batchId &&
                            candidate.productId === event.productId &&
                            candidate.variantId === event.variantId
                    );
                if (
                    !record ||
                    !productVariant ||
                    !packagingLevel ||
                    wasExistingPackaging ||
                    record.productId !== action.product.id ||
                    record.variantId !== event.variantId ||
                    event.productId !== action.product.id ||
                    event.productName !== action.product.name ||
                    event.variantName !== productVariant.variantName ||
                    (record.batchId !== null && !batch) ||
                    !event.operationKey.startsWith("inventory.stock_adjusted:") ||
                    !event.operationKey.endsWith(
                        `:${record.id}:${packagingLevel.id}`
                    ) ||
                    !event.reason.trim() ||
                    JSON.stringify(event.packagingLevel) !==
                        JSON.stringify(snapshotPackagingLevel(
                            packagingLevel,
                            productVariant.packagingHierarchy
                        )) ||
                    JSON.stringify(event.batch) !==
                        JSON.stringify(batch ? snapshotBatch(batch, action.product) : null)
                ) {
                    throw new Error(
                        "A packaging stock change requires matching inventory Activity."
                    );
                }

                const previousQuantity = previousRecord
                    ? getStockQuantityOrZero(
                        previousRecord,
                        packagingLevel.id
                    )
                    : 0;
                const newQuantity = getStockQuantityOrZero(
                    record,
                    packagingLevel.id
                );
                if (
                    event.previousQuantity !== previousQuantity ||
                    event.newQuantity !== newQuantity ||
                    event.quantityDifference !== newQuantity - previousQuantity ||
                    event.quantityDifference === 0
                ) {
                    throw new Error(
                        "Packaging stock Activity does not match the committed quantity."
                    );
                }
            }

            const products = [...state.products];
            products[productIndex] = action.product;

            return {
                ...state,
                products,
                inventoryRecords: nextInventoryRecords,
                inventoryBatches: nextInventoryBatches,
                activityEvents: appendActivityEvents(
                    state.activityEvents,
                    action.events
                )
            };
        }
        case "product.variant_removed": {
            if (
                action.events.length === 0 ||
                action.events.some(
                    (event) =>
                        event.type !== "product.variant_removed" ||
                        event.removedVariant.variantId !== action.variantId
                )
            ) {
                throw new Error("A variant removal requires matching removal Activity.");
            }

            const productIndex = state.products.findIndex(
                (product) => product.id === action.product.id
            );
            if (productIndex === -1) {
                throw new Error(`Product not found: ${action.product.id}`);
            }

            const products = [...state.products];
            products[productIndex] = {
                ...action.product,
                variant: action.product.variant.filter(
                    (productVariant) => productVariant.id !== action.variantId
                )
            };

            return {
                ...state,
                products,
                inventoryRecords: action.inventoryRecords,
                inventoryBatches: action.inventoryBatches,
                activityEvents: appendActivityEvents(
                    state.activityEvents,
                    action.events
                )
            };
        }
        case "product.packaging_removed": {
            if (
                action.events.length === 0 ||
                action.events.some(
                    (event) =>
                        event.type !== "product.packaging_removed" ||
                        event.removedPackaging.packagingLevelId !== action.packagingLevelId
                )
            ) {
                throw new Error("A packaging removal requires matching removal Activity.");
            }

            const productIndex = state.products.findIndex(
                (product) => product.id === action.product.id
            );
            if (productIndex === -1) {
                throw new Error(`Product not found: ${action.product.id}`);
            }

            const products = [...state.products];
            products[productIndex] = {
                ...action.product,
                variant: action.product.variant.map((productVariant) =>
                    productVariant.id !== action.variantId
                        ? productVariant
                        : {
                            ...productVariant,
                            packagingHierarchy: productVariant.packagingHierarchy.filter(
                                (level) => level.id !== action.packagingLevelId
                            )
                        }
                )
            };

            return {
                ...state,
                products,
                inventoryRecords: action.inventoryRecords,
                inventoryBatches: action.inventoryBatches,
                activityEvents: appendActivityEvents(
                    state.activityEvents,
                    action.events
                )
            };
        }
        case "inventory.batch_removed": {
            if (
                action.events.length === 0 ||
                action.events.some(
                    (event) =>
                        event.type !== "inventory.batch_removed" ||
                        event.removedBatch.batchId !== action.batchId
                )
            ) {
                throw new Error("A batch removal requires matching removal Activity.");
            }

            return {
                ...state,
                inventoryRecords: action.inventoryRecords,
                inventoryBatches: action.inventoryBatches,
                activityEvents: appendActivityEvents(
                    state.activityEvents,
                    action.events
                )
            };
        }
        case "inventory.saved": {
            if (
                action.events.length > 0 &&
                action.events.every((event) =>
                    state.activityEvents.some(
                        (existing) =>
                            existing.operationKey === event.operationKey
                    )
                )
            ) {
                return state;
            }

            return {
                ...state,
                inventoryRecords: action.inventoryRecords,
                inventoryBatches: action.inventoryBatches,
                activityEvents: appendActivityEvents(
                    state.activityEvents,
                    action.events
                )
            };
        }
        case "sale.completed": {
            const { sale, expectedInventory, updatedInventory, events } = action.completion;
            if (
                events.length !== 1 ||
                events[0].type !== "sale.completed" ||
                events[0].saleId !== sale.saleId ||
                events[0].operationKey !== `sale.completed:${sale.saleId}` ||
                events[0].occurredAt !== sale.completedAt ||
                !sale.saleId.trim() ||
                !Number.isFinite(Date.parse(sale.completedAt)) ||
                sale.items.length === 0
            ) {
                throw new Error("A sale completion requires matching Activity.");
            }

            const existingOperation = state.activityEvents.find(
                (event) => event.operationKey === events[0].operationKey
            );

            if (existingOperation) {
                const existingSale = state.sales.find(
                    (existing) => existing.saleId === sale.saleId
                );

                const activityMatches =
                    existingOperation.type === "sale.completed" &&
                    events[0].type === "sale.completed" &&
                    JSON.stringify({
                        ...existingOperation,
                        eventId: undefined,
                    }) ===
                    JSON.stringify({
                        ...events[0],
                        eventId: undefined,
                    });

                if (
                    activityMatches &&
                    existingOperation.saleId === sale.saleId &&
                    existingSale &&
                    JSON.stringify(existingSale) === JSON.stringify(sale)
                ) {
                    return state;
                }

                throw new Error(
                    "Sale operation key already exists without a matching completed sale."
                );
            }
            if (state.sales.some((existing) => existing.saleId === sale.saleId)) {
                throw new Error(`Sale already exists: ${sale.saleId}`);
            }
            if (
                expectedInventory.length === 0 ||
                expectedInventory.length !== updatedInventory.length ||
                new Set(expectedInventory.map((record) => record.id)).size !==
                    expectedInventory.length ||
                new Set(updatedInventory.map((record) => record.id)).size !==
                    updatedInventory.length
            ) {
                throw new Error("Sale completion inventory records must be unique and complete.");
            }

            const expectedById = new Map(
                expectedInventory.map((record) => [record.id, record])
            );
            const updatedById = new Map(
                updatedInventory.map((record) => [record.id, record])
            );
            const referencedInventoryIds = new Set<string>();
            const lineIds = new Set<string>();
            const currentProducts = new Map<string, productStructure>();
            let subtotal = 0;
            let discountAmount = 0;
            let finalAmount = 0;

            for (const item of sale.items) {
                if (
                    !item.lineId.trim() ||
                    lineIds.has(item.lineId) ||
                    !Number.isSafeInteger(item.quantity) ||
                    item.quantity <= 0 ||
                    !Number.isFinite(item.defaultSellingPrice) ||
                    item.defaultSellingPrice < 0 ||
                    !Number.isFinite(item.appliedSellingPrice) ||
                    item.appliedSellingPrice < 0 ||
                    !Number.isFinite(item.discountAmount)
                ) {
                    throw new Error("Sale item contains invalid identifiers, quantity, or prices.");
                }
                lineIds.add(item.lineId);
                const lineSubtotal = Math.round(
                    (item.appliedSellingPrice * item.quantity + Number.EPSILON) * 100
                ) / 100;
                const lineFinal = Math.round(
                    (lineSubtotal - item.discountAmount + Number.EPSILON) * 100
                ) / 100;
                if (
                    item.subtotal !== lineSubtotal ||
                    item.discountAmount < 0 ||
                    item.discountAmount > lineSubtotal ||
                    item.finalAmount !== lineFinal
                ) {
                    throw new Error("Sale item totals or discount are invalid.");
                }
                subtotal += item.subtotal;
                discountAmount += item.discountAmount;
                finalAmount += item.finalAmount;

                const productMatches = state.products.filter(
                    (product) => product.id === item.product.productId
                );
                const currentProduct = productMatches.length === 1
                    ? productMatches[0]
                    : undefined;
                if (
                    !currentProduct ||
                    JSON.stringify(snapshotProduct(currentProduct)) !==
                        JSON.stringify(item.product)
                ) {
                    throw new Error(
                        "Product definitions changed after the sale was prepared. Prepare the sale again."
                    );
                }
                currentProducts.set(currentProduct.id, currentProduct);
                const currentVariant = getVariantById(
                    currentProduct,
                    item.variant.variantId
                );
                if (
                    JSON.stringify(snapshotVariant(currentVariant)) !==
                    JSON.stringify(item.variant)
                ) {
                    throw new Error(
                        "Variant definitions changed after the sale was prepared. Prepare the sale again."
                    );
                }
                const currentPackaging = getPackagingLevelById(
                    currentVariant,
                    item.packagingLevel.packagingLevelId
                );
                if (
                    JSON.stringify(snapshotPackagingLevel(
                        currentPackaging,
                        currentVariant.packagingHierarchy
                    )) !== JSON.stringify(item.packagingLevel)
                ) {
                    throw new Error(
                        "Packaging definitions changed after the sale was prepared. Prepare the sale again."
                    );
                }

                const expectedRecord = expectedById.get(item.inventoryRecordId);
                const updatedRecord = updatedById.get(item.inventoryRecordId);
                if (!expectedRecord || !updatedRecord) {
                    throw new Error("Sale item references an unplanned inventory record.");
                }
                referencedInventoryIds.add(item.inventoryRecordId);
                if (
                    expectedRecord.productId !== currentProduct.id ||
                    expectedRecord.variantId !== currentVariant.id ||
                    expectedRecord.batchId !== (item.batch?.batchId ?? null)
                ) {
                    throw new Error("Sale item does not match its selected inventory record.");
                }
                if (item.batch !== null) {
                    const batches = state.inventoryBatches.filter(
                        (batch) => batch.batchId === item.batch?.batchId
                    );
                    const currentBatch = batches.length === 1 ? batches[0] : undefined;
                    if (
                        !currentBatch ||
                        JSON.stringify(snapshotBatch(currentBatch, currentProduct)) !==
                            JSON.stringify(item.batch)
                    ) {
                        throw new Error(
                            "Batch information changed after the sale was prepared. Prepare the sale again."
                        );
                    }
                }
            }

            if (
                referencedInventoryIds.size !== expectedInventory.length ||
                Math.round((subtotal + Number.EPSILON) * 100) / 100 !== sale.subtotal ||
                Math.round((discountAmount + Number.EPSILON) * 100) / 100 !==
                    sale.discountAmount ||
                Math.round((finalAmount + Number.EPSILON) * 100) / 100 !==
                    sale.finalAmount ||
                sale.expiredBatchConfirmed !== sale.items.some((item) => item.expiredBatch)
            ) {
                throw new Error("Sale transaction totals or inventory allocations are inconsistent.");
            }

            for (const expectedRecord of expectedInventory) {
                const matchingRecords = state.inventoryRecords.filter(
                    (record) => record.id === expectedRecord.id
                );
                if (
                    matchingRecords.length !== 1 ||
                    JSON.stringify(matchingRecords[0]) !==
                        JSON.stringify(expectedRecord)
                ) {
                    throw new Error(
                        "Inventory changed after the sale was prepared. Prepare the sale again."
                    );
                }
            }

            const verificationDraft: SaleDraft = {
                draftId: `approval:${sale.saleId}`,
                status: "draft",
                createdAt: sale.completedAt,
                updatedAt: sale.completedAt,
                ...(sale.customerName ? { customerName: sale.customerName } : {}),
                ...(sale.customerAddress
                    ? { customerAddress: sale.customerAddress }
                    : {}),
                ...(sale.saleDate ? { saleDate: sale.saleDate } : {}),
                ...(sale.staffMember ? { staffMember: sale.staffMember } : {}),
                ...(sale.notes ? { notes: sale.notes } : {}),
                items: sale.items.map((item) => ({
                    lineId: item.lineId,
                    productId: item.product.productId,
                    variantId: item.variant.variantId,
                    inventoryRecordId: item.inventoryRecordId,
                    batchId: item.batch?.batchId ?? null,
                    packagingLevelId: item.packagingLevel.packagingLevelId,
                    quantity: item.quantity,
                    defaultSellingPrice: item.defaultSellingPrice,
                    appliedSellingPrice: item.appliedSellingPrice,
                    discountAmount: item.discountAmount
                }))
            };
            const recalculated = prepareSaleDraft(verificationDraft, {
                products: state.products,
                inventoryRecords: state.inventoryRecords,
                inventoryBatches: state.inventoryBatches
            }, {
                now: () => new Date(sale.completedAt)
            });
            if (
                recalculated.updatedInventory.length !== updatedInventory.length ||
                recalculated.updatedInventory.some((record, index) =>
                    JSON.stringify(record) !== JSON.stringify(updatedInventory[index])
                ) ||
                recalculated.linePlans.some((linePlan, index) => {
                    const item = sale.items[index];
                    return (
                        linePlan.defaultSellingPrice !== item.defaultSellingPrice ||
                        linePlan.appliedSellingPrice !== item.appliedSellingPrice ||
                        linePlan.subtotal !== item.subtotal ||
                        linePlan.discountAmount !== item.discountAmount ||
                        linePlan.finalAmount !== item.finalAmount ||
                        linePlan.expiredBatch !== item.expiredBatch
                    );
                })
            ) {
                throw new Error("Sale allocation or pricing does not match the current transaction.");
            }

            const activity = events[0];
            const expectedActivityItems = sale.items.map((item) => ({
                productId: item.product.productId,
                productName: item.product.productName,
                variantId: item.variant.variantId,
                variantName: item.variant.variantName,
                product: item.product,
                variant: item.variant,
                packagingLevel: item.packagingLevel,
                quantity: item.quantity,
                defaultSellingPrice: item.defaultSellingPrice,
                appliedSellingPrice: item.appliedSellingPrice,
                subtotal: item.subtotal,
                discountAmount: item.discountAmount,
                finalAmount: item.finalAmount,
                allocations: [{
                    inventoryId: item.inventoryRecordId,
                    batch: item.batch,
                    quantity: item.quantity
                }]
            }));
            if (
                activity.subtotal !== sale.subtotal ||
                activity.discountAmount !== sale.discountAmount ||
                activity.finalAmount !== sale.finalAmount ||
                activity.expiredBatchConfirmed !== sale.expiredBatchConfirmed ||
                activity.customerName !== sale.customerName ||
                activity.customerAddress !== sale.customerAddress ||
                activity.saleDate !== sale.saleDate ||
                JSON.stringify(activity.staffMember) !== JSON.stringify(sale.staffMember) ||
                activity.actorId !== sale.staffMember?.userId ||
                activity.notes !== sale.notes ||
                JSON.stringify(activity.items) !==
                    JSON.stringify(expectedActivityItems)
            ) {
                throw new Error("Sale Activity does not match the completed transaction.");
            }

            for (const [recordId, expectedRecord] of expectedById) {
                const matchingRecords = state.inventoryRecords.filter(
                    (record) => record.id === recordId
                );
                const currentRecord = matchingRecords.length === 1
                    ? matchingRecords[0]
                    : undefined;
                if (
                    !currentRecord ||
                    JSON.stringify(currentRecord) !== JSON.stringify(expectedRecord)
                ) {
                    throw new Error(
                        "Inventory changed after the sale was prepared. Prepare the sale again."
                    );
                }
                const updatedRecord = updatedById.get(recordId)!;
                const product = currentProducts.get(expectedRecord.productId);
                if (
                    !product ||
                    updatedRecord.id !== expectedRecord.id ||
                    updatedRecord.productId !== expectedRecord.productId ||
                    updatedRecord.variantId !== expectedRecord.variantId ||
                    updatedRecord.batchId !== expectedRecord.batchId
                ) {
                    throw new Error("Sale allocation changed the selected inventory identity.");
                }
                validateInventoryRelationships(
                    product,
                    updatedRecord,
                    [...state.inventoryBatches]
                );
            }

            let saleDrafts = state.saleDrafts;
            if (action.completion.draftId !== undefined) {
                const draftIndex = state.saleDrafts.findIndex(
                    (draft) => draft.draftId === action.completion.draftId
                );
                const expectedDraft = action.completion.expectedDraft;
                const currentDraft = state.saleDrafts[draftIndex];
                const draftMatchesSale = expectedDraft !== undefined &&
                    expectedDraft.items.length === sale.items.length &&
                    expectedDraft.customerName === sale.customerName &&
                    expectedDraft.customerAddress === sale.customerAddress &&
                    expectedDraft.saleDate === sale.saleDate &&
                    JSON.stringify(expectedDraft.staffMember) ===
                        JSON.stringify(sale.staffMember) &&
                    expectedDraft.notes === sale.notes &&
                    expectedDraft.items.every((draftItem, index) => {
                        const saleItem = sale.items[index];
                        return (
                            draftItem.lineId === saleItem.lineId &&
                            draftItem.productId === saleItem.product.productId &&
                            draftItem.variantId === saleItem.variant.variantId &&
                            draftItem.inventoryRecordId === saleItem.inventoryRecordId &&
                            draftItem.batchId === (saleItem.batch?.batchId ?? null) &&
                            draftItem.packagingLevelId ===
                                saleItem.packagingLevel.packagingLevelId &&
                            draftItem.quantity === saleItem.quantity &&
                            draftItem.defaultSellingPrice ===
                                saleItem.defaultSellingPrice &&
                            draftItem.appliedSellingPrice ===
                                saleItem.appliedSellingPrice &&
                            draftItem.discountAmount === saleItem.discountAmount
                        );
                    });
                if (
                    draftIndex === -1 ||
                    !expectedDraft ||
                    !currentDraft ||
                    currentDraft.status !== "draft" ||
                    !draftMatchesSale ||
                    JSON.stringify(validateSaleDraft(currentDraft)) !==
                        JSON.stringify(expectedDraft) ||
                    expectedDraft.status !== "draft"
                ) {
                    throw new Error(
                        "Sale draft changed after approval was prepared. Prepare the sale again."
                    );
                }
                saleDrafts = [...state.saleDrafts];
                saleDrafts[draftIndex] = validateSaleDraft({
                    ...currentDraft,
                    status: "approved",
                    updatedAt: sale.completedAt
                });
            } else if (action.completion.expectedDraft !== undefined) {
                throw new Error("Sale completion has an unexpected draft snapshot.");
            }

            const inventoryRecords = [...state.inventoryRecords];
            for (const [recordId, updatedRecord] of updatedById) {
                const inventoryIndex = inventoryRecords.findIndex(
                    (record) => record.id === recordId
                );
                inventoryRecords[inventoryIndex] = updatedRecord;
            }
            return {
                ...state,
                inventoryRecords,
                saleDrafts,
                sales: [...state.sales, sale],
                activityEvents: appendActivityEvents(state.activityEvents, [...events])
            };
        }
        case "sale.draft_created": {
            const draft = validateSaleDraft(action.draft);
            if (draft.status !== "draft") {
                throw new Error("A new sale draft must have draft status.");
            }
            if (state.saleDrafts.some(
                (existing) => existing.draftId === draft.draftId
            )) {
                throw new Error(`Sale draft already exists: ${draft.draftId}`);
            }
            return {
                ...state,
                saleDrafts: [...state.saleDrafts, draft]
            };
        }
        case "sale.draft_item_added": {
            const draftIndex = state.saleDrafts.findIndex(
                (draft) => draft.draftId === action.draftId
            );
            if (draftIndex === -1) {
                throw new Error(`Sale draft not found: ${action.draftId}`);
            }
            const saleDrafts = [...state.saleDrafts];
            saleDrafts[draftIndex] = addSaleDraftItem(
                saleDrafts[draftIndex],
                action.item,
                action.updatedAt
            );
            return { ...state, saleDrafts };
        }
        case "sale.draft_item_updated": {
            const draftIndex = state.saleDrafts.findIndex(
                (draft) => draft.draftId === action.draftId
            );
            if (draftIndex === -1) {
                throw new Error(`Sale draft not found: ${action.draftId}`);
            }
            const saleDrafts = [...state.saleDrafts];
            saleDrafts[draftIndex] = updateSaleDraftItem(
                saleDrafts[draftIndex],
                action.lineId,
                action.changes,
                action.updatedAt
            );
            return { ...state, saleDrafts };
        }
        case "sale.draft_item_removed": {
            const draftIndex = state.saleDrafts.findIndex(
                (draft) => draft.draftId === action.draftId
            );
            if (draftIndex === -1) {
                throw new Error(`Sale draft not found: ${action.draftId}`);
            }
            const saleDrafts = [...state.saleDrafts];
            const updatedDraft = removeSaleDraftItem(
                saleDrafts[draftIndex],
                action.lineId,
                action.updatedAt
            );
            if (updatedDraft.items.length === 0) {
                saleDrafts.splice(draftIndex, 1);
            } else {
                saleDrafts[draftIndex] = updatedDraft;
            }
            return { ...state, saleDrafts };
        }
        case "sale.draft_details_updated": {
            const draftIndex = state.saleDrafts.findIndex(
                (draft) => draft.draftId === action.draftId
            );
            if (draftIndex === -1) {
                throw new Error(`Sale draft not found: ${action.draftId}`);
            }
            const saleDrafts = [...state.saleDrafts];
            saleDrafts[draftIndex] = updateSaleDraftDetails(
                saleDrafts[draftIndex],
                action.changes,
                action.updatedAt
            );
            return { ...state, saleDrafts };
        }
        case "sale.draft_cancelled": {
            const draftIndex = state.saleDrafts.findIndex(
                (draft) => draft.draftId === action.draftId
            );
            if (draftIndex === -1) {
                throw new Error(`Sale draft not found: ${action.draftId}`);
            }
            const saleDrafts = [...state.saleDrafts];
            saleDrafts[draftIndex] = cancelSaleDraft(
                saleDrafts[draftIndex],
                action.updatedAt
            );
            return { ...state, saleDrafts };
        }
        case "delivery.draft_created": {
            const draft = validateDeliveryDraft(action.draft);
            if (draft.status !== "draft") {
                throw new Error("A new delivery draft must have draft status.");
            }
            if (state.deliveryDrafts.some(
                (existing) => existing.deliveryId === draft.deliveryId
            )) {
                throw new Error(`Delivery draft already exists: ${draft.deliveryId}`);
            }
            return {
                ...state,
                deliveryDrafts: [...state.deliveryDrafts, draft]
            };
        }
        case "delivery.draft_details_updated": {
            const draftIndex = state.deliveryDrafts.findIndex(
                (draft) => draft.deliveryId === action.deliveryId
            );
            if (draftIndex === -1) {
                throw new Error(`Delivery draft not found: ${action.deliveryId}`);
            }
            const deliveryDrafts = [...state.deliveryDrafts];
            deliveryDrafts[draftIndex] = updateDeliveryDraftDetails(
                deliveryDrafts[draftIndex],
                action.changes,
                action.updatedAt
            );
            return { ...state, deliveryDrafts };
        }
        case "delivery.draft_item_added": {
            const draftIndex = state.deliveryDrafts.findIndex(
                (draft) => draft.deliveryId === action.deliveryId
            );
            if (draftIndex === -1) {
                throw new Error(`Delivery draft not found: ${action.deliveryId}`);
            }
            const deliveryDrafts = [...state.deliveryDrafts];
            deliveryDrafts[draftIndex] = addDeliveryDraftItem(
                deliveryDrafts[draftIndex],
                action.item,
                action.updatedAt
            );
            return { ...state, deliveryDrafts };
        }
        case "delivery.draft_item_updated": {
            const draftIndex = state.deliveryDrafts.findIndex(
                (draft) => draft.deliveryId === action.deliveryId
            );
            if (draftIndex === -1) {
                throw new Error(`Delivery draft not found: ${action.deliveryId}`);
            }
            const deliveryDrafts = [...state.deliveryDrafts];
            deliveryDrafts[draftIndex] = updateDeliveryDraftItem(
                deliveryDrafts[draftIndex],
                action.deliveryItemId,
                action.changes,
                action.updatedAt
            );
            return { ...state, deliveryDrafts };
        }
        case "delivery.draft_item_removed": {
            const draftIndex = state.deliveryDrafts.findIndex(
                (draft) => draft.deliveryId === action.deliveryId
            );
            if (draftIndex === -1) {
                throw new Error(`Delivery draft not found: ${action.deliveryId}`);
            }
            const deliveryDrafts = [...state.deliveryDrafts];
            deliveryDrafts[draftIndex] = removeDeliveryDraftItem(
                deliveryDrafts[draftIndex],
                action.deliveryItemId,
                action.updatedAt
            );
            return { ...state, deliveryDrafts };
        }
        case "delivery.approved": {
            const { plan, event } = action;
            const draftIndex = state.deliveryDrafts.findIndex(
                (draft) => draft.deliveryId === plan.draft.deliveryId
            );
            if (draftIndex === -1) {
                throw new Error(`Delivery draft not found: ${plan.draft.deliveryId}`);
            }
            const currentDraft = state.deliveryDrafts[draftIndex];
            const existingEvent = state.activityEvents.find(
                (candidate) =>
                    candidate.operationKey === `delivery.received:${plan.draft.deliveryId}`
            );
            if (currentDraft.status === "received" && existingEvent) {
                return state;
            }
            if (currentDraft.status !== "draft") {
                throw new Error(`Cannot approve a ${currentDraft.status} delivery.`);
            }
            const receivedDraft = validateDeliveryDraft(plan.draft);
            if (
                receivedDraft.status !== "received" ||
                JSON.stringify(receivedDraft.items) !==
                    JSON.stringify(currentDraft.items) ||
                receivedDraft.deliveryId !== currentDraft.deliveryId ||
                receivedDraft.deliveryDate !== currentDraft.deliveryDate ||
                receivedDraft.receivedBy !== currentDraft.receivedBy ||
                receivedDraft.supplier !== currentDraft.supplier ||
                receivedDraft.invoiceNumber !== currentDraft.invoiceNumber ||
                event.type !== "delivery.received" ||
                event.deliveryId !== currentDraft.deliveryId ||
                event.deliveryDate !== currentDraft.deliveryDate ||
                event.receivedBy !== currentDraft.receivedBy ||
                event.supplierName !== (currentDraft.supplier ?? null) ||
                event.invoiceNumber !== (currentDraft.invoiceNumber ?? null) ||
                event.operationKey !== `delivery.received:${currentDraft.deliveryId}` ||
                !Number.isFinite(Date.parse(event.occurredAt)) ||
                event.items.length !== currentDraft.items.length ||
                !event.items.every((activityItem, index) => {
                    const draftItem = currentDraft.items[index];
                    if (!draftItem) {
                        return false;
                    }
                    const product = state.products.find(
                        (candidate) => candidate.id === draftItem.productId
                    );
                    const productVariant = product?.variant.find(
                        (candidate) => candidate.id === draftItem.variantId
                    );
                    const packagingLevel = productVariant?.packagingHierarchy.find(
                        (candidate) => candidate.id === draftItem.packagingLevelId
                    );
                    const batch = plan.inventoryBatches.find(
                        (candidate) => candidate.batchId === activityItem.batch?.batchId
                    );
                    const stock = activityItem.stock[0];
                    if (!product || !productVariant || !packagingLevel || !batch || !stock) {
                        return false;
                    }
                    return (
                        activityItem.productId === draftItem.productId &&
                        activityItem.productName === product.name &&
                        activityItem.variantId === draftItem.variantId &&
                        activityItem.variantName === productVariant.variantName &&
                        activityItem.stock.length === 1 &&
                        stock.packagingLevel.packagingLevelId ===
                            draftItem.packagingLevelId &&
                        JSON.stringify(stock.packagingLevel) ===
                            JSON.stringify(snapshotPackagingLevel(
                                packagingLevel,
                                productVariant.packagingHierarchy
                            )) &&
                        stock.quantity === draftItem.quantity &&
                        batch.productId === draftItem.productId &&
                        batch.variantId === draftItem.variantId &&
                        batch.batchNumber === draftItem.batchNumber &&
                        (batch.expiryDate?.toISOString().slice(0, 10) ?? null) ===
                            draftItem.expiryDate &&
                        JSON.stringify(activityItem.batch) ===
                            JSON.stringify(snapshotBatch(batch, product))
                    );
                })
            ) {
                throw new Error("Delivery approval does not match the active draft.");
            }

            for (const record of plan.inventoryRecords) {
                const product = state.products.find(
                    (candidate) => candidate.id === record.productId
                );
                if (!product) {
                    throw new Error(
                        `Inventory record references an unknown product: ${record.productId}`
                    );
                }
                validateInventoryRelationships(
                    product,
                    record,
                    plan.inventoryBatches
                );
            }

            const activityEvents = appendActivityEvents(
                state.activityEvents,
                [event]
            );
            const deliveryDrafts = [...state.deliveryDrafts];
            deliveryDrafts[draftIndex] = receivedDraft;
            return {
                ...state,
                inventoryRecords: plan.inventoryRecords,
                inventoryBatches: plan.inventoryBatches,
                deliveryDrafts,
                activityEvents
            };
        }
    }
}
