import type { inventory } from "../inventory/inventoryStock";
import {
    validateBatchPricingCollection,
    type BatchPackagingPricing,
    type inventoryBatch
} from "../inventory/inventoryBatch";
import type { stockAdjustment } from "../inventory/inventoryAdjustment";
import { getStockQuantityOrZero } from "../inventory/inventoryStock";
import type { packagingLevel } from "../packaging/packagingHierarchy";
import type { productStructure, variant } from "../products/productStructure";

// Activity exists only in application memory and does not survive a restart.
export interface ActivityPackagingSnapshot {
    readonly packagingLevelId: string;
    readonly name: string;
    readonly costPrice: number | null;
    readonly sellingPrice: number | null;
    readonly quantityOfNextLevel: number | null;
    readonly nextLevelId: string | null;
    readonly nextLevelName: string | null;
}

export interface ActivityVariantSnapshot {
    readonly variantId: string;
    readonly variantName: string;
    readonly nafdacRegistrationNumber?: string;
    readonly lowStockThreshold?: {
        readonly quantity: number;
        readonly packagingLevelId?: string;
    };
    readonly packaging: readonly ActivityPackagingSnapshot[];
}

export interface ActivityProductSnapshot {
    readonly productId: string;
    readonly productName: string;
    readonly description?: string;
    readonly genericName?: string;
    readonly manufacturer?: string;
    readonly category?: string;
    readonly variants: readonly ActivityVariantSnapshot[];
}

export interface ActivityBatchSnapshot {
    readonly batchId: string;
    readonly productId: string;
    readonly productName: string;
    readonly variantId: string;
    readonly variantName: string;
    readonly batchNumber: string | null;
    readonly expiryDate: string | null;
    readonly receivedDate?: string;
    readonly pricingByPackagingLevel: readonly (
        BatchPackagingPricing & { readonly packagingLevelName: string }
    )[];
}

export interface ActivityStockSnapshot {
    readonly packagingLevel: ActivityPackagingSnapshot;
    readonly quantity: number;
}

export interface ActivityInventorySnapshot {
    readonly inventoryId: string;
    readonly productId: string;
    readonly productName: string;
    readonly variantId: string;
    readonly variantName: string;
    readonly batch: ActivityBatchSnapshot | null;
    readonly stock: readonly ActivityStockSnapshot[];
}

export interface ActivityInventoryRecordStateSnapshot {
    readonly id: string;
    readonly productId: string;
    readonly variantId: string;
    readonly batchId: string | null;
    readonly stockQuantities: readonly {
        readonly packagingLevelId: string;
        readonly quantity: number;
    }[];
}

export interface ActivityInventoryBatchStateSnapshot {
    readonly batchId: string;
    readonly productId: string;
    readonly variantId: string;
    readonly batchNumber: string | null;
    readonly expiryDate: string | null;
    readonly receivedDate?: string;
    readonly pricingByPackagingLevel: readonly BatchPackagingPricing[];
}

export interface ActivityProductInventoryStateSnapshot {
    readonly inventoryRecords: readonly ActivityInventoryRecordStateSnapshot[];
    readonly inventoryBatches: readonly ActivityInventoryBatchStateSnapshot[];
}

export interface ActivityRemovedPackagingStockSnapshot {
    readonly inventoryId: string;
    readonly batch: ActivityBatchSnapshot | null;
    readonly quantity: number;
}

export interface ActivityBaseInput {
    readonly operationKey: string;
    readonly actorId?: string;
}

