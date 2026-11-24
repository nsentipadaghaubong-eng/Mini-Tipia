// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    within
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import * as applicationState from "./applicationState";
import type { ApplicationState } from "./applicationState";
import {
    createSaleDraft,
    updateSaleDraftDetails
} from "./sales/salesDraft";
import { createDeliveryDraft } from "./deliveries/deliveryDraft";

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

function makeSaleDraft(draftId: string, customerName: string) {
    const draft = createSaleDraft({
        makeId: () => draftId,
        now: () => new Date("2026-11-07T12:00:00.000Z")
    });
    return updateSaleDraftDetails(draft, {
        customerName,
        saleDate: "2026-11-07",
        staffMember: { displayName: `Staff for ${customerName}` }
    }, "2026-11-07T12:01:00.000Z");
}

function makeDeliveryDraft(
    deliveryId: string,
    supplier: string,
    invoiceNumber: string
) {
    return createDeliveryDraft({
        deliveryDate: "2026-11-07",
        receivedBy: `Staff for ${supplier}`,
        supplier,
        invoiceNumber
    }, {
        makeId: () => deliveryId,
        now: () => new Date("2026-11-07T12:00:00.000Z")
    });
}

function seedDrafts(
    saleDrafts: ReturnType<typeof makeSaleDraft>[],
    deliveryDrafts: ReturnType<typeof makeDeliveryDraft>[]
) {
    const createInitialState = applicationState.createInitialApplicationState;
    vi.spyOn(applicationState, "createInitialApplicationState")
        .mockImplementation(() => ({
            ...createInitialState(),
            saleDrafts,
            deliveryDrafts
        }));
}

function makeSalesAppState(): ApplicationState {
    const product: ApplicationState["products"][number] = {
        id: "app-sale-product",
        name: "App Sale Medicine",
        genericName: "Test medicine",
        variant: [{
            id: "app-sale-variant",
            variantName: "500 mg tablet",
            packagingHierarchy: [{
                id: "app-sale-box",
                name: "Box",
                costPrice: 5,
                sellingPrice: 10,
                quantityofNextLevel: null,
                nextLevelId: null
            }]
        }]
    };
    const inventoryRecord: ApplicationState["inventoryRecords"][number] = {
        id: "app-sale-inventory",
        productId: product.id,
        variantId: product.variant[0].id,
        batchId: "app-sale-batch",
        stockQuantities: [{
            packagingLevelId: "app-sale-box",
            quantity: 5
        }]
    };
    const inventoryBatch: ApplicationState["inventoryBatches"][number] = {
        batchId: "app-sale-batch",
        productId: product.id,
        variantId: product.variant[0].id,
        batchNumber: "APP-LOT-1",
        expiryDate: new Date("2027-06-30T00:00:00.000Z"),
        pricingByPackagingLevel: [{
            packagingLevelId: "app-sale-box",
            costPrice: 5,
            sellingPrice: 10
        }]
    };

    return {
        ...applicationState.createInitialApplicationState(),
        products: [product],
        inventoryRecords: [inventoryRecord],
        inventoryBatches: [inventoryBatch],
        activityEvents: [],
        sales: [],
        saleDrafts: [],
        deliveryDrafts: []
    };
}

function seedAppState(state: ApplicationState) {
    vi.spyOn(applicationState, "createInitialApplicationState")
        .mockReturnValue(state);
    const reduce = applicationState.applicationReducer;
    let latestState = state;
    vi.spyOn(applicationState, "applicationReducer")
        .mockImplementation((currentState, action) => {
            latestState = reduce(currentState, action);
            return latestState;
        });
    return () => latestState;
}

