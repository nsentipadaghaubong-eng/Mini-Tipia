import { createApplicationStateHydration } from "./applicationStateHydration";
import type { ApplicationStateHydration } from "./applicationStateHydration";
import { loadApplicationData } from "./applicationDataLoader";
import type { ApplicationDataAssembly } from "./applicationDataLoader";
import { initializeDatabase } from "./database";

let applicationHydrationPromise: Promise<ApplicationStateHydration> | null = null;

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function initializeAndHydrate(): Promise<ApplicationStateHydration> {
    try {
        await initializeDatabase();
    } catch (error) {
        throw new Error(
            `SQLite initialization failed: ${describeError(error)}`,
            { cause: error }
        );
    }

    let data: ApplicationDataAssembly;
    try {
        data = await loadApplicationData();
    } catch (error) {
        throw new Error(
            `SQLite application data loading failed: ${describeError(error)}`,
            { cause: error }
        );
    }

    try {
        return createApplicationStateHydration(data);
    } catch (error) {
        throw new Error(
            `SQLite application data hydration failed: ${describeError(error)}`,
            { cause: error }
        );
    }
}

export function loadApplicationStateHydration():
Promise<ApplicationStateHydration> {
    if (applicationHydrationPromise) {
        return applicationHydrationPromise;
    }

    const pending = initializeAndHydrate();
    applicationHydrationPromise = pending;
    void pending.catch(() => {
        if (applicationHydrationPromise === pending) {
            applicationHydrationPromise = null;
        }
    });
    return pending;
}