export type ActivityEventInput = ActivityBaseInput & (
    | {
        readonly type: "product.created";
        readonly product: ActivityProductSnapshot;
        readonly initialInventory: readonly ActivityInventorySnapshot[];
    }
    | {
        readonly type: "product.updated";
        readonly productId: string;
        readonly productName: string;
        readonly before: ActivityProductSnapshot;
        readonly after: ActivityProductSnapshot;
        readonly reason: string;
        readonly inventoryStateAfter?: ActivityProductInventoryStateSnapshot;
    }
    | {
        readonly type: "product.deleted";
        readonly productId: string;
        readonly productName: string;
        readonly product: ActivityProductSnapshot;
        readonly inventory: readonly ActivityInventorySnapshot[];
        readonly batches: readonly ActivityBatchSnapshot[];
        readonly reason: string;
    }
    | {
        readonly type: "product.variant_added";
        readonly productId: string;
        readonly productName: string;
        readonly variant: ActivityVariantSnapshot;
        readonly reason: string;
    }
    | {
        readonly type: "product.variant_updated";
        readonly productId: string;
        readonly productName: string;
        readonly before: ActivityVariantSnapshot;
        readonly after: ActivityVariantSnapshot;
        readonly reason: string;
    }
    | {
        readonly type: "product.variant_removed";
        readonly productId: string;
        readonly productName: string;
        readonly removedVariant: ActivityVariantSnapshot;
        readonly removedBatches: readonly ActivityBatchSnapshot[];
        readonly affectedInventory: readonly ActivityInventorySnapshot[];
        readonly reason: string;
    }
    | {
        readonly type: "product.packaging_added";
        readonly productId: string;
        readonly productName: string;
        readonly variantId: string;
        readonly variantName: string;
        readonly packaging: ActivityPackagingSnapshot;
        readonly reason: string;
    }
    | {
        readonly type: "product.packaging_updated";
        readonly productId: string;
        readonly productName: string;
        readonly variantId: string;
        readonly variantName: string;
        readonly before: ActivityPackagingSnapshot;
        readonly after: ActivityPackagingSnapshot;
        readonly reason: string;
    }
    | {
        readonly type: "product.packaging_removed";
        readonly productId: string;
        readonly productName: string;
        readonly variantId: string;
        readonly variantName: string;
        readonly removedPackaging: ActivityPackagingSnapshot;
        readonly beforeHierarchy: readonly ActivityPackagingSnapshot[];
        readonly afterHierarchy: readonly ActivityPackagingSnapshot[];
        readonly removedStock: readonly ActivityRemovedPackagingStockSnapshot[];
        readonly reason: string;
    }
    | {
        readonly type: "inventory.batch_created";
        readonly source: "product_creation" | "inventory_edit";
        readonly batch: ActivityBatchSnapshot;
        readonly inventory?: ActivityInventorySnapshot;
    }
    | {
        readonly type: "inventory.batch_updated";
        readonly before: ActivityBatchSnapshot;
        readonly after: ActivityBatchSnapshot;
        readonly reason: string;
    }
    | {
        readonly type: "inventory.batch_removed";
        readonly removedBatch: ActivityBatchSnapshot;
        readonly affectedInventory: readonly ActivityInventorySnapshot[];
        readonly reason: string;
    }
    | {
        readonly type: "inventory.stock_adjusted";
        readonly inventoryId: string;
        readonly productId: string;
        readonly productName: string;
        readonly variantId: string;
        readonly variantName: string;
        readonly batch: ActivityBatchSnapshot | null;
        readonly packagingLevel: ActivityPackagingSnapshot;
        readonly previousQuantity: number;
        readonly newQuantity: number;
        readonly quantityDifference: number;
        readonly reason: string;
    }
    | {
        readonly type: "delivery.received";
        readonly deliveryId: string;
        readonly deliveryDate: string;
        readonly receivedBy: string;
        readonly supplierName: string | null;
        readonly invoiceNumber: string | null;
        readonly items: readonly {
            readonly productId: string;
            readonly productName: string;
            readonly variantId: string;
            readonly variantName: string;
            readonly batch: ActivityBatchSnapshot | null;
            readonly pricingAtReceipt: BatchPackagingPricing;
            readonly stock: readonly ActivityStockSnapshot[];
        }[];
    }
    | {
        readonly type: "sale.completed";
        readonly saleId: string;
        readonly customerName?: string;
        readonly customerAddress?: string;
        readonly saleDate?: string;
        readonly staffMember?: {
            readonly userId?: string;
            readonly displayName?: string;
        };
        readonly notes?: string;
        readonly subtotal: number;
        readonly discountAmount: number;
        readonly finalAmount: number;
        readonly expiredBatchConfirmed: boolean;
        readonly items: readonly {
            readonly productId: string;
            readonly productName: string;
            readonly variantId: string;
            readonly variantName: string;
            readonly product: ActivityProductSnapshot;
            readonly variant: ActivityVariantSnapshot;
            readonly packagingLevel: ActivityPackagingSnapshot;
            readonly quantity: number;
            readonly defaultSellingPrice: number | null;
            readonly appliedSellingPrice: number;
            readonly subtotal: number;
            readonly discountAmount: number;
            readonly finalAmount: number;
            readonly allocations: readonly {
                readonly inventoryId: string;
                readonly batch: ActivityBatchSnapshot | null;
                readonly quantity: number;
            }[];
        }[];
    }
);

