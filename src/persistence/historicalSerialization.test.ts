import { describe, expect, it } from "vitest";
import type {
    ActivityBatchSnapshot,
    ActivityEvent,
    ActivityInventorySnapshot,
    ActivityPackagingSnapshot,
    ActivityProductSnapshot,
    ActivityVariantSnapshot
} from "../activity/activity";
import type { CompletedSaleItem } from "../sales/salesEngine";
import {
    parseActivityEvent,
    parseCompletedSaleItemSnapshot,
    parseReceivedDeliveryItemSnapshot,
    serializeActivityEvent,
    serializeCompletedSaleItemSnapshot,
    serializeReceivedDeliveryItemSnapshot,
    type ReceivedDeliveryItemSnapshot
} from "./historicalSerialization";

const packaging: ActivityPackagingSnapshot = {
    packagingLevelId: "pack-1",
    name: "Box",
    costPrice: null,
    sellingPrice: 1.25,
    quantityOfNextLevel: null,
    nextLevelId: null,
    nextLevelName: null
};

const variant: ActivityVariantSnapshot = {
    variantId: "variant-1",
    variantName: "Tablets",
    nafdacRegistrationNumber: "REG-1",
    lowStockThreshold: {
        quantity: 3,
        packagingLevelId: "pack-1"
    },
    packaging: [packaging]
};

const product: ActivityProductSnapshot = {
    productId: "product-1",
    productName: "Historical medicine",
    description: "Historical description",
    genericName: "Historical generic",
    manufacturer: "Historical maker",
    category: "Medicine",
    variants: [variant]
};

const batch: ActivityBatchSnapshot = {
    batchId: "batch-1",
    productId: "product-1",
    productName: "Historical medicine",
    variantId: "variant-1",
    variantName: "Tablets",
    batchNumber: null,
    expiryDate: null,
    receivedDate: "2026-11-25",
    pricingByPackagingLevel: [{
        packagingLevelId: "pack-1",
        packagingLevelName: "Historical box",
        costPrice: 0.1,
        sellingPrice: null
    }]
};

const inventory: ActivityInventorySnapshot = {
    inventoryId: "inventory-1",
    productId: "product-1",
    productName: "Historical medicine",
    variantId: "variant-1",
    variantName: "Tablets",
    batch: null,
    stock: [{ packagingLevel: packaging, quantity: 2 }]
};

const baseEvent = {
    eventId: "event-1",
    operationKey: "op-1",
    occurredAt: "2026-11-25T10:00:00.000Z"
} as const;

const saleItem: CompletedSaleItem = {
    lineId: "line-1",
    product,
    variant,
    batch,
    inventoryRecordId: "inventory-1",
    packagingLevel: packaging,
    quantity: 3,
    defaultSellingPrice: null,
    appliedSellingPrice: 0.1,
    subtotal: 0.3,
    discountAmount: 0.1,
    finalAmount: 0.2,
    expiredBatch: false
};

const receivedItem: ReceivedDeliveryItemSnapshot = {
    deliveryItemId: "delivery-item-1",
    productId: "product-1",
    productName: "Historical medicine",
    variantId: "variant-1",
    variantName: "Tablets",
    packagingLevel: packaging,
    quantity: 3,
    batch,
    pricingAtReceipt: {
        packagingLevelId: "pack-1",
        costPrice: null,
        sellingPrice: 0.1
    }
};

const activityReceivedItem = {
    productId: "product-1",
    productName: "Historical medicine",
    variantId: "variant-1",
    variantName: "Tablets",
    batch,
    pricingAtReceipt: {
        packagingLevelId: "pack-1",
        costPrice: null,
        sellingPrice: 0.1
    },
    stock: [{ packagingLevel: packaging, quantity: 3 }]
};