describe("Dashboard pending draft navigation", () => {
    it("opens the exact second pending Sales draft through App", () => {
        const firstDraft = makeSaleDraft("sale-first-app", "First customer");
        const secondDraft = makeSaleDraft("sale-second-app", "Second customer");
        const firstDraftSnapshot = structuredClone(firstDraft);
        seedDrafts([firstDraft, secondDraft], []);

        render(<App />);
        const salesButtons = screen.getAllByRole("button", {
            name: "Open Sales"
        });
        expect(salesButtons).toHaveLength(2);
        fireEvent.click(salesButtons[1]);

        expect(screen.getByLabelText("Customer Name"))
            .toHaveValue("Second customer");
        expect(firstDraft).toEqual(firstDraftSnapshot);
    });

    it("opens the exact second pending Receive Delivery draft through App", () => {
        const firstDraft = makeDeliveryDraft(
            "delivery-first-app",
            "Supplier One",
            "INV-ONE"
        );
        const secondDraft = makeDeliveryDraft(
            "delivery-second-app",
            "Supplier Two",
            "INV-TWO"
        );
        const firstDraftSnapshot = structuredClone(firstDraft);
        seedDrafts([], [firstDraft, secondDraft]);

        render(<App />);
        const deliveryButtons = screen.getAllByRole("button", {
            name: "Open Receive Delivery"
        });
        expect(deliveryButtons).toHaveLength(2);
        fireEvent.click(deliveryButtons[1]);

        expect(screen.getByLabelText("Supplier")).toHaveValue("Supplier Two");
        expect(screen.getByLabelText("Invoice Number")).toHaveValue("INV-TWO");
        expect(firstDraft).toEqual(firstDraftSnapshot);
    });
});

describe("App Sales approval workflow", () => {
    it("creates and approves a sale through App, updating stock and releasing the product lock", () => {
        const initialState = makeSalesAppState();
        const getLatestState = seedAppState(initialState);

        render(<App />);
        const salesPage = document.querySelector<HTMLElement>(".sales-page");
        if (!salesPage) {
            throw new Error("The Sales page was not rendered by App.");
        }
        const sales = within(salesPage);
        fireEvent.click(screen.getByRole("link", { name: "Sales" }));
        fireEvent.change(sales.getByLabelText("Received By *"), {
            target: { value: "Staff One" }
        });
        fireEvent.change(sales.getByRole("searchbox", {
            name: "Search products"
        }), {
            target: { value: "App Sale Medicine" }
        });
        fireEvent.click(sales.getByRole("button", {
            name: "App Sale Medicine"
        }));
        fireEvent.click(sales.getByRole("button", {
            name: "500 mg tablet"
        }));
        fireEvent.change(sales.getByLabelText("Select inventory record"), {
            target: { value: "app-sale-inventory" }
        });
        fireEvent.change(sales.getByLabelText("Select packaging level"), {
            target: { value: "app-sale-box" }
        });
        fireEvent.change(sales.getByLabelText("Sale quantity"), {
            target: { value: "2" }
        });
        fireEvent.click(sales.getByRole("button", { name: "Add to Sales" }));

        const stagedState = getLatestState();
        expect(stagedState.saleDrafts).toHaveLength(1);
        expect(stagedState.saleDrafts[0].status).toBe("draft");
        expect(stagedState.inventoryRecords).toEqual(initialState.inventoryRecords);
        expect(stagedState.inventoryBatches).toEqual(initialState.inventoryBatches);
        expect(stagedState.activityEvents.some(
            (event) => event.type === "sale.completed"
        )).toBe(false);

        fireEvent.click(screen.getByRole("link", { name: "Dashboard" }));
        expect(screen.getByRole("heading", { name: "Pending Sale" }))
            .toBeVisible();
        expect(screen.getByRole("button", { name: "Open Sales" }))
            .toBeVisible();

        fireEvent.click(screen.getByRole("link", { name: "Products" }));
        fireEvent.click(screen.getByRole("button", {
            name: "Edit App Sale Medicine"
        }));
        expect(screen.getByRole("button", { name: "Add variant" }))
            .toBeDisabled();
        expect(screen.getByRole("alert")).toHaveTextContent(
            "This product is currently in a Sales draft."
        );
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

        fireEvent.click(screen.getByRole("link", { name: "Sales" }));
        fireEvent.click(sales.getByRole("button", { name: "Approve Sale" }));

        const completedState = getLatestState();
        expect(completedState.inventoryRecords[0]?.stockQuantities).toEqual([{
            packagingLevelId: "app-sale-box",
            quantity: 3
        }]);
        expect(completedState.sales).toHaveLength(1);
        const completedSale = completedState.sales[0];
        expect(completedSale?.items[0]?.quantity).toBe(2);
        expect(completedSale?.finalAmount).toBe(20);
        expect(completedState.saleDrafts[0]?.status).toBe("approved");
        expect(completedState.activityEvents.filter(
            (event) => event.type === "sale.completed"
        )).toHaveLength(1);
        const completedEvent = completedState.activityEvents.find(
            (event) =>
                event.type === "sale.completed" &&
                event.saleId === completedSale?.saleId
        );
        expect(completedEvent).toMatchObject({
            type: "sale.completed",
            saleId: completedSale?.saleId,
            items: [{
                productId: "app-sale-product",
                variantId: "app-sale-variant",
                quantity: 2
            }]
        });

        fireEvent.click(screen.getByRole("link", { name: "Dashboard" }));
        expect(screen.queryByRole("heading", { name: "Pending Sale" }))
            .not.toBeInTheDocument();
        expect(screen.getByText(
            "There are no pending Sales or Receive Delivery drafts."
        )).toBeVisible();

        fireEvent.click(screen.getByRole("link", { name: "Products" }));
        fireEvent.click(screen.getByRole("button", {
            name: "Edit App Sale Medicine"
        }));
        expect(screen.getByRole("button", { name: "Add variant" }))
            .toBeEnabled();
        expect(screen.queryByText(
            "This product is currently in a Sales draft."
        )).not.toBeInTheDocument();
    });
});