export type ActivityEvent = ActivityEventInput & {
    readonly eventId: string;
    readonly occurredAt: string;
};

export interface ActivityEventFactoryOptions {
    makeId?: () => string;
    now?: () => Date;
}

export function snapshotPackagingLevel(
    level: packagingLevel,
    levels: readonly packagingLevel[]
): ActivityPackagingSnapshot {
    const nextLevel = level.nextLevelId === null
        ? undefined
        : levels.find((candidate) => candidate.id === level.nextLevelId);

    return {
        packagingLevelId: level.id,
        name: level.name,
        costPrice: level.costPrice,
        sellingPrice: level.sellingPrice,
        quantityOfNextLevel: level.quantityofNextLevel,
        nextLevelId: level.nextLevelId,
        nextLevelName: nextLevel?.name ?? null
    };
}

export function snapshotVariant(
    productVariant: variant
): ActivityVariantSnapshot {
    return {
        variantId: productVariant.id,
        variantName: productVariant.variantName,
        ...(productVariant.nafdacRegistrationNumber === undefined
            ? {}
            : { nafdacRegistrationNumber: productVariant.nafdacRegistrationNumber }),
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
        packaging: productVariant.packagingHierarchy.map((level) =>
            snapshotPackagingLevel(level, productVariant.packagingHierarchy)
        )
    };
}

export function snapshotProduct(
    product: productStructure
): ActivityProductSnapshot {
    return {
        productId: product.id,
        productName: product.name,
        ...(product.description === undefined
            ? {}
            : { description: product.description }),
        ...(product.genericName === undefined
            ? {}
            : { genericName: product.genericName }),
        ...(product.manufacturer === undefined
            ? {}
            : { manufacturer: product.manufacturer }),
        ...(product.category === undefined
            ? {}
            : { category: product.category }),
        variants: product.variant.map(snapshotVariant)
    };
}

export function snapshotProductInventoryState(
    productId: string,
    inventoryRecords: readonly inventory[],
    batches: readonly inventoryBatch[]
): ActivityProductInventoryStateSnapshot {
    return {
        inventoryRecords: inventoryRecords
            .filter((record) => record.productId === productId)
            .map((record) => ({
                id: record.id,
                productId: record.productId,
                variantId: record.variantId,
                batchId: record.batchId,
                stockQuantities: record.stockQuantities.map((stock) => ({
                    packagingLevelId: stock.packagingLevelId,
                    quantity: stock.quantity
                }))
            })),
        inventoryBatches: batches
            .filter((batch) => batch.productId === productId)
            .map((batch) => ({
                batchId: batch.batchId,
                productId: batch.productId,
                variantId: batch.variantId,
                batchNumber: batch.batchNumber,
                expiryDate: batch.expiryDate?.toISOString() ?? null,
                ...(batch.receivedDate === undefined
                    ? {}
                    : { receivedDate: batch.receivedDate }),
                pricingByPackagingLevel: batch.pricingByPackagingLevel.map(
                    (pricing) => ({ ...pricing })
                )
            }))
    };
}

