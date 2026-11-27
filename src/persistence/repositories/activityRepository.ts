import {
    querySqlite,
    type SqliteQueryExecutor,
    type SqliteQueryResult,
    type SqliteQueryValue
} from "../query";
import type { ActivityEvent } from "../../activity/activity";
import { parseActivityEvent as parsePersistedActivityEvent } from "../historicalSerialization";

const ACTIVITY_EVENT_QUERY = `
    SELECT
        event_id AS event_id,
        operation_key AS operation_key,
        event_type AS event_type,
        occurred_at AS occurred_at,
        actor_id AS actor_id,
        event_json AS event_json
    FROM activity_events
    ORDER BY julianday(occurred_at) DESC, event_sequence ASC
`;

type ActivityRow = ReadonlyMap<string, SqliteQueryValue>;

function toActivityRows(result: SqliteQueryResult): ActivityRow[] {
    return result.rows.map((values) => {
        if (values.length !== result.columns.length) {
            throw new Error("SQLite Activity query returned an invalid row shape.");
        }

        const row = new Map<string, SqliteQueryValue>();
        result.columns.forEach((column, index) => {
            if (row.has(column)) {
                throw new Error("SQLite Activity query returned duplicate columns.");
            }
            row.set(column, values[index]);
        });
        return row;
    });
}

function requiredValue(row: ActivityRow, column: string): SqliteQueryValue {
    const value = row.get(column);
    if (value === undefined) {
        throw new Error(`SQLite Activity query is missing the ${column} column.`);
    }
    return value;
}

function requiredText(row: ActivityRow, column: string): string {
    const value = requiredValue(row, column);
    if (typeof value !== "string") {
        throw new Error(`SQLite Activity query returned an invalid ${column}.`);
    }
    return value;
}

function nullableText(row: ActivityRow, column: string): string | null {
    const value = requiredValue(row, column);
    if (value === null) {
        return null;
    }
    if (typeof value !== "string") {
        throw new Error(`SQLite Activity query returned an invalid ${column}.`);
    }
    return value;
}

function parseActivityEvent(row: ActivityRow): ActivityEvent {
    const eventId = requiredText(row, "event_id");
    const operationKey = requiredText(row, "operation_key");
    const eventType = requiredText(row, "event_type");
    const occurredAt = requiredText(row, "occurred_at");
    const actorId = nullableText(row, "actor_id");
    const eventJson = requiredText(row, "event_json");

    try {
        return parsePersistedActivityEvent(eventJson, {
            eventId,
            operationKey,
            eventType,
            occurredAt,
            actorId
        });
    } catch (error) {
        if (error instanceof Error && error.message.includes("invalid JSON")) {
            throw new Error("SQLite Activity query returned invalid event JSON.", {
                cause: error
            });
        }
        if (
            error instanceof Error &&
            error.message.includes("does not match its relational metadata")
        ) {
            throw new Error(
                "SQLite Activity event JSON does not match its persisted metadata.",
                { cause: error }
            );
        }
        throw new Error("SQLite Activity query returned an invalid Activity event.", {
            cause: error
        });
    }
}

export async function getAllActivityEvents(
    query: SqliteQueryExecutor = querySqlite
): Promise<ActivityEvent[]> {
    const result = await query(ACTIVITY_EVENT_QUERY);
    return toActivityRows(result).map(parseActivityEvent);
}
