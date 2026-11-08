import { describe, expect, it } from "vitest";
import {
    appendActivityEvents,
    buildBatchUpdatedActivityInput,
    buildProductCreationActivityInputs,
    buildStockAdjustmentActivityInput,
    prepareActivityEvents,
    snapshotProduct,
    type ActivityEventInput
} from "./activity";
import { createProductFromDraft } from "../products/productCreation";
import { adjustInventoryStock } from "../inventory/inventoryAdjustment";
import type { inventory } from "../inventory/inventoryStock";
import type { inventoryBatch } from "../inventory/inventoryBatch";
import type { productStructure } from "../products/productStructure";

const product: productStructure = {
    id: "product-1",
    name: "Medicine",
    genericName: "Generic medicine",
    manufacturer: "Pharma",
    variant: [{
        id: "variant-1",
        variantName: "Medicine tablets",
        nafdacRegistrationNumber: "REG-1",
        packagingHierarchy: [{
            id: "box-1",
            name: "Box",
            costPrice: 10,
            sellingPrice: 15,
            quantityofNextLevel: null,
            nextLevelId: null
        }]
    }]
};

const inventoryBatch: inventoryBatch = {
    batchId: "batch-1",
    productId: product.id,
    variantId: product.variant[0].id,
    batchNumber: "LOT-1",
    expiryDate: new Date("2027-01-31T00:00:00.000Z")
};

function makeEvents(
    inputs: readonly ActivityEventInput[],
    ids: string[] = inputs.map((_, index) => `event-${index + 1}`)
) {
    let index = 0;
    return prepareActivityEvents(inputs, {
        makeId: () => ids[index++],
        now: () => new Date(`2026-01-01T00:00:0${index}.000Z`)
    });
}