export function snapshotBatch(
    batch: inventoryBatch,
    product: productStructure
): ActivityBatchSnapshot {
    const productVariant = product.variant.find(
        (candidate) => candidate.id === batch.variantId
    );
    if (!productVariant || product.id !== batch.productId) {
        throw new Error("Cannot snapshot a batch with invalid product relationships.");
    }
    validateBatchPricingCollection(
        batch.pricingByPackagingLevel,
        productVariant.packagingHierarchy.map((level) => level.id)
    );

    return {
        batchId: batch.batchId,
        productId: batch.productId,
        productName: product.name,
        variantId: batch.variantId,
        variantName: productVariant.variantName,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate?.toISOString() ?? null,
        ...(batch.receivedDate === undefined
            ? {}
            : { receivedDate: batch.receivedDate }),
        pricingByPackagingLevel: batch.pricingByPackagingLevel.map(
            (pricing) => {
                const packagingLevel = productVariant.packagingHierarchy.find(
                    (level) => level.id === pricing.packagingLevelId
                );
                if (!packagingLevel) {
                    throw new Error(
                        "Cannot snapshot pricing for an unknown packaging level."
                    );
                }
                return {
                    ...pricing,
                    packagingLevelName: packagingLevel.name
                };
            }
        )
    };
}

export function snapshotInventory(
    record: inventory,
    product: productStructure,
    batches: readonly inventoryBatch[]
): ActivityInventorySnapshot {
    const productVariant = product.variant.find(
        (candidate) => candidate.id === record.variantId
    );
    if (product.id !== record.productId || !productVariant) {
        throw new Error("Cannot snapshot inventory with invalid product relationships.");
    }

    const batch = record.batchId === null
        ? null
        : batches.find((candidate) =>
            candidate.batchId === record.batchId &&
            candidate.productId === record.productId &&
            candidate.variantId === record.variantId
        );
    if (record.batchId !== null && !batch) {
        throw new Error("Cannot snapshot inventory with an invalid batch relationship.");
    }

    const stock = record.stockQuantities.map((quantity) => {
        const level = productVariant.packagingHierarchy.find(
            (candidate) => candidate.id === quantity.packagingLevelId
        );
        if (!level) {
            throw new Error("Cannot snapshot inventory with an invalid packaging relationship.");
        }

        return {
            packagingLevel: snapshotPackagingLevel(
                level,
                productVariant.packagingHierarchy
            ),
            quantity: quantity.quantity
        };
    });

    return {
        inventoryId: record.id,
        productId: product.id,
        productName: product.name,
        variantId: productVariant.id,
        variantName: productVariant.variantName,
        batch: batch ? snapshotBatch(batch, product) : null,
        stock
    };
}

export function buildProductDeletionActivityInput(
    product: productStructure,
    inventoryRecords: readonly inventory[],
    batches: readonly inventoryBatch[],
    operationKey: string,
    reason: string
): ActivityEventInput {
    const productInventory = inventoryRecords.filter(
        (record) => record.productId === product.id
    );
    const productBatches = batches.filter(
        (batch) => batch.productId === product.id
    );

    return {
        type: "product.deleted",
        operationKey,
        productId: product.id,
        productName: product.name,
        product: snapshotProduct(product),
        inventory: productInventory.map((record) =>
            snapshotInventory(record, product, batches)
        ),
        batches: productBatches.map((batch) => snapshotBatch(batch, product)),
        reason: reason.trim()
    };
}

export function buildProductCreationActivityInputs(
    product: productStructure,
    inventoryRecords: readonly inventory[],
    batches: readonly inventoryBatch[]
): ActivityEventInput[] {
    const initialInventory = inventoryRecords.map((record) =>
        snapshotInventory(record, product, batches)
    );

    return [
        {
            type: "product.created",
            operationKey: `product.created:${product.id}`,
            product: snapshotProduct(product),
            initialInventory
        },
        ...batches
            .filter((batch) => batch.productId === product.id)
            .map((batch) => ({
                type: "inventory.batch_created" as const,
                operationKey: `inventory.batch_created:${batch.batchId}`,
                source: "product_creation" as const,
                batch: snapshotBatch(batch, product)
            }))
    ];
}

