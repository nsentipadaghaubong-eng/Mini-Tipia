import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SqliteStatement } from "./transaction";

const { initializeDatabaseMock, invokeMock } = vi.hoisted(() => ({
    initializeDatabaseMock: vi.fn(),
    invokeMock: vi.fn()
}));

vi.mock("./database", () => ({
    initializeDatabase: initializeDatabaseMock
}));

vi.mock("@tauri-apps/api/core", () => ({
    invoke: invokeMock
}));

const { executeTransaction } = await import("./transaction");

describe("SQLite transaction boundary", () => {
    beforeEach(() => {
        initializeDatabaseMock.mockReset();
        initializeDatabaseMock.mockResolvedValue({
            foreignKeysEnabled: true
        });
        invokeMock.mockReset();
        invokeMock.mockResolvedValue([1, 1]);
    });

    it("initializes the database before invoking one transaction batch", async () => {
        const statements: SqliteStatement[] = [
            { query: "INSERT INTO parents(id) VALUES ($1)", parameters: [4] },
            { query: "INSERT INTO children(parent_id) VALUES ($1)", parameters: [4] }
        ];

        await expect(executeTransaction(statements)).resolves.toEqual([1, 1]);

        expect(initializeDatabaseMock).toHaveBeenCalledOnce();
        expect(invokeMock).toHaveBeenCalledOnce();
        expect(invokeMock).toHaveBeenCalledWith(
            "execute_sqlite_transaction",
            { statements }
        );
        expect(initializeDatabaseMock.mock.invocationCallOrder[0])
            .toBeLessThan(invokeMock.mock.invocationCallOrder[0]);
    });

    it("does not invoke the Rust command when initialization fails", async () => {
        initializeDatabaseMock.mockRejectedValue(new Error("not initialized"));

        await expect(executeTransaction([
            { query: "INSERT INTO parents(id) VALUES ($1)", parameters: [1] }
        ])).rejects.toThrow("not initialized");

        expect(invokeMock).not.toHaveBeenCalled();
    });

    it("rejects empty batches and unsafe numbers before invoking Rust", async () => {
        await expect(executeTransaction([])).rejects.toThrow(
            "A SQLite transaction must contain at least one statement."
        );
        await expect(executeTransaction([
            {
                query: "INSERT INTO parents(id) VALUES ($1)",
                parameters: [Number.MAX_SAFE_INTEGER + 1]
            }
        ])).rejects.toThrow("unsafe numeric parameter");

        expect(invokeMock).not.toHaveBeenCalled();
    });

    it("passes values as parameters instead of interpolating them into SQL", async () => {
        const injectedText = "value'); DELETE FROM parents; --";
        const statement: SqliteStatement = {
            query: "INSERT INTO parents(label) VALUES ($1)",
            parameters: [injectedText]
        };

        await executeTransaction([statement]);

        expect(invokeMock).toHaveBeenCalledWith(
            "execute_sqlite_transaction",
            { statements: [statement] }
        );
    });

    it("passes expected row counts to the transaction for in-transaction enforcement", async () => {
        const statements: SqliteStatement[] = [
            { query: "INSERT INTO parents(id) VALUES ($1)", parameters: [4] },
            { query: "UPDATE parents SET id = $1 WHERE id = $2", parameters: [5, 4] }
        ];

        await executeTransaction(statements, [1, 1]);

        expect(invokeMock).toHaveBeenCalledWith(
            "execute_sqlite_transaction",
            { statements, expectedRowsAffected: [1, 1] }
        );
    });

    it("rejects malformed expected row counts before invoking Rust", async () => {
        const statement: SqliteStatement = {
            query: "INSERT INTO parents(id) VALUES ($1)",
            parameters: [1]
        };

        await expect(executeTransaction([statement], [1, 1])).rejects.toThrow(
            "must match the statement count"
        );
        await expect(executeTransaction([statement], [-1])).rejects.toThrow(
            "invalid expected row count"
        );

        expect(invokeMock).not.toHaveBeenCalled();
    });

    it("surfaces transaction command failures to the caller", async () => {
        invokeMock.mockRejectedValue(
            new Error("SQLite transaction failed at statement 2.")
        );

        await expect(executeTransaction([
            { query: "INSERT INTO parents(id) VALUES ($1)", parameters: [1] }
        ])).rejects.toThrow("SQLite transaction failed at statement 2.");
    });
});
