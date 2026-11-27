// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    within
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { ApplicationStateHydration } from "./persistence/applicationStateHydration";
import type { PersistedSale } from "./persistence/repositories/salesRepository";

const mocks = vi.hoisted(() => ({
    loadApplicationStateHydration: vi.fn()
}));

vi.mock("./persistence/applicationStartup", () => ({
    loadApplicationStateHydration: mocks.loadApplicationStateHydration
}));

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

const sqliteProduct = {
    id: "sqlite-product",
    name: "SQLite Hydrated Medicine",
    genericName: "Hydrated medicine",
    variant: [{
        id: "sqlite-variant",
        variantName: "250 mg capsule",
        packagingHierarchy: [{
            id: "sqlite-packaging",
            name: "Box",
            costPrice: 3,
            sellingPrice: 6,
            quantityofNextLevel: null,
            nextLevelId: null
        }]
    }]
};

const sqliteInventoryRecord = {
    id: "sqlite-inventory",
    productId: sqliteProduct.id,
    variantId: sqliteProduct.variant[0].id,
    batchId: "sqlite-batch",
    stockQuantities: [{
        packagingLevelId: "sqlite-packaging",
        quantity: 7
    }]
};

const sqliteInventoryBatch = {
    batchId: "sqlite-batch",
    productId: sqliteProduct.id,
    variantId: sqliteProduct.variant[0].id,
    batchNumber: "SQLITE-LOT-1",
    expiryDate: new Date("2027-06-30T00:00:00.000Z"),
    pricingByPackagingLevel: [{
        packagingLevelId: "sqlite-packaging",
        costPrice: 3,
        sellingPrice: 6
    }]
};

const hydratedSqliteData: ApplicationStateHydration = {
    ...emptyHydration,
    products: [{
        sourceRecord: sqliteProduct,
        domainProjection: { status: "available", value: sqliteProduct },
        persistenceOnlyFields: []
    }],
    inventoryRecords: [{
        sourceRecord: sqliteInventoryRecord,
        domainProjection: {
            status: "available",
            value: sqliteInventoryRecord
        },
        persistenceOnlyFields: []
    }],
    inventoryBatches: [{
        sourceRecord: sqliteInventoryBatch,
        domainProjection: {
            status: "available",
            value: sqliteInventoryBatch
        },
        persistenceOnlyFields: []
    }]
};

const persistenceOnlySale: ApplicationStateHydration["completedSales"][number] = {
    sourceRecord: {
        saleId: "opaque-sale",
        status: "completed",
        sourceDraftId: "source-draft",
        completedEventId: "sale-event",
        completedAt: "2026-11-26T12:00:00.000Z",
        customerName: null,
        customerAddress: null,
        saleDate: null,
        staffUserId: null,
        staffDisplayName: null,
        notes: null,
        items: [],
        subtotal: 0,
        discountAmount: 0,
        finalAmount: 0,
        expiredBatchConfirmed: false
    } satisfies PersistedSale,
    domainProjection: {
        status: "persistence-only",
        reason: "Unsupported snapshot"
    },
    persistenceOnlyFields: ["itemSnapshotJson"]
} satisfies ApplicationStateHydration["completedSales"][number];

afterEach(() => {
    cleanup();
});

beforeEach(() => {
    vi.clearAllMocks();
});

describe("App SQLite startup gate", () => {
    it("does not render demo-backed workflows while hydration is pending", () => {
        mocks.loadApplicationStateHydration.mockReturnValue(new Promise(() => {}));

        render(<App />);

        expect(screen.getByRole("heading", {
            name: "Loading SQLite application data"
        })).toBeVisible();
        expect(screen.queryByRole("link", { name: "Sales" }))
            .not.toBeInTheDocument();
        expect(screen.queryByLabelText("Loaded application data"))
            .not.toBeInTheDocument();
    });

    it("mounts the normal interface with hydrated SQLite data and retains persistence-only rows", async () => {
        mocks.loadApplicationStateHydration.mockResolvedValue({
            ...emptyHydration,
            ...hydratedSqliteData,
            completedSales: [persistenceOnlySale]
        });

        render(<App />);

        expect(await screen.findByRole("link", { name: "Products" }))
            .toBeVisible();
        expect(screen.queryByRole("heading", { name: "SQLite data loaded" }))
            .not.toBeInTheDocument();
        expect(screen.getByRole("status")).toHaveTextContent(
            "Catalogue-only Product creation, Variant addition, and Product and packaging edits are saved to SQLite. Other workflows are not persisted yet."
        );
        expect(screen.getByRole("status")).toHaveTextContent(
            "1 persistence-only record(s) remain retained in the hydration model"
        );

        fireEvent.click(screen.getByRole("link", { name: "Products" }));
        expect(screen.getByRole("heading", {
            name: "SQLite Hydrated Medicine"
        })).toBeVisible();

        fireEvent.click(screen.getByRole("link", { name: "Inventory" }));
        const inventoryCard = screen.getByRole("article");
        fireEvent.click(within(inventoryCard).getByRole("button", {
            name: "View"
        }));
        fireEvent.click(screen.getByRole("button", {
            name: /250 mg capsule/
        }));
        expect(screen.getByText("SQLITE-LOT-1")).toBeVisible();
        expect(screen.getAllByText("7")).toHaveLength(2);
    });

    it("mounts an empty workspace without injecting demo Products or Inventory", async () => {
        mocks.loadApplicationStateHydration.mockResolvedValue(emptyHydration);

        render(<App />);

        expect(await screen.findByRole("link", { name: "Products" }))
            .toBeVisible();
        fireEvent.click(screen.getByRole("link", { name: "Products" }));
        expect(screen.getByText(
            "No products yet. Create a product to get started."
        )).toBeVisible();
        expect(screen.queryByRole("article")).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole("link", { name: "Inventory" }));
        expect(screen.getByText("No inventory found")).toBeVisible();
        expect(screen.queryByRole("article")).not.toBeInTheDocument();
    });

    it("shows startup errors and retries without exposing workflows", async () => {
        mocks.loadApplicationStateHydration
            .mockRejectedValueOnce(new Error("SQLite initialization failed: locked"))
            .mockResolvedValueOnce(emptyHydration);

        render(<App />);

        expect(await screen.findByRole("alert"))
            .toHaveTextContent("SQLite initialization failed: locked");
        expect(screen.queryByRole("link", { name: "Inventory" }))
            .not.toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Retry" }));

        expect(await screen.findByRole("link", { name: "Products" }))
            .toBeVisible();
        expect(mocks.loadApplicationStateHydration).toHaveBeenCalledTimes(2);
    });
});