describe("App Receive Delivery approval workflow", () => {
    it("cancels a draft through App, removes it from pending deliveries, and retains Activity", () => {
        const draft = makeDeliveryDraft(
            "delivery-cancel-app",
            "Cancellation Supplier",
            "CANCEL-INV"
        );
        const initialState = {
            ...makeSalesAppState(),
            deliveryDrafts: [draft]
        };
        const inventoryRecords = structuredClone(initialState.inventoryRecords);
        const inventoryBatches = structuredClone(initialState.inventoryBatches);
        const getLatestState = seedAppState(initialState);

        render(<App />);
        fireEvent.click(screen.getByRole("link", {
            name: "Receive Delivery"
        }));
        fireEvent.click(screen.getByRole("button", { name: "Delete" }));

        const cancelledState = getLatestState();
        expect(cancelledState.deliveryDrafts).toEqual([]);
        expect(cancelledState.inventoryRecords).toEqual(inventoryRecords);
        expect(cancelledState.inventoryBatches).toEqual(inventoryBatches);
        expect(cancelledState.activityEvents.filter(
            (event) => event.type === "delivery.draft_cancelled"
        )).toHaveLength(1);
        expect(cancelledState.activityEvents.some(
            (event) => event.type === "delivery.received"
        )).toBe(false);
        expect(cancelledState.activityEvents.some(
            (event) => event.type === "inventory.batch_created"
        )).toBe(false);

        fireEvent.click(screen.getByRole("link", { name: "Dashboard" }));
        expect(screen.queryByRole("heading", { name: "Pending Delivery" }))
            .not.toBeInTheDocument();
        expect(screen.getByText(
            "There are no pending Sales or Receive Delivery drafts."
        )).toBeVisible();

        fireEvent.click(screen.getByRole("link", { name: "Activity" }));
        expect(screen.getByText("Delivery draft cancelled")).toBeVisible();
        expect(screen.getByText(/Cancellation Supplier/, {
            selector: ".activity-entry-summary"
        })).toBeVisible();
    });

    it("receives a delivery through App, updating inventory and releasing the product lock", () => {
        const initialState = makeSalesAppState();
        const getLatestState = seedAppState(initialState);

        render(<App />);
        const deliveryPage = document.querySelector<HTMLElement>(
            ".receive-delivery-page"
        );
        if (!deliveryPage) {
            throw new Error("The Receive Delivery page was not rendered by App.");
        }
        const delivery = within(deliveryPage);
        fireEvent.click(screen.getByRole("link", { name: "Receive Delivery" }));
        fireEvent.change(delivery.getByLabelText("Supplier"), {
            target: { value: "App Delivery Supplier" }
        });
        fireEvent.change(delivery.getByLabelText("Invoice Number"), {
            target: { value: "APP-INV-2" }
        });
        fireEvent.change(delivery.getByLabelText("Delivery Date *"), {
            target: { value: "2026-11-20" }
        });
        fireEvent.change(delivery.getByLabelText("Received By *"), {
            target: { value: "Staff One" }
        });
        fireEvent.change(delivery.getByLabelText("Search products"), {
            target: { value: "App Sale Medicine" }
        });
        fireEvent.click(delivery.getByRole("option", {
            name: "Select product App Sale Medicine"
        }));
        fireEvent.click(delivery.getByRole("button", {
            name: "500 mg tablet"
        }));

        const itemDialog = delivery.getByRole("dialog", {
            name: "Receive Item"
        });
        fireEvent.change(within(itemDialog).getByLabelText(
            "Packaging level received"
        ), {
            target: { value: "app-sale-box" }
        });
        fireEvent.change(within(itemDialog).getByLabelText(
            "Quantity received"
        ), {
            target: { value: "3" }
        });
        fireEvent.change(within(itemDialog).getByLabelText("Batch number"), {
            target: { value: "APP-DELIVERY-LOT-2" }
        });
        fireEvent.change(within(itemDialog).getByLabelText("Expiry date"), {
            target: { value: "2027-01-31" }
        });
        fireEvent.click(within(itemDialog).getByRole("button", {
            name: "Add to Delivery"
        }));

        const stagedState = getLatestState();
        expect(stagedState.deliveryDrafts).toHaveLength(1);
        expect(stagedState.deliveryDrafts[0]).toMatchObject({
            status: "draft",
            deliveryDate: "2026-11-20",
            receivedBy: "Staff One",
            supplier: "App Delivery Supplier",
            invoiceNumber: "APP-INV-2",
            items: [{
                productId: "app-sale-product",
                variantId: "app-sale-variant",
                packagingLevelId: "app-sale-box",
                quantity: 3,
                batchNumber: "APP-DELIVERY-LOT-2",
                expiryDate: "2027-01-31"
            }]
        });
        expect(stagedState.inventoryRecords).toEqual(initialState.inventoryRecords);
        expect(stagedState.inventoryBatches).toEqual(initialState.inventoryBatches);
        expect(stagedState.activityEvents.some(
            (event) => event.type === "delivery.received"
        )).toBe(false);

        fireEvent.click(screen.getByRole("link", { name: "Dashboard" }));
        expect(screen.getByRole("heading", { name: "Pending Delivery" }))
            .toBeVisible();
        expect(screen.getByRole("button", {
            name: "Open Receive Delivery"
        })).toBeVisible();

        fireEvent.click(screen.getByRole("link", { name: "Inventory" }));
        const inventoryPage = document.querySelector<HTMLElement>(
            ".inventory-page"
        );
        if (!inventoryPage) {
            throw new Error("The Inventory page was not rendered by App.");
        }
        const inventory = within(inventoryPage);
        fireEvent.click(inventory.getByRole("button", { name: "Edit Stock" }));
        const inventoryLockWarning = screen.getByRole("alertdialog", {
            name: "Product Currently Locked"
        });
        expect(inventoryLockWarning).toHaveTextContent(
            "This product is currently in an active draft. You cannot edit its inventory until the draft is completed or cancelled."
        );
        expect(screen.queryByRole("dialog", { name: "Edit Inventory" }))
            .not.toBeInTheDocument();
        fireEvent.click(within(inventoryLockWarning).getByRole("button", {
            name: "Cancel"
        }));

        fireEvent.click(screen.getByRole("link", { name: "Products" }));
        fireEvent.click(screen.getByRole("button", {
            name: "Edit App Sale Medicine"
        }));
        expect(screen.getByRole("button", { name: "Add variant" }))
            .toBeDisabled();
        expect(screen.getByRole("alert")).toHaveTextContent(
            "This product is currently in a Receive Delivery draft."
        );
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

        fireEvent.click(screen.getByRole("link", { name: "Receive Delivery" }));
        fireEvent.click(delivery.getByRole("button", {
            name: "Approve Delivery"
        }));

        const completedState = getLatestState();
        const receivedDraft = completedState.deliveryDrafts[0];
        expect(receivedDraft?.status).toBe("received");
        expect(completedState.inventoryRecords).toHaveLength(2);
        expect(completedState.inventoryBatches).toHaveLength(2);
        expect(completedState.inventoryRecords.find(
            (record) => record.id === "app-sale-inventory"
        )?.stockQuantities).toEqual(initialState.inventoryRecords[0]?.stockQuantities);

        const receivedBatch = completedState.inventoryBatches.find(
            (batch) => batch.batchNumber === "APP-DELIVERY-LOT-2"
        );
        expect(receivedBatch).toMatchObject({
            productId: "app-sale-product",
            variantId: "app-sale-variant",
            batchNumber: "APP-DELIVERY-LOT-2",
            expiryDate: new Date("2027-01-31T00:00:00.000Z")
        });
        const receivedRecord = completedState.inventoryRecords.find(
            (record) => record.batchId === receivedBatch?.batchId
        );
        expect(receivedRecord?.stockQuantities).toEqual([{
            packagingLevelId: "app-sale-box",
            quantity: 3
        }]);

        const receivedEvent = completedState.activityEvents.find(
            (event) =>
                event.type === "delivery.received" &&
                event.deliveryId === receivedDraft?.deliveryId
        );
        expect(completedState.activityEvents.filter(
            (event) => event.type === "delivery.received"
        )).toHaveLength(1);
        expect(receivedEvent).toMatchObject({
            type: "delivery.received",
            deliveryId: receivedDraft?.deliveryId,
            deliveryDate: "2026-11-20",
            receivedBy: "Staff One",
            items: [{
                productId: "app-sale-product",
                variantId: "app-sale-variant",
                stock: [{ quantity: 3 }]
            }]
        });

        fireEvent.click(screen.getByRole("link", { name: "Dashboard" }));
        expect(screen.queryByRole("heading", { name: "Pending Delivery" }))
            .not.toBeInTheDocument();
        expect(screen.getByText(
            "There are no pending Sales or Receive Delivery drafts."
        )).toBeVisible();

        fireEvent.click(screen.getByRole("link", { name: "Products" }));
        fireEvent.click(screen.getByRole("button", {
            name: "Edit App Sale Medicine"
        }));
        expect(screen.getByRole("button", { name: "Add variant" }))
            .toBeEnabled();
        expect(screen.queryByText(
            "This product is currently in a Receive Delivery draft."
        )).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

        fireEvent.click(screen.getByRole("link", { name: "Inventory" }));
        fireEvent.click(inventory.getByRole("button", { name: "Edit Stock" }));
        const unlockedInventoryDialog = screen.getByRole("dialog", {
            name: "Edit Inventory"
        });
        expect(within(unlockedInventoryDialog).getAllByLabelText("Batch number"))
            .toHaveLength(2);
        for (const batchNumber of within(unlockedInventoryDialog)
            .getAllByLabelText("Batch number")) {
            expect(batchNumber).toBeEnabled();
        }
        expect(within(unlockedInventoryDialog).getByRole("button", {
            name: "Add batch"
        })).toBeEnabled();
    });
});