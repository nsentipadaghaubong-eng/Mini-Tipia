/// <reference types="node" />

import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    buildProductCreationActivityInputs,
    buildProductUpdateActivityInputs,
    prepareActivityEvents,
    snapshotVariant,
    type ActivityEvent,
    type ActivityEventInput
} from "../../activity/activity";
import type { productStructure, variant } from "../../products/productStructure";
import type { ProductCreationResult } from "../../products/productCreation";
import type { inventory } from "../../inventory/inventoryStock";
import type { inventoryBatch } from "../../inventory/inventoryBatch";
import type { SqliteStatement } from "../transaction";
import type { SqliteQueryResult, SqliteQueryValue } from "../query";

const { executeTransactionMock, querySqliteMock } = vi.hoisted(() => ({
    executeTransactionMock: vi.fn(),
    querySqliteMock: vi.fn()
}));

vi.mock("../transaction", () => ({
    executeTransaction: executeTransactionMock
}));

vi.mock("../query", () => ({
    querySqlite: querySqliteMock
}));

const migrationPaths = [
    "../../../src-tauri/src/migrations/migration_001.sql",
    "../../../src-tauri/src/migrations/migration_002_delivery_inventory_association.sql",
    "../../../src-tauri/src/migrations/migration_003_received_delivery_inventory_association_guards.sql"
];
const migrationSql = migrationPaths.map((path) =>
    readFileSync(new URL(path, import.meta.url), "utf8")
);
const {
    persistCatalogueProduct,
    persistFullProduct,
    persistProductUpdate,
    persistVariantAddition
} = await import("./productWriteRepository");
const { getAllProducts } = await import("./productRepository");
const { getAllInventory } = await import("./inventoryRepository");
const { getAllActivityEvents } = await import("./activityRepository");

let database: DatabaseSync;
let nextEventId: number;

const baseProduct: productStructure = {
    id: "product-catalogue",
    name: "Catalogue medicine",
    description: "Initial description",
    genericName: "Generic medicine",
    manufacturer: "Maker",
    category: "Medicine",
    variant: [
        {
            id: "variant-tablets",
            variantName: "Tablets",
            nafdacRegistrationNumber: "REG-T",
            lowStockThreshold: {
                quantity: 4,
                packagingLevelId: "pack-box"
            },
            packagingHierarchy: [
                {
                    id: "pack-box",
                    name: "Box",
                    costPrice: 3.25,
                    sellingPrice: 7.5,
                    quantityofNextLevel: 10,
                    nextLevelId: "pack-tablet"
                },
                {
                    id: "pack-tablet",
                    name: "Tablet",
                    costPrice: null,
                    sellingPrice: null,
                    quantityofNextLevel: null,
                    nextLevelId: null
                }
            ]
        }
    ]
};

function makeProductCreatedEvent(
    product: productStructure,
    eventId = `activity-${nextEventId++}`
): Extract<ActivityEvent, { type: "product.created" }> {
    const [event] = prepareActivityEvents(
        buildProductCreationActivityInputs(product, [], []),
        {
            makeId: () => eventId,
            now: () => new Date("2026-11-25T10:00:00.000Z")
        }
    );
    if (!event || event.type !== "product.created") {
        throw new Error("Expected a Product-created Activity event.");
    }
    return event;
}

function makeProductUpdatedEvent(
    previousProduct: productStructure,
    nextProduct: productStructure,
    operationKey = `product.updated:${previousProduct.id}:${nextEventId++}`
): Extract<ActivityEvent, { type: "product.updated" }> {
    const inputs = buildProductUpdateActivityInputs(
        previousProduct,
        nextProduct,
        [],
        [],
        [],
        operationKey,
        "Catalogue test update"
    );
    const [event] = prepareActivityEvents(inputs, {
        makeId: () => `activity-${nextEventId++}`,
        now: () => new Date("2026-11-25T10:00:00.000Z")
    });
    if (!event || event.type !== "product.updated") {
        throw new Error("Expected a Product-updated Activity event.");
    }
    return event;
}

