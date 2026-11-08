import {
    snapshotBatch,
    snapshotPackagingLevel,
    type ActivityEventInput
} from "../activity/activity";
import type { inventory } from "../inventory/inventoryStock";
import { addStock, createInventory } from "../inventory/inventoryStock";
import type { inventoryBatch } from "../inventory/inventoryBatch";
import type { productStructure } from "../products/productStructure";
import { validatePackagingHierarchy } from "../packaging/packagingValidation";
import {
    validateDeliveryApprovalDetails,
    validateDeliveryDraft,
    type DeliveryDraft,
    type DeliveryDraftItem
} from "./deliveryDraft";
import { validateInventoryRelationships } from "../inventory/inventoryValidation";

export interface DeliveryApprovalPlan {
    draft: DeliveryDraft;
    inventoryRecords: inventory[];
    inventoryBatches: inventoryBatch[];
    activity: ActivityEventInput;
}

export interface DeliveryApprovalOptions {
    makeId?: () => string;
    now?: () => Date;
}

function expiryKey(value: Date | null): string | null {
    return value?.toISOString().slice(0, 10) ?? null;
}

function findOrCreateBatch(
    item: DeliveryDraftItem,
    draft: DeliveryDraft,
    products: readonly productStructure[],
    batches: inventoryBatch[],
    usedIds: Set<string>,
    makeId: () => string
): inventoryBatch {
    const itemExpiry = item.expiryDate;
    const matching = batches.filter((batch) =>
        batch.productId === item.productId &&
        batch.variantId === item.variantId &&
        batch.batchNumber === item.batchNumber &&
        expiryKey(batch.expiryDate) === itemExpiry &&
        (item.batchNumber !== null || batch.receivedDate === draft.deliveryDate)
    );
    if (matching.length > 1) {
        throw new Error("More than one inventory batch matches this receipt.");
    }
    if (matching.length === 1) {
        return matching[0];
    }

    const batchId = makeId().trim();
    if (!batchId || usedIds.has(batchId)) {
        throw new Error("Unable to create a unique inventory batch ID.");
    }
    usedIds.add(batchId);
    const product = products.find((candidate) => candidate.id === item.productId);
    if (!product) {
        throw new Error("The selected product is no longer available.");
    }
    const productVariant = product.variant.find(
        (candidate) => candidate.id === item.variantId
    );
    if (!productVariant) {
        throw new Error("The selected variant does not belong to this product.");
    }

    const batch: inventoryBatch = {
        batchId,
        productId: item.productId,
        variantId: item.variantId,
        batchNumber: item.batchNumber,
        expiryDate: itemExpiry === null
            ? null
            : new Date(`${itemExpiry}T00:00:00.000Z`),
        receivedDate: draft.deliveryDate
    };
    snapshotBatch(batch, product);
    batches.push(batch);
    return batch;
}

function addItemStock(
    item: DeliveryDraftItem,
    batch: inventoryBatch,
    products: readonly productStructure[],
    records: inventory[],
    batches: inventoryBatch[],
    usedIds: Set<string>,
    makeId: () => string
): inventory {
    const product = products.find((candidate) => candidate.id === item.productId);
    if (!product) {
        throw new Error("The selected product is no longer available.");
    }
    const productVariant = product.variant.find(
        (candidate) => candidate.id === item.variantId
    );
    if (!productVariant) {
        throw new Error("The selected variant does not belong to this product.");
    }
    validatePackagingHierarchy(productVariant.packagingHierarchy);
    if (!productVariant.packagingHierarchy.some(
        (level) => level.id === item.packagingLevelId
    )) {
        throw new Error(
            "The selected packaging level does not belong to this variant."
        );
    }

    const matching = records.filter((record) =>
        record.productId === item.productId &&
        record.variantId === item.variantId &&
        record.batchId === batch.batchId
    );
    if (matching.length > 1) {
        throw new Error("More than one inventory record matches this batch.");
    }

    let record = matching[0];
    if (record) {
        validateInventoryRelationships(product, record, batches);
    } else {
        const inventoryId = makeId().trim();
        if (!inventoryId || usedIds.has(inventoryId)) {
            throw new Error("Unable to create a unique inventory record ID.");
        }
        usedIds.add(inventoryId);
        record = createInventory(
            item.productId,
            item.variantId,
            batch.batchId,
            [{ packagingLevelId: item.packagingLevelId, quantity: 0 }],
            inventoryId
        );
        records.push(record);
    }

    const updated = addStock(
        product,
        record,
        item.packagingLevelId,
        item.quantity
    );
    const index = records.findIndex((candidate) => candidate.id === record.id);
    records[index] = updated;
    return updated;
}

