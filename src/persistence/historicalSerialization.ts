import type {
    ActivityBatchSnapshot,
    ActivityEvent,
    ActivityInventoryBatchStateSnapshot,
    ActivityInventoryRecordStateSnapshot,
    ActivityInventorySnapshot,
    ActivityPackagingSnapshot,
    ActivityProductInventoryStateSnapshot,
    ActivityProductSnapshot,
    ActivityRemovedPackagingStockSnapshot,
    ActivityStockSnapshot,
    ActivityVariantSnapshot
} from "../activity/activity";
import type { CompletedSaleItem } from "../sales/salesEngine";
import { hasAtMostTwoDecimalPlaces } from "../pricing/pricePrecision";
import type { BatchPackagingPricing } from "../inventory/inventoryBatch";

export interface ReceivedDeliveryItemSnapshot {
    readonly deliveryItemId: string;
    readonly productId: string;
    readonly productName: string;
    readonly variantId: string;
    readonly variantName: string;
    readonly packagingLevel: ActivityPackagingSnapshot;
    readonly quantity: number;
    readonly batch: ActivityBatchSnapshot | null;
    readonly pricingAtReceipt: BatchPackagingPricing;
}

export interface PersistedActivityEvent {
    readonly eventId: string;
    readonly operationKey: string;
    readonly eventType: ActivityEvent["type"];
    readonly occurredAt: string;
    readonly actorId: string | null;
    readonly eventJson: string;
}

export interface ActivityEventMetadata {
    readonly eventId: string;
    readonly operationKey: string;
    readonly eventType: string;
    readonly occurredAt: string;
    readonly actorId: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
    return typeof value === "string";
}

function isOptionalString(value: unknown): boolean {
    return value === undefined || isString(value);
}

function isNullableString(value: unknown): boolean {
    return value === null || isString(value);
}

function isNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function isMoney(value: unknown): boolean {
    return isNumber(value) &&
        value >= 0 &&
        hasAtMostTwoDecimalPlaces(value);
}

function isNullableMoney(value: unknown): boolean {
    return value === null || isMoney(value);
}

function isPositiveInteger(value: unknown): boolean {
    return typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value > 0;
}

function isNonNegativeInteger(value: unknown): boolean {
    return typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value >= 0;
}

function isArrayOf<T>(
    value: unknown,
    predicate: (entry: unknown) => entry is T
): value is T[] {
    return Array.isArray(value) && value.every(predicate);
}

function isPackaging(value: unknown): value is ActivityPackagingSnapshot {
    if (!isRecord(value)) {
        return false;
    }
    return isString(value.packagingLevelId) &&
        isString(value.name) &&
        isNullableMoney(value.costPrice) &&
        isNullableMoney(value.sellingPrice) &&
        (value.quantityOfNextLevel === null || isNumber(value.quantityOfNextLevel)) &&
        isNullableString(value.nextLevelId) &&
        isNullableString(value.nextLevelName);
}

function isVariant(value: unknown): value is ActivityVariantSnapshot {
    if (!isRecord(value)) {
        return false;
    }
    if (
        !isString(value.variantId) ||
        !isString(value.variantName) ||
        !isOptionalString(value.nafdacRegistrationNumber) ||
        !isArrayOf(value.packaging, isPackaging)
    ) {
        return false;
    }
    if (value.lowStockThreshold === undefined) {
        return true;
    }
    return isRecord(value.lowStockThreshold) &&
        isNumber(value.lowStockThreshold.quantity) &&
        isOptionalString(value.lowStockThreshold.packagingLevelId);
}

function isProduct(value: unknown): value is ActivityProductSnapshot {
    return isRecord(value) &&
        isString(value.productId) &&
        isString(value.productName) &&
        isOptionalString(value.description) &&
        isOptionalString(value.genericName) &&
        isOptionalString(value.manufacturer) &&
        isOptionalString(value.category) &&
        isArrayOf(value.variants, isVariant);
}

function isBatch(value: unknown): value is ActivityBatchSnapshot {
    if (
        !isRecord(value) ||
        !isString(value.batchId) ||
        !isString(value.productId) ||
        !isString(value.productName) ||
        !isString(value.variantId) ||
        !isString(value.variantName) ||
        !isNullableString(value.batchNumber) ||
        !isNullableString(value.expiryDate) ||
        !isOptionalString(value.receivedDate) ||
        !Array.isArray(value.pricingByPackagingLevel)
    ) {
        return false;
    }
    return value.pricingByPackagingLevel.every((entry: unknown) =>
        isRecord(entry) &&
        isString(entry.packagingLevelId) &&
        isNullableMoney(entry.costPrice) &&
        isNullableMoney(entry.sellingPrice) &&
        isString(entry.packagingLevelName)
    );
}

