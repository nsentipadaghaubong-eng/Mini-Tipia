// @vitest-environment jsdom

import { useReducer } from "react";
import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    within
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import {
    applicationReducer,
    createInitialApplicationState
} from "../../../applicationState";
import type { ApplicationState } from "../../../applicationState";
import type { inventory } from "../../../inventory/inventoryStock";
import type { inventoryBatch } from "../../../inventory/inventoryBatch";
import type { productStructure, variant } from "../../../products/productStructure";
import SalesItemModal from "../components/SalesItemModal";
import SalesPage from "./SalesPage";
import { completeSale, prepareSaleDraft } from "../../../sales/salesEngine";
import {
    calculateSaleLineAmounts,
    getAvailableQuantity,
    salesSelectionReducer,
    searchProductsByName
} from "./salesProductSelection";

afterEach(cleanup);

const packagingHierarchy = [
    {
        id: "box",
        name: "Box",
        costPrice: null,
        sellingPrice: 100,
        quantityofNextLevel: 10,
        nextLevelId: "unit"
    },
    {
        id: "unit",
        name: "Unit",
        costPrice: null,
        sellingPrice: 10,
        quantityofNextLevel: null,
        nextLevelId: null
    }
];

function createVariant(id: string, variantName: string): variant {
    return {
        id,
        variantName,
        packagingHierarchy
    };
}

const products: productStructure[] = [
    {
        id: "product-1",
        name: "Panadol",
        genericName: "Paracetamol",
        variant: [createVariant("variant-1", "500 mg tablet")]
    },
    {
        id: "product-2",
        name: "Paracetamol",
        variant: [createVariant("variant-2", "250 mg tablet")]
    }
];

const inventoryRecords: inventory[] = [{
    id: "inventory-1",
    productId: "product-1",
    variantId: "variant-1",
    batchId: "batch-1",
    stockQuantities: [
        { packagingLevelId: "box", quantity: 2 },
        { packagingLevelId: "unit", quantity: 0 }
    ]
}];

const inventoryBatches: inventoryBatch[] = [{
    batchId: "batch-1",
    productId: "product-1",
    variantId: "variant-1",
    batchNumber: "B-100",
    expiryDate: new Date("2027-06-30T00:00:00.000Z")
}];

function makeState(
    overrides: Partial<ApplicationState> = {}
): ApplicationState {
    return {
        ...createInitialApplicationState(),
        products,
        inventoryRecords,
        inventoryBatches,
        saleDrafts: [],
        ...overrides
    };
}

