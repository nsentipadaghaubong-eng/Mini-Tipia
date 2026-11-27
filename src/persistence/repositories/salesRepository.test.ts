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
const { getAllSales } = await import("./salesRepository");

let database: DatabaseSync;

const currentProductId = "current-product";
const currentVariantId = "current-variant";
const currentInventoryId = "current-inventory";
const currentPackagingId = "current-packaging";

function seedCurrentInventoryReferences(): void {
    database.prepare(`
        INSERT INTO products (product_id, product_position, name)
        VALUES (?, 0, ?)
    `).run(currentProductId, "Current catalog name");
    database.prepare(`
        INSERT INTO variants (
            variant_id, product_id, variant_position, variant_name
        ) VALUES (?, ?, 0, ?)
    `).run(currentVariantId, currentProductId, "Current variant name");
    database.prepare(`
        INSERT INTO packaging_levels (
            packaging_level_id, product_id, variant_id, packaging_position, name
        ) VALUES (?, ?, ?, 0, ?)
    `).run(currentPackagingId, currentProductId, currentVariantId, "Current box");
    database.prepare(`
        INSERT INTO inventory_records (
            inventory_id, product_id, variant_id, inventory_position, batch_id
        ) VALUES (?, ?, ?, 0, NULL)
    `).run(currentInventoryId, currentProductId, currentVariantId);
}

function insertDraft(draftId: string, createdAt = "2026-11-25T09:00:00.000Z"): void {
    database.prepare(`
        INSERT INTO sale_drafts (
            draft_id, status, created_at, updated_at
        ) VALUES (?, 'draft', ?, ?)
    `).run(draftId, createdAt, createdAt);
    database.prepare(`
        INSERT INTO sale_draft_items (
            draft_id, line_id, item_position, product_id, variant_id,
            inventory_record_id, batch_id, packaging_level_id, quantity,
            default_selling_price_minor_units,
            applied_selling_price_minor_units, discount_minor_units
        ) VALUES (?, ?, 0, ?, ?, ?, NULL, ?, 1, 500, 450, 0)
    `).run(
        draftId,
        `draft-line-${draftId}`,
        currentProductId,
        currentVariantId,
        currentInventoryId,
        currentPackagingId
    );
}

interface SaleItemRow {
    lineId: string;
    itemPosition: number;
    inventoryRecordId?: string;
    productId?: string;
    variantId?: string;
    batchId?: string | null;
    packagingLevelId?: string;
    quantity?: number;
    defaultSellingPriceMinorUnits?: number | null;
    appliedSellingPriceMinorUnits?: number;
    subtotalMinorUnits?: number;
    discountMinorUnits?: number;
    finalMinorUnits?: number;
    expiredBatch?: number;
    itemSnapshotJson?: string;
}

interface SaleFixture {
    saleId: string;
    completedAt: string;
    customerName?: string | null;
    customerAddress?: string | null;
    saleDate?: string | null;
    staffUserId?: string | null;
    staffDisplayName?: string | null;
    notes?: string | null;
    subtotalMinorUnits?: number;
    discountMinorUnits?: number;
    finalMinorUnits?: number;
    expiredBatchConfirmed?: number;
    items?: SaleItemRow[];
}

