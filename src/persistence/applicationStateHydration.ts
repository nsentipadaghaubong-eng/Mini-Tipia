import type { ActivityEvent } from "../activity/activity";
import type { DeliveryDraft } from "../deliveries/deliveryDraft";
import type { inventory } from "../inventory/inventoryStock";
import type { inventoryBatch } from "../inventory/inventoryBatch";
import type { productStructure } from "../products/productStructure";
import type { CompletedSale, CompletedSaleItem } from "../sales/salesEngine";
import type { SaleDraft } from "../sales/salesDraft";
import {
    adaptPersistedDeliveryDraft,
    adaptPersistedSaleDraft
} from "./domainAdapters";
import type {
    ApplicationDataAssembly,
    CompletedSaleData,
    ReceivedDeliveryData
} from "./applicationDataLoader";
import {
    parseCompletedSaleItemSnapshot,
    parseReceivedDeliveryItemSnapshot
} from "./historicalSerialization";
import type {
    PersistedDeliveryDraft
} from "./repositories/receiveDeliveryDraftRepository";
import type {
    PersistedSaleDraft
} from "./repositories/salesDraftRepository";
import type {
    PersistedReceivedDelivery,
    PersistedReceivedDeliveryItem
} from "./repositories/receiveDeliveryRepository";
import type { PersistedSale } from "./repositories/salesRepository";

export type DomainProjection<TDomain> =
    | {
        readonly status: "available";
        readonly value: TDomain;
    }
    | {
        readonly status: "persistence-only";
        readonly reason: string;
        readonly incompatibleFields?: readonly string[];
    };

export interface HydratedRecord<TSourceRecord, TDomain> {
    readonly sourceRecord: TSourceRecord;
    readonly domainProjection: DomainProjection<TDomain>;
    readonly persistenceOnlyFields: readonly string[];
}

export type InventoryRecordAssociation =
    | {
        readonly status: "recorded";
        readonly inventoryRecordId: string;
        readonly currentTargetStatus: "present" | "not-currently-present";
    }
    | {
        readonly status: "unresolved";
        readonly inventoryRecordId: null;
        readonly reason: "inventory-record-association-not-recorded";
    }
    | {
        readonly status: "invalid";
        readonly inventoryRecordId: string;
        readonly reason: "does-not-match-current-inventory-record";
    };

export interface ReceivedDeliveryItemAssociation {
    readonly deliveryItemId: string;
    readonly batchId: string;
    readonly inventoryRecordAssociation: InventoryRecordAssociation;
}

export interface HydratedReceivedDelivery
    extends HydratedRecord<PersistedReceivedDelivery, DeliveryDraft> {
    readonly itemInventoryAssociations: readonly ReceivedDeliveryItemAssociation[];
}

export interface ApplicationStateHydration {
    readonly products: readonly HydratedRecord<productStructure, productStructure>[];
    readonly inventoryRecords: readonly HydratedRecord<inventory, inventory>[];
    readonly inventoryBatches: readonly HydratedRecord<inventoryBatch, inventoryBatch>[];
    readonly activityEvents: readonly HydratedRecord<ActivityEvent, ActivityEvent>[];
    readonly completedSales: readonly HydratedRecord<PersistedSale, CompletedSale>[];
    readonly receivedDeliveries: readonly HydratedReceivedDelivery[];
    readonly activeSaleDrafts: readonly HydratedRecord<PersistedSaleDraft, SaleDraft>[];
    readonly activeDeliveryDrafts: readonly HydratedRecord<
        PersistedDeliveryDraft,
        DeliveryDraft
    >[];
    readonly persistenceLimitations: readonly string[];
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
    if (actual !== expected) {
        throw new Error(`Hydration ${label} does not match its persisted record.`);
    }
}

