import type { ActivityEvent } from "../activity/activity";
import type { DeliveryDraft } from "../deliveries/deliveryDraft";
import type { inventory } from "../inventory/inventoryStock";
import type { inventoryBatch } from "../inventory/inventoryBatch";
import type { productStructure } from "../products/productStructure";
import {
    getAllActivityEvents
} from "./repositories/activityRepository";
import {
    getAllInventory
} from "./repositories/inventoryRepository";
import {
    getAllProducts
} from "./repositories/productRepository";
import {
    getAllReceivedDeliveries,
    type PersistedReceivedDelivery,
    type PersistedReceivedDeliveryItem
} from "./repositories/receiveDeliveryRepository";
import {
    getAllActiveDeliveryDrafts,
    type PersistedDeliveryDraft
} from "./repositories/receiveDeliveryDraftRepository";
import {
    getAllSales,
    type PersistedSale,
    type PersistedSaleItem
} from "./repositories/salesRepository";
import {
    getAllActiveSaleDrafts,
    type PersistedSaleDraft
} from "./repositories/salesDraftRepository";
import {
    adaptPersistedDeliveryDrafts,
    adaptPersistedSaleDrafts,
    type DeliveryDraftDomainProjection,
    type PersistedDomainProjection
} from "./domainAdapters";
import {
    parseCompletedSaleItemSnapshot,
    parseReceivedDeliveryItemSnapshot
} from "./historicalSerialization";
import {
    createSqliteReadSnapshotExecutor,
    type SqliteQueryExecutor
} from "./query";
import type { CompletedSale, CompletedSaleItem } from "../sales/salesEngine";
import type { SaleDraft } from "../sales/salesDraft";
import type { ReceivedDeliveryItemSnapshot } from "./historicalSerialization";

export interface ApplicationDataRepositories {
    readonly getAllProducts: (
        query: SqliteQueryExecutor
    ) => ReturnType<typeof getAllProducts>;
    readonly getAllInventory: (
        query: SqliteQueryExecutor
    ) => ReturnType<typeof getAllInventory>;
    readonly getAllActivityEvents: (
        query: SqliteQueryExecutor
    ) => ReturnType<typeof getAllActivityEvents>;
    readonly getAllSales: (
        query: SqliteQueryExecutor
    ) => ReturnType<typeof getAllSales>;
    readonly getAllReceivedDeliveries: (
        query: SqliteQueryExecutor
    ) => ReturnType<typeof getAllReceivedDeliveries>;
    readonly getAllActiveSaleDrafts: (
        query: SqliteQueryExecutor
    ) => ReturnType<typeof getAllActiveSaleDrafts>;
    readonly getAllActiveDeliveryDrafts: (
        query: SqliteQueryExecutor
    ) => ReturnType<typeof getAllActiveDeliveryDrafts>;
}

export interface CompletedSaleData {
    readonly domain: CompletedSale | null;
    readonly persistence: PersistedSale;
    readonly persistenceOnlyFields: readonly string[];
    readonly projectionIssue?: string;
}

export interface ReceivedDeliveryData {
    readonly domain: DeliveryDraft | null;
    readonly persistence: PersistedReceivedDelivery;
    readonly persistenceOnlyFields: readonly string[];
    readonly projectionIssue?: string;
}

export interface ApplicationDataAssembly {
    readonly products: readonly productStructure[];
    readonly inventoryRecords: readonly inventory[];
    readonly inventoryBatches: readonly inventoryBatch[];
    readonly activityEvents: readonly ActivityEvent[];
    readonly completedSales: readonly CompletedSaleData[];
    readonly receivedDeliveries: readonly ReceivedDeliveryData[];
    readonly activeSaleDrafts: readonly PersistedDomainProjection<
        SaleDraft,
        PersistedSaleDraft
    >[];
    readonly     activeDeliveryDrafts: readonly DeliveryDraftDomainProjection[];
    readonly persistenceLimitations: readonly string[];
}

const repositories: ApplicationDataRepositories = {
    getAllProducts,
    getAllInventory,
    getAllActivityEvents,
    getAllSales,
    getAllReceivedDeliveries,
    getAllActiveSaleDrafts,
    getAllActiveDeliveryDrafts
};

const SALE_PERSISTENCE_ONLY_FIELDS = [
    "completed status marker",
    "sourceDraftId",
    "completedEventId",
    "SQL NULL versus optional-field absence",
    "itemPositions",
    "original itemSnapshotJson text"
] as const;

