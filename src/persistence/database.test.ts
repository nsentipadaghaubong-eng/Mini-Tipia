import Database from "@tauri-apps/plugin-sql";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
    invokeMock: vi.fn()
}));

vi.mock("@tauri-apps/api/core", () => ({
    invoke: invokeMock
}));

class TestDatabase extends Database {
    closeCalls = 0;
    closeResult = true;

    async close(): Promise<boolean> {
        this.closeCalls += 1;
        return this.closeResult;
    }
}

describe("SQLite database connection", () => {
    type LoadDatabaseMock = {
        mockResolvedValue(value: Database): LoadDatabaseMock;
        mockResolvedValueOnce(value: Database): LoadDatabaseMock;
        mockRejectedValue(reason: unknown): LoadDatabaseMock;
    };
    let loadDatabase: LoadDatabaseMock;
    let initializeDatabase: typeof import("./database")["initializeDatabase"];
    let closeDatabase: typeof import("./database")["closeDatabase"];

    beforeEach(async () => {
        vi.resetModules();
        invokeMock.mockReset();
        invokeMock.mockResolvedValue(undefined);
        const plugin = await import("@tauri-apps/plugin-sql");
        loadDatabase = vi.spyOn(plugin.default, "load");
        ({ initializeDatabase, closeDatabase } = await import("./database"));
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("opens sqlite:tipia.db and verifies foreign keys through the Rust boundary", async () => {
        const database = new TestDatabase("sqlite:tipia.db");
        loadDatabase.mockResolvedValue(database);

        const result = await initializeDatabase();

        expect(loadDatabase).toHaveBeenCalledOnce();
        expect(loadDatabase).toHaveBeenCalledWith("sqlite:tipia.db");
        expect(invokeMock).toHaveBeenCalledTimes(2);
        expect(invokeMock).toHaveBeenNthCalledWith(1, "verify_sqlite_connection");
        expect(invokeMock).toHaveBeenNthCalledWith(2, "initialize_sqlite_schema");
        expect(result.foreignKeysEnabled).toBe(true);
        expect(result.database).toBe(database);
    });

    it("reuses one connection for concurrent and later initialization calls", async () => {
        const database = new TestDatabase("sqlite:tipia.db");
        loadDatabase.mockResolvedValue(database);

        const [first, second] = await Promise.all([
            initializeDatabase(),
            initializeDatabase()
        ]);
        const third = await initializeDatabase();

        expect(first).toBe(second);
        expect(second).toBe(third);
        expect(loadDatabase).toHaveBeenCalledOnce();
    });

    it("surfaces plugin connection failures", async () => {
        loadDatabase.mockRejectedValue(new Error("plugin unavailable"));

        await expect(initializeDatabase()).rejects.toThrow(
            "Unable to initialize SQLite database (sqlite:tipia.db): plugin unavailable"
        );
    });

    it("surfaces failed foreign-key verification and closes the partial connection", async () => {
        const database = new TestDatabase("sqlite:tipia.db");
        loadDatabase.mockResolvedValue(database);
        invokeMock.mockRejectedValue(
            new Error("SQLite foreign-key enforcement is not enabled.")
        );

        await expect(initializeDatabase()).rejects.toThrow(
            "SQLite foreign-key enforcement is not enabled."
        );
        expect(database.closeCalls).toBe(1);
    });

    it("stops initialization when migration execution fails and closes the partial connection", async () => {
        const database = new TestDatabase("sqlite:tipia.db");
        loadDatabase.mockResolvedValue(database);
        invokeMock
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(
                new Error("Migration 001 failed: checksum mismatch")
            );

        await expect(initializeDatabase()).rejects.toThrow(
            "Unable to initialize SQLite database (sqlite:tipia.db): Migration 001 failed: checksum mismatch"
        );
        expect(invokeMock).toHaveBeenNthCalledWith(1, "verify_sqlite_connection");
        expect(invokeMock).toHaveBeenNthCalledWith(2, "initialize_sqlite_schema");
        expect(database.closeCalls).toBe(1);
    });

    it("reports when a failed initialization cannot confirm partial-connection cleanup", async () => {
        const database = new TestDatabase("sqlite:tipia.db");
        database.closeResult = false;
        loadDatabase.mockResolvedValue(database);
        invokeMock.mockRejectedValue(
            new Error("SQLite foreign-key enforcement is not enabled.")
        );

        await expect(initializeDatabase()).rejects.toThrow(
            "The partially initialized connection did not confirm closure (close returned false)."
        );
    });

    it("closes the active connection and permits a later fresh initialization", async () => {
        const firstDatabase = new TestDatabase("sqlite:tipia.db");
        const nextDatabase = new TestDatabase("sqlite:tipia.db");
        loadDatabase
            .mockResolvedValueOnce(firstDatabase)
            .mockResolvedValueOnce(nextDatabase);

        await initializeDatabase();

        await expect(closeDatabase()).resolves.toBe(true);
        await expect(closeDatabase()).resolves.toBe(false);
        expect(firstDatabase.closeCalls).toBe(1);

        const nextConnection = await initializeDatabase();
        expect(nextConnection.database).toBe(nextDatabase);
        expect(loadDatabase).toHaveBeenCalledTimes(2);
    });
});