function insertCompletedSale(sale: SaleFixture): void {
    const sourceDraftId = `draft-${sale.saleId}`;
    const completedEventId = `event-${sale.saleId}`;
    const subtotalMinorUnits = sale.subtotalMinorUnits ?? 900;
    const discountMinorUnits = sale.discountMinorUnits ?? 50;
    const finalMinorUnits = sale.finalMinorUnits ?? 850;
    const items = sale.items ?? [{
        lineId: `line-${sale.saleId}`,
        itemPosition: 0,
        itemSnapshotJson: JSON.stringify({
            product: { productName: "Historical product name" },
            variant: { variantName: "Historical variant name" },
            packagingLevel: { name: "Historical box" }
        })
    }];

    database.prepare(`
        INSERT INTO activity_events (
            event_id, operation_key, event_type, occurred_at, event_json
        ) VALUES (?, ?, 'sale.completed', ?, ?)
    `).run(
        completedEventId,
        `sale.completed:${sale.saleId}`,
        sale.completedAt,
        JSON.stringify({ saleId: sale.saleId })
    );

    insertDraft(sourceDraftId);
    database.prepare(`
        INSERT INTO sales (
            sale_id, source_draft_id, completed_event_id, completed_at,
            customer_name, customer_address, sale_date, staff_user_id,
            staff_display_name, notes, subtotal_minor_units,
            discount_minor_units, final_minor_units, expired_batch_confirmed
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        sale.saleId,
        sourceDraftId,
        completedEventId,
        sale.completedAt,
        sale.customerName ?? null,
        sale.customerAddress ?? null,
        sale.saleDate ?? null,
        sale.staffUserId ?? null,
        sale.staffDisplayName ?? null,
        sale.notes ?? null,
        subtotalMinorUnits,
        discountMinorUnits,
        finalMinorUnits,
        sale.expiredBatchConfirmed ?? 0
    );

    for (const [index, item] of items.entries()) {
        const subtotal = item.subtotalMinorUnits ?? 900;
        const discount = item.discountMinorUnits ?? 50;
        database.prepare(`
            INSERT INTO sale_items (
                sale_id, line_id, item_position, inventory_record_id,
                product_id, variant_id, batch_id, packaging_level_id, quantity,
                default_selling_price_minor_units,
                applied_selling_price_minor_units, subtotal_minor_units,
                discount_minor_units, final_minor_units, expired_batch,
                item_snapshot_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            sale.saleId,
            item.lineId,
            item.itemPosition,
            item.inventoryRecordId ?? currentInventoryId,
            item.productId ?? currentProductId,
            item.variantId ?? currentVariantId,
            item.batchId ?? null,
            item.packagingLevelId ?? currentPackagingId,
            item.quantity ?? 2,
            item.defaultSellingPriceMinorUnits === undefined
                ? 500
                : item.defaultSellingPriceMinorUnits,
            item.appliedSellingPriceMinorUnits ?? 450,
            subtotal,
            discount,
            item.finalMinorUnits ?? subtotal - discount,
            item.expiredBatch ?? (index === 0 ? 0 : 1),
            item.itemSnapshotJson ?? JSON.stringify({ lineId: item.lineId })
        );
    }
}

function sqliteValue(value: unknown): SqliteQueryValue {
    if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number"
    ) {
        return value;
    }
    throw new Error("Sales repository test received an unsupported SQLite value.");
}

