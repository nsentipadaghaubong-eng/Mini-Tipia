import { describe, expect, it } from "vitest";
import { aggregateVariantStock } from "./inventoryAggregation";
import { getAllInventoryDisplay, type inventoryDisplay } from "./inventoryLookup";
import { adjustInventoryStock } from "./inventoryAdjustment";
import { getVariantLowStockStatus } from "./lowStock";
import type { inventory } from "./inventoryStock";
import type { productStructure, variant } from "../products/productStructure";
import {
    addDeliveryDraftItem,
    createDeliveryDraft
} from "../deliveries/deliveryDraft";
import { prepareDeliveryApproval } from "../deliveries/deliveryApproval";
import { completeSale, prepareSaleDraft } from "../sales/salesEngine";
import type { SaleDraft } from "../sales/salesDraft";

const packagingHierarchy = [
    {
        id: "case",
        name: "Case",
        costPrice: null,
        sellingPrice: 300,
        quantityofNextLevel: 10,
        nextLevelId: "box"
    },
    {
        id: "box",
        name: "Box",
        costPrice: null,
        sellingPrice: 30,
        quantityofNextLevel: 6,
        nextLevelId: "tablet"
    },
    {
        id: "tablet",
        name: "Tablet",
        costPrice: null,
        sellingPrice: 5,
        quantityofNextLevel: null,
        nextLevelId: null
    }
] as const;

function testVariant(overrides: Partial<variant> = {}): variant {
    return {
        id: "variant-1",
        variantName: "Tablets",
        packagingHierarchy: packagingHierarchy.map((level) => ({ ...level })),
        lowStockThreshold: { quantity: 0 },
        ...overrides
    };
}

function displayRecord(
    selectedVariant: variant,
    batchId: string | null,
    stockQuantities: inventoryDisplay["stockQuantities"],
    expiryDate: Date | null
): inventoryDisplay {
    return {
        inventoryId: `inventory-${batchId ?? "unbatched"}`,
        productId: "product-1",
        variantId: selectedVariant.id,
        batchId,
        productName: "Medicine",
        variantName: selectedVariant.variantName,
        batchNumber: batchId,
        expiryDate,
        packagingLevels: selectedVariant.packagingHierarchy,
        stockQuantities
    };
}

function statusFromRecords(
    selectedVariant: variant,
    records: inventory[]
) {
    const product: productStructure = {
        id: records[0]?.productId ?? "product-1",
        name: "Medicine",
        variant: [selectedVariant]
    };
    const display = getAllInventoryDisplay(records, [product], []);
    return getVariantLowStockStatus(
        selectedVariant,
        aggregateVariantStock(display)
    );
}

function simpleProduct(threshold = 5): productStructure {
    return {
        id: "product-simple",
        name: "Simple medicine",
        variant: [{
            id: "variant-simple",
            variantName: "Unit",
            packagingHierarchy: [{
                id: "unit",
                name: "Unit",
                costPrice: null,
                sellingPrice: 10,
                quantityofNextLevel: null,
                nextLevelId: null
            }],
            lowStockThreshold: {
                quantity: threshold,
                packagingLevelId: "unit"
            }
        }]
    };
}

function simpleInventory(quantity: number, batchId: string | null = null): inventory {
    return {
        id: "inventory-simple",
        productId: "product-simple",
        variantId: "variant-simple",
        batchId,
        stockQuantities: [{ packagingLevelId: "unit", quantity }]
    };
}

