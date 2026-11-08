import { describe, expect, it } from "vitest";
import {
    createCatalogueProductFromDraft,
    createProductFromDraft,
    createVariantFromDraft,
    validateProductCreationDraft,
    type ProductCreationDraft
} from "./productCreation";
import { getInventoryDisplay } from "../inventory/inventoryLookup";
import { validateInventoryRelationships } from "../inventory/inventoryValidation";
import type { inventory } from "../inventory/inventoryStock";

function draft(overrides: Partial<ProductCreationDraft> = {}): ProductCreationDraft {
    return {
        name: "Medicine",
        genericName: "",
        manufacturer: "",
        category: "",
        addVariants: false,
        variants: [
            {
                key: "variant-1",
                name: "",
                nafdacRegistrationNumber: "",
                packaging: [],
                batches: [],
                unbatchedStock: {}
            }
        ],
        ...overrides
    };
}

function idGenerator() {
    let id = 0;
    return () => `created-${++id}`;
}

describe("product creation", () => {
    it("creates catalogue data with pricing but without inventory or batches", () => {
        const catalogueProduct = createCatalogueProductFromDraft(
            draft({
                addVariants: true,
                variants: [{
                    key: "catalogue-variant",
                    name: "Tablets",
                    nafdacRegistrationNumber: "",
                    packaging: [{
                        key: "box",
                        name: "Box",
                        quantityOfNextLevel: "",
                        costPrice: "3.25",
                        sellingPrice: "5"
                    }],
                    batches: [{
                        batchNumber: "MUST-NOT-BE-CREATED",
                        expiryDate: "2027-01-01",
                        stock: { box: "12" }
                    }],
                    unbatchedStock: { box: "4" }
                }]
            }),
            [],
            [],
            idGenerator()
        );

        expect(catalogueProduct.name).toBe("Medicine");
        expect(catalogueProduct.variant[0]).toMatchObject({
            variantName: "Tablets",
            packagingHierarchy: [{
                name: "Box",
                costPrice: 3.25,
                sellingPrice: 5,
                nextLevelId: null
            }]
        });
        expect(catalogueProduct.variant[0].packagingHierarchy[0].id)
            .toBe("created-3");
    });

    it("creates a variant and packaging hierarchy for an existing product without stock", () => {
        const product = {
            id: "product-existing",
            name: "Medicine",
            variant: []
        };
        const productVariant = createVariantFromDraft(
            product,
            {
                key: "new-variant",
                name: "Syrup",
                nafdacRegistrationNumber: "REG-1",
                packaging: [{
                    key: "bottle",
                    name: "Bottle",
                    quantityOfNextLevel: "",
                    costPrice: "",
                    sellingPrice: "8"
                }],
                batches: [],
                unbatchedStock: {}
            },
            [product],
            [],
            idGenerator()
        );

        expect(productVariant).toMatchObject({
            variantName: "Syrup",
            nafdacRegistrationNumber: "REG-1",
            packagingHierarchy: [{
                name: "Bottle",
                costPrice: null,
                sellingPrice: 8,
                nextLevelId: null
            }]
        });
    });

    it("creates a named product with one internal default variant", () => {
        const result = createProductFromDraft(
            draft({ name: "  Medicine  " }),
            [],
            [],
            idGenerator()
        );

        expect(result.product.name).toBe("Medicine");
        expect(result.product.variant).toHaveLength(1);
        expect(result.product.variant[0].variantName).toBe("Medicine");
        expect(result.product.genericName).toBe("");
        expect(result.inventoryRecords).toEqual([]);
    });

    it("stores an optional trimmed registration number on the single internal variant", () => {
        const result = createProductFromDraft(
            draft({
                variants: [{
                    key: "variant-1",
                    name: "",
                    nafdacRegistrationNumber: "  NAFDAC 123  ",
                    packaging: [],
                    batches: [],
                    unbatchedStock: {}
                }]
            }),
            [],
            [],
            idGenerator()
        );

        expect(result.product.variant[0].nafdacRegistrationNumber).toBe("NAFDAC 123");
        expect(result.product).not.toHaveProperty("nafdacRegistrationNumber");
    });

    it.each(["", "   "])(
        "omits a blank single-variant registration number: %j",
        (nafdacRegistrationNumber) => {
            const result = createProductFromDraft(
                draft({
                    variants: [{
                        key: "variant-1",
                        name: "",
                        nafdacRegistrationNumber,
                        packaging: [],
                        batches: [],
                        unbatchedStock: {}
                    }]
                }),
                [],
                [],
                idGenerator()
            );

            expect(result.product.variant[0]).not.toHaveProperty(
                "nafdacRegistrationNumber"
            );
        }
    );

    it("keeps different and unset registration numbers associated with their variants", () => {
        const result = createProductFromDraft(
            draft({
                addVariants: true,
                variants: [
                    {
                        key: "tablets",
                        name: "Tablets",
                        nafdacRegistrationNumber: "  REG-TAB  ",
                        packaging: [],
                        batches: [],
                        unbatchedStock: {}
                    },
                    {
                        key: "syrup",
                        name: "Syrup",
                        nafdacRegistrationNumber: " ",
                        packaging: [],
                        batches: [],
                        unbatchedStock: {}
                    },
                    {
                        key: "cream",
                        name: "Cream",
                        nafdacRegistrationNumber: "REG-CRM",
                        packaging: [],
                        batches: [],
                        unbatchedStock: {}
                    }
                ]
            }),
            [],
            [],
            idGenerator()
        );

        expect(result.product.variant.map((item) => item.nafdacRegistrationNumber))
            .toEqual(["REG-TAB", undefined, "REG-CRM"]);
        expect(result.product.variant.map((item) => item.variantName))
            .toEqual(["Tablets", "Syrup", "Cream"]);
    });

    it("rejects a blank product name but accepts blank optional information", () => {
        expect(validateProductCreationDraft(draft({ name: "  " })).name).toBe(
            "Product name is required."
        );
        expect(validateProductCreationDraft(draft())).toEqual({});
    });

    it("creates independent variants and links multiple packaging levels", () => {
        const result = createProductFromDraft(
            draft({
                addVariants: true,
                variants: [
                    {
                        key: "variant-tablets",
                        name: "500mg Tablets",
                        nafdacRegistrationNumber: "",
                        packaging: [
                            { key: "carton", name: "Custom carton", quantityOfNextLevel: "3", costPrice: "1.25", sellingPrice: "" },
                            { key: "tablet", name: "Tablet", quantityOfNextLevel: "", costPrice: "", sellingPrice: "2.5" }
                        ],
                        batches: [],
                        unbatchedStock: { carton: "2", tablet: "7" }
                    },
                    {
                        key: "variant-syrup",
                        name: "Syrup",
                        nafdacRegistrationNumber: "",
                        packaging: [
                            { key: "bottle", name: "Bottle", quantityOfNextLevel: "", costPrice: "", sellingPrice: "" }
                        ],
                        batches: [],
                        unbatchedStock: { bottle: "0" }
                    }
                ]
            }),
            [],
            [],
            idGenerator()
        );

        const [tablets, syrup] = result.product.variant;
        expect(tablets.packagingHierarchy[0].nextLevelId).toBe(
            tablets.packagingHierarchy[1].id
        );
        expect(tablets.packagingHierarchy[1].nextLevelId).toBeNull();
        expect(tablets.packagingHierarchy[0].costPrice).toBe(1.25);
        expect(tablets.packagingHierarchy[0].sellingPrice).toBeNull();
        expect(tablets.packagingHierarchy[1].sellingPrice).toBe(2.5);
        expect(syrup.packagingHierarchy[0].id).not.toBe(
            tablets.packagingHierarchy[0].id
        );
        expect(result.inventoryRecords[0].batchId).toBeNull();
        expect(result.inventoryRecords[0].stockQuantities.map((item) => item.quantity)).toEqual([2, 7]);
        expect(result.inventoryRecords[1].stockQuantities[0].quantity).toBe(0);
    });

    it("validates conversions, prices, quantities, and invalid supplied expiry", () => {
        const value = draft({
            variants: [{
                key: "variant-1",
                name: "",
                nafdacRegistrationNumber: "",
                packaging: [
                    { key: "box", name: "Box", quantityOfNextLevel: "1.5", costPrice: "-1", sellingPrice: "" },
                    { key: "tablet", name: "Tablet", quantityOfNextLevel: "", costPrice: "", sellingPrice: "" }
                ],
                batches: [{ batchNumber: "", expiryDate: "2027-02-31", stock: { box: "-1", tablet: "1.2" } }],
                unbatchedStock: {}
            }]
        });
        const errors = validateProductCreationDraft(value);

        expect(errors["variants.0.packaging.0.quantityOfNextLevel"]).toBeTruthy();
        expect(errors["variants.0.packaging.0.costPrice"]).toBeTruthy();
        expect(errors["variants.0.batches.0.expiryDate"]).toBeTruthy();
        expect(errors["variants.0.batches.0.stock.box"]).toBeTruthy();
        expect(errors["variants.0.batches.0.stock.tablet"]).toBeTruthy();
    });

    it.each(["1.5", "0", "-1", "9007199254740992"])(
        "rejects invalid packaging conversions: %s",
        (quantity) => {
            const value = draft({
                variants: [{
                    key: "variant-1",
                    name: "",
                    nafdacRegistrationNumber: "",
                    packaging: [
                        { key: "box", name: "Box", quantityOfNextLevel: quantity, costPrice: "", sellingPrice: "" },
                        { key: "unit", name: "Unit", quantityOfNextLevel: "", costPrice: "", sellingPrice: "" }
                    ],
                    batches: [],
                    unbatchedStock: {}
                }]
            });

            expect(
                validateProductCreationDraft(value)[
                    "variants.0.packaging.0.quantityOfNextLevel"
                ]
            ).toBeTruthy();
        }
    );

    it.each(["1.5", "-1", "9007199254740992"])(
        "rejects invalid stock quantities: %s",
        (quantity) => {
            const value = draft({
                variants: [{
                    key: "variant-1",
                    name: "",
                    nafdacRegistrationNumber: "",
                    packaging: [
                        { key: "unit", name: "Unit", quantityOfNextLevel: "", costPrice: "", sellingPrice: "" }
                    ],
                    batches: [],
                    unbatchedStock: { unit: quantity }
                }]
            });

            expect(validateProductCreationDraft(value)["variants.0.unbatchedStock.unit"]).toBeTruthy();
        }
    );

    it("creates separate stock records for batches without requiring batch numbers", () => {
        const result = createProductFromDraft(
            draft({
                variants: [{
                    key: "variant-1",
                    name: "",
                    nafdacRegistrationNumber: "",
                    packaging: [
                        { key: "bottle", name: "Bottle", quantityOfNextLevel: "2", costPrice: "", sellingPrice: "" },
                        { key: "tablet", name: "Tablet", quantityOfNextLevel: "", costPrice: "", sellingPrice: "" }
                    ],
                    batches: [
                        { batchNumber: "", expiryDate: "2027-01-31", stock: { bottle: "3", tablet: "5" } },
                        { batchNumber: "B-2", expiryDate: "2027-02-28", stock: { bottle: "8", tablet: "1" } }
                    ],
                    unbatchedStock: {}
                }]
            }),
            [],
            [],
            idGenerator()
        );

        expect(result.inventoryBatches[0].batchNumber).toBeNull();
        expect(result.inventoryBatches.map((batch) => [
            batch.productId,
            batch.variantId
        ])).toEqual([
            [result.product.id, result.product.variant[0].id],
            [result.product.id, result.product.variant[0].id]
        ]);
        expect("batches" in result.product.variant[0]).toBe(false);
        expect(result.inventoryRecords.map((record) => record.stockQuantities.map((stock) => stock.quantity))).toEqual([[3, 5], [8, 1]]);
        expect(result.inventoryRecords[0].batchId).toBe(
            result.inventoryBatches[0].batchId
        );
        expect(result.inventoryRecords[1].batchId).toBe(
            result.inventoryBatches[1].batchId
        );
    });

    it.each([
        { batchNumber: "", expiryDate: "", expectedBatchNumber: null, expectedExpiryDate: null },
        { batchNumber: "LOT-1", expiryDate: "", expectedBatchNumber: "LOT-1", expectedExpiryDate: null },
        { batchNumber: "", expiryDate: "2027-03-31", expectedBatchNumber: null, expectedExpiryDate: new Date("2027-03-31T00:00:00.000Z") }
    ])(
        "creates a batch with optional number and expiry: $batchNumber / $expiryDate",
        ({ batchNumber, expiryDate, expectedBatchNumber, expectedExpiryDate }) => {
            const result = createProductFromDraft(
                draft({
                    variants: [{
                        key: "variant-1",
                        name: "",
                        nafdacRegistrationNumber: "",
                        packaging: [{ key: "vial", name: "Vial", quantityOfNextLevel: "", costPrice: "", sellingPrice: "" }],
                        batches: [{ batchNumber, expiryDate, stock: { vial: "4" } }],
                        unbatchedStock: {}
                    }]
                }),
                [],
                [],
                idGenerator()
            );
            const [createdBatch] = result.inventoryBatches;
            const [createdInventory] = result.inventoryRecords;

            expect(createdBatch.batchNumber).toBe(expectedBatchNumber);
            expect(createdBatch.expiryDate).toEqual(expectedExpiryDate);
            expect(createdInventory.batchId).toBe(createdBatch.batchId);
            expect(createdInventory.stockQuantities[0].quantity).toBe(4);
            expect(validateProductCreationDraft(draft({
                variants: [{
                    key: "variant-1",
                    name: "",
                    nafdacRegistrationNumber: "",
                    packaging: [{ key: "vial", name: "Vial", quantityOfNextLevel: "", costPrice: "", sellingPrice: "" }],
                    batches: [{ batchNumber, expiryDate, stock: { vial: "4" } }],
                    unbatchedStock: {}
                }]
            }))).toEqual({});
        }
    );

    it("keeps unbatched inventory relationships valid and visible to lookup", () => {
        const result = createProductFromDraft(
            draft({
                variants: [{
                    key: "variant-1",
                    name: "",
                    nafdacRegistrationNumber: "",
                    packaging: [{ key: "vial", name: "Vial", quantityOfNextLevel: "", costPrice: "", sellingPrice: "" }],
                    batches: [],
                    unbatchedStock: { vial: "0" }
                }]
            }),
            [],
            [],
            idGenerator()
        );
        const [record] = result.inventoryRecords;

        expect(record.batchId).toBeNull();
        expect(() => validateInventoryRelationships(result.product, record, result.inventoryBatches)).not.toThrow();
        expect(getInventoryDisplay(
            record,
            [result.product],
            result.inventoryBatches
        )).toMatchObject({
            productId: result.product.id,
            variantId: result.product.variant[0].id,
            batchId: null,
            batchNumber: null,
            expiryDate: null
        });
    });

    it("does not mutate existing collections when draft validation fails", () => {
        const products = [{ id: "existing-product", name: "Existing", variant: [] }];
        const inventoryRecords: inventory[] = [];
        const makeId = idGenerator();

        expect(() => createProductFromDraft(
            draft({ name: " " }),
            products,
            inventoryRecords,
            makeId
        )).toThrow("Product name is required.");
        expect(products).toHaveLength(1);
        expect(inventoryRecords).toHaveLength(0);
    });
});