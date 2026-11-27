import { invoke } from "@tauri-apps/api/core";
import { initializeDatabase } from "./database";

export type SqliteParameter = string | number | boolean | null;

export interface SqliteStatement {
    readonly query: string;
    readonly parameters: readonly SqliteParameter[];
}

export async function executeTransaction(
    statements: readonly SqliteStatement[],
    expectedRowsAffected?: readonly number[]
): Promise<number[]> {
    if (statements.length === 0) {
        throw new Error("A SQLite transaction must contain at least one statement.");
    }
    if (
        expectedRowsAffected !== undefined &&
        expectedRowsAffected.length !== statements.length
    ) {
        throw new Error(
            "SQLite transaction expected row counts must match the statement count."
        );
    }

    for (const [statementIndex, statement] of statements.entries()) {
        if (statement.query.trim() === "") {
            throw new Error(
                `SQLite transaction statement ${statementIndex + 1} is empty.`
            );
        }
        for (const parameter of statement.parameters) {
            if (
                typeof parameter === "number" &&
                (!Number.isFinite(parameter) ||
                    (Number.isInteger(parameter) && !Number.isSafeInteger(parameter)))
            ) {
                throw new Error(
                    `SQLite transaction statement ${statementIndex + 1} has an unsafe numeric parameter.`
                );
            }
        }
        const expectedRows = expectedRowsAffected?.[statementIndex];
        if (
            expectedRows !== undefined &&
            (!Number.isSafeInteger(expectedRows) || expectedRows < 0)
        ) {
            throw new Error(
                `SQLite transaction statement ${statementIndex + 1} has an invalid expected row count.`
            );
        }
    }

    await initializeDatabase();
    return invoke<number[]>("execute_sqlite_transaction", {
        statements: statements.map((statement) => ({
            query: statement.query,
            parameters: [...statement.parameters]
        })),
        ...(expectedRowsAffected === undefined
            ? {}
            : { expectedRowsAffected: [...expectedRowsAffected] })
    });
}