export function prepareDeliveryApproval(
    sourceDraft: DeliveryDraft,
    products: readonly productStructure[],
    inventoryRecords: readonly inventory[],
    inventoryBatches: readonly inventoryBatch[],
    options: DeliveryApprovalOptions = {}
): DeliveryApprovalPlan {
    const draft = validateDeliveryDraft(sourceDraft);
    if (draft.status !== "draft") {
        throw new Error(`Cannot approve a ${draft.status} delivery.`);
    }
    validateDeliveryApprovalDetails(draft.deliveryDate, draft.receivedBy);
    if (draft.items.length === 0) {
        throw new Error("Add at least one valid item before approving this delivery.");
    }

    const records = [...inventoryRecords];
    const batches = [...inventoryBatches];
    const usedIds = new Set([
        ...products.flatMap((product) => [
            product.id,
            ...product.variant.flatMap((productVariant) => [
                productVariant.id,
                ...productVariant.packagingHierarchy.map((level) => level.id)
            ])
        ]),
        ...records.map((record) => record.id),
        ...batches.map((batch) => batch.batchId)
    ]);
    const makeId = options.makeId ?? (() => crypto.randomUUID());
    const activityItems: Extract<ActivityEventInput, { type: "delivery.received" }>["items"][number][] = [];

    draft.items.forEach((item, index) => {
        try {
            const checkedItem = validateDeliveryDraft({
                ...draft,
                items: [item]
            }).items[0];
            const product = products.find(
                (candidate) => candidate.id === checkedItem.productId
            );
            if (!product) {
                throw new Error("Product does not exist.");
            }
            const productVariant = product.variant.find(
                (candidate) => candidate.id === checkedItem.variantId
            );
            if (!productVariant) {
                throw new Error("Variant does not belong to the selected product.");
            }
            validatePackagingHierarchy(productVariant.packagingHierarchy);
            const packagingLevel = productVariant.packagingHierarchy.find(
                (level) => level.id === checkedItem.packagingLevelId
            );
            if (!packagingLevel) {
                throw new Error("Packaging level does not belong to the selected variant.");
            }
            const batch = findOrCreateBatch(
                checkedItem,
                draft,
                products,
                batches,
                usedIds,
                makeId
            );
            addItemStock(
                checkedItem,
                batch,
                products,
                records,
                batches,
                usedIds,
                makeId
            );
            activityItems.push({
                productId: product.id,
                productName: product.name,
                variantId: productVariant.id,
                variantName: productVariant.variantName,
                batch: snapshotBatch(batch, product),
                stock: [{
                    packagingLevel: snapshotPackagingLevel(
                        packagingLevel,
                        productVariant.packagingHierarchy
                    ),
                    quantity: checkedItem.quantity
                }]
            });
        } catch (error) {
            const message = error instanceof Error
                ? error.message
                : "Invalid delivery item.";
            throw new Error(`Item ${index + 1}: ${message}`, { cause: error });
        }
    });

    const now = options.now?.() ?? new Date();
    if (!Number.isFinite(now.getTime())) {
        throw new Error("Delivery approval timestamp must be valid.");
    }
    const receivedAt = now.toISOString();
    if (Date.parse(receivedAt) < Date.parse(draft.updatedAt)) {
        throw new Error(
            "Delivery approval timestamp cannot precede the last draft update."
        );
    }

    return {
        draft: {
            ...draft,
            status: "received",
            updatedAt: receivedAt
        },
        inventoryRecords: records,
        inventoryBatches: batches,
        activity: {
            type: "delivery.received",
            operationKey: `delivery.received:${draft.deliveryId}`,
            deliveryId: draft.deliveryId,
            deliveryDate: draft.deliveryDate,
            receivedBy: draft.receivedBy,
            supplierName: draft.supplier ?? null,
            invoiceNumber: draft.invoiceNumber ?? null,
            items: activityItems
        }
    };
}
