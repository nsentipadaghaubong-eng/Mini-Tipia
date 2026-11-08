import { describe, expect, it } from "vitest";
import type { inventory } from "../inventory/inventoryStock";
import type { productStructure } from "../products/productStructure";
import {
    assessPackagingLevelRemoval,
    preparePackagingHierarchyChange,
    validatePackagingHierarchy
} from "./packagingValidation";
import {
    breakdownPackaging,
    buildUpPackaging,
    adjustStock
} from "../inventory/inventoryStock";
import { getInventoryDisplay } from "../inventory/inventoryLookup";
import type { packagingLevel } from "./packagingHierarchy";

const box: packagingLevel = {
    id: "box",
    name: "Box",
    costPrice: 10,
    sellingPrice: 15,
    quantityofNextLevel: 2,
    nextLevelId: "pack"
};

const pack: packagingLevel = {
    id: "pack",
    name: "Pack",
    costPrice: 4,
    sellingPrice: 6,
    quantityofNextLevel: null,
    nextLevelId: null
};

function createProduct(levels: packagingLevel[] = [box, pack]): productStructure {
    return {
        id: "product-1",
        name: "Medicine",
        variant: [{
            id: "variant-1",
            variantName: "Medicine tablets",
            packagingHierarchy: levels
        }]
    };
}

function createInventoryRecord(
    stockQuantities: inventory["stockQuantities"] = [
        { packagingLevelId: "box", quantity: 3 },
        { packagingLevelId: "pack", quantity: 0 }
    ]
): inventory {
    return {
        id: "inventory-1",
        productId: "product-1",
        variantId: "variant-1",
        batchId: null,
        stockQuantities
    };
}

