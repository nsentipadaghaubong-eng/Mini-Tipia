// @vitest-environment jsdom

import { useReducer, useState } from "react";
import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    within
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    applicationReducer,
    createInitialApplicationState
} from "../../../applicationState";
import { prepareActivityEvents } from "../../../activity/activity";
import type { ApplicationState } from "../../../applicationState";
import { createDeliveryDraft } from "../../../deliveries/deliveryDraft";
import { prepareDeliveryApproval } from "../../../deliveries/deliveryApproval";
import type { DeliveryDraft } from "../../../deliveries/deliveryDraft";
import type { productStructure } from "../../../products/productStructure";
import AppLayout from "../../../components/layout/AppLayout";
import ReceiveDeliveryItemModal from "../components/ReceiveDeliveryItemModal";
import ReceiveDeliveryPage from "./ReceiveDeliveryPage";

afterEach(cleanup);

const products: productStructure[] = [{
    id: "product-1",
    name: "Example medicine",
    variant: [{
        id: "variant-1",
        variantName: "10 mg tablets",
        packagingHierarchy: [{
            id: "box",
            name: "Box",
            costPrice: null,
            sellingPrice: 12,
            quantityofNextLevel: 10,
            nextLevelId: "bottle"
        }, {
            id: "bottle",
            name: "Bottle",
            costPrice: null,
            sellingPrice: 2,
            quantityofNextLevel: null,
            nextLevelId: null
        }]
    }]
}];

function makeDraft(
    deliveryId: string,
    overrides: Partial<Parameters<typeof createDeliveryDraft>[0]> = {}
): DeliveryDraft {
    return createDeliveryDraft({
        deliveryDate: "2026-11-06",
        receivedBy: "Pharmacist",
        ...overrides
    }, {
        makeId: () => deliveryId,
        now: () => new Date("2026-11-07T12:00:00.000Z")
    });
}

function draftWithItem(deliveryId: string, supplier: string): DeliveryDraft {
    const draft = makeDraft(deliveryId, { supplier });
    return {
        ...draft,
        items: [{
            deliveryItemId: `${deliveryId}-item-1`,
            productId: "product-1",
            variantId: "variant-1",
            packagingLevelId: "box",
            quantity: 4,
            batchNumber: "LOT-1",
            expiryDate: "2027-12-31"
        }]
    };
}

function makeState(deliveryDrafts: DeliveryDraft[] = []): ApplicationState {
    return {
        ...createInitialApplicationState(),
        products,
        inventoryRecords: [],
        inventoryBatches: [],
        deliveryDrafts
    };
}

function renderPage(
    initialState = makeState(),
    approveWithoutCommit = false
) {
    let latestState = initialState;
    function Harness() {
        const [state, dispatch] = useReducer(
            applicationReducer,
            initialState
        );
        latestState = state;
        return (
            <ReceiveDeliveryPage
                products={state.products}
                inventoryRecords={state.inventoryRecords}
                inventoryBatches={state.inventoryBatches}
                deliveryDrafts={state.deliveryDrafts}
                onDraftDetailsUpdated={(deliveryId, changes, updatedAt) =>
                    dispatch({
                        type: "delivery.draft_details_updated",
                        deliveryId,
                        changes,
                        updatedAt
                    })
                }
                onDraftCreated={(draft) => dispatch({
                    type: "delivery.draft_created",
                    draft
                })}
                onDraftItemAdded={(deliveryId, item, updatedAt) => dispatch({
                    type: "delivery.draft_item_added",
                    deliveryId,
                    item,
                    updatedAt
                })}
                onDraftItemUpdated={(
                    deliveryId,
                    deliveryItemId,
                    changes,
                    updatedAt
                ) => dispatch({
                    type: "delivery.draft_item_updated",
                    deliveryId,
                    deliveryItemId,
                    changes,
                    updatedAt
                })}
                onDraftItemRemoved={(deliveryId, deliveryItemId, updatedAt) =>
                    dispatch({
                        type: "delivery.draft_item_removed",
                        deliveryId,
                        deliveryItemId,
                        updatedAt
                    })
                }
                onApproveDelivery={(deliveryId) => {
                    if (approveWithoutCommit) {
                        return { success: true };
                    }
                    try {
                        const draft = state.deliveryDrafts.find(
                            (candidate) => candidate.deliveryId === deliveryId
                        );
                        if (!draft) {
                            throw new Error("The current delivery draft is no longer available.");
                        }
                        const plan = prepareDeliveryApproval(
                            draft,
                            state.products,
                            state.inventoryRecords,
                            state.inventoryBatches
                        );
                        const [event] = prepareActivityEvents([plan.activity]);
                        const action = {
                            type: "delivery.approved" as const,
                            plan,
                            event
                        };
                        applicationReducer(state, action);
                        dispatch(action);
                        return { success: true };
                    } catch (error) {
                        return {
                            success: false,
                            error: error instanceof Error
                                ? error.message
                                : "The delivery could not be approved."
                        };
                    }
                }}
                onCatalogueProductCreated={(product) => dispatch({
                    type: "product.catalogue_created",
                    product
                })}
                onVariantCreated={(productId, productVariant) => dispatch({
                    type: "product.variant_added",
                    productId,
                    variant: productVariant
                })}
            />
        );
    }

    const result = render(<Harness />);
    return {
        ...result,
        get state() {
            return latestState;
        }
    };
}

