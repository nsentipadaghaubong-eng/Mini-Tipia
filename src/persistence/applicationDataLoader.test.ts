/// <reference types="node" />

import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityEvent } from "../activity/activity";
import type {
    ApplicationDataRepositories
} from "./applicationDataLoader";
import {
    loadApplicationData
} from "./applicationDataLoader";
import {
    serializeActivityEvent,
    serializeCompletedSaleItemSnapshot,
    serializeReceivedDeliveryItemSnapshot,
    type ReceivedDeliveryItemSnapshot
} from "./historicalSerialization";
import type { CompletedSaleItem } from "../sales/salesEngine";
import type {
    SqliteQueryResult,
    SqliteQueryExecutor,
    SqliteQueryValue
} from "./query";
import {
    getAllActivityEvents
} from "./repositories/activityRepository";
import {
    getAllInventory
} from "./repositories/inventoryRepository";
import {
    getAllProducts
} from "./repositories/productRepository";
import {
    getAllReceivedDeliveries
} from "./repositories/receiveDeliveryRepository";
import {
    getAllActiveDeliveryDrafts
} from "./repositories/receiveDeliveryDraftRepository";
import {
    getAllSales
} from "./repositories/salesRepository";
import {
    getAllActiveSaleDrafts
} from "./repositories/salesDraftRepository";

const {
    querySqliteMock,
    createSnapshotExecutorMock,
    snapshotBatchMock
} = vi.hoisted(() => ({
    querySqliteMock: vi.fn(),
    createSnapshotExecutorMock: vi.fn(),
    snapshotBatchMock: vi.fn()
}));

vi.mock("./query", () => ({
    querySqlite: querySqliteMock,
    createSqliteReadSnapshotExecutor: createSnapshotExecutorMock
}));

const migrationSql = readFileSync(
    new URL("../../src-tauri/src/migrations/migration_001.sql", import.meta.url),
    "utf8"
);
const associationMigrationSql = readFileSync(
    new URL(
        "../../src-tauri/src/migrations/migration_002_delivery_inventory_association.sql",
        import.meta.url
    ),
    "utf8"
);

let database: DatabaseSync;

const occurredAt = "2026-11-25T10:00:00.000Z";
const productSnapshot = {
    productId: "current-product",
    productName: "Historical medicine",
    variants: [{
        variantId: "current-variant",
        variantName: "Historical tablets",
        packaging: [{
            packagingLevelId: "current-pack",
            name: "Historical carton",
            costPrice: null,
            sellingPrice: 0.75,
            quantityOfNextLevel: null,
            nextLevelId: null,
            nextLevelName: null
        }]
    }]
} as const;
const variantSnapshot = productSnapshot.variants[0];
const packagingSnapshot = variantSnapshot.packaging[0];
const batchSnapshot = {
    batchId: "retired-batch",
    productId: "current-product",
    productName: "Historical medicine",
    variantId: "current-variant",
    variantName: "Historical tablets",
    batchNumber: "OLD-LOT",
    expiryDate: "2027-01-31T00:00:00.000Z",
    receivedDate: "2026-01-01",
    pricingByPackagingLevel: [{
        packagingLevelId: "current-pack",
        packagingLevelName: "Historical carton",
        costPrice: 0.1,
        sellingPrice: 0.2
    }]
} as const;

const saleItemSnapshot: CompletedSaleItem = {
    lineId: "completed-line",
    product: productSnapshot,
    variant: variantSnapshot,
    batch: batchSnapshot,
    inventoryRecordId: "retired-inventory",
    packagingLevel: packagingSnapshot,
    quantity: 2,
    defaultSellingPrice: null,
    appliedSellingPrice: 0.75,
    subtotal: 1.5,
    discountAmount: 0.25,
    finalAmount: 1.25,
    expiredBatch: false
};