function isStock(value: unknown): value is ActivityStockSnapshot {
    return isRecord(value) &&
        isPackaging(value.packagingLevel) &&
        isNonNegativeInteger(value.quantity);
}

function isInventory(value: unknown): value is ActivityInventorySnapshot {
    return isRecord(value) &&
        isString(value.inventoryId) &&
        isString(value.productId) &&
        isString(value.productName) &&
        isString(value.variantId) &&
        isString(value.variantName) &&
        (value.batch === null || isBatch(value.batch)) &&
        isArrayOf(value.stock, isStock);
}

function isInventoryRecordState(
    value: unknown
): value is ActivityInventoryRecordStateSnapshot {
    return isRecord(value) &&
        isString(value.id) &&
        isString(value.productId) &&
        isString(value.variantId) &&
        isNullableString(value.batchId) &&
        Array.isArray(value.stockQuantities) &&
        value.stockQuantities.every((stock: unknown) =>
            isRecord(stock) &&
            isString(stock.packagingLevelId) &&
            isNonNegativeInteger(stock.quantity)
        );
}

function isInventoryBatchState(
    value: unknown
): value is ActivityInventoryBatchStateSnapshot {
    return isRecord(value) &&
        isString(value.batchId) &&
        isString(value.productId) &&
        isString(value.variantId) &&
        isNullableString(value.batchNumber) &&
        isNullableString(value.expiryDate) &&
        isOptionalString(value.receivedDate) &&
        Array.isArray(value.pricingByPackagingLevel) &&
        value.pricingByPackagingLevel.every((entry: unknown) =>
            isRecord(entry) &&
            isString(entry.packagingLevelId) &&
            isNullableMoney(entry.costPrice) &&
            isNullableMoney(entry.sellingPrice)
        );
}

function isProductInventoryState(
    value: unknown
): value is ActivityProductInventoryStateSnapshot {
    return isRecord(value) &&
        isArrayOf(value.inventoryRecords, isInventoryRecordState) &&
        isArrayOf(value.inventoryBatches, isInventoryBatchState);
}

function isRemovedPackagingStock(
    value: unknown
): value is ActivityRemovedPackagingStockSnapshot {
    return isRecord(value) &&
        isString(value.inventoryId) &&
        (value.batch === null || isBatch(value.batch)) &&
        isNonNegativeInteger(value.quantity);
}

function isSaleItemSnapshot(value: unknown): value is CompletedSaleItem {
    return isRecord(value) &&
        isString(value.lineId) &&
        isProduct(value.product) &&
        isVariant(value.variant) &&
        (value.batch === null || isBatch(value.batch)) &&
        isString(value.inventoryRecordId) &&
        isPackaging(value.packagingLevel) &&
        isPositiveInteger(value.quantity) &&
        isNullableMoney(value.defaultSellingPrice) &&
        isMoney(value.appliedSellingPrice) &&
        isMoney(value.subtotal) &&
        isMoney(value.discountAmount) &&
        isMoney(value.finalAmount) &&
        typeof value.expiredBatch === "boolean";
}

function isReceivedDeliveryItemSnapshot(
    value: unknown
): value is ReceivedDeliveryItemSnapshot {
    return isRecord(value) &&
        isString(value.deliveryItemId) &&
        isString(value.productId) &&
        isString(value.productName) &&
        isString(value.variantId) &&
        isString(value.variantName) &&
        isPackaging(value.packagingLevel) &&
        isPositiveInteger(value.quantity) &&
        (value.batch === null || isBatch(value.batch)) &&
        isRecord(value.pricingAtReceipt) &&
        isString(value.pricingAtReceipt.packagingLevelId) &&
        isNullableMoney(value.pricingAtReceipt.costPrice) &&
        isNullableMoney(value.pricingAtReceipt.sellingPrice);
}

function isActivityReceivedItem(
    value: unknown
): value is Record<string, unknown> {
    return isRecord(value) &&
        isString(value.productId) &&
        isString(value.productName) &&
        isString(value.variantId) &&
        isString(value.variantName) &&
        (value.batch === null || isBatch(value.batch)) &&
        isRecord(value.pricingAtReceipt) &&
        isString(value.pricingAtReceipt.packagingLevelId) &&
        isNullableMoney(value.pricingAtReceipt.costPrice) &&
        isNullableMoney(value.pricingAtReceipt.sellingPrice) &&
        isArrayOf(value.stock, isStock);
}

