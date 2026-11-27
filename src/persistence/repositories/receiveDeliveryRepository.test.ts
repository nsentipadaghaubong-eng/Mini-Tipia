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
const associationMigrationSql = readFileSync(
    new URL(
        "../../../src-tauri/src/migrations/migration_002_delivery_inventory_association.sql",
        import.meta.url
    ),
    "utf8"
);
const { getAllReceivedDeliveries } = await import("./receiveDeliveryRepository");

let database: DatabaseSync;

const productId = "current-product";
const variantId = "current-variant";
const packagingLevelId = "current-packaging";

function seedCurrentCatalog(): void {
    database.prepare(`
        INSERT INTO products (product_id, product_position, name)
        VALUES (?, 0, ?)
    `).run(productId, "Current catalog product");
    database.prepare(`
        INSERT INTO variants (
            variant_id, product_id, variant_position, variant_name
        ) VALUES (?, ?, 0, ?)
    `).run(variantId, productId, "Current catalog variant");
    database.prepare(`
        INSERT INTO packaging_levels (
            packaging_level_id, product_id, variant_id, packaging_position, name
        ) VALUES (?, ?, ?, 0, ?)
    `).run(packagingLevelId, productId, variantId, "Current catalog pack");
}

interface DeliveryItemFixture {
    deliveryItemId: string;
    itemPosition: number;
    productId?: string;
    variantId?: string;
    packagingLevelId?: string;
    quantity?: number;
    batchNumber?: string | null;
    expiryDate?: string | null;
    costPriceMinorUnits?: number | null;
    sellingPriceMinorUnits?: number | null;
    receivedBatchId?: string | null;
    receivedInventoryId?: string | null;
    receiptSnapshotJson?: string | null;
}