export function buildBatchCreatedActivityInput(
    operationId: string,
    product: productStructure,
    batch: inventoryBatch,
    inventoryRecord: inventory
): ActivityEventInput {
    return {
        type: "inventory.batch_created",
        operationKey: `inventory.batch_created:${operationId}:${batch.batchId}`,
        source: "inventory_edit",
        batch: snapshotBatch(batch, product),
        inventory: snapshotInventory(inventoryRecord, product, [batch])
    };
}

export function buildStockAdjustmentActivityInput(
    adjustment: stockAdjustment,
    product: productStructure,
    batches: readonly inventoryBatch[],
    operationId: string
): ActivityEventInput {
    const productVariant = product.variant.find(
        (candidate) => candidate.id === adjustment.variantId
    );
    const packagingLevel = productVariant?.packagingHierarchy.find(
        (candidate) => candidate.id === adjustment.packagingLevelId
    );
    if (
        product.id !== adjustment.productId ||
        !productVariant ||
        !packagingLevel
    ) {
        throw new Error("Cannot record an adjustment with invalid product relationships.");
    }

    const batch = adjustment.batchId === null
        ? null
        : batches.find((candidate) =>
            candidate.batchId === adjustment.batchId &&
            candidate.productId === adjustment.productId &&
            candidate.variantId === adjustment.variantId
        );
    if (adjustment.batchId !== null && !batch) {
        throw new Error("Cannot record an adjustment with an invalid batch relationship.");
    }

    return {
        type: "inventory.stock_adjusted",
        operationKey:
            `inventory.stock_adjusted:${operationId}:${adjustment.inventoryId}:${adjustment.packagingLevelId}`,
        inventoryId: adjustment.inventoryId,
        productId: product.id,
        productName: product.name,
        variantId: productVariant.id,
        variantName: productVariant.variantName,
        batch: batch ? snapshotBatch(batch, product) : null,
        packagingLevel: snapshotPackagingLevel(
            packagingLevel,
            productVariant.packagingHierarchy
        ),
        previousQuantity: adjustment.previousQuantity,
        newQuantity: adjustment.newQuantity,
        quantityDifference: adjustment.quantityDifference,
        reason: adjustment.reason
    };
}

export function buildProductUpdateActivityInputs(
    previousProduct: productStructure,
    product: productStructure,
    previousInventory: readonly inventory[],
    nextInventory: readonly inventory[],
    batches: readonly inventoryBatch[],
    operationId: string,
    reason: string
): ActivityEventInput[] {
    const inputs: ActivityEventInput[] = [{
        type: "product.updated",
        operationKey: operationId,
        productId: product.id,
        productName: product.name,
        before: snapshotProduct(previousProduct),
        after: snapshotProduct(product),
        reason,
        inventoryStateAfter: snapshotProductInventoryState(
            product.id,
            nextInventory,
            batches
        )
    }];

    for (const productVariant of product.variant) {
        const previousVariant = previousProduct.variant.find(
            (candidate) => candidate.id === productVariant.id
        );
        const previousPackagingIds = new Set(
            previousVariant?.packagingHierarchy.map((level) => level.id) ?? []
        );

        for (const level of productVariant.packagingHierarchy) {
            if (previousPackagingIds.has(level.id)) {
                continue;
            }

            for (const record of nextInventory) {
                if (
                    record.productId !== product.id ||
                    record.variantId !== productVariant.id
                ) {
                    continue;
                }

                const previousRecord = previousInventory.find(
                    (candidate) => candidate.id === record.id
                );
                const previousQuantity = previousRecord
                    ? getStockQuantityOrZero(previousRecord, level.id)
                    : 0;
                const newQuantity = getStockQuantityOrZero(record, level.id);
                const quantityDifference = newQuantity - previousQuantity;
                if (quantityDifference === 0) {
                    continue;
                }
                if (quantityDifference < 0) {
                    throw new Error(
                        "Initial packaging stock cannot reduce an existing quantity."
                    );
                }

                const adjustment: stockAdjustment = {
                    id: crypto.randomUUID(),
                    inventoryId: record.id,
                    productId: record.productId,
                    variantId: record.variantId,
                    batchId: record.batchId,
                    packagingLevelId: level.id,
                    previousQuantity,
                    newQuantity,
                    quantityDifference,
                    reason: `Initial stock added for packaging level ${level.name}`,
                    createdAt: new Date()
                };
                inputs.push(buildStockAdjustmentActivityInput(
                    adjustment,
                    product,
                    batches,
                    operationId
                ));
            }
        }
    }

    return inputs;
}