function isActivityEvent(value: unknown): value is ActivityEvent {
    if (
        !isRecord(value) ||
        !isString(value.eventId) ||
        value.eventId.trim() === "" ||
        !isString(value.operationKey) ||
        value.operationKey.trim() === "" ||
        !isString(value.occurredAt) ||
        !Number.isFinite(Date.parse(value.occurredAt)) ||
        !isOptionalString(value.actorId) ||
        !isString(value.type)
    ) {
        return false;
    }

    switch (value.type) {
        case "product.created":
            return isProduct(value.product) &&
                isArrayOf(value.initialInventory, isInventory);
        case "product.updated":
            return isString(value.productId) &&
                isString(value.productName) &&
                isProduct(value.before) &&
                isProduct(value.after) &&
                isString(value.reason) &&
                (value.inventoryStateAfter === undefined ||
                    isProductInventoryState(value.inventoryStateAfter));
        case "product.deleted":
            return isString(value.productId) &&
                isString(value.productName) &&
                isProduct(value.product) &&
                isArrayOf(value.inventory, isInventory) &&
                isArrayOf(value.batches, isBatch) &&
                isString(value.reason);
        case "product.variant_added":
            return isString(value.productId) &&
                isString(value.productName) &&
                isVariant(value.variant) &&
                isString(value.reason);
        case "product.variant_updated":
            return isString(value.productId) &&
                isString(value.productName) &&
                isVariant(value.before) &&
                isVariant(value.after) &&
                isString(value.reason);
        case "product.variant_removed":
            return isString(value.productId) &&
                isString(value.productName) &&
                isVariant(value.removedVariant) &&
                isArrayOf(value.removedBatches, isBatch) &&
                isArrayOf(value.affectedInventory, isInventory) &&
                isString(value.reason);
        case "product.packaging_added":
            return isString(value.productId) &&
                isString(value.productName) &&
                isString(value.variantId) &&
                isString(value.variantName) &&
                isPackaging(value.packaging) &&
                isString(value.reason);
        case "product.packaging_updated":
            return isString(value.productId) &&
                isString(value.productName) &&
                isString(value.variantId) &&
                isString(value.variantName) &&
                isPackaging(value.before) &&
                isPackaging(value.after) &&
                isString(value.reason);
        case "product.packaging_removed":
            return isString(value.productId) &&
                isString(value.productName) &&
                isString(value.variantId) &&
                isString(value.variantName) &&
                isPackaging(value.removedPackaging) &&
                isArrayOf(value.beforeHierarchy, isPackaging) &&
                isArrayOf(value.afterHierarchy, isPackaging) &&
                isArrayOf(value.removedStock, isRemovedPackagingStock) &&
                isString(value.reason);
        case "inventory.batch_created":
            return (value.source === "product_creation" ||
                value.source === "inventory_edit") &&
                isBatch(value.batch) &&
                (value.inventory === undefined || isInventory(value.inventory));
        case "inventory.batch_updated":
            return isBatch(value.before) &&
                isBatch(value.after) &&
                isString(value.reason);
        case "inventory.batch_removed":
            return isBatch(value.removedBatch) &&
                isArrayOf(value.affectedInventory, isInventory) &&
                isString(value.reason);
        case "inventory.stock_adjusted":
            return isString(value.inventoryId) &&
                isString(value.productId) &&
                isString(value.productName) &&
                isString(value.variantId) &&
                isString(value.variantName) &&
                (value.batch === null || isBatch(value.batch)) &&
                isPackaging(value.packagingLevel) &&
                isNumber(value.previousQuantity) &&
                isNumber(value.newQuantity) &&
                isNumber(value.quantityDifference) &&
                isString(value.reason);
        case "delivery.received":
            return isString(value.deliveryId) &&
                isString(value.deliveryDate) &&
                isString(value.receivedBy) &&
                isNullableString(value.supplierName) &&
                isNullableString(value.invoiceNumber) &&
                isArrayOf(value.items, isActivityReceivedItem);
        case "delivery.draft_cancelled":
            return isString(value.deliveryId) &&
                isString(value.createdAt) &&
                isString(value.updatedAt) &&
                isString(value.deliveryDate) &&
                isString(value.receivedBy) &&
                isNullableString(value.supplierName) &&
                isNullableString(value.invoiceNumber) &&
                Array.isArray(value.items) &&
                value.items.every((item: unknown) =>
                    isRecord(item) &&
                    isString(item.deliveryItemId) &&
                    isString(item.productId) &&
                    isString(item.productName) &&
                    isString(item.variantId) &&
                    isString(item.variantName) &&
                    isPackaging(item.packagingLevel) &&
                    isPositiveInteger(item.quantity) &&
                    isNullableString(item.batchNumber) &&
                    isNullableString(item.expiryDate) &&
                    isNullableMoney(item.costPrice) &&
                    isNullableMoney(item.sellingPrice)
                );
        case "sale.completed":
            return isString(value.saleId) &&
                isOptionalString(value.customerName) &&
                isOptionalString(value.customerAddress) &&
                isOptionalString(value.saleDate) &&
                (value.staffMember === undefined ||
                    (isRecord(value.staffMember) &&
                        isOptionalString(value.staffMember.userId) &&
                        isOptionalString(value.staffMember.displayName))) &&
                isOptionalString(value.notes) &&
                isMoney(value.subtotal) &&
                isMoney(value.discountAmount) &&
                isMoney(value.finalAmount) &&
                typeof value.expiredBatchConfirmed === "boolean" &&
                Array.isArray(value.items) &&
                value.items.every((item: unknown) =>
                    isRecord(item) &&
                    isString(item.productId) &&
                    isString(item.productName) &&
                    isString(item.variantId) &&
                    isString(item.variantName) &&
                    isProduct(item.product) &&
                    isVariant(item.variant) &&
                    isPackaging(item.packagingLevel) &&
                    isPositiveInteger(item.quantity) &&
                    isNullableMoney(item.defaultSellingPrice) &&
                    isMoney(item.appliedSellingPrice) &&
                    isMoney(item.subtotal) &&
                    isMoney(item.discountAmount) &&
                    isMoney(item.finalAmount) &&
                    Array.isArray(item.allocations) &&
                    item.allocations.every((allocation: unknown) =>
                        isRecord(allocation) &&
                        isString(allocation.inventoryId) &&
                        (allocation.batch === null || isBatch(allocation.batch)) &&
                        isPositiveInteger(allocation.quantity)
                    )
                );
        default:
            return false;
    }
}