function fillRequiredHeader(receivedBy = "Pharmacist A") {
    fireEvent.change(screen.getByLabelText(/Received By/), {
        target: { value: receivedBy }
    });
}

describe("Receive Delivery page", () => {
    it("renders a local-date header form without creating a draft or exposing approval", () => {
        const initial = makeState();
        const page = renderPage(initial);
        const today = new Date();
        const localDate = [
            today.getFullYear(),
            String(today.getMonth() + 1).padStart(2, "0"),
            String(today.getDate()).padStart(2, "0")
        ].join("-");

        expect(screen.getByRole("heading", { name: "Receive Delivery" }))
            .toBeVisible();
        expect(screen.getByLabelText("Supplier")).toBeVisible();
        expect(screen.getByLabelText("Invoice Number")).toBeVisible();
        expect(screen.getByLabelText("Delivery Date *")).toHaveValue(localDate);
        expect(screen.getByLabelText("Received By *")).toBeVisible();
        expect(screen.getByText(
            "Delivery details are staged here. The draft will be created when its first item is added."
        )).toBeVisible();
        expect(page.state.deliveryDrafts).toEqual([]);
        expect(screen.queryByRole("button", { name: /Create Draft|Add Draft/i }))
            .not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Approve|Complete/i }))
            .not.toBeInTheDocument();
        expect(page.state.inventoryRecords).toBe(initial.inventoryRecords);
        expect(page.state.inventoryBatches).toBe(initial.inventoryBatches);
        expect(page.state.activityEvents).toBe(initial.activityEvents);
    });

    it("does not create a draft when only header fields are entered", () => {
        const initial = makeState();
        const page = renderPage(initial);
        fireEvent.change(screen.getByLabelText("Supplier"), {
            target: { value: "  Main Supplier " }
        });
        fireEvent.change(screen.getByLabelText("Invoice Number"), {
            target: { value: " INV-42 " }
        });
        fillRequiredHeader(" Pharmacist B ");
        expect(page.state.deliveryDrafts).toEqual([]);
        expect(screen.getByLabelText("Supplier")).toHaveValue("  Main Supplier ");
        expect(screen.getByLabelText("Invoice Number")).toHaveValue(" INV-42 ");
        expect(screen.getByLabelText("Received By *")).toHaveValue(" Pharmacist B ");
        expect(screen.queryByRole("button", { name: "Save Delivery Details" }))
            .not.toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(page.state.inventoryRecords).toBe(initial.inventoryRecords);
        expect(page.state.inventoryBatches).toBe(initial.inventoryBatches);
        expect(page.state.activityEvents).toBe(initial.activityEvents);
    });

    it("allows empty recipient and date while adding first and subsequent draft items", () => {
        const initial = makeState();
        const page = renderPage(initial);
        fireEvent.change(screen.getByLabelText("Delivery Date *"), {
            target: { value: "" }
        });
        fireEvent.change(screen.getByLabelText("Received By *"), {
            target: { value: "" }
        });
        fireEvent.change(screen.getByLabelText("Search products"), {
            target: { value: "Example medicine" }
        });
        fireEvent.click(screen.getByRole("option", {
            name: "Select product Example medicine"
        }));
        fireEvent.change(screen.getByLabelText("Select variant"), {
            target: { value: "variant-1" }
        });

        let dialog = screen.getByRole("dialog", { name: "Receive Item" });
        fireEvent.change(within(dialog).getByLabelText("Packaging level received"), {
            target: { value: "box" }
        });
        fireEvent.change(within(dialog).getByLabelText("Quantity received"), {
            target: { value: "2" }
        });
        fireEvent.click(within(dialog).getByRole("button", {
            name: "Add to Delivery"
        }));

        expect(page.state.deliveryDrafts[0]).toMatchObject({
            deliveryDate: "",
            receivedBy: "",
            items: [{ quantity: 2 }]
        });
        fireEvent.change(screen.getByLabelText("Select variant"), {
            target: { value: "" }
        });
        fireEvent.change(screen.getByLabelText("Select variant"), {
            target: { value: "variant-1" }
        });
        dialog = screen.getByRole("dialog", { name: "Receive Item" });
        fireEvent.change(within(dialog).getByLabelText("Packaging level received"), {
            target: { value: "bottle" }
        });
        fireEvent.change(within(dialog).getByLabelText("Quantity received"), {
            target: { value: "7" }
        });
        fireEvent.click(within(dialog).getByRole("button", {
            name: "Add to Delivery"
        }));

        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(page.state.deliveryDrafts).toHaveLength(1);
        expect(page.state.deliveryDrafts[0].items.map((item) => [
            item.packagingLevelId,
            item.quantity
        ])).toEqual([["box", 2], ["bottle", 7]]);
        expect(page.state.inventoryRecords).toBe(initial.inventoryRecords);
        expect(page.state.inventoryBatches).toBe(initial.inventoryBatches);
        expect(page.state.activityEvents).toBe(initial.activityEvents);
    });

    it("searches products by name, selects a product, and closes the results", () => {
        const initial = makeState();
        const page = renderPage({
            ...initial,
            products: [...products, {
                id: "product-2",
                name: "Second medicine",
                variant: [{
                    id: "variant-2",
                    variantName: "Liquid",
                    packagingHierarchy: []
                }]
            }]
        });

        fireEvent.change(screen.getByLabelText("Search products"), {
            target: { value: "medicine" }
        });
        expect(screen.getByRole("option", { name: "Select product Example medicine" }))
            .toBeVisible();
        expect(screen.getByRole("option", { name: "Select product Second medicine" }))
            .toBeVisible();
        fireEvent.click(screen.getByRole("option", {
            name: "Select product Example medicine"
        }));

        expect(screen.getByText("Example medicine")).toBeVisible();
        expect(screen.getByLabelText("Select variant")).toHaveValue("");
        expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
        fireEvent.change(screen.getByLabelText("Select variant"), {
            target: { value: "variant-1" }
        });
        expect(page.state.deliveryDrafts).toEqual([]);
        expect(page.state.inventoryRecords).toBe(initial.inventoryRecords);
        expect(page.state.inventoryBatches).toBe(initial.inventoryBatches);
        expect(page.state.activityEvents).toBe(initial.activityEvents);
    });

    it("keeps product search visible and creates the first draft only from a valid item", () => {
        const initial = makeState();
        const page = renderPage({
            ...initial,
            products: [...products, {
                id: "product-2",
                name: "Other product",
                variant: [{
                    id: "variant-other",
                    variantName: "Other variant",
                    packagingHierarchy: [{
                        id: "vial",
                        name: "Vial",
                        costPrice: null,
                        sellingPrice: null,
                        quantityofNextLevel: null,
                        nextLevelId: null
                    }]
                }]
            }]
        });
        fireEvent.change(screen.getByLabelText("Supplier"), {
            target: { value: " Main Supplier " }
        });
        fireEvent.change(screen.getByLabelText("Invoice Number"), {
            target: { value: " INV-42 " }
        });
        fireEvent.change(screen.getByLabelText("Delivery Date *"), {
            target: { value: "2026-11-06" }
        });
        fillRequiredHeader("Pharmacist A");
        fireEvent.change(screen.getByLabelText("Search products"), {
            target: { value: "Example medicine" }
        });
        fireEvent.click(screen.getByRole("option", {
            name: "Select product Example medicine"
        }));
        fireEvent.change(screen.getByLabelText("Select variant"), {
            target: { value: "variant-1" }
        });

        expect(screen.getByLabelText("Search products")).toBeVisible();
        expect(screen.queryByRole("button", { name: "Change Product" }))
            .not.toBeInTheDocument();
        expect(page.state.deliveryDrafts).toEqual([]);
        const dialog = screen.getByRole("dialog", { name: "Receive Item" });
        expect(screen.queryByRole("button", { name: "Receive Item" }))
            .not.toBeInTheDocument();
        expect(within(dialog).getByRole("option", { name: "Box" })).toBeInTheDocument();
        expect(within(dialog).getByRole("option", { name: "Bottle" }))
            .toBeInTheDocument();
        expect(within(dialog).queryByRole("option", { name: "Vial" }))
            .not.toBeInTheDocument();
        expect(page.state.deliveryDrafts).toEqual([]);

        fireEvent.change(within(dialog).getByLabelText("Packaging level received"), {
            target: { value: "bottle" }
        });
        fireEvent.change(within(dialog).getByLabelText("Quantity received"), {
            target: { value: "0" }
        });
        fireEvent.submit(dialog.querySelector("form")!);
        expect(within(dialog).getByRole("alert"))
            .toHaveTextContent("Quantity must be a positive whole number.");
        expect(page.state.deliveryDrafts).toEqual([]);

        fireEvent.change(within(dialog).getByLabelText("Quantity received"), {
            target: { value: "8" }
        });
        fireEvent.change(within(dialog).getByLabelText("Packaging level received"), {
            target: { value: "unrelated-level" }
        });
        fireEvent.submit(dialog.querySelector("form")!);
        expect(within(dialog).getByRole("alert"))
            .toHaveTextContent("Select a packaging level belonging to the selected variant.");
        expect(page.state.deliveryDrafts).toEqual([]);
        fireEvent.change(within(dialog).getByLabelText("Packaging level received"), {
            target: { value: "bottle" }
        });
        fireEvent.change(within(dialog).getByLabelText("Batch number"), {
            target: { value: "LOT-42" }
        });
        fireEvent.change(within(dialog).getByLabelText("Expiry date"), {
            target: { value: "2028-04-30" }
        });
        fireEvent.click(within(dialog).getByRole("button", {
            name: "Add to Delivery"
        }));

        expect(page.state.deliveryDrafts).toHaveLength(1);
        expect(page.state.deliveryDrafts[0]).toMatchObject({
            status: "draft",
            supplier: "Main Supplier",
            invoiceNumber: "INV-42",
            deliveryDate: "2026-11-06",
            receivedBy: "Pharmacist A",
            items: [{
                productId: "product-1",
                variantId: "variant-1",
                packagingLevelId: "bottle",
                quantity: 8,
                batchNumber: "LOT-42",
                expiryDate: "2028-04-30"
            }]
        });
        expect(screen.getByRole("region", { name: "Current delivery draft" }))
            .toBeVisible();
        expect(page.state.inventoryRecords).toBe(initial.inventoryRecords);
        expect(page.state.inventoryBatches).toBe(initial.inventoryBatches);
        expect(page.state.activityEvents).toBe(initial.activityEvents);
    });

    it("rejects a variant that does not belong to the selected product", () => {
        const onSave = vi.fn(() => undefined);
        render(
            <ReceiveDeliveryItemModal
                onClose={() => undefined}
                onSave={onSave}
                product={products[0]}
                productVariant={{
                    id: "variant-other",
                    variantName: "Other variant",
                    packagingHierarchy: [{
                        id: "vial",
                        name: "Vial",
                        costPrice: null,
                        sellingPrice: null,
                        quantityofNextLevel: null,
                        nextLevelId: null
                    }]
                }}
            />
        );
        const dialog = screen.getByRole("dialog", { name: "Receive Item" });
        fireEvent.submit(dialog.querySelector("form")!);

        expect(within(dialog).getByRole("alert")).toHaveTextContent(
            "The selected variant does not belong to this product."
        );
        expect(onSave).not.toHaveBeenCalled();
    });

    it("stores blank batch and expiry values as optional when adding an item", () => {
        const page = renderPage();
        fillRequiredHeader();
        fireEvent.change(screen.getByLabelText("Search products"), {
            target: { value: "Example medicine" }
        });
        fireEvent.click(screen.getByRole("option", {
            name: "Select product Example medicine"
        }));
        fireEvent.change(screen.getByLabelText("Select variant"), {
            target: { value: "variant-1" }
        });

        const dialog = screen.getByRole("dialog", { name: "Receive Item" });
        fireEvent.change(within(dialog).getByLabelText("Packaging level received"), {
            target: { value: "box" }
        });
        fireEvent.change(within(dialog).getByLabelText("Quantity received"), {
            target: { value: "1" }
        });
        fireEvent.click(within(dialog).getByRole("button", {
            name: "Add to Delivery"
        }));

        expect(page.state.deliveryDrafts[0].items[0]).toMatchObject({
            batchNumber: null,
            expiryDate: null
        });
    });

    it("keeps distinct batches as separate lines and supports item editing and removal", () => {
        const secondProduct: productStructure = {
            id: "product-2",
            name: "Another medicine",
            variant: [{
                id: "variant-2",
                variantName: "Liquid",
                packagingHierarchy: [{
                    id: "vial",
                    name: "Vial",
                    costPrice: null,
                    sellingPrice: null,
                    quantityofNextLevel: null,
                    nextLevelId: null
                }]
            }]
        };
        const initial = makeState();
        const page = renderPage({
            ...initial,
            products: [...products, secondProduct]
        });
        fillRequiredHeader();
        fireEvent.change(screen.getByLabelText("Search products"), {
            target: { value: "Example medicine" }
        });
        fireEvent.click(screen.getByRole("option", {
            name: "Select product Example medicine"
        }));
        fireEvent.change(screen.getByLabelText("Select variant"), {
            target: { value: "variant-1" }
        });

        for (const [batchNumber, expiryDate] of [
            ["LOT-A", "2027-12-31"],
            ["LOT-B", "2028-12-31"]
        ]) {
            const dialog = screen.getByRole("dialog", { name: "Receive Item" });
            fireEvent.change(within(dialog).getByLabelText("Packaging level received"), {
                target: { value: "box" }
            });
            fireEvent.change(within(dialog).getByLabelText("Quantity received"), {
                target: { value: "4" }
            });
            fireEvent.change(within(dialog).getByLabelText("Batch number"), {
                target: { value: batchNumber }
            });
            fireEvent.change(within(dialog).getByLabelText("Expiry date"), {
                target: { value: expiryDate }
            });
            fireEvent.click(within(dialog).getByRole("button", {
                name: "Add to Delivery"
            }));
            if (batchNumber === "LOT-A") {
                fireEvent.change(screen.getByLabelText("Select variant"), {
                    target: { value: "" }
                });
                fireEvent.change(screen.getByLabelText("Select variant"), {
                    target: { value: "variant-1" }
                });
            }
        }

        expect(page.state.deliveryDrafts).toHaveLength(1);
        expect(page.state.deliveryDrafts[0].items).toHaveLength(2);
        expect(page.state.deliveryDrafts[0].items.map((item) => [
            item.batchNumber,
            item.expiryDate
        ])).toEqual([
            ["LOT-A", "2027-12-31"],
            ["LOT-B", "2028-12-31"]
        ]);

        fireEvent.click(screen.getAllByRole("button", { name: "Edit Item" })[0]);
        const editDialog = screen.getByRole("dialog", { name: "Edit Delivery Item" });
        fireEvent.change(within(editDialog).getByLabelText("Quantity received"), {
            target: { value: "6" }
        });
        fireEvent.change(within(editDialog).getByLabelText("Batch number"), {
            target: { value: "LOT-A-EDITED" }
        });
        fireEvent.click(within(editDialog).getByRole("button", { name: "Save Item" }));
        expect(page.state.deliveryDrafts[0].items[0]).toMatchObject({
            quantity: 6,
            batchNumber: "LOT-A-EDITED",
            expiryDate: "2027-12-31"
        });

        fireEvent.click(screen.getAllByRole("button", { name: "Remove Item" })[1]);
        expect(page.state.deliveryDrafts[0].items).toHaveLength(1);
        expect(page.state.deliveryDrafts[0].items[0].batchNumber)
            .toBe("LOT-A-EDITED");

        fireEvent.change(screen.getByLabelText("Search products"), {
            target: { value: "Another medicine" }
        });
        fireEvent.click(screen.getByRole("option", {
            name: "Select product Another medicine"
        }));
        expect(screen.getByLabelText("Select variant")).toHaveValue("");
        expect(page.state.deliveryDrafts[0].items).toHaveLength(1);
        expect(page.state.deliveryDrafts[0].items[0].batchNumber)
            .toBe("LOT-A-EDITED");
        expect(page.state.inventoryRecords).toBe(initial.inventoryRecords);
        expect(page.state.inventoryBatches).toBe(initial.inventoryBatches);
        expect(page.state.activityEvents).toBe(initial.activityEvents);
    });

    it("shows a clear empty search result and an in-page create product action", () => {
        renderPage();
        fireEvent.change(screen.getByLabelText("Search products"), {
            target: { value: "unknown medicine" }
        });

        expect(screen.getByText(/No products match “unknown medicine”/))
            .toBeVisible();
        expect(screen.getByRole("button", { name: "Create New Product" }))
            .toBeVisible();
    });

    it("creates and selects a catalogue product without stock, Activity, or a delivery draft", () => {
        const initial = makeState();
        const page = renderPage(initial);
        fireEvent.change(screen.getByLabelText("Supplier"), {
            target: { value: "Preferred supplier" }
        });
        fireEvent.change(screen.getByLabelText("Received By *"), {
            target: { value: "Pharmacist A" }
        });
        fireEvent.change(screen.getByLabelText("Search products"), {
            target: { value: "brand new product" }
        });
        fireEvent.click(screen.getByRole("button", { name: "Create New Product" }));

        expect(screen.getByRole("dialog", { name: "Create Product" })).toBeVisible();
        expect(screen.queryByText("Batches and starting stock"))
            .not.toBeInTheDocument();
        fireEvent.change(screen.getByLabelText(/Product name/), {
            target: { value: "Brand New Product" }
        });
        fireEvent.click(screen.getByRole("button", {
            name: "Create Catalogue Product"
        }));

        expect(screen.queryByRole("dialog", { name: "Create Product" }))
            .not.toBeInTheDocument();
        expect(screen.getAllByText("Brand New Product")).toHaveLength(2);
        expect(screen.getByLabelText("Supplier")).toHaveValue("Preferred supplier");
        expect(screen.getByLabelText("Received By *")).toHaveValue("Pharmacist A");
        expect(page.state.products[0].name).toBe("Brand New Product");
        expect(page.state.inventoryRecords).toBe(initial.inventoryRecords);
        expect(page.state.inventoryBatches).toBe(initial.inventoryBatches);
        expect(page.state.activityEvents).toBe(initial.activityEvents);
        expect(page.state.deliveryDrafts).toEqual([]);
    });

    it("resets variant and closes the modal when product changes, then opens for the next variant", () => {
        const secondProduct: productStructure = {
            id: "product-2",
            name: "Another medicine",
            variant: [{
                id: "variant-2",
                variantName: "Liquid",
                packagingHierarchy: [{
                    id: "bottle",
                    name: "Bottle",
                    costPrice: null,
                    sellingPrice: null,
                    quantityofNextLevel: null,
                    nextLevelId: null
                }]
            }]
        };
        renderPage({
            ...makeState(),
            products: [...products, secondProduct]
        });
        fireEvent.change(screen.getByLabelText("Search products"), {
            target: { value: "Example medicine" }
        });
        fireEvent.click(screen.getByRole("option", {
            name: "Select product Example medicine"
        }));
        fireEvent.change(screen.getByLabelText("Select variant"), {
            target: { value: "variant-1" }
        });
        expect(screen.getByLabelText("Select variant")).toHaveValue("variant-1");
        expect(screen.getByRole("dialog", { name: "Receive Item" }))
            .toBeVisible();
        fireEvent.click(within(screen.getByRole("dialog", {
            name: "Receive Item"
        })).getByRole("button", { name: "Cancel" }));

        expect(screen.getByLabelText("Search products")).toBeVisible();
        expect(screen.queryByRole("button", { name: "Change Product" }))
            .not.toBeInTheDocument();
        fireEvent.change(screen.getByLabelText("Search products"), {
            target: { value: "Another medicine" }
        });
        fireEvent.click(screen.getByRole("option", {
            name: "Select product Another medicine"
        }));

        expect(screen.getByLabelText("Select variant")).toHaveValue("");
        expect(screen.queryByRole("dialog", { name: "Receive Item" }))
            .not.toBeInTheDocument();
        expect(screen.getByRole("option", { name: "Liquid" })).toBeInTheDocument();
        expect(screen.queryByRole("option", { name: "10 mg tablets" }))
            .not.toBeInTheDocument();
        fireEvent.change(screen.getByLabelText("Select variant"), {
            target: { value: "variant-2" }
        });
        expect(screen.getByRole("dialog", { name: "Receive Item" }))
            .toBeVisible();
    });

    it("adds a variant to the selected product and auto-selects it without changing stock or drafts", () => {
        const initial = makeState();
        const page = renderPage(initial);
        fireEvent.change(screen.getByLabelText("Search products"), {
            target: { value: "Example medicine" }
        });
        fireEvent.click(screen.getByRole("option", {
            name: "Select product Example medicine"
        }));
        fireEvent.click(screen.getByRole("button", { name: "Add Variant" }));

        expect(screen.getByRole("dialog", { name: "Add Variant" }))
            .toHaveTextContent("For Example medicine");
        fireEvent.change(screen.getByLabelText(/Name or description/), {
            target: { value: "Capsule" }
        });
        fireEvent.click(screen.getByRole("button", { name: "Add Packaging Level" }));
        fireEvent.change(screen.getByLabelText(/Packaging name/), {
            target: { value: "Bottle" }
        });
        fireEvent.change(screen.getByLabelText("Selling price"), {
            target: { value: "15.5" }
        });
        fireEvent.click(within(screen.getByRole("dialog", { name: "Add Variant" }))
            .getByRole("button", { name: "Add Variant" }));

        const addedVariant = page.state.products[0].variant.find(
            (productVariant) => productVariant.variantName === "Capsule"
        );
        expect(addedVariant).toMatchObject({
            packagingHierarchy: [{
                name: "Bottle",
                sellingPrice: 15.5
            }]
        });
        expect(screen.getByLabelText("Select variant"))
            .toHaveValue(addedVariant?.id);
        expect(screen.getByRole("dialog", { name: "Receive Item" }))
            .toBeVisible();
        expect(page.state.inventoryRecords).toBe(initial.inventoryRecords);
        expect(page.state.inventoryBatches).toBe(initial.inventoryBatches);
        expect(page.state.activityEvents).toBe(initial.activityEvents);
        expect(page.state.deliveryDrafts).toEqual([]);
    });

    it("validates Received By and Delivery Date only on approval", () => {
        const draft = draftWithItem("delivery-validation", "Supplier");
        const initial = makeState([draft]);
        const page = renderPage(initial);
        fireEvent.change(screen.getByLabelText("Received By *"), {
            target: { value: "" }
        });
        expect(page.state.deliveryDrafts[0].receivedBy).toBe("");
        expect(screen.queryByText("Received by is required."))
            .not.toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Approve Delivery" }));
        expect(screen.getByText("Received by is required.")).toBeVisible();
        expect(screen.getByLabelText(/Received By/))
            .toHaveAttribute("aria-invalid", "true");
        expect(page.state.deliveryDrafts[0].status).toBe("draft");
        expect(page.state.deliveryDrafts[0].receivedBy).toBe("");
        expect(page.state.inventoryRecords).toEqual(initial.inventoryRecords);
        expect(page.state.inventoryBatches).toEqual(initial.inventoryBatches);
        expect(page.state.activityEvents).toEqual(initial.activityEvents);

        fillRequiredHeader("Pharmacist");
        fireEvent.change(screen.getByLabelText("Delivery Date *"), {
            target: { value: "" }
        });
        expect(page.state.deliveryDrafts[0]).toMatchObject({
            receivedBy: "Pharmacist",
            deliveryDate: ""
        });
        fireEvent.click(screen.getByRole("button", { name: "Approve Delivery" }));
        expect(screen.getByText(
            "Delivery date must be a valid date in YYYY-MM-DD format."
        ))
            .toBeVisible();
        expect(screen.getByLabelText(/Delivery Date/))
            .toHaveAttribute("aria-invalid", "true");
        expect(page.state.deliveryDrafts[0].status).toBe("draft");
        expect(page.state.inventoryRecords).toEqual(initial.inventoryRecords);
        expect(page.state.inventoryBatches).toEqual(initial.inventoryBatches);
        expect(page.state.activityEvents).toEqual(initial.activityEvents);
    });

    it("approves the delivery once and shows the received state", () => {
        const draft = draftWithItem("delivery-approved", "Supplier");
        const initial = makeState([draft]);
        const page = renderPage(initial);

        fireEvent.click(screen.getByRole("button", { name: "Approve Delivery" }));

        expect(page.state.deliveryDrafts[0].status).toBe("received");
        expect(page.state.inventoryRecords).toHaveLength(1);
        expect(page.state.inventoryRecords[0].stockQuantities).toEqual([{
            packagingLevelId: "box",
            quantity: 4
        }]);
        expect(page.state.inventoryBatches).toHaveLength(1);
        expect(page.state.activityEvents).toHaveLength(1);
        expect(page.state.activityEvents[0].type).toBe("delivery.received");
        expect(screen.getByText(/Delivery received successfully/)).toBeVisible();
        expect(screen.queryByRole("button", { name: "Approve Delivery" }))
            .not.toBeInTheDocument();

        expect(page.state.inventoryBatches).not.toBe(initial.inventoryBatches);
        expect(page.state.activityEvents).not.toBe(initial.activityEvents);
        expect(page.state.deliveryDrafts[0].items).toEqual(draft.items);
    });

    it("does not announce success until the received state is committed", () => {
        const draft = draftWithItem("delivery-not-committed", "Supplier");
        const page = renderPage(makeState([draft]), true);

        fireEvent.click(screen.getByRole("button", { name: "Approve Delivery" }));

        expect(page.state.deliveryDrafts[0].status).toBe("draft");
        expect(screen.queryByText(/Delivery received successfully/))
            .not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Approve Delivery" }))
            .toBeVisible();
    });

    it("automatically updates header fields while preserving draft items", () => {
        const initialDraft = draftWithItem("delivery-one", "Old supplier");
        const initial = makeState([initialDraft]);
        const page = renderPage(initial);

        expect(screen.getByText("Example medicine")).toBeVisible();
        expect(screen.getByText(/10 mg tablets · Box · Quantity 4/))
            .toBeVisible();
        expect(screen.getByText(/LOT-1/)).toBeVisible();

        fireEvent.change(screen.getByLabelText("Supplier"), {
            target: { value: "New supplier" }
        });
        fireEvent.change(screen.getByLabelText("Delivery Date *"), {
            target: { value: "2026-11-05" }
        });
        expect(page.state.deliveryDrafts[0]).toMatchObject({
            deliveryDate: "2026-11-05",
            supplier: "New supplier",
            receivedBy: "Pharmacist",
            items: initialDraft.items
        });
        expect(page.state.inventoryRecords).toBe(initial.inventoryRecords);
        expect(page.state.inventoryBatches).toBe(initial.inventoryBatches);
        expect(page.state.activityEvents).toBe(initial.activityEvents);
        expect(screen.queryByRole("button", { name: "Save Delivery Details" }))
            .not.toBeInTheDocument();
    });

    it("shows only the active draft without a draft-selection control", () => {
        const first = draftWithItem("delivery-one", "Supplier One");
        const second = makeDraft("delivery-two", {
            supplier: "Supplier Two",
            invoiceNumber: "INV-2"
        });
        const page = renderPage(makeState([first, second]));

        expect(screen.getByRole("heading", {
            name: "Current delivery draft"
        })).toBeVisible();
        expect(screen.getByLabelText("Supplier"))
            .toHaveValue("Supplier One");
        expect(screen.getByText(/Quantity 4/)).toBeVisible();
        expect(screen.queryByLabelText("Select delivery draft"))
            .not.toBeInTheDocument();
        expect(screen.queryByRole("combobox", { name: "Select delivery draft" }))
            .not.toBeInTheDocument();
        expect(screen.queryByText("delivery-one")).not.toBeInTheDocument();
        expect(screen.queryByText("delivery-two")).not.toBeInTheDocument();
        expect(page.state.deliveryDrafts).toHaveLength(2);
    });

    it("does not render new-delivery or draft-switching actions", () => {
        const draft = draftWithItem("delivery-existing", "Supplier");
        const initial = makeState([draft]);
        const page = renderPage(initial);

        expect(screen.queryByRole("button", { name: "Start New Delivery" }))
            .not.toBeInTheDocument();
        expect(screen.queryByLabelText("Select delivery draft"))
            .not.toBeInTheDocument();
        expect(page.state.deliveryDrafts).toEqual([draft]);
        expect(page.state.inventoryRecords).toBe(initial.inventoryRecords);
        expect(page.state.inventoryBatches).toBe(initial.inventoryBatches);
        expect(page.state.activityEvents).toBe(initial.activityEvents);
    });

    it("shows an empty state and indicates that a draft has not affected stock", () => {
        const page = renderPage(makeState([makeDraft("delivery-empty")]));
        expect(screen.getByText(/No items have been added/)).toBeVisible();
        expect(screen.getByText(/Draft preparation does not change inventory/))
            .toBeVisible();
        expect(screen.getByText(/Inventory and batch records remain unchanged/))
            .toBeVisible();
        expect(screen.queryByRole("button", { name: "Start New Delivery" }))
            .not.toBeInTheDocument();
        expect(screen.queryByLabelText("Select delivery draft"))
            .not.toBeInTheDocument();
        expect(page.state.inventoryRecords).toEqual([]);
        expect(page.state.activityEvents).toEqual([]);
    });

    it("places delivery entry above the draft review area", () => {
        renderPage(makeState([makeDraft("delivery-layout")]));
        const entry = screen.getByRole("region", { name: "Delivery entry" });
        const drafts = screen.getByRole("region", { name: "Current delivery draft" });
        expect(
            entry.compareDocumentPosition(drafts) &
                Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
    });

    it("routes the Receive Delivery navigation link to the page selection callback", () => {
        const selectedPages: string[] = [];
        render(
            <AppLayout
                activePage="inventory"
                onSelectPage={(page) => selectedPages.push(page)}
            >
                <div>Page content</div>
            </AppLayout>
        );

        fireEvent.click(screen.getByRole("link", { name: "Receive Delivery" }));
        expect(selectedPages).toEqual(["delivery"]);
    });

    it("keeps the mounted page and draft count stable when navigating away and back", () => {
        const draft = makeDraft("delivery-one");
        const initial = makeState([draft]);
        let currentPage = "delivery";
        function NavigationHarness() {
            const [activePage, setActivePage] = useState<
                "products" | "inventory" | "delivery" | "sales"
            >("delivery");
            currentPage = activePage;
            return (
                <>
                    <AppLayout
                        activePage={activePage}
                        onSelectPage={setActivePage}
                    >
                        <div hidden={activePage !== "delivery"}>
                            <ReceiveDeliveryPage
                                products={initial.products}
                                inventoryRecords={initial.inventoryRecords}
                                inventoryBatches={initial.inventoryBatches}
                                deliveryDrafts={initial.deliveryDrafts}
                                onDraftCreated={() => undefined}
                                onDraftDetailsUpdated={() => undefined}
                                onDraftItemAdded={() => undefined}
                                onDraftItemUpdated={() => undefined}
                                onDraftItemRemoved={() => undefined}
                                onApproveDelivery={() => ({
                                    success: false,
                                    error: "No delivery draft to approve."
                                })}
                                onCatalogueProductCreated={() => undefined}
                                onVariantCreated={() => undefined}
                            />
                        </div>
                    </AppLayout>
                </>
            );
        }
        render(<NavigationHarness />);

        act(() => {
            screen.getByRole("link", { name: "Inventory" }).click();
        });
        expect(currentPage).toBe("inventory");
        act(() => {
            screen.getByRole("link", { name: "Receive Delivery" }).click();
        });
        expect(currentPage).toBe("delivery");
        expect(screen.getByLabelText("Supplier")).toHaveValue("");
        expect(initial.deliveryDrafts).toHaveLength(1);
    });
});
