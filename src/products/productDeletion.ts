import type { DeliveryDraft } from "../deliveries/deliveryDraft";
import type { SaleDraft } from "../sales/salesDraft";
import {
    buildPackagingRemovalActivityInput,
    buildVariantRemovalActivityInput,
    type ActivityEventInput
} from "../activity/activity";
import type { inventory } from "../inventory/inventoryStock";
import type { inventoryBatch } from "../inventory/inventoryBatch";
import { removePackagingLevelFromHierarchy } from "../packaging/packagingValidation";
import type { productStructure } from "./productStructure";
import { getProductDraftLockMessages } from "./productDraftLock";

export type ProductRecordDeletionTarget =
    | {
        kind: "variant";
        productId: string;
        variantId: string;
    }
    | {
        kind: "packaging";
        productId: string;
        variantId: string;
        packagingLevelId: string;
    }
    | {
        kind: "batch";
        productId: string;
        variantId: string;
        batchId: string;
    };

export type ProductRecordDeletionResult =
    | { success: true }
    | { success: false; error: string };

export type ProductRecordDeletionDraft =
    | {
        type: "variant";
        variantId: string;
        reason: string;
    }
    | {
        type: "packaging";
        variantId: string;
        packagingLevelId: string;
        reason: string;
    };

export type ProductRecordDeletionRequest = ProductRecordDeletionDraft & {
    operationId: string;
};

export interface ProductRecordDeletionPlan {
    product: productStructure;
    inventoryRecords: inventory[];
    inventoryBatches: inventoryBatch[];
    events: ActivityEventInput[];
}

export function getProductRecordDeletionBlockMessages(
    target: ProductRecordDeletionTarget,
    saleDrafts: readonly SaleDraft[],
    deliveryDrafts: readonly DeliveryDraft[],
    _inventoryBatches: readonly inventoryBatch[] = []
): string[] {
    void _inventoryBatches;
    return getProductDraftLockMessages(
        target.productId,
        saleDrafts,
        deliveryDrafts
    );
}

export function prepareProductRecordDeletionPlan(
    sourceProduct: productStructure,
    sourceInventoryRecords: readonly inventory[],
    sourceInventoryBatches: readonly inventoryBatch[],
    deletions: readonly ProductRecordDeletionRequest[]
): ProductRecordDeletionPlan {
    if (deletions.length === 0) {
        throw new Error("At least one deletion must be staged.");
    }

    let product = sourceProduct;
    let inventoryRecords = [...sourceInventoryRecords];
    let inventoryBatches = [...sourceInventoryBatches];
    const events: ActivityEventInput[] = [];
    const seenTargets = new Set<string>();

    for (const deletion of deletions) {
        const reason = deletion.reason.trim();
        if (reason === "") {
            throw new Error("A reason is required for every deletion.");
        }
        if (deletion.operationId.trim() === "") {
            throw new Error("Every deletion requires a unique operation ID.");
        }
        const targetKey = deletion.type === "variant"
            ? `variant:${deletion.variantId}`
            : `packaging:${deletion.variantId}:${deletion.packagingLevelId}`;
        if (seenTargets.has(targetKey)) {
            throw new Error("The same record cannot be deleted more than once in one save.");
        }
        seenTargets.add(targetKey);

        const variants = product.variant.filter(
            (productVariant) => productVariant.id === deletion.variantId
        );
        if (variants.length !== 1) {
            throw new Error(`Variant not found: ${deletion.variantId}`);
        }
        const productVariant = variants[0];

        if (deletion.type === "variant") {
            events.push(buildVariantRemovalActivityInput(
                deletion.operationId,
                product,
                productVariant,
                inventoryRecords,
                inventoryBatches,
                reason
            ));
            product = {
                ...product,
                variant: product.variant.filter(
                    (candidate) => candidate.id !== deletion.variantId
                )
            };
            inventoryRecords = inventoryRecords.filter(
                (record) =>
                    record.productId !== product.id ||
                    record.variantId !== deletion.variantId
            );
            inventoryBatches = inventoryBatches.filter(
                (batch) =>
                    batch.productId !== product.id ||
                    batch.variantId !== deletion.variantId
            );
            continue;
        }

        const levels = productVariant.packagingHierarchy.filter(
            (level) => level.id === deletion.packagingLevelId
        );
        if (levels.length !== 1) {
            throw new Error(`Packaging level not found: ${deletion.packagingLevelId}`);
        }
        const nextHierarchy = removePackagingLevelFromHierarchy(
            productVariant.packagingHierarchy,
            deletion.packagingLevelId
        );
        events.push(buildPackagingRemovalActivityInput(
            deletion.operationId,
            product,
            productVariant,
            levels[0],
            nextHierarchy,
            inventoryRecords,
            inventoryBatches,
            reason
        ));
        product = {
            ...product,
            variant: product.variant.map((candidate) =>
                candidate.id === deletion.variantId
                    ? { ...candidate, packagingHierarchy: nextHierarchy }
                    : candidate
            )
        };
        inventoryRecords = inventoryRecords.flatMap((record) => {
            if (
                record.productId !== product.id ||
                record.variantId !== deletion.variantId ||
                !record.stockQuantities.some(
                    (stock) => stock.packagingLevelId === deletion.packagingLevelId
                )
            ) {
                return [record];
            }
            const stockQuantities = record.stockQuantities.filter(
                (stock) => stock.packagingLevelId !== deletion.packagingLevelId
            );
            return stockQuantities.length > 0
                ? [{ ...record, stockQuantities }]
                : [];
        });
    }

    return { product, inventoryRecords, inventoryBatches, events };
}

export function getProductDeletionBlockMessages(
    productId: string,
    saleDrafts: readonly SaleDraft[],
    deliveryDrafts: readonly DeliveryDraft[]
): string[] {
    return getProductDraftLockMessages(productId, saleDrafts, deliveryDrafts);
}