function insertDraftDelivery(
    deliveryId: string,
    items: DeliveryItemFixture[],
    options: {
        createdAt?: string;
        seedInventoryAssociations?: boolean;
    } = {}
): void {
    const createdAt = options.createdAt ?? "2026-11-25T09:00:00.000Z";
    if (options.seedInventoryAssociations) {
        for (const item of items) {
            const batchId = item.receivedBatchId ??
                `received-batch-${item.deliveryItemId}`;
            const inventoryId = item.receivedInventoryId ??
                `received-inventory-${item.deliveryItemId}`;
            const itemProductId = item.productId ?? productId;
            const itemVariantId = item.variantId ?? variantId;
            const batchPosition = database.prepare(`
                SELECT COALESCE(MAX(batch_position), -1) + 1 AS position
                FROM batches WHERE product_id = ? AND variant_id = ?
            `).get(itemProductId, itemVariantId) as { position: number };
            database.prepare(`
                INSERT INTO batches (
                    batch_id, product_id, variant_id, batch_position,
                    batch_number, expiry_date, received_date
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
                batchId,
                itemProductId,
                itemVariantId,
                batchPosition.position,
                item.batchNumber ?? null,
                item.expiryDate ?? null,
                "2026-11-25"
            );
            const inventoryPosition = database.prepare(`
                SELECT COALESCE(MAX(inventory_position), -1) + 1 AS position
                FROM inventory_records WHERE product_id = ? AND variant_id = ?
            `).get(itemProductId, itemVariantId) as { position: number };
            database.prepare(`
                INSERT INTO inventory_records (
                    inventory_id, product_id, variant_id, inventory_position, batch_id
                ) VALUES (?, ?, ?, ?, ?)
            `).run(
                inventoryId,
                itemProductId,
                itemVariantId,
                inventoryPosition.position,
                batchId
            );
            database.prepare(`
                INSERT INTO inventory_stock (
                    inventory_id, product_id, variant_id, packaging_level_id,
                    stock_position, quantity
                ) VALUES (?, ?, ?, ?, 0, ?)
            `).run(
                inventoryId,
                itemProductId,
                itemVariantId,
                item.packagingLevelId ?? packagingLevelId,
                item.quantity ?? 1
            );
            item.receivedBatchId = batchId;
            item.receivedInventoryId = inventoryId;
        }
    }

    database.prepare(`
        INSERT INTO deliveries (
            delivery_id, status, created_at, updated_at, delivery_date,
            received_by, supplier_name, invoice_number
        ) VALUES (?, 'draft', ?, ?, NULL, NULL, NULL, NULL)
    `).run(deliveryId, createdAt, createdAt);

    for (const item of items) {
        database.prepare(`
            INSERT INTO delivery_items (
                delivery_id, delivery_item_id, item_position, product_id,
                variant_id, packaging_level_id, quantity, batch_number,
                expiry_date, cost_price_minor_units, selling_price_minor_units,
                received_batch_id, received_inventory_id, receipt_snapshot_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            deliveryId,
            item.deliveryItemId,
            item.itemPosition,
            item.productId ?? productId,
            item.variantId ?? variantId,
            item.packagingLevelId ?? packagingLevelId,
            item.quantity ?? 1,
            item.batchNumber ?? null,
            item.expiryDate ?? null,
            item.costPriceMinorUnits ?? null,
            item.sellingPriceMinorUnits ?? null,
            item.receivedBatchId ?? null,
            item.receivedInventoryId ?? null,
            item.receiptSnapshotJson ?? null
        );
    }
}

function receiveDelivery(
    deliveryId: string,
    options: {
        updatedAt?: string;
        deliveryDate?: string;
        receivedBy?: string;
        supplierName?: string | null;
        invoiceNumber?: string | null;
        receivedEventId?: string;
    } = {}
): void {
    const updatedAt = options.updatedAt ?? "2026-11-25T10:00:00.000Z";
    const receivedEventId = options.receivedEventId ?? `event-${deliveryId}`;
    database.prepare(`
        INSERT INTO activity_events (
            event_id, operation_key, event_type, occurred_at, event_json
        ) VALUES (?, ?, 'delivery.received', ?, ?)
    `).run(
        receivedEventId,
        `delivery.received:${deliveryId}`,
        updatedAt,
        JSON.stringify({ deliveryId })
    );
    database.prepare(`
        UPDATE delivery_items
        SET receipt_snapshot_json = COALESCE(receipt_snapshot_json, ?)
        WHERE delivery_id = ?
    `).run(JSON.stringify({
                productName: "Historical product name",
                variantName: "Historical variant name",
                packagingName: "Historical pack name",
                batchNumber: "HIST-LOT"
            }), deliveryId);
    database.prepare(`
        UPDATE deliveries
        SET status = 'received',
            updated_at = ?,
            delivery_date = ?,
            received_by = ?,
            supplier_name = ?,
            invoice_number = ?,
            received_event_id = ?
        WHERE delivery_id = ?
    `).run(
        updatedAt,
        options.deliveryDate ?? "2026-11-25",
        options.receivedBy ?? "Receiving pharmacist",
        options.supplierName ?? null,
        options.invoiceNumber ?? null,
        receivedEventId,
        deliveryId
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
    throw new Error(
        "Receive Delivery repository test received an unsupported SQLite value."
    );
}

describe("Receive Delivery read repository", () => {
    beforeEach(() => {
        database = new DatabaseSync(":memory:");
        database.exec("PRAGMA foreign_keys = ON");
        database.exec(migrationSql);
        database.exec(associationMigrationSql);
        seedCurrentCatalog();
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

    it("returns no rows when there are no received deliveries", async () => {
        await expect(getAllReceivedDeliveries()).resolves.toEqual([]);
    });

    it("maps received deliveries, opaque snapshots and ordered items without live-data joins", async () => {
        insertDraftDelivery("delivery-old", [{
            deliveryItemId: "old-item",
            itemPosition: 0
        }], { seedInventoryAssociations: true });
        receiveDelivery("delivery-old", {
            updatedAt: "2026-11-24T10:00:00.000Z"
        });

        insertDraftDelivery("delivery-new", [
            {
                deliveryItemId: "item-later",
                itemPosition: 1,
                batchNumber: "LOT-B",
                expiryDate: "2028-04-30",
                costPriceMinorUnits: 225,
                sellingPriceMinorUnits: 350
            },
            {
                deliveryItemId: "item-first",
                itemPosition: 0,
                batchNumber: null,
                expiryDate: null,
                costPriceMinorUnits: null,
                sellingPriceMinorUnits: 1250,
                receiptSnapshotJson: JSON.stringify({
                    productName: "Historical first product",
                    variantName: "Historical strength",
                    packaging: { name: "Historical carton" },
                    receivedBatch: {
                        batchNumber: null,
                        expiryDate: null,
                        receivedBatchId: "historical-received-batch"
                    }
                })
            }
        ], { seedInventoryAssociations: true });
        receiveDelivery("delivery-new", {
            updatedAt: "2026-11-25T12:00:00.000Z",
            deliveryDate: "2026-11-25",
            receivedBy: "Pharmacist One",
            supplierName: "Supplier Ltd",
            invoiceNumber: "INV-25"
        });

        const deliveries = await getAllReceivedDeliveries();

        expect(deliveries.map((delivery) => delivery.deliveryId)).toEqual([
            "delivery-new",
            "delivery-old"
        ]);
        expect(deliveries[0]).toMatchObject({
            status: "received",
            createdAt: "2026-11-25T09:00:00.000Z",
            updatedAt: "2026-11-25T12:00:00.000Z",
            receivedAt: "2026-11-25T12:00:00.000Z",
            deliveryDate: "2026-11-25",
            receivedBy: "Pharmacist One",
            supplierName: "Supplier Ltd",
            invoiceNumber: "INV-25",
            receivedEventId: "event-delivery-new"
        });
        expect(deliveries[0]?.items.map((item) => item.deliveryItemId)).toEqual([
            "item-first",
            "item-later"
        ]);
        expect(deliveries[0]?.items[0]).toMatchObject({
            itemPosition: 0,
            productId,
            variantId,
            packagingLevelId,
            quantity: 1,
            batchNumber: null,
            expiryDate: null,
            costPrice: null,
            sellingPrice: 12.5,
            receivedBatchId: "received-batch-item-first",
            receivedInventoryId: "received-inventory-item-first",
            receiptSnapshot: {
                productName: "Historical first product",
                variantName: "Historical strength",
                packaging: { name: "Historical carton" },
                receivedBatch: {
                    batchNumber: null,
                    expiryDate: null,
                    receivedBatchId: "historical-received-batch"
                }
            }
        });
        expect(deliveries[0]?.items[0]?.receiptSnapshotJson).toContain(
            "Historical first product"
        );
        expect(deliveries[0]?.items[1]).toMatchObject({
            deliveryItemId: "item-later",
            batchNumber: "LOT-B",
            expiryDate: "2028-04-30",
            costPrice: 2.25,
            sellingPrice: 3.5,
            receivedBatchId: "received-batch-item-later",
            receivedInventoryId: "received-inventory-item-later"
        });
        expect(deliveries[0]?.items[1]?.receiptSnapshot).toMatchObject({
            productName: "Historical product name",
            packagingName: "Historical pack name"
        });
        expect(deliveries[1]).toMatchObject({
            supplierName: null,
            invoiceNumber: null,
            items: [{
                batchNumber: null,
                expiryDate: null,
                costPrice: null,
                sellingPrice: null
            }]
        });
        expect(database.prepare(
            "SELECT name FROM products WHERE product_id = ?"
        ).get(productId)).toEqual({ name: "Current catalog product" });
        expect(querySqliteMock).toHaveBeenCalledOnce();
        expect(querySqliteMock.mock.calls[0]?.[0]).toContain(
            "WHERE delivery.status = 'received'"
        );
        expect(querySqliteMock.mock.calls[0]?.[0]).not.toMatch(
            /\bJOIN\s+(?:products|variants|packaging_levels|inventory_records|batches)\b/i
        );
    });

    it("excludes unfinished and cancelled delivery drafts", async () => {
        insertDraftDelivery("delivery-unfinished", [{
            deliveryItemId: "unfinished-item",
            itemPosition: 0
        }]);
        insertDraftDelivery("delivery-cancelled", [{
            deliveryItemId: "cancelled-item",
            itemPosition: 0
        }]);
        database.prepare(`
            INSERT INTO activity_events (
                event_id, operation_key, event_type, occurred_at, event_json
            ) VALUES (?, ?, 'delivery.draft_cancelled', ?, ?)
        `).run(
            "cancel-event",
            "delivery.draft_cancelled:delivery-cancelled",
            "2026-11-25T11:00:00.000Z",
            JSON.stringify({ deliveryId: "delivery-cancelled" })
        );
        database.prepare(`
            DELETE FROM deliveries WHERE delivery_id = 'delivery-cancelled'
        `).run();

        await expect(getAllReceivedDeliveries()).resolves.toEqual([]);
        expect(database.prepare(
            "SELECT status FROM deliveries WHERE delivery_id = 'delivery-unfinished'"
        ).get()).toEqual({ status: "draft" });
        expect(database.prepare(
            "SELECT COUNT(*) AS count FROM activity_events WHERE event_id = 'cancel-event'"
        ).get()).toEqual({ count: 1 });
    });

    it("rejects malformed receipt snapshot JSON", async () => {
        insertDraftDelivery("delivery-malformed", [{
            deliveryItemId: "malformed-item",
            itemPosition: 0,
            receiptSnapshotJson: "{invalid"
        }], { seedInventoryAssociations: true });
        receiveDelivery("delivery-malformed");

        await expect(getAllReceivedDeliveries()).rejects.toThrow(
            "invalid receipt snapshot JSON"
        );
    });

    it("rejects unsafe persisted minor-unit prices", async () => {
        insertDraftDelivery("delivery-unsafe-price", [{
            deliveryItemId: "unsafe-price-item",
            itemPosition: 0,
            costPriceMinorUnits: 1.5
        }], { seedInventoryAssociations: true });
        receiveDelivery("delivery-unsafe-price");

        await expect(getAllReceivedDeliveries()).rejects.toThrow(
            "invalid cost_price_minor_units"
        );
    });

    it("rejects an association to an Inventory record for a different batch", () => {
        insertDraftDelivery("delivery-valid-source", [{
            deliveryItemId: "valid-source-item",
            itemPosition: 0,
            batchNumber: "SOURCE-LOT",
            expiryDate: "2027-12-31"
        }], { seedInventoryAssociations: true });
        receiveDelivery("delivery-valid-source");
        insertDraftDelivery("delivery-invalid-association", [{
            deliveryItemId: "invalid-association-item",
            itemPosition: 0,
            batchNumber: "OTHER-LOT",
            expiryDate: "2028-12-31"
        }], { seedInventoryAssociations: true });
        database.prepare(`
            UPDATE delivery_items SET
                received_inventory_id = 'received-inventory-valid-source-item'
            WHERE delivery_id = 'delivery-invalid-association'
        `).run();
        expect(database.prepare(`
            SELECT item.received_batch_id, item.received_inventory_id,
                record.batch_id AS inventory_batch_id
            FROM delivery_items AS item
            JOIN inventory_records AS record
                ON record.inventory_id = item.received_inventory_id
            WHERE item.delivery_id = 'delivery-invalid-association'
        `).get()).toEqual({
            received_batch_id: "received-batch-invalid-association-item",
            received_inventory_id: "received-inventory-valid-source-item",
            inventory_batch_id: "received-batch-valid-source-item"
        });

        expect(() => receiveDelivery("delivery-invalid-association"))
            .toThrow("valid Inventory record association");
    });

    it("keeps the planned ID when a new batch and Inventory record are inserted after receipt", async () => {
        insertDraftDelivery("delivery-new-inventory-link", [{
            deliveryItemId: "new-inventory-item",
            itemPosition: 0,
            quantity: 2,
            batchNumber: "NEW-LOT",
            expiryDate: "2029-12-31",
            receivedBatchId: "new-batch",
            receivedInventoryId: "new-inventory"
        }]);
        receiveDelivery("delivery-new-inventory-link");

        database.prepare(`
            INSERT INTO batches (
                batch_id, product_id, variant_id, batch_position,
                batch_number, expiry_date, received_date
            ) VALUES ('new-batch', ?, ?, 0, 'NEW-LOT', '2029-12-31', '2026-11-25')
        `).run(productId, variantId);
        database.prepare(`
            INSERT INTO inventory_records (
                inventory_id, product_id, variant_id, inventory_position, batch_id
            ) VALUES ('new-inventory', ?, ?, 0, 'new-batch')
        `).run(productId, variantId);
        database.prepare(`
            INSERT INTO inventory_stock (
                inventory_id, product_id, variant_id, packaging_level_id,
                stock_position, quantity
            ) VALUES ('new-inventory', ?, ?, ?, 0, 2)
        `).run(productId, variantId, packagingLevelId);

        const deliveries = await getAllReceivedDeliveries();
        expect(deliveries[0]?.items[0]).toMatchObject({
            receivedBatchId: "new-batch",
            receivedInventoryId: "new-inventory"
        });
    });

    it("retains receipt-time IDs and snapshot values after stock changes and Product deletion", async () => {
        insertDraftDelivery("delivery-historical-link", [{
            deliveryItemId: "historical-link-item",
            itemPosition: 0,
            quantity: 3,
            batchNumber: "HIST-LOT",
            expiryDate: "2027-12-31",
            receiptSnapshotJson: JSON.stringify({
                quantity: 3,
                productName: "Historical product"
            })
        }], { seedInventoryAssociations: true });
        receiveDelivery("delivery-historical-link");

        const beforeStockChange = (await getAllReceivedDeliveries())[0]!;
        const itemBeforeStockChange = beforeStockChange.items[0]!;
        database.prepare(`
            UPDATE inventory_stock SET quantity = 99
            WHERE inventory_id = ?
        `).run(itemBeforeStockChange.receivedInventoryId);

        const afterStockChange = (await getAllReceivedDeliveries())[0]!;
        expect(afterStockChange.items[0]).toMatchObject({
            receivedBatchId: itemBeforeStockChange.receivedBatchId,
            receivedInventoryId: itemBeforeStockChange.receivedInventoryId,
            receiptSnapshot: { quantity: 3, productName: "Historical product" }
        });
        expect(database.prepare(`
            SELECT quantity FROM inventory_stock WHERE inventory_id = ?
        `).get(itemBeforeStockChange.receivedInventoryId)).toEqual({ quantity: 99 });

        database.prepare(`
            INSERT INTO activity_events (
                event_id, operation_key, event_type, occurred_at, event_json
            ) VALUES (
                'product-delete-event',
                'product.deleted:current-product:deletion-1',
                'product.deleted',
                '2026-11-25T12:00:00.000Z',
                '{}'
            )
        `).run();
        database.prepare("DELETE FROM inventory_records WHERE inventory_id = ?")
            .run(itemBeforeStockChange.receivedInventoryId);
        database.prepare("DELETE FROM batches WHERE batch_id = ?")
            .run(itemBeforeStockChange.receivedBatchId);
        database.prepare("DELETE FROM packaging_levels WHERE packaging_level_id = ?")
            .run(packagingLevelId);
        database.prepare("DELETE FROM variants WHERE variant_id = ?").run(variantId);
        database.prepare("DELETE FROM products WHERE product_id = ?").run(productId);

        const afterProductDeletion = (await getAllReceivedDeliveries())[0]!;
        expect(afterProductDeletion.items[0]).toMatchObject({
            productId,
            receivedBatchId: itemBeforeStockChange.receivedBatchId,
            receivedInventoryId: itemBeforeStockChange.receivedInventoryId,
            receiptSnapshot: { quantity: 3, productName: "Historical product" }
        });
        expect(database.prepare(
            "SELECT COUNT(*) AS count FROM products WHERE product_id = ?"
        ).get(productId)).toEqual({ count: 0 });
    });

    it("exposes a missing legacy Inventory association as null", async () => {
        insertDraftDelivery("delivery-legacy-association", [{
            deliveryItemId: "legacy-association-item",
            itemPosition: 0
        }], { seedInventoryAssociations: true });
        receiveDelivery("delivery-legacy-association");
        database.exec("DROP TRIGGER delivery_item_update_status");
        database.prepare(`
            UPDATE delivery_items SET received_inventory_id = NULL
            WHERE delivery_id = 'delivery-legacy-association'
        `).run();

        const deliveries = await getAllReceivedDeliveries();
        expect(deliveries[0]?.items[0]?.receivedInventoryId).toBeNull();
    });
});
