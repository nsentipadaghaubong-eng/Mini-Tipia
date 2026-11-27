import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApplicationDataAssembly } from "./applicationDataLoader";
import type { ApplicationStateHydration } from "./applicationStateHydration";

const mocks = vi.hoisted(() => ({
    initializeDatabase: vi.fn(),
    loadApplicationData: vi.fn(),
    createApplicationStateHydration: vi.fn()
}));

vi.mock("./database", () => ({
    initializeDatabase: mocks.initializeDatabase
}));

vi.mock("./applicationDataLoader", () => ({
    loadApplicationData: mocks.loadApplicationData
}));

vi.mock("./applicationStateHydration", () => ({
    createApplicationStateHydration: mocks.createApplicationStateHydration
}));

const emptyAssembly: ApplicationDataAssembly = {
    products: [],
    inventoryRecords: [],
    inventoryBatches: [],
    activityEvents: [],
    completedSales: [],
    receivedDeliveries: [],
    activeSaleDrafts: [],
    activeDeliveryDrafts: [],
    persistenceLimitations: []
};

const emptyHydration: ApplicationStateHydration = {
    products: [],
    inventoryRecords: [],
    inventoryBatches: [],
    activityEvents: [],
    completedSales: [],
    receivedDeliveries: [],
    activeSaleDrafts: [],
    activeDeliveryDrafts: [],
    persistenceLimitations: []
};

async function getStartupModule() {
    return import("./applicationStartup");
}

describe("SQLite application startup", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        mocks.initializeDatabase.mockResolvedValue({});
        mocks.loadApplicationData.mockResolvedValue(emptyAssembly);
        mocks.createApplicationStateHydration.mockReturnValue(emptyHydration);
    });

    it("initializes, loads, then hydrates and returns the retained model", async () => {
        const order: string[] = [];
        mocks.initializeDatabase.mockImplementation(async () => {
            order.push("initialize");
            return {};
        });
        mocks.loadApplicationData.mockImplementation(async () => {
            order.push("load");
            return emptyAssembly;
        });
        mocks.createApplicationStateHydration.mockImplementation(() => {
            order.push("hydrate");
            return emptyHydration;
        });

        const { loadApplicationStateHydration } = await getStartupModule();
        const result = await loadApplicationStateHydration();

        expect(order).toEqual(["initialize", "load", "hydrate"]);
        expect(result).toBe(emptyHydration);
    });

    it("does not load application data when database initialization fails", async () => {
        mocks.initializeDatabase.mockRejectedValue(new Error("database unavailable"));
        const { loadApplicationStateHydration } = await getStartupModule();

        await expect(loadApplicationStateHydration()).rejects.toThrow(
            "SQLite initialization failed: database unavailable"
        );
        expect(mocks.loadApplicationData).not.toHaveBeenCalled();
        expect(mocks.createApplicationStateHydration).not.toHaveBeenCalled();
    });

    it("surfaces loader failure without creating a partial hydration", async () => {
        mocks.loadApplicationData.mockRejectedValue(new Error("snapshot failed"));
        const { loadApplicationStateHydration } = await getStartupModule();

        await expect(loadApplicationStateHydration()).rejects.toThrow(
            "SQLite application data loading failed: snapshot failed"
        );
        expect(mocks.createApplicationStateHydration).not.toHaveBeenCalled();
    });

    it("surfaces hydration failure instead of publishing loaded DTOs", async () => {
        mocks.createApplicationStateHydration.mockImplementation(() => {
            throw new Error("invalid persisted projection");
        });
        const { loadApplicationStateHydration } = await getStartupModule();

        await expect(loadApplicationStateHydration()).rejects.toThrow(
            "SQLite application data hydration failed: invalid persisted projection"
        );
    });

    it("deduplicates concurrent startup attempts", async () => {
        let finishInitialization: (() => void) | undefined;
        mocks.initializeDatabase.mockImplementation(() =>
            new Promise<void>((resolve) => {
                finishInitialization = resolve;
            })
        );
        const { loadApplicationStateHydration } = await getStartupModule();

        const firstAttempt = loadApplicationStateHydration();
        const secondAttempt = loadApplicationStateHydration();
        expect(secondAttempt).toBe(firstAttempt);

        finishInitialization?.();
        await expect(firstAttempt).resolves.toBe(emptyHydration);
        expect(mocks.initializeDatabase).toHaveBeenCalledTimes(1);
    });

    it("permits retry after an initialization failure", async () => {
        mocks.initializeDatabase
            .mockRejectedValueOnce(new Error("temporary failure"))
            .mockResolvedValue({});
        const { loadApplicationStateHydration } = await getStartupModule();

        await expect(loadApplicationStateHydration()).rejects.toThrow(
            "temporary failure"
        );
        await expect(loadApplicationStateHydration()).resolves.toBe(emptyHydration);
        expect(mocks.initializeDatabase).toHaveBeenCalledTimes(2);
    });
});
