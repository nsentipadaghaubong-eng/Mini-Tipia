import { describe, expect, it } from "vitest";
import type { ActivityEvent } from "../activity/activity";
import type { DeliveryDraft } from "../deliveries/deliveryDraft";
import type { inventory } from "../inventory/inventoryStock";
import type { inventoryBatch } from "../inventory/inventoryBatch";
import type { productStructure } from "../products/productStructure";
import type { CompletedSale, CompletedSaleItem } from "../sales/salesEngine";
import {
    adaptPersistedDeliveryDraft,
    adaptPersistedSaleDraft
} from "./domainAdapters";
import type { ApplicationDataAssembly, CompletedSaleData, ReceivedDeliveryData } from "./applicationDataLoader";
import {
    createApplicationStateHydration,
} from "./applicationStateHydration";
import {
    serializeCompletedSaleItemSnapshot,
    serializeReceivedDeliveryItemSnapshot,
    type ReceivedDeliveryItemSnapshot
} from "./historicalSerialization";
import type { PersistedDeliveryDraft } from "./repositories/receiveDeliveryDraftRepository";
import type { PersistedSaleDraft } from "./repositories/salesDraftRepository";
import type {
    PersistedReceivedDelivery,
    PersistedReceivedDeliveryItem
} from "./repositories/receiveDeliveryRepository";
import type {
    PersistedSale,
    PersistedSaleItem
} from "./repositories/salesRepository";

const packagingSnapshot = {
    packagingLevelId: "pack-1",
    name: "Carton",
    costPrice: null,
    sellingPrice: 1.25,
    quantityOfNextLevel: null,
    nextLevelId: null,
    nextLevelName: null
} as const;

const variantSnapshot = {
    variantId: "variant-1",
    variantName: "Tablet",
    packaging: [packagingSnapshot]
} as const;

const productSnapshot = {
    productId: "product-1",
    productName: "Historical product",
    variants: [variantSnapshot]
} as const;

const saleItem: CompletedSaleItem = {
    lineId: "sale-line-1",
    product: productSnapshot,
    variant: variantSnapshot,
    batch: null,
    inventoryRecordId: "inventory-1",
    packagingLevel: packagingSnapshot,
    quantity: 2,
    defaultSellingPrice: null,
    appliedSellingPrice: 1.25,
    subtotal: 2.5,
    discountAmount: 0.25,
    finalAmount: 2.25,
    expiredBatch: false
};

const sale: CompletedSale = {
    saleId: "sale-1",
    completedAt: "2026-11-25T10:00:00.000Z",
    customerName: "Historical customer",
    staffMember: { userId: "staff-1", displayName: "Staff member" },
    notes: "Original sale",
    items: [saleItem],
    subtotal: 2.5,
    discountAmount: 0.25,
    finalAmount: 2.25,
    expiredBatchConfirmed: false
};

const persistedSaleItem: PersistedSaleItem = {
    lineId: saleItem.lineId,
    itemPosition: 4,
    inventoryRecordId: saleItem.inventoryRecordId,
    productId: productSnapshot.productId,
    variantId: variantSnapshot.variantId,
    batchId: null,
    packagingLevelId: packagingSnapshot.packagingLevelId,
    quantity: saleItem.quantity,
    defaultSellingPrice: null,
    appliedSellingPrice: saleItem.appliedSellingPrice,
    subtotal: saleItem.subtotal,
    discountAmount: saleItem.discountAmount,
    finalAmount: saleItem.finalAmount,
    expiredBatch: saleItem.expiredBatch,
    itemSnapshot: saleItem,
    itemSnapshotJson: serializeCompletedSaleItemSnapshot(saleItem)
};

const persistedSale: PersistedSale = {
    saleId: sale.saleId,
    status: "completed",
    sourceDraftId: "sale-draft-completed",
    completedEventId: "sale-event-1",
    completedAt: sale.completedAt,
    customerName: sale.customerName ?? null,
    customerAddress: null,
    saleDate: null,
    staffUserId: sale.staffMember?.userId ?? null,
    staffDisplayName: sale.staffMember?.displayName ?? null,
    notes: sale.notes ?? null,
    items: [persistedSaleItem],
    subtotal: sale.subtotal,
    discountAmount: sale.discountAmount,
    finalAmount: sale.finalAmount,
    expiredBatchConfirmed: sale.expiredBatchConfirmed
};

