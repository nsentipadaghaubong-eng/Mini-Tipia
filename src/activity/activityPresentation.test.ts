import { describe, expect, it } from "vitest";
import {
    prepareActivityEvents,
    type ActivityEvent,
    type ActivityEventInput
} from "./activity";
import {
    ACTIVITY_FILTER_OPTIONS,
    filterActivityEvents,
    formatActivityTime,
    getActivityPresentation,
    getActivitySearchText,
    groupActivityEvents,
    sortActivityEvents
} from "./activityPresentation";

const packaging = {
    packagingLevelId: "packaging-id-private",
    name: "Box",
    costPrice: 999,
    sellingPrice: 15,
    quantityOfNextLevel: 4,
    nextLevelId: "next-packaging-id-private",
    nextLevelName: "Pack"
} as const;

const variant = {
    variantId: "variant-id-private",
    variantName: "500 mg tablets",
    nafdacRegistrationNumber: "NAFDAC-123",
    packaging: [packaging]
} as const;

const product = {
    productId: "product-id-private",
    productName: "Medicine",
    description: "Pain relief tablets",
    genericName: "Paracetamol",
    manufacturer: "Pharma",
    category: "Analgesic",
    variants: [variant]
} as const;

const batch = {
    batchId: "batch-id-private",
    productId: product.productId,
    productName: product.productName,
    variantId: variant.variantId,
    variantName: variant.variantName,
    batchNumber: "LOT-1",
    expiryDate: "2027-12-31",
    receivedDate: "2026-11-14",
    pricingByPackagingLevel: [{
        packagingLevelId: packaging.packagingLevelId,
        costPrice: null,
        sellingPrice: 12,
        packagingLevelName: "Box"
    }]
} as const;

const inventory = {
    inventoryId: "inventory-id-private",
    productId: product.productId,
    productName: product.productName,
    variantId: variant.variantId,
    variantName: variant.variantName,
    batch,
    stock: [{ packagingLevel: packaging, quantity: 3 }]
} as const;

const eventInputs: ActivityEventInput[] = [
    {
        type: "product.created",
        operationKey: "operation-key-private",
        actorId: "actor-id-private",
        product,
        initialInventory: [inventory]
    },
    {
        type: "product.updated",
        operationKey: "update-product-private",
        productId: product.productId,
        productName: product.productName,
        before: product,
        after: { ...product, productName: "Updated medicine" },
        reason: "Corrected name"
    },
    {
        type: "product.deleted",
        operationKey: "delete-product-private",
        productId: product.productId,
        productName: product.productName,
        product,
        inventory: [inventory],
        batches: [batch]
    },
    {
        type: "product.variant_added",
        operationKey: "add-variant-private",
        productId: product.productId,
        productName: product.productName,
        variant,
        reason: "New strength"
    },
    {
        type: "product.variant_updated",
        operationKey: "update-variant-private",
        productId: product.productId,
        productName: product.productName,
        before: variant,
        after: { ...variant, variantName: "Updated tablets" },
        reason: "Corrected strength"
    },
    {
        type: "product.variant_removed",
        operationKey: "remove-variant-private",
        productId: product.productId,
        productName: product.productName,
        removedVariant: variant,
        removedBatches: [batch],
        affectedInventory: [inventory],
        reason: "Discontinued"
    },
    {
        type: "product.packaging_added",
        operationKey: "add-packaging-private",
        productId: product.productId,
        productName: product.productName,
        variantId: variant.variantId,
        variantName: variant.variantName,
        packaging,
        reason: "Added box"
    },
    {
        type: "product.packaging_updated",
        operationKey: "update-packaging-private",
        productId: product.productId,
        productName: product.productName,
        variantId: variant.variantId,
        variantName: variant.variantName,
        before: packaging,
        after: {
            ...packaging,
            name: "Updated box",
            costPrice: 1000,
            sellingPrice: 20
        },
        reason: "Renamed"
    },
    {
        type: "product.packaging_removed",
        operationKey: "remove-packaging-private",
        productId: product.productId,
        productName: product.productName,
        variantId: variant.variantId,
        variantName: variant.variantName,
        removedPackaging: packaging,
        beforeHierarchy: [packaging],
        afterHierarchy: [],
        removedStock: [{ inventoryId: inventory.inventoryId, batch, quantity: 3 }],
        reason: "Removed level"
    },
    {
        type: "inventory.batch_created",
        operationKey: "create-batch-private",
        source: "inventory_edit",
        batch,
        inventory
    },
    {
        type: "inventory.batch_updated",
        operationKey: "update-batch-private",
        before: batch,
        after: { ...batch, batchNumber: "LOT-2" },
        reason: "Corrected lot"
    },
    {
        type: "inventory.batch_removed",
        operationKey: "remove-batch-private",
        removedBatch: batch,
        affectedInventory: [inventory],
        reason: "Recalled"
    },
    {
        type: "inventory.stock_adjusted",
        operationKey: "adjust-stock-private",
        actorId: "actor-id-private",
        inventoryId: inventory.inventoryId,
        productId: product.productId,
        productName: product.productName,
        variantId: variant.variantId,
        variantName: variant.variantName,
        batch,
        packagingLevel: packaging,
        previousQuantity: 3,
        newQuantity: 5,
        quantityDifference: 2,
        reason: "Physical count"
    },
    {
        type: "delivery.received",
        operationKey: "receive-delivery-private",
        deliveryId: "delivery-id-private",
        deliveryDate: "2026-11-14",
        receivedBy: "Ada Pharmacist",
        supplierName: "Supplier Ltd",
        invoiceNumber: "INV-4",
        items: [{
            productId: product.productId,
            productName: product.productName,
            variantId: variant.variantId,
            variantName: variant.variantName,
            batch,
            pricingAtReceipt: {
                packagingLevelId: packaging.packagingLevelId,
                costPrice: null,
                sellingPrice: 12
            },
            stock: [{ packagingLevel: packaging, quantity: 3 }]
        }]
    },
    {
        type: "sale.completed",
        operationKey: "complete-sale-private",
        actorId: "actor-id-private",
        saleId: "sale-id-private",
        customerName: "Customer",
        customerAddress: "private-address",
        notes: "private-note",
        saleDate: "2026-11-14",
        staffMember: { userId: "staff-id-private", displayName: "Ada" },
        subtotal: 120,
        discountAmount: 20,
        finalAmount: 100,
        expiredBatchConfirmed: false,
        items: [{
            productId: product.productId,
            productName: product.productName,
            variantId: variant.variantId,
            variantName: variant.variantName,
            product,
            variant,
            packagingLevel: packaging,
            quantity: 2,
            defaultSellingPrice: 60,
            appliedSellingPrice: 50,
            subtotal: 120,
            discountAmount: 20,
            finalAmount: 100,
            allocations: [{ inventoryId: inventory.inventoryId, batch, quantity: 2 }]
        }]
    }
];

function prepareEvents(inputs: readonly ActivityEventInput[]): ActivityEvent[] {
    let id = 0;
    return prepareActivityEvents(inputs, {
        makeId: () => `event-${++id}`,
        now: () => new Date("2026-11-15T12:00:00.000Z")
    });
}

function presentationText(
    presentation: ReturnType<typeof getActivityPresentation>
): string {
    return [
        presentation.title,
        presentation.summary,
        presentation.actor,
        ...presentation.details.flatMap((detailSection) => [
            detailSection.title,
            ...detailSection.fields.flatMap(({ label, value }) => [label, value])
        ])
    ].filter((value): value is string => value !== undefined).join(" ");
}