const activityVariants: readonly ActivityEvent[] = [
    {
        ...baseEvent,
        type: "product.created",
        product,
        initialInventory: [inventory]
    },
    {
        ...baseEvent,
        type: "product.updated",
        productId: product.productId,
        productName: product.productName,
        before: product,
        after: product,
        reason: "Updated",
        inventoryStateAfter: {
            inventoryRecords: [{
                id: "inventory-1",
                productId: "product-1",
                variantId: "variant-1",
                batchId: null,
                stockQuantities: [{ packagingLevelId: "pack-1", quantity: 2 }]
            }],
            inventoryBatches: [{
                batchId: "batch-1",
                productId: "product-1",
                variantId: "variant-1",
                batchNumber: null,
                expiryDate: null,
                receivedDate: "2026-11-25",
                pricingByPackagingLevel: [{
                    packagingLevelId: "pack-1",
                    costPrice: null,
                    sellingPrice: 0.1
                }]
            }]
        }
    },
    {
        ...baseEvent,
        type: "product.deleted",
        productId: product.productId,
        productName: product.productName,
        product,
        inventory: [inventory],
        batches: [batch],
        reason: "Deleted"
    },
    {
        ...baseEvent,
        type: "product.variant_added",
        productId: product.productId,
        productName: product.productName,
        variant,
        reason: "Added"
    },
    {
        ...baseEvent,
        type: "product.variant_updated",
        productId: product.productId,
        productName: product.productName,
        before: variant,
        after: variant,
        reason: "Updated"
    },
    {
        ...baseEvent,
        type: "product.variant_removed",
        productId: product.productId,
        productName: product.productName,
        removedVariant: variant,
        removedBatches: [batch],
        affectedInventory: [inventory],
        reason: "Removed"
    },
    {
        ...baseEvent,
        type: "product.packaging_added",
        productId: product.productId,
        productName: product.productName,
        variantId: variant.variantId,
        variantName: variant.variantName,
        packaging,
        reason: "Added"
    },
    {
        ...baseEvent,
        type: "product.packaging_updated",
        productId: product.productId,
        productName: product.productName,
        variantId: variant.variantId,
        variantName: variant.variantName,
        before: packaging,
        after: packaging,
        reason: "Updated"
    },
    {
        ...baseEvent,
        type: "product.packaging_removed",
        productId: product.productId,
        productName: product.productName,
        variantId: variant.variantId,
        variantName: variant.variantName,
        removedPackaging: packaging,
        beforeHierarchy: [packaging],
        afterHierarchy: [],
        removedStock: [{
            inventoryId: "inventory-1",
            batch: null,
            quantity: 2
        }],
        reason: "Removed"
    },
    {
        ...baseEvent,
        type: "inventory.batch_created",
        source: "inventory_edit",
        batch,
        inventory
    },
    {
        ...baseEvent,
        type: "inventory.batch_updated",
        before: batch,
        after: batch,
        reason: "Updated"
    },
    {
        ...baseEvent,
        type: "inventory.batch_removed",
        removedBatch: batch,
        affectedInventory: [inventory],
        reason: "Removed"
    },
    {
        ...baseEvent,
        type: "inventory.stock_adjusted",
        inventoryId: "inventory-1",
        productId: product.productId,
        productName: product.productName,
        variantId: variant.variantId,
        variantName: variant.variantName,
        batch: null,
        packagingLevel: packaging,
        previousQuantity: 2,
        newQuantity: 3,
        quantityDifference: 1,
        reason: "Counted"
    },
    {
        ...baseEvent,
        type: "delivery.received",
        deliveryId: "delivery-1",
        deliveryDate: "2026-11-25",
        receivedBy: "Receiver",
        supplierName: null,
        invoiceNumber: "INV-1",
        items: [activityReceivedItem]
    },
    {
        ...baseEvent,
        type: "delivery.draft_cancelled",
        deliveryId: "delivery-1",
        createdAt: "2026-11-24T10:00:00.000Z",
        updatedAt: "2026-11-25T09:00:00.000Z",
        deliveryDate: "2026-11-25",
        receivedBy: "Receiver",
        supplierName: null,
        invoiceNumber: null,
        items: [{
            deliveryItemId: "delivery-item-1",
            productId: product.productId,
            productName: product.productName,
            variantId: variant.variantId,
            variantName: variant.variantName,
            packagingLevel: packaging,
            quantity: 3,
            batchNumber: null,
            expiryDate: null,
            costPrice: null,
            sellingPrice: 0.1
        }]
    },
    {
        ...baseEvent,
        type: "sale.completed",
        saleId: "sale-1",
        staffMember: { userId: "staff-1", displayName: "Pharmacist" },
        subtotal: 0.3,
        discountAmount: 0.1,
        finalAmount: 0.2,
        expiredBatchConfirmed: false,
        items: [{
            productId: product.productId,
            productName: product.productName,
            variantId: variant.variantId,
            variantName: variant.variantName,
            product,
            variant,
            packagingLevel: packaging,
            quantity: 3,
            defaultSellingPrice: null,
            appliedSellingPrice: 0.1,
            subtotal: 0.3,
            discountAmount: 0.1,
            finalAmount: 0.2,
            allocations: [{
                inventoryId: "inventory-1",
                batch,
                quantity: 3
            }]
        }]
    }
];

