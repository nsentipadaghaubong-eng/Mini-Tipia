import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";

const databasePath = "sqlite:tipia.db";

export interface DatabaseConnection {
    database: Database;
    foreignKeysEnabled: true;
}

let connection: DatabaseConnection | null = null;
let initializationPromise: Promise<DatabaseConnection> | null = null;
let closePromise: Promise<boolean> | null = null;

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function openDatabase(): Promise<DatabaseConnection> {
    let candidate: Database | null = null;

    try {
        candidate = await Database.load(databasePath);
        await invoke("verify_sqlite_connection");
        await invoke("initialize_sqlite_schema");

        connection = {
            database: candidate,
            foreignKeysEnabled: true
        };
        return connection;
    } catch (error) {
        const message =
            `Unable to initialize SQLite database (${databasePath}): ${describeError(error)}`;

        if (candidate) {
            try {
                const closed = await candidate.close();
                if (!closed) {
                    throw new Error(
                        "The partially initialized connection did not confirm closure (close returned false).",
                        { cause: error }
                    );
                }
            } catch (closeError) {
                throw new AggregateError(
                    [error, closeError],
                    `${message} The partially initialized connection could not be closed: ${describeError(closeError)}`,
                    { cause: closeError }
                );
            }
        }

        throw new Error(message, { cause: error });
    }
}

export async function initializeDatabase(): Promise<DatabaseConnection> {
    if (closePromise) {
        await closePromise;
        return initializeDatabase();
    }
    if (connection) {
        return connection;
    }
    if (initializationPromise) {
        return initializationPromise;
    }

    const pending = openDatabase();
    initializationPromise = pending;

    try {
        return await pending;
    } finally {
        if (initializationPromise === pending) {
            initializationPromise = null;
        }
    }
}

export async function closeDatabase(): Promise<boolean> {
    if (closePromise) {
        return closePromise;
    }

    const closing = (async () => {
        if (initializationPromise) {
            await initializationPromise;
        }
        if (!connection) {
            return false;
        }

        const current = connection;
        const closed = await current.database.close();
        if (closed && connection === current) {
            connection = null;
        }
        return closed;
    })();
    closePromise = closing;

    try {
        return await closing;
    } finally {
        if (closePromise === closing) {
            closePromise = null;
        }
    }
}