function makeVariantAddedEvent(
    product: productStructure,
    productVariant: variant
): Extract<ActivityEvent, { type: "product.variant_added" }> {
    const input: ActivityEventInput = {
        type: "product.variant_added",
        operationKey: `product.variant_added:${product.id}:${productVariant.id}`,
        productId: product.id,
        productName: product.name,
        variant: snapshotVariant(productVariant),
        reason: "Added through Receive Delivery"
    };
    const [event] = prepareActivityEvents([input], {
        makeId: () => `activity-${nextEventId++}`,
        now: () => new Date("2026-11-25T10:00:00.000Z")
    });
    if (!event || event.type !== "product.variant_added") {
        throw new Error("Expected a Variant-added Activity event.");
    }
    return event;
}

function makeFullCreationResult(): ProductCreationResult {
    const batch: inventoryBatch = {
        batchId: "full-batch",
        productId: baseProduct.id,
        variantId: baseProduct.variant[0].id,
        batchNumber: "LOT-FULL",
        expiryDate: new Date("2027-04-30T00:00:00.000Z"),
        receivedDate: "2026-11-25",
        pricingByPackagingLevel: [
            {
                packagingLevelId: "pack-box",
                costPrice: 3.25,
                sellingPrice: 7.5
            },
            {
                packagingLevelId: "pack-tablet",
                costPrice: null,
                sellingPrice: 1.25
            }
        ]
    };
    const record: inventory = {
        id: "full-inventory",
        productId: baseProduct.id,
        variantId: baseProduct.variant[0].id,
        batchId: batch.batchId,
        stockQuantities: [
            { packagingLevelId: "pack-box", quantity: 4 },
            { packagingLevelId: "pack-tablet", quantity: 40 }
        ]
    };
    return {
        product: baseProduct,
        inventoryRecords: [record],
        inventoryBatches: [batch]
    };
}

