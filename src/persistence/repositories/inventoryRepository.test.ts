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
const { getAllInventory } = await import("./inventoryRepository");

let database: DatabaseSync;

function insertProduct(productId: string, position: number, name: string): void {
    database.prepare(`
        INSERT INTO products (product_id, product_position, name)
        VALUES (?, ?, ?)
    `).run(productId, position, name);
}

function insertVariant(
    productId: string,
    variantId: string,
    position: number,
    name: string
): void {
    database.prepare(`
        INSERT INTO variants (
            product_id, variant_id, variant_position, variant_name
        ) VALUES (?, ?, ?, ?)
    `).run(productId, variantId, position, name);
}

function insertPackagingLevel(level: {
    productId: string;
    variantId: string;
    levelId: string;
    position: number;
    name: string;
    nextLevelId?: string | null;
    quantityOfNextLevel?: number | null;
}): void {
    database.prepare(`
        INSERT INTO packaging_levels (
            product_id, variant_id, packaging_level_id, packaging_position,
            name, cost_price_minor_units, selling_price_minor_units,
            quantity_of_next_level, next_level_id
        ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)
    `).run(
        level.productId,
        level.variantId,
        level.levelId,
        level.position,
        level.name,
        level.quantityOfNextLevel ?? null,
        level.nextLevelId ?? null
    );
}