const receivedItemSnapshot: ReceivedDeliveryItemSnapshot = {
    deliveryItemId: "received-line-1",
    productId: productSnapshot.productId,
    productName: productSnapshot.productName,
    variantId: variantSnapshot.variantId,
    variantName: variantSnapshot.variantName,
    packagingLevel: packagingSnapshot,
    quantity: 3,
    batch: {
        batchId: "batch-1",
        productId: productSnapshot.productId,
        productName: productSnapshot.productName,
        variantId: variantSnapshot.variantId,
        variantName: variantSnapshot.variantName,
        batchNumber: null,
        expiryDate: null,
        pricingByPackagingLevel: [{
            packagingLevelId: packagingSnapshot.packagingLevelId,
            packagingLevelName: packagingSnapshot.name,
            costPrice: null,
            sellingPrice: 1.25
        }]
    },
    pricingAtReceipt: {
        packagingLevelId: packagingSnapshot.packagingLevelId,
        costPrice: null,
        sellingPrice: 1.25
    }
};

const persistedReceivedItem: PersistedReceivedDeliveryItem = {
    deliveryItemId: receivedItemSnapshot.deliveryItemId,
    itemPosition: 2,
    productId: receivedItemSnapshot.productId,
    variantId: receivedItemSnapshot.variantId,
    packagingLevelId: packagingSnapshot.packagingLevelId,
    quantity: receivedItemSnapshot.quantity,
    batchNumber: null,
    expiryDate: null,
    costPrice: null,
    sellingPrice: 1.25,
    receivedBatchId: "batch-1",
    receivedInventoryId: "inventory-1",
    receiptSnapshot: receivedItemSnapshot,
    receiptSnapshotJson: serializeReceivedDeliveryItemSnapshot(
        receivedItemSnapshot
    )
};

const receivedDelivery: PersistedReceivedDelivery = {
    deliveryId: "delivery-received-1",
    status: "received",
    createdAt: "2026-11-25T10:00:00.000Z",
    updatedAt: "2026-11-25T11:00:00.000Z",
    receivedAt: "2026-11-25T11:00:00.000Z",
    deliveryDate: "2026-11-25",
    receivedBy: "Receiver",
    supplierName: null,
    invoiceNumber: "INV-1",
    receivedEventId: "delivery-event-1",
    items: [persistedReceivedItem]
};

const receivedDeliveryDomain: DeliveryDraft = {
    deliveryId: receivedDelivery.deliveryId,
    status: "received",
    createdAt: receivedDelivery.createdAt,
    updatedAt: receivedDelivery.updatedAt,
    deliveryDate: receivedDelivery.deliveryDate,
    receivedBy: receivedDelivery.receivedBy,
    ...(receivedDelivery.invoiceNumber === null
        ? {}
        : { invoiceNumber: receivedDelivery.invoiceNumber }),
    items: [{
        deliveryItemId: persistedReceivedItem.deliveryItemId,
        productId: persistedReceivedItem.productId,
        variantId: persistedReceivedItem.variantId,
        packagingLevelId: persistedReceivedItem.packagingLevelId,
        quantity: persistedReceivedItem.quantity,
        batchNumber: persistedReceivedItem.batchNumber,
        expiryDate: persistedReceivedItem.expiryDate,
        costPrice: persistedReceivedItem.costPrice,
        sellingPrice: persistedReceivedItem.sellingPrice
    }]
};

const product: productStructure = {
    id: "product-1",
    name: "Current product",
    variant: [{
        id: "variant-1",
        variantName: "Tablet",
        packagingHierarchy: [{
            id: "pack-1",
            name: "Carton",
            costPrice: null,
            sellingPrice: 1.25,
            quantityofNextLevel: null,
            nextLevelId: null
        }]
    }]
};

