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
const { getAllActiveDeliveryDrafts } = await import(
    "./receiveDeliveryDraftRepository"
);

let database: DatabaseSync;

const productId = "product-1";
const variantId = "variant-1";
const packagingLevelId = "pack-1";

function seedCurrentCatalog(): void {
    database.prepare(`
        INSERT INTO products (product_id, product_position, name)
        VALUES (?, 0, 'Current product')
    `).run(productId);
    database.prepare(`
        INSERT INTO variants (
            variant_id, product_id, variant_position, variant_name
        ) VALUES (?, ?, 0, 'Current variant')
    `).run(variantId, productId);
    database.prepare(`
        INSERT INTO packaging_levels (
            packaging_level_id, product_id, variant_id, packaging_position, name
        ) VALUES (?, ?, ?, 0, 'Current pack')
    `).run(packagingLevelId, productId, variantId);
    database.prepare(`
        INSERT INTO inventory_records (
            inventory_id, product_id, variant_id, inventory_position, batch_id
        ) VALUES ('inventory-1', ?, ?, 0, NULL)
    `).run(productId, variantId);
    database.prepare(`
        INSERT INTO inventory_stock (
            inventory_id, product_id, variant_id, packaging_level_id,
            stock_position, quantity
        ) VALUES ('inventory-1', ?, ?, ?, 0, 17)
    `).run(productId, variantId, packagingLevelId);
}

interface DeliveryDraftItemFixture {
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
    receiptSnapshotJson?: string | null;
}

interface DeliveryDraftFixture {
    deliveryId: string;
    createdAt?: string;
    deliveryDate?: string | null;
    receivedBy?: string | null;
    supplierName?: string | null;
    invoiceNumber?: string | null;
    items?: DeliveryDraftItemFixture[];
}

function insertDeliveryDraft(fixture: DeliveryDraftFixture): void {
    const createdAt = fixture.createdAt ?? "2026-11-25T09:00:00.000Z";
    database.prepare(`
        INSERT INTO deliveries (
            delivery_id, status, created_at, updated_at, delivery_date,
            received_by, supplier_name, invoice_number
        ) VALUES (?, 'draft', ?, ?, ?, ?, ?, ?)
    `).run(
        fixture.deliveryId,
        createdAt,
        createdAt,
        fixture.deliveryDate ?? null,
        fixture.receivedBy ?? null,
        fixture.supplierName ?? null,
        fixture.invoiceNumber ?? null
    );

    for (const item of fixture.items ?? []) {
        database.prepare(`
            INSERT INTO delivery_items (
                delivery_id, delivery_item_id, item_position, product_id,
                variant_id, packaging_level_id, quantity, batch_number,
                expiry_date, cost_price_minor_units, selling_price_minor_units,
                received_batch_id, receipt_snapshot_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            fixture.deliveryId,
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
            item.receiptSnapshotJson ?? null
        );
    }
}

function receiveDelivery(deliveryId: string): void {
    const eventId = `received-event-${deliveryId}`;
    const receivedAt = "2026-11-25T10:00:00.000Z";
    database.prepare(`
        INSERT INTO activity_events (
            event_id, operation_key, event_type, occurred_at, event_json
        ) VALUES (?, ?, 'delivery.received', ?, ?)
    `).run(
        eventId,
        `delivery.received:${deliveryId}`,
        receivedAt,
        JSON.stringify({ deliveryId })
    );
    database.prepare(`
        UPDATE delivery_items
        SET received_batch_id = 'batch-' || delivery_item_id,
            receipt_snapshot_json = COALESCE(receipt_snapshot_json, ?)
        WHERE delivery_id = ?
    `).run('{"product":"historical"}', deliveryId);
    database.prepare(`
        UPDATE deliveries
        SET status = 'received',
            updated_at = ?,
            delivery_date = '2026-11-25',
            received_by = 'Receiving pharmacist',
            received_event_id = ?
        WHERE delivery_id = ?
    `).run(receivedAt, eventId, deliveryId);
}

function cancelDelivery(deliveryId: string): void {
    database.prepare(`
        INSERT INTO activity_events (
            event_id, operation_key, event_type, occurred_at, event_json
        ) VALUES (?, ?, 'delivery.draft_cancelled', ?, ?)
    `).run(
        `cancelled-event-${deliveryId}`,
        `delivery.draft_cancelled:${deliveryId}`,
        "2026-11-25T11:00:00.000Z",
        JSON.stringify({ deliveryId })
    );
    database.prepare(`
        DELETE FROM deliveries WHERE delivery_id = ?
    `).run(deliveryId);
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
        "Receive Delivery draft test received an unsupported SQLite value."
    );
}

function readOnlyState(): string {
    return JSON.stringify({
        deliveries: database.prepare(
            "SELECT delivery_id, status FROM deliveries ORDER BY delivery_position"
        ).all(),
        items: database.prepare(
            "SELECT delivery_id, delivery_item_id FROM delivery_items ORDER BY delivery_id, item_position"
        ).all(),
        stock: database.prepare(
            "SELECT inventory_id, packaging_level_id, quantity FROM inventory_stock"
        ).all(),
        activity: database.prepare(
            "SELECT event_id FROM activity_events ORDER BY event_sequence"
        ).all()
    });
}

describe("Receive Delivery draft read repository", () => {
    beforeEach(() => {
        database = new DatabaseSync(":memory:");
        database.exec("PRAGMA foreign_keys = ON");
        database.exec(migrationSql);
        seedCurrentCatalog();
        querySqliteMock.mockReset();
        querySqliteMock.mockImplementation(async (
            query: string,
            parameters: SqliteQueryValue[] = []
        ) => {
            const status = parameters[0];
            if (typeof status !== "string") {
                throw new Error(
                    "Receive Delivery draft query test requires a string status."
                );
            }
            const statement = database.prepare(query);
            const columns = statement.columns().map((column) => column.name);
            const rows = statement.all({ "$1": status }).map((row) =>
                columns.map((column) => sqliteValue(row[column]))
            );
            return { columns, rows } satisfies SqliteQueryResult;
        });
    });

    afterEach(() => {
        database.close();
    });

    it("returns an empty result when no active drafts exist", async () => {
        await expect(getAllActiveDeliveryDrafts()).resolves.toEqual([]);
    });

    it("restores active drafts and ordered item details without normalizing stored values", async () => {
        insertDeliveryDraft({
            deliveryId: "delivery-later",
            createdAt: "2026-11-25T10:00:00.000Z",
            deliveryDate: null,
            receivedBy: null,
            supplierName: "  Supplier  ",
            invoiceNumber: "  INV-25  ",
            items: [
                {
                    deliveryItemId: "item-later",
                    itemPosition: 1,
                    quantity: 3,
                    batchNumber: "LOT-B",
                    expiryDate: "2028-04-30",
                    costPriceMinorUnits: 225,
                    sellingPriceMinorUnits: 350,
                    receiptSnapshotJson: "{malformed but opaque"
                },
                {
                    deliveryItemId: "item-first",
                    itemPosition: 0,
                    quantity: 2,
                    batchNumber: null,
                    expiryDate: null,
                    costPriceMinorUnits: null,
                    sellingPriceMinorUnits: 1250
                }
            ]
        });
        insertDeliveryDraft({
            deliveryId: "empty-delivery",
            deliveryDate: null,
            receivedBy: null,
            supplierName: null,
            invoiceNumber: null,
            items: []
        });

        const drafts = await getAllActiveDeliveryDrafts();

        expect(drafts.map((draft) => draft.deliveryId)).toEqual([
            "delivery-later",
            "empty-delivery"
        ]);
        expect(drafts[0]).toMatchObject({
            status: "draft",
            deliveryDate: null,
            receivedBy: null,
            supplierName: "  Supplier  ",
            invoiceNumber: "  INV-25  ",
            receivedEventId: null
        });
        expect(drafts[0]?.items.map((item) => item.deliveryItemId)).toEqual([
            "item-first",
            "item-later"
        ]);
        expect(drafts[0]?.items[1]).toEqual({
            deliveryItemId: "item-later",
            itemPosition: 1,
            productId,
            variantId,
            packagingLevelId,
            quantity: 3,
            batchNumber: "LOT-B",
            expiryDate: "2028-04-30",
            costPriceMinorUnits: 225,
            sellingPriceMinorUnits: 350,
            receivedBatchId: null,
            receiptSnapshotJson: "{malformed but opaque"
        });
        expect(drafts[1]?.items).toEqual([]);
        expect(querySqliteMock).toHaveBeenCalledOnce();
        expect(querySqliteMock.mock.calls[0]?.[1]).toEqual(["draft"]);
        expect(querySqliteMock.mock.calls[0]?.[0]).not.toMatch(
            /\bJOIN\s+(?:products|variants|packaging_levels|inventory_records|batches)\b/i
        );
    });

    it("excludes received and cancelled deliveries without changing inventory or Activity", async () => {
        insertDeliveryDraft({
            deliveryId: "active",
            items: [{ deliveryItemId: "active-item", itemPosition: 0 }]
        });
        insertDeliveryDraft({
            deliveryId: "received",
            items: [{
                deliveryItemId: "received-item",
                itemPosition: 0,
                receiptSnapshotJson: '{"history":"kept"}'
            }]
        });
        receiveDelivery("received");
        insertDeliveryDraft({
            deliveryId: "cancelled",
            items: [{ deliveryItemId: "cancelled-item", itemPosition: 0 }]
        });
        cancelDelivery("cancelled");
        const before = readOnlyState();

        const drafts = await getAllActiveDeliveryDrafts();

        expect(drafts.map((draft) => draft.deliveryId)).toEqual(["active"]);
        expect(readOnlyState()).toBe(before);
    });

    it("rejects unsafe persisted quantities rather than silently coercing them", async () => {
        insertDeliveryDraft({
            deliveryId: "invalid-quantity",
            items: [{ deliveryItemId: "invalid-item", itemPosition: 0 }]
        });
        database.exec("PRAGMA ignore_check_constraints = ON");
        database.prepare(`
            UPDATE delivery_items SET quantity = 1.5
            WHERE delivery_id = 'invalid-quantity'
        `).run();

        await expect(getAllActiveDeliveryDrafts()).rejects.toThrow(
            "invalid quantity"
        );
    });
});
