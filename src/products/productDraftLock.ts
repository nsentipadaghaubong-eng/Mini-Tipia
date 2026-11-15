import type { DeliveryDraft } from "../deliveries/deliveryDraft";
import type { inventory } from "../inventory/inventoryStock";
import type { inventoryBatch } from "../inventory/inventoryBatch";
import type { SaleDraft } from "../sales/salesDraft";

export const salesProductLockMessage =
    "This product is currently in a Sales draft. Its inventory and product structure cannot be modified until the draft is completed or cancelled. You can still edit its name and description.";

export const deliveryProductLockMessage =
    "This product is currently in a Receive Delivery draft. Its inventory and product structure cannot be modified until the draft is completed or cancelled. You can still edit its name and description.";

export function getProductDraftLockMessages(
    productId: string,
    saleDrafts: readonly SaleDraft[],
    deliveryDrafts: readonly DeliveryDraft[]
): string[] {
    const messages: string[] = [];
    if (saleDrafts.some((draft) =>
        draft.status === "draft" &&
        draft.items.some((item) => item.productId === productId)
    )) {
        messages.push(salesProductLockMessage);
    }
    if (deliveryDrafts.some((draft) =>
        draft.status === "draft" &&
        draft.items.some((item) => item.productId === productId)
    )) {
        messages.push(deliveryProductLockMessage);
    }
    return messages;
}

export function getChangedInventoryProductIds(
    previousRecords: readonly inventory[],
    previousBatches: readonly inventoryBatch[],
    nextRecords: readonly inventory[],
    nextBatches: readonly inventoryBatch[]
): Set<string> {
    const productIds = new Set([
        ...previousRecords.map((record) => record.productId),
        ...previousBatches.map((batch) => batch.productId),
        ...nextRecords.map((record) => record.productId),
        ...nextBatches.map((batch) => batch.productId)
    ]);
    const changedProductIds = new Set<string>();

    for (const productId of productIds) {
        const previousProductRecords = previousRecords
            .filter((record) => record.productId === productId)
            .sort((first, second) => first.id.localeCompare(second.id));
        const nextProductRecords = nextRecords
            .filter((record) => record.productId === productId)
            .sort((first, second) => first.id.localeCompare(second.id));
        const previousProductBatches = previousBatches
            .filter((batch) => batch.productId === productId)
            .sort((first, second) => first.batchId.localeCompare(second.batchId));
        const nextProductBatches = nextBatches
            .filter((batch) => batch.productId === productId)
            .sort((first, second) => first.batchId.localeCompare(second.batchId));

        if (
            JSON.stringify(previousProductRecords) !==
                JSON.stringify(nextProductRecords) ||
            JSON.stringify(previousProductBatches) !==
                JSON.stringify(nextProductBatches)
        ) {
            changedProductIds.add(productId);
        }
    }

    return changedProductIds;
}