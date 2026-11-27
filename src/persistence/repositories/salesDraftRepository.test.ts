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
const { getAllActiveSaleDrafts } = await import("./salesDraftRepository");

let database: DatabaseSync;

const productId = "product-1";
const variantId = "variant-1";
const packagingLevelId = "pack-1";
const inventoryRecordId = "inventory-1";
const batchId = "batch-1";
const batchInventoryId = "inventory-batch-1";

function seedCurrentInventory(): void {
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
        INSERT INTO batches (
            batch_id, product_id, variant_id, batch_position, batch_number,
            expiry_date
        ) VALUES (?, ?, ?, 0, 'LOT-1', '2028-04-30')
    `).run(batchId, productId, variantId);
    database.prepare(`
        INSERT INTO inventory_records (
            inventory_id, product_id, variant_id, inventory_position, batch_id
        ) VALUES (?, ?, ?, 0, NULL), (?, ?, ?, 1, ?)
    `).run(
        inventoryRecordId,
        productId,
        variantId,
        batchInventoryId,
        productId,
        variantId,
        batchId
    );
    database.prepare(`
        INSERT INTO inventory_stock (
            inventory_id, product_id, variant_id, packaging_level_id,
            stock_position, quantity
        ) VALUES (?, ?, ?, ?, 0, 17), (?, ?, ?, ?, 0, 9)
    `).run(
        inventoryRecordId,
        productId,
        variantId,
        packagingLevelId,
        batchInventoryId,
        productId,
        variantId,
        packagingLevelId
    );
}

interface SaleDraftItemFixture {
    lineId: string;
    itemPosition: number;
    batchId?: string | null;
    inventoryRecordId?: string;
    productId?: string;
    variantId?: string;
    packagingLevelId?: string;
    quantity?: number;
    defaultSellingPriceMinorUnits?: number | null;
    appliedSellingPriceMinorUnits?: number;
    discountMinorUnits?: number;
}

interface SaleDraftFixture {
    draftId: string;
    createdAt?: string;
    customerName?: string | null;
    customerAddress?: string | null;
    saleDate?: string | null;
    staffUserId?: string | null;
    staffDisplayName?: string | null;
    notes?: string | null;
    items?: SaleDraftItemFixture[];
}

function insertSaleDraft(fixture: SaleDraftFixture): void {
    const createdAt = fixture.createdAt ?? "2026-11-25T09:00:00.000Z";
    database.prepare(`
        INSERT INTO sale_drafts (
            draft_id, status, created_at, updated_at, customer_name,
            customer_address, sale_date, staff_user_id, staff_display_name,
            notes
        ) VALUES (?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        fixture.draftId,
        createdAt,
        createdAt,
        fixture.customerName ?? null,
        fixture.customerAddress ?? null,
        fixture.saleDate ?? null,
        fixture.staffUserId ?? null,
        fixture.staffDisplayName ?? null,
        fixture.notes ?? null
    );

    for (const item of fixture.items ?? []) {
        database.prepare(`
            INSERT INTO sale_draft_items (
                draft_id, line_id, item_position, product_id, variant_id,
                inventory_record_id, batch_id, packaging_level_id, quantity,
                default_selling_price_minor_units,
                applied_selling_price_minor_units, discount_minor_units
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            fixture.draftId,
            item.lineId,
            item.itemPosition,
            item.productId ?? productId,
            item.variantId ?? variantId,
            item.inventoryRecordId ?? inventoryRecordId,
            item.batchId ?? null,
            item.packagingLevelId ?? packagingLevelId,
            item.quantity ?? 1,
            item.defaultSellingPriceMinorUnits === undefined
                ? 500
                : item.defaultSellingPriceMinorUnits,
            item.appliedSellingPriceMinorUnits ?? 450,
            item.discountMinorUnits ?? 0
        );
    }
}

function insertApprovedSale(): void {
    insertSaleDraft({
        draftId: "approved-draft",
        items: [{ lineId: "approved-line", itemPosition: 0 }]
    });
    database.prepare(`
        INSERT INTO activity_events (
            event_id, operation_key, event_type, occurred_at, event_json
        ) VALUES (
            'approved-event', 'sale.completed:approved-sale',
            'sale.completed', '2026-11-25T10:00:00.000Z', '{"saleId":"approved-sale"}'
        )
    `).run();
    database.prepare(`
        INSERT INTO sales (
            sale_id, source_draft_id, completed_event_id, completed_at,
            subtotal_minor_units, discount_minor_units, final_minor_units,
            expired_batch_confirmed
        ) VALUES (
            'approved-sale', 'approved-draft', 'approved-event',
            '2026-11-25T10:00:00.000Z', 450, 0, 450, 0
        )
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
    throw new Error("Sales draft test received an unsupported SQLite value.");
}

function readOnlyState(): string {
    return JSON.stringify({
        drafts: database.prepare(
            "SELECT draft_id, status FROM sale_drafts ORDER BY draft_position"
        ).all(),
        items: database.prepare(
            "SELECT draft_id, line_id FROM sale_draft_items ORDER BY draft_id, item_position"
        ).all(),
        stock: database.prepare(
            "SELECT inventory_id, packaging_level_id, quantity FROM inventory_stock ORDER BY inventory_id"
        ).all()
    });
}

describe("Sales draft read repository", () => {
    beforeEach(() => {
        database = new DatabaseSync(":memory:");
        database.exec("PRAGMA foreign_keys = ON");
        database.exec(migrationSql);
        seedCurrentInventory();
        querySqliteMock.mockReset();
        querySqliteMock.mockImplementation(async (
            query: string,
            parameters: SqliteQueryValue[] = []
        ) => {
            const status = parameters[0];
            if (typeof status !== "string") {
                throw new Error("Sales draft query test requires a string status.");
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
        await expect(getAllActiveSaleDrafts()).resolves.toEqual([]);
    });

    it("restores multiple active drafts, ordered items, nullable metadata and empty drafts", async () => {
        insertSaleDraft({
            draftId: "draft-later",
            createdAt: "2026-11-25T10:00:00.000Z",
            customerName: "  Customer  ",
            customerAddress: null,
            saleDate: "2026-11-25",
            staffUserId: "staff-1",
            staffDisplayName: "Pharmacist",
            notes: "  Leave as stored  ",
            items: [
                {
                    lineId: "line-later",
                    itemPosition: 1,
                    batchId,
                    inventoryRecordId: batchInventoryId,
                    quantity: 3,
                    defaultSellingPriceMinorUnits: null,
                    appliedSellingPriceMinorUnits: 875,
                    discountMinorUnits: 25
                },
                {
                    lineId: "line-first",
                    itemPosition: 0,
                    quantity: 2,
                    defaultSellingPriceMinorUnits: 500,
                    appliedSellingPriceMinorUnits: 475,
                    discountMinorUnits: 0
                }
            ]
        });
        insertSaleDraft({
            draftId: "empty-draft",
            customerName: null,
            customerAddress: null,
            saleDate: null,
            staffUserId: null,
            staffDisplayName: null,
            notes: null,
            items: []
        });

        const drafts = await getAllActiveSaleDrafts();

        expect(drafts.map((draft) => draft.draftId)).toEqual([
            "draft-later",
            "empty-draft"
        ]);
        expect(drafts[0]).toMatchObject({
            status: "draft",
            customerName: "  Customer  ",
            customerAddress: null,
            saleDate: "2026-11-25",
            staffUserId: "staff-1",
            staffDisplayName: "Pharmacist",
            notes: "  Leave as stored  ",
            approvedSaleId: null
        });
        expect(drafts[0]?.items.map((item) => item.lineId)).toEqual([
            "line-first",
            "line-later"
        ]);
        expect(drafts[0]?.items[1]).toEqual({
            lineId: "line-later",
            itemPosition: 1,
            productId,
            variantId,
            inventoryRecordId: batchInventoryId,
            batchId,
            packagingLevelId,
            quantity: 3,
            defaultSellingPriceMinorUnits: null,
            appliedSellingPriceMinorUnits: 875,
            discountMinorUnits: 25
        });
        expect(drafts[1]?.items).toEqual([]);
        expect(querySqliteMock).toHaveBeenCalledOnce();
        expect(querySqliteMock.mock.calls[0]?.[1]).toEqual(["draft"]);
        expect(querySqliteMock.mock.calls[0]?.[0]).not.toMatch(
            /\bJOIN\s+(?:products|variants|packaging_levels|inventory_records|batches)\b/i
        );
    });

    it("excludes cancelled and approved drafts without changing draft or stock data", async () => {
        insertSaleDraft({
            draftId: "active",
            items: [{ lineId: "active-line", itemPosition: 0 }]
        });
        insertSaleDraft({
            draftId: "cancelled",
            items: [{ lineId: "cancelled-line", itemPosition: 0 }]
        });
        database.prepare(`
            UPDATE sale_drafts SET status = 'cancelled'
            WHERE draft_id = 'cancelled'
        `).run();
        insertApprovedSale();
        const before = readOnlyState();

        const drafts = await getAllActiveSaleDrafts();

        expect(drafts.map((draft) => draft.draftId)).toEqual(["active"]);
        expect(readOnlyState()).toBe(before);
    });

    it("rejects unsafe persisted values rather than coercing them", async () => {
        insertSaleDraft({
            draftId: "invalid-quantity",
            items: [{ lineId: "invalid-line", itemPosition: 0 }]
        });
        database.exec("PRAGMA ignore_check_constraints = ON");
        database.prepare(`
            UPDATE sale_draft_items SET quantity = 1.5
            WHERE draft_id = 'invalid-quantity'
        `).run();

        await expect(getAllActiveSaleDrafts()).rejects.toThrow(
            "invalid quantity"
        );
    });
});