function assertSameValue(actual: unknown, expected: unknown, label: string): void {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Hydration ${label} does not match its persisted record.`);
    }
}

function assertSaleItemMatchesRecord(
    saleId: string,
    persisted: PersistedSale["items"][number],
    snapshot: CompletedSaleItem
): void {
    const label = `Sale ${saleId} item ${persisted.lineId}`;
    assertEqual(snapshot.lineId, persisted.lineId, `${label} line ID`);
    assertEqual(
        snapshot.inventoryRecordId,
        persisted.inventoryRecordId,
        `${label} Inventory ID`
    );
    assertEqual(snapshot.product.productId, persisted.productId, `${label} Product ID`);
    assertEqual(snapshot.variant.variantId, persisted.variantId, `${label} Variant ID`);
    assertEqual(snapshot.batch?.batchId ?? null, persisted.batchId, `${label} batch ID`);
    assertEqual(
        snapshot.packagingLevel.packagingLevelId,
        persisted.packagingLevelId,
        `${label} packaging ID`
    );
    assertEqual(snapshot.quantity, persisted.quantity, `${label} quantity`);
    assertEqual(
        snapshot.defaultSellingPrice,
        persisted.defaultSellingPrice,
        `${label} default selling price`
    );
    assertEqual(
        snapshot.appliedSellingPrice,
        persisted.appliedSellingPrice,
        `${label} applied selling price`
    );
    assertEqual(snapshot.subtotal, persisted.subtotal, `${label} subtotal`);
    assertEqual(snapshot.discountAmount, persisted.discountAmount, `${label} discount`);
    assertEqual(snapshot.finalAmount, persisted.finalAmount, `${label} final amount`);
    assertEqual(snapshot.expiredBatch, persisted.expiredBatch, `${label} expiry flag`);
}

function completedSaleProjection(sale: PersistedSale): CompletedSale {
    const items = sale.items.map((item) => {
        const snapshot = parseCompletedSaleItemSnapshot(item.itemSnapshotJson);
        assertSaleItemMatchesRecord(sale.saleId, item, snapshot);
        return snapshot;
    });
    if (items.length === 0) {
        throw new Error(`Hydration Sale ${sale.saleId} has no projectable items.`);
    }

    return {
        saleId: sale.saleId,
        completedAt: sale.completedAt,
        ...(sale.customerName === null ? {} : { customerName: sale.customerName }),
        ...(sale.customerAddress === null
            ? {}
            : { customerAddress: sale.customerAddress }),
        ...(sale.saleDate === null ? {} : { saleDate: sale.saleDate }),
        ...(sale.staffUserId === null && sale.staffDisplayName === null
            ? {}
            : {
                staffMember: {
                    ...(sale.staffUserId === null ? {} : { userId: sale.staffUserId }),
                    ...(sale.staffDisplayName === null
                        ? {}
                        : { displayName: sale.staffDisplayName })
                }
            }),
        ...(sale.notes === null ? {} : { notes: sale.notes }),
        items,
        subtotal: sale.subtotal,
        discountAmount: sale.discountAmount,
        finalAmount: sale.finalAmount,
        expiredBatchConfirmed: sale.expiredBatchConfirmed
    };
}

function assertReceivedItemMatchesRecord(
    deliveryId: string,
    persisted: PersistedReceivedDeliveryItem
): void {
    const snapshot = parseReceivedDeliveryItemSnapshot(
        persisted.receiptSnapshotJson
    );
    const label = `Delivery ${deliveryId} item ${persisted.deliveryItemId}`;
    assertEqual(snapshot.deliveryItemId, persisted.deliveryItemId, `${label} ID`);
    assertEqual(snapshot.productId, persisted.productId, `${label} Product ID`);
    assertEqual(snapshot.variantId, persisted.variantId, `${label} Variant ID`);
    assertEqual(
        snapshot.packagingLevel.packagingLevelId,
        persisted.packagingLevelId,
        `${label} packaging ID`
    );
    assertEqual(snapshot.quantity, persisted.quantity, `${label} quantity`);
    assertEqual(
        snapshot.batch?.batchId ?? null,
        persisted.receivedBatchId,
        `${label} received batch ID`
    );
    assertEqual(
        snapshot.batch?.batchNumber ?? null,
        persisted.batchNumber,
        `${label} batch number`
    );
    assertEqual(
        snapshot.batch?.expiryDate?.slice(0, 10) ?? null,
        persisted.expiryDate,
        `${label} expiry date`
    );
    assertEqual(
        snapshot.pricingAtReceipt.packagingLevelId,
        persisted.packagingLevelId,
        `${label} pricing packaging ID`
    );
    assertEqual(
        snapshot.pricingAtReceipt.costPrice,
        persisted.costPrice,
        `${label} cost price`
    );
    assertEqual(
        snapshot.pricingAtReceipt.sellingPrice,
        persisted.sellingPrice,
        `${label} selling price`
    );
    if (
        snapshot.batch &&
        (
            snapshot.batch.productId !== persisted.productId ||
            snapshot.batch.variantId !== persisted.variantId
        )
    ) {
        throw new Error(`${label} batch snapshot has inconsistent Product/Variant IDs.`);
    }
}

function receivedDeliveryProjection(
    delivery: PersistedReceivedDelivery
): DeliveryDraft {
    for (const item of delivery.items) {
        assertReceivedItemMatchesRecord(delivery.deliveryId, item);
    }
    return {
        deliveryId: delivery.deliveryId,
        status: "received",
        createdAt: delivery.createdAt,
        updatedAt: delivery.updatedAt,
        deliveryDate: delivery.deliveryDate,
        receivedBy: delivery.receivedBy,
        ...(delivery.supplierName === null
            ? {}
            : { supplier: delivery.supplierName }),
        ...(delivery.invoiceNumber === null
            ? {}
            : { invoiceNumber: delivery.invoiceNumber }),
        items: delivery.items.map((item) => ({
            deliveryItemId: item.deliveryItemId,
            productId: item.productId,
            variantId: item.variantId,
            packagingLevelId: item.packagingLevelId,
            quantity: item.quantity,
            batchNumber: item.batchNumber,
            expiryDate: item.expiryDate,
            costPrice: item.costPrice,
            sellingPrice: item.sellingPrice
        }))
    };
}

function projectionForHistoricalRecord<TDomain>(
    recordName: string,
    domain: TDomain | null,
    projectionIssue: string | undefined
): DomainProjection<TDomain> {
    if (domain !== null) {
        if (projectionIssue !== undefined) {
            throw new Error(
                `Hydration ${recordName} has both a domain projection and a projection issue.`
            );
        }
        return { status: "available", value: domain };
    }
    if (!projectionIssue) {
        throw new Error(
            `Hydration ${recordName} has no domain projection or persistence-only reason.`
        );
    }
    return { status: "persistence-only", reason: projectionIssue };
}

function hydrateCompletedSale(
    data: CompletedSaleData
): HydratedRecord<PersistedSale, CompletedSale> {
    const domainProjection = projectionForHistoricalRecord(
        `Sale ${data.persistence.saleId}`,
        data.domain,
        data.projectionIssue
    );
    if (domainProjection.status === "available") {
        const expected = completedSaleProjection(data.persistence);
        assertSameValue(
            domainProjection.value,
            expected,
            `Sale ${data.persistence.saleId} domain projection`
        );
    }
    return {
        sourceRecord: data.persistence,
        domainProjection,
        persistenceOnlyFields: data.persistenceOnlyFields
    };
}

function hydrateReceivedDelivery(
    data: ReceivedDeliveryData,
    inventoryRecordsById: ReadonlyMap<string, inventory>
): HydratedReceivedDelivery {
    if (data.persistence.items.length === 0) {
        throw new Error(
            `Hydration received Delivery ${data.persistence.deliveryId} has no items.`
        );
    }
    const domainProjection = projectionForHistoricalRecord(
        `received Delivery ${data.persistence.deliveryId}`,
        data.domain,
        data.projectionIssue
    );
    if (domainProjection.status === "available") {
        const expected = receivedDeliveryProjection(data.persistence);
        assertSameValue(
            domainProjection.value,
            expected,
            `received Delivery ${data.persistence.deliveryId} domain projection`
        );
    }
    return {
        sourceRecord: data.persistence,
        domainProjection,
        persistenceOnlyFields: data.persistenceOnlyFields,
        itemInventoryAssociations: data.persistence.items.map((item) => ({
            deliveryItemId: item.deliveryItemId,
            batchId: item.receivedBatchId,
            inventoryRecordAssociation: inventoryRecordAssociation(
                item,
                inventoryRecordsById
            )
        }))
    };
}

function inventoryRecordAssociation(
    item: PersistedReceivedDeliveryItem,
    inventoryRecordsById: ReadonlyMap<string, inventory>
): InventoryRecordAssociation {
    const inventoryRecordId = item.receivedInventoryId;
    if (inventoryRecordId === null) {
        return {
            status: "unresolved",
            inventoryRecordId: null,
            reason: "inventory-record-association-not-recorded"
        };
    }

    const currentRecord = inventoryRecordsById.get(inventoryRecordId);
    if (!currentRecord) {
        return {
            status: "recorded",
            inventoryRecordId,
            currentTargetStatus: "not-currently-present"
        };
    }
    if (
        currentRecord.productId !== item.productId ||
        currentRecord.variantId !== item.variantId ||
        currentRecord.batchId !== item.receivedBatchId
    ) {
        return {
            status: "invalid",
            inventoryRecordId,
            reason: "does-not-match-current-inventory-record"
        };
    }
    return {
        status: "recorded",
        inventoryRecordId,
        currentTargetStatus: "present"
    };
}

function hydrateActiveSaleDraft(
    projection: ApplicationDataAssembly["activeSaleDrafts"][number]
): HydratedRecord<PersistedSaleDraft, SaleDraft> {
    const expected = adaptPersistedSaleDraft(projection.persistence);
    assertSameValue(
        projection.domain,
        expected.domain,
        `Sale draft ${projection.persistence.draftId} domain projection`
    );
    return {
        sourceRecord: projection.persistence,
        domainProjection: {
            status: "available",
            value: projection.domain
        },
        persistenceOnlyFields: projection.persistenceOnlyFields
    };
}

function hydrateActiveDeliveryDraft(
    projection: ApplicationDataAssembly["activeDeliveryDrafts"][number]
): HydratedRecord<PersistedDeliveryDraft, DeliveryDraft> {
    const expected = adaptPersistedDeliveryDraft(projection.persistence);
    if (projection.domain === null) {
        if (
            expected.domain !== null ||
            JSON.stringify(projection.incompatibleFields) !==
                JSON.stringify(expected.incompatibleFields)
        ) {
            throw new Error(
                `Hydration Delivery draft ${projection.persistence.deliveryId} has inconsistent projection status.`
            );
        }
        return {
            sourceRecord: projection.persistence,
            domainProjection: {
                status: "persistence-only",
                reason:
                    `Required domain header values are NULL: ${projection.incompatibleFields.join(", ")}.`,
                incompatibleFields: projection.incompatibleFields
            },
            persistenceOnlyFields: projection.persistenceOnlyFields
        };
    }
    if (
        expected.domain === null ||
        JSON.stringify(projection.domain) !== JSON.stringify(expected.domain)
    ) {
        throw new Error(
            `Hydration Delivery draft ${projection.persistence.deliveryId} domain projection does not match its persisted record.`
        );
    }
    return {
        sourceRecord: projection.persistence,
        domainProjection: {
            status: "available",
            value: projection.domain
        },
        persistenceOnlyFields: projection.persistenceOnlyFields
    };
}

function availableRecord<T>(
    sourceRecord: T
): HydratedRecord<T, T> {
    return {
        sourceRecord,
        domainProjection: {
            status: "available",
            value: sourceRecord
        },
        persistenceOnlyFields: []
    };
}

export function createApplicationStateHydration(
    data: ApplicationDataAssembly
): ApplicationStateHydration {
    const activityEventIds = new Set<string>();
    for (const event of data.activityEvents) {
        if (activityEventIds.has(event.eventId)) {
            throw new Error(
                `Hydration contains duplicate Activity event ID ${event.eventId}.`
            );
        }
        activityEventIds.add(event.eventId);
    }
    const inventoryRecordsById = new Map(
        data.inventoryRecords.map((record) => [record.id, record])
    );

    return {
        products: data.products.map(availableRecord),
        inventoryRecords: data.inventoryRecords.map(availableRecord),
        inventoryBatches: data.inventoryBatches.map(availableRecord),
        activityEvents: data.activityEvents.map(availableRecord),
        completedSales: data.completedSales.map(hydrateCompletedSale),
        receivedDeliveries: data.receivedDeliveries.map((delivery) =>
            hydrateReceivedDelivery(delivery, inventoryRecordsById)
        ),
        activeSaleDrafts: data.activeSaleDrafts.map(hydrateActiveSaleDraft),
        activeDeliveryDrafts: data.activeDeliveryDrafts.map(
            hydrateActiveDeliveryDraft
        ),
        persistenceLimitations: data.persistenceLimitations
    };
}