function parseJson(json: string, label: string): unknown {
    try {
        return JSON.parse(json) as unknown;
    } catch {
        throw new Error(`Persisted ${label} contains invalid JSON.`);
    }
}

export function serializeCompletedSaleItemSnapshot(
    item: CompletedSaleItem
): string {
    if (!isSaleItemSnapshot(item)) {
        throw new Error("Completed Sale item snapshot is invalid.");
    }
    return JSON.stringify(item);
}

export function parseCompletedSaleItemSnapshot(
    json: string
): CompletedSaleItem {
    const snapshot = parseJson(json, "Sale item snapshot");
    if (!isSaleItemSnapshot(snapshot)) {
        throw new Error("Persisted Sale item snapshot is invalid.");
    }
    return snapshot;
}

export function serializeReceivedDeliveryItemSnapshot(
    item: ReceivedDeliveryItemSnapshot
): string {
    if (!isReceivedDeliveryItemSnapshot(item)) {
        throw new Error("Received Delivery item snapshot is invalid.");
    }
    return JSON.stringify(item);
}

export function parseReceivedDeliveryItemSnapshot(
    json: string
): ReceivedDeliveryItemSnapshot {
    const snapshot = parseJson(json, "Delivery receipt snapshot");
    if (!isReceivedDeliveryItemSnapshot(snapshot)) {
        throw new Error("Persisted Delivery receipt snapshot is invalid.");
    }
    return snapshot;
}

export function serializeActivityEvent(
    event: ActivityEvent
): PersistedActivityEvent {
    if (!isActivityEvent(event)) {
        throw new Error("Activity event is invalid.");
    }
    return {
        eventId: event.eventId,
        operationKey: event.operationKey,
        eventType: event.type,
        occurredAt: event.occurredAt,
        actorId: event.actorId ?? null,
        eventJson: JSON.stringify(event)
    };
}

export function parseActivityEvent(
    eventJson: string,
    metadata: ActivityEventMetadata
): ActivityEvent {
    const event = parseJson(eventJson, "Activity event");
    if (!isActivityEvent(event)) {
        throw new Error("Persisted Activity event is invalid.");
    }
    if (
        event.eventId !== metadata.eventId ||
        event.operationKey !== metadata.operationKey ||
        event.type !== metadata.eventType ||
        event.occurredAt !== metadata.occurredAt ||
        (metadata.actorId === null
            ? event.actorId !== undefined
            : event.actorId !== metadata.actorId)
    ) {
        throw new Error(
            "Persisted Activity event JSON does not match its relational metadata."
        );
    }
    return event;
}