describe("Sales read repository", () => {
    beforeEach(() => {
        database = new DatabaseSync(":memory:");
        database.exec("PRAGMA foreign_keys = ON");
        database.exec(migrationSql);
        seedCurrentInventoryReferences();
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

    it("returns no completed Sales for an empty database", async () => {
        await expect(getAllSales()).resolves.toEqual([]);
    });

    it("maps completed Sales, preserves snapshots, and orders Sales and items stably", async () => {
        insertCompletedSale({
            saleId: "sale-old",
            completedAt: "2026-11-24T10:00:00.000Z",
            customerName: "Old customer"
        });
        insertCompletedSale({
            saleId: "sale-new",
            completedAt: "2026-11-25T12:00:00.000Z",
            customerName: "Customer",
            customerAddress: "1 Main Street",
            saleDate: "2026-11-25",
            staffUserId: "staff-1",
            staffDisplayName: "Pharmacist",
            notes: "Sale note",
            subtotalMinorUnits: 12000,
            discountMinorUnits: 1000,
            finalMinorUnits: 11000,
            expiredBatchConfirmed: 1,
            items: [
                {
                    lineId: "line-later",
                    itemPosition: 1,
                    expiredBatch: 1,
                    subtotalMinorUnits: 7000,
                    discountMinorUnits: 500,
                    itemSnapshotJson: JSON.stringify({
                        product: { productName: "Historical second product" }
                    })
                },
                {
                    lineId: "line-first",
                    itemPosition: 0,
                    expiredBatch: 0,
                    batchId: "historical-batch",
                    defaultSellingPriceMinorUnits: null,
                    subtotalMinorUnits: 5000,
                    discountMinorUnits: 500,
                    itemSnapshotJson: JSON.stringify({
                        product: { productName: "Historical first product" },
                        variant: { variantName: "Historical strength" },
                        packagingLevel: { name: "Historical pack" }
                    })
                }
            ]
        });
        insertCompletedSale({
            saleId: "sale-same-time",
            completedAt: "2026-11-25T12:00:00.000Z"
        });

        const sales = await getAllSales();

        expect(sales.map((sale) => sale.saleId)).toEqual([
            "sale-new",
            "sale-same-time",
            "sale-old"
        ]);
        expect(sales[0]).toMatchObject({
            saleId: "sale-new",
            status: "completed",
            sourceDraftId: "draft-sale-new",
            completedEventId: "event-sale-new",
            completedAt: "2026-11-25T12:00:00.000Z",
            customerName: "Customer",
            customerAddress: "1 Main Street",
            saleDate: "2026-11-25",
            staffUserId: "staff-1",
            staffDisplayName: "Pharmacist",
            notes: "Sale note",
            subtotal: 120,
            discountAmount: 10,
            finalAmount: 110,
            expiredBatchConfirmed: true
        });
        expect(sales[0]?.items.map((item) => item.lineId)).toEqual([
            "line-first",
            "line-later"
        ]);
        expect(sales[0]?.items[0]).toMatchObject({
            lineId: "line-first",
            itemPosition: 0,
            inventoryRecordId: currentInventoryId,
            productId: currentProductId,
            variantId: currentVariantId,
            batchId: "historical-batch",
            packagingLevelId: currentPackagingId,
            quantity: 2,
            defaultSellingPrice: null,
            appliedSellingPrice: 4.5,
            subtotal: 50,
            discountAmount: 5,
            finalAmount: 45,
            expiredBatch: false,
            itemSnapshot: {
                product: { productName: "Historical first product" },
                variant: { variantName: "Historical strength" },
                packagingLevel: { name: "Historical pack" }
            }
        });
        expect(sales[0]?.items[0]?.itemSnapshotJson).toContain(
            "Historical first product"
        );
        expect(sales[0]?.items[1]?.expiredBatch).toBe(true);
        expect(sales[1]?.items[0]?.itemSnapshot).toEqual({
            product: { productName: "Historical product name" },
            variant: { variantName: "Historical variant name" },
            packagingLevel: { name: "Historical box" }
        });
        expect(querySqliteMock).toHaveBeenCalledOnce();
        expect(querySqliteMock.mock.calls[0]?.[0]).toContain("FROM sales");
        expect(querySqliteMock.mock.calls[0]?.[0]).not.toMatch(
            /\bJOIN\s+(?:products|variants|packaging_levels|inventory_records|batches)\b/i
        );
    });

    it("preserves nullable Sale and item values and excludes cancelled drafts", async () => {
        insertCompletedSale({
            saleId: "sale-nullable",
            completedAt: "2026-11-25T12:00:00.000Z",
            customerName: null,
            customerAddress: null,
            saleDate: null,
            staffUserId: null,
            staffDisplayName: null,
            notes: null,
            items: [{
                lineId: "line-nullable",
                itemPosition: 0,
                batchId: null,
                defaultSellingPriceMinorUnits: null
            }]
        });

        insertDraft("cancelled-draft");
        database.prepare(`
            UPDATE sale_drafts SET status = 'cancelled'
            WHERE draft_id = 'cancelled-draft'
        `).run();

        const sales = await getAllSales();

        expect(sales).toHaveLength(1);
        expect(sales[0]).toMatchObject({
            status: "completed",
            customerName: null,
            customerAddress: null,
            saleDate: null,
            staffUserId: null,
            staffDisplayName: null,
            notes: null
        });
        expect(sales[0]?.items[0]).toMatchObject({
            batchId: null,
            defaultSellingPrice: null
        });
        expect(sales.some((sale) => sale.saleId === "cancelled-draft")).toBe(false);
    });

    it("rejects malformed item snapshot JSON", async () => {
        insertCompletedSale({
            saleId: "sale-malformed",
            completedAt: "2026-11-25T12:00:00.000Z",
            items: [{
                lineId: "line-malformed",
                itemPosition: 0,
                itemSnapshotJson: "{invalid"
            }]
        });

        await expect(getAllSales()).rejects.toThrow(
            "invalid item snapshot JSON"
        );
    });

    it("rejects unsafe persisted money values instead of rounding them", async () => {
        insertCompletedSale({
            saleId: "sale-unsafe",
            completedAt: "2026-11-25T12:00:00.000Z",
            items: [{
                lineId: "line-unsafe",
                itemPosition: 0,
                appliedSellingPriceMinorUnits: 450.5
            }]
        });

        await expect(getAllSales()).rejects.toThrow(
            "invalid applied_selling_price_minor_units"
        );
    });
});