const inventoryRecord: inventory = {
    id: "inventory-1",
    productId: "product-1",
    variantId: "variant-1",
    batchId: "batch-1",
    stockQuantities: [{ packagingLevelId: "pack-1", quantity: 7 }]
};

const batch: inventoryBatch = {
    batchId: "batch-1",
    productId: "product-1",
    variantId: "variant-1",
    batchNumber: null,
    expiryDate: null,
    pricingByPackagingLevel: [{
        packagingLevelId: "pack-1",
        costPrice: null,
        sellingPrice: 1.25
    }]
};

const activityEvent: ActivityEvent = {
    type: "product.packaging_added",
    eventId: "activity-1",
    operationKey: "product.packaging_added:product-1:pack-1",
    occurredAt: "2026-11-25T12:00:00.000Z",
    productId: "product-1",
    productName: "Current product",
    variantId: "variant-1",
    variantName: "Tablet",
    packaging: packagingSnapshot,
    reason: "Added package"
};

const activeSaleDraft: PersistedSaleDraft = {
    draftPosition: 5,
    draftId: "sale-draft-1",
    status: "draft",
    createdAt: "2026-11-25T08:00:00.000Z",
    updatedAt: "2026-11-25T09:00:00.000Z",
    customerName: null,
    customerAddress: "Draft address",
    saleDate: null,
    staffUserId: "staff-1",
    staffDisplayName: null,
    notes: null,
    approvedSaleId: null,
    items: [{
        lineId: "draft-line-1",
        itemPosition: 3,
        productId: "product-1",
        variantId: "variant-1",
        inventoryRecordId: "inventory-1",
        batchId: "batch-1",
        packagingLevelId: "pack-1",
        quantity: 2,
        defaultSellingPriceMinorUnits: null,
        appliedSellingPriceMinorUnits: 125,
        discountMinorUnits: 25
    }]
};

function activeDeliveryDraft(
    deliveryId: string,
    deliveryDate: string | null,
    receivedBy: string | null
): PersistedDeliveryDraft {
    return {
        deliveryPosition: deliveryId === "delivery-draft-valid" ? 6 : 7,
        deliveryId,
        status: "draft",
        createdAt: "2026-11-25T08:00:00.000Z",
        updatedAt: "2026-11-25T09:00:00.000Z",
        deliveryDate,
        receivedBy,
        supplierName: null,
        invoiceNumber: "DRAFT-INV",
        receivedEventId: null,
        items: [{
            deliveryItemId: `${deliveryId}-line`,
            itemPosition: 1,
            productId: "product-1",
            variantId: "variant-1",
            packagingLevelId: "pack-1",
            quantity: 4,
            batchNumber: null,
            expiryDate: null,
            costPriceMinorUnits: null,
            sellingPriceMinorUnits: 125,
            receivedBatchId: null,
            receiptSnapshotJson: null
        }]
    };
}

function completedSaleData(): CompletedSaleData {
    return {
        domain: sale,
        persistence: persistedSale,
        persistenceOnlyFields: ["sourceDraftId", "completedEventId"]
    };
}

function receivedDeliveryData(): ReceivedDeliveryData {
    return {
        domain: receivedDeliveryDomain,
        persistence: receivedDelivery,
        persistenceOnlyFields: [
            "receivedEventId",
            "receivedBatchId",
            "receivedInventoryId"
        ]
    };
}

function assembly(
    overrides: Partial<ApplicationDataAssembly> = {}
): ApplicationDataAssembly {
    const activeSaleProjection = adaptPersistedSaleDraft(activeSaleDraft);
    const validDelivery = adaptPersistedDeliveryDraft(
        activeDeliveryDraft("delivery-draft-valid", "2026-11-25", "Receiver")
    );
    const nullableDelivery = adaptPersistedDeliveryDraft(
        activeDeliveryDraft("delivery-draft-nullable", null, null)
    );
    if (validDelivery.domain === null || nullableDelivery.domain !== null) {
        throw new Error("Hydration fixture Delivery projections are invalid.");
    }

    return {
        products: [product],
        inventoryRecords: [inventoryRecord],
        inventoryBatches: [batch],
        activityEvents: [activityEvent],
        completedSales: [completedSaleData()],
        receivedDeliveries: [receivedDeliveryData()],
        activeSaleDrafts: [activeSaleProjection],
        activeDeliveryDrafts: [validDelivery, nullableDelivery],
        persistenceLimitations: ["Repository DTO limitation"],
        ...overrides
    };
}

