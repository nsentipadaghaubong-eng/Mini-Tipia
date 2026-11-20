import { describe, expect, it } from "vitest";
import type { DeliveryDraft } from "../deliveries/deliveryDraft";
import type { SaleDraft } from "../sales/salesDraft";
import {
    deliveryProductLockMessage,
    getProductDraftLockMessages,
    salesProductLockMessage
} from "./productDraftLock";

function makeSaleDraft(productId: string, status: SaleDraft["status"] = "draft"): SaleDraft {
    return {
        draftId: "sale-1",
        status,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        items: [{
            lineId: "line-1",
            productId,
            variantId: "variant-1",
            inventoryRecordId: "inventory-1",
            batchId: null,
            packagingLevelId: "box",
            quantity: 1,
            defaultSellingPrice: 1,
            appliedSellingPrice: 1,
            discountAmount: 0
        }]
    };
}

function makeDeliveryDraft(
    productId: string,
    status: DeliveryDraft["status"] = "draft"
): DeliveryDraft {
    return {
        deliveryId: "delivery-1",
        status,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        deliveryDate: "2026-01-01",
        receivedBy: "Staff",
        items: [{
            deliveryItemId: "item-1",
            productId,
            variantId: "variant-1",
            packagingLevelId: "box",
            quantity: 1,
            batchNumber: "LOT-1",
            expiryDate: "2027-01-01",
            costPrice: null,
            sellingPrice: null
        }]
    };
}

describe("product draft lock", () => {
    it("locks the whole product for active Sales and Receive Delivery drafts", () => {
        expect(getProductDraftLockMessages(
            "product-1",
            [makeSaleDraft("product-1")],
            [makeDeliveryDraft("product-1")]
        )).toEqual([salesProductLockMessage, deliveryProductLockMessage]);
    });

    it("ignores other products and inactive drafts", () => {
        expect(getProductDraftLockMessages(
            "product-1",
            [
                makeSaleDraft("product-2"),
                makeSaleDraft("product-1", "cancelled"),
                makeSaleDraft("product-1", "approved")
            ],
            [
                makeDeliveryDraft("product-1", "received"),
                makeDeliveryDraft("product-1", "cancelled")
            ]
        )).toEqual([]);
    });
});