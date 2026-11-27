/// <reference types="node" />

import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SqliteQueryResult, SqliteQueryValue } from "../query";

const { querySqliteMock } = vi.hoisted(() => ({
    querySqliteMock: vi.fn()
}));

vi.mock("../query", () => ({
    querySqlite: querySqliteMock
}));

const migrationSql = readFileSync(
    new URL("../../../src-tauri/src/migrations/migration_001.sql", import.meta.url),
    "utf8"
);
const { getAllProducts } = await import("./productRepository");

let database: DatabaseSync;

function insertProduct(
    productId: string,
    position: number,
    name: string,
    metadata: {
        description?: string | null;
        genericName?: string | null;
        manufacturer?: string | null;
        category?: string | null;
    } = {}
): void {
    database.prepare(`
        INSERT INTO products (
            product_id, product_position, name, description,
            generic_name, manufacturer, category
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
        productId,
        position,
        name,
        metadata.description ?? null,
        metadata.genericName ?? null,
        metadata.manufacturer ?? null,
        metadata.category ?? null
    );
}

function insertVariant(
    productId: string,
    variantId: string,
    position: number,
    name: string,
    nafdacRegistrationNumber: string | null = null
): void {
    database.prepare(`
        INSERT INTO variants (
            product_id, variant_id, variant_position,
            variant_name, nafdac_registration_number
        ) VALUES (?, ?, ?, ?, ?)
    `).run(productId, variantId, position, name, nafdacRegistrationNumber);
}

function insertPackagingLevel(level: {
    productId: string;
    variantId: string;
    id: string;
    position: number;
    name: string;
    costPriceMinorUnits: number | null;
    sellingPriceMinorUnits: number | null;
    quantityOfNextLevel: number | null;
    nextLevelId: string | null;
}): void {
    database.prepare(`
        INSERT INTO packaging_levels (
            product_id, variant_id, packaging_level_id, packaging_position,
            name, cost_price_minor_units, selling_price_minor_units,
            quantity_of_next_level, next_level_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        level.productId,
        level.variantId,
        level.id,
        level.position,
        level.name,
        level.costPriceMinorUnits,
        level.sellingPriceMinorUnits,
        level.quantityOfNextLevel,
        level.nextLevelId
    );
}

function insertThreshold(
    productId: string,
    variantId: string,
    quantity: number,
    packagingLevelId: string | null
): void {
    database.prepare(`
        INSERT INTO variant_low_stock_thresholds (
            product_id, variant_id, quantity, packaging_level_id
        ) VALUES (?, ?, ?, ?)
    `).run(productId, variantId, quantity, packagingLevelId);
}

function sqliteValue(value: unknown): SqliteQueryValue {
    if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number"
    ) {
        return value;
    }
    throw new Error("Product repository test received an unsupported SQLite value.");
}

