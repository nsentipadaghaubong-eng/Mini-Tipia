import { describe, expect, it } from "vitest";
import type { productStructure } from "./productStructure";
import {
    addVariantToUpdateDraft,
    addPackagingLevelToUpdateDraft,
    buildUpdatedProduct,
    createProductUpdateDraft,
    validateProductUpdateDraft
} from "./productUpdate";

function createProduct(): productStructure {
    return {
        id: "product-1",
        name: "Medicine",
        genericName: "Generic",
        manufacturer: "Maker",
        category: "Medicine",
        variant: [
            {
                id: "variant-1",
                variantName: "Tablets",
                nafdacRegistrationNumber: "REG-T",
                lowStockThreshold: {
                    quantity: 5,
                    packagingLevelId: "pack"
                },
                packagingHierarchy: [
                    {
                        id: "box",
                        name: "Box",
                        costPrice: 40,
                        sellingPrice: 45,
                        quantityofNextLevel: 10,
                        nextLevelId: "pack"
                    },
                    {
                        id: "pack",
                        name: "Pack",
                        costPrice: 12,
                        sellingPrice: 15,
                        quantityofNextLevel: null,
                        nextLevelId: null
                    }
                ]
            },
            {
                id: "variant-2",
                variantName: "Syrup",
                lowStockThreshold: {
                    quantity: 0,
                    packagingLevelId: "bottle"
                },
                packagingHierarchy: [{
                    id: "bottle",
                    name: "Bottle",
                    costPrice: null,
                    sellingPrice: 20,
                    quantityofNextLevel: null,
                    nextLevelId: null
                }]
            }
        ]
    };
}