describe("Activity event recording", () => {
    it("assigns unique IDs and timestamps and preserves append order without mutation", () => {
        const inputs: ActivityEventInput[] = [
            {
                type: "product.updated",
                operationKey: "product-update-1",
                productId: product.id,
                productName: product.name,
                before: snapshotProduct(product),
                after: snapshotProduct({ ...product, name: "New name" }),
                reason: "  Corrected label  "
            },
            {
                type: "product.variant_added",
                operationKey: "variant-added-1",
                productId: product.id,
                productName: product.name,
                variant: snapshotProduct(product).variants[0],
                reason: "New formulation"
            }
        ];
        const prepared = makeEvents(inputs);
        const original = [...prepared];
        const appended = appendActivityEvents([], prepared);

        expect(appended.map((event) => event.eventId)).toEqual([
            "event-1",
            "event-2"
        ]);
        expect(appended[0].occurredAt).toBe("2026-01-01T00:00:01.000Z");
        expect(appended[1].occurredAt).toBe("2026-01-01T00:00:02.000Z");
        if (appended[0].type === "product.updated") {
            expect(appended[0].reason).toBe("Corrected label");
        }
        expect(appended).toEqual(prepared);
        expect(prepared).toEqual(original);
        expect(appendActivityEvents(appended, prepared)).toBe(appended);
        expect(() => makeEvents(inputs, ["same", "same"])).toThrow(
            "Activity event IDs must be unique and non-empty."
        );
    });

    it("rejects empty operation keys and invalid timestamps", () => {
        const input: ActivityEventInput = {
            type: "inventory.batch_created",
            operationKey: " ",
            source: "product_creation",
            batch: {
                batchId: inventoryBatch.batchId,
                productId: product.id,
                productName: product.name,
                variantId: product.variant[0].id,
                variantName: product.variant[0].variantName,
                batchNumber: inventoryBatch.batchNumber,
                expiryDate: inventoryBatch.expiryDate?.toISOString() ?? null
            }
        };
        expect(() => makeEvents([input])).toThrow(
            "Activity operation key must not be empty."
        );
        expect(() => makeEvents([{
            type: "product.updated",
            operationKey: "update-1",
            productId: product.id,
            productName: product.name,
            before: snapshotProduct(product),
            after: snapshotProduct(product),
            reason: " "
        }])).toThrow("Activity reason must not be empty.");
        expect(() => prepareActivityEvents([{
            ...input,
            operationKey: "valid-key"
        }], {
            makeId: () => "event-1",
            now: () => new Date(Number.NaN)
        })).toThrow("Activity timestamp must be a valid date.");
    });

    it("keeps historical product and batch snapshots unchanged after source edits", () => {
        const original = {
            ...product,
            variant: [{
                ...product.variant[0],
                packagingHierarchy: product.variant[0].packagingHierarchy.map(
                    (level) => ({ ...level })
                )
            }]
        };
        const batchSnapshotSource = { ...inventoryBatch };
        const inputs = buildProductCreationActivityInputs(
            original,
            [{
                id: "inventory-1",
                productId: original.id,
                variantId: original.variant[0].id,
                batchId: inventoryBatch.batchId,
                stockQuantities: [{ packagingLevelId: "box-1", quantity: 3 }]
            }],
            [batchSnapshotSource]
        );
        const [created, batchCreated] = makeEvents(inputs);

        original.name = "Renamed";
        original.variant[0].packagingHierarchy[0].name = "Case";
        batchSnapshotSource.batchNumber = "LOT-CHANGED";

        expect(created.type).toBe("product.created");
        if (created.type === "product.created") {
            expect(created.product.productName).toBe("Medicine");
            expect(created.initialInventory[0].stock[0].packagingLevel.name)
                .toBe("Box");
            expect(created.initialInventory[0].batch?.batchNumber).toBe("LOT-1");
            expect(Object.isFrozen(created.product.variants[0].packaging)).toBe(true);
        }
        expect(batchCreated.type).toBe("inventory.batch_created");
        if (batchCreated.type === "inventory.batch_created") {
            expect(batchCreated.batch.batchNumber).toBe("LOT-1");
            expect(batchCreated.batch.expiryDate).toBe(
                "2027-01-31T00:00:00.000Z"
            );
        }
    });

    it("preserves historical packaging conversion and price snapshots", () => {
        const source: productStructure = {
            ...product,
            variant: [{
                ...product.variant[0],
                packagingHierarchy: [
                    {
                        id: "box-1",
                        name: "Box",
                        costPrice: 10,
                        sellingPrice: 15,
                        quantityofNextLevel: 4,
                        nextLevelId: "pack-1"
                    },
                    {
                        id: "pack-1",
                        name: "Pack",
                        costPrice: 3,
                        sellingPrice: 5,
                        quantityofNextLevel: null,
                        nextLevelId: null
                    }
                ]
            }]
        };
        const [created] = makeEvents(
            buildProductCreationActivityInputs(source, [], [])
        );

        source.variant[0].packagingHierarchy[0].quantityofNextLevel = 9;
        source.variant[0].packagingHierarchy[0].sellingPrice = 30;

        expect(created.type).toBe("product.created");
        if (created.type === "product.created") {
            expect(created.product.variants[0].packaging[0]).toMatchObject({
                name: "Box",
                quantityOfNextLevel: 4,
                sellingPrice: 15,
                nextLevelName: "Pack"
            });
        }
    });

    it("records batchless stock adjustments with exact quantities and reason", () => {
        const record: inventory = {
            id: "inventory-unbatched",
            productId: product.id,
            variantId: product.variant[0].id,
            batchId: null,
            stockQuantities: [{ packagingLevelId: "box-1", quantity: 4 }]
        };
        const { adjustment } = adjustInventoryStock(
            product,
            record,
            "box-1",
            7,
            "Physical count"
        );
        const event = makeEvents([
            buildStockAdjustmentActivityInput(
                adjustment,
                product,
                [],
                "adjustment-operation"
            )
        ])[0];

        expect(event.type).toBe("inventory.stock_adjusted");
        if (event.type === "inventory.stock_adjusted") {
            expect(event.batch).toBeNull();
            expect(event.previousQuantity).toBe(4);
            expect(event.newQuantity).toBe(7);
            expect(event.quantityDifference).toBe(3);
            expect(event.reason).toBe("Physical count");
            expect(event.packagingLevel.name).toBe("Box");
        }
        expect(() =>
            adjustInventoryStock(product, record, "box-1", 7, " ")
        ).toThrow("An adjustment reason is required");
    });

    it("captures batch edits only when metadata changes", () => {
        const updatedBatch = {
            ...inventoryBatch,
            batchNumber: "LOT-2"
        };
        const eventInput = buildBatchUpdatedActivityInput(
            "edit-operation",
            inventoryBatch,
            updatedBatch,
            product,
            "Corrected batch number"
        );

        expect(eventInput?.type).toBe("inventory.batch_updated");
        if (eventInput?.type === "inventory.batch_updated") {
            expect(eventInput.before.batchNumber).toBe("LOT-1");
            expect(eventInput.after.batchNumber).toBe("LOT-2");
            expect(eventInput.reason).toBe("Corrected batch number");
        }
        expect(buildBatchUpdatedActivityInput(
            "no-op",
            inventoryBatch,
            { ...inventoryBatch },
            product,
            "No change"
        )).toBeUndefined();
    });

    it("provides strongly typed future delivery and sale contracts without operation logic", () => {
        const futureContracts: ActivityEventInput[] = [
            {
                type: "delivery.received",
                operationKey: "delivery-1",
                deliveryId: "delivery-1",
                deliveryDate: "2026-11-07",
                receivedBy: "Pharmacist",
                supplierName: null,
                invoiceNumber: null,
                items: []
            },
            {
                type: "sale.completed",
                operationKey: "sale-1",
                saleId: "sale-1",
                subtotal: 0,
                discountAmount: 0,
                finalAmount: 0,
                expiredBatchConfirmed: false,
                items: []
            }
        ];

        expect(makeEvents(futureContracts).map((event) => event.type)).toEqual([
            "delivery.received",
            "sale.completed"
        ]);
    });

    it("creates product creation events only from a successfully built product", () => {
        const result = createProductFromDraft({
            name: "Created medicine",
            genericName: "",
            manufacturer: "",
            category: "",
            addVariants: false,
            variants: [{
                key: "variant-draft",
                name: "",
                nafdacRegistrationNumber: "",
                packaging: [{
                    key: "box-draft",
                    name: "Box",
                    quantityOfNextLevel: "",
                    costPrice: "",
                    sellingPrice: ""
                }],
                batches: [{
                    batchNumber: "LOT-1",
                    expiryDate: "",
                    stock: { "box-draft": "2" }
                }],
                unbatchedStock: {}
            }]
        });
        const events = makeEvents(buildProductCreationActivityInputs(
            result.product,
            result.inventoryRecords,
            result.inventoryBatches
        ));

        expect(events.filter((event) => event.type === "product.created"))
            .toHaveLength(1);
        expect(events.filter((event) => event.type === "inventory.batch_created"))
            .toHaveLength(1);
        expect(events[0].type).toBe("product.created");
    });
});