describe("historical snapshot serialization", () => {
    it("round-trips completed Sale item snapshots with IDs, nulls and exact money", () => {
        const encoded = serializeCompletedSaleItemSnapshot(saleItem);
        expect(parseCompletedSaleItemSnapshot(encoded)).toEqual(saleItem);
        expect(parseCompletedSaleItemSnapshot(encoded).appliedSellingPrice).toBe(0.1);
        expect(parseCompletedSaleItemSnapshot(encoded).subtotal).toBe(0.3);
    });

    it("round-trips receipt snapshots without conflating them with event item fields", () => {
        const encoded = serializeReceivedDeliveryItemSnapshot(receivedItem);
        expect(parseReceivedDeliveryItemSnapshot(encoded)).toEqual(receivedItem);
        expect(parseReceivedDeliveryItemSnapshot(encoded).deliveryItemId)
            .toBe("delivery-item-1");
        expect(parseReceivedDeliveryItemSnapshot(encoded)).not.toHaveProperty("stock");
    });

    it("keeps historical product and inventory values after their sources change", () => {
        const saleSource = { productName: "Historical medicine" };
        const item: CompletedSaleItem = {
            ...saleItem,
            product: { ...saleItem.product, productName: saleSource.productName }
        };
        const json = serializeCompletedSaleItemSnapshot(item);
        saleSource.productName = "Changed current catalog name";
        expect(parseCompletedSaleItemSnapshot(json).product.productName)
            .toBe("Historical medicine");
        expect(parseCompletedSaleItemSnapshot(json).variant.variantName)
            .toBe("Tablets");

        const receiptSource = {
            productName: "Historical medicine",
            packageName: "Box"
        };
        const receipt: ReceivedDeliveryItemSnapshot = {
            ...receivedItem,
            productName: receiptSource.productName,
            packagingLevel: {
                ...packaging,
                name: receiptSource.packageName
            }
        };
        const receiptJson = serializeReceivedDeliveryItemSnapshot(receipt);
        receiptSource.productName = "Changed current catalog name";
        receiptSource.packageName = "Changed current packaging";
        expect(parseReceivedDeliveryItemSnapshot(receiptJson).productName)
            .toBe("Historical medicine");
        expect(parseReceivedDeliveryItemSnapshot(receiptJson).packagingLevel.name)
            .toBe("Box");
    });

    it("rejects malformed or incomplete Sale and Delivery snapshots", () => {
        expect(() => parseCompletedSaleItemSnapshot("{bad json"))
            .toThrow("invalid JSON");
        expect(() => parseCompletedSaleItemSnapshot("{}"))
            .toThrow("snapshot is invalid");
        expect(() => parseReceivedDeliveryItemSnapshot("null"))
            .toThrow("snapshot is invalid");
        expect(() => parseReceivedDeliveryItemSnapshot("{bad json"))
            .toThrow("invalid JSON");
    });

    it("rejects financial values that exceed recorded cent precision", () => {
        const imprecise = {
            ...saleItem,
            appliedSellingPrice: 0.001
        };
        expect(() => parseCompletedSaleItemSnapshot(JSON.stringify(imprecise)))
            .toThrow("snapshot is invalid");
    });

    it("preserves unknown snapshot fields instead of stripping them", () => {
        const extended = {
            ...saleItem,
            futureField: { code: "opaque-future-value" }
        };
        const decoded = parseCompletedSaleItemSnapshot(
            serializeCompletedSaleItemSnapshot(extended)
        );
        expect(decoded).toHaveProperty(
            "futureField",
            { code: "opaque-future-value" }
        );
    });
});