const receivedItemSnapshot: ReceivedDeliveryItemSnapshot = {
    deliveryItemId: "received-item",
    productId: productSnapshot.productId,
    productName: productSnapshot.productName,
    variantId: variantSnapshot.variantId,
    variantName: variantSnapshot.variantName,
    packagingLevel: packagingSnapshot,
    quantity: 4,
    batch: batchSnapshot,
    pricingAtReceipt: {
        packagingLevelId: packagingSnapshot.packagingLevelId,
        costPrice: 0.1,
        sellingPrice: 0.2
    }
};

function activityEvents(): ActivityEvent[] {
    return [{
        type: "sale.completed",
        eventId: "sale-event",
        operationKey: "sale.completed:completed-sale",
        occurredAt,
        saleId: "completed-sale",
        subtotal: 1.5,
        discountAmount: 0.25,
        finalAmount: 1.25,
        expiredBatchConfirmed: false,
        items: [{
            productId: productSnapshot.productId,
            productName: productSnapshot.productName,
            variantId: variantSnapshot.variantId,
            variantName: variantSnapshot.variantName,
            product: productSnapshot,
            variant: variantSnapshot,
            packagingLevel: packagingSnapshot,
            quantity: 2,
            defaultSellingPrice: null,
            appliedSellingPrice: 0.75,
            subtotal: 1.5,
            discountAmount: 0.25,
            finalAmount: 1.25,
            allocations: [{
                inventoryId: "retired-inventory",
                batch: batchSnapshot,
                quantity: 2
            }]
        }]
    }, {
        type: "delivery.received",
        eventId: "delivery-event",
        operationKey: "delivery.received:received-delivery",
        occurredAt: "2026-11-25T11:00:00.000Z",
        deliveryId: "received-delivery",
        deliveryDate: "2026-11-25",
        receivedBy: "Receiving pharmacist",
        supplierName: "Historical supplier",
        invoiceNumber: "INV-HIST",
        items: [{
            productId: productSnapshot.productId,
            productName: productSnapshot.productName,
            variantId: variantSnapshot.variantId,
            variantName: variantSnapshot.variantName,
            batch: batchSnapshot,
            pricingAtReceipt: {
                packagingLevelId: packagingSnapshot.packagingLevelId,
                costPrice: 0.1,
                sellingPrice: 0.2
            },
            stock: [{
                packagingLevel: packagingSnapshot,
                quantity: 4
            }]
        }]
    }];
}

