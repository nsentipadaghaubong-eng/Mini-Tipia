/// <reference types="node" />

import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    prepareActivityEvents,
    type ActivityEvent,
    type ActivityEventInput
} from "../../activity/activity";
import type { SqliteStatement } from "../transaction";
import type { SqliteQueryResult, SqliteQueryValue } from "../query";

const {
    executeTransactionMock,
    querySqliteMock
} = vi.hoisted(() => ({
    executeTransactionMock: vi.fn(),
    querySqliteMock: vi.fn()
}));

vi.mock("../transaction", () => ({
    executeTransaction: executeTransactionMock
}));

vi.mock("../query", () => ({
    querySqlite: querySqliteMock
}));

const migrationSql = readFileSync(
    new URL("../../../src-tauri/src/migrations/migration_001.sql", import.meta.url),
    "utf8"
);
const migration002Sql = readFileSync(
    new URL("../../../src-tauri/src/migrations/migration_002_delivery_inventory_association.sql", import.meta.url),
    "utf8"
);
const migration003Sql = readFileSync(
    new URL("../../../src-tauri/src/migrations/migration_003_received_delivery_inventory_association_guards.sql", import.meta.url),
    "utf8"
);
const {
    assertActivityInsertRowsAffected,
    createActivityInsert,
    insertActivityEvent
} = await import("./activityWriteRepository");
const { getAllActivityEvents } = await import("./activityRepository");

let database: DatabaseSync;

const productSnapshot = {
    productId: "product-historical",
    productName: "Historical medicine",
    variants: [{
        variantId: "variant-historical",
        variantName: "Tablets",
        packaging: [{
            packagingLevelId: "pack-historical",
            name: "Box",
            costPrice: null,
            sellingPrice: 12.5,
            quantityOfNextLevel: null,
            nextLevelId: null,
            nextLevelName: null
        }]
    }]
} as const;

function makeEvent(
    input: ActivityEventInput,
    eventId: string,
    occurredAt = "2026-11-25T10:00:00.000Z"
): ActivityEvent {
    const [event] = prepareActivityEvents([input], {
        makeId: () => eventId,
        now: () => new Date(occurredAt)
    });
    if (!event) {
        throw new Error("Expected an Activity event from the factory.");
    }
    return event;
}

function makeProductCreatedEvent(
    eventId: string,
    operationKey = `product.created:${eventId}`
): ActivityEvent {
    return makeEvent({
        type: "product.created",
        operationKey,
        product: productSnapshot,
        initialInventory: []
    }, eventId);
}

function makeDeliveryReceivedEvent(
    eventId: string,
    operationKey = `delivery.received:${eventId}`
): ActivityEvent {
    return makeEvent({
        type: "delivery.received",
        operationKey,
        deliveryId: "delivery-historical",
        deliveryDate: "2026-11-25",
        receivedBy: "Receiving pharmacist",
        supplierName: null,
        invoiceNumber: null,
        items: []
    }, eventId);
}

function sqliteValue(value: unknown): SqliteQueryValue {
    if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number"
    ) {
        return value;
    }
    throw new Error("Activity write test received an unsupported SQLite value.");
}

function executeIsolatedTransaction(
    statements: readonly SqliteStatement[]
): number[] {
    database.exec("BEGIN IMMEDIATE");
    try {
        const rowsAffected = statements.map(({ query, parameters }) => {
            const bindings = Object.fromEntries(parameters.map((parameter, index) => [
                `$${index + 1}`,
                typeof parameter === "boolean" ? Number(parameter) : parameter
            ]));
            return Number(database.prepare(query).run(bindings).changes);
        });
        database.exec("COMMIT");
        return rowsAffected;
    } catch (error) {
        database.exec("ROLLBACK");
        throw error;
    }
}