const RECEIVED_DELIVERY_PERSISTENCE_ONLY_FIELDS = [
    "received status marker",
    "receivedAt alias of updatedAt",
    "receivedEventId",
    "receivedBatchId",
    "receivedInventoryId",
    "SQL NULL versus optional-field absence",
    "itemPositions",
    "original receiptSnapshotJson text"
] as const;

const PERSISTENCE_LIMITATIONS = [
    "Product and Inventory repositories return domain values only; original SQL NULL distinctions and numeric position values are not available after those repository projections.",
    "Sales and received-Delivery repositories preserve relative ordering but do not expose their numeric header positions in their DTOs."
] as const;

function assertEqual(
    actual: unknown,
    expected: unknown,
    label: string
): void {
    if (actual !== expected) {
        throw new Error(`Persisted ${label} does not match its snapshot.`);
    }
}

function assertSaleItemMatchesSnapshot(
    saleId: string,
    persisted: PersistedSaleItem,
    snapshot: CompletedSaleItem
): void {
    const label = `Sale ${saleId} item ${persisted.lineId}`;
    assertEqual(snapshot.lineId, persisted.lineId, `${label} line ID`);
    assertEqual(snapshot.inventoryRecordId, persisted.inventoryRecordId, `${label} inventory ID`);
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
    assertEqual(
        snapshot.discountAmount,
        persisted.discountAmount,
        `${label} discount`
    );
    assertEqual(snapshot.finalAmount, persisted.finalAmount, `${label} final amount`);
    assertEqual(snapshot.expiredBatch, persisted.expiredBatch, `${label} expiry flag`);
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

function completedSaleData(sale: PersistedSale): CompletedSaleData {
    const items: CompletedSaleItem[] = [];
    for (const persistedItem of sale.items) {
        let snapshot: CompletedSaleItem;
        try {
            snapshot = parseCompletedSaleItemSnapshot(
                persistedItem.itemSnapshotJson
            );
        } catch (error) {
            if (!(error instanceof Error)) {
                throw error;
            }
            return {
                domain: null,
                persistence: sale,
                persistenceOnlyFields: SALE_PERSISTENCE_ONLY_FIELDS,
                projectionIssue:
                    `Sale ${sale.saleId} item ${persistedItem.lineId} remains persistence-only: ${error.message}`
            };
        }
        assertSaleItemMatchesSnapshot(sale.saleId, persistedItem, snapshot);
        items.push(snapshot);
    }

    if (items.length === 0) {
        return {
            domain: null,
            persistence: sale,
            persistenceOnlyFields: SALE_PERSISTENCE_ONLY_FIELDS,
            projectionIssue: `Sale ${sale.saleId} has no items to project.`
        };
    }

    return {
        domain: {
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
                        ...(sale.staffUserId === null
                            ? {}
                            : { userId: sale.staffUserId }),
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
        },
        persistence: sale,
        persistenceOnlyFields: SALE_PERSISTENCE_ONLY_FIELDS
    };
}

function assertReceivedItemMatchesSnapshot(
    deliveryId: string,
    persisted: PersistedReceivedDeliveryItem,
    snapshot: ReturnType<typeof parseReceivedDeliveryItemSnapshot>
): void {
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

function receivedDeliveryData(
    delivery: PersistedReceivedDelivery
): ReceivedDeliveryData {
    const snapshots: {
        persistedItem: PersistedReceivedDeliveryItem;
        snapshot: ReceivedDeliveryItemSnapshot;
    }[] = [];
    for (const persistedItem of delivery.items) {
        if (persistedItem.receivedBatchId.trim() === "") {
            throw new Error(
                `Delivery ${delivery.deliveryId} item ${persistedItem.deliveryItemId} has no received batch association.`
            );
        }
        let snapshot: ReturnType<typeof parseReceivedDeliveryItemSnapshot>;
        try {
            snapshot = parseReceivedDeliveryItemSnapshot(
                persistedItem.receiptSnapshotJson
            );
        } catch (error) {
            if (!(error instanceof Error)) {
                throw error;
            }
            return {
                domain: null,
                persistence: delivery,
                persistenceOnlyFields: RECEIVED_DELIVERY_PERSISTENCE_ONLY_FIELDS,
                projectionIssue:
                    `Delivery ${delivery.deliveryId} item ${persistedItem.deliveryItemId} remains persistence-only: ${error.message}`
            };
        }
        assertReceivedItemMatchesSnapshot(
            delivery.deliveryId,
            persistedItem,
            snapshot
        );
        snapshots.push({ persistedItem, snapshot });
    }

    const domain: DeliveryDraft = {
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
        items: snapshots.map(({ persistedItem }) => ({
            deliveryItemId: persistedItem.deliveryItemId,
            productId: persistedItem.productId,
            variantId: persistedItem.variantId,
            packagingLevelId: persistedItem.packagingLevelId,
            quantity: persistedItem.quantity,
            batchNumber: persistedItem.batchNumber,
            expiryDate: persistedItem.expiryDate,
            costPrice: persistedItem.costPrice,
            sellingPrice: persistedItem.sellingPrice
        }))
    };
    return {
        domain,
        persistence: delivery,
        persistenceOnlyFields: RECEIVED_DELIVERY_PERSISTENCE_ONLY_FIELDS
    };
}

function requireProductVariant(
    productById: ReadonlyMap<string, productStructure>,
    productId: string,
    variantId: string,
    label: string
): {
    product: productStructure;
    variant: productStructure["variant"][number];
} {
    const product = productById.get(productId);
    const productVariant = product?.variant.find(
        (candidate) => candidate.id === variantId
    );
    if (!product || !productVariant) {
        throw new Error(
            `${label} references a missing Product/Variant (${productId}/${variantId}).`
        );
    }
    return { product, variant: productVariant };
}

function assertActivityLinks(
    sales: readonly PersistedSale[],
    deliveries: readonly PersistedReceivedDelivery[],
    events: readonly ActivityEvent[]
): void {
    const eventsById = new Map<string, ActivityEvent>();
    for (const event of events) {
        if (eventsById.has(event.eventId)) {
            throw new Error(`Activity contains duplicate event ID ${event.eventId}.`);
        }
        eventsById.set(event.eventId, event);
    }
    for (const sale of sales) {
        const event = eventsById.get(sale.completedEventId);
        if (event?.type !== "sale.completed" || event.saleId !== sale.saleId) {
            throw new Error(
                `Sale ${sale.saleId} does not match its completed Activity event ${sale.completedEventId}.`
            );
        }
    }
    for (const delivery of deliveries) {
        const event = eventsById.get(delivery.receivedEventId);
        if (
            event?.type !== "delivery.received" ||
            event.deliveryId !== delivery.deliveryId
        ) {
            throw new Error(
                `Delivery ${delivery.deliveryId} does not match its received Activity event ${delivery.receivedEventId}.`
            );
        }
    }
}

function validateLiveDataAndDraftReferences(
    products: readonly productStructure[],
    inventoryRecords: readonly inventory[],
    inventoryBatches: readonly inventoryBatch[],
    saleDrafts: readonly PersistedSaleDraft[],
    deliveryDrafts: readonly PersistedDeliveryDraft[]
): void {
    const productById = new Map<string, productStructure>();
    for (const product of products) {
        if (productById.has(product.id)) {
            throw new Error(`Product collection contains duplicate ID ${product.id}.`);
        }
        productById.set(product.id, product);
    }

    const batchById = new Map<string, inventoryBatch>();
    for (const batch of inventoryBatches) {
        if (batchById.has(batch.batchId)) {
            throw new Error(`Inventory batches contain duplicate ID ${batch.batchId}.`);
        }
        const { variant } = requireProductVariant(
            productById,
            batch.productId,
            batch.variantId,
            `Inventory batch ${batch.batchId}`
        );
        for (const pricing of batch.pricingByPackagingLevel) {
            if (!variant.packagingHierarchy.some(
                (level) => level.id === pricing.packagingLevelId
            )) {
                throw new Error(
                    `Inventory batch ${batch.batchId} pricing references missing packaging ${pricing.packagingLevelId}.`
                );
            }
        }
        batchById.set(batch.batchId, batch);
    }

    const inventoryById = new Map<string, inventory>();
    for (const record of inventoryRecords) {
        if (inventoryById.has(record.id)) {
            throw new Error(`Inventory records contain duplicate ID ${record.id}.`);
        }
        const { variant } = requireProductVariant(
            productById,
            record.productId,
            record.variantId,
            `Inventory record ${record.id}`
        );
        for (const stock of record.stockQuantities) {
            if (!variant.packagingHierarchy.some(
                (level) => level.id === stock.packagingLevelId
            )) {
                throw new Error(
                    `Inventory record ${record.id} references missing packaging ${stock.packagingLevelId}.`
                );
            }
        }
        if (record.batchId !== null) {
            const batch = batchById.get(record.batchId);
            if (
                !batch ||
                batch.productId !== record.productId ||
                batch.variantId !== record.variantId
            ) {
                throw new Error(
                    `Inventory record ${record.id} has an invalid batch association.`
                );
            }
        }
        inventoryById.set(record.id, record);
    }

    for (const draft of saleDrafts) {
        for (const item of draft.items) {
            const { variant } = requireProductVariant(
                productById,
                item.productId,
                item.variantId,
                `Sale draft ${draft.draftId} item ${item.lineId}`
            );
            const record = inventoryById.get(item.inventoryRecordId);
            if (
                !record ||
                record.productId !== item.productId ||
                record.variantId !== item.variantId ||
                record.batchId !== item.batchId
            ) {
                throw new Error(
                    `Sale draft ${draft.draftId} item ${item.lineId} has an invalid Inventory association.`
                );
            }
            if (!variant.packagingHierarchy.some(
                (level) => level.id === item.packagingLevelId
            )) {
                throw new Error(
                    `Sale draft ${draft.draftId} item ${item.lineId} references missing packaging ${item.packagingLevelId}.`
                );
            }
        }
    }

    for (const draft of deliveryDrafts) {
        if (draft.receivedEventId !== null) {
            throw new Error(
                `Active Delivery draft ${draft.deliveryId} unexpectedly references a received event.`
            );
        }
        for (const item of draft.items) {
            const { variant } = requireProductVariant(
                productById,
                item.productId,
                item.variantId,
                `Delivery draft ${draft.deliveryId} item ${item.deliveryItemId}`
            );
            if (!variant.packagingHierarchy.some(
                (level) => level.id === item.packagingLevelId
            )) {
                throw new Error(
                    `Delivery draft ${draft.deliveryId} item ${item.deliveryItemId} references missing packaging ${item.packagingLevelId}.`
                );
            }
        }
    }
}

async function readRepository<T>(
    name: string,
    read: () => Promise<T>
): Promise<T> {
    try {
        return await read();
    } catch (error) {
        throw new Error(
            `Application data assembly failed: ${name} repository read failed.`,
            { cause: error }
        );
    }
}

export async function loadApplicationData(
    sources: ApplicationDataRepositories = repositories
): Promise<ApplicationDataAssembly> {
    const snapshot = createSqliteReadSnapshotExecutor();
    const pendingReads = Promise.all([
        readRepository(
            "Product",
            () => sources.getAllProducts(snapshot.query)
        ),
        readRepository(
            "Inventory",
            () => sources.getAllInventory(snapshot.query)
        ),
        readRepository(
            "active Sales draft",
            () => sources.getAllActiveSaleDrafts(snapshot.query)
        ),
        readRepository(
            "active Receive Delivery draft",
            () => sources.getAllActiveDeliveryDrafts(snapshot.query)
        ),
        readRepository(
            "completed Sales",
            () => sources.getAllSales(snapshot.query)
        ),
        readRepository(
            "received Deliveries",
            () => sources.getAllReceivedDeliveries(snapshot.query)
        ),
        readRepository(
            "Activity",
            () => sources.getAllActivityEvents(snapshot.query)
        )
    ]);

    await snapshot.execute();
    const [
        products,
        inventoryData,
        activeSaleDraftRows,
        activeDeliveryDraftRows,
        sales,
        receivedDeliveries,
        activityEvents
    ] = await pendingReads;

    validateLiveDataAndDraftReferences(
        products,
        inventoryData.inventoryRecords,
        inventoryData.inventoryBatches,
        activeSaleDraftRows,
        activeDeliveryDraftRows
    );
    assertActivityLinks(sales, receivedDeliveries, activityEvents);

    return {
        products,
        inventoryRecords: inventoryData.inventoryRecords,
        inventoryBatches: inventoryData.inventoryBatches,
        activityEvents,
        completedSales: sales.map(completedSaleData),
        receivedDeliveries: receivedDeliveries.map(receivedDeliveryData),
        activeSaleDrafts: adaptPersistedSaleDrafts(activeSaleDraftRows),
        activeDeliveryDrafts: adaptPersistedDeliveryDrafts(
            activeDeliveryDraftRows
        ),
        persistenceLimitations: PERSISTENCE_LIMITATIONS
    };
}