describe("packaging hierarchy authority and integrity", () => {
    it("accepts empty, single-level, and connected linear hierarchies", () => {
        expect(() => validatePackagingHierarchy([])).not.toThrow();
        expect(() => validatePackagingHierarchy([{
            ...pack,
            nextLevelId: null,
            quantityofNextLevel: null
        }])).not.toThrow();
        expect(() => validatePackagingHierarchy([box, pack])).not.toThrow();
    });

    it.each([
        ["duplicate IDs", [box, { ...pack, id: "box" }]],
        ["broken links", [box, { ...pack, id: "other" }]],
        ["circular links", [
            { ...box, nextLevelId: "pack" },
            { ...pack, nextLevelId: "box", quantityofNextLevel: 2 }
        ]],
        ["disconnected chains", [
            box,
            pack,
            { ...pack, id: "other" }
        ]],
        ["invalid conversion quantities", [
            { ...box, quantityofNextLevel: 1.5 },
            pack
        ]]
    ])("rejects %s", (_description, levels) => {
        expect(() => validatePackagingHierarchy(levels)).toThrow();
    });

    it("keeps packaging definitions out of Inventory records", () => {
        const record = createInventoryRecord();
        expect(record).not.toHaveProperty("packagingHierarchy");
        expect(record.stockQuantities).toEqual([
            { packagingLevelId: "box", quantity: 3 },
            { packagingLevelId: "pack", quantity: 0 }
        ]);
    });

    it("adds a packaging level and edits conversions and prices without changing stock", () => {
        const product = createProduct();
        const record = createInventoryRecord();
        const records = [record];
        const nextLevels: packagingLevel[] = [
            { ...box, quantityofNextLevel: 4, sellingPrice: 19 },
            {
                ...pack,
                quantityofNextLevel: 5,
                nextLevelId: "card",
                costPrice: 5
            },
            {
                id: "card",
                name: "Card",
                costPrice: 1,
                sellingPrice: 2,
                quantityofNextLevel: null,
                nextLevelId: null
            }
        ];

        const plan = preparePackagingHierarchyChange(
            product,
            "variant-1",
            nextLevels,
            records
        );

        expect(plan.updatedProduct.variant[0].packagingHierarchy).toEqual(
            nextLevels
        );
        expect(plan.addedPackagingLevels.map((level) => level.id)).toEqual([
            "card"
        ]);
        expect(plan.inventoryRecords).toBe(records);
        expect(plan.inventoryRecords[0]).toBe(record);
        expect(record.stockQuantities).toEqual([
            { packagingLevelId: "box", quantity: 3 },
            { packagingLevelId: "pack", quantity: 0 }
        ]);
        expect(
            getInventoryDisplay(record, [plan.updatedProduct], [])
                .packagingLevels.map((level) => level.id)
        ).toEqual(["box", "pack", "card"]);

        const stockedAddedLevel = adjustStock(
            plan.updatedProduct,
            record,
            "card",
            2
        );
        expect(stockedAddedLevel.stockQuantities).toEqual([
            { packagingLevelId: "box", quantity: 3 },
            { packagingLevelId: "pack", quantity: 0 },
            { packagingLevelId: "card", quantity: 2 }
        ]);
        expect(record.stockQuantities).toHaveLength(2);
    });

    it("uses the current Product conversion for future stock operations", () => {
        const product = createProduct([
            { ...box, quantityofNextLevel: 4 },
            pack
        ]);
        const record = createInventoryRecord();

        const updated = breakdownPackaging(
            product,
            record,
            "box",
            "pack",
            5
        );

        expect(updated.stockQuantities).toEqual([
            { packagingLevelId: "box", quantity: 1 },
            { packagingLevelId: "pack", quantity: 8 }
        ]);
        expect(record.stockQuantities).toEqual([
            { packagingLevelId: "box", quantity: 3 },
            { packagingLevelId: "pack", quantity: 0 }
        ]);
    });

    it("uses the current conversion for packaging build-up", () => {
        const product = createProduct([
            { ...box, quantityofNextLevel: 4 },
            pack
        ]);
        const record = createInventoryRecord([
            { packagingLevelId: "box", quantity: 1 },
            { packagingLevelId: "pack", quantity: 8 }
        ]);

        const updated = buildUpPackaging(product, record, "box", "pack");

        expect(updated.stockQuantities).toEqual([
            { packagingLevelId: "box", quantity: 3 },
            { packagingLevelId: "pack", quantity: 0 }
        ]);
    });

    it("rejects stale, non-adjacent, and invalid packaging references", () => {
        const product = createProduct();
        const record = createInventoryRecord();
        expect(() =>
            breakdownPackaging(product, record, "pack", "box", 1)
        ).toThrow("not directly related");
        expect(() =>
            breakdownPackaging(product, record, "box", "missing", 1)
        ).toThrow("does not belong to this variant");
        expect(() =>
            breakdownPackaging(
                createProduct([{ ...box, quantityofNextLevel: 0 }, pack]),
                record,
                "box",
                "pack",
                1
            )
        ).toThrow();
    });

    it("blocks removal of levels referenced by stock, including zero quantities", () => {
        const assessment = assessPackagingLevelRemoval(
            "product-1",
            "variant-1",
            [box, pack],
            "pack",
            [createInventoryRecord()]
        );

        expect(assessment.canRemove).toBe(false);
        expect(assessment.stockReferences).toEqual([{
            inventoryId: "inventory-1",
            batchId: null,
            packagingLevelId: "pack",
            quantity: 0
        }]);
        expect(assessment.hierarchyReferences).toEqual([{
            packagingLevelId: "box",
            packagingLevelName: "Box",
            relation: "contained-by"
        }]);
    });

    it("rejects hierarchy changes that would orphan stock and allows a valid safe removal", () => {
        const product = createProduct([
            box,
            {
                ...pack,
                quantityofNextLevel: 5,
                nextLevelId: "card"
            },
            {
                id: "card",
                name: "Card",
                costPrice: 1,
                sellingPrice: 2,
                quantityofNextLevel: null,
                nextLevelId: null
            }
        ]);
        const record = createInventoryRecord([
            { packagingLevelId: "box", quantity: 3 },
            { packagingLevelId: "pack", quantity: 4 }
        ]);

        expect(() =>
            preparePackagingHierarchyChange(
                product,
                "variant-1",
                [{
                    ...box,
                    nextLevelId: null,
                    quantityofNextLevel: null
                }],
                [record]
            )
        ).toThrow("would orphan inventory references");

        const safePlan = preparePackagingHierarchyChange(
            product,
            "variant-1",
            [{
                ...box,
                nextLevelId: null,
                quantityofNextLevel: null
            }],
            [createInventoryRecord([
                { packagingLevelId: "box", quantity: 3 }
            ])]
        );
        expect(safePlan.removedPackagingLevels.map((level) => level.id)).toEqual([
            "pack",
            "card"
        ]);
    });
});