describe("product update draft", () => {
    it("loads existing product, variants, packaging, IDs, conversions and prices", () => {
        const product = createProduct();
        const draft = createProductUpdateDraft(product);

        expect(draft.name).toBe("Medicine");
        expect(draft.genericName).toBe("Generic");
        expect(draft.manufacturer).toBe("Maker");
        expect(draft.variants.map((item) => item.name)).toEqual([
            "Tablets",
            "Syrup"
        ]);
        expect(draft.variants[0].packaging[0]).toMatchObject({
            id: "box",
            nextLevelId: "pack",
            quantityofNextLevel: "10",
            costPrice: "40",
            sellingPrice: "45"
        });
        expect(draft.variants[1].packaging[0].costPrice).toBe("");
        expect(draft.variants.map((item) => [
            item.lowStockThresholdQuantity,
            item.lowStockThresholdPackagingLevelId
        ])).toEqual([
            ["5", "pack"],
            ["0", "bottle"]
        ]);
    });

    it("preserves each variant's threshold and selected packaging level on unrelated edits", () => {
        const product = createProduct();
        const draft = createProductUpdateDraft(product);
        draft.name = "Updated medicine";
        draft.reason = "Correct product details";

        const updated = buildUpdatedProduct(product, draft);

        expect(updated.variant.map((item) => item.lowStockThreshold)).toEqual([
            { quantity: 5, packagingLevelId: "pack" },
            { quantity: 0, packagingLevelId: "bottle" }
        ]);
    });

    it("preserves a default threshold without assigning a packaging level", () => {
        const product = createProduct();
        product.variant[0].lowStockThreshold = { quantity: 5 };
        const draft = createProductUpdateDraft(product);
        draft.reason = "Update product details";

        expect(buildUpdatedProduct(product, draft).variant[0].lowStockThreshold)
            .toEqual({ quantity: 5 });
    });

    it("rejects clearing the threshold of an existing packaged variant", () => {
        const product = createProduct();
        const draft = createProductUpdateDraft(product);
        draft.reason = "Update product details";
        draft.variants[0].lowStockThresholdQuantity = "";

        expect(validateProductUpdateDraft(draft, product)[
            "variants.0.lowStockThresholdQuantity"
        ]).toBe(
            "A low-stock threshold is required for variants with packaging."
        );
        expect(() => buildUpdatedProduct(product, draft)).toThrow(
            "A low-stock threshold is required for variants with packaging."
        );
    });

    it("requires a threshold for a newly added packaged variant", () => {
        const product = createProduct();
        const draft = addVariantToUpdateDraft(
            createProductUpdateDraft(product),
            () => "variant-new"
        );
        const addedVariant = draft.variants.at(-1)!;
        addedVariant.name = "Capsules";
        addedVariant.packaging.push({
            id: "capsule-box",
            name: "Box",
            nextLevelId: "",
            quantityofNextLevel: "",
            costPrice: "",
            sellingPrice: ""
        });
        draft.reason = "Add capsule variant";

        expect(validateProductUpdateDraft(draft, product)[
            "variants.2.lowStockThresholdQuantity"
        ]).toBe(
            "A low-stock threshold is required for variants with packaging."
        );
        expect(() => buildUpdatedProduct(product, draft)).toThrow(
            "A low-stock threshold is required for variants with packaging."
        );
    });

    it("allows an empty placeholder to remain threshold-free and requires a threshold when packaged", () => {
        const product: productStructure = {
            id: "placeholder-product",
            name: "Placeholder product",
            variant: [{
                id: "placeholder-variant",
                variantName: "Internal placeholder",
                packagingHierarchy: []
            }]
        };
        const draft = createProductUpdateDraft(product);
        draft.reason = "Update placeholder product";

        expect(validateProductUpdateDraft(draft, product)).toEqual({});
        expect(buildUpdatedProduct(product, draft).variant[0].lowStockThreshold)
            .toBeUndefined();

        const packaged = addPackagingLevelToUpdateDraft(
            draft,
            0,
            () => "placeholder-level"
        );
        packaged.variants[0].packaging[0].name = "Card";
        packaged.reason = "Add placeholder packaging";
        expect(validateProductUpdateDraft(packaged, product)[
            "variants.0.lowStockThresholdQuantity"
        ]).toBe(
            "A low-stock threshold is required for variants with packaging."
        );

        packaged.variants[0].lowStockThresholdQuantity = "0";
        packaged.variants[0].lowStockThresholdPackagingLevelId =
            "placeholder-level";
        expect(validateProductUpdateDraft(packaged, product)).toEqual({});
        expect(buildUpdatedProduct(product, packaged).variant[0].lowStockThreshold)
            .toEqual({
                quantity: 0,
                packagingLevelId: "placeholder-level"
            });
    });

    it.each(["-1", "1.5", "invalid", "1e2", "0x10", "9007199254740992"])(
        "rejects invalid low-stock threshold quantity %s",
        (quantity) => {
            const product = createProduct();
            const draft = createProductUpdateDraft(product);
            draft.reason = "Update low-stock threshold";
            draft.variants[0].lowStockThresholdQuantity = quantity;

            expect(validateProductUpdateDraft(draft, product)[
                "variants.0.lowStockThresholdQuantity"
            ]).toBe("Enter a non-negative whole-number low-stock threshold.");
            expect(() => buildUpdatedProduct(product, draft)).toThrow(
                "Enter a non-negative whole-number low-stock threshold."
            );
        }
    );

    it("rejects a threshold packaging level outside the final variant hierarchy", () => {
        const product = createProduct();
        const draft = createProductUpdateDraft(product);
        draft.reason = "Update low-stock threshold";
        draft.variants[0].lowStockThresholdPackagingLevelId = "missing-level";

        expect(validateProductUpdateDraft(draft, product)[
            "variants.0.lowStockThresholdPackagingLevelId"
        ]).toBe("Select a valid threshold packaging level.");
        expect(() => buildUpdatedProduct(product, draft)).toThrow(
            "Select a valid threshold packaging level."
        );
    });

    it("builds trimmed product and variant values while preserving IDs and optional prices", () => {
        const product = createProduct();
        const draft = createProductUpdateDraft(product);
        draft.name = " Updated medicine ";
        draft.genericName = " ";
        draft.manufacturer = " New maker ";
        draft.reason = "  Corrected product details ";
        draft.variants[0].name = " Tablets 250mg ";
        draft.variants[0].nafdacRegistrationNumber = " REG-NEW ";
        draft.variants[0].packaging[0].name = "Large box";
        draft.variants[0].packaging[0].quantityofNextLevel = "12";
        draft.variants[0].packaging[0].costPrice = "40000";
        draft.variants[0].packaging[0].sellingPrice = "";

        const updated = buildUpdatedProduct(product, draft);

        expect(updated).toMatchObject({
            id: "product-1",
            name: "Updated medicine",
            genericName: undefined,
            manufacturer: "New maker"
        });
        expect(updated.variant[0]).toMatchObject({
            id: "variant-1",
            variantName: "Tablets 250mg",
            nafdacRegistrationNumber: "REG-NEW"
        });
        expect(updated.variant[0].packagingHierarchy[0]).toMatchObject({
            id: "box",
            name: "Large box",
            quantityofNextLevel: 12,
            costPrice: 40000,
            sellingPrice: null,
            nextLevelId: "pack"
        });
        expect(updated.variant[1].id).toBe("variant-2");
    });

    it.each(["costPrice", "sellingPrice"] as const)(
        "rejects an updated packaging %s with more than two decimal places",
        (priceField) => {
            const product = createProduct();
            const draft = createProductUpdateDraft(product);
            draft.reason = "Update packaging price";
            draft.variants[0].packaging[0][priceField] = "12.345";

            expect(
                validateProductUpdateDraft(draft, product)[
                    `variants.0.packaging.0.${priceField}`
                ]
            ).toContain("at most two decimal places");
            expect(() => buildUpdatedProduct(product, draft)).toThrow(
                "at most two decimal places"
            );
        }
    );

    it("accepts valid two-decimal packaging prices during Product updates", () => {
        const product = createProduct();
        const draft = createProductUpdateDraft(product);
        draft.reason = "Update packaging prices";
        draft.variants[0].packaging[0].costPrice = "40.12";
        draft.variants[0].packaging[0].sellingPrice = "45.67";

        expect(buildUpdatedProduct(product, draft).variant[0].packagingHierarchy[0])
            .toMatchObject({ costPrice: 40.12, sellingPrice: 45.67 });
    });

    it("rejects empty names, missing reason, invalid prices and invalid conversions", () => {
        const product = createProduct();
        const draft = createProductUpdateDraft(product);
        draft.name = " ";
        draft.reason = " ";
        draft.variants[1].name = "";
        draft.variants[0].packaging[0].costPrice = "-1";
        draft.variants[0].packaging[0].quantityofNextLevel = "1.5";

        const errors = validateProductUpdateDraft(draft, product);

        expect(errors.name).toBeDefined();
        expect(errors.reason).toBeDefined();
        expect(errors["variants.1.name"]).toBeDefined();
        expect(errors["variants.0.packaging.0.costPrice"]).toBeDefined();
        expect(errors["variants.0.packaging.0.quantityofNextLevel"]).toBeDefined();
        expect(() => buildUpdatedProduct(product, draft)).toThrow();
    });

    it("rejects cyclic and disconnected packaging hierarchies", () => {
        const product = createProduct();
        const cycle = createProductUpdateDraft(product);
        cycle.reason = "Test invalid hierarchy";
        cycle.variants[0].packaging[1].nextLevelId = "box";
        cycle.variants[0].packaging[1].quantityofNextLevel = "3";
        cycle.variants[0].packaging.push({
            id: "orphan",
            name: "Orphan",
            nextLevelId: "",
            quantityofNextLevel: "",
            costPrice: "",
            sellingPrice: ""
        });

        expect(validateProductUpdateDraft(cycle, product)[
            "variants.0.packaging.hierarchy"
        ]).toContain("disconnected or circular");

        const disconnected = createProductUpdateDraft(product);
        disconnected.reason = "Test disconnected hierarchy";
        disconnected.variants[0].packaging[0].nextLevelId = "";
        disconnected.variants[0].packaging[0].quantityofNextLevel = "";
        expect(validateProductUpdateDraft(disconnected, product)[
            "variants.0.packaging.hierarchy"
        ]).toContain("exactly one root");
    });

    it("adds a uniquely identified packaging level without removing existing levels", () => {
        const product = createProduct();
        const draft = createProductUpdateDraft(product);
        const extended = addPackagingLevelToUpdateDraft(
            draft,
            0,
            () => "new-level"
        );

        expect(extended.variants[0].packaging.map((level) => level.id)).toEqual([
            "box",
            "pack",
            "new-level"
        ]);
        expect(extended.variants[0].packaging[1].nextLevelId).toBe("new-level");
        expect(extended.variants[0].packaging[1].quantityofNextLevel).toBe("");
        expect(extended.variants[0].packaging[2].nextLevelId).toBe("");
    });

    it("requires a user-supplied conversion for a newly added packaging level", () => {
        const product = createProduct();
        const draft = createProductUpdateDraft(product);
        const extended = addPackagingLevelToUpdateDraft(
            draft,
            0,
            () => "new-level"
        );
        extended.reason = "Add a packaging level";
        extended.variants[0].packaging[2].name = "Unit";

        expect(validateProductUpdateDraft(extended, product)[
            "variants.0.packaging.1.quantityofNextLevel"
        ]).toBe("Enter a positive whole number.");

        extended.variants[0].packaging[1].quantityofNextLevel = "2";
        const updated = buildUpdatedProduct(product, extended);

        expect(updated.variant[0].packagingHierarchy.map((level) => level.id))
            .toEqual(["box", "pack", "new-level"]);
        expect(updated.variant[0].packagingHierarchy[1]).toMatchObject({
            id: "pack",
            quantityofNextLevel: 2,
            nextLevelId: "new-level"
        });
    });

    it("adds a product-owned variant with a stable unique ID and no stock data", () => {
        const product = createProduct();
        const draft = createProductUpdateDraft(product);
        const extended = addVariantToUpdateDraft(draft, () => "variant-new");
        const addedVariant = extended.variants.at(-1)!;
        addedVariant.name = "Capsules";
        addedVariant.nafdacRegistrationNumber = "REG-C";
        addedVariant.lowStockThresholdQuantity = "5";
        addedVariant.packaging.push({
            id: "capsule-box",
            name: "Box",
            nextLevelId: "",
            quantityofNextLevel: "",
            costPrice: "",
            sellingPrice: ""
        });
        extended.reason = "Add capsule variant";

        const updated = buildUpdatedProduct(product, extended);

        expect(updated.variant.map((item) => item.id)).toEqual([
            "variant-1",
            "variant-2",
            "variant-new"
        ]);
        expect(updated.variant.at(-1)).toMatchObject({
            id: "variant-new",
            variantName: "Capsules",
            nafdacRegistrationNumber: "REG-C",
            lowStockThreshold: { quantity: 5 },
            packagingHierarchy: [{ id: "capsule-box", name: "Box" }]
        });
        expect(updated).not.toHaveProperty("inventoryRecords");
        expect(() => addVariantToUpdateDraft(draft, () => "variant-1"))
            .toThrow("unique and non-empty");
    });

    it("blocks removal of variants and packaging levels", () => {
        const product = createProduct();
        const removedVariant = createProductUpdateDraft(product);
        removedVariant.reason = "Attempt variant removal";
        removedVariant.variants.pop();
        expect(validateProductUpdateDraft(removedVariant, product).variants)
            .toContain("cannot be removed");

        const removedPackaging = createProductUpdateDraft(product);
        removedPackaging.reason = "Attempt packaging removal";
        removedPackaging.variants[0].packaging.pop();
        expect(validateProductUpdateDraft(removedPackaging, product)[
            "variants.0.packaging"
        ]).toContain("cannot be removed");
    });
});
