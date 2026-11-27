import { beforeEach, describe, expect, it, vi } from "vitest";

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

const {
    createSqliteReadSnapshotExecutor,
    querySqlite
} = await import("./query");

describe("SQLite read query boundary", () => {
    beforeEach(() => {
        initializeDatabaseMock.mockReset();
        initializeDatabaseMock.mockResolvedValue({
            foreignKeysEnabled: true
        });
        invokeMock.mockReset();
    });

    it("initializes the database and forwards a parameterized query", async () => {
        const query = "SELECT id, label FROM parents WHERE id >= $1 ORDER BY id";
        const parameters = [2];
        const result = {
            columns: ["id", "label"],
            rows: [[2, "second"], [3, "third"]]
        };
        invokeMock.mockResolvedValue(result);

        await expect(querySqlite(query, parameters)).resolves.toEqual(result);

        expect(initializeDatabaseMock).toHaveBeenCalledOnce();
        expect(invokeMock).toHaveBeenCalledOnce();
        expect(invokeMock).toHaveBeenCalledWith(
            "query_sqlite_readonly",
            { query, parameters }
        );
        expect(initializeDatabaseMock.mock.invocationCallOrder[0])
            .toBeLessThan(invokeMock.mock.invocationCallOrder[0]);
    });

    it("forwards values separately from SQL text", async () => {
        const injectedText = "value'); DELETE FROM parents; --";
        invokeMock.mockResolvedValue({
            columns: ["value"],
            rows: [[injectedText]]
        });

        await querySqlite("SELECT $1 AS value", [injectedText]);

        expect(invokeMock).toHaveBeenCalledWith(
            "query_sqlite_readonly",
            {
                query: "SELECT $1 AS value",
                parameters: [injectedText]
            }
        );
    });

    it("rejects empty SQL and unsafe numbers before invoking Rust", async () => {
        await expect(querySqlite("  ")).rejects.toThrow(
            "A SQLite read query must not be empty."
        );
        await expect(querySqlite("SELECT $1", [Number.MAX_SAFE_INTEGER + 1]))
            .rejects.toThrow("unsafe numeric parameter");
        await expect(querySqlite("SELECT $1", [Number.POSITIVE_INFINITY]))
            .rejects.toThrow("unsafe numeric parameter");

        expect(invokeMock).not.toHaveBeenCalled();
    });

    it("does not query when database initialization fails", async () => {
        initializeDatabaseMock.mockRejectedValue(new Error("not initialized"));

        await expect(querySqlite("SELECT 1")).rejects.toThrow("not initialized");
        expect(invokeMock).not.toHaveBeenCalled();
    });

    it("surfaces read query command failures", async () => {
        invokeMock.mockRejectedValue(new Error("SQLite read query failed."));

        await expect(querySqlite("SELECT * FROM missing_table"))
            .rejects.toThrow("SQLite read query failed.");
    });

    it("submits all snapshot queries in one parameterized native read call", async () => {
        const firstResult = { columns: ["id"], rows: [[1]] };
        const secondResult = { columns: ["name"], rows: [["draft"]] };
        invokeMock.mockResolvedValue([firstResult, secondResult]);

        const snapshot = createSqliteReadSnapshotExecutor();
        const first = snapshot.query("SELECT id FROM products WHERE id = $1", [1]);
        const second = snapshot.query(
            "SELECT name FROM drafts WHERE status = $1",
            ["draft"]
        );

        await snapshot.execute();

        await expect(Promise.all([first, second])).resolves.toEqual([
            firstResult,
            secondResult
        ]);
        expect(initializeDatabaseMock).toHaveBeenCalledOnce();
        expect(invokeMock).toHaveBeenCalledOnce();
        expect(invokeMock).toHaveBeenCalledWith(
            "query_sqlite_readonly_snapshot",
            {
                queries: [
                    {
                        query: "SELECT id FROM products WHERE id = $1",
                        parameters: [1]
                    },
                    {
                        query: "SELECT name FROM drafts WHERE status = $1",
                        parameters: ["draft"]
                    }
                ]
            }
        );
    });

    it("rejects every queued repository read when snapshot execution fails", async () => {
        invokeMock.mockRejectedValue(new Error("read snapshot failed"));
        const snapshot = createSqliteReadSnapshotExecutor();
        const first = snapshot.query("SELECT 1");
        const second = snapshot.query("SELECT 2");

        await snapshot.execute();

        await expect(Promise.all([first, second]))
            .rejects.toThrow("read snapshot failed");
        expect(invokeMock).toHaveBeenCalledOnce();
    });

    it("rejects invalid snapshot queries before invoking Rust", async () => {
        const snapshot = createSqliteReadSnapshotExecutor();
        await expect(snapshot.query(" ", [])).rejects.toThrow(
            "A SQLite read query must not be empty."
        );
        expect(invokeMock).not.toHaveBeenCalled();
    });
});
