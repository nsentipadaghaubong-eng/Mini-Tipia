import type { ActivityEvent } from "../../activity/activity";
import {
    parseActivityEvent,
    serializeActivityEvent
} from "../historicalSerialization";
import {
    executeTransaction,
    type SqliteStatement
} from "../transaction";

export interface ActivityInsert {
    readonly statement: SqliteStatement;
    readonly expectedRowsAffected: 1;
}

const INSERT_ACTIVITY_EVENT = `
    INSERT INTO activity_events (
        event_id,
        operation_key,
        event_type,
        occurred_at,
        actor_id,
        event_json
    ) VALUES ($1, $2, $3, $4, $5, $6)
`;

export function createActivityInsert(
    event: ActivityEvent
): ActivityInsert {
    const persisted = serializeActivityEvent(event);
    parseActivityEvent(persisted.eventJson, {
        eventId: persisted.eventId,
        operationKey: persisted.operationKey,
        eventType: persisted.eventType,
        occurredAt: persisted.occurredAt,
        actorId: persisted.actorId
    });

    return {
        statement: {
            query: INSERT_ACTIVITY_EVENT,
            parameters: [
                persisted.eventId,
                persisted.operationKey,
                persisted.eventType,
                persisted.occurredAt,
                persisted.actorId,
                persisted.eventJson
            ]
        },
        expectedRowsAffected: 1
    };
}

export function assertActivityInsertRowsAffected(
    insert: ActivityInsert,
    rowsAffected: number | undefined
): void {
    if (rowsAffected !== insert.expectedRowsAffected) {
        const actual = rowsAffected === undefined
            ? "no result"
            : String(rowsAffected);
        throw new Error(
            `SQLite Activity insert expected exactly ${insert.expectedRowsAffected} affected row, received ${actual}.`
        );
    }
}

export async function insertActivityEvent(
    event: ActivityEvent
): Promise<void> {
    const insert = createActivityInsert(event);
    const rowsAffected = await executeTransaction([insert.statement]);
    assertActivityInsertRowsAffected(insert, rowsAffected[0]);
}