describe("Product read repository", () => {
    beforeEach(() => {
        database = new DatabaseSync(":memory:");
        database.exec(migrationSql);
        querySqliteMock.mockReset();
        querySqliteMock.mockImplementation(async (query: string) => {
            const statement = database.prepare(query);
            const columns = statement.columns().map((column) => column.name);
            const rows = statement.all().map((row) =>
                columns.map((column) => sqliteValue(row[column]))
            );
            return { columns, rows } satisfies SqliteQueryResult;
        });
    });

    afterEach(() => {
        database.close();
    });

    it("returns an empty Product catalog for an empty database", async () => {
        await expect(getAllProducts()).resolves.toEqual([]);
    });

    it("maps one Product with one Variant and one packaging level", async () => {
        insertProduct("product-1", 0, "Medicine", {
            description: "Description",
            genericName: "Generic",
            manufacturer: "Maker",
            category: "Medicine"
        });
        insertVariant("product-1", "variant-1", 0, "Tablets", "REG-1");
        insertPackagingLevel({
            productId: "product-1",
            variantId: "variant-1",
            id: "unit-1",
            position: 0,
            name: "Unit",
            costPriceMinorUnits: 325,
            sellingPriceMinorUnits: 500,
            quantityOfNextLevel: null,
            nextLevelId: null
        });

        await expect(getAllProducts()).resolves.toEqual([{
            id: "product-1",
            name: "Medicine",
            description: "Description",
            genericName: "Generic",
            manufacturer: "Maker",
            category: "Medicine",
            variant: [{
                id: "variant-1",
                variantName: "Tablets",
                nafdacRegistrationNumber: "REG-1",
                packagingHierarchy: [{
                    id: "unit-1",
                    name: "Unit",
                    costPrice: 3.25,
                    sellingPrice: 5,
                    quantityofNextLevel: null,
                    nextLevelId: null
                }]
            }]
        }]);
    });

    it("preserves multiple Variants, packaging hierarchy, prices and thresholds", async () => {
        insertProduct("product-1", 0, "Medicine");
        insertVariant("product-1", "variant-a", 0, "Tablets", "NAFDAC-A");
        insertVariant("product-1", "variant-b", 1, "Syrup");
        insertPackagingLevel({
            productId: "product-1",
            variantId: "variant-a",
            id: "unit-a",
            position: 2,
            name: "Unit",
            costPriceMinorUnits: 250,
            sellingPriceMinorUnits: 300,
            quantityOfNextLevel: null,
            nextLevelId: null
        });
        insertPackagingLevel({
            productId: "product-1",
            variantId: "variant-a",
            id: "pack-a",
            position: 1,
            name: "Pack",
            costPriceMinorUnits: null,
            sellingPriceMinorUnits: 1500,
            quantityOfNextLevel: 6,
            nextLevelId: "unit-a"
        });
        insertPackagingLevel({
            productId: "product-1",
            variantId: "variant-a",
            id: "box-a",
            position: 0,
            name: "Box",
            costPriceMinorUnits: 10000,
            sellingPriceMinorUnits: 12000,
            quantityOfNextLevel: 5,
            nextLevelId: "pack-a"
        });
        insertPackagingLevel({
            productId: "product-1",
            variantId: "variant-b",
            id: "bottle-b",
            position: 0,
            name: "Bottle",
            costPriceMinorUnits: 800,
            sellingPriceMinorUnits: 1000,
            quantityOfNextLevel: null,
            nextLevelId: null
        });
        insertThreshold("product-1", "variant-a", 8, "box-a");
        insertThreshold("product-1", "variant-b", 3, null);

        const [product] = await getAllProducts();

        expect(product.variant).toEqual([
            {
                id: "variant-a",
                variantName: "Tablets",
                nafdacRegistrationNumber: "NAFDAC-A",
                lowStockThreshold: {
                    quantity: 8,
                    packagingLevelId: "box-a"
                },
                packagingHierarchy: [
                    {
                        id: "box-a",
                        name: "Box",
                        costPrice: 100,
                        sellingPrice: 120,
                        quantityofNextLevel: 5,
                        nextLevelId: "pack-a"
                    },
                    {
                        id: "pack-a",
                        name: "Pack",
                        costPrice: null,
                        sellingPrice: 15,
                        quantityofNextLevel: 6,
                        nextLevelId: "unit-a"
                    },
                    {
                        id: "unit-a",
                        name: "Unit",
                        costPrice: 2.5,
                        sellingPrice: 3,
                        quantityofNextLevel: null,
                        nextLevelId: null
                    }
                ]
            },
            {
                id: "variant-b",
                variantName: "Syrup",
                lowStockThreshold: { quantity: 3 },
                packagingHierarchy: [{
                    id: "bottle-b",
                    name: "Bottle",
                    costPrice: 8,
                    sellingPrice: 10,
                    quantityofNextLevel: null,
                    nextLevelId: null
                }]
            }
        ]);
    });

    it("keeps Product children associated by their persisted parent IDs", async () => {
        insertProduct("product-a", 0, "First");
        insertProduct("product-b", 1, "Second");
        insertVariant("product-a", "variant-a", 0, "First variant");
        insertVariant("product-b", "variant-b", 0, "Second variant");
        insertPackagingLevel({
            productId: "product-a",
            variantId: "variant-a",
            id: "level-a",
            position: 0,
            name: "First level",
            costPriceMinorUnits: null,
            sellingPriceMinorUnits: null,
            quantityOfNextLevel: null,
            nextLevelId: null
        });
        insertPackagingLevel({
            productId: "product-b",
            variantId: "variant-b",
            id: "level-b",
            position: 0,
            name: "Second level",
            costPriceMinorUnits: null,
            sellingPriceMinorUnits: null,
            quantityOfNextLevel: null,
            nextLevelId: null
        });

        const products = await getAllProducts();

        expect(products.map((product) => ({
            id: product.id,
            variantIds: product.variant.map((productVariant) => productVariant.id),
            packagingIds: product.variant.flatMap((productVariant) =>
                productVariant.packagingHierarchy.map((level) => level.id)
            )
        }))).toEqual([
            {
                id: "product-a",
                variantIds: ["variant-a"],
                packagingIds: ["level-a"]
            },
            {
                id: "product-b",
                variantIds: ["variant-b"],
                packagingIds: ["level-b"]
            }
        ]);
    });

    it("preserves nullable metadata and Products without Variants", async () => {
        insertProduct("product-empty", 0, "Empty product");
        insertProduct("product-nullable", 1, "Nullable product");
        insertVariant("product-nullable", "variant-nullable", 0, "Unregistered");
        insertPackagingLevel({
            productId: "product-nullable",
            variantId: "variant-nullable",
            id: "level-nullable",
            position: 0,
            name: "Unpriced unit",
            costPriceMinorUnits: null,
            sellingPriceMinorUnits: null,
            quantityOfNextLevel: null,
            nextLevelId: null
        });

        const products = await getAllProducts();

        expect(products[0]).toEqual({
            id: "product-empty",
            name: "Empty product",
            variant: []
        });
        expect(products[1]).toEqual({
            id: "product-nullable",
            name: "Nullable product",
            variant: [{
                id: "variant-nullable",
                variantName: "Unregistered",
                packagingHierarchy: [{
                    id: "level-nullable",
                    name: "Unpriced unit",
                    costPrice: null,
                    sellingPrice: null,
                    quantityofNextLevel: null,
                    nextLevelId: null
                }]
            }]
        });
    });

    it("rejects minor-unit prices that cannot be represented by the domain number", async () => {
        insertProduct("product-large-price", 0, "Large price");
        insertVariant("product-large-price", "variant-large-price", 0, "Unit");
        insertPackagingLevel({
            productId: "product-large-price",
            variantId: "variant-large-price",
            id: "level-large-price",
            position: 0,
            name: "Unit",
            costPriceMinorUnits: 9007199254740990,
            sellingPriceMinorUnits: null,
            quantityOfNextLevel: null,
            nextLevelId: null
        });

        await expect(getAllProducts()).rejects.toThrow(
            "cannot be represented in the Product domain"
        );
    });
});