function renderSales(initialState = makeState()) {
    let latestState = initialState;
    let updateInventoryRecords: (records: inventory[]) => void = () => undefined;
    function Harness() {
        const [state, dispatch] = useReducer(
            applicationReducer,
            initialState
        );
        latestState = state;
        updateInventoryRecords = (records) => dispatch({
            type: "inventory.saved",
            inventoryRecords: records,
            inventoryBatches: latestState.inventoryBatches,
            events: []
        });
        return (
            <SalesPage
                products={state.products}
                inventoryRecords={state.inventoryRecords}
                inventoryBatches={state.inventoryBatches}
                saleDrafts={state.saleDrafts}
                onDraftCreated={(draft) => dispatch({
                    type: "sale.draft_created",
                    draft
                })}
                onDraftItemAdded={(draftId, item, updatedAt) => dispatch({
                    type: "sale.draft_item_added",
                    draftId,
                    item,
                    updatedAt
                })}
                onDraftItemUpdated={(draftId, lineId, changes, updatedAt) =>
                    dispatch({
                        type: "sale.draft_item_updated",
                        draftId,
                        lineId,
                        changes,
                        updatedAt
                    })
                }
                onDraftItemRemoved={(draftId, lineId, updatedAt) => dispatch({
                    type: "sale.draft_item_removed",
                    draftId,
                    lineId,
                    updatedAt
                })}
                onApproveSale={(draftId, confirmExpiredBatch) => {
                    const draft = latestState.saleDrafts.find(
                        (candidate) =>
                            candidate.draftId === draftId &&
                            candidate.status === "draft"
                    );
                    if (!draft) {
                        return {
                            success: false,
                            error: "The current sale draft is no longer available."
                        };
                    }
                    try {
                        const plan = prepareSaleDraft(draft, {
                            products: latestState.products,
                            inventoryRecords: latestState.inventoryRecords,
                            inventoryBatches: latestState.inventoryBatches
                        });
                        if (
                            !confirmExpiredBatch &&
                            plan.linePlans.some((linePlan) => linePlan.expiredBatch)
                        ) {
                            return {
                                success: false,
                                error: "This sale includes an expired batch. Confirm explicitly to continue.",
                                requiresExpiredBatchConfirmation: true
                            };
                        }
                        const completion = completeSale(plan, {
                            continueWithExpiredBatch: confirmExpiredBatch
                        });
                        const action = {
                            type: "sale.completed" as const,
                            completion
                        };
                        applicationReducer(latestState, action);
                        dispatch(action);
                        return { success: true };
                    } catch (error) {
                        return {
                            success: false,
                            error: error instanceof Error
                                ? error.message
                                : "The sale could not be approved."
                        };
                    }
                }}
            />
        );
    }
    const result = render(<Harness />);
    return {
        ...result,
        get state() {
            return latestState;
        },
        updateInventoryRecords(records: inventory[]) {
            updateInventoryRecords(records);
        }
    };
}

function searchAndChooseVariant() {
    fireEvent.change(screen.getByRole("searchbox", { name: "Search products" }), {
        target: { value: "pana" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Panadol" }));
    fireEvent.click(screen.getByRole("button", { name: "500 mg tablet" }));
}

function selectStockAndPackaging() {
    fireEvent.change(screen.getByLabelText("Select inventory record"), {
        target: { value: "inventory-1" }
    });
    fireEvent.change(screen.getByLabelText("Select packaging level"), {
        target: { value: "unit" }
    });
}

function addItem(quantity: number, discountPercentage = "0") {
    searchAndChooseVariant();
    selectStockAndPackaging();
    fireEvent.change(screen.getByLabelText("Sale quantity"), {
        target: { value: String(quantity) }
    });
    fireEvent.change(screen.getByLabelText("Discount percentage"), {
        target: { value: discountPercentage }
    });
    const addButton = screen.getByRole("button", { name: "Add to Sales" });
    fireEvent.click(addButton);
}

describe("Sales search-first product selection", () => {
    it("shows neither products nor an empty draft before the pharmacist searches", () => {
        renderSales();

        expect(screen.getByRole("searchbox", { name: "Search products" })).toBeVisible();
        expect(screen.queryByText("Panadol")).not.toBeInTheDocument();
        expect(screen.queryByText("Paracetamol")).not.toBeInTheDocument();
        expect(screen.queryByRole("region", { name: "Current sale draft" }))
            .not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Create Draft/i }))
            .not.toBeInTheDocument();
    });

    it("shows matching products only after a search query is entered", () => {
        renderSales();

        fireEvent.change(screen.getByRole("searchbox", { name: "Search products" }), {
            target: { value: "pana" }
        });

        expect(screen.getByRole("list", { name: "Matching products" })).toBeVisible();
        expect(screen.getByRole("button", { name: "Panadol" })).toBeVisible();
        expect(screen.queryByRole("button", { name: "Paracetamol" }))
            .not.toBeInTheDocument();
        expect(searchProductsByName(products, "PARA").map((product) => product.id))
            .toEqual(["product-2"]);
    });

    it("selects a product, displays variants, and opens and closes the item modal", () => {
        renderSales();
        fireEvent.change(screen.getByRole("searchbox", { name: "Search products" }), {
            target: { value: "pana" }
        });
        fireEvent.click(screen.getByRole("button", { name: "Panadol" }));

        expect(screen.getByRole("region", { name: "Selected product" }))
            .toHaveTextContent("Panadol");
        expect(screen.getByRole("button", { name: "500 mg tablet" })).toBeVisible();
        expect(screen.queryByLabelText("Select inventory record"))
            .not.toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "500 mg tablet" }));
        expect(screen.getByRole("dialog", { name: "Add medicine to sale" }))
            .toBeVisible();
        expect(screen.getByText(/FEFO recommended/)).toBeVisible();
        expect(screen.getByRole("option", {
            name: /Batch B-100.*expires 2027-06-30.*FEFO recommended/
        })).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Close sales item" }));
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("keeps product identity selection based on IDs and resets variants on product change", () => {
        const selectedProduct = salesSelectionReducer(
            { productId: "", variantId: "" },
            { type: "product.selected", productId: "product-1" }
        );
        const selectedVariant = salesSelectionReducer(
            selectedProduct,
            { type: "variant.selected", variantId: "variant-1" }
        );

        expect(selectedVariant).toEqual({
            productId: "product-1",
            variantId: "variant-1"
        });
        expect(salesSelectionReducer(selectedVariant, {
            type: "product.selected",
            productId: "product-2"
        })).toEqual({
            productId: "product-2",
            variantId: ""
        });
    });
});