export function buildBatchUpdatedActivityInput(
    operationId: string,
    previousBatch: inventoryBatch,
    updatedBatch: inventoryBatch,
    product: productStructure,
    reason: string
): ActivityEventInput | undefined {
    const before = snapshotBatch(previousBatch, product);
    const after = snapshotBatch(updatedBatch, product);
    const beforePricing = new Map(
        before.pricingByPackagingLevel.map((entry) => [
            entry.packagingLevelId,
            entry
        ])
    );
    const afterPricing = new Map(
        after.pricingByPackagingLevel.map((entry) => [
            entry.packagingLevelId,
            entry
        ])
    );
    const pricingChanged =
        beforePricing.size !== afterPricing.size ||
        [...beforePricing].some(([packagingLevelId, entry]) => {
            const nextEntry = afterPricing.get(packagingLevelId);
            return !nextEntry ||
                entry.costPrice !== nextEntry.costPrice ||
                entry.sellingPrice !== nextEntry.sellingPrice;
        });
    if (
        before.batchNumber === after.batchNumber &&
        before.expiryDate === after.expiryDate &&
        !pricingChanged
    ) {
        return undefined;
    }

    return {
        type: "inventory.batch_updated",
        operationKey:
            `inventory.batch_updated:${operationId}:${updatedBatch.batchId}`,
        before,
        after,
        reason: reason.trim()
    };
}

export function buildVariantRemovalActivityInput(
    operationId: string,
    product: productStructure,
    variant: variant,
    affectedInventory: readonly inventory[],
    batches: readonly inventoryBatch[],
    reason: string
): ActivityEventInput {
    const variantSnapshot = snapshotVariant(variant);
    const inventorySnapshots = affectedInventory
        .filter((record) => record.productId === product.id && record.variantId === variant.id)
        .map((record) => snapshotInventory(record, product, batches));

    return {
        type: "product.variant_removed",
        operationKey: `product.variant_removed:${operationId}:${variant.id}`,
        productId: product.id,
        productName: product.name,
        removedVariant: variantSnapshot,
        removedBatches: batches
            .filter((batch) =>
                batch.productId === product.id && batch.variantId === variant.id
            )
            .map((batch) => snapshotBatch(batch, product)),
        affectedInventory: inventorySnapshots,
        reason: reason.trim()
    };
}

export function buildPackagingRemovalActivityInput(
    operationId: string,
    product: productStructure,
    variant: variant,
    level: packagingLevel,
    nextHierarchy: readonly packagingLevel[],
    inventoryRecords: readonly inventory[],
    batches: readonly inventoryBatch[],
    reason: string
): ActivityEventInput {
    const removedStock = inventoryRecords
        .filter((record) =>
            record.productId === product.id &&
            record.variantId === variant.id &&
            record.stockQuantities.some((stock) => stock.packagingLevelId === level.id)
        )
        .flatMap((record) =>
            record.stockQuantities
                .filter((stock) => stock.packagingLevelId === level.id)
                .map((stock) => ({
                    inventoryId: record.id,
                    batch: record.batchId === null
                        ? null
                        : batches.find((candidate) =>
                            candidate.batchId === record.batchId &&
                            candidate.productId === record.productId &&
                            candidate.variantId === record.variantId
                        )
                            ? snapshotBatch(
                                batches.find((candidate) =>
                                    candidate.batchId === record.batchId &&
                                    candidate.productId === record.productId &&
                                    candidate.variantId === record.variantId
                                )!,
                                product
                            )
                            : null,
                    quantity: stock.quantity
                }))
        );

    return {
        type: "product.packaging_removed",
        operationKey: `product.packaging_removed:${operationId}:${level.id}`,
        productId: product.id,
        productName: product.name,
        variantId: variant.id,
        variantName: variant.variantName,
        removedPackaging: snapshotPackagingLevel(level, variant.packagingHierarchy),
        beforeHierarchy: variant.packagingHierarchy.map((packaging) =>
            snapshotPackagingLevel(packaging, variant.packagingHierarchy)
        ),
        afterHierarchy: nextHierarchy.map((packaging) =>
            snapshotPackagingLevel(packaging, nextHierarchy)
        ),
        removedStock,
        reason: reason.trim()
    };
}