function makeFullCreationEvents(result: ProductCreationResult): ActivityEvent[] {
    return prepareActivityEvents(
        buildProductCreationActivityInputs(
            result.product,
            result.inventoryRecords,
            result.inventoryBatches
        ),
        {
            makeId: () => `activity-${nextEventId++}`,
            now: () => new Date("2026-11-25T10:00:00.000Z")
        }
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
    throw new Error("Product write test received an unsupported SQLite value.");
}

function bindings(parameters: readonly (string | number | boolean | null)[]) {
    return Object.fromEntries(parameters.map((parameter, index) => [
        `$${index + 1}`,
        typeof parameter === "boolean" ? Number(parameter) : parameter
    ]));
}

function executeIsolatedTransaction(
    statements: readonly SqliteStatement[],
    expectedRowsAffected?: readonly number[]
): number[] {
    database.exec("BEGIN IMMEDIATE");
    try {
        const rowsAffected = statements.map(({ query, parameters }, index) => {
            const changes = Number(
                database.prepare(query).run(bindings(parameters)).changes
            );
            const expected = expectedRowsAffected?.[index];
            if (expected !== undefined && changes !== expected) {
                throw new Error(
                    `SQLite transaction statement ${index + 1} expected ${expected} affected row(s), received ${changes}.`
                );
            }
            return changes;
        });
        database.exec("COMMIT");
        return rowsAffected;
    } catch (error) {
        database.exec("ROLLBACK");
        throw error;
    }
}

function queryIsolatedDatabase(
    query: string,
    parameters: readonly (string | number | boolean | null)[] = []
): SqliteQueryResult {
    const statement = database.prepare(query);
    const columns = statement.columns().map((column) => column.name);
    const rows = statement.all(bindings(parameters)).map((row) =>
        columns.map((column) => sqliteValue(row[column]))
    );
    return { columns, rows };
}

function getSingleRow(
    query: string,
    parameters: readonly (string | number | boolean | null)[] = []
): Record<string, unknown> {
    const row = database.prepare(query).get(bindings(parameters));
    if (!row) {
        throw new Error("Expected one SQLite test row.");
    }
    return row;
}

function countRows(table: string): number {
    const row = getSingleRow(`SELECT COUNT(*) AS count FROM ${table}`);
    return Number(row.count);
}

function createDeliveryDraftLock(productId: string): void {
    database.prepare(`
        INSERT INTO deliveries (
            delivery_id, status, created_at, updated_at
        ) VALUES ($1, 'draft', $2, $2)
    `).run({
        $1: "delivery-lock",
        $2: "2026-11-25T10:00:00.000Z"
    });
    database.prepare(`
        INSERT INTO delivery_items (
            delivery_id, delivery_item_id, item_position, product_id,
            variant_id, packaging_level_id, quantity
        ) VALUES ($1, $2, 0, $3, $4, $5, 1)
    `).run({
        $1: "delivery-lock",
        $2: "delivery-item-lock",
        $3: productId,
        $4: "variant-tablets",
        $5: "pack-tablet"
    });
}

async function createBaseProduct(
    product: productStructure = baseProduct
): Promise<Extract<ActivityEvent, { type: "product.created" }>> {
    const event = makeProductCreatedEvent(product);
    await persistCatalogueProduct(product, [], event);
    return event;
}

describe("Product write repository", () => {
    beforeEach(() => {
        database = new DatabaseSync(":memory:");
        database.exec("PRAGMA foreign_keys = ON");
        migrationSql.forEach((sql) => database.exec(sql));
        nextEventId = 1;
        executeTransactionMock.mockReset();
        executeTransactionMock.mockImplementation(
            async (
                statements: readonly SqliteStatement[],
                expectedRowsAffected?: readonly number[]
            ) => executeIsolatedTransaction(statements, expectedRowsAffected)
        );
        querySqliteMock.mockReset();
        querySqliteMock.mockImplementation(
            async (
                query: string,
                parameters: readonly (string | number | boolean | null)[] = []
            ) => queryIsolatedDatabase(query, parameters)
        );
    });

    afterEach(() => {
        database.close();
    });

    it("round-trips full Product creation with batches, Inventory, prices, and Activity", async () => {
        const result = makeFullCreationResult();
        const events = makeFullCreationEvents(result);

        await persistFullProduct(
            result,
            [],
            [],
            [],
            events
        );

        await expect(getAllProducts()).resolves.toEqual([baseProduct]);
        const inventory = await getAllInventory();
        expect(inventory.inventoryRecords).toEqual([{
            id: "full-inventory",
            productId: baseProduct.id,
            variantId: baseProduct.variant[0].id,
            batchId: "full-batch",
            stockQuantities: [
                { packagingLevelId: "pack-box", quantity: 4 },
                { packagingLevelId: "pack-tablet", quantity: 40 }
            ]
        }]);
        expect(inventory.inventoryBatches).toEqual([{
            batchId: "full-batch",
            productId: baseProduct.id,
            variantId: baseProduct.variant[0].id,
            batchNumber: "LOT-FULL",
            expiryDate: new Date("2027-04-30T00:00:00.000Z"),
            receivedDate: "2026-11-25",
            pricingByPackagingLevel: [
                { packagingLevelId: "pack-box", costPrice: 3.25, sellingPrice: 7.5 },
                { packagingLevelId: "pack-tablet", costPrice: null, sellingPrice: 1.25 }
            ]
        }]);
        await expect(getAllActivityEvents()).resolves.toEqual(events);
    });

    it("rolls back catalogue, batch, Inventory, and Activity when a middle stock insert fails", async () => {
        database.exec(`
            CREATE TRIGGER test_reject_initial_stock
            BEFORE INSERT ON inventory_stock
            BEGIN
                SELECT RAISE(ABORT, 'injected initial stock failure');
            END
        `);
        const result = makeFullCreationResult();

        await expect(persistFullProduct(
            result,
            [],
            [],
            [],
            makeFullCreationEvents(result)
        )).rejects.toThrow("injected initial stock failure");

        expect(countRows("products")).toBe(0);
        expect(countRows("variants")).toBe(0);
        expect(countRows("packaging_levels")).toBe(0);
        expect(countRows("batches")).toBe(0);
        expect(countRows("inventory_records")).toBe(0);
        expect(countRows("inventory_stock")).toBe(0);
        expect(countRows("activity_events")).toBe(0);
    });

    it("rejects mismatched or duplicate initial associations before execution", async () => {
        const mismatched = makeFullCreationResult();
        const events = makeFullCreationEvents(mismatched);
        mismatched.inventoryRecords[0].variantId = "unknown-variant";

        await expect(persistFullProduct(
            mismatched,
            [],
            [],
            [],
            events
        )).rejects.toThrow("Variant");
        expect(executeTransactionMock).not.toHaveBeenCalled();
    });

    it("rolls back the complete full creation when a Product Activity insert conflicts", async () => {
        const result = makeFullCreationResult();
        const events = makeFullCreationEvents(result);
        const conflictingEvent = {
            ...events[0],
            eventId: "activity-conflict",
            occurredAt: "2026-11-25T10:00:00.000Z"
        } as ActivityEvent;
        await import("./activityWriteRepository").then(({ insertActivityEvent }) =>
            insertActivityEvent(conflictingEvent)
        );

        await expect(persistFullProduct(
            result,
            [],
            [],
            [],
            events
        )).rejects.toThrow("UNIQUE constraint failed");
        expect(countRows("products")).toBe(0);
        expect(countRows("batches")).toBe(0);
        expect(countRows("inventory_records")).toBe(0);
        expect(countRows("activity_events")).toBe(1);
    });

    it("rolls back the complete full creation on an unexpected stale row count", async () => {
        const result = makeFullCreationResult();
        executeTransactionMock.mockImplementationOnce(async (
            statements: readonly SqliteStatement[],
            expectedRowsAffected?: readonly number[]
        ) => {
            database.exec("BEGIN IMMEDIATE");
            try {
                const altered = statements.map(({ query, parameters }, index) => {
                    const changes = Number(
                        database.prepare(query).run(bindings(parameters)).changes
                    );
                    const expected = expectedRowsAffected?.[index];
                    if (index === 3 && changes === 1) {
                        throw new Error(
                            "SQLite full Product transaction expected 1 affected row, received 0."
                        );
                    }
                    if (expected !== undefined && changes !== expected) {
                        throw new Error(
                            `SQLite transaction statement ${index + 1} expected ${expected} affected row(s), received ${changes}.`
                        );
                    }
                    return changes;
                });
                database.exec("COMMIT");
                return altered;
            } catch (error) {
                database.exec("ROLLBACK");
                throw error;
            }
        });

        await expect(persistFullProduct(
            result,
            [],
            [],
            [],
            makeFullCreationEvents(result)
        )).rejects.toThrow("affected row");
        expect(countRows("products")).toBe(0);
        expect(countRows("batches")).toBe(0);
        expect(countRows("inventory_records")).toBe(0);
        expect(countRows("activity_events")).toBe(0);
    });

    it("round-trips catalogue-only creation and Variant addition without stock rows", async () => {
        await createBaseProduct();
        const addedVariant: variant = {
            id: "variant-capsules",
            variantName: "Capsules",
            lowStockThreshold: { quantity: 2 },
            packagingHierarchy: [{
                id: "pack-bottle",
                name: "Bottle",
                costPrice: 4.12,
                sellingPrice: 8.99,
                quantityofNextLevel: null,
                nextLevelId: null
            }]
        };
        const productWithVariant = {
            ...baseProduct,
            variant: [...baseProduct.variant, addedVariant]
        };
        const variantEvent = makeVariantAddedEvent(baseProduct, addedVariant);
        await persistVariantAddition(baseProduct, addedVariant, variantEvent);

        const persisted = await getAllProducts();
        expect(persisted[0]).toEqual(productWithVariant);
        expect(countRows("variant_low_stock_thresholds")).toBe(2);
        for (const table of [
            "batches",
            "inventory_records",
            "inventory_stock",
            "batch_pricing"
        ]) {
            expect(countRows(table)).toBe(0);
        }
        await expect(getAllActivityEvents()).resolves.toEqual([
            makeProductCreatedEvent(baseProduct, "activity-1"),
            variantEvent
        ]);
    });

    it("keeps Product ordering aligned with the reducer's prepend behavior", async () => {
        await createBaseProduct();
        const secondProduct: productStructure = {
            ...baseProduct,
            id: "product-second",
            name: "Second catalogue medicine",
            variant: baseProduct.variant.map((productVariant) => ({
                ...productVariant,
                id: "variant-second",
                lowStockThreshold: {
                    quantity: productVariant.lowStockThreshold?.quantity ?? 0,
                    packagingLevelId: "pack-second-box"
                },
                packagingHierarchy: productVariant.packagingHierarchy.map(
                    (level, index) => ({
                        ...level,
                        id: index === 0 ? "pack-second-box" : "pack-second-tablet",
                        nextLevelId: index === 0 ? "pack-second-tablet" : null
                    })
                )
            }))
        };

        await persistCatalogueProduct(
            secondProduct,
            [baseProduct],
            makeProductCreatedEvent(secondProduct)
        );

        await expect(getAllProducts()).resolves.toEqual([
            secondProduct,
            baseProduct
        ]);
        expect(database.prepare(`
            SELECT product_id, product_position FROM products
            ORDER BY product_position
        `).all()).toEqual([
            { product_id: "product-second", product_position: 0 },
            { product_id: "product-catalogue", product_position: 1 }
        ]);
    });

    it("adds packaging and a Variant during Product editing without position or link conflicts", async () => {
        await createBaseProduct();
        const previousProduct = baseProduct;
        const nextProduct: productStructure = {
            ...baseProduct,
            variant: [
                {
                    ...baseProduct.variant[0],
                    lowStockThreshold: {
                        quantity: 3,
                        packagingLevelId: "pack-capsule"
                    },
                    packagingHierarchy: [
                        {
                            ...baseProduct.variant[0].packagingHierarchy[0],
                            nextLevelId: "pack-tablet",
                            quantityofNextLevel: 10
                        },
                        {
                            ...baseProduct.variant[0].packagingHierarchy[1],
                            nextLevelId: "pack-capsule",
                            quantityofNextLevel: 5
                        },
                        {
                            id: "pack-capsule",
                            name: "Capsule",
                            costPrice: null,
                            sellingPrice: 1.25,
                            quantityofNextLevel: null,
                            nextLevelId: null
                        }
                    ]
                },
                {
                    id: "variant-syrup",
                    variantName: "Syrup",
                    lowStockThreshold: { quantity: 1 },
                    packagingHierarchy: [{
                        id: "pack-bottle",
                        name: "Bottle",
                        costPrice: 4.5,
                        sellingPrice: 9.5,
                        quantityofNextLevel: null,
                        nextLevelId: null
                    }]
                }
            ]
        };

        await persistProductUpdate(
            previousProduct,
            nextProduct,
            makeProductUpdatedEvent(previousProduct, nextProduct)
        );

        await expect(getAllProducts()).resolves.toEqual([nextProduct]);
        expect(countRows("variants")).toBe(2);
        expect(countRows("packaging_levels")).toBe(4);
        expect(countRows("variant_low_stock_thresholds")).toBe(2);
        expect(getSingleRow(`
            SELECT next_level_id FROM packaging_levels
            WHERE packaging_level_id = 'pack-tablet'
        `).next_level_id).toBe("pack-capsule");
    });

    it("safely reorders Variants and packaging while persisting conversion, nullable prices, and thresholds", async () => {
        await createBaseProduct();
        const secondVariant: variant = {
            id: "variant-capsules",
            variantName: "Capsules",
            lowStockThreshold: { quantity: 3 },
            packagingHierarchy: [{
                id: "pack-bottle",
                name: "Bottle",
                costPrice: 4,
                sellingPrice: 9,
                quantityofNextLevel: null,
                nextLevelId: null
            }]
        };
        await persistVariantAddition(
            baseProduct,
            secondVariant,
            makeVariantAddedEvent(baseProduct, secondVariant)
        );
        const previousProduct = {
            ...baseProduct,
            variant: [...baseProduct.variant, secondVariant]
        };
        const nextProduct: productStructure = {
            ...previousProduct,
            name: "Renamed medicine",
            description: undefined,
            genericName: undefined,
            manufacturer: "New maker",
            category: "Updated category",
            variant: [
                { ...secondVariant, variantName: "Capsules, updated" },
                {
                    ...baseProduct.variant[0],
                    nafdacRegistrationNumber: undefined,
                    lowStockThreshold: {
                        quantity: 7,
                        packagingLevelId: "pack-tablet"
                    },
                    packagingHierarchy: [
                        {
                            ...baseProduct.variant[0].packagingHierarchy[1],
                            sellingPrice: 10.15,
                            quantityofNextLevel: 20,
                            nextLevelId: "pack-box"
                        },
                        {
                            ...baseProduct.variant[0].packagingHierarchy[0],
                            costPrice: null,
                            quantityofNextLevel: null,
                            nextLevelId: null
                        }
                    ]
                }
            ]
        };

        await persistProductUpdate(
            previousProduct,
            nextProduct,
            makeProductUpdatedEvent(previousProduct, nextProduct)
        );

        await expect(getAllProducts()).resolves.toEqual([nextProduct]);
        const firstVariantPosition = Number(getSingleRow(`
            SELECT variant_position FROM variants WHERE variant_id = 'variant-capsules'
        `).variant_position);
        const tabletPosition = Number(getSingleRow(`
            SELECT packaging_position FROM packaging_levels
            WHERE packaging_level_id = 'pack-tablet'
        `).packaging_position);
        expect(firstVariantPosition).toBe(0);
        expect(tabletPosition).toBe(0);
        expect(getSingleRow(`
            SELECT cost_price_minor_units, selling_price_minor_units,
                quantity_of_next_level, next_level_id
            FROM packaging_levels WHERE packaging_level_id = 'pack-box'
        `)).toMatchObject({
            cost_price_minor_units: null,
            selling_price_minor_units: 750,
            quantity_of_next_level: null,
            next_level_id: null
        });
        expect(getSingleRow(`
            SELECT quantity_of_next_level, next_level_id
            FROM packaging_levels WHERE packaging_level_id = 'pack-tablet'
        `)).toMatchObject({
            quantity_of_next_level: 20,
            next_level_id: "pack-box"
        });
        expect(getSingleRow(`
            SELECT quantity, packaging_level_id
            FROM variant_low_stock_thresholds
            WHERE variant_id = 'variant-tablets'
        `)).toMatchObject({
            quantity: 7,
            packaging_level_id: "pack-tablet"
        });
        expect(countRows("activity_events")).toBe(3);
    });

    it("rejects unsupported price precision and unsafe minor-unit values before execution", async () => {
        const invalidPrecision: productStructure = {
            ...baseProduct,
            variant: [{
                ...baseProduct.variant[0],
                packagingHierarchy: [{
                    ...baseProduct.variant[0].packagingHierarchy[0],
                    costPrice: 1.005
                }]
            }]
        };
        const unsafePrice: productStructure = {
            ...baseProduct,
            variant: [{
                ...baseProduct.variant[0],
                packagingHierarchy: [{
                    ...baseProduct.variant[0].packagingHierarchy[0],
                    costPrice: Number.MAX_SAFE_INTEGER
                }]
            }]
        };

        await expect(persistCatalogueProduct(
            invalidPrecision,
            [],
            makeProductCreatedEvent(invalidPrecision)
        )).rejects.toThrow("at most two decimal places");
        await expect(persistCatalogueProduct(
            unsafePrice,
            [],
            makeProductCreatedEvent(unsafePrice)
        )).rejects.toThrow("safe SQLite minor-unit range");
        expect(executeTransactionMock).not.toHaveBeenCalled();
    });

    it("allows Product name and description changes under a product-wide active draft lock", async () => {
        await createBaseProduct();
        createDeliveryDraftLock(baseProduct.id);
        const nextProduct = {
            ...baseProduct,
            name: "Allowed name edit",
            description: "Allowed description edit"
        };

        await persistProductUpdate(
            baseProduct,
            nextProduct,
            makeProductUpdatedEvent(baseProduct, nextProduct)
        );

        await expect(getAllProducts()).resolves.toEqual([nextProduct]);
        expect(countRows("activity_events")).toBe(2);
    });

    it("rejects structure changes to any Variant of a product with an active draft", async () => {
        await createBaseProduct();
        const secondVariant: variant = {
            id: "variant-capsules",
            variantName: "Capsules",
            packagingHierarchy: [{
                id: "pack-bottle",
                name: "Bottle",
                costPrice: null,
                sellingPrice: null,
                quantityofNextLevel: null,
                nextLevelId: null
            }]
        };
        await persistVariantAddition(
            baseProduct,
            secondVariant,
            makeVariantAddedEvent(baseProduct, secondVariant)
        );
        const previousProduct = {
            ...baseProduct,
            variant: [...baseProduct.variant, secondVariant]
        };
        createDeliveryDraftLock(baseProduct.id);
        const nextProduct = {
            ...previousProduct,
            variant: previousProduct.variant.map((item) =>
                item.id === secondVariant.id
                    ? { ...item, variantName: "Changed while locked" }
                    : item
            )
        };

        await expect(persistProductUpdate(
            previousProduct,
            nextProduct,
            makeProductUpdatedEvent(previousProduct, nextProduct)
        )).rejects.toThrow("active draft locks product structure");

        expect(await getAllProducts()).toEqual([previousProduct]);
        expect(countRows("activity_events")).toBe(2);
    });

    it("rolls back earlier catalogue statements if a middle packaging insert fails", async () => {
        database.exec(`
            CREATE TRIGGER test_reject_packaging
            BEFORE INSERT ON packaging_levels
            BEGIN
                SELECT RAISE(ABORT, 'injected packaging failure');
            END
        `);
        const event = makeProductCreatedEvent(baseProduct);

        await expect(persistCatalogueProduct(baseProduct, [], event))
            .rejects.toThrow("injected packaging failure");

        expect(countRows("products")).toBe(0);
        expect(countRows("variants")).toBe(0);
        expect(countRows("packaging_levels")).toBe(0);
        expect(countRows("activity_events")).toBe(0);
        await expect(getAllProducts()).resolves.toEqual([]);
    });

    it("rolls back Product and Variant changes when a stale conditional row count is unexpected", async () => {
        await createBaseProduct();
        const nextProduct = {
            ...baseProduct,
            name: "Name must roll back",
            variant: [{
                ...baseProduct.variant[0],
                variantName: "Updated tablets"
            }]
        };
        const event = makeProductUpdatedEvent(baseProduct, nextProduct);
        database.prepare(`
            UPDATE variants SET variant_name = 'Concurrent update'
            WHERE variant_id = 'variant-tablets'
        `).run();

        await expect(persistProductUpdate(baseProduct, nextProduct, event))
            .rejects.toThrow("expected 1 affected row(s), received 0");

        expect(getSingleRow(`
            SELECT name FROM products WHERE product_id = $1
        `, [baseProduct.id]).name).toBe(baseProduct.name);
        expect(getSingleRow(`
            SELECT variant_name FROM variants WHERE variant_id = 'variant-tablets'
        `).variant_name).toBe("Concurrent update");
        expect(countRows("activity_events")).toBe(1);
    });

    it("rolls back catalogue creation when the append-only Activity insert conflicts", async () => {
        const event = makeProductCreatedEvent(baseProduct);
        const existingProduct: productStructure = {
            ...baseProduct,
            id: "existing-product",
            variant: baseProduct.variant.map((productVariant) => ({
                ...productVariant,
                id: "existing-variant",
                ...(productVariant.lowStockThreshold
                    ? {
                        lowStockThreshold: {
                            quantity: productVariant.lowStockThreshold.quantity,
                            packagingLevelId: "existing-pack-box"
                        }
                    }
                    : {}),
                packagingHierarchy: productVariant.packagingHierarchy.map(
                    (level, index) => ({
                        ...level,
                        id: index === 0 ? "existing-pack-box" : "existing-pack-tablet",
                        nextLevelId: index === 0 ? "existing-pack-tablet" : null
                    })
                )
            }))
        };
        await persistCatalogueProduct(
            existingProduct,
            [],
            makeProductCreatedEvent(existingProduct, "existing-event")
        );
        const conflictingEvent = {
            ...event,
            operationKey: "product.created:product-catalogue"
        };
        await import("./activityWriteRepository").then(({ insertActivityEvent }) =>
            insertActivityEvent(conflictingEvent)
        );

        await expect(persistCatalogueProduct(
            baseProduct,
            [existingProduct],
            event
        )).rejects.toThrow("UNIQUE constraint failed");

        expect(countRows("products")).toBe(1);
        expect(countRows("activity_events")).toBe(2);
        expect(getSingleRow(`
            SELECT COUNT(*) AS count FROM products
            WHERE product_id = 'product-catalogue'
        `).count).toBe(0);
    });
});