function insertActivity(event: ActivityEvent): void {
    const persisted = serializeActivityEvent(event);
    database.prepare(`
        INSERT INTO activity_events (
            event_id, operation_key, event_type, occurred_at, actor_id, event_json
        ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
        persisted.eventId,
        persisted.operationKey,
        persisted.eventType,
        persisted.occurredAt,
        persisted.actorId,
        persisted.eventJson
    );
}

function seedCurrentCatalogAndInventory(): void {
    database.prepare(`
        INSERT INTO products (
            product_id, product_position, name, generic_name
        ) VALUES ('current-product', 0, 'Current catalog name', 'Current generic')
    `).run();
    database.prepare(`
        INSERT INTO variants (
            variant_id, product_id, variant_position, variant_name
        ) VALUES ('current-variant', 'current-product', 0, 'Current variant')
    `).run();
    database.prepare(`
        INSERT INTO packaging_levels (
            packaging_level_id, product_id, variant_id, packaging_position,
            name, cost_price_minor_units, selling_price_minor_units
        ) VALUES ('current-pack', 'current-product', 'current-variant', 0,
            'Current pack', NULL, 250)
    `).run();
    database.prepare(`
        INSERT INTO batches (
            batch_id, product_id, variant_id, batch_position,
            batch_number, expiry_date, received_date
        ) VALUES ('current-batch', 'current-product', 'current-variant', 0,
            'CURRENT-LOT', '2028-01-31', '2026-01-01')
    `).run();
    database.prepare(`
        INSERT INTO inventory_records (
            inventory_id, product_id, variant_id, inventory_position, batch_id
        ) VALUES ('current-inventory', 'current-product', 'current-variant', 0,
            'current-batch')
    `).run();
    database.prepare(`
        INSERT INTO inventory_stock (
            inventory_id, product_id, variant_id, packaging_level_id,
            stock_position, quantity
        ) VALUES ('current-inventory', 'current-product', 'current-variant',
            'current-pack', 0, 10)
    `).run();
    database.prepare(`
        INSERT INTO batch_pricing (
            batch_id, product_id, variant_id, packaging_level_id,
            pricing_position, cost_price_minor_units, selling_price_minor_units
        ) VALUES ('current-batch', 'current-product', 'current-variant',
            'current-pack', 0, 100, 250)
    `).run();
    database.prepare(`
        INSERT INTO batches (
            batch_id, product_id, variant_id, batch_position,
            batch_number, expiry_date, received_date
        ) VALUES ('retired-batch', 'current-product', 'current-variant', 1,
            'OLD-LOT', '2027-01-31', '2026-01-01')
    `).run();
    database.prepare(`
        INSERT INTO inventory_records (
            inventory_id, product_id, variant_id, inventory_position, batch_id
        ) VALUES ('retired-inventory', 'current-product', 'current-variant', 1,
            'retired-batch')
    `).run();
    database.prepare(`
        INSERT INTO inventory_stock (
            inventory_id, product_id, variant_id, packaging_level_id,
            stock_position, quantity
        ) VALUES ('retired-inventory', 'current-product', 'current-variant',
            'current-pack', 0, 14)
    `).run();
    database.prepare(`
        INSERT INTO batch_pricing (
            batch_id, product_id, variant_id, packaging_level_id,
            pricing_position, cost_price_minor_units, selling_price_minor_units
        ) VALUES ('retired-batch', 'current-product', 'current-variant',
            'current-pack', 0, 10, 20)
    `).run();
}

function insertCompletedSale(): void {
    database.exec("BEGIN");
    try {
        database.prepare(`
            INSERT INTO sale_drafts (
                draft_id, status, created_at, updated_at, approved_sale_id
            ) VALUES ('completed-source-draft', 'draft', ?, ?, NULL)
        `).run(occurredAt, occurredAt);
        database.prepare(`
            INSERT INTO sale_draft_items (
                draft_id, line_id, item_position, product_id, variant_id,
                inventory_record_id, batch_id, packaging_level_id, quantity,
                default_selling_price_minor_units,
                applied_selling_price_minor_units, discount_minor_units
            ) VALUES ('completed-source-draft', 'completed-line', 0,
                'current-product', 'current-variant', 'current-inventory',
                'current-batch', 'current-pack', 2, NULL, 75, 25)
        `).run();
        database.prepare(`
            INSERT INTO sales (
                sale_id, source_draft_id, completed_event_id, completed_at,
                customer_name, customer_address, sale_date, staff_user_id,
                staff_display_name, notes, subtotal_minor_units,
                discount_minor_units, final_minor_units, expired_batch_confirmed
            ) VALUES ('completed-sale', 'completed-source-draft', 'sale-event', ?,
                NULL, NULL, NULL, NULL, NULL, NULL, 150, 25, 125, 0)
        `).run(occurredAt);
        database.prepare(`
            INSERT INTO sale_items (
                sale_id, line_id, item_position, inventory_record_id,
                product_id, variant_id, batch_id, packaging_level_id, quantity,
                default_selling_price_minor_units,
                applied_selling_price_minor_units, subtotal_minor_units,
                discount_minor_units, final_minor_units, expired_batch,
                item_snapshot_json
            ) VALUES ('completed-sale', 'completed-line', 0, 'retired-inventory',
                'current-product', 'current-variant', 'retired-batch',
                'current-pack', 2, NULL, 75, 150, 25, 125, 0, ?)
        `).run(serializeCompletedSaleItemSnapshot(saleItemSnapshot));
        database.exec("COMMIT");
    } catch (error) {
        database.exec("ROLLBACK");
        throw error;
    }
}

function insertActiveAndCancelledSaleDrafts(): void {
    database.prepare(`
        INSERT INTO sale_drafts (
            draft_id, status, created_at, updated_at, customer_name,
            customer_address, sale_date, staff_user_id, staff_display_name,
            notes, approved_sale_id
        ) VALUES ('active-sale-draft', 'draft', ?, ?, NULL, NULL, NULL,
            'staff-1', NULL, NULL, NULL)
    `).run(occurredAt, occurredAt);
    database.prepare(`
        INSERT INTO sale_draft_items (
            draft_id, line_id, item_position, product_id, variant_id,
            inventory_record_id, batch_id, packaging_level_id, quantity,
            default_selling_price_minor_units,
            applied_selling_price_minor_units, discount_minor_units
        ) VALUES ('active-sale-draft', 'active-line', 0, 'current-product',
            'current-variant', 'current-inventory', 'current-batch',
            'current-pack', 1, 250, 200, 0)
    `).run();
    database.prepare(`
        INSERT INTO sale_drafts (
            draft_id, status, created_at, updated_at, approved_sale_id
        ) VALUES ('cancelled-sale-draft', 'cancelled', ?, ?, NULL)
    `).run(occurredAt, occurredAt);
}

function insertReceivedAndActiveDeliveryDrafts(): void {
    database.prepare(`
        INSERT INTO deliveries (
            delivery_id, status, created_at, updated_at, delivery_date,
            received_by, supplier_name, invoice_number, received_event_id
        ) VALUES ('received-delivery', 'draft', ?, ?, NULL, NULL, NULL, NULL, NULL)
    `).run(occurredAt, occurredAt);
    database.prepare(`
        INSERT INTO delivery_items (
            delivery_id, delivery_item_id, item_position, product_id,
            variant_id, packaging_level_id, quantity, batch_number,
            expiry_date, cost_price_minor_units, selling_price_minor_units,
            received_batch_id, received_inventory_id, receipt_snapshot_json
        ) VALUES ('received-delivery', 'received-item', 0, 'current-product',
            'current-variant', 'current-pack', 4, 'OLD-LOT', '2027-01-31',
            10, 20, 'retired-batch', 'retired-inventory', ?)
    `).run(serializeReceivedDeliveryItemSnapshot(receivedItemSnapshot));
    database.prepare(`
        UPDATE deliveries SET status = 'received', updated_at = ?,
            delivery_date = '2026-11-25', received_by = 'Receiving pharmacist',
            supplier_name = 'Historical supplier', invoice_number = 'INV-HIST',
            received_event_id = 'delivery-event'
        WHERE delivery_id = 'received-delivery'
    `).run("2026-11-25T11:00:00.000Z");

    database.prepare(`
        INSERT INTO deliveries (
            delivery_id, status, created_at, updated_at, delivery_date,
            received_by, supplier_name, invoice_number
        ) VALUES ('active-delivery-draft', 'draft', ?, ?, NULL, NULL, NULL, NULL)
    `).run(occurredAt, occurredAt);
    database.prepare(`
        INSERT INTO delivery_items (
            delivery_id, delivery_item_id, item_position, product_id,
            variant_id, packaging_level_id, quantity, batch_number,
            expiry_date, cost_price_minor_units, selling_price_minor_units,
            received_batch_id, receipt_snapshot_json
        ) VALUES ('active-delivery-draft', 'active-delivery-item', 0,
            'current-product', 'current-variant', 'current-pack', 3,
            NULL, NULL, NULL, NULL, NULL, NULL)
    `).run();
}

function sqliteValue(value: unknown): SqliteQueryValue {
    if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number"
    ) {
        return value;
    }
    throw new Error("Application data fixture received an unsupported SQLite value.");
}

const baseRepositories: ApplicationDataRepositories = {
    getAllProducts,
    getAllInventory,
    getAllActivityEvents,
    getAllSales,
    getAllReceivedDeliveries,
    getAllActiveSaleDrafts,
    getAllActiveDeliveryDrafts
};

function repositoriesWithFailure(
    failedName: keyof ApplicationDataRepositories,
    calls: string[]
): ApplicationDataRepositories {
    function wrap<T>(
        name: keyof ApplicationDataRepositories,
        read: (query: SqliteQueryExecutor) => Promise<T>
    ): (query: SqliteQueryExecutor) => Promise<T> {
        return async (query) => {
            calls.push(name);
            if (name === failedName) {
                throw new Error(`synthetic ${name} failure`);
            }
            return read(query);
        };
    }
    return {
        getAllProducts: wrap("getAllProducts", baseRepositories.getAllProducts),
        getAllInventory: wrap("getAllInventory", baseRepositories.getAllInventory),
        getAllActivityEvents: wrap(
            "getAllActivityEvents",
            baseRepositories.getAllActivityEvents
        ),
        getAllSales: wrap("getAllSales", baseRepositories.getAllSales),
        getAllReceivedDeliveries: wrap(
            "getAllReceivedDeliveries",
            baseRepositories.getAllReceivedDeliveries
        ),
        getAllActiveSaleDrafts: wrap(
            "getAllActiveSaleDrafts",
            baseRepositories.getAllActiveSaleDrafts
        ),
        getAllActiveDeliveryDrafts: wrap(
            "getAllActiveDeliveryDrafts",
            baseRepositories.getAllActiveDeliveryDrafts
        )
    };
}

describe("read-only application data loader", () => {
    beforeEach(() => {
        database = new DatabaseSync(":memory:");
        database.exec("PRAGMA foreign_keys = ON");
        database.exec(migrationSql);
        database.exec(associationMigrationSql);
        querySqliteMock.mockReset();
        snapshotBatchMock.mockReset();
        snapshotBatchMock.mockImplementation(async (
            queries: readonly {
                readonly query: string;
                readonly parameters: readonly (string | number | boolean | null)[];
            }[]
        ) => {
            database.exec("BEGIN");
            try {
                const results = [];
                for (const { query, parameters } of queries) {
                    const statement = database.prepare(query.replace(/\$\d+/g, "?"));
                    const columns = statement.columns().map((column) => column.name);
                    const rows = statement.all(...parameters.map((parameter) =>
                        typeof parameter === "boolean" ? Number(parameter) : parameter
                    )).map((row) =>
                        columns.map((column) => sqliteValue(row[column]))
                    );
                    results.push({ columns, rows } satisfies SqliteQueryResult);
                }
                database.exec("COMMIT");
                return results;
            } catch (error) {
                database.exec("ROLLBACK");
                throw error;
            }
        });
        createSnapshotExecutorMock.mockReset();
        createSnapshotExecutorMock.mockImplementation(() => {
            const requests: {
                query: string;
                parameters: readonly (string | number | boolean | null)[];
                resolve: (result: SqliteQueryResult) => void;
                reject: (error: unknown) => void;
            }[] = [];
            return {
                query: (
                    query: string,
                    parameters: readonly (string | number | boolean | null)[] = []
                ) => new Promise<SqliteQueryResult>((resolve, reject) => {
                    requests.push({ query, parameters, resolve, reject });
                }),
                execute: async () => {
                    if (requests.length === 0) {
                        return;
                    }
                    try {
                        const results = await snapshotBatchMock(requests.map(
                            ({ query, parameters }) => ({ query, parameters })
                        )) as SqliteQueryResult[];
                        if (results.length !== requests.length) {
                            throw new Error("Unexpected in-memory snapshot result count.");
                        }
                        requests.forEach(({ resolve }, index) => {
                            const result = results[index];
                            if (result !== undefined) {
                                resolve(result);
                            }
                        });
                    } catch (error) {
                        requests.forEach(({ reject }) => reject(error));
                    }
                }
            };
        });
        querySqliteMock.mockImplementation(async (
            query: string,
            parameters: readonly (string | number | null)[] = []
        ) => {
            const statement = database.prepare(query.replace(/\$\d+/g, "?"));
            const columns = statement.columns().map((column) => column.name);
            const rows = statement.all(...parameters).map((row) =>
                columns.map((column) => sqliteValue(row[column]))
            );
            return { columns, rows } satisfies SqliteQueryResult;
        });
    });

    afterEach(() => {
        database.close();
    });

    it("assembles all eight collections and keeps historical and active records distinct", async () => {
        seedCurrentCatalogAndInventory();
        for (const event of activityEvents()) {
            insertActivity(event);
        }
        insertCompletedSale();
        insertActiveAndCancelledSaleDrafts();
        insertReceivedAndActiveDeliveryDrafts();

        const result = await loadApplicationData();

        expect(result.products).toHaveLength(1);
        expect(result.products[0]).toMatchObject({
            id: "current-product",
            name: "Current catalog name"
        });
        expect(result.inventoryRecords).toEqual([
            {
                id: "current-inventory",
                productId: "current-product",
                variantId: "current-variant",
                batchId: "current-batch",
                stockQuantities: [{
                    packagingLevelId: "current-pack",
                    quantity: 10
                }]
            },
            {
                id: "retired-inventory",
                productId: "current-product",
                variantId: "current-variant",
                batchId: "retired-batch",
                stockQuantities: [{
                    packagingLevelId: "current-pack",
                    quantity: 14
                }]
            }
        ]);
        expect(result.inventoryBatches[0]?.batchId).toBe("current-batch");
        expect(result.activityEvents.map((event) => event.type)).toEqual([
            "delivery.received",
            "sale.completed"
        ]);
        expect(result.completedSales).toHaveLength(1);
        expect(result.completedSales[0]?.domain).toMatchObject({
            saleId: "completed-sale",
            items: [{
                product: { productName: "Historical medicine" },
                variant: { variantName: "Historical tablets" },
                batch: { batchId: "retired-batch" },
                packagingLevel: { name: "Historical carton" },
                inventoryRecordId: "retired-inventory"
            }]
        });
        expect(result.completedSales[0]?.persistence.sourceDraftId)
            .toBe("completed-source-draft");
        expect(result.completedSales[0]?.persistence.completedEventId)
            .toBe("sale-event");
        expect(result.receivedDeliveries).toHaveLength(1);
        expect(result.receivedDeliveries[0]?.domain).toMatchObject({
            status: "received",
            deliveryId: "received-delivery",
            items: [{
                productId: "current-product",
                variantId: "current-variant",
                packagingLevelId: "current-pack",
                quantity: 4
            }]
        });
        expect(result.receivedDeliveries[0]?.persistence.items[0])
            .toMatchObject({
                receivedBatchId: "retired-batch",
                receivedInventoryId: "retired-inventory",
                receiptSnapshot: {
                    productName: "Historical medicine",
                    packagingLevel: { name: "Historical carton" }
                }
            });
        expect(result.activeSaleDrafts).toHaveLength(1);
        expect(result.activeSaleDrafts[0]?.domain.draftId)
            .toBe("active-sale-draft");
        expect(result.activeSaleDrafts[0]?.persistence.items[0]?.lineId)
            .toBe("active-line");
        expect(result.activeDeliveryDrafts).toHaveLength(1);
        expect(result.activeDeliveryDrafts[0]?.domain).toBeNull();
        expect(result.activeDeliveryDrafts[0]?.persistence.deliveryDate)
            .toBeNull();
        expect(result.activeDeliveryDrafts[0]?.persistence.items[0]?.costPriceMinorUnits)
            .toBeNull();
        expect(result.activeSaleDrafts.some(
            ({ persistence }) => persistence.draftId === "cancelled-sale-draft"
        )).toBe(false);
        expect(createSnapshotExecutorMock).toHaveBeenCalledOnce();
        expect(snapshotBatchMock).toHaveBeenCalledOnce();
        const [snapshotQueries] = snapshotBatchMock.mock.calls[0] as [
            readonly { query: string; parameters: readonly unknown[] }[]
        ];
        expect(snapshotQueries).toHaveLength(7);
        expect(snapshotQueries.every(
            ({ query }) => /^\s*SELECT\b/i.test(query)
        )).toBe(true);
        expect(querySqliteMock).not.toHaveBeenCalled();
    });

    it("accepts an empty database without injecting demo data", async () => {
        const result = await loadApplicationData();
        expect(result).toEqual({
            products: [],
            inventoryRecords: [],
            inventoryBatches: [],
            activityEvents: [],
            completedSales: [],
            receivedDeliveries: [],
            activeSaleDrafts: [],
            activeDeliveryDrafts: [],
            persistenceLimitations: [
                "Product and Inventory repositories return domain values only; original SQL NULL distinctions and numeric position values are not available after those repository projections.",
                "Sales and received-Delivery repositories preserve relative ordering but do not expose their numeric header positions in their DTOs."
            ]
        });
    });

    it("preserves persistence DTOs when an active Delivery draft cannot be projected", async () => {
        seedCurrentCatalogAndInventory();
        database.prepare(`
            INSERT INTO deliveries (
                delivery_id, status, created_at, updated_at, delivery_date,
                received_by, supplier_name, invoice_number
            ) VALUES ('nullable-delivery', 'draft', ?, ?, NULL, NULL, NULL, NULL)
        `).run(occurredAt, occurredAt);
        database.prepare(`
            INSERT INTO delivery_items (
                delivery_id, delivery_item_id, item_position, product_id,
                variant_id, packaging_level_id, quantity, batch_number,
                expiry_date, cost_price_minor_units, selling_price_minor_units
            ) VALUES ('nullable-delivery', 'nullable-item', 0,
                'current-product', 'current-variant', 'current-pack', 1,
                NULL, NULL, NULL, NULL)
        `).run();

        const result = await loadApplicationData();
        const projection = result.activeDeliveryDrafts[0];
        expect(projection?.domain).toBeNull();
        if (!projection || projection.domain !== null) {
            throw new Error("Expected an incompatible Delivery draft projection.");
        }
        expect(projection?.persistence.deliveryId).toBe("nullable-delivery");
        expect(projection?.persistence.items[0]?.deliveryItemId)
            .toBe("nullable-item");
        expect(projection?.incompatibleFields).toEqual([
            "deliveryDate",
            "receivedBy"
        ]);
    });

    it.each([
        { failedName: "getAllProducts", label: "Product" },
        { failedName: "getAllInventory", label: "Inventory" },
        { failedName: "getAllActiveSaleDrafts", label: "active Sales draft" },
        {
            failedName: "getAllActiveDeliveryDrafts",
            label: "active Receive Delivery draft"
        },
        { failedName: "getAllSales", label: "completed Sales" },
        {
            failedName: "getAllReceivedDeliveries",
            label: "received Deliveries"
        },
        { failedName: "getAllActivityEvents", label: "Activity" }
    ] as const)(
        "fails clearly when $label rejects without returning partial data",
        async ({ failedName, label }) => {
            const calls: string[] = [];
            await expect(loadApplicationData(
                repositoriesWithFailure(failedName, calls)
            )).rejects.toThrow(`${label} repository read failed`);
            expect(calls).toEqual([
                "getAllProducts",
                "getAllInventory",
                "getAllActiveSaleDrafts",
                "getAllActiveDeliveryDrafts",
                "getAllSales",
                "getAllReceivedDeliveries",
                "getAllActivityEvents"
            ]);
        }
    );

    it("fails when the production Activity parser rejects persisted payload data", async () => {
        const event = activityEvents()[0]!;
        const serialized = serializeActivityEvent(event);
        database.prepare(`
            INSERT INTO activity_events (
                event_id, operation_key, event_type, occurred_at, actor_id, event_json
            ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            serialized.eventId,
            serialized.operationKey,
            serialized.eventType,
            serialized.occurredAt,
            serialized.actorId,
            JSON.stringify({ ...event, eventId: "mismatched-event-id" })
        );

        await expect(loadApplicationData()).rejects.toThrow(
            "Activity repository read failed"
        );
    });
});
