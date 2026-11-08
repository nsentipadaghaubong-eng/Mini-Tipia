import { describe, expect, it } from "vitest";
import type { productStructure, variant } from "./productStructure";
import type { inventoryBatch } from "../inventory/inventoryBatch";
import {
    filterProducts,
    getProductEmptyState,
    searchProducts
} from "./productFiltering";

function createVariant(
    id: string,
    variantName: string,
    options: {
        nafdacRegistrationNumber?: string;
    } = {}
): variant {
    return {
        id,
        variantName,
        ...(options.nafdacRegistrationNumber === undefined
            ? {}
            : { nafdacRegistrationNumber: options.nafdacRegistrationNumber }),
        packagingHierarchy: []
    };
}

function createProduct(
    id: string,
    name: string,
    variants: variant[],
    options: {
        genericName?: string;
        manufacturer?: string;
    } = {}
): productStructure {
    return {
        id,
        name,
        ...options,
        variant: variants
    };
}

const products = [
    createProduct(
        "p1",
        "Acme Cold Relief",
        [createVariant("p1-v1", "Adult Tablets", {
            nafdacRegistrationNumber: "REG-100"
        })],
        { genericName: "Paracetamol", manufacturer: "North Pharma" }
    ),
    createProduct(
        "p2",
        "Daily Care",
        [
            createVariant("p2-v1", "Children Syrup", {
                nafdacRegistrationNumber: "REG-CHILD"
            }),
            createVariant("p2-v2", "Adult Syrup")
        ],
        { genericName: "Ibuprofen", manufacturer: "South Labs" }
    ),
    createProduct(
        "p3",
        "Simple Salve",
        [createVariant("p3-v1", "Skin Cream")],
        { manufacturer: "North Labs" }
    )

];

const inventoryBatches: inventoryBatch[] = [
    { batchId: "p1-v1-batch", productId: "p1", variantId: "p1-v1", batchNumber: "LOT-1", expiryDate: null },
    { batchId: "p2-v2-batch", productId: "p2", variantId: "p2-v2", batchNumber: "LOT-2", expiryDate: null }
];

describe("searchProducts", () => {
    it.each([
        ["product name", "COLD REL", "p1"],
        ["generic name", "parac", "p1"],
        ["manufacturer", "NORTH PH", "p1"],
        ["variant name", "children syr", "p2"],
        ["NAFDAC registration number", "reg-child", "p2"]
    ])("searches by %s with case-insensitive partial matching", (_field, query, id) => {
        expect(searchProducts(products, query).map((product) => product.id))
            .toContain(id);
    });

    it("trims search whitespace and safely searches missing optional fields", () => {
        expect(searchProducts(products, "  Paracetamol  ").map((item) => item.id))
            .toEqual(["p1"]);
        expect(searchProducts(products, "undefined")).toEqual([]);
        expect(searchProducts(products, "North Labs").map((item) => item.id))
            .toEqual(["p3"]);
    });

    it("returns a parent product once when multiple variants match", () => {
        const result = searchProducts(products, "syrup");

        expect(result.map((product) => product.id)).toEqual(["p2"]);
    });

    it("returns all products for a cleared or whitespace-only search", () => {
        expect(searchProducts(products, "")).toEqual(products);
        expect(searchProducts(products, "   ")).toEqual(products);
    });

    it("returns an empty result for an empty collection", () => {
        expect(searchProducts([], "medicine")).toEqual([]);
    });
});

describe("filterProducts", () => {
    it.each([
        ["all", ["p1", "p2", "p3"]],
        ["single-variant", ["p1", "p3"]],
        ["multiple-variants", ["p2"]],
        ["with-batches", ["p1", "p2"]],
        ["without-batches", ["p3"]]
    ] as const)("applies the %s filter using Inventory-owned batches", (filter, ids) => {
        expect(filterProducts(products, filter, inventoryBatches).map((product) => product.id))
            .toEqual(ids);
    });

    it("combines search and filter while preserving source ordering", () => {
        expect(
            filterProducts(searchProducts(products, "north"), "single-variant", inventoryBatches)
                .map((product) => product.id)
        ).toEqual(["p1", "p3"]);

        expect(
            filterProducts(searchProducts(products, "adult"), "without-batches", inventoryBatches)
        ).toEqual([]);
    });

    it("does not mutate the source product list", () => {
        const original = [...products];

        filterProducts(searchProducts(products, "North"), "single-variant", inventoryBatches);

        expect(products).toEqual(original);
    });
});

describe("product listing empty states", () => {
    it("distinguishes empty collections, no search matches, and no filter matches", () => {
        expect(getProductEmptyState(0, 0, 0, "", "all")).toBe(
            "No products yet. Create a product to get started."
        );
        expect(getProductEmptyState(3, 0, 0, " unknown ", "all")).toBe(
            'No products match "unknown".'
        );
        expect(getProductEmptyState(
            3,
            1,
            0,
            "Paracetamol",
            "multiple-variants"
        )).toBe("No products match the multiple variants filter.");
        expect(getProductEmptyState(3, 3, 1, "", "all")).toBeUndefined();
    });
});