describe("Activity write repository", () => {
    beforeEach(() => {
        database = new DatabaseSync(":memory:");
        database.exec("PRAGMA foreign_keys = ON");
        database.exec(migrationSql);
        database.exec(migration002Sql);
        database.exec(migration003Sql);

        executeTransactionMock.mockReset();
        executeTransactionMock.mockImplementation(
            async (statements: readonly SqliteStatement[]) =>
                executeIsolatedTransaction(statements)
        );
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

    it("inserts complete typed events and reads back matching relational metadata", async () => {
        const productEvent = makeProductCreatedEvent("event-product");
        const deliveryEvent = makeDeliveryReceivedEvent("event-delivery");

        await insertActivityEvent(productEvent);
        await insertActivityEvent(deliveryEvent);

        expect(executeTransactionMock).toHaveBeenCalledTimes(2);
        for (const [event] of [
            [productEvent],
            [deliveryEvent]
        ] as const) {
            const insert = createActivityInsert(event);
            expect(insert.expectedRowsAffected).toBe(1);
            expect(insert.statement.query).toContain(
                "INSERT INTO activity_events"
            );
            expect(insert.statement.parameters).toEqual([
                event.eventId,
                event.operationKey,
                event.type,
                event.occurredAt,
                event.actorId ?? null,
                JSON.stringify(event)
            ]);
        }

        const storedEvents = await getAllActivityEvents();
        expect(storedEvents).toEqual([productEvent, deliveryEvent]);

        const storedRows = database.prepare(`
            SELECT event_id, operation_key, event_type, occurred_at,
                actor_id, event_json
            FROM activity_events
            ORDER BY event_sequence
        `).all();
        expect(storedRows).toEqual([
            {
                event_id: productEvent.eventId,
                operation_key: productEvent.operationKey,
                event_type: productEvent.type,
                occurred_at: productEvent.occurredAt,
                actor_id: productEvent.actorId ?? null,
                event_json: JSON.stringify(productEvent)
            },
            {
                event_id: deliveryEvent.eventId,
                operation_key: deliveryEvent.operationKey,
                event_type: deliveryEvent.type,
                occurred_at: deliveryEvent.occurredAt,
                actor_id: null,
                event_json: JSON.stringify(deliveryEvent)
            }
        ]);
        expect(deliveryEvent).not.toHaveProperty("actorId");
    });

    it("rejects malformed, unsupported, or internally inconsistent events before insertion", () => {
        const valid = makeProductCreatedEvent("event-valid");
        const malformed = {
            ...valid,
            product: { ...productSnapshot, variants: "not-an-array" }
        } as unknown as ActivityEvent;
        const unsupported = {
            ...valid,
            type: "future.event"
        } as unknown as ActivityEvent;
        const inconsistent = {
            ...valid,
            toJSON: () => ({ ...valid, eventId: "different-json-event-id" })
        };

        expect(() => createActivityInsert(malformed)).toThrow(
            "Activity event is invalid"
        );
        expect(() => createActivityInsert(unsupported)).toThrow(
            "Activity event is invalid"
        );
        expect(() => createActivityInsert(inconsistent)).toThrow(
            "does not match its relational metadata"
        );
        expect(executeTransactionMock).not.toHaveBeenCalled();
        expect(database.prepare(
            "SELECT COUNT(*) AS count FROM activity_events"
        ).get()).toMatchObject({ count: 0 });
    });

    it("surfaces duplicate event IDs and operation keys through SQLite uniqueness constraints", async () => {
        const original = makeProductCreatedEvent("event-original");
        await insertActivityEvent(original);

        await expect(insertActivityEvent({
            ...makeProductCreatedEvent("event-duplicate-id"),
            eventId: original.eventId
        })).rejects.toThrow(/UNIQUE constraint failed: activity_events\.event_id/);

        await expect(insertActivityEvent(
            makeDeliveryReceivedEvent(
                "event-duplicate-operation",
                original.operationKey
            )
        )).rejects.toThrow(
            /UNIQUE constraint failed: activity_events\.operation_key/
        );

        expect(database.prepare(
            "SELECT COUNT(*) AS count FROM activity_events"
        ).get()).toMatchObject({ count: 1 });
    });

    it("requires exactly one affected row for a successful Activity insert", () => {
        const insert = createActivityInsert(
            makeProductCreatedEvent("event-row-count")
        );
        expect(() => assertActivityInsertRowsAffected(insert, 0)).toThrow(
            "expected exactly 1 affected row, received 0"
        );
        expect(() => assertActivityInsertRowsAffected(insert, 2)).toThrow(
            "expected exactly 1 affected row, received 2"
        );
        expect(() => assertActivityInsertRowsAffected(insert, undefined)).toThrow(
            "expected exactly 1 affected row, received no result"
        );
        expect(() => assertActivityInsertRowsAffected(insert, 1)).not.toThrow();
    });

    it("does not report an insert as successful when the transaction returns zero rows", async () => {
        executeTransactionMock.mockResolvedValueOnce([0]);

        await expect(insertActivityEvent(
            makeProductCreatedEvent("event-zero-rows")
        )).rejects.toThrow(
            "expected exactly 1 affected row, received 0"
        );
        expect(database.prepare(
            "SELECT COUNT(*) AS count FROM activity_events"
        ).get()).toMatchObject({ count: 0 });
    });

    it("keeps Activity append-only through the existing database guards", async () => {
        const event = makeProductCreatedEvent("event-immutable");
        await insertActivityEvent(event);

        expect(() => database.prepare(`
            UPDATE activity_events SET event_json = '{}'
            WHERE event_id = ?
        `).run(event.eventId)).toThrow("Activity events are append-only");
        expect(() => database.prepare(`
            DELETE FROM activity_events WHERE event_id = ?
        `).run(event.eventId)).toThrow("Activity events are retained");
    });

    it("rolls back earlier DML when an Activity insertion fails", async () => {
        const original = makeProductCreatedEvent("event-existing");
        await insertActivityEvent(original);
        database.exec(
            "CREATE TABLE write_test_side_effects (id TEXT PRIMARY KEY)"
        );
        const duplicateActivityInsert = createActivityInsert({
            ...makeDeliveryReceivedEvent(
                "event-new",
                original.operationKey
            )
        });

        await expect(executeTransactionMock([
            {
                query: "INSERT INTO write_test_side_effects (id) VALUES ($1)",
                parameters: ["side-effect"]
            },
            duplicateActivityInsert.statement
        ])).rejects.toThrow(
            /UNIQUE constraint failed: activity_events\.operation_key/
        );

        expect(database.prepare(
            "SELECT COUNT(*) AS count FROM write_test_side_effects"
        ).get()).toMatchObject({ count: 0 });
        expect(database.prepare(
            "SELECT COUNT(*) AS count FROM activity_events"
        ).get()).toMatchObject({ count: 1 });
    });
});