describe("persistence-aware ApplicationState hydration model", () => {
    it("represents all eight collections and exposes validated projections alongside source records", () => {
        const data = assembly();
        const hydration = createApplicationStateHydration(data);

        expect(hydration.products[0]?.sourceRecord).toBe(product);
        expect(hydration.products[0]?.domainProjection).toEqual({
            status: "available",
            value: product
        });
        expect(hydration.inventoryRecords[0]?.sourceRecord).toBe(inventoryRecord);
        expect(hydration.inventoryBatches[0]?.sourceRecord).toBe(batch);
        expect(hydration.activityEvents[0]?.sourceRecord).toBe(activityEvent);
        expect(hydration.completedSales[0]?.sourceRecord).toBe(persistedSale);
        expect(hydration.completedSales[0]?.domainProjection).toEqual({
            status: "available",
            value: sale
        });
        expect(hydration.receivedDeliveries[0]?.sourceRecord)
            .toBe(receivedDelivery);
        expect(hydration.receivedDeliveries[0]?.domainProjection).toEqual({
            status: "available",
            value: receivedDeliveryDomain
        });
        expect(hydration.activeSaleDrafts[0]?.sourceRecord)
            .toBe(activeSaleDraft);
        expect(hydration.activeSaleDrafts[0]?.domainProjection.status)
            .toBe("available");
        expect(hydration.activeDeliveryDrafts).toHaveLength(2);
        expect(hydration.persistenceLimitations)
            .toBe(data.persistenceLimitations);
    });

    it("retains snapshots, original IDs, ordering, nullable fields, and received Inventory associations", () => {
        const hydration = createApplicationStateHydration(assembly());
        const hydratedSale = hydration.completedSales[0];
        const hydratedDelivery = hydration.receivedDeliveries[0];
        const activeSale = hydration.activeSaleDrafts[0];

        expect(hydratedSale?.sourceRecord).toMatchObject({
            sourceDraftId: "sale-draft-completed",
            completedEventId: "sale-event-1",
            customerAddress: null,
            items: [{
                itemPosition: 4,
                itemSnapshotJson: persistedSaleItem.itemSnapshotJson,
                batchId: null,
                defaultSellingPrice: null
            }]
        });
        expect(hydratedSale?.domainProjection).toMatchObject({
            status: "available",
            value: {
                items: [{
                    product: { productName: "Historical product" },
                    packagingLevel: { name: "Carton" },
                    defaultSellingPrice: null
                }]
            }
        });
        expect(hydratedDelivery?.sourceRecord.items[0]?.receivedBatchId)
            .toBe("batch-1");
        expect(hydratedDelivery?.sourceRecord.items[0]?.receiptSnapshotJson)
            .toBe(persistedReceivedItem.receiptSnapshotJson);
        expect(hydratedDelivery?.itemInventoryAssociations).toEqual([{
            deliveryItemId: "received-line-1",
            batchId: "batch-1",
            inventoryRecordAssociation: {
                status: "recorded",
                inventoryRecordId: "inventory-1",
                currentTargetStatus: "present"
            }
        }]);
        expect(activeSale?.sourceRecord.items[0]?.itemPosition).toBe(3);
        expect(activeSale?.sourceRecord.customerName).toBeNull();
        expect(activeSale?.domainProjection).toMatchObject({
            status: "available",
            value: {
                draftId: "sale-draft-1",
                status: "draft",
                items: [{
                    lineId: "draft-line-1",
                    defaultSellingPrice: null,
                    appliedSellingPrice: 1.25,
                    discountAmount: 0.25
                }]
            }
        });
    });

    it("keeps a missing historical Inventory association explicitly unresolved", () => {
        const delivery = {
            ...receivedDelivery,
            items: [{
                ...persistedReceivedItem,
                receivedInventoryId: null
            }]
        };
        const hydration = createApplicationStateHydration(assembly({
            receivedDeliveries: [{
                domain: receivedDeliveryDomain,
                persistence: delivery,
                persistenceOnlyFields: [
                    "receivedEventId",
                    "receivedBatchId",
                    "receivedInventoryId"
                ]
            }]
        }));

        expect(hydration.receivedDeliveries[0]?.itemInventoryAssociations)
            .toEqual([{
                deliveryItemId: "received-line-1",
                batchId: "batch-1",
                inventoryRecordAssociation: {
                    status: "unresolved",
                    inventoryRecordId: null,
                    reason: "inventory-record-association-not-recorded"
                }
            }]);
        expect(hydration.receivedDeliveries[0]?.sourceRecord.items[0]?.receivedInventoryId)
            .toBeNull();
    });

    it("retains the recorded Inventory ID when its target is no longer present", () => {
        const hydration = createApplicationStateHydration(assembly({
            inventoryRecords: []
        }));

        expect(hydration.receivedDeliveries[0]?.itemInventoryAssociations[0])
            .toMatchObject({
                batchId: "batch-1",
                inventoryRecordAssociation: {
                    status: "recorded",
                    inventoryRecordId: "inventory-1",
                    currentTargetStatus: "not-currently-present"
                }
            });
        expect(hydration.receivedDeliveries[0]?.sourceRecord.items[0]?.receivedInventoryId)
            .toBe("inventory-1");
    });

    it("marks a recorded association invalid when a current Inventory ID contradicts it", () => {
        const inconsistentDelivery: PersistedReceivedDelivery = {
            ...receivedDelivery,
            items: [{
                ...persistedReceivedItem,
                receivedBatchId: "other-batch"
            }]
        };
        const hydration = createApplicationStateHydration(assembly({
            receivedDeliveries: [{
                domain: null,
                persistence: inconsistentDelivery,
                persistenceOnlyFields: ["receivedInventoryId"],
                projectionIssue: "Test fixture has inconsistent association metadata."
            }]
        }));

        expect(hydration.receivedDeliveries[0]?.itemInventoryAssociations[0])
            .toEqual({
                deliveryItemId: "received-line-1",
                batchId: "other-batch",
                inventoryRecordAssociation: {
                    status: "invalid",
                    inventoryRecordId: "inventory-1",
                    reason: "does-not-match-current-inventory-record"
                }
            });
    });

    it("retains nullable-header Delivery drafts as persistence-only without filling required values", () => {
        const hydration = createApplicationStateHydration(assembly());
        const draft = hydration.activeDeliveryDrafts.find(
            (entry) => entry.sourceRecord.deliveryId === "delivery-draft-nullable"
        );

        expect(draft?.domainProjection).toEqual({
            status: "persistence-only",
            reason: "Required domain header values are NULL: deliveryDate, receivedBy.",
            incompatibleFields: ["deliveryDate", "receivedBy"]
        });
        expect(draft?.sourceRecord.deliveryDate).toBeNull();
        expect(draft?.sourceRecord.receivedBy).toBeNull();
        expect(draft?.sourceRecord.supplierName).toBeNull();
        expect(draft?.sourceRecord.items[0]?.deliveryItemId)
            .toBe("delivery-draft-nullable-line");
    });

    it("keeps persistence-only historical rows available and separate from active drafts", () => {
        const opaqueSale: PersistedSale = {
            ...persistedSale,
            saleId: "opaque-sale",
            completedEventId: "opaque-sale-event",
            items: [{
                ...persistedSaleItem,
                lineId: "opaque-line",
                itemSnapshot: { oldFormat: true },
                itemSnapshotJson: JSON.stringify({ oldFormat: true })
            }]
        };
        const opaqueDelivery: PersistedReceivedDelivery = {
            ...receivedDelivery,
            deliveryId: "opaque-delivery",
            receivedEventId: "opaque-delivery-event",
            items: [{
                ...persistedReceivedItem,
                deliveryItemId: "opaque-delivery-line",
                receiptSnapshot: { oldFormat: true },
                receiptSnapshotJson: JSON.stringify({ oldFormat: true })
            }]
        };
        const data = assembly({
            completedSales: [{
                domain: null,
                persistence: opaqueSale,
                persistenceOnlyFields: ["original itemSnapshotJson text"],
                projectionIssue: "Snapshot uses an unsupported historical format."
            }],
            receivedDeliveries: [{
                domain: null,
                persistence: opaqueDelivery,
                persistenceOnlyFields: ["original receiptSnapshotJson text"],
                projectionIssue: "Snapshot uses an unsupported receipt format."
            }]
        });
        const hydration = createApplicationStateHydration(data);

        expect(hydration.completedSales).toHaveLength(1);
        expect(hydration.completedSales[0]?.domainProjection).toEqual({
            status: "persistence-only",
            reason: "Snapshot uses an unsupported historical format."
        });
        expect(hydration.completedSales[0]?.sourceRecord).toBe(opaqueSale);
        expect(hydration.completedSales[0]?.sourceRecord.items[0]?.itemSnapshotJson)
            .toBe(JSON.stringify({ oldFormat: true }));
        expect(hydration.receivedDeliveries[0]?.domainProjection).toEqual({
            status: "persistence-only",
            reason: "Snapshot uses an unsupported receipt format."
        });
        expect(hydration.receivedDeliveries[0]?.sourceRecord).toBe(opaqueDelivery);
        expect(hydration.receivedDeliveries[0]?.sourceRecord.items[0]?.receiptSnapshotJson)
            .toBe(JSON.stringify({ oldFormat: true }));
        expect(hydration.activeSaleDrafts[0]?.sourceRecord.draftId)
            .toBe("sale-draft-1");
    });

    it("preserves lifecycle separation and accepts empty collections", () => {
        const data = assembly({
            products: [],
            inventoryRecords: [],
            inventoryBatches: [],
            activityEvents: [],
            completedSales: [],
            receivedDeliveries: [],
            activeSaleDrafts: [],
            activeDeliveryDrafts: [],
            persistenceLimitations: []
        });
        const hydration = createApplicationStateHydration(data);

        expect(hydration).toEqual({
            products: [],
            inventoryRecords: [],
            inventoryBatches: [],
            activityEvents: [],
            completedSales: [],
            receivedDeliveries: [],
            activeSaleDrafts: [],
            activeDeliveryDrafts: [],
            persistenceLimitations: []
        });

        const populated = createApplicationStateHydration(assembly());
        expect(populated.completedSales.map(
            (entry) => entry.sourceRecord.status
        )).toEqual(["completed"]);
        expect(populated.receivedDeliveries.map(
            (entry) => entry.sourceRecord.status
        )).toEqual(["received"]);
        expect(populated.activeSaleDrafts.map(
            (entry) => entry.sourceRecord.status
        )).toEqual(["draft"]);
        expect(populated.activeDeliveryDrafts.map(
            (entry) => entry.sourceRecord.status
        )).toEqual(["draft", "draft"]);
    });

    it("rejects domain projections that conflict with their persisted records", () => {
        const data = assembly();
        const mismatchedDraft = data.activeSaleDrafts[0];
        if (!mismatchedDraft) {
            throw new Error("Expected an active Sale draft fixture.");
        }
        const mismatchedAssembly: ApplicationDataAssembly = {
            ...data,
            activeSaleDrafts: [{
                ...mismatchedDraft,
                domain: { ...mismatchedDraft.domain, draftId: "fabricated-id" }
            }]
        };

        expect(() => createApplicationStateHydration(mismatchedAssembly))
            .toThrow("domain projection does not match");
    });

    it("rejects an inconsistent historical snapshot instead of projecting it as valid", () => {
        const inconsistentSaleItem = {
            ...persistedSaleItem,
            productId: "different-product"
        };
        const inconsistentSale: PersistedSale = {
            ...persistedSale,
            items: [inconsistentSaleItem]
        };
        const data = assembly({
            completedSales: [{
                domain: sale,
                persistence: inconsistentSale,
                persistenceOnlyFields: []
            }]
        });

        expect(() => createApplicationStateHydration(data))
            .toThrow("Product ID does not match its persisted record");
    });
});