describe("Activity presentation", () => {
    it("provides explicit business details for all 15 event types", () => {
        const events = prepareEvents(eventInputs);
        const presentations = events.map(getActivityPresentation);

        expect(presentations.map(({ title }) => title)).toEqual([
            "Product created",
            "Product updated",
            "Product deleted",
            "Variant added",
            "Variant updated",
            "Variant removed",
            "Packaging added",
            "Packaging updated",
            "Packaging removed",
            "Inventory batch created",
            "Inventory batch updated",
            "Inventory batch removed",
            "Stock adjusted",
            "Delivery received",
            "Sale completed"
        ]);
        expect(presentationText(presentations[0])).toContain("Pain relief tablets");
        expect(presentationText(presentations[0])).toContain("3 Box");
        expect(presentationText(presentations[1])).toContain(
            "Medicine → Updated medicine"
        );
        expect(presentationText(presentations[1])).toContain("Corrected name");
        expect(presentationText(presentations[2])).toContain("LOT-1");
        expect(presentationText(presentations[3])).toContain("New strength");
        expect(presentationText(presentations[4])).toContain(
            "500 mg tablets → Updated tablets"
        );
        expect(presentationText(presentations[5])).toContain("Discontinued");
        expect(presentationText(presentations[6])).toContain("Conversion");
        expect(presentationText(presentations[7])).toContain("₦15");
        expect(presentationText(presentations[8])).toContain("3 Box affected");
        expect(presentationText(presentations[9])).toContain("2026");
        expect(presentationText(presentations[10])).toContain("LOT-1 → LOT-2");
        expect(presentationText(presentations[11])).toContain("Recalled");
        expect(presentationText(presentations[12])).toContain(
            "3 Box → 5 Box (+2)"
        );
        expect(presentationText(presentations[13])).toContain("Ada Pharmacist");
        expect(presentationText(presentations[13])).toContain("INV-4");
        expect(presentationText(presentations[14])).toContain("Quantity sold");
    });

    it("excludes identifiers, internal metadata, snapshots and private fields", () => {
        const presentations = prepareEvents(eventInputs).map(
            getActivityPresentation
        );
        const exposedText = JSON.stringify(presentations);

        for (const privateValue of [
            "product-id-private",
            "variant-id-private",
            "batch-id-private",
            "inventory-id-private",
            "packaging-id-private",
            "next-packaging-id-private",
            "sale-id-private",
            "delivery-id-private",
            "event-1",
            "actor-id-private",
            "staff-id-private",
            "operation-key-private",
            "inventory_edit",
            "private-address",
            "private-note"
        ]) {
            expect(exposedText).not.toContain(privateValue);
        }
        expect(presentationText(presentations[0])).not.toContain("Cost price");
        expect(presentationText(presentations[0])).not.toContain("₦999");
        expect(presentationText(presentations[9])).not.toContain("₦12");
        expect(presentations[12].actor).toBeUndefined();
        expect(presentations[14].actor).toBe("Staff: Ada");
    });

    it("shows only fields that changed in product, variant and packaging updates", () => {
        const presentations = prepareEvents(eventInputs).map(
            getActivityPresentation
        );
        const productUpdateText = presentationText(presentations[1]);
        const variantUpdateText = presentationText(presentations[4]);
        const packagingUpdateText = presentationText(presentations[7]);

        expect(productUpdateText).toContain("Name");
        expect(productUpdateText).not.toContain("Description");
        expect(variantUpdateText).toContain(
            "500 mg tablets → Updated tablets"
        );
        expect(packagingUpdateText).toContain("Box → Updated box");
        expect(packagingUpdateText).toContain("₦15 → ₦20");
        expect(packagingUpdateText).toContain("Cost price");
        expect(packagingUpdateText).toContain("₦999 → ₦1,000");
    });

    it("shows receipt-time prices and pricing-only batch changes", () => {
        const deliveryInput = eventInputs.find(
            (input) => input.type === "delivery.received"
        );
        const batchUpdateInput = eventInputs.find(
            (input) => input.type === "inventory.batch_updated"
        );
        if (
            !deliveryInput ||
            deliveryInput.type !== "delivery.received" ||
            !batchUpdateInput ||
            batchUpdateInput.type !== "inventory.batch_updated"
        ) {
            throw new Error("Pricing Activity fixtures are missing.");
        }
        const [deliveryEvent] = prepareEvents([deliveryInput]);
        const [batchUpdateEvent] = prepareEvents([{
            ...batchUpdateInput,
            before: {
                ...batchUpdateInput.before,
                pricingByPackagingLevel: [{
                    packagingLevelId: packaging.packagingLevelId,
                    costPrice: null,
                    sellingPrice: 10,
                    packagingLevelName: "Box"
                }]
            },
            after: {
                ...batchUpdateInput.after,
                pricingByPackagingLevel: [{
                    packagingLevelId: packaging.packagingLevelId,
                    costPrice: 5,
                    sellingPrice: null,
                    packagingLevelName: "Box"
                }]
            }
        }]);
        const deliveryText = presentationText(
            getActivityPresentation(deliveryEvent)
        );
        const batchText = presentationText(
            getActivityPresentation(batchUpdateEvent)
        );

        expect(deliveryText).toContain("Cost price received");
        expect(deliveryText).toContain("Empty");
        expect(deliveryText).toContain("Selling price received");
        expect(deliveryText).toContain("₦12");
        expect(batchText).toContain("Box pricing");
        expect(batchText).toContain("Cost Empty; Selling ₦10 → Cost ₦5; Selling Empty");
    });

    it("shows sale amount, line values and NGN currency without actor IDs", () => {
        const [sale] = prepareEvents([eventInputs[14]]);
        const presentation = getActivityPresentation(sale);
        const text = presentationText(presentation);

        expect(presentation.summary).toContain("₦100");
        expect(presentation.actor).toBe("Staff: Ada");
        expect(text).toContain("Sale date");
        expect(text).toContain("Customer");
        expect(text).toContain("Subtotal");
        expect(text).toContain("₦120");
        expect(text).toContain("Total discount");
        expect(text).toContain("₦20");
        expect(text).toContain("Final amount");
        expect(text).toContain("₦100");
        expect(text).toContain("Quantity sold");
        expect(text).toContain("2");
        expect(text).toContain("Unit selling price");
        expect(text).toContain("₦50");
        expect(text).toContain("Line subtotal");
        expect(text).toContain("Line discount");
        expect(text).toContain("Line total");
        expect(text).not.toContain("private-address");
        expect(text).not.toContain("private-note");
        expect(text).not.toContain("staff-id-private");
    });

    it("shows stock transitions and the reason without exposing an actor", () => {
        const [stockEvent] = prepareEvents([eventInputs[12]]);
        const presentation = getActivityPresentation(stockEvent);
        const text = presentationText(presentation);

        expect(presentation.summary).toContain("3 Box → 5 Box (+2)");
        expect(text).toContain("Previous quantity");
        expect(text).toContain("New quantity");
        expect(text).toContain("Difference");
        expect(text).toContain("Physical count");
        expect(presentation.actor).toBeUndefined();
        expect(text).not.toContain("actor-id-private");
    });

    it("omits unavailable or empty optional fields without inventing placeholders", () => {
        const saleInput = eventInputs[14];
        if (saleInput.type !== "sale.completed") {
            throw new Error("Sale test input is missing.");
        }
        const [sale] = prepareEvents([{
            ...saleInput,
            customerName: "  ",
            saleDate: "",
            staffMember: { userId: "staff-id-private", displayName: " " }
        }]);
        const presentation = getActivityPresentation(sale);
        const text = presentationText(presentation);

        expect(text).not.toContain("Not recorded");
        expect(text).not.toContain("Empty value");
        expect(text).not.toContain("private-address");
        expect(presentation.actor).toBeUndefined();
        expect(presentation.details[0].fields.map(({ label }) => label))
            .not.toContain("Customer");
        expect(presentation.details[0].fields.map(({ label }) => label))
            .not.toContain("Sale date");
    });

    it("handles long names and large event details without truncating selected data", () => {
        const largeProduct = {
            ...product,
            productName: "Long product name ".repeat(20),
            variants: Array.from({ length: 60 }, (_, index) => ({
                ...variant,
                variantId: `variant-private-${index}`,
                variantName: `Variant ${index} ${"long ".repeat(10)}`,
                packaging: []
            }))
        };
        const [event] = prepareEvents([{
            type: "product.created",
            operationKey: "large-product-private",
            product: largeProduct,
            initialInventory: []
        }]);
        const presentation = getActivityPresentation(event);
        const text = presentationText(presentation);

        expect(presentation.details).toHaveLength(61);
        expect(text).toContain("Variant 59");
        expect(text).toContain("Long product name");
        expect(text).not.toContain("variant-private-59");
    });

    it("filters events by search and activity type without exposing private details", () => {
        const events = prepareEvents(eventInputs);

        const productMatches = filterActivityEvents(events, "all", " medicine ");
        expect(productMatches.length).toBeGreaterThan(0);
        expect(productMatches.every((event) =>
            JSON.stringify(event).toLowerCase().includes("medicine") ||
            JSON.stringify(event).toLowerCase().includes("paracetamol")
        )).toBe(true);

        const batchMatches = filterActivityEvents(events, "all", "LOT-1");
        expect(batchMatches.some((event) => event.type === "inventory.batch_created" || event.type === "delivery.received" || event.type === "product.deleted")).toBe(true);

        const supplierMatches = filterActivityEvents(events, "all", "supplier ltd");
        expect(supplierMatches.map((event) => event.type)).toContain("delivery.received");

        const customerMatches = filterActivityEvents(events, "all", "customer");
        expect(customerMatches.map((event) => event.type)).toContain("sale.completed");

        const salesOnly = filterActivityEvents(events, "sales", "medicine");
        expect(salesOnly).toHaveLength(1);
        expect(salesOnly[0].type).toBe("sale.completed");

        const filteredByType = filterActivityEvents(events, "inventory-adjusted");
        expect(filteredByType.every((event) => [
            "inventory.batch_created",
            "inventory.batch_updated",
            "inventory.batch_removed",
            "inventory.stock_adjusted"
        ].includes(event.type))).toBe(true);

        const combined = filterActivityEvents(events, "sales", "customer");
        expect(combined).toHaveLength(1);
        expect(combined[0].type).toBe("sale.completed");
        expect(getActivitySearchText(combined[0])).not.toContain("private-address");
        expect(getActivitySearchText(combined[0])).not.toContain("private-note");
        expect(getActivitySearchText(combined[0])).not.toContain("staff-id-private");
        expect(ACTIVITY_FILTER_OPTIONS.map((option) => option.label)).toContain("All activities");
    });

    it("sorts newest first and groups calendar dates in Africa/Lagos", () => {
        const [newest, yesterday, older] = prepareEvents(eventInputs.slice(0, 3));
        const events = [
            { ...older, occurredAt: "2026-11-13T12:00:00.000Z" },
            { ...newest, occurredAt: "2026-11-14T23:30:00.000Z" },
            { ...yesterday, occurredAt: "2026-11-14T12:00:00.000Z" }
        ];

        expect(sortActivityEvents(events).map((event) => event.eventId)).toEqual([
            newest.eventId,
            yesterday.eventId,
            older.eventId
        ]);
        expect(groupActivityEvents(
            events,
            new Date("2026-11-15T12:00:00.000Z")
        ).map((group) => group.label)).toEqual([
            "Today",
            "Yesterday",
            "13 November 2026"
        ]);
        expect(formatActivityTime("2026-11-14T23:30:00.000Z"))
            .toMatch(/0:30/);
    });

    it("places invalid timestamps last and displays unavailable time/date safely", () => {
        const [valid, invalid] = prepareEvents(eventInputs.slice(0, 2));
        const invalidEvent = { ...invalid, occurredAt: "not-a-date" };

        expect(sortActivityEvents([invalidEvent, valid])).toEqual([
            valid,
            invalidEvent
        ]);
        expect(formatActivityTime(invalidEvent.occurredAt)).toBe("Time unavailable");
        expect(groupActivityEvents(
            [invalidEvent],
            new Date("2026-11-15T12:00:00.000Z")
        )[0].label).toBe("Date unavailable");
    });
});
