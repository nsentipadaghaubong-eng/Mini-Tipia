import { invoke } from "@tauri-apps/api/core";
import { initializeDatabase } from "./database";
import type { SqliteParameter } from "./transaction";

export type SqliteQueryValue = string | number | number[] | null;

export interface SqliteQueryResult {
    readonly columns: readonly string[];
    readonly rows: readonly (readonly SqliteQueryValue[])[];
}

export interface SqliteQueryExecutor {
    (
        query: string,
        parameters?: readonly SqliteParameter[]
    ): Promise<SqliteQueryResult>;
}

export interface SqliteReadSnapshotQuery {
    readonly query: string;
    readonly parameters: readonly SqliteParameter[];
}

type PendingSnapshotQuery = {
    readonly request: SqliteReadSnapshotQuery;
    readonly resolve: (result: SqliteQueryResult) => void;
    readonly reject: (error: unknown) => void;
};

function validateReadQuery(
    query: string,
    parameters: readonly SqliteParameter[]
): void {
    if (query.trim() === "") {
        throw new Error("A SQLite read query must not be empty.");
    }

    for (const parameter of parameters) {
        if (
            typeof parameter === "number" &&
            (!Number.isFinite(parameter) ||
                (Number.isInteger(parameter) && !Number.isSafeInteger(parameter)))
        ) {
            throw new Error("A SQLite read query has an unsafe numeric parameter.");
        }
    }
}

export async function querySqlite(
    query: string,
    parameters: readonly SqliteParameter[] = []
): Promise<SqliteQueryResult> {
    validateReadQuery(query, parameters);
    await initializeDatabase();
    return invoke<SqliteQueryResult>("query_sqlite_readonly", {
        query,
        parameters: [...parameters]
    });
}

export interface SqliteReadSnapshotExecutor {
    readonly query: SqliteQueryExecutor;
    execute(): Promise<void>;
}

export function createSqliteReadSnapshotExecutor():
SqliteReadSnapshotExecutor {
    const pending: PendingSnapshotQuery[] = [];
    let executed = false;

    const query: SqliteQueryExecutor = (sql, parameters = []) => {
        if (executed) {
            return Promise.reject(
                new Error("A SQLite read snapshot has already been executed.")
            );
        }
        try {
            validateReadQuery(sql, parameters);
        } catch (error) {
            return Promise.reject(error);
        }

        return new Promise((resolve, reject) => {
            pending.push({
                request: { query: sql, parameters: [...parameters] },
                resolve,
                reject
            });
        });
    };

    return {
        query,
        async execute() {
            if (executed) {
                throw new Error("A SQLite read snapshot can only execute once.");
            }
            executed = true;
            if (pending.length === 0) {
                return;
            }

            try {
                await initializeDatabase();
                const results = await invoke<SqliteQueryResult[]>(
                    "query_sqlite_readonly_snapshot",
                    { queries: pending.map(({ request }) => request) }
                );
                if (!Array.isArray(results) || results.length !== pending.length) {
                    throw new Error(
                        "SQLite read snapshot returned an unexpected result count."
                    );
                }
                if (results.some((result) => result === undefined)) {
                    throw new Error(
                        "SQLite read snapshot omitted a repository result."
                    );
                }
                pending.forEach(({ resolve }, index) => {
                    const result = results[index];
                    if (result !== undefined) {
                        resolve(result);
                    }
                });
            } catch (error) {
                pending.forEach(({ reject }) => reject(error));
            }
        }
    };
}