describe("Sales item calculations and draft workflow", () => {
    it("calculates rounded discounts and final amounts from a percentage", () => {
        expect(calculateSaleLineAmounts(19.99, 3, 10)).toEqual({
            subtotal: 59.97,
            discountAmount: 6,
            finalAmount: 53.97
        });
        expect(calculateSaleLineAmounts(10, 2, 100)).toEqual({
            subtotal: 20,
            discountAmount: 20,
            finalAmount: 0
        });
        expect(calculateSaleLineAmounts(10, 2, 0)).toEqual({
            subtotal: 20,
            discountAmount: 0,
            finalAmount: 20
        });
    });

    it.each([-0.01, 100.01, Number.NaN, Number.POSITIVE_INFINITY])(
        "rejects invalid discount percentage %s",
        (percentage) => {
            expect(calculateSaleLineAmounts(10, 2, percentage)).toBeNull();
        }
    );

    it("automatically creates the first draft, adds subsequent items to it, and clears search", () => {
        const initial = makeState();
        const page = renderSales(initial);
        addItem(2, "10");

        expect(screen.queryByRole("alert")?.textContent ?? "").toBe("");
        expect(page.state.saleDrafts).toHaveLength(1);
        const draftId = page.state.saleDrafts[0].draftId;
        expect(page.state.saleDrafts[0].items[0]).toMatchObject({
            productId: "product-1",
            variantId: "variant-1",
            inventoryRecordId: "inventory-1",
            batchId: "batch-1",
            packagingLevelId: "unit",
            quantity: 2,
            defaultSellingPrice: 10,
            appliedSellingPrice: 10,
            discountAmount: 2
        });
        expect(screen.getByRole("region", { name: "Sale totals" }))
            .toHaveTextContent("Subtotal 20.00");
        expect(screen.getByRole("region", { name: "Sale totals" }))
            .toHaveTextContent("Discount 2.00");
        expect(screen.getByRole("region", { name: "Sale totals" }))
            .toHaveTextContent("Final amount 18.00");
        expect(screen.getByRole("searchbox", { name: "Search products" }))
            .toHaveValue("");
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(page.state.inventoryRecords).toBe(initial.inventoryRecords);
        expect(page.state.inventoryBatches).toBe(initial.inventoryBatches);
        expect(page.state.sales).toBe(initial.sales);
        expect(page.state.activityEvents).toBe(initial.activityEvents);

        addItem(3);

        expect(page.state.saleDrafts).toHaveLength(1);
        expect(page.state.saleDrafts[0].draftId).toBe(draftId);
        expect(page.state.saleDrafts[0].items).toHaveLength(2);
    });

    it("edits an existing item without changing its line ID and removes draft items", () => {
        const initial = makeState();
        const page = renderSales(initial);
        addItem(2);
        const item = page.state.saleDrafts[0].items[0];
        fireEvent.click(screen.getByRole("button", { name: "Edit Panadol" }));

        expect(screen.getByRole("dialog", { name: "Edit sale item" })).toBeVisible();
        expect(screen.getByLabelText("Sale quantity")).toHaveValue(2);
        fireEvent.change(screen.getByLabelText("Sale quantity"), {
            target: { value: "3" }
        });
        expect(screen.getByLabelText("Selling price")).toHaveValue(10);
        fireEvent.change(screen.getByLabelText("Selling price"), {
            target: { value: "12" }
        });
        fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

        expect(page.state.saleDrafts[0].items[0]).toMatchObject({
            lineId: item.lineId,
            quantity: 3,
            defaultSellingPrice: 10,
            appliedSellingPrice: 12
        });
        expect(page.state.inventoryRecords).toBe(initial.inventoryRecords);
        expect(page.state.inventoryBatches).toBe(initial.inventoryBatches);
        expect(page.state.sales).toBe(initial.sales);
        expect(page.state.activityEvents).toBe(initial.activityEvents);
        fireEvent.click(screen.getByRole("button", { name: "Edit Panadol" }));
        expect(screen.getByLabelText("Selling price")).toHaveValue(12);
        fireEvent.click(screen.getByRole("button", { name: "Close sales item" }));
        fireEvent.click(screen.getByRole("button", { name: "Remove Panadol" }));
        expect(page.state.saleDrafts).toEqual([]);
        expect(page.state.inventoryRecords).toBe(initial.inventoryRecords);
        expect(page.state.inventoryBatches).toBe(initial.inventoryBatches);
        expect(page.state.sales).toBe(initial.sales);
        expect(page.state.activityEvents).toBe(initial.activityEvents);
        expect(screen.queryByRole("region", { name: "Current sale" }))
            .not.toBeInTheDocument();
    });

    it("rejects an invalid percentage before draft creation", () => {
        const page = renderSales();
        searchAndChooseVariant();
        selectStockAndPackaging();
        fireEvent.change(screen.getByLabelText("Discount percentage"), {
            target: { value: "101" }
        });

        expect(screen.getByLabelText("Discount percentage"))
            .toHaveAttribute("aria-invalid", "true");
        expect(screen.getByRole("button", { name: "Add to Sales" })).toBeDisabled();
        expect(page.state.saleDrafts).toEqual([]);
    });

    it("rejects insufficient stock without creating or changing a draft", () => {
        const initial = makeState({
            inventoryRecords: [{
                ...inventoryRecords[0],
                stockQuantities: [
                    { packagingLevelId: "box", quantity: 1 },
                    { packagingLevelId: "unit", quantity: 0 }
                ]
            }]
        });
        const page = renderSales(initial);
        addItem(11);

        expect(screen.getByRole("alert")).toHaveTextContent("Insufficient stock");
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        expect(page.state.saleDrafts).toEqual([]);
        expect(page.state.inventoryRecords).toBe(initial.inventoryRecords);
        expect(page.state.activityEvents).toBe(initial.activityEvents);
    });

    it("validates packaging breakdown and leaves inventory unchanged while composing", () => {
        const initial = makeState();
        const page = renderSales(initial);
        addItem(10);

        expect(page.state.saleDrafts[0].items).toHaveLength(1);
        expect(page.state.inventoryRecords[0].stockQuantities).toEqual([
            { packagingLevelId: "box", quantity: 2 },
            { packagingLevelId: "unit", quantity: 0 }
        ]);
        expect(page.state.inventoryRecords).toBe(initial.inventoryRecords);
        expect(page.state.inventoryBatches).toBe(initial.inventoryBatches);
        expect(page.state.sales).toBe(initial.sales);
        expect(page.state.activityEvents).toBe(initial.activityEvents);
    });

    it("validates multiple lines sequentially and preserves the draft after failed additions or edits", () => {
        const page = renderSales();
        addItem(10);
        const draftBefore = page.state.saleDrafts[0];

        addItem(11);
        expect(screen.getByRole("alert")).toHaveTextContent("Insufficient stock");
        expect(page.state.saleDrafts[0]).toEqual(draftBefore);

        fireEvent.click(screen.getByRole("button", { name: "Edit Panadol" }));
        fireEvent.change(screen.getByLabelText("Sale quantity"), {
            target: { value: "21" }
        });
        fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

        expect(screen.getByRole("alert")).toHaveTextContent("Insufficient stock");
        expect(page.state.saleDrafts[0]).toEqual(draftBefore);
    });

    it("renders the item modal with explicit stock, packaging, price, discount, and totals fields", () => {
        render(
            <SalesItemModal
                product={products[0]}
                variant={products[0].variant[0]}
                products={products}
                inventoryRecords={inventoryRecords}
                inventoryBatches={inventoryBatches}
                onSave={() => undefined}
                onClose={() => undefined}
            />
        );
        const dialog = screen.getByRole("dialog");

        expect(within(dialog).getByLabelText("Select inventory record")).toBeVisible();
        expect(within(dialog).getByLabelText("Select packaging level")).toBeVisible();
        expect(within(dialog).getByLabelText("Sale quantity")).toBeVisible();
        expect(within(dialog).getAllByLabelText("Selling price")).toHaveLength(1);
        expect(within(dialog).getByLabelText("Discount percentage")).toBeVisible();
        expect(within(dialog).getByText("Discount amount")).toBeVisible();
        expect(within(dialog).getByRole("button", { name: "Add to Sales" })).toBeDisabled();
    });

    it("resolves one editable price and calculates the discount from the edited value", () => {
        renderSales();
        searchAndChooseVariant();
        selectStockAndPackaging();

        const price = screen.getByLabelText("Selling price");
        expect(screen.getAllByLabelText("Selling price")).toHaveLength(1);
        expect(price).toHaveValue(10);
        fireEvent.change(price, { target: { value: "12" } });
        fireEvent.change(screen.getByLabelText("Sale quantity"), {
            target: { value: "2" }
        });
        fireEvent.change(screen.getByLabelText("Discount percentage"), {
            target: { value: "10" }
        });

        expect(screen.getByText("Subtotal").parentElement)
            .toHaveTextContent("24.00");
        expect(screen.getByText("Discount amount").parentElement)
            .toHaveTextContent("2.40");
        fireEvent.click(screen.getByRole("button", { name: "Add to Sales" }));

        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(screen.getByText(/Line total 21\.60/)).toBeInTheDocument();
    });

    it("shows package-aware availability and disables adding quantities above stock", () => {
        const fiveBoxes = [{
            ...inventoryRecords[0],
            stockQuantities: [
                { packagingLevelId: "box", quantity: 5 },
                { packagingLevelId: "unit", quantity: 0 }
            ]
        }];
        render(
            <SalesItemModal
                product={products[0]}
                variant={products[0].variant[0]}
                products={products}
                inventoryRecords={fiveBoxes}
                inventoryBatches={inventoryBatches}
                onSave={() => undefined}
                onClose={() => undefined}
            />
        );
        fireEvent.change(screen.getByLabelText("Select inventory record"), {
            target: { value: "inventory-1" }
        });
        fireEvent.change(screen.getByLabelText("Select packaging level"), {
            target: { value: "box" }
        });
        fireEvent.change(screen.getByLabelText("Sale quantity"), {
            target: { value: "8" }
        });

        expect(screen.getByText(/Available 5 boxes/)).toBeInTheDocument();
        expect(screen.getByRole("alert")).toHaveTextContent(
            "Insufficient stock. Current quantity available: 5 boxes."
        );
        expect(screen.getByRole("button", { name: "Add to Sales" })).toBeDisabled();

        fireEvent.change(screen.getByLabelText("Sale quantity"), {
            target: { value: "5" }
        });
        expect(screen.queryByText(/Insufficient stock/)).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Add to Sales" })).toBeEnabled();

        const secondRecord = {
            ...fiveBoxes[0],
            id: "inventory-2",
            batchId: "batch-2",
            stockQuantities: [
                { packagingLevelId: "box", quantity: 3 },
                { packagingLevelId: "unit", quantity: 0 }
            ]
        };
        const secondBatch = {
            ...inventoryBatches[0],
            batchId: "batch-2",
            batchNumber: "B-200"
        };
        cleanup();
        render(
            <SalesItemModal
                product={products[0]}
                variant={products[0].variant[0]}
                products={products}
                inventoryRecords={[fiveBoxes[0], secondRecord]}
                inventoryBatches={[inventoryBatches[0], secondBatch]}
                onSave={() => undefined}
                onClose={() => undefined}
            />
        );
        fireEvent.change(screen.getByLabelText("Select inventory record"), {
            target: { value: "inventory-1" }
        });
        fireEvent.change(screen.getByLabelText("Select packaging level"), {
            target: { value: "box" }
        });
        fireEvent.change(screen.getByLabelText("Select inventory record"), {
            target: { value: "inventory-2" }
        });
        expect(screen.getByText(/Available 3 boxes/)).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText("Select packaging level"), {
            target: { value: "unit" }
        });
        expect(screen.getByText(/Available 30 units/)).toBeInTheDocument();
    });

    it("reports zero package stock and counts larger packages when selling smaller ones", () => {
        const noStock = [{
            ...inventoryRecords[0],
            stockQuantities: [
                { packagingLevelId: "box", quantity: 0 },
                { packagingLevelId: "unit", quantity: 0 }
            ]
        }];
        render(
            <SalesItemModal
                product={products[0]}
                variant={products[0].variant[0]}
                products={products}
                inventoryRecords={noStock}
                inventoryBatches={inventoryBatches}
                onSave={() => undefined}
                onClose={() => undefined}
            />
        );
        fireEvent.change(screen.getByLabelText("Select inventory record"), {
            target: { value: "inventory-1" }
        });
        fireEvent.change(screen.getByLabelText("Select packaging level"), {
            target: { value: "box" }
        });

        expect(screen.getByText(/Available 0 boxes/)).toBeInTheDocument();
        expect(screen.getByRole("alert")).toHaveTextContent(
            "Insufficient stock. Current quantity available: 0 boxes."
        );
        expect(screen.getByRole("button", { name: "Add to Sales" })).toBeDisabled();
        expect(getAvailableQuantity(
            products[0].variant[0],
            inventoryRecords[0],
            "unit"
        )).toBe(20);
    });

    it("approves a multi-item draft atomically and resets the search-first page", () => {
        const initial = makeState();
        const page = renderSales(initial);
        expect(screen.queryByRole("button", { name: "Approve Sale" }))
            .not.toBeInTheDocument();

        addItem(2);
        addItem(3, "10");
        const beforeApproval = page.state.inventoryRecords;
        const draftId = page.state.saleDrafts[0].draftId;
        expect(screen.getByRole("button", { name: "Approve Sale" })).toBeVisible();
        expect(page.state.inventoryRecords).toBe(initial.inventoryRecords);

        fireEvent.click(screen.getByRole("button", { name: "Approve Sale" }));

        expect(page.state.saleDrafts.find((draft) => draft.draftId === draftId)?.status)
            .toBe("approved");
        expect(page.state.sales).toHaveLength(1);
        expect(page.state.sales[0].items).toHaveLength(2);
        expect(page.state.sales[0]).toMatchObject({
            subtotal: 50,
            discountAmount: 3,
            finalAmount: 47
        });
        expect(page.state.activityEvents.filter((event) =>
            event.type === "sale.completed"
        )).toHaveLength(1);
        expect(page.state.inventoryRecords).not.toBe(beforeApproval);
        expect(page.state.inventoryRecords[0].stockQuantities).toEqual([
            { packagingLevelId: "box", quantity: 1 },
            { packagingLevelId: "unit", quantity: 5 }
        ]);
        expect(screen.getByRole("searchbox", { name: "Search products" }))
            .toHaveValue("");
        expect(screen.queryByRole("region", { name: "Current sale draft" }))
            .not.toBeInTheDocument();
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("approves a single-item draft and creates one sale and one Activity event", () => {
        const page = renderSales();
        addItem(2);
        const inventoryBeforeApproval = page.state.inventoryRecords;

        fireEvent.click(screen.getByRole("button", { name: "Approve Sale" }));

        expect(page.state.sales).toHaveLength(1);
        expect(page.state.sales[0].items).toHaveLength(1);
        expect(page.state.sales[0]).toMatchObject({
            subtotal: 20,
            discountAmount: 0,
            finalAmount: 20
        });
        expect(page.state.activityEvents.filter((event) =>
            event.type === "sale.completed"
        )).toHaveLength(1);
        expect(page.state.inventoryRecords).not.toBe(inventoryBeforeApproval);
        expect(screen.queryByRole("button", { name: "Approve Sale" }))
            .not.toBeInTheDocument();
    });

    it("requires explicit confirmation before approving an expired batch", () => {
        const expiredBatches = [{
            ...inventoryBatches[0],
            expiryDate: new Date("2020-01-01T00:00:00.000Z")
        }];
        const initial = makeState({ inventoryBatches: expiredBatches });
        const page = renderSales(initial);
        addItem(1);

        fireEvent.click(screen.getByRole("button", { name: "Approve Sale" }));

        expect(screen.getByText(/includes an expired batch/))
            .toBeInTheDocument();
        expect(screen.getByRole("button", {
            name: "Confirm Sale with Expired Stock"
        })).toBeVisible();
        expect(page.state.sales).toEqual(initial.sales);
        expect(page.state.inventoryRecords).toBe(initial.inventoryRecords);

        fireEvent.click(screen.getByRole("button", {
            name: "Confirm Sale with Expired Stock"
        }));
        expect(page.state.sales).toHaveLength(1);
        expect(page.state.sales[0].expiredBatchConfirmed).toBe(true);
        expect(page.state.activityEvents.filter((event) =>
            event.type === "sale.completed"
        )).toHaveLength(1);
    });

    it("preserves a draft when stock changes after composition and approval revalidation fails", () => {
        const initial = makeState();
        const page = renderSales(initial);
        addItem(8);
        const draftBeforeApproval = page.state.saleDrafts[0];
        const changedInventory = [{
            ...initial.inventoryRecords[0],
            stockQuantities: [
                { packagingLevelId: "box", quantity: 0 },
                { packagingLevelId: "unit", quantity: 5 }
            ]
        }];
        act(() => page.updateInventoryRecords(changedInventory));

        fireEvent.click(screen.getByRole("button", { name: "Approve Sale" }));

        expect(screen.getByRole("alert")).toHaveTextContent(/stock|quantity|fulfill/i);
        expect(page.state.saleDrafts).toEqual([draftBeforeApproval]);
        expect(page.state.inventoryRecords).toBe(changedInventory);
        expect(page.state.sales).toEqual(initial.sales);
        expect(page.state.activityEvents).toEqual(initial.activityEvents);
    });
});
