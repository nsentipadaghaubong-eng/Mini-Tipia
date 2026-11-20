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
import {
    prepareActivityEvents,
    type ActivityEvent,
    type ActivityEventInput
} from "../../../activity/activity";
import AppLayout from "../../../components/layout/AppLayout";
import ActivityPage from "./ActivityPage";

afterEach(cleanup);

function makeEvents(
    inputs: readonly ActivityEventInput[]
): ActivityEvent[] {
    let id = 0;
    return prepareActivityEvents(inputs, {
        makeId: () => `event-${++id}`,
        now: () => new Date("2026-11-15T12:00:00.000Z")
    });
}

const stockAdjustment: ActivityEventInput = {
    type: "inventory.stock_adjusted",
    operationKey: "stock-adjustment-private",
    actorId: "actor-id-private",
    inventoryId: "inventory-id-private",
    productId: "product-id-private",
    productName: "Medicine",
    variantId: "variant-id-private",
    variantName: "500 mg tablets",
    batch: {
        batchId: "batch-id-private",
        productId: "product-id-private",
        productName: "Medicine",
        variantId: "variant-id-private",
        variantName: "500 mg tablets",
        batchNumber: "LOT-44",
        expiryDate: "2027-12-31",
        pricingByPackagingLevel: []
    },
    packagingLevel: {
        packagingLevelId: "packaging-id-private",
        name: "Box",
        costPrice: null,
        sellingPrice: 15,
        quantityOfNextLevel: 4,
        nextLevelId: "next-packaging-id-private",
        nextLevelName: "Pack"
    },
    previousQuantity: 4,
    newQuantity: 7,
    quantityDifference: 3,
    reason: "Physical count"
};

const sale: ActivityEventInput = {
    type: "sale.completed",
    operationKey: "sale-operation-private",
    actorId: "actor-id-private",
    saleId: "sale-id-private",
    customerName: "Customer One",
    customerAddress: "private-address",
    notes: "private-note",
    saleDate: "2026-11-14",
    staffMember: { userId: "staff-id-private", displayName: "Ada" },
    subtotal: 120,
    discountAmount: 20,
    finalAmount: 100,
    expiredBatchConfirmed: false,
    items: [{
        productId: "product-id-private",
        productName: "Medicine",
        variantId: "variant-id-private",
        variantName: "500 mg tablets",
        product: {
            productId: "product-id-private",
            productName: "Medicine",
            variants: []
        },
        variant: {
            variantId: "variant-id-private",
            variantName: "500 mg tablets",
            packaging: []
        },
        packagingLevel: {
            packagingLevelId: "packaging-id-private",
            name: "Box",
            costPrice: 12,
            sellingPrice: 60,
            quantityOfNextLevel: null,
            nextLevelId: null,
            nextLevelName: null
        },
        quantity: 2,
        defaultSellingPrice: 60,
        appliedSellingPrice: 50,
        subtotal: 120,
        discountAmount: 20,
        finalAmount: 100,
        allocations: [{
            inventoryId: "inventory-id-private",
            batch: null,
            quantity: 2
        }]
    }]
};

const delivery: ActivityEventInput = {
    type: "delivery.received",
    operationKey: "delivery-operation-private",
    deliveryId: "delivery-id-private",
    deliveryDate: "2026-11-14",
    receivedBy: "Ada Pharmacist",
    supplierName: "Trusted Supplier",
    invoiceNumber: "INV-44",
    items: [{
        productId: "product-id-private",
        productName: "Medicine",
        variantId: "variant-id-private",
        variantName: "500 mg tablets",
        batch: {
            batchId: "batch-id-private",
            productId: "product-id-private",
            productName: "Medicine",
            variantId: "variant-id-private",
            variantName: "500 mg tablets",
            batchNumber: "LOT-44",
            expiryDate: "2027-12-31",
            pricingByPackagingLevel: []
        },
        pricingAtReceipt: {
            packagingLevelId: "packaging-id-private",
            costPrice: null,
            sellingPrice: 12
        },
        stock: [{
            packagingLevel: {
                packagingLevelId: "packaging-id-private",
                name: "Box",
                costPrice: null,
                sellingPrice: 20,
                quantityOfNextLevel: null,
                nextLevelId: null,
                nextLevelName: null
            },
            quantity: 6
        }]
    }]
};