describe("Activity event serialization", () => {
    it("round-trips all currently supported variants and indexed metadata", () => {
        expect(activityVariants).toHaveLength(16);
        for (const event of activityVariants) {
            const persisted = serializeActivityEvent(event);
            expect(persisted.eventJson).toBe(JSON.stringify(event));
            expect(parseActivityEvent(persisted.eventJson, {
                eventId: persisted.eventId,
                operationKey: persisted.operationKey,
                eventType: persisted.eventType,
                occurredAt: persisted.occurredAt,
                actorId: persisted.actorId
            })).toEqual(event);
        }
    });

    it("retains unknown future payload fields and optional actor values", () => {
        const event: ActivityEvent = {
            ...activityVariants[0]!,
            actorId: "actor-1",
        };
        const extendedEvent = { ...event, futureField: { preserved: true } };
        const persisted = serializeActivityEvent(extendedEvent);
        const decoded = parseActivityEvent(persisted.eventJson, {
            eventId: persisted.eventId,
            operationKey: persisted.operationKey,
            eventType: persisted.eventType,
            occurredAt: persisted.occurredAt,
            actorId: persisted.actorId
        });
        expect(decoded).toHaveProperty("futureField", { preserved: true });
        expect(decoded.actorId).toBe("actor-1");
    });

    it("rejects malformed JSON, missing required data and invalid nested fields", () => {
        const event = activityVariants.find(({ type }) =>
            type === "delivery.received"
        )!;
        const persisted = serializeActivityEvent(event);
        expect(() => parseActivityEvent("{bad json", persisted))
            .toThrow("invalid JSON");
        expect(() => parseActivityEvent("{}", persisted))
            .toThrow("event is invalid");
        const broken = JSON.parse(persisted.eventJson) as Record<string, unknown>;
        broken.items = [{
            ...(broken.items as Record<string, unknown>[])[0],
            stock: [{ packagingLevel: {}, quantity: "3" }]
        }];
        expect(() => parseActivityEvent(JSON.stringify(broken), persisted))
            .toThrow("event is invalid");
    });

    it("rejects every duplicate relational metadata mismatch", () => {
        const persisted = serializeActivityEvent(activityVariants[0]!);
        const metadata = {
            eventId: persisted.eventId,
            operationKey: persisted.operationKey,
            eventType: persisted.eventType,
            occurredAt: persisted.occurredAt,
            actorId: persisted.actorId
        };
        const mismatches = [
            { ...metadata, eventId: "other-id" },
            { ...metadata, operationKey: "other-operation" },
            { ...metadata, eventType: "product.deleted" },
            { ...metadata, occurredAt: "2026-11-25T11:00:00.000Z" },
            { ...metadata, actorId: "other-actor" }
        ];
        for (const mismatch of mismatches) {
            expect(() => parseActivityEvent(persisted.eventJson, mismatch))
                .toThrow("relational metadata");
        }
    });
});
