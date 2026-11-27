/// <reference types="node" />

import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    prepareActivityEvents,
    type ActivityEvent,
    type ActivityEventInput
} from "../../activity/activity";
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
const { getAllActivityEvents } = await import("./activityRepository");

let database: DatabaseSync;

function insertEvent(
    event: ActivityEvent,
    overrides: {
        eventId?: string;
        operationKey?: string;
        eventType?: string;
        occurredAt?: string;
        actorId?: string | null;
        eventJson?: string;
    } = {}
): void {
    database.prepare(`
        INSERT INTO activity_events (
            event_id, operation_key, event_type, occurred_at, actor_id, event_json
        ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
        overrides.eventId ?? event.eventId,
        overrides.operationKey ?? event.operationKey,
        overrides.eventType ?? event.type,
        overrides.occurredAt ?? event.occurredAt,
        overrides.actorId === undefined
            ? event.actorId ?? null
            : overrides.actorId,
        overrides.eventJson ?? JSON.stringify(event)
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
    throw new Error("Activity repository test received an unsupported SQLite value.");
}

const productSnapshot = {
    productId: "historical-product",
    productName: "Historical medicine",
    variants: [{
        variantId: "historical-variant",
        variantName: "Tablets",
        packaging: [{
            packagingLevelId: "historical-packaging",
            name: "Box",
            costPrice: null,
            sellingPrice: 12.5,
            quantityOfNextLevel: null,
            nextLevelId: null,
            nextLevelName: null
        }]
    }]
} as const;

function makeProductCreatedEvent(
    eventId: string,
    occurredAt: string
): ActivityEvent {
    return {
        type: "product.created",
        eventId,
        operationKey: `product.created:${eventId}`,
        occurredAt,
        actorId: "pharmacist-1",
        product: productSnapshot,
        initialInventory: []
    };
}

function makeProductDeletedEvent(
    eventId: string,
    occurredAt: string
): ActivityEvent {
    return {
        type: "product.deleted",
        eventId,
        operationKey: `product.deleted:${eventId}`,
        occurredAt,
        productId: productSnapshot.productId,
        productName: productSnapshot.productName,
        product: productSnapshot,
        inventory: [{
            inventoryId: "historical-inventory",
            productId: productSnapshot.productId,
            productName: productSnapshot.productName,
            variantId: "historical-variant",
            variantName: "Tablets",
            batch: null,
            stock: []
        }],
        batches: [{
            batchId: "historical-batch",
            productId: productSnapshot.productId,
            productName: productSnapshot.productName,
            variantId: "historical-variant",
            variantName: "Tablets",
            batchNumber: null,
            expiryDate: "2027-12-31",
            pricingByPackagingLevel: []
        }],
        reason: "Discontinued"
    };
}

function makeDeliveryEvent(
    eventId: string,
    occurredAt: string
): ActivityEvent {
    return {
        type: "delivery.received",
        eventId,
        operationKey: `delivery.received:${eventId}`,
        occurredAt,
        deliveryId: "historical-delivery",
        deliveryDate: "2026-11-14",
        receivedBy: "Pharmacist",
        supplierName: null,
        invoiceNumber: null,
        items: []
    };
}

describe("Activity read repository", () => {
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

    it("returns an empty history when no Activity events exist", async () => {
        await expect(getAllActivityEvents()).resolves.toEqual([]);
    });

    it("returns full snapshots newest-first and preserves sequence for equal timestamps", async () => {
        const oldest = makeProductCreatedEvent(
            "event-created",
            "2026-11-14T08:00:00.000Z"
        );
        const firstAtSameTime = makeDeliveryEvent(
            "event-delivery",
            "2026-11-14T12:00:00.000Z"
        );
        const secondAtSameTime = makeProductDeletedEvent(
            "event-deleted",
            "2026-11-14T12:00:00.000Z"
        );

        insertEvent(oldest);
        insertEvent(firstAtSameTime);
        insertEvent(secondAtSameTime);

        const events = await getAllActivityEvents();

        expect(events).toEqual([
            firstAtSameTime,
            secondAtSameTime,
            oldest
        ]);
        expect(events[0]?.occurredAt).toBe("2026-11-14T12:00:00.000Z");
        expect(events[0]).toMatchObject({
            type: "delivery.received",
            supplierName: null,
            invoiceNumber: null
        });
        expect(events[1]).toMatchObject({
            type: "product.deleted",
            product: productSnapshot,
            inventory: [{
                inventoryId: "historical-inventory",
                batch: null
            }],
            batches: [{
                batchId: "historical-batch",
                batchNumber: null,
                expiryDate: "2027-12-31"
            }]
        });
        expect(database.prepare("SELECT COUNT(*) AS count FROM products").get())
            .toMatchObject({ count: 0 });
        expect(querySqliteMock).toHaveBeenCalledOnce();
        expect(querySqliteMock.mock.calls[0]?.[0]).toContain("FROM activity_events");
        expect(querySqliteMock.mock.calls[0]?.[0]).not.toMatch(/\bJOIN\b/i);
    });

    it("keeps optional actor metadata absent when the persisted column is NULL", async () => {
        const event = makeDeliveryEvent(
            "event-no-actor",
            "2026-11-14T12:00:00.000Z"
        );
        insertEvent(event);

        const [loaded] = await getAllActivityEvents();

        expect(loaded).toEqual(event);
        expect(loaded).not.toHaveProperty("actorId");
    });

    it("defines the required full-event JSON and indexed-metadata round trip", async () => {
        const input: ActivityEventInput = {
            type: "delivery.received",
            operationKey: "delivery.received:delivery-contract",
            actorId: "pharmacist-contract",
            deliveryId: "delivery-contract",
            deliveryDate: "2026-11-25",
            receivedBy: "Receiving pharmacist",
            supplierName: null,
            invoiceNumber: "INV-CONTRACT",
            items: [{
                productId: "deleted-product",
                productName: "Historical product",
                variantId: "deleted-variant",
                variantName: "Historical variant",
                batch: null,
                pricingAtReceipt: {
                    packagingLevelId: "deleted-packaging",
                    costPrice: null,
                    sellingPrice: 1.25
                },
                stock: []
            }]
        };
        const [event] = prepareActivityEvents([input], {
            makeId: () => "event-contract",
            now: () => new Date("2026-11-25T10:00:00.000Z")
        });
        if (!event) {
            throw new Error("Expected an Activity event from the factory.");
        }

        insertEvent(event);

        const [loaded] = await getAllActivityEvents();
        const storedRow = database.prepare(`
            SELECT event_id, operation_key, event_type, occurred_at,
                actor_id, event_json
            FROM activity_events WHERE event_id = ?
        `).get(event.eventId);

        expect(storedRow).toMatchObject({
            event_id: event.eventId,
            operation_key: event.operationKey,
            event_type: event.type,
            occurred_at: event.occurredAt,
            actor_id: event.actorId,
            event_json: JSON.stringify(event)
        });
        expect(loaded).toEqual(event);
    });

    it("rejects event JSON when it disagrees with indexed metadata", async () => {
        const event = makeProductCreatedEvent(
            "event-json-id",
            "2026-11-14T12:00:00.000Z"
        );
        insertEvent(event, { eventId: "different-column-id" });

        await expect(getAllActivityEvents()).rejects.toThrow(
            "does not match its persisted metadata"
        );
    });

    it("rejects malformed or unknown event payloads instead of returning partial history", async () => {
        const event = makeDeliveryEvent(
            "event-corrupt",
            "2026-11-14T12:00:00.000Z"
        );
        insertEvent(event, { eventJson: "not-json" });

        await expect(getAllActivityEvents()).rejects.toThrow(
            "invalid event JSON"
        );
    });
});