function insertBatch(batch: {
    batchId: string;
    productId: string;
    variantId: string;
    position: number;
    batchNumber: string | null;
    expiryDate: string | null;
    receivedDate: string | null;
}): void {
    database.prepare(`
        INSERT INTO batches (
            batch_id, product_id, variant_id, batch_position,
            batch_number, expiry_date, received_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
        batch.batchId,
        batch.productId,
        batch.variantId,
        batch.position,
        batch.batchNumber,
        batch.expiryDate,
        batch.receivedDate
    );
}

function insertInventoryRecord(record: {
    inventoryId: string;
    productId: string;
    variantId: string;
    position: number;
    batchId: string | null;
}): void {
    database.prepare(`
        INSERT INTO inventory_records (
            inventory_id, product_id, variant_id, inventory_position, batch_id
        ) VALUES (?, ?, ?, ?, ?)
    `).run(
        record.inventoryId,
        record.productId,
        record.variantId,
        record.position,
        record.batchId
    );
}

function insertStock(stock: {
    inventoryId: string;
    productId: string;
    variantId: string;
    packagingLevelId: string;
    position: number;
    quantity: number;
}): void {
    database.prepare(`
        INSERT INTO inventory_stock (
            inventory_id, product_id, variant_id, packaging_level_id,
            stock_position, quantity
        ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
        stock.inventoryId,
        stock.productId,
        stock.variantId,
        stock.packagingLevelId,
        stock.position,
        stock.quantity
    );
}

function insertBatchPricing(pricing: {
    batchId: string;
    productId: string;
    variantId: string;
    packagingLevelId: string;
    position: number;
    costPriceMinorUnits: number | null;
    sellingPriceMinorUnits: number | null;
}): void {
    database.prepare(`
        INSERT INTO batch_pricing (
            batch_id, product_id, variant_id, packaging_level_id,
            pricing_position, cost_price_minor_units, selling_price_minor_units
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
        pricing.batchId,
        pricing.productId,
        pricing.variantId,
        pricing.packagingLevelId,
        pricing.position,
        pricing.costPriceMinorUnits,
        pricing.sellingPriceMinorUnits
    );
}

function sqliteValue(value: unknown): SqliteQueryValue {
    if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number"
    ) {
        return value;
    }
    throw new Error("Inventory repository test received an unsupported SQLite value.");
}

describe("Inventory read repository", () => {
    beforeEach(() => {
        database = new DatabaseSync(":memory:");
        database.exec("PRAGMA foreign_keys = ON");
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

    it("returns empty Inventory collections when no records or batches exist", async () => {
        await expect(getAllInventory()).resolves.toEqual({
            inventoryRecords: [],
            inventoryBatches: []
        });
    });

    it("preserves records, packaging stock and distinct batch associations across Products and Variants", async () => {
        insertProduct("product-a", 0, "First Product");
        insertProduct("product-b", 1, "Second Product");
        insertVariant("product-a", "variant-a1", 0, "Tablets");
        insertVariant("product-a", "variant-a2", 1, "Syrup");
        insertVariant("product-b", "variant-b1", 0, "Capsules");

        insertPackagingLevel({
            productId: "product-a",
            variantId: "variant-a1",
            levelId: "unit-a1",
            position: 2,
            name: "Unit"
        });
        insertPackagingLevel({
            productId: "product-a",
            variantId: "variant-a1",
            levelId: "pack-a1",
            position: 1,
            name: "Pack",
            nextLevelId: "unit-a1",
            quantityOfNextLevel: 10
        });
        insertPackagingLevel({
            productId: "product-a",
            variantId: "variant-a1",
            levelId: "box-a1",
            position: 0,
            name: "Box",
            nextLevelId: "pack-a1",
            quantityOfNextLevel: 5
        });
        insertPackagingLevel({
            productId: "product-a",
            variantId: "variant-a2",
            levelId: "bottle-a2",
            position: 0,
            name: "Bottle"
        });
        insertPackagingLevel({
            productId: "product-b",
            variantId: "variant-b1",
            levelId: "strip-b1",
            position: 0,
            name: "Strip"
        });

        insertBatch({
            batchId: "batch-a1-early",
            productId: "product-a",
            variantId: "variant-a1",
            position: 0,
            batchNumber: "LOT-SAME",
            expiryDate: "2027-03-31",
            receivedDate: "2026-02-01"
        });
        insertBatch({
            batchId: "batch-a1-late",
            productId: "product-a",
            variantId: "variant-a1",
            position: 1,
            batchNumber: "LOT-SAME",
            expiryDate: "2027-06-30",
            receivedDate: null
        });
        insertBatch({
            batchId: "batch-a2-unmarked",
            productId: "product-a",
            variantId: "variant-a2",
            position: 0,
            batchNumber: null,
            expiryDate: "2028-01-31",
            receivedDate: "2026-03-10"
        });
        insertBatch({
            batchId: "batch-b1",
            productId: "product-b",
            variantId: "variant-b1",
            position: 0,
            batchNumber: "LOT-B",
            expiryDate: "2028-04-30",
            receivedDate: "2026-04-12"
        });

        insertInventoryRecord({
            inventoryId: "inventory-a1-unbatched",
            productId: "product-a",
            variantId: "variant-a1",
            position: 0,
            batchId: null
        });
        insertInventoryRecord({
            inventoryId: "inventory-a1-early",
            productId: "product-a",
            variantId: "variant-a1",
            position: 1,
            batchId: "batch-a1-early"
        });
        insertInventoryRecord({
            inventoryId: "inventory-a1-late",
            productId: "product-a",
            variantId: "variant-a1",
            position: 2,
            batchId: "batch-a1-late"
        });
        insertInventoryRecord({
            inventoryId: "inventory-a2",
            productId: "product-a",
            variantId: "variant-a2",
            position: 0,
            batchId: "batch-a2-unmarked"
        });
        insertInventoryRecord({
            inventoryId: "inventory-b1",
            productId: "product-b",
            variantId: "variant-b1",
            position: 0,
            batchId: "batch-b1"
        });

        insertStock({
            inventoryId: "inventory-a1-early",
            productId: "product-a",
            variantId: "variant-a1",
            packagingLevelId: "unit-a1",
            position: 2,
            quantity: 36
        });
        insertStock({
            inventoryId: "inventory-a1-early",
            productId: "product-a",
            variantId: "variant-a1",
            packagingLevelId: "box-a1",
            position: 0,
            quantity: 4
        });
        insertStock({
            inventoryId: "inventory-a1-early",
            productId: "product-a",
            variantId: "variant-a1",
            packagingLevelId: "pack-a1",
            position: 1,
            quantity: 7
        });
        insertStock({
            inventoryId: "inventory-a1-late",
            productId: "product-a",
            variantId: "variant-a1",
            packagingLevelId: "box-a1",
            position: 0,
            quantity: 2
        });
        insertStock({
            inventoryId: "inventory-a2",
            productId: "product-a",
            variantId: "variant-a2",
            packagingLevelId: "bottle-a2",
            position: 0,
            quantity: 11
        });
        insertStock({
            inventoryId: "inventory-b1",
            productId: "product-b",
            variantId: "variant-b1",
            packagingLevelId: "strip-b1",
            position: 0,
            quantity: 23
        });

        insertBatchPricing({
            batchId: "batch-a1-early",
            productId: "product-a",
            variantId: "variant-a1",
            packagingLevelId: "unit-a1",
            position: 1,
            costPriceMinorUnits: null,
            sellingPriceMinorUnits: 450
        });
        insertBatchPricing({
            batchId: "batch-a1-early",
            productId: "product-a",
            variantId: "variant-a1",
            packagingLevelId: "box-a1",
            position: 0,
            costPriceMinorUnits: 1200,
            sellingPriceMinorUnits: 1500
        });
        insertBatchPricing({
            batchId: "batch-b1",
            productId: "product-b",
            variantId: "variant-b1",
            packagingLevelId: "strip-b1",
            position: 0,
            costPriceMinorUnits: 225,
            sellingPriceMinorUnits: null
        });

        const result = await getAllInventory();

        expect(result.inventoryRecords.map((record) => record.id)).toEqual([
            "inventory-a1-unbatched",
            "inventory-a1-early",
            "inventory-a1-late",
            "inventory-a2",
            "inventory-b1"
        ]);
        expect(result.inventoryRecords[0]).toEqual({
            id: "inventory-a1-unbatched",
            productId: "product-a",
            variantId: "variant-a1",
            batchId: null,
            stockQuantities: []
        });
        expect(result.inventoryRecords[1]).toEqual({
            id: "inventory-a1-early",
            productId: "product-a",
            variantId: "variant-a1",
            batchId: "batch-a1-early",
            stockQuantities: [
                { packagingLevelId: "box-a1", quantity: 4 },
                { packagingLevelId: "pack-a1", quantity: 7 },
                { packagingLevelId: "unit-a1", quantity: 36 }
            ]
        });
        expect(result.inventoryRecords[2]).toMatchObject({
            productId: "product-a",
            variantId: "variant-a1",
            batchId: "batch-a1-late",
            stockQuantities: [{ packagingLevelId: "box-a1", quantity: 2 }]
        });
        expect(result.inventoryRecords[4]).toMatchObject({
            productId: "product-b",
            variantId: "variant-b1",
            batchId: "batch-b1",
            stockQuantities: [{ packagingLevelId: "strip-b1", quantity: 23 }]
        });

        expect(result.inventoryBatches.map((batch) => batch.batchId)).toEqual([
            "batch-a1-early",
            "batch-a1-late",
            "batch-a2-unmarked",
            "batch-b1"
        ]);
        expect(result.inventoryBatches[0]).toEqual({
            batchId: "batch-a1-early",
            productId: "product-a",
            variantId: "variant-a1",
            batchNumber: "LOT-SAME",
            expiryDate: new Date("2027-03-31T00:00:00.000Z"),
            receivedDate: "2026-02-01",
            pricingByPackagingLevel: [
                {
                    packagingLevelId: "box-a1",
                    costPrice: 12,
                    sellingPrice: 15
                },
                {
                    packagingLevelId: "unit-a1",
                    costPrice: null,
                    sellingPrice: 4.5
                }
            ]
        });
        expect(result.inventoryBatches[1]).toMatchObject({
            batchId: "batch-a1-late",
            batchNumber: "LOT-SAME",
            expiryDate: new Date("2027-06-30T00:00:00.000Z"),
            pricingByPackagingLevel: []
        });
        expect(result.inventoryBatches[2]).toMatchObject({
            batchId: "batch-a2-unmarked",
            productId: "product-a",
            variantId: "variant-a2",
            batchNumber: null,
            expiryDate: new Date("2028-01-31T00:00:00.000Z")
        });
        expect(result.inventoryBatches[3]).toMatchObject({
            batchId: "batch-b1",
            productId: "product-b",
            variantId: "variant-b1",
            pricingByPackagingLevel: [{
                packagingLevelId: "strip-b1",
                costPrice: 2.25,
                sellingPrice: null
            }]
        });
    });

    it("preserves unnumbered batches without expiry and batches without inventory records", async () => {
        insertProduct("product-1", 0, "Medicine");
        insertVariant("product-1", "variant-1", 0, "Tablets");
        insertPackagingLevel({
            productId: "product-1",
            variantId: "variant-1",
            levelId: "unit-1",
            position: 0,
            name: "Unit"
        });
        insertBatch({
            batchId: "batch-anonymous-a",
            productId: "product-1",
            variantId: "variant-1",
            position: 0,
            batchNumber: null,
            expiryDate: null,
            receivedDate: null
        });
        insertBatch({
            batchId: "batch-anonymous-b",
            productId: "product-1",
            variantId: "variant-1",
            position: 1,
            batchNumber: null,
            expiryDate: null,
            receivedDate: null
        });
        insertInventoryRecord({
            inventoryId: "inventory-without-stock",
            productId: "product-1",
            variantId: "variant-1",
            position: 0,
            batchId: null
        });

        const result = await getAllInventory();

        expect(result.inventoryRecords).toEqual([{
            id: "inventory-without-stock",
            productId: "product-1",
            variantId: "variant-1",
            batchId: null,
            stockQuantities: []
        }]);
        expect(result.inventoryBatches).toEqual([
            {
                batchId: "batch-anonymous-a",
                productId: "product-1",
                variantId: "variant-1",
                batchNumber: null,
                expiryDate: null,
                pricingByPackagingLevel: []
            },
            {
                batchId: "batch-anonymous-b",
                productId: "product-1",
                variantId: "variant-1",
                batchNumber: null,
                expiryDate: null,
                pricingByPackagingLevel: []
            }
        ]);
    });
});
