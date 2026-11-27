import {
    appendActivityEvents,
    buildBatchCreatedActivityInput,
    buildBatchRemovalActivityInput,
    buildBatchUpdatedActivityInput,
    buildPackagingRemovalActivityInput,
    buildStockAdjustmentActivityInput,
    buildVariantRemovalActivityInput,
    buildProductDeletionActivityInput,
    buildProductCreationActivityInputs,
    buildDeliveryDraftCancellationActivityInput,
    buildProductUpdateActivityInputs,
    snapshotBatch,
    snapshotPackagingLevel,
    snapshotProduct,
    snapshotProductInventoryState,
    snapshotVariant,
    type ActivityInventoryBatchStateSnapshot,
    type ActivityInventoryRecordStateSnapshot,
    type ActivityProductSnapshot,
    type ActivityEvent,
    type ActivityEventInput
} from "./activity/activity";
import type { inventory } from "./inventory/inventoryStock";
import { adjustInventoryStock } from "./inventory/inventoryAdjustment";
import {
    assertNoDuplicateLogicalBatchIdentities,
    findLogicalBatchMatches,
    validateBatchPricingCollection,
    type inventoryBatch
} from "./inventory/inventoryBatch";
import { validateInventoryRelationships } from "./inventory/inventoryValidation";
import { demoInventory, demoInventoryBatches, demoProducts } from "./data/demoInventory";
import type { ProductCreationResult } from "./products/productCreation";
import type { productStructure } from "./products/productStructure";
import type { variant } from "./products/productStructure";
import {
    getPackagingLevelById,
    getVariantById,
    validateVariantLowStockThreshold
} from "./products/productValidation";
import { validatePackagingHierarchy } from "./packaging/packagingValidation";
import { removePackagingLevelFromHierarchy } from "./packaging/packagingValidation";
import {
    prepareSaleDraft,
    type CompletedSale,
    type SaleCompletion,
    type SaleContext
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
import {
    prepareDeliveryApproval,
    type DeliveryApprovalPlan
} from "./deliveries/deliveryApproval";
import {
    getProductDeletionBlockMessages,
    getPackagingLevelThresholdDeletionBlockMessage,
    getProductRecordDeletionBlockMessages,
    getProductPackagingThresholdRemovalBlockMessage,
    prepareProductRecordDeletionPlan,
    minimumProductVariantMessage,
    type ProductRecordDeletionRequest
} from "./products/productDeletion";
import {
    buildUpdatedProduct,
    validateProductUpdateDraft,
    type ProductUpdateDraft
} from "./products/productUpdate";
import {
    getChangedInventoryProductIds,
    getProductDraftLockMessages
} from "./products/productDraftLock";

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
        type: "product.records_deleted";
        productId: string;
        deletions: ProductRecordDeletionRequest[];
        product: productStructure;
        updatedProduct?: productStructure;
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
        type: "delivery.draft_cancelled";
        deliveryId: string;
        event: ActivityEvent;
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

function getRemovalOperationId(
    operationKey: string,
    prefix: string,
    recordId: string
): string {
    const suffix = `:${recordId}`;
    if (
        !operationKey.startsWith(prefix) ||
        !operationKey.endsWith(suffix) ||
        operationKey.length <= prefix.length + suffix.length
    ) {
        throw new Error("Removal Activity has an invalid operation key.");
    }
    return operationKey.slice(prefix.length, -suffix.length);
}

function inventoryBatchFromSnapshot(
    snapshot: Extract<ActivityEvent, { type: "inventory.batch_removed" }>["removedBatch"]
): inventoryBatch {
    return {
        batchId: snapshot.batchId,
        productId: snapshot.productId,
        variantId: snapshot.variantId,
        batchNumber: snapshot.batchNumber,
        expiryDate: snapshot.expiryDate === null
            ? null
            : new Date(snapshot.expiryDate),
        ...(snapshot.receivedDate === undefined
            ? {}
            : { receivedDate: snapshot.receivedDate }),
        pricingByPackagingLevel: snapshot.pricingByPackagingLevel.map(
            (pricing) => ({ ...pricing })
        )
    };
}

function inventoryRecordFromSnapshot(
    snapshot: Extract<ActivityEvent, { type: "inventory.batch_removed" }>[
        "affectedInventory"
    ][number]
): inventory {
    return {
        id: snapshot.inventoryId,
        productId: snapshot.productId,
        variantId: snapshot.variantId,
        batchId: snapshot.batch?.batchId ?? null,
        stockQuantities: snapshot.stock.map((stock) => ({
            packagingLevelId: stock.packagingLevel.packagingLevelId,
            quantity: stock.quantity
        }))
    };
}

function validateInventoryDraftLocks(
    state: ApplicationState,
    nextInventoryRecords: readonly inventory[],
    nextInventoryBatches: readonly inventoryBatch[]
): void {
    const changedProductIds = getChangedInventoryProductIds(
        state.inventoryRecords,
        state.inventoryBatches,
        nextInventoryRecords,
        nextInventoryBatches
    );
    for (const productId of changedProductIds) {
        const messages = getProductDraftLockMessages(
            productId,
            state.saleDrafts,
            state.deliveryDrafts
        );
        if (messages.length > 0) {
            throw new Error(messages.join(" "));
        }
    }
}

function activityInputFromEvent(event: ActivityEvent): ActivityEventInput {
    const input = { ...event };
    Reflect.deleteProperty(input, "eventId");
    Reflect.deleteProperty(input, "occurredAt");
    return input;
}

function activityValuesEqual(left: unknown, right: unknown): boolean {
    if (left instanceof Date || right instanceof Date) {
        return left instanceof Date &&
            right instanceof Date &&
            Number.isFinite(left.getTime()) &&
            Number.isFinite(right.getTime()) &&
            left.getTime() === right.getTime();
    }
    if (Object.is(left, right)) {
        return true;
    }
    if (
        left === null ||
        right === null ||
        typeof left !== "object" ||
        typeof right !== "object"
    ) {
        return false;
    }
    if (Array.isArray(left) || Array.isArray(right)) {
        if (
            !Array.isArray(left) ||
            !Array.isArray(right) ||
            left.length !== right.length
        ) {
            return false;
        }
        for (let index = 0; index < left.length; index += 1) {
            if (
                !Object.prototype.hasOwnProperty.call(left, index) ||
                !Object.prototype.hasOwnProperty.call(right, index) ||
                !activityValuesEqual(left[index], right[index])
            ) {
                return false;
            }
        }
        return true;
    }

    const leftKeys = Object.keys(left)
        .filter((key) => Reflect.get(left, key) !== undefined)
        .sort();
    const rightKeys = Object.keys(right)
        .filter((key) => Reflect.get(right, key) !== undefined)
        .sort();
    return leftKeys.length === rightKeys.length &&
        leftKeys.every((key, index) =>
            key === rightKeys[index] &&
            activityValuesEqual(Reflect.get(left, key), Reflect.get(right, key))
        );
}

function assertActivityInputMatches(
    event: ActivityEvent,
    expected: ActivityEventInput,
    message: string
): void {
    if (!activityValuesEqual(activityInputFromEvent(event), expected)) {
        throw new Error(message);
    }
}

function getInventorySaveOperationId(
    event: ActivityEvent
): string | undefined {
    let entitySuffix: string;
    switch (event.type) {
        case "inventory.batch_created":
            if (event.source !== "inventory_edit") {
                return undefined;
            }
            entitySuffix = event.batch.batchId;
            break;
        case "inventory.batch_updated":
            entitySuffix = event.after.batchId;
            break;
        case "inventory.batch_removed":
            entitySuffix = event.removedBatch.batchId;
            break;
        case "inventory.stock_adjusted":
            entitySuffix =
                `${event.inventoryId}:${event.packagingLevel.packagingLevelId}`;
            break;
        default:
            return undefined;
    }

    const operationKeyPrefix = `${event.type}:`;
    const operationKeySuffix = `:${entitySuffix}`;
    if (
        !event.operationKey.startsWith(operationKeyPrefix) ||
        !event.operationKey.endsWith(operationKeySuffix)
    ) {
        return undefined;
    }

    const operationId = event.operationKey.slice(
        operationKeyPrefix.length,
        event.operationKey.length - operationKeySuffix.length
    );
    return operationId.trim().length > 0 ? operationId : undefined;
}

function validateNewInventorySaveOperationId(
    state: ApplicationState,
    events: readonly ActivityEvent[]
): void {
    let operationId: string | undefined;
    for (const event of events) {
        const eventOperationId = getInventorySaveOperationId(event);
        if (eventOperationId === undefined) {
            throw new Error(
                "Inventory save Activity contains an invalid operation ID."
            );
        }
        if (
            operationId !== undefined &&
            operationId !== eventOperationId
        ) {
            throw new Error(
                "Inventory save Activity must share one operation ID."
            );
        }
        operationId = eventOperationId;
    }

    if (
        operationId !== undefined &&
        state.activityEvents.some(
            (event) => getInventorySaveOperationId(event) === operationId
        )
    ) {
        throw new Error(
            "Inventory save operation ID has already been used."
        );
    }
}

function validateInventorySaveReplay(
    state: ApplicationState,
    action: Extract<ApplicationAction, { type: "inventory.saved" }>
): void {
    if (action.events.length === 0) {
        throw new Error(
            "Inventory replay does not match the committed operation."
        );
    }

    let operationId: string | undefined;
    const replayOperationKeys = new Set<string>();
    for (const submittedEvent of action.events) {
        const submittedOperationId =
            getInventorySaveOperationId(submittedEvent);
        if (
            submittedOperationId === undefined ||
            (operationId !== undefined &&
                operationId !== submittedOperationId)
        ) {
            throw new Error(
                "Inventory replay contains invalid or mixed operation evidence."
            );
        }
        operationId = submittedOperationId;

        if (replayOperationKeys.has(submittedEvent.operationKey)) {
            throw new Error(
                "Inventory replay contains duplicate operation evidence."
            );
        }
        replayOperationKeys.add(submittedEvent.operationKey);
    }

    if (operationId === undefined) {
        throw new Error(
            "Inventory replay does not match the committed operation."
        );
    }

    const originalEvents = state.activityEvents.filter(
        (existing) => getInventorySaveOperationId(existing) === operationId
    );
    const originalEventsByOperationKey = new Map<string, ActivityEvent>();
    for (const originalEvent of originalEvents) {
        if (originalEventsByOperationKey.has(originalEvent.operationKey)) {
            throw new Error(
                "Inventory replay does not match the committed operation."
            );
        }
        originalEventsByOperationKey.set(
            originalEvent.operationKey,
            originalEvent
        );
    }
    if (
        originalEvents.length === 0 ||
        originalEventsByOperationKey.size !== action.events.length
    ) {
        throw new Error(
            "Inventory replay does not match the complete committed operation."
        );
    }

    for (const submittedEvent of action.events) {
        const originalEvent = originalEventsByOperationKey.get(
            submittedEvent.operationKey
        );
        if (!originalEvent || originalEvent.type !== submittedEvent.type) {
            throw new Error(
                "Inventory replay does not match the committed operation."
            );
        }

        if (!activityValuesEqual(
            activityInputFromEvent(submittedEvent),
            activityInputFromEvent(originalEvent)
        )) {
            throw new Error(
                "Inventory replay Activity does not match the committed operation."
            );
        }
    }

    if (
        replayOperationKeys.size !== action.events.length ||
        !activityValuesEqual(
            action.inventoryRecords,
            state.inventoryRecords
        ) ||
        !activityValuesEqual(
            action.inventoryBatches,
            state.inventoryBatches
        )
    ) {
        throw new Error(
            "Inventory replay payload does not match the committed operation."
        );
    }
}

function inventoryStockQuantitiesEqual(
    left: inventory["stockQuantities"],
    right: inventory["stockQuantities"]
): boolean {
    return left.length === right.length &&
        left.every((stock) => {
            const matches = right.filter(
                (candidate) =>
                    candidate.packagingLevelId === stock.packagingLevelId
            );
            return matches.length === 1 &&
                matches[0].quantity === stock.quantity;
        });
}

function isCanonicalActivityTimestamp(value: unknown): value is string {
    if (typeof value !== "string") {
        return false;
    }
    const timestamp = new Date(value);
    return Number.isFinite(timestamp.getTime()) &&
        timestamp.toISOString() === value;
}

function validateInventorySave(
    state: ApplicationState,
    action: Extract<ApplicationAction, { type: "inventory.saved" }>
): void {
    validateNewInventorySaveOperationId(state, action.events);

    const existingEventIds = new Set(
        state.activityEvents.map((event) => event.eventId)
    );
    const existingOperationKeys = new Set(
        state.activityEvents.map((event) => event.operationKey)
    );
    const seenEventIds = new Set<string>();
    const seenOperationKeys = new Set<string>();
    for (const event of action.events) {
        if (
            !event.eventId.trim() ||
            existingEventIds.has(event.eventId) ||
            seenEventIds.has(event.eventId) ||
            !Number.isFinite(Date.parse(event.occurredAt)) ||
            !event.operationKey.trim() ||
            existingOperationKeys.has(event.operationKey) ||
            seenOperationKeys.has(event.operationKey)
        ) {
            throw new Error("Inventory Activity contains invalid or duplicate metadata.");
        }
        seenEventIds.add(event.eventId);
        seenOperationKeys.add(event.operationKey);
        if (
            event.type !== "inventory.batch_removed" &&
            event.type !== "inventory.batch_created" &&
            event.type !== "inventory.batch_updated" &&
            event.type !== "inventory.stock_adjusted"
        ) {
            throw new Error("Inventory save contains unsupported Activity.");
        }
    }

    const removalEvents = action.events.filter(
        (event) => event.type === "inventory.batch_removed"
    );
    const removedBatchKeys = new Set<string>();
    for (const event of removalEvents) {
        if (event.reason.trim() === "" || event.reason !== event.reason.trim()) {
            throw new Error("A reason is required for every deletion.");
        }
        const key = JSON.stringify([
            event.removedBatch.productId,
            event.removedBatch.variantId,
            event.removedBatch.batchId
        ]);
        if (removedBatchKeys.has(key)) {
            throw new Error("An inventory batch can only be removed once per save.");
        }
        removedBatchKeys.add(key);

        const blockers = getProductRecordDeletionBlockMessages(
            {
                kind: "batch",
                productId: event.removedBatch.productId,
                variantId: event.removedBatch.variantId,
                batchId: event.removedBatch.batchId
            },
            state.saleDrafts,
            state.deliveryDrafts,
            state.inventoryBatches
        );
        if (blockers.length > 0) {
            throw new Error(blockers.join(" "));
        }
        if (state.activityEvents.some(
            (existing) => existing.operationKey === event.operationKey
        )) {
            throw new Error("Batch removal Activity was already recorded.");
        }

        const matchingProducts = state.products.filter(
            (product) => product.id === event.removedBatch.productId
        );
        const matchingBatches = state.inventoryBatches.filter(
            (batch) =>
                batch.productId === event.removedBatch.productId &&
                batch.variantId === event.removedBatch.variantId &&
                batch.batchId === event.removedBatch.batchId
        );
        if (matchingProducts.length !== 1 || matchingBatches.length !== 1) {
            throw new Error(`Batch not found: ${event.removedBatch.batchId}`);
        }
        const expectedEvent = buildBatchRemovalActivityInput(
            getRemovalOperationId(
                event.operationKey,
                "inventory.batch_removed:",
                event.removedBatch.batchId
            ),
            matchingProducts[0],
            matchingBatches[0],
            state.inventoryRecords,
            state.inventoryBatches,
            event.reason
        );
        if (expectedEvent.type !== "inventory.batch_removed") {
            throw new Error("Batch removal Activity could not be validated.");
        }
        assertActivityInputMatches(
            event,
            expectedEvent,
            "Batch removal Activity does not match current stock."
        );
    }

    const expectedBatches = state.inventoryBatches.filter((batch) =>
        !removedBatchKeys.has(JSON.stringify([
            batch.productId,
            batch.variantId,
            batch.batchId
        ]))
    );
    const batchIds = new Set(state.inventoryBatches.map((batch) => batch.batchId));
    const updatedBatchIds = new Set<string>();

    for (const event of action.events) {
        if (event.type !== "inventory.batch_updated") {
            continue;
        }
        const matches = expectedBatches.filter(
            (batch) =>
                batch.productId === event.before.productId &&
                batch.variantId === event.before.variantId &&
                batch.batchId === event.before.batchId
        );
        const product = state.products.find(
            (candidate) => candidate.id === event.before.productId
        );
        if (
            matches.length !== 1 ||
            !product ||
            updatedBatchIds.has(event.before.batchId) ||
            event.reason.trim() === "" ||
            event.reason !== event.reason.trim()
        ) {
            throw new Error(`Batch not found or updated more than once: ${event.before.batchId}`);
        }
        const currentBatch = matches[0];
        const before = snapshotBatch(currentBatch, product);
        const updatedBatch: inventoryBatch = {
            ...currentBatch,
            batchNumber: event.after.batchNumber,
            expiryDate: event.after.expiryDate === null
                ? null
                : new Date(event.after.expiryDate)
        };
        const identityCollision = findLogicalBatchMatches(
            expectedBatches,
            updatedBatch
        ).find((candidate) => candidate.batchId !== currentBatch.batchId);
        if (identityCollision) {
            throw new Error(
                "Batch metadata update collides with another logical batch identity."
            );
        }
        const operationId = getRemovalOperationId(
            event.operationKey,
            "inventory.batch_updated:",
            event.before.batchId
        );
        const expectedEvent = buildBatchUpdatedActivityInput(
            operationId,
            currentBatch,
            updatedBatch,
            product,
            event.reason
        );
        if (
            JSON.stringify(event.before) !== JSON.stringify(before) ||
            !expectedEvent ||
            event.after.productId !== event.before.productId ||
            event.after.variantId !== event.before.variantId ||
            event.after.batchId !== event.before.batchId
        ) {
            throw new Error("Batch update Activity does not match current inventory.");
        }
        assertActivityInputMatches(
            event,
            expectedEvent,
            "Batch update Activity does not match current inventory."
        );
        const index = expectedBatches.findIndex(
            (batch) =>
                batch.productId === currentBatch.productId &&
                batch.variantId === currentBatch.variantId &&
                batch.batchId === currentBatch.batchId
        );
        expectedBatches[index] = updatedBatch;
        updatedBatchIds.add(event.before.batchId);
    }

    const expectedRecords = state.inventoryRecords.filter((record) =>
        record.batchId === null || !removedBatchKeys.has(JSON.stringify([
            record.productId,
            record.variantId,
            record.batchId
        ]))
    );
    const recordIds = new Set(state.inventoryRecords.map((record) => record.id));
    const reservedIds = new Set([
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
    const convertedInventoryIds = new Set<string>();

    for (const event of action.events) {
        if (event.type !== "inventory.batch_created") {
            continue;
        }
        const inventorySnapshot = event.inventory;
        if (event.source !== "inventory_edit" || !inventorySnapshot) {
            throw new Error("A new Inventory batch requires unique batch and stock snapshots.");
        }

        const sourceRecords = state.inventoryRecords.filter(
            (record) => record.id === inventorySnapshot.inventoryId
        );
        const sourceRecord = sourceRecords.length === 1
            ? sourceRecords[0]
            : undefined;
        const isUnbatchedConversion = sourceRecord !== undefined &&
            sourceRecord.productId === event.batch.productId &&
            sourceRecord.variantId === event.batch.variantId &&
            sourceRecord.batchId === null;
        const hasUnbatchedRecord = state.inventoryRecords.some(
            (record) =>
                record.productId === event.batch.productId &&
                record.variantId === event.batch.variantId &&
                record.batchId === null
        );
        if (
            batchIds.has(event.batch.batchId) ||
            !event.batch.batchId.trim() ||
            (recordIds.has(inventorySnapshot.inventoryId) &&
                !isUnbatchedConversion) ||
            !inventorySnapshot.inventoryId.trim() ||
            reservedIds.has(event.batch.batchId) ||
            (reservedIds.has(inventorySnapshot.inventoryId) &&
                !isUnbatchedConversion) ||
            event.batch.batchId === inventorySnapshot.inventoryId
        ) {
            throw new Error("A new Inventory batch requires unique batch and stock snapshots.");
        }
        const product = state.products.find(
            (candidate) => candidate.id === event.batch.productId
        );
        const productVariant = product?.variant.find(
            (candidate) => candidate.id === event.batch.variantId
        );
        if (
            !product ||
            !productVariant ||
            event.batch.productName !== product.name ||
            event.batch.variantName !== productVariant.variantName ||
            inventorySnapshot.productId !== event.batch.productId ||
            inventorySnapshot.variantId !== event.batch.variantId ||
            inventorySnapshot.batch?.batchId !== event.batch.batchId ||
            expectedRecords.some((record) =>
                record.productId === event.batch.productId &&
                record.variantId === event.batch.variantId &&
                record.batchId === event.batch.batchId
            )
        ) {
            throw new Error("New batch Activity does not match its inventory snapshot.");
        }
        const operationId = getRemovalOperationId(
            event.operationKey,
            "inventory.batch_created:",
            event.batch.batchId
        );
        const batch = inventoryBatchFromSnapshot(event.batch);
        const identityCollision = findLogicalBatchMatches(
            [...expectedBatches, ...action.inventoryBatches],
            batch
        ).find((candidate) => candidate.batchId !== batch.batchId);
        if (identityCollision) {
            throw new Error(
                "A new inventory batch collides with an existing logical batch identity."
            );
        }
        const record = inventoryRecordFromSnapshot(inventorySnapshot);
        if (isUnbatchedConversion) {
            if (!sourceRecord) {
                throw new Error(
                    "Unbatched inventory record is no longer available for conversion."
                );
            }
            if (
                convertedInventoryIds.has(record.id) ||
                !inventoryStockQuantitiesEqual(
                    sourceRecord.stockQuantities,
                    record.stockQuantities
                )
            ) {
                throw new Error(
                    "Unbatched stock conversion must preserve the existing quantities."
                );
            }
        } else if (hasUnbatchedRecord) {
            throw new Error(
                "Unbatched inventory must be converted before adding another batch."
            );
        }
        validateInventoryRelationships(product, record, [
            ...expectedBatches,
            batch
        ]);
        assertActivityInputMatches(
            event,
            buildBatchCreatedActivityInput(operationId, product, batch, record),
            "New batch Activity does not match its inventory snapshot."
        );
        batchIds.add(batch.batchId);
        recordIds.add(record.id);
        reservedIds.add(batch.batchId);
        reservedIds.add(record.id);
        expectedBatches.push(batch);
        if (isUnbatchedConversion) {
            if (!sourceRecord) {
                throw new Error(
                    "Unbatched inventory record is no longer available for conversion."
                );
            }
            const sourceIndex = expectedRecords.findIndex(
                (candidate) =>
                    candidate.id === sourceRecord.id &&
                    candidate.batchId === null
            );
            if (sourceIndex === -1) {
                throw new Error(
                    "Unbatched inventory record is no longer available for conversion."
                );
            }
            expectedRecords[sourceIndex] = record;
            convertedInventoryIds.add(record.id);
        } else {
            expectedRecords.push(record);
        }
    }

    const changedStock = new Set<string>();
    for (const event of action.events) {
        if (event.type !== "inventory.stock_adjusted") {
            continue;
        }
        if (event.reason.trim() === "" || event.reason !== event.reason.trim()) {
            throw new Error("A reason is required for every stock adjustment.");
        }
        const key = JSON.stringify([
            event.inventoryId,
            event.packagingLevel.packagingLevelId
        ]);
        if (changedStock.has(key)) {
            throw new Error("Stock can only be adjusted once per packaging level in a save.");
        }
        changedStock.add(key);
        const recordIndex = expectedRecords.findIndex(
            (record) => record.id === event.inventoryId
        );
        const product = state.products.find(
            (candidate) => candidate.id === event.productId
        );
        const record = expectedRecords[recordIndex];
        if (
            recordIndex === -1 ||
            !product ||
            record.productId !== event.productId ||
            record.variantId !== event.variantId
        ) {
            throw new Error(`Inventory record not found: ${event.inventoryId}`);
        }
        const operationId = getRemovalOperationId(
            event.operationKey,
            "inventory.stock_adjusted:",
            `${event.inventoryId}:${event.packagingLevel.packagingLevelId}`
        );
        const adjustment = adjustInventoryStock(
            product,
            record,
            event.packagingLevel.packagingLevelId,
            event.newQuantity,
            event.reason
        );
        if (
            adjustment.adjustment.previousQuantity !== event.previousQuantity ||
            adjustment.adjustment.quantityDifference !== event.quantityDifference
        ) {
            throw new Error("Stock adjustment Activity does not match current quantity.");
        }
        assertActivityInputMatches(
            event,
            buildStockAdjustmentActivityInput(
                adjustment.adjustment,
                product,
                state.inventoryBatches,
                operationId
            ),
            "Stock adjustment Activity does not match current inventory."
        );
        expectedRecords[recordIndex] = adjustment.updatedInventory;
    }

    if (
        JSON.stringify(action.inventoryBatches) !== JSON.stringify(expectedBatches) ||
        JSON.stringify(action.inventoryRecords) !== JSON.stringify(expectedRecords)
    ) {
        throw new Error("Inventory save would remove or alter unrelated records.");
    }
    assertNoDuplicateLogicalBatchIdentities(expectedBatches);
}

function getProductStructureIds(product: productStructure): string[] {
    return [
        product.id,
        ...product.variant.flatMap((productVariant) => [
            productVariant.id,
            ...productVariant.packagingHierarchy.map((level) => level.id)
        ])
    ];
}

function getApplicationEntityIds(state: ApplicationState): Set<string> {
    return new Set([
        ...state.products.flatMap(getProductStructureIds),
        ...state.inventoryRecords.map((record) => record.id),
        ...state.inventoryBatches.map((batch) => batch.batchId)
    ]);
}

function validateProductStructure(product: productStructure): void {
    const ids = getProductStructureIds(product);
    if (
        !product.id.trim() ||
        product.id !== product.id.trim() ||
        !product.name.trim() ||
        product.name !== product.name.trim() ||
        [
            product.description,
            product.genericName,
            product.manufacturer,
            product.category
        ].some((value) =>
            value !== undefined && value !== value.trim()
        ) ||
        ids.some((id) => !id.trim() || id !== id.trim()) ||
        new Set(ids).size !== ids.length
    ) {
        throw new Error("Product contains invalid or duplicate identifiers.");
    }

    if (product.variant.length === 0) {
        throw new Error("Product must contain at least one variant.");
    }

    for (const productVariant of product.variant) {
        if (
            !productVariant.variantName.trim() ||
            productVariant.variantName !== productVariant.variantName.trim() ||
            (productVariant.nafdacRegistrationNumber !== undefined &&
                (!productVariant.nafdacRegistrationNumber.trim() ||
                    productVariant.nafdacRegistrationNumber !==
                        productVariant.nafdacRegistrationNumber.trim())) ||
            productVariant.id === product.id
        ) {
            throw new Error("Product contains an invalid variant.");
        }
        if (productVariant.packagingHierarchy.some(
            (level) => level.name !== level.name.trim()
        )) {
            throw new Error("Packaging level names must be trimmed.");
        }
        validatePackagingHierarchy(productVariant.packagingHierarchy);
        validateVariantLowStockThreshold(productVariant);
    }
}

function validateFreshActivityEvents(
    state: ApplicationState,
    events: readonly ActivityEvent[]
): void {
    const eventIds = new Set(state.activityEvents.map((event) => event.eventId));
    const operationKeys = new Set(
        state.activityEvents.map((event) => event.operationKey)
    );
    for (const event of events) {
        if (
            !event.eventId.trim() ||
            !Number.isFinite(Date.parse(event.occurredAt)) ||
            !event.operationKey.trim() ||
            eventIds.has(event.eventId) ||
            operationKeys.has(event.operationKey)
        ) {
            throw new Error("Product Activity contains invalid or duplicate metadata.");
        }
        eventIds.add(event.eventId);
        operationKeys.add(event.operationKey);
    }
}

function validateReplayActivityMetadata(
    events: readonly ActivityEvent[]
): void {
    const eventIds = new Set<string>();
    const operationKeys = new Set<string>();
    for (const event of events) {
        if (
            !event.eventId.trim() ||
            !isCanonicalActivityTimestamp(event.occurredAt) ||
            !event.operationKey.trim() ||
            eventIds.has(event.eventId) ||
            operationKeys.has(event.operationKey)
        ) {
            throw new Error("Product Activity contains invalid or duplicate metadata.");
        }
        eventIds.add(event.eventId);
        operationKeys.add(event.operationKey);
    }
}

function validateProductCreationPayload(
    state: ApplicationState,
    product: productStructure,
    inventoryRecords: readonly inventory[],
    inventoryBatches: readonly inventoryBatch[],
    errorPrefix: string
): void {
    validateProductStructure(product);
    if (product.variant.some(
        (productVariant) =>
            productVariant.packagingHierarchy.length > 0 &&
            productVariant.lowStockThreshold === undefined
    )) {
        throw new Error(
            `${errorPrefix} requires a low-stock threshold for every new variant.`
        );
    }
    const existingIds = getApplicationEntityIds(state);
    const newIds = [
        ...getProductStructureIds(product),
        ...inventoryRecords.map((record) => record.id),
        ...inventoryBatches.map((batch) => batch.batchId)
    ];
    if (
        newIds.some((id) =>
            !id.trim() ||
            id !== id.trim() ||
            existingIds.has(id)
        ) ||
        new Set(newIds).size !== newIds.length
    ) {
        throw new Error(`${errorPrefix} contains an invalid or duplicate ID.`);
    }

    const batchIds = new Set<string>();
    for (const batch of inventoryBatches) {
        if (
            batch.productId !== product.id ||
            batchIds.has(batch.batchId) ||
            !product.variant.some((item) => item.id === batch.variantId) ||
            (batch.batchNumber !== null &&
                (!batch.batchNumber.trim() ||
                    batch.batchNumber !== batch.batchNumber.trim())) ||
            (batch.expiryDate !== null &&
                (!(batch.expiryDate instanceof Date) ||
                    !Number.isFinite(batch.expiryDate.getTime())))
        ) {
            throw new Error(`${errorPrefix} contains an invalid batch relationship.`);
        }
        const productVariant = getVariantById(product, batch.variantId);
        validateBatchPricingCollection(
            batch.pricingByPackagingLevel,
            productVariant.packagingHierarchy.map((level) => level.id)
        );
        snapshotBatch(batch, product);
        batchIds.add(batch.batchId);
    }

    const inventoryLocations = new Set<string>();
    for (const record of inventoryRecords) {
        if (
            record.productId !== product.id ||
            record.stockQuantities.length === 0
        ) {
            throw new Error(`${errorPrefix} contains an invalid inventory record.`);
        }
        const location = JSON.stringify([record.variantId, record.batchId]);
        if (inventoryLocations.has(location)) {
            throw new Error(`${errorPrefix} contains duplicate inventory locations.`);
        }
        inventoryLocations.add(location);
        validateInventoryRelationships(product, record, [...inventoryBatches]);
    }
}

function validateProductCreationReplay(
    state: ApplicationState,
    result: Extract<ApplicationAction, { type: "product.created" }>["result"],
    submittedEvents: readonly ActivityEvent[]
): void {
    const errorMessage =
        "Product creation replay does not match the previously committed operation.";
    validateReplayActivityMetadata(submittedEvents);
    const productId = result.product.id;
    if (result.inventoryBatches.some((batch) => batch.productId !== productId)) {
        throw new Error(errorMessage);
    }

    const expectedEvents = buildProductCreationActivityInputs(
        result.product,
        result.inventoryRecords,
        result.inventoryBatches
    );
    const expectedPrimaryEvent = expectedEvents.find(
        (event) => event.type === "product.created"
    );
    if (
        !expectedPrimaryEvent ||
        expectedEvents.length !== submittedEvents.length
    ) {
        throw new Error(errorMessage);
    }

    const originalPrimaryEvents = state.activityEvents.filter(
        (event) => event.operationKey === expectedPrimaryEvent.operationKey
    );
    if (
        originalPrimaryEvents.length !== 1 ||
        originalPrimaryEvents[0]?.type !== "product.created"
    ) {
        throw new Error(errorMessage);
    }

    const expectedByOperationKey = new Map(
        expectedEvents.map((event) => [event.operationKey, event])
    );
    const submittedByOperationKey = new Map(
        submittedEvents.map((event) => [event.operationKey, event])
    );
    if (
        expectedByOperationKey.size !== expectedEvents.length ||
        submittedByOperationKey.size !== submittedEvents.length
    ) {
        throw new Error(errorMessage);
    }

    const originalByOperationKey = new Map<string, ActivityEvent>();
    for (const [operationKey, expectedEvent] of expectedByOperationKey) {
        const matchingOriginalEvents = state.activityEvents.filter(
            (event) => event.operationKey === operationKey
        );
        if (matchingOriginalEvents.length !== 1) {
            throw new Error(errorMessage);
        }

        const originalEvent = matchingOriginalEvents[0];
        if (
            (expectedEvent.type === "product.created" &&
                originalEvent.type !== "product.created") ||
            (expectedEvent.type === "inventory.batch_created" &&
                (
                    originalEvent.type !== "inventory.batch_created" ||
                    originalEvent.source !== "product_creation" ||
                    originalEvent.batch.productId !== productId
                ))
        ) {
            throw new Error(errorMessage);
        }
        originalByOperationKey.set(operationKey, originalEvent);
    }

    for (const [operationKey, expectedEvent] of expectedByOperationKey) {
        const submittedEvent = submittedByOperationKey.get(operationKey);
        const originalEvent = originalByOperationKey.get(operationKey);
        if (!submittedEvent || !originalEvent) {
            throw new Error(errorMessage);
        }
        assertActivityInputMatches(submittedEvent, expectedEvent, errorMessage);
        assertActivityInputMatches(originalEvent, expectedEvent, errorMessage);
    }
}

function validateCatalogueProductReplay(
    product: productStructure,
    submittedEvents: readonly ActivityEvent[],
    originalCreationEvent: Extract<ActivityEvent, { type: "product.created" }>
): void {
    const errorMessage =
        "Catalogue product creation replay does not match the previously committed operation.";
    validateReplayActivityMetadata(submittedEvents);

    const expectedEvents = buildProductCreationActivityInputs(product, [], []);
    if (
        expectedEvents.length !== 1 ||
        expectedEvents[0]?.type !== "product.created" ||
        submittedEvents.length !== 1 ||
        submittedEvents[0]?.type !== "product.created"
    ) {
        throw new Error(errorMessage);
    }

    assertActivityInputMatches(
        submittedEvents[0],
        expectedEvents[0],
        errorMessage
    );
    assertActivityInputMatches(
        originalCreationEvent,
        expectedEvents[0],
        errorMessage
    );
}

function productFromActivitySnapshot(
    snapshot: ActivityProductSnapshot
): productStructure {
    return {
        id: snapshot.productId,
        name: snapshot.productName,
        ...(snapshot.description === undefined
            ? {}
            : { description: snapshot.description }),
        ...(snapshot.genericName === undefined
            ? {}
            : { genericName: snapshot.genericName }),
        ...(snapshot.manufacturer === undefined
            ? {}
            : { manufacturer: snapshot.manufacturer }),
        ...(snapshot.category === undefined
            ? {}
            : { category: snapshot.category }),
        variant: snapshot.variants.map((productVariant) => ({
            id: productVariant.variantId,
            variantName: productVariant.variantName,
            ...(productVariant.nafdacRegistrationNumber === undefined
                ? {}
                : {
                    nafdacRegistrationNumber:
                        productVariant.nafdacRegistrationNumber
                }),
            ...(productVariant.lowStockThreshold === undefined
                ? {}
                : {
                    lowStockThreshold: {
                        quantity: productVariant.lowStockThreshold.quantity,
                        ...(productVariant.lowStockThreshold.packagingLevelId ===
                            undefined
                            ? {}
                            : {
                                packagingLevelId:
                                    productVariant.lowStockThreshold.packagingLevelId
                            })
                    }
                }),
            packagingHierarchy: productVariant.packaging.map((level) => ({
                id: level.packagingLevelId,
                name: level.name,
                costPrice: level.costPrice,
                sellingPrice: level.sellingPrice,
                quantityofNextLevel: level.quantityOfNextLevel,
                nextLevelId: level.nextLevelId
            }))
        }))
    };
}

function inventoryRecordsFromActivitySnapshot(
    records: readonly ActivityInventoryRecordStateSnapshot[]
): inventory[] {
    return records.map((record) => ({
        id: record.id,
        productId: record.productId,
        variantId: record.variantId,
        batchId: record.batchId,
        stockQuantities: record.stockQuantities.map((stock) => ({
            packagingLevelId: stock.packagingLevelId,
            quantity: stock.quantity
        }))
    }));
}

function inventoryBatchesFromActivitySnapshot(
    batches: readonly ActivityInventoryBatchStateSnapshot[]
): inventoryBatch[] {
    return batches.map((batch) => ({
        batchId: batch.batchId,
        productId: batch.productId,
        variantId: batch.variantId,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate === null
            ? null
            : new Date(batch.expiryDate),
        ...(batch.receivedDate === undefined
            ? {}
            : { receivedDate: batch.receivedDate }),
        pricingByPackagingLevel: batch.pricingByPackagingLevel.map(
            (pricing) => ({ ...pricing })
        )
    }));
}

function validateProductUpdateReplay(
    state: ApplicationState,
    action: Extract<ApplicationAction, { type: "product.updated" }>,
    submittedUpdateEvent: Extract<ActivityEvent, { type: "product.updated" }>
): void {
    const errorMessage =
        "Product update replay does not match the previously committed operation.";
    validateReplayActivityMetadata(action.events);

    const operationKey = submittedUpdateEvent.operationKey;
    const originalPrimaryEvents = state.activityEvents.filter(
        (event) => event.operationKey === operationKey
    );
    if (
        originalPrimaryEvents.length !== 1 ||
        originalPrimaryEvents[0]?.type !== "product.updated"
    ) {
        throw new Error(errorMessage);
    }

    const originalPrimaryEvent = originalPrimaryEvents[0];
    const historicalInventoryState = originalPrimaryEvent.inventoryStateAfter;
    if (
        !historicalInventoryState ||
        !Array.isArray(historicalInventoryState.inventoryRecords) ||
        !Array.isArray(historicalInventoryState.inventoryBatches)
    ) {
        throw new Error(errorMessage);
    }

    if (
        action.inventoryRecords !== undefined &&
        !activityValuesEqual(
            snapshotProductInventoryState(
                action.product.id,
                action.inventoryRecords,
                []
            ).inventoryRecords,
            historicalInventoryState.inventoryRecords
        )
    ) {
        throw new Error(errorMessage);
    }
    if (
        action.inventoryBatches !== undefined &&
        !activityValuesEqual(
            snapshotProductInventoryState(
                action.product.id,
                [],
                action.inventoryBatches
            ).inventoryBatches,
            historicalInventoryState.inventoryBatches
        )
    ) {
        throw new Error(errorMessage);
    }

    const historicalBeforeProduct = productFromActivitySnapshot(
        originalPrimaryEvent.before
    );
    validateProductStructure(action.product);
    const updateDraft = createProductUpdateDraftFromProduct(
        action.product,
        submittedUpdateEvent.reason
    );
    const updateErrors = validateProductUpdateDraft(
        updateDraft,
        historicalBeforeProduct
    );
    if (Object.keys(updateErrors).length > 0) {
        throw new Error(errorMessage);
    }
    const validatedProduct = buildUpdatedProduct(
        historicalBeforeProduct,
        updateDraft
    );
    if (!activityValuesEqual(
        snapshotProduct(validatedProduct),
        snapshotProduct(action.product)
    )) {
        throw new Error(errorMessage);
    }

    if (
        historicalInventoryState.inventoryRecords.some(
            (record) => record.productId !== action.product.id
        ) ||
        historicalInventoryState.inventoryBatches.some(
            (batch) => batch.productId !== action.product.id
        )
    ) {
        throw new Error(errorMessage);
    }

    const expectedEvents = buildProductUpdateActivityInputs(
        historicalBeforeProduct,
        action.product,
        [],
        inventoryRecordsFromActivitySnapshot(
            historicalInventoryState.inventoryRecords
        ),
        inventoryBatchesFromActivitySnapshot(
            historicalInventoryState.inventoryBatches
        ),
        operationKey,
        submittedUpdateEvent.reason
    );
    const stockAdjustmentPrefix =
        `inventory.stock_adjusted:${operationKey}:`;
    const originalStockAdjustmentEvents = state.activityEvents.filter(
        (event) => event.operationKey.startsWith(stockAdjustmentPrefix)
    );
    const originalEvents = [
        originalPrimaryEvent,
        ...originalStockAdjustmentEvents
    ];
    if (
        expectedEvents.length !== action.events.length ||
        expectedEvents.length !== originalEvents.length
    ) {
        throw new Error(errorMessage);
    }

    const expectedByOperationKey = new Map(
        expectedEvents.map((event) => [event.operationKey, event])
    );
    const submittedByOperationKey = new Map(
        action.events.map((event) => [event.operationKey, event])
    );
    const originalByOperationKey = new Map(
        originalEvents.map((event) => [event.operationKey, event])
    );
    if (
        expectedByOperationKey.size !== expectedEvents.length ||
        submittedByOperationKey.size !== action.events.length ||
        originalByOperationKey.size !== originalEvents.length
    ) {
        throw new Error(errorMessage);
    }

    for (const [eventOperationKey, expectedEvent] of expectedByOperationKey) {
        const submittedEvent = submittedByOperationKey.get(eventOperationKey);
        const originalEvent = originalByOperationKey.get(eventOperationKey);
        if (!submittedEvent || !originalEvent) {
            throw new Error(errorMessage);
        }
        assertActivityInputMatches(submittedEvent, expectedEvent, errorMessage);
        assertActivityInputMatches(originalEvent, expectedEvent, errorMessage);
    }
}

function createProductUpdateDraftFromProduct(
    product: productStructure,
    reason: string
): ProductUpdateDraft {
    return {
        id: product.id,
        name: product.name,
        description: product.description ?? "",
        genericName: product.genericName ?? "",
        manufacturer: product.manufacturer ?? "",
        category: product.category ?? "",
        reason,
        variants: product.variant.map((productVariant) => ({
            id: productVariant.id,
            name: productVariant.variantName,
            nafdacRegistrationNumber:
                productVariant.nafdacRegistrationNumber ?? "",
            lowStockThresholdQuantity:
                productVariant.lowStockThreshold === undefined
                    ? ""
                    : String(productVariant.lowStockThreshold.quantity),
            lowStockThresholdPackagingLevelId:
                productVariant.lowStockThreshold?.packagingLevelId ?? "",
            packaging: productVariant.packagingHierarchy.map((level) => ({
                id: level.id,
                name: level.name,
                nextLevelId: level.nextLevelId ?? "",
                quantityofNextLevel: level.quantityofNextLevel === null
                    ? ""
                    : String(level.quantityofNextLevel),
                costPrice: level.costPrice === null
                    ? ""
                    : String(level.costPrice),
                sellingPrice: level.sellingPrice === null
                    ? ""
                    : String(level.sellingPrice)
            }))
        }))
    };
}

function validateProductUpdateInventory(
    state: ApplicationState,
    product: productStructure,
    nextInventoryRecords: readonly inventory[],
    nextInventoryBatches: readonly inventoryBatch[]
): void {
    if (
        JSON.stringify(nextInventoryRecords) !==
            JSON.stringify(state.inventoryRecords) ||
        JSON.stringify(nextInventoryBatches) !==
            JSON.stringify(state.inventoryBatches)
    ) {
        throw new Error("Product update cannot modify inventory records or batches.");
    }

    for (const record of state.inventoryRecords) {
        if (record.productId === product.id) {
            validateInventoryRelationships(
                product,
                record,
                state.inventoryBatches
            );
        }
    }
}

function saleDraftMatchesCompletion(
    draft: SaleDraft,
    sale: CompletedSale
): boolean {
    return (
        draft.items.length === sale.items.length &&
        draft.customerName === sale.customerName &&
        draft.customerAddress === sale.customerAddress &&
        draft.saleDate === sale.saleDate &&
        JSON.stringify(draft.staffMember) === JSON.stringify(sale.staffMember) &&
        draft.notes === sale.notes &&
        draft.items.every((draftItem, index) => {
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
        })
    );
}

function saleContextFromCompletion(
    sale: CompletedSale,
    inventoryRecords: readonly inventory[]
): SaleContext {
    const products = new Map<string, productStructure>();
    const batches = new Map<string, inventoryBatch>();

    for (const item of sale.items) {
        const productSnapshot = item.product;
        const product: productStructure = {
            id: productSnapshot.productId,
            name: productSnapshot.productName,
            ...(productSnapshot.description === undefined
                ? {}
                : { description: productSnapshot.description }),
            ...(productSnapshot.genericName === undefined
                ? {}
                : { genericName: productSnapshot.genericName }),
            ...(productSnapshot.manufacturer === undefined
                ? {}
                : { manufacturer: productSnapshot.manufacturer }),
            ...(productSnapshot.category === undefined
                ? {}
                : { category: productSnapshot.category }),
            variant: productSnapshot.variants.map((variantSnapshot) => ({
                id: variantSnapshot.variantId,
                variantName: variantSnapshot.variantName,
                ...(variantSnapshot.nafdacRegistrationNumber === undefined
                    ? {}
                    : {
                        nafdacRegistrationNumber:
                            variantSnapshot.nafdacRegistrationNumber
                    }),
                packagingHierarchy: variantSnapshot.packaging.map((level) => ({
                    id: level.packagingLevelId,
                    name: level.name,
                    costPrice: level.costPrice,
                    sellingPrice: level.sellingPrice,
                    quantityofNextLevel: level.quantityOfNextLevel,
                    nextLevelId: level.nextLevelId
                }))
            }))
        };
        const existingProduct = products.get(product.id);
        if (
            existingProduct &&
            JSON.stringify(existingProduct) !== JSON.stringify(product)
        ) {
            throw new Error("Sale replay contains conflicting product snapshots.");
        }
        products.set(product.id, product);

        if (item.batch !== null) {
            const batchSnapshot = item.batch;
            const batch: inventoryBatch = {
                batchId: batchSnapshot.batchId,
                productId: batchSnapshot.productId,
                variantId: batchSnapshot.variantId,
                batchNumber: batchSnapshot.batchNumber,
                expiryDate: batchSnapshot.expiryDate === null
                    ? null
                    : new Date(batchSnapshot.expiryDate),
                ...(batchSnapshot.receivedDate === undefined
                    ? {}
                    : { receivedDate: batchSnapshot.receivedDate }),
                pricingByPackagingLevel:
                    batchSnapshot.pricingByPackagingLevel.map((pricing) => ({
                        packagingLevelId: pricing.packagingLevelId,
                        costPrice: pricing.costPrice,
                        sellingPrice: pricing.sellingPrice
                    }))
            };
            const existingBatch = batches.get(batch.batchId);
            if (
                existingBatch &&
                JSON.stringify(existingBatch) !== JSON.stringify(batch)
            ) {
                throw new Error("Sale replay contains conflicting batch snapshots.");
            }
            batches.set(batch.batchId, batch);
        }
    }

    return {
        products: [...products.values()],
        inventoryRecords,
        inventoryBatches: [...batches.values()]
    };
}

export function applicationReducer(
    state: ApplicationState,
    action: ApplicationAction
): ApplicationState {
    switch (action.type) {
        case "product.catalogue_created": {
            const operationKey = `product.created:${action.product.id}`;
            const originalOperationEvents = state.activityEvents.filter(
                (existing) => existing.operationKey === operationKey
            );
            const matchingProducts = state.products.filter(
                (product) => product.id === action.product.id
            );
            if (matchingProducts.length > 0) {
                if (originalOperationEvents.length === 0) {
                    validateProductCreationPayload(
                        state,
                        action.product,
                        [],
                        [],
                        "Catalogue product"
                    );
                }
                if (
                    matchingProducts.length !== 1 ||
                    originalOperationEvents.length !== 1 ||
                    originalOperationEvents[0]?.type !== "product.created"
                ) {
                    throw new Error(
                        "Catalogue product creation replay does not match the previously committed operation."
                    );
                }
                validateCatalogueProductReplay(
                    action.product,
                    action.events,
                    originalOperationEvents[0]
                );
                return state;
            }

            validateProductCreationPayload(
                state,
                action.product,
                [],
                [],
                "Catalogue product"
            );
            const draftLockMessages = getProductDraftLockMessages(
                action.product.id,
                state.saleDrafts,
                state.deliveryDrafts
            );
            if (draftLockMessages.length > 0) {
                throw new Error(draftLockMessages.join(" "));
            }

            const expectedEvents = buildProductCreationActivityInputs(
                action.product,
                [],
                []
            );
            if (action.events.length !== expectedEvents.length) {
                throw new Error(
                    "A catalogue product creation requires matching product Activity."
                );
            }
            validateFreshActivityEvents(state, action.events);
            action.events.forEach((event, index) =>
                assertActivityInputMatches(
                    event,
                    expectedEvents[index],
                    "A catalogue product creation requires matching product Activity."
                )
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
                !activityValuesEqual(
                    event.variant,
                    snapshotVariant(action.variant)
                )
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
                const originalEvents = state.activityEvents.filter(
                    (existing) => existing.operationKey === operationKey
                );
                const originalVariant = product.variant.find(
                    (candidate) => candidate.id === action.variant.id
                );
                if (
                    originalEvents.length !== 1 ||
                    originalEvents[0].type !== "product.variant_added" ||
                    originalVariant === undefined ||
                    !activityValuesEqual(
                        snapshotVariant(originalVariant),
                        snapshotVariant(action.variant)
                    ) ||
                    !activityValuesEqual(
                        activityInputFromEvent(originalEvents[0]),
                        activityInputFromEvent(event)
                    )
                ) {
                    throw new Error(
                        "Variant replay does not match the previously committed variant."
                    );
                }
                return state;
            }
            const draftLockMessages = getProductDraftLockMessages(
                action.productId,
                state.saleDrafts,
                state.deliveryDrafts
            );
            if (draftLockMessages.length > 0) {
                throw new Error(draftLockMessages.join(" "));
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
            if (action.variant.lowStockThreshold === undefined) {
                throw new Error(
                    "A new variant requires a low-stock threshold."
                );
            }
            validateVariantLowStockThreshold(action.variant);
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
            const matchingProducts = state.products.filter(
                (product) => product.id === action.result.product.id
            );
            const originalOperationEvents = state.activityEvents.filter(
                (event) => event.operationKey === operationKey
            );

            if (matchingProducts.length > 0 && originalOperationEvents.length > 0) {
                if (
                    matchingProducts.length !== 1
                ) {
                    throw new Error(
                        "Product creation replay does not match the previously committed operation."
                    );
                }
                validateProductCreationReplay(
                    state,
                    action.result,
                    action.events
                );
                return state;
            }
            if (matchingProducts.length > 0) {
                throw new Error(
                    `Product already exists: ${action.result.product.id}`
                );
            }
            validateProductCreationPayload(
                state,
                action.result.product,
                action.result.inventoryRecords,
                action.result.inventoryBatches,
                "Product creation"
            );
            const draftLockMessages = getProductDraftLockMessages(
                action.result.product.id,
                state.saleDrafts,
                state.deliveryDrafts
            );
            if (draftLockMessages.length > 0) {
                throw new Error(draftLockMessages.join(" "));
            }
            const expectedEvents = buildProductCreationActivityInputs(
                action.result.product,
                action.result.inventoryRecords,
                action.result.inventoryBatches
            );
            if (action.events.length !== expectedEvents.length) {
                throw new Error(
                    "Product creation requires matching product and initial inventory Activity."
                );
            }
            validateFreshActivityEvents(state, action.events);
            action.events.forEach((event, index) =>
                assertActivityInputMatches(
                    event,
                    expectedEvents[index],
                    "Product creation requires matching product and initial inventory Activity."
                )
            );

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
            if (
                event?.type === "product.deleted" &&
                event.reason.trim() === ""
            ) {
                throw new Error("A reason is required to delete a product.");
            }
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
                event.operationKey,
                event.reason
            );
            if (
                expectedEvent.type !== "product.deleted" ||
                event.reason !== expectedEvent.reason ||
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
            const nextInventoryRecords =
                action.inventoryRecords ?? state.inventoryRecords;
            const nextInventoryBatches =
                action.inventoryBatches ?? state.inventoryBatches;
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

            const submittedUpdateEvent = updateEvents[0];
            if (submittedUpdateEvent) {
                const stockAdjustmentPrefix =
                    `inventory.stock_adjusted:${submittedUpdateEvent.operationKey}:`;
                if (state.activityEvents.some(
                    (event) =>
                        event.operationKey === submittedUpdateEvent.operationKey ||
                        event.operationKey.startsWith(stockAdjustmentPrefix)
                )) {
                    validateProductUpdateReplay(
                        state,
                        action,
                        submittedUpdateEvent
                    );
                    return state;
                }
            }

            const productMatches = state.products.filter(
                (product) => product.id === action.product.id
            );
            if (productMatches.length !== 1) {
                throw new Error(`Product not found: ${action.product.id}`);
            }
            const previousProduct = productMatches[0];
            const thresholdRemovalBlockMessage =
                getProductPackagingThresholdRemovalBlockMessage(
                    previousProduct,
                    action.product
                );
            if (thresholdRemovalBlockMessage !== null) {
                throw new Error(thresholdRemovalBlockMessage);
            }
            const [updateEvent] = updateEvents;
            if (
                updateEvent.type !== "product.updated" ||
                !updateEvent.reason.trim()
            ) {
                throw new Error("A product update requires matching update Activity.");
            }

            validateProductStructure(action.product);
            const updateDraft = createProductUpdateDraftFromProduct(
                action.product,
                updateEvent.reason
            );
            const updateErrors = validateProductUpdateDraft(
                updateDraft,
                previousProduct
            );
            if (Object.keys(updateErrors).length > 0) {
                throw new Error(Object.values(updateErrors)[0]);
            }
            const validatedProduct = buildUpdatedProduct(
                previousProduct,
                updateDraft
            );
            if (
                JSON.stringify(snapshotProduct(validatedProduct)) !==
                JSON.stringify(snapshotProduct(action.product))
            ) {
                throw new Error("Product update contains invalid product data.");
            }

            const previousProductIds = new Set(
                getProductStructureIds(previousProduct)
            );
            const existingIds = getApplicationEntityIds(state);
            if (getProductStructureIds(action.product).some(
                (id) => !previousProductIds.has(id) && existingIds.has(id)
            )) {
                throw new Error("Product update contains a duplicate identifier.");
            }

            const changedInventoryProductIds = getChangedInventoryProductIds(
                state.inventoryRecords,
                state.inventoryBatches,
                nextInventoryRecords,
                nextInventoryBatches
            );
            const affectedProductIds = new Set(changedInventoryProductIds);
            if (JSON.stringify(previousProduct.variant) !==
                JSON.stringify(action.product.variant)) {
                affectedProductIds.add(action.product.id);
            }
            for (const productId of affectedProductIds) {
                const draftLockMessages = getProductDraftLockMessages(
                    productId,
                    state.saleDrafts,
                    state.deliveryDrafts
                );
                if (draftLockMessages.length > 0) {
                    throw new Error(draftLockMessages.join(" "));
                }
            }
            validateProductUpdateInventory(
                state,
                action.product,
                nextInventoryRecords,
                nextInventoryBatches
            );
            validateFreshActivityEvents(state, action.events);
            const expectedEvents = buildProductUpdateActivityInputs(
                previousProduct,
                action.product,
                state.inventoryRecords,
                nextInventoryRecords,
                nextInventoryBatches,
                updateEvent.operationKey,
                updateEvent.reason
            );
            if (action.events.length !== expectedEvents.length) {
                throw new Error("Product update Activity does not match the committed changes.");
            }
            action.events.forEach((event, index) => {
                const expectedEvent = expectedEvents[index];
                if (!expectedEvent) {
                    throw new Error("Product update Activity does not match the committed changes.");
                }
                assertActivityInputMatches(
                    event,
                    expectedEvent,
                    "Product update Activity does not match the committed changes."
                );
            });

            const productIndex = state.products.findIndex(
                (product) => product.id === action.product.id
            );
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
                action.events.length !== 1 ||
                action.events.some(
                    (event) =>
                        event.type !== "product.variant_removed" ||
                        event.productId !== action.product.id ||
                        event.removedVariant.variantId !== action.variantId ||
                        state.activityEvents.some(
                            (existing) => existing.operationKey === event.operationKey
                        )
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
            if (!state.products[productIndex].variant.some(
                (productVariant) => productVariant.id === action.variantId
            )) {
                throw new Error(`Variant not found: ${action.variantId}`);
            }
            const variantBlockers = getProductRecordDeletionBlockMessages(
                {
                    kind: "variant",
                    productId: action.product.id,
                    variantId: action.variantId
                },
                state.saleDrafts,
                state.deliveryDrafts,
                state.inventoryBatches
            );
            if (variantBlockers.length > 0) {
                throw new Error(variantBlockers.join(" "));
            }

            const currentProduct = state.products[productIndex];
            if (currentProduct.variant.length <= 1) {
                throw new Error(minimumProductVariantMessage);
            }
            const currentVariant = currentProduct.variant.find(
                (productVariant) => productVariant.id === action.variantId
            );
            const [event] = action.events;
            if (!currentVariant || event.type !== "product.variant_removed") {
                throw new Error("Variant removal Activity does not match the current product.");
            }
            if (event.reason.trim() === "") {
                throw new Error("A reason is required for every deletion.");
            }
            const expectedEvent = buildVariantRemovalActivityInput(
                getRemovalOperationId(
                    event.operationKey,
                    "product.variant_removed:",
                    action.variantId
                ),
                currentProduct,
                currentVariant,
                state.inventoryRecords,
                state.inventoryBatches,
                event.reason
            );
            if (expectedEvent.type !== "product.variant_removed") {
                throw new Error("Variant removal Activity could not be reconstructed.");
            }
            if (
                event.operationKey !== expectedEvent.operationKey ||
                JSON.stringify(event.removedVariant) !== JSON.stringify(expectedEvent.removedVariant) ||
                JSON.stringify(event.removedBatches) !== JSON.stringify(expectedEvent.removedBatches) ||
                JSON.stringify(event.affectedInventory) !== JSON.stringify(expectedEvent.affectedInventory)
            ) {
                throw new Error("Variant removal Activity does not match current inventory.");
            }
            const expectedRecords = state.inventoryRecords.filter(
                (record) =>
                    record.productId !== action.product.id ||
                    record.variantId !== action.variantId
            );
            const expectedBatches = state.inventoryBatches.filter(
                (batch) =>
                    batch.productId !== action.product.id ||
                    batch.variantId !== action.variantId
            );
            if (
                JSON.stringify(action.inventoryRecords) !== JSON.stringify(expectedRecords) ||
                JSON.stringify(action.inventoryBatches) !== JSON.stringify(expectedBatches)
            ) {
                throw new Error("Variant removal does not match its inventory records.");
            }

            const products = [...state.products];
            products[productIndex] = {
                ...currentProduct,
                variant: currentProduct.variant.filter(
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
                action.events.length !== 1 ||
                action.events.some(
                    (event) =>
                        event.type !== "product.packaging_removed" ||
                        event.productId !== action.product.id ||
                        event.variantId !== action.variantId ||
                        event.removedPackaging.packagingLevelId !== action.packagingLevelId ||
                        state.activityEvents.some(
                            (existing) => existing.operationKey === event.operationKey
                        )
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
            const currentVariant = state.products[productIndex].variant.find(
                (productVariant) => productVariant.id === action.variantId
            );
            if (!currentVariant?.packagingHierarchy.some(
                (level) => level.id === action.packagingLevelId
            )) {
                throw new Error(`Packaging level not found: ${action.packagingLevelId}`);
            }
            validateVariantLowStockThreshold(currentVariant);
            const thresholdBlockMessage =
                getPackagingLevelThresholdDeletionBlockMessage(
                    currentVariant,
                    action.packagingLevelId
                );
            if (thresholdBlockMessage !== null) {
                throw new Error(thresholdBlockMessage);
            }
            const packagingBlockers = getProductRecordDeletionBlockMessages(
                {
                    kind: "packaging",
                    productId: action.product.id,
                    variantId: action.variantId,
                    packagingLevelId: action.packagingLevelId
                },
                state.saleDrafts,
                state.deliveryDrafts
            );
            if (packagingBlockers.length > 0) {
                throw new Error(packagingBlockers.join(" "));
            }

            const currentProduct = state.products[productIndex];
            const nextHierarchy = removePackagingLevelFromHierarchy(
                currentVariant.packagingHierarchy,
                action.packagingLevelId
            );
            const [event] = action.events;
            if (event.type !== "product.packaging_removed") {
                throw new Error("Packaging removal Activity does not match the current product.");
            }
            if (event.reason.trim() === "") {
                throw new Error("A reason is required for every deletion.");
            }
            const expectedEvent = buildPackagingRemovalActivityInput(
                getRemovalOperationId(
                    event.operationKey,
                    "product.packaging_removed:",
                    action.packagingLevelId
                ),
                currentProduct,
                currentVariant,
                currentVariant.packagingHierarchy.find(
                    (level) => level.id === action.packagingLevelId
                )!,
                nextHierarchy,
                state.inventoryRecords,
                state.inventoryBatches,
                event.reason
            );
            if (expectedEvent.type !== "product.packaging_removed") {
                throw new Error("Packaging removal Activity could not be reconstructed.");
            }
            if (
                event.operationKey !== expectedEvent.operationKey ||
                JSON.stringify(event.removedPackaging) !== JSON.stringify(expectedEvent.removedPackaging) ||
                JSON.stringify(event.beforeHierarchy) !== JSON.stringify(expectedEvent.beforeHierarchy) ||
                JSON.stringify(event.afterHierarchy) !== JSON.stringify(expectedEvent.afterHierarchy) ||
                JSON.stringify(event.removedStock) !== JSON.stringify(expectedEvent.removedStock)
            ) {
                throw new Error("Packaging removal Activity does not match current inventory.");
            }
            const expectedRecords = state.inventoryRecords.flatMap((record) => {
                if (
                    record.productId !== action.product.id ||
                    record.variantId !== action.variantId ||
                    !record.stockQuantities.some(
                        (stock) => stock.packagingLevelId === action.packagingLevelId
                    )
                ) {
                    return [record];
                }
                const stockQuantities = record.stockQuantities.filter(
                    (stock) => stock.packagingLevelId !== action.packagingLevelId
                );
                return stockQuantities.length > 0
                    ? [{ ...record, stockQuantities }]
                    : [];
            });
            const expectedBatches = state.inventoryBatches.map((batch) =>
                batch.productId !== action.product.id ||
                batch.variantId !== action.variantId
                    ? batch
                    : {
                        ...batch,
                        pricingByPackagingLevel:
                            batch.pricingByPackagingLevel.filter(
                                (pricing) =>
                                    pricing.packagingLevelId !==
                                    action.packagingLevelId
                            )
                    }
            );
            if (
                JSON.stringify(action.inventoryRecords) !== JSON.stringify(expectedRecords) ||
                JSON.stringify(action.inventoryBatches) !== JSON.stringify(expectedBatches)
            ) {
                throw new Error("Packaging removal does not match its inventory records.");
            }

            const products = [...state.products];
            products[productIndex] = {
                ...currentProduct,
                variant: currentProduct.variant.map((productVariant) =>
                    productVariant.id !== action.variantId
                        ? productVariant
                        : {
                            ...productVariant,
                            packagingHierarchy: nextHierarchy
                        }
                )
            };

            return {
                ...state,
                products,
                inventoryRecords: action.inventoryRecords,
                inventoryBatches: expectedBatches,
                activityEvents: appendActivityEvents(
                    state.activityEvents,
                    action.events
                )
            };
        }
        case "product.records_deleted": {
            const productMatches = state.products.filter(
                (product) => product.id === action.productId
            );
            if (productMatches.length !== 1) {
                throw new Error(`Product not found: ${action.productId}`);
            }
            const hasProductUpdate = action.updatedProduct !== undefined;
            if (
                action.deletions.length === 0 ||
                action.events.length !==
                    action.deletions.length + (hasProductUpdate ? 1 : 0)
            ) {
                throw new Error("Every staged deletion requires matching Activity.");
            }
            const firstDeletion = action.deletions[0];
            const blockers = getProductRecordDeletionBlockMessages(
                firstDeletion.type === "variant"
                    ? {
                        kind: "variant",
                        productId: action.productId,
                        variantId: firstDeletion.variantId
                    }
                    : {
                        kind: "packaging",
                        productId: action.productId,
                        variantId: firstDeletion.variantId,
                        packagingLevelId: firstDeletion.packagingLevelId
                    },
                state.saleDrafts,
                state.deliveryDrafts
            );
            if (blockers.length > 0) {
                throw new Error(blockers.join(" "));
            }

            const plan = prepareProductRecordDeletionPlan(
                productMatches[0],
                state.inventoryRecords,
                state.inventoryBatches,
                action.deletions
            );
            const operationKeys = new Set<string>();
            for (let index = 0; index < action.deletions.length; index += 1) {
                const event = action.events[index];
                const expected = plan.events[index];
                if (!event) {
                    throw new Error("Deletion Activity does not match the staged changes.");
                }
                const { eventId, occurredAt, ...eventInput } = event;
                if (
                    !eventId.trim() ||
                    !Number.isFinite(Date.parse(occurredAt)) ||
                    operationKeys.has(event.operationKey) ||
                    state.activityEvents.some(
                        (existing) => existing.operationKey === event.operationKey
                    ) ||
                    JSON.stringify(eventInput) !== JSON.stringify(expected)
                ) {
                    throw new Error("Deletion Activity does not match the staged changes.");
                }
                operationKeys.add(event.operationKey);
            }
            if (action.updatedProduct) {
                const updateEvent = action.events[action.deletions.length];
                if (
                    action.updatedProduct.id !== action.productId ||
                    JSON.stringify(action.updatedProduct.variant) !==
                        JSON.stringify(plan.product.variant) ||
                    updateEvent?.type !== "product.updated" ||
                    updateEvent.productId !== action.productId ||
                    !updateEvent.reason.trim() ||
                    operationKeys.has(updateEvent.operationKey) ||
                    state.activityEvents.some(
                        (existing) =>
                            existing.operationKey === updateEvent.operationKey
                    )
                ) {
                    throw new Error(
                        "A product update accompanying deletion must preserve the deletion plan."
                    );
                }
                const expectedUpdateEvents = buildProductUpdateActivityInputs(
                    plan.product,
                    action.updatedProduct,
                    plan.inventoryRecords,
                    plan.inventoryRecords,
                    plan.inventoryBatches,
                    updateEvent.operationKey,
                    updateEvent.reason
                );
                const { eventId, occurredAt, ...eventInput } = updateEvent;
                if (
                    expectedUpdateEvents.length !== 1 ||
                    !eventId.trim() ||
                    !Number.isFinite(Date.parse(occurredAt)) ||
                    JSON.stringify(eventInput) !==
                        JSON.stringify(expectedUpdateEvents[0])
                ) {
                    throw new Error(
                        "Product update Activity does not match the staged deletion."
                    );
                }
                operationKeys.add(updateEvent.operationKey);
            }
            const nextActivityEvents = appendActivityEvents(
                state.activityEvents,
                action.events
            );
            if (nextActivityEvents.length !== state.activityEvents.length + action.events.length) {
                throw new Error("Deletion Activity could not be recorded.");
            }
            if (
                JSON.stringify(action.product) !== JSON.stringify(plan.product) ||
                JSON.stringify(action.inventoryRecords) !== JSON.stringify(plan.inventoryRecords) ||
                JSON.stringify(action.inventoryBatches) !== JSON.stringify(plan.inventoryBatches)
            ) {
                throw new Error("Deletion plan does not match current product inventory.");
            }

            const products = [...state.products];
            const productIndex = state.products.findIndex(
                (product) => product.id === action.productId
            );
            products[productIndex] = action.updatedProduct ?? plan.product;
            return {
                ...state,
                products,
                inventoryRecords: plan.inventoryRecords,
                inventoryBatches: plan.inventoryBatches,
                activityEvents: nextActivityEvents
            };
        }
        case "inventory.batch_removed": {
            if (
                action.events.length !== 1 ||
                action.events.some(
                    (event) =>
                        event.type !== "inventory.batch_removed" ||
                        event.removedBatch.productId !== action.productId ||
                        event.removedBatch.variantId !== action.variantId ||
                        event.removedBatch.batchId !== action.batchId ||
                        state.activityEvents.some(
                            (existing) => existing.operationKey === event.operationKey
                        )
                )
            ) {
                throw new Error("A batch removal requires matching removal Activity.");
            }
            if (!state.inventoryBatches.some(
                (batch) =>
                    batch.productId === action.productId &&
                    batch.variantId === action.variantId &&
                    batch.batchId === action.batchId
            )) {
                throw new Error(`Batch not found: ${action.batchId}`);
            }
            const batchBlockers = getProductRecordDeletionBlockMessages(
                {
                    kind: "batch",
                    productId: action.productId,
                    variantId: action.variantId,
                    batchId: action.batchId
                },
                state.saleDrafts,
                state.deliveryDrafts
            );
            if (batchBlockers.length > 0) {
                throw new Error(batchBlockers.join(" "));
            }
            const currentProduct = state.products.find(
                (product) => product.id === action.productId
            );
            const currentBatch = state.inventoryBatches.find(
                (batch) =>
                    batch.productId === action.productId &&
                    batch.variantId === action.variantId &&
                    batch.batchId === action.batchId
            );
            const [event] = action.events;
            if (!currentProduct || !currentBatch || event.type !== "inventory.batch_removed") {
                throw new Error("Batch removal Activity does not match the current inventory.");
            }
            if (event.reason.trim() === "") {
                throw new Error("A reason is required for every deletion.");
            }
            const expectedEvent = buildBatchRemovalActivityInput(
                getRemovalOperationId(
                    event.operationKey,
                    "inventory.batch_removed:",
                    action.batchId
                ),
                currentProduct,
                currentBatch,
                state.inventoryRecords,
                state.inventoryBatches,
                event.reason
            );
            if (expectedEvent.type !== "inventory.batch_removed") {
                throw new Error("Batch removal Activity could not be reconstructed.");
            }
            if (
                event.operationKey !== expectedEvent.operationKey ||
                JSON.stringify(event.removedBatch) !== JSON.stringify(expectedEvent.removedBatch) ||
                JSON.stringify(event.affectedInventory) !== JSON.stringify(expectedEvent.affectedInventory)
            ) {
                throw new Error("Batch removal Activity does not match current stock.");
            }
            const expectedRecords = state.inventoryRecords.filter(
                (record) =>
                    record.productId !== action.productId ||
                    record.variantId !== action.variantId ||
                    record.batchId !== action.batchId
            );
            const expectedBatches = state.inventoryBatches.filter(
                (batch) =>
                    batch.productId !== action.productId ||
                    batch.variantId !== action.variantId ||
                    batch.batchId !== action.batchId
            );
            if (
                JSON.stringify(action.inventoryRecords) !== JSON.stringify(expectedRecords) ||
                JSON.stringify(action.inventoryBatches) !== JSON.stringify(expectedBatches)
            ) {
                throw new Error("Batch removal does not match its inventory records.");
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
                        (existing) => existing.operationKey === event.operationKey
                    )
                )
            ) {
                validateInventorySaveReplay(state, action);
                return state;
            }
            validateInventoryDraftLocks(
                state,
                action.inventoryRecords,
                action.inventoryBatches
            );
            validateInventorySave(state, action);

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
            const operationKey = `sale.completed:${sale.saleId}`;
            if (
                events.length !== 1 ||
                events[0].type !== "sale.completed" ||
                events[0].saleId !== sale.saleId ||
                events[0].operationKey !== operationKey ||
                events[0].occurredAt !== sale.completedAt ||
                !sale.saleId.trim() ||
                !Number.isFinite(Date.parse(sale.completedAt)) ||
                sale.items.length === 0
            ) {
                throw new Error("A sale completion requires matching Activity.");
            }

            const draftId = action.completion.draftId;
            const expectedDraftValue = action.completion.expectedDraft;
            if (
                typeof draftId !== "string" ||
                draftId.trim() === "" ||
                !expectedDraftValue
            ) {
                throw new Error("Sale completion requires an active draft snapshot.");
            }
            const expectedDraft = validateSaleDraft(expectedDraftValue);
            if (
                expectedDraft.draftId !== draftId ||
                expectedDraft.status !== "draft" ||
                JSON.stringify(expectedDraft) !==
                    JSON.stringify(expectedDraftValue)
            ) {
                throw new Error("Sale completion requires a valid active draft snapshot.");
            }

            const matchingOperations = state.activityEvents.filter(
                (event) => event.operationKey === operationKey
            );
            if (matchingOperations.length > 0) {
                const existingOperation = matchingOperations[0];
                const existingSales = state.sales.filter(
                    (existing) => existing.saleId === sale.saleId
                );
                const matchingDrafts = state.saleDrafts.filter(
                    (draft) => draft.draftId === draftId
                );
                const activityMatches =
                    matchingOperations.length === 1 &&
                    existingOperation.type === "sale.completed" &&
                    existingOperation.operationKey === operationKey &&
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
                    !activityMatches ||
                    existingOperation.saleId !== sale.saleId ||
                    existingSales.length !== 1 ||
                    JSON.stringify(existingSales[0]) !== JSON.stringify(sale) ||
                    matchingDrafts.length !== 1 ||
                    matchingDrafts[0].status !== "approved"
                ) {
                    throw new Error(
                        "Sale operation key already exists without a matching completed sale."
                    );
                }

                const approvedDraft = validateSaleDraft(matchingDrafts[0]);
                const expectedApprovedDraft = validateSaleDraft({
                    ...expectedDraft,
                    status: "approved",
                    updatedAt: sale.completedAt
                });
                if (
                    JSON.stringify(approvedDraft) !==
                    JSON.stringify(expectedApprovedDraft)
                ) {
                    throw new Error(
                        "Sale replay does not match the approved draft."
                    );
                }

                if (!saleDraftMatchesCompletion(expectedDraft, sale)) {
                    throw new Error(
                        "Sale replay does not match the approved draft."
                    );
                }

                const replayExpectedIds = new Set(
                    expectedInventory.map((record) => record.id)
                );
                const replayUpdatedIds = new Set(
                    updatedInventory.map((record) => record.id)
                );
                const replayUpdatedById = new Map(
                    updatedInventory.map((record) => [record.id, record])
                );
                if (
                    expectedInventory.length === 0 ||
                    expectedInventory.length !== updatedInventory.length ||
                    replayExpectedIds.size !== expectedInventory.length ||
                    replayUpdatedIds.size !== updatedInventory.length ||
                    [...replayExpectedIds].some((id) => !replayUpdatedIds.has(id))
                ) {
                    throw new Error(
                        "Sale replay inventory records must be unique and complete."
                    );
                }

                for (const expectedRecord of expectedInventory) {
                    const updatedRecord = replayUpdatedById.get(expectedRecord.id);
                    if (
                        !updatedRecord ||
                        expectedRecord.productId !== updatedRecord.productId ||
                        expectedRecord.variantId !== updatedRecord.variantId ||
                        expectedRecord.batchId !== updatedRecord.batchId
                    ) {
                        throw new Error(
                            "Sale replay inventory identities do not match."
                        );
                    }
                }

                for (const updatedRecord of updatedInventory) {
                    const matchingRecords = state.inventoryRecords.filter(
                        (record) => record.id === updatedRecord.id
                    );
                    const matchingProducts = state.products.filter(
                        (product) => product.id === updatedRecord.productId
                    );
                    if (
                        typeof updatedRecord.id !== "string" ||
                        updatedRecord.id.trim() === "" ||
                        matchingRecords.length !== 1 ||
                        JSON.stringify(matchingRecords[0]) !==
                            JSON.stringify(updatedRecord) ||
                        matchingProducts.length !== 1
                    ) {
                        throw new Error(
                            "Sale replay inventory does not match the committed inventory."
                        );
                    }
                    validateInventoryRelationships(
                        matchingProducts[0],
                        updatedRecord,
                        [...state.inventoryBatches]
                    );
                }

                const replayReferencedIds = new Set<string>();
                for (const item of sale.items) {
                    const updatedRecord = replayUpdatedById.get(
                        item.inventoryRecordId
                    );
                    if (
                        !updatedRecord ||
                        updatedRecord.productId !== item.product.productId ||
                        updatedRecord.variantId !== item.variant.variantId ||
                        updatedRecord.batchId !== (item.batch?.batchId ?? null)
                    ) {
                        throw new Error(
                            "Sale replay inventory does not match its sale allocations."
                        );
                    }
                    replayReferencedIds.add(item.inventoryRecordId);
                }
                if (replayReferencedIds.size !== updatedInventory.length) {
                    throw new Error(
                        "Sale replay inventory does not match its sale allocations."
                    );
                }

                const replayPlan = prepareSaleDraft(
                    expectedDraft,
                    saleContextFromCompletion(sale, expectedInventory),
                    { now: () => new Date(sale.completedAt) }
                );
                const replayPlanExpectedById = new Map(
                    replayPlan.expectedInventory.map((record) => [record.id, record])
                );
                const replayPlanUpdatedById = new Map(
                    replayPlan.updatedInventory.map((record) => [record.id, record])
                );
                if (
                    replayPlan.expectedInventory.length !== expectedInventory.length ||
                    replayPlan.updatedInventory.length !== updatedInventory.length ||
                    replayPlan.linePlans.length !== sale.items.length ||
                    expectedInventory.some((record) =>
                        JSON.stringify(replayPlanExpectedById.get(record.id)) !==
                        JSON.stringify(record)
                    ) ||
                    updatedInventory.some((record) =>
                        JSON.stringify(replayPlanUpdatedById.get(record.id)) !==
                        JSON.stringify(record)
                    ) ||
                    replayPlan.linePlans.some((linePlan, index) => {
                        const item = sale.items[index];
                        return (
                            linePlan.product.id !== item.product.productId ||
                            linePlan.variant.id !== item.variant.variantId ||
                            linePlan.request.inventoryRecordId !==
                                item.inventoryRecordId ||
                            linePlan.request.batchId !==
                                (item.batch?.batchId ?? null) ||
                            linePlan.packagingLevel.id !==
                                item.packagingLevel.packagingLevelId ||
                            linePlan.request.quantity !== item.quantity ||
                            linePlan.defaultSellingPrice !==
                                item.defaultSellingPrice ||
                            linePlan.appliedSellingPrice !==
                                item.appliedSellingPrice ||
                            linePlan.subtotal !== item.subtotal ||
                            linePlan.discountAmount !== item.discountAmount ||
                            linePlan.finalAmount !== item.finalAmount ||
                            linePlan.expiredBatch !== item.expiredBatch
                        );
                    })
                ) {
                    throw new Error(
                        "Sale replay allocation does not match the committed inventory."
                    );
                }

                return state;
            }

            const draftIndex = state.saleDrafts.findIndex(
                (draft) => draft.draftId === draftId
            );
            const currentDraft = state.saleDrafts[draftIndex];
            if (
                draftIndex === -1 ||
                !currentDraft ||
                currentDraft.status !== "draft" ||
                JSON.stringify(validateSaleDraft(currentDraft)) !==
                    JSON.stringify(expectedDraft)
            ) {
                throw new Error(
                    "Sale draft changed after approval was prepared. Prepare the sale again."
                );
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
                    (item.defaultSellingPrice !== null &&
                        (!Number.isFinite(item.defaultSellingPrice) ||
                            item.defaultSellingPrice < 0)) ||
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

            if (!saleDraftMatchesCompletion(expectedDraft, sale)) {
                throw new Error(
                    "Sale draft changed after approval was prepared. Prepare the sale again."
                );
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

            if (state.sales.some((existing) => existing.saleId === sale.saleId)) {
                throw new Error(`Sale already exists: ${sale.saleId}`);
            }
            const saleDrafts = [...state.saleDrafts];
            saleDrafts[draftIndex] = validateSaleDraft({
                ...currentDraft,
                status: "approved",
                updatedAt: sale.completedAt
            });

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
        case "delivery.draft_cancelled": {
            const matchingDrafts = state.deliveryDrafts.filter(
                (draft) => draft.deliveryId === action.deliveryId
            );
            if (matchingDrafts.length !== 1) {
                throw new Error(`Delivery draft not found: ${action.deliveryId}`);
            }
            const draft = validateDeliveryDraft(matchingDrafts[0]);
            if (draft.status !== "draft") {
                throw new Error(`Cannot cancel a ${draft.status} delivery.`);
            }

            const { event } = action;
            const operationKey = `delivery.draft_cancelled:${draft.deliveryId}`;
            if (
                event.type !== "delivery.draft_cancelled" ||
                event.deliveryId !== draft.deliveryId ||
                event.operationKey !== operationKey ||
                !event.eventId.trim() ||
                !isCanonicalActivityTimestamp(event.occurredAt) ||
                state.activityEvents.some(
                    (existing) =>
                        existing.eventId === event.eventId ||
                        existing.operationKey === operationKey
                )
            ) {
                throw new Error("Delivery cancellation contains invalid Activity metadata.");
            }

            assertActivityInputMatches(
                event,
                buildDeliveryDraftCancellationActivityInput(draft, state.products),
                "Delivery cancellation Activity does not match the active draft."
            );
            const activityEvents = appendActivityEvents(
                state.activityEvents,
                [event]
            );
            if (activityEvents.length !== state.activityEvents.length + 1) {
                throw new Error("Delivery cancellation Activity could not be recorded.");
            }

            return {
                ...state,
                deliveryDrafts: state.deliveryDrafts.filter(
                    (candidate) => candidate.deliveryId !== draft.deliveryId
                ),
                activityEvents
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
                if (
                    existingEvent.type !== "delivery.received" ||
                    event.type !== "delivery.received" ||
                    !activityValuesEqual(event, existingEvent) ||
                    plan.draft.deliveryId !== existingEvent.deliveryId ||
                    !activityValuesEqual(plan.draft, currentDraft) ||
                    !activityValuesEqual(
                        plan.inventoryBatches,
                        state.inventoryBatches
                    ) ||
                    !activityValuesEqual(
                        plan.inventoryRecords,
                        state.inventoryRecords
                    ) ||
                    !activityValuesEqual(
                        plan.activity,
                        activityInputFromEvent(existingEvent)
                    )
                ) {
                    throw new Error(
                        "Delivery approval replay does not match the committed approval."
                    );
                }
                return state;
            }
            if (currentDraft.status !== "draft") {
                throw new Error(`Cannot approve a ${currentDraft.status} delivery.`);
            }
            const approvalTimestamp = Date.parse(plan.draft.updatedAt);
            if (
                !Number.isFinite(approvalTimestamp) ||
                !event.eventId.trim() ||
                state.activityEvents.some(
                    (existing) =>
                        existing.eventId === event.eventId ||
                        existing.operationKey === event.operationKey
                ) ||
                !Number.isFinite(Date.parse(event.occurredAt)) ||
                Date.parse(event.occurredAt) !== approvalTimestamp
            ) {
                throw new Error("Delivery approval contains invalid Activity metadata.");
            }

            const reservedIds = new Set([
                ...state.products.flatMap((product) => [
                    product.id,
                    ...product.variant.flatMap((productVariant) => [
                        productVariant.id,
                        ...productVariant.packagingHierarchy.map((level) => level.id)
                    ])
                ]),
                ...state.inventoryRecords.map((record) => record.id),
                ...state.inventoryBatches.map((batch) => batch.batchId)
            ]);
            let generatedIdIndex = 0;
            const expectedPlan = prepareDeliveryApproval(
                currentDraft,
                state.products,
                state.inventoryRecords,
                state.inventoryBatches,
                {
                    makeId: () => {
                        let candidate: string;
                        do {
                            candidate =
                                `__approval_validation_${currentDraft.deliveryId}_${generatedIdIndex++}`;
                        } while (reservedIds.has(candidate));
                        reservedIds.add(candidate);
                        return candidate;
                    },
                    now: () => new Date(approvalTimestamp)
                }
            );

            const existingBatchIds = new Set(
                state.inventoryBatches.map((batch) => batch.batchId)
            );
            const existingRecordIds = new Set(
                state.inventoryRecords.map((record) => record.id)
            );
            const expectedNewBatches = expectedPlan.inventoryBatches.filter(
                (batch) => !existingBatchIds.has(batch.batchId)
            );
            const submittedNewBatches = plan.inventoryBatches.filter(
                (batch) => !existingBatchIds.has(batch.batchId)
            );
            const expectedNewRecords = expectedPlan.inventoryRecords.filter(
                (record) => !existingRecordIds.has(record.id)
            );
            const submittedNewRecords = plan.inventoryRecords.filter(
                (record) => !existingRecordIds.has(record.id)
            );
            if (
                expectedNewBatches.length !== submittedNewBatches.length ||
                expectedNewRecords.length !== submittedNewRecords.length
            ) {
                throw new Error("Delivery approval does not match the active draft.");
            }

            const submittedGeneratedIds = new Set(reservedIds);
            const submittedBatchIdMap = new Map<string, string>();
            expectedNewBatches.forEach((batch, index) => {
                const submittedBatch = submittedNewBatches[index];
                if (
                    !submittedBatch?.batchId.trim() ||
                    submittedBatch.batchId !== submittedBatch.batchId.trim() ||
                    submittedGeneratedIds.has(submittedBatch.batchId)
                ) {
                    throw new Error("Delivery approval contains duplicate generated IDs.");
                }
                submittedGeneratedIds.add(submittedBatch.batchId);
                submittedBatchIdMap.set(batch.batchId, submittedBatch.batchId);
            });
            const submittedRecordIdMap = new Map<string, string>();
            expectedNewRecords.forEach((record, index) => {
                const submittedRecord = submittedNewRecords[index];
                if (
                    !submittedRecord?.id.trim() ||
                    submittedRecord.id !== submittedRecord.id.trim() ||
                    submittedGeneratedIds.has(submittedRecord.id)
                ) {
                    throw new Error("Delivery approval contains duplicate generated IDs.");
                }
                submittedGeneratedIds.add(submittedRecord.id);
                submittedRecordIdMap.set(record.id, submittedRecord.id);
            });

            const expectedInventoryBatches = expectedPlan.inventoryBatches.map(
                (batch) => ({
                    ...batch,
                    batchId: submittedBatchIdMap.get(batch.batchId) ?? batch.batchId
                })
            );
            const expectedInventoryRecords = expectedPlan.inventoryRecords.map(
                (record) => ({
                    ...record,
                    id: submittedRecordIdMap.get(record.id) ?? record.id,
                    batchId: record.batchId === null
                        ? null
                        : submittedBatchIdMap.get(record.batchId) ?? record.batchId
                })
            );
            const expectedReceivedItemAssociations =
                expectedPlan.receivedItemAssociations.map((association) => ({
                    ...association,
                    inventoryRecordId:
                        submittedRecordIdMap.get(association.inventoryRecordId) ??
                        association.inventoryRecordId,
                    batchId:
                        submittedBatchIdMap.get(association.batchId) ??
                        association.batchId
                }));
            if (expectedPlan.activity.type !== "delivery.received") {
                throw new Error("Delivery approval planner returned an invalid Activity.");
            }
            const expectedActivity: ActivityEventInput = {
                ...expectedPlan.activity,
                items: expectedPlan.activity.items.map((item) => ({
                    ...item,
                    batch: item.batch === null
                        ? null
                        : {
                            ...item.batch,
                            batchId:
                                submittedBatchIdMap.get(item.batch.batchId) ??
                                item.batch.batchId
                        }
                }))
            };
            const receivedDraft = validateDeliveryDraft(plan.draft);
            if (
                JSON.stringify(receivedDraft) !== JSON.stringify(expectedPlan.draft) ||
                JSON.stringify(plan.inventoryBatches) !==
                    JSON.stringify(expectedInventoryBatches) ||
                JSON.stringify(plan.inventoryRecords) !==
                    JSON.stringify(expectedInventoryRecords) ||
                JSON.stringify(plan.receivedItemAssociations) !==
                    JSON.stringify(expectedReceivedItemAssociations) ||
                event.type !== "delivery.received" ||
                JSON.stringify(activityInputFromEvent(event)) !==
                    JSON.stringify(expectedActivity)
            ) {
                throw new Error("Delivery approval does not match the active draft.");
            }

            for (const record of expectedInventoryRecords) {
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
                    expectedInventoryBatches
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
                inventoryRecords: expectedInventoryRecords,
                inventoryBatches: expectedInventoryBatches,
                deliveryDrafts,
                activityEvents
            };
        }
    }
}
