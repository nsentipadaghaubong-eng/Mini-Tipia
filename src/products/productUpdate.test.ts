import { describe, expect, it } from "vitest";
import type { productStructure } from "./productStructure";
import {
    addVariantToUpdateDraft,
    addPackagingLevelToUpdateDraft,
    applyPackagingLevelInitialStock,
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
            packagingHierarchy: [{ id: "capsule-box", name: "Box" }]
        });
        expect(updated).not.toHaveProperty("inventoryRecords");
        expect(() => addVariantToUpdateDraft(draft, () => "variant-1"))
            .toThrow("unique and non-empty");
    });

    it("applies initial stock to a newly added packaging level in an existing variant", () => {
        const product = createProduct();
        const inventoryRecords = [{
            id: "inventory-1",
            productId: product.id,
            variantId: "variant-1",
            batchId: null,
            stockQuantities: [{ packagingLevelId: "box", quantity: 10 }]
        }];
        const inventoryBatches: Array<{ batchId: string; productId: string; variantId: string; batchNumber: string | null; expiryDate: Date | null }> = [];

        const updated = applyPackagingLevelInitialStock(
            product,
            inventoryRecords,
            inventoryBatches,
            "variant-1",
            "new-level",
            "5",
            null
        );

        expect(updated).toHaveLength(1);
        expect(updated[0].stockQuantities).toEqual([
            { packagingLevelId: "box", quantity: 10 },
            { packagingLevelId: "new-level", quantity: 5 }
        ]);
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
