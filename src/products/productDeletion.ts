import type { DeliveryDraft } from "../deliveries/deliveryDraft";
import type { SaleDraft } from "../sales/salesDraft";

export function getProductDeletionBlockMessages(
    productId: string,
    saleDrafts: readonly SaleDraft[],
    deliveryDrafts: readonly DeliveryDraft[]
): string[] {
    const messages: string[] = [];
    const referencedBySaleDraft = saleDrafts.some(
        (draft) =>
            draft.status === "draft" &&
            draft.items.some((item) => item.productId === productId)
    );
    const referencedByDeliveryDraft = deliveryDrafts.some(
        (draft) =>
            draft.status === "draft" &&
            draft.items.some((item) => item.productId === productId)
    );

    if (referencedBySaleDraft) {
        messages.push(
            "This product is currently in a Sales draft and cannot be deleted. Please complete or cancel the Sales draft before attempting to delete this product."
        );
    }
    if (referencedByDeliveryDraft) {
        messages.push(
            "This product is currently in a Receive Delivery draft and cannot be deleted. Please complete or cancel the Receive Delivery draft before attempting to delete this product."
        );
    }

    return messages;
}