export function buildBatchRemovalActivityInput(
    operationId: string,
    product: productStructure,
    batch: inventoryBatch,
    affectedInventory: readonly inventory[],
    batches: readonly inventoryBatch[],
    reason: string
): ActivityEventInput {
    const batchSnapshot = snapshotBatch(batch, product);
    const inventorySnapshots = affectedInventory
        .filter((record) =>
            record.productId === product.id &&
            record.variantId === batch.variantId &&
            record.batchId === batch.batchId
        )
        .map((record) => snapshotInventory(record, product, batches));

    return {
        type: "inventory.batch_removed",
        operationKey: `inventory.batch_removed:${operationId}:${batch.batchId}`,
        removedBatch: batchSnapshot,
        affectedInventory: inventorySnapshots,
        reason: reason.trim()
    };
}

export function prepareActivityEvents(
    inputs: readonly ActivityEventInput[],
    options: ActivityEventFactoryOptions = {}
): ActivityEvent[] {
    const makeId = options.makeId ?? (() => crypto.randomUUID());
    const now = options.now ?? (() => new Date());
    const seenIds = new Set<string>();

    return inputs.map((input) => {
        if (input.operationKey.trim() === "") {
            throw new Error("Activity operation key must not be empty.");
        }
        const clonedInput = structuredClone(input);
        const normalizedInput = "reason" in clonedInput
            ? { ...clonedInput, reason: clonedInput.reason.trim() }
            : clonedInput;
        if ("reason" in normalizedInput && normalizedInput.reason === "") {
            throw new Error("Activity reason must not be empty.");
        }

        const eventId = makeId();
        if (eventId.trim() === "" || seenIds.has(eventId)) {
            throw new Error("Activity event IDs must be unique and non-empty.");
        }
        seenIds.add(eventId);

        const occurredAt = now();
        if (Number.isNaN(occurredAt.getTime())) {
            throw new Error("Activity timestamp must be a valid date.");
        }

        return deepFreeze({
            ...normalizedInput,
            eventId,
            occurredAt: occurredAt.toISOString()
        }) as ActivityEvent;
    });
}

export function appendActivityEvents(
    current: readonly ActivityEvent[],
    incoming: readonly ActivityEvent[]
): ActivityEvent[] {
    const eventIds = new Set(current.map((event) => event.eventId));
    const operationKeys = new Set(
        current.map((event) => event.operationKey)
    );
    const additions: ActivityEvent[] = [];

    for (const event of incoming) {
        if (event.operationKey.trim() === "") {
            throw new Error("Activity operation key must not be empty.");
        }
        if (operationKeys.has(event.operationKey)) {
            continue;
        }
        if (eventIds.has(event.eventId)) {
            throw new Error(`Duplicate Activity event ID: ${event.eventId}`);
        }

        eventIds.add(event.eventId);
        operationKeys.add(event.operationKey);
        additions.push(event);
    }

    return additions.length === 0
        ? current as ActivityEvent[]
        : [...current, ...additions];
}

function deepFreeze<T>(value: T): T {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
        for (const nested of Object.values(value as Record<string, unknown>)) {
            deepFreeze(nested);
        }
        Object.freeze(value);
    }

    return value;
}