describe("variant low-stock thresholds", () => {
    it("aggregates stock across multiple batches, including expired stock and mixed packaging levels", () => {
        const selectedVariant = testVariant({
            lowStockThreshold: { quantity: 245 }
        });
        const records = [
            displayRecord(selectedVariant, "expired-case", [
                { packagingLevelId: "case", quantity: 1 }
            ], new Date("2020-01-01")),
            displayRecord(selectedVariant, "box-stock", [
                { packagingLevelId: "box", quantity: 3 }
            ], new Date("2027-01-01")),
            displayRecord(selectedVariant, "tablet-stock", [
                { packagingLevelId: "tablet", quantity: 5 }
            ], null)
        ];
        const aggregate = aggregateVariantStock(records);

        expect(aggregate?.stockQuantities).toEqual([
            { packagingLevelId: "case", quantity: 1 },
            { packagingLevelId: "box", quantity: 3 },
            { packagingLevelId: "tablet", quantity: 5 }
        ]);
        expect(getVariantLowStockStatus(selectedVariant, aggregate)).toMatchObject({
            thresholdConfigured: true,
            isLowStock: true,
            thresholdPackagingLevelId: "tablet"
        });
    });

    it.each([
        [82, false],
        [83, true],
        [84, true],
        [246, true]
    ])("classifies stock below, equal to, and above the threshold", (
        threshold,
        isLowStock
    ) => {
        const selectedVariant = testVariant({ lowStockThreshold: { quantity: threshold } });
        const aggregate = aggregateVariantStock([
            displayRecord(selectedVariant, "case-1", [
                { packagingLevelId: "case", quantity: 1 }
            ], null),
            displayRecord(selectedVariant, "box-1", [
                { packagingLevelId: "box", quantity: 3 }
            ], null),
            displayRecord(selectedVariant, "tablet-1", [
                { packagingLevelId: "tablet", quantity: 5 }
            ], null)
        ]);

        expect(getVariantLowStockStatus(selectedVariant, aggregate).isLowStock)
            .toBe(isLowStock);
    });

    it.each([
        { quantity: 0, hasStock: false, isLowStock: false },
        { quantity: 1, hasStock: true, isLowStock: true },
        { quantity: 10, hasStock: true, isLowStock: true },
        { quantity: 11, hasStock: true, isLowStock: false }
    ])(
        "classifies $quantity units against a threshold of 10",
        ({ quantity, hasStock, isLowStock }) => {
            const selectedVariant = simpleProduct(10).variant[0];

            expect(statusFromRecords(
                selectedVariant,
                [simpleInventory(quantity)]
            )).toMatchObject({ hasStock, isLowStock });
        }
    );

    it("uses an explicitly selected threshold packaging level and keeps thresholds variant-specific", () => {
        const firstVariant = testVariant({
            lowStockThreshold: {
                quantity: 4,
                packagingLevelId: "box"
            }
        });
        const secondVariant = testVariant({
            id: "variant-2",
            lowStockThreshold: {
                quantity: 5,
                packagingLevelId: "box"
            }
        });
        const firstAggregate = aggregateVariantStock([
            displayRecord(firstVariant, "box-stock-1", [
                { packagingLevelId: "box", quantity: 4 },
                { packagingLevelId: "tablet", quantity: 5 }
            ], null)
        ]);
        const secondAggregate = aggregateVariantStock([
            displayRecord(secondVariant, "box-stock-2", [
                { packagingLevelId: "box", quantity: 4 },
                { packagingLevelId: "tablet", quantity: 5 }
            ], null)
        ]);

        expect(getVariantLowStockStatus(firstVariant, firstAggregate))
            .toMatchObject({
                isLowStock: false,
                thresholdPackagingLevelId: "box"
            });
        expect(getVariantLowStockStatus(secondVariant, secondAggregate))
            .toMatchObject({
                isLowStock: true,
                thresholdPackagingLevelId: "box"
            });
    });

    it("converts a highest-level threshold to terminal units before comparison", () => {
        const selectedVariant = testVariant({
            lowStockThreshold: {
                quantity: 2,
                packagingLevelId: "case"
            }
        });
        const aggregate = aggregateVariantStock([
            displayRecord(selectedVariant, "tablet-stock", [
                { packagingLevelId: "tablet", quantity: 65 }
            ], null)
        ]);

        expect(getVariantLowStockStatus(selectedVariant, aggregate)).toMatchObject({
            thresholdConfigured: true,
            thresholdPackagingLevelId: "case",
            hasStock: true,
            isLowStock: true
        });
    });

    it("does not classify unconfigured variants as low stock", () => {
        const selectedVariant = testVariant({ lowStockThreshold: undefined });
        const aggregate = aggregateVariantStock([
            displayRecord(selectedVariant, "expired-stock", [
                { packagingLevelId: "tablet", quantity: 0 }
            ], new Date("2020-01-01"))
        ]);

        expect(getVariantLowStockStatus(selectedVariant, aggregate))
            .toMatchObject({
                thresholdConfigured: false,
                isLowStock: false,
                hasStock: false
            });
    });

    it("reclassifies stock after a completed Sale", () => {
        const product = simpleProduct();
        const record = simpleInventory(6);
        const saleDraft: SaleDraft = {
            draftId: "sale-draft",
            status: "draft",
            createdAt: "2026-11-06T10:00:00.000Z",
            updatedAt: "2026-11-06T10:00:00.000Z",
            items: [{
                lineId: "sale-line",
                productId: product.id,
                variantId: product.variant[0].id,
                inventoryRecordId: record.id,
                batchId: null,
                packagingLevelId: "unit",
                quantity: 2,
                defaultSellingPrice: 10,
                appliedSellingPrice: 10,
                discountAmount: 0
            }]
        };
        const plan = prepareSaleDraft(saleDraft, {
            products: [product],
            inventoryRecords: [record],
            inventoryBatches: []
        });
        const completion = completeSale(plan, {
            now: () => new Date("2026-11-06T10:01:00.000Z"),
            makeId: () => "completed-sale",
            makeEventId: () => "sale-event"
        });

        expect(completion.updatedInventory[0].stockQuantities[0].quantity).toBe(4);
        expect(statusFromRecords(product.variant[0], [...completion.updatedInventory]))
            .toMatchObject({ isLowStock: true });
    });

    it("reclassifies stock after Delivery approval", () => {
        const product = simpleProduct();
        const record = simpleInventory(4);
        let id = 0;
        const draft = addDeliveryDraftItem(
            createDeliveryDraft({
                deliveryDate: "2026-11-07",
                receivedBy: "Pharmacist"
            }, {
                makeId: () => "delivery-draft",
                now: () => new Date("2026-11-07T10:00:00.000Z")
            }),
            {
                deliveryItemId: "delivery-line",
                productId: product.id,
                variantId: product.variant[0].id,
                packagingLevelId: "unit",
                quantity: 2,
                batchNumber: "LOT-1",
                expiryDate: null,
                costPrice: null,
                sellingPrice: null
            },
            "2026-11-07T10:01:00.000Z"
        );
        const plan = prepareDeliveryApproval(
            draft,
            [product],
            [record],
            [],
            {
                makeId: () => `delivery-record-${++id}`,
                now: () => new Date("2026-11-07T10:02:00.000Z")
            }
        );
        const approvedRecords = getAllInventoryDisplay(
            plan.inventoryRecords,
            [product],
            plan.inventoryBatches
        );

        expect(plan.inventoryRecords.reduce(
            (total, item) => total + item.stockQuantities[0].quantity,
            0
        )).toBe(6);
        expect(getVariantLowStockStatus(
            product.variant[0],
            aggregateVariantStock(approvedRecords)
        )).toMatchObject({ isLowStock: false });
    });

    it("reclassifies stock after an Inventory adjustment", () => {
        const product = simpleProduct();
        const record = simpleInventory(6);
        const result = adjustInventoryStock(
            product,
            record,
            "unit",
            4,
            "Stock count correction"
        );

        expect(statusFromRecords(
            product.variant[0],
            [result.updatedInventory]
        )).toMatchObject({ isLowStock: true });
    });
});