describe("ActivityPage", () => {
    it("renders a useful empty state with search and filter controls", () => {
        render(<ActivityPage activityEvents={[]} />);

        expect(screen.getByRole("heading", {
            name: "No activity recorded yet"
        })).toBeInTheDocument();
        expect(screen.queryByRole("button")).not.toBeInTheDocument();
        expect(screen.getByRole("searchbox", { name: "Search activity" }))
            .toBeInTheDocument();
        expect(screen.getByRole("combobox", { name: "Filter activity type" }))
            .toBeInTheDocument();
    });

    it("updates the timeline as the user searches and filters activity", () => {
        render(<ActivityPage activityEvents={makeEvents([stockAdjustment, sale, delivery])} />);

        const searchInput = screen.getByRole("searchbox", { name: "Search activity" });
        const filter = screen.getByRole("combobox", { name: "Filter activity type" });

        fireEvent.change(searchInput, { target: { value: "LOT-44" } });
        expect(screen.getByText("Medicine · 500 mg tablets · 4 Box → 7 Box (+3)")).toBeInTheDocument();
        expect(screen.queryByText("Customer One")).not.toBeInTheDocument();

        fireEvent.change(searchInput, { target: { value: "Customer" } });
        fireEvent.change(filter, { target: { value: "sales" } });
        expect(screen.getAllByText(/Final amount/i).length).toBeGreaterThan(0);
        expect(screen.getByText("Customer One")).toBeInTheDocument();
        expect(screen.queryByText("Medicine · 500 mg tablets · 4 Box → 7 Box (+3)")).not.toBeInTheDocument();

        fireEvent.change(searchInput, { target: { value: "" } });
        expect(screen.getAllByText(/Final amount/i).length).toBeGreaterThan(0);
        fireEvent.change(filter, { target: { value: "all" } });
        expect(screen.getByText("Medicine · 500 mg tablets · 4 Box → 7 Box (+3)")).toBeInTheDocument();
    });

    it("shows a clear stock transition, business details and no internal or actor IDs", () => {
        render(<ActivityPage activityEvents={makeEvents([stockAdjustment])} />);

        expect(screen.getByText(
            "Medicine · 500 mg tablets · 4 Box → 7 Box (+3)"
        )).toBeInTheDocument();
        expect(screen.queryByText("Actor: actor-id-private")).not.toBeInTheDocument();

        const summary = screen.getByText("View details");
        const details = summary.closest("details");
        expect(details).not.toBeNull();
        fireEvent.click(summary);

        expect(details).toHaveAttribute("open");
        expect(within(details!).getByText("Previous quantity")).toBeInTheDocument();
        expect(within(details!).getByText("New quantity")).toBeInTheDocument();
        expect(within(details!).getByText("Difference")).toBeInTheDocument();
        expect(within(details!).getByText("Physical count")).toBeInTheDocument();
        expect(within(details!).getByText("LOT-44")).toBeInTheDocument();
        expect(within(details!).queryByText(/inventory-id-private|product-id-private|batch-id-private|packaging-id-private|actor-id-private/))
            .not.toBeInTheDocument();

        fireEvent.click(summary);
        expect(details).not.toHaveAttribute("open");
    });

    it("renders business sale totals and line details without private or internal fields", () => {
        render(<ActivityPage activityEvents={makeEvents([sale])} />);

        expect(screen.getByText(/Final amount.*₦100/)).toBeInTheDocument();
        expect(screen.getByText("Staff: Ada")).toBeInTheDocument();
        fireEvent.click(screen.getByText("View details"));

        const details = screen.getByText("Recorded details").parentElement;
        expect(details).not.toBeNull();
        expect(within(details!).getByText("Sale date")).toBeInTheDocument();
        expect(within(details!).getByText("14 Nov 2026")).toBeInTheDocument();
        expect(within(details!).getByText("Customer One")).toBeInTheDocument();
        expect(within(details!).getByText("Subtotal")).toBeInTheDocument();
        expect(within(details!).getByText("Total discount")).toBeInTheDocument();
        expect(within(details!).getByText("Final amount")).toBeInTheDocument();
        expect(within(details!).getByText("Quantity sold")).toBeInTheDocument();
        expect(within(details!).getByText("Unit selling price")).toBeInTheDocument();
        expect(within(details!).getByText("Line subtotal")).toBeInTheDocument();
        expect(within(details!).getByText("Line discount")).toBeInTheDocument();
        expect(within(details!).getByText("Line total")).toBeInTheDocument();
        expect(within(details!).queryByText(/private-address|private-note|sale-id-private|inventory-id-private|staff-id-private|actor-id-private|product-id-private|packaging-id-private/))
            .not.toBeInTheDocument();
    });

    it("omits unavailable sale fields rather than rendering invented placeholders", () => {
        const saleWithoutOptionals: ActivityEventInput = {
            type: "sale.completed",
            operationKey: "sale-without-optionals",
            saleId: "sale-id-private",
            customerName: "",
            subtotal: 0,
            discountAmount: 0,
            finalAmount: 0,
            expiredBatchConfirmed: false,
            items: []
        };
        render(
            <ActivityPage activityEvents={makeEvents([saleWithoutOptionals])} />
        );

        expect(screen.queryByText("Customer not recorded")).not.toBeInTheDocument();
        fireEvent.click(screen.getByText("View details"));
        expect(screen.queryByText("Not recorded")).not.toBeInTheDocument();
        expect(screen.queryByText("Empty value")).not.toBeInTheDocument();
        expect(screen.queryByText("Customer")).not.toBeInTheDocument();
        expect(screen.queryByText("Sale date")).not.toBeInTheDocument();
    });

    it("shows delivery receipt date, receiver, invoice, products, quantities and expiry", () => {
        render(<ActivityPage activityEvents={makeEvents([delivery])} />);

        expect(screen.getByText(/14 Nov 2026.*Trusted Supplier/))
            .toBeInTheDocument();
        expect(screen.getByText("Received by: Ada Pharmacist")).toBeInTheDocument();
        fireEvent.click(screen.getByText("View details"));

        const details = screen.getByText("Recorded details").parentElement;
        expect(details).not.toBeNull();
        expect(within(details!).getByText("INV-44")).toBeInTheDocument();
        expect(within(details!).getByText("LOT-44")).toBeInTheDocument();
        expect(within(details!).getByText("31 Dec 2027")).toBeInTheDocument();
        expect(within(details!).getByText("Packaging")).toBeInTheDocument();
        expect(within(details!).getByText("Quantity received")).toBeInTheDocument();
        expect(within(details!).queryByText(/delivery-id-private|product-id-private|variant-id-private|batch-id-private|packaging-id-private/))
            .not.toBeInTheDocument();
    });

    it("renders only changed product values and the reason", () => {
        const update: ActivityEventInput = {
            type: "product.updated",
            operationKey: "product-update-private",
            productId: "product-id-private",
            productName: "Medicine",
            before: {
                productId: "product-id-private",
                productName: "Medicine",
                description: "Same description",
                variants: []
            },
            after: {
                productId: "product-id-private",
                productName: "Updated medicine",
                description: "Same description",
                variants: []
            },
            reason: "Corrected label"
        };
        render(<ActivityPage activityEvents={makeEvents([update])} />);

        expect(screen.getByText(/Updated medicine.*name changed/))
            .toBeInTheDocument();
        fireEvent.click(screen.getByText("View details"));

        const details = screen.getByText("Recorded details").parentElement;
        expect(details).not.toBeNull();
        expect(within(details!).getByText("Medicine → Updated medicine"))
            .toBeInTheDocument();
        expect(within(details!).getByText("Corrected label")).toBeInTheDocument();
        expect(within(details!).queryByText("Same description"))
            .not.toBeInTheDocument();
        expect(within(details!).queryByText(/product-id-private/))
            .not.toBeInTheDocument();
    });

    it("renders large details and long names without truncating selected data", () => {
        const longName = "Long pharmacy product name ".repeat(20);
        const variants = Array.from({ length: 30 }, (_, index) => ({
            variantId: `variant-id-private-${index}`,
            variantName: `Variant ${index}`,
            packaging: []
        }));
        const largeProduct: ActivityEventInput = {
            type: "product.created",
            operationKey: "large-product-private",
            product: {
                productId: "product-id-private",
                productName: longName,
                variants
            },
            initialInventory: []
        };
        render(<ActivityPage activityEvents={makeEvents([largeProduct])} />);

        expect(screen.getByText(longName.trim())).toBeInTheDocument();
        fireEvent.click(screen.getByText("View details"));
        expect(screen.getByText("Variant 29")).toBeInTheDocument();
        expect(screen.queryByText(/variant-id-private/)).not.toBeInTheDocument();
    });

    it("routes the Activity sidebar link through the selected-page callback", () => {
        const onSelectPage = vi.fn();
        const { rerender } = render(
            <AppLayout activePage="inventory" onSelectPage={onSelectPage}>
                <div>Page content</div>
            </AppLayout>
        );
        const activityLink = screen.getByRole("link", { name: "Activity" });

        expect(activityLink).toHaveAttribute("href", "#activity");
        fireEvent.click(activityLink);
        expect(onSelectPage).toHaveBeenCalledWith("activity");

        rerender(
            <AppLayout activePage="activity" onSelectPage={onSelectPage}>
                <div>Page content</div>
            </AppLayout>
        );
        expect(screen.getByRole("link", { name: "Activity" }))
            .toHaveAttribute("aria-current", "page");
    });
});
