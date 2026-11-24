// @vitest-environment jsdom

import { createElement } from "react";
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi
} from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    within
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { DeliveryDraft, DeliveryDraftItem } from "../../../deliveries/deliveryDraft";
import type { inventory } from "../../../inventory/inventoryStock";
import type { inventoryBatch } from "../../../inventory/inventoryBatch";
import type { productStructure } from "../../../products/productStructure";
import type { SaleDraft, SaleDraftItem } from "../../../sales/salesDraft";
import DashboardPage from "./DashboardPage";

const today = new Date("2026-11-20T12:00:00.000Z");

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(today);
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

function makeSaleItem(
    productId: string,
    variantId: string,
    quantity: number
): SaleDraftItem {
    return {
        lineId: `line-${productId || "empty"}`,
        productId,
        variantId,
        inventoryRecordId: `inventory-${productId || "empty"}`,
        batchId: null,
        packagingLevelId: `packaging-${variantId || "empty"}`,
        quantity,
        defaultSellingPrice: 1,
        appliedSellingPrice: 1,
        discountAmount: 0
    };
}

function makeDeliveryItem(
    productId: string,
    variantId: string,
    quantity: number
): DeliveryDraftItem {
    return {
        deliveryItemId: `item-${productId || "empty"}`,
        productId,
        variantId,
        packagingLevelId: `packaging-${variantId || "empty"}`,
        quantity,
        batchNumber: null,
        expiryDate: null,
        costPrice: null,
        sellingPrice: null
    };
}

function makeSaleDraft(
    draftId: string,
    status: SaleDraft["status"] = "draft",
    items: SaleDraftItem[] = []
): SaleDraft {
    return {
        draftId,
        status,
        createdAt: "2026-11-20T10:00:00.000Z",
        updatedAt: "2026-11-20T10:00:00.000Z",
        items
    };
}

function makeDeliveryDraft(
    deliveryId: string,
    status: DeliveryDraft["status"] = "draft",
    items: DeliveryDraftItem[] = [],
    invoiceNumber?: string
): DeliveryDraft {
    return {
        deliveryId,
        status,
        createdAt: "2026-11-20T10:00:00.000Z",
        updatedAt: "2026-11-20T10:00:00.000Z",
        deliveryDate: "2026-11-20",
        receivedBy: "Pharmacist",
        ...(invoiceNumber ? { invoiceNumber } : {}),
        items
    };
}

function makeProduct(
    id: string,
    name: string,
    variantId: string,
    variantName: string,
    threshold = 5
): productStructure {
    const levelId = `level-${variantId}`;
    return {
        id,
        name,
        variant: [{
            id: variantId,
            variantName,
            lowStockThreshold: {
                quantity: threshold,
                packagingLevelId: levelId
            },
            packagingHierarchy: [{
                id: levelId,
                name: "Pack",
                nextLevelId: null,
                quantityofNextLevel: null,
                costPrice: null,
                sellingPrice: null
            }]
        }]
    };
}

function makeInventoryRecord(
    product: productStructure,
    quantity: number,
    batchId: string | null = null
): inventory {
    const productVariant = product.variant[0];
    const level = productVariant?.packagingHierarchy[0];
    if (!productVariant || !level) {
        throw new Error("Dashboard inventory fixture requires a packaged variant.");
    }

    return {
        id: `record-${product.id}`,
        productId: product.id,
        variantId: productVariant.id,
        batchId,
        stockQuantities: [{
            packagingLevelId: level.id,
            quantity
        }]
    };
}

function makeBatch(
    product: productStructure,
    batchId: string,
    expiryDate: Date
): inventoryBatch {
    const productVariant = product.variant[0];
    if (!productVariant) {
        throw new Error("Dashboard batch fixture requires a variant.");
    }
    return {
        batchId,
        productId: product.id,
        variantId: productVariant.id,
        batchNumber: batchId,
        expiryDate,
        pricingByPackagingLevel: []
    };
}

function dateOffset(days: number): Date {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() + days);
    return date;
}

function renderDashboard(
    props: Partial<{
        products: productStructure[];
        inventoryRecords: inventory[];
        inventoryBatches: inventoryBatch[];
        saleDrafts: SaleDraft[];
        deliveryDrafts: DeliveryDraft[];
    }> = {}
) {
    const onNavigate = vi.fn();
    render(createElement(DashboardPage, {
        products: [],
        inventoryRecords: [],
        inventoryBatches: [],
        saleDrafts: [],
        deliveryDrafts: [],
        onNavigate,
        ...props
    }));
    return onNavigate;
}

describe("Dashboard pending activities", () => {
    it("shows active Sales drafts and opens the Sales workflow", () => {
        const firstDraft = makeSaleDraft("sale-uuid-first", "draft", [
            makeSaleItem("first-customer", "tablets", 1)
        ]);
        const secondDraft = makeSaleDraft("sale-uuid-4a2b9c15", "draft", [
            makeSaleItem("panadol", "tablets", 5)
        ]);
        const firstDraftSnapshot = structuredClone(firstDraft);
        const onNavigate = renderDashboard({
            saleDrafts: [firstDraft, secondDraft]
        });

        expect(screen.getByRole("heading", { name: "Pending Activities" }))
            .toBeInTheDocument();
        const salesButtons = screen.getAllByRole("button", {
            name: "Open Sales"
        });
        expect(salesButtons).toHaveLength(2);
        expect(screen.queryByText("sale-uuid-first")).not.toBeInTheDocument();
        expect(screen.queryByText("sale-uuid-4a2b9c15")).not.toBeInTheDocument();

        fireEvent.click(salesButtons[1]);
        expect(onNavigate).toHaveBeenCalledWith({
            type: "sale.draft.open",
            draftId: secondDraft.draftId
        });
        expect(firstDraft).toEqual(firstDraftSnapshot);
    });

    it("shows active delivery drafts, their invoice number, and opens Receive Delivery", () => {
        const firstDraft = makeDeliveryDraft(
            "delivery-draft-first",
            "draft",
            [makeDeliveryItem("first-product", "tablets", 2)],
            "INV-203"
        );
        const secondDraft = makeDeliveryDraft(
            "delivery-draft-1",
            "draft",
            [makeDeliveryItem("vitamin-c", "tablets", 10)],
            "INV-204"
        );
        const firstDraftSnapshot = structuredClone(firstDraft);
        const onNavigate = renderDashboard({
            deliveryDrafts: [firstDraft, secondDraft]
        });

        expect(screen.getByText("Invoice: INV-203")).toBeInTheDocument();
        expect(screen.getByText("Invoice: INV-204")).toBeInTheDocument();
        const deliveryButtons = screen.getAllByRole("button", {
            name: "Open Receive Delivery"
        });
        expect(deliveryButtons).toHaveLength(2);

        fireEvent.click(deliveryButtons[1]);
        expect(onNavigate).toHaveBeenCalledWith({
            type: "delivery.draft.open",
            deliveryId: secondDraft.deliveryId
        });
        expect(firstDraft).toEqual(firstDraftSnapshot);
    });

    it("does not display an internal delivery ID when no invoice number is available", () => {
        const internalDeliveryId = "delivery-uuid-9d3e2a41";
        const draft = makeDeliveryDraft(internalDeliveryId);
        renderDashboard({ deliveryDrafts: [draft] });

        expect(screen.queryByText(/Reference:/)).not.toBeInTheDocument();
        expect(screen.queryByText(internalDeliveryId)).not.toBeInTheDocument();
    });

    it("counts selected product entries rather than quantities or empty rows", () => {
        const draft = makeSaleDraft("sale-draft-count", "draft", [
            makeSaleItem("panadol", "tablets", 5),
            makeSaleItem("vitamin-c", "tablets", 10),
            makeSaleItem("", "", 15),
            makeSaleItem("incomplete", "", 4)
        ]);
        renderDashboard({ saleDrafts: [draft] });

        const entry = screen.getByRole("heading", {
            name: "Pending Sale"
        }).closest("article");
        expect(entry).not.toBeNull();
        expect(within(entry!).getByText("2 products")).toBeInTheDocument();
        expect(within(entry!).queryByText("15 products")).not.toBeInTheDocument();
    });

    it("does not show approved, received, or cancelled transactions as pending", () => {
        renderDashboard({
            saleDrafts: [
                makeSaleDraft("approved-sale", "approved"),
                makeSaleDraft("cancelled-sale", "cancelled")
            ],
            deliveryDrafts: [
                makeDeliveryDraft("received-delivery", "received"),
                makeDeliveryDraft("cancelled-delivery", "cancelled")
            ]
        });

        expect(screen.queryByRole("heading", { name: "Pending Sale" }))
            .not.toBeInTheDocument();
        expect(screen.queryByRole("heading", { name: "Pending Delivery" }))
            .not.toBeInTheDocument();
        expect(screen.getByText(
            "There are no pending Sales or Receive Delivery drafts."
        )).toBeInTheDocument();
    });
});

describe("Dashboard inventory alerts", () => {
    it("opens the correct expiry details for each expiry category", () => {
        const soonProduct = makeProduct(
            "product-soon",
            "Vaccine",
            "variant-soon",
            "Vials"
        );
        const expiredProduct = makeProduct(
            "product-expired",
            "Antibiotic",
            "variant-expired",
            "Capsules"
        );
        const todayProduct = makeProduct(
            "product-today",
            "Insulin",
            "variant-today",
            "Pens"
        );
        renderDashboard({
            products: [soonProduct, expiredProduct, todayProduct],
            inventoryRecords: [
                makeInventoryRecord(soonProduct, 2, "batch-soon"),
                makeInventoryRecord(expiredProduct, 2, "batch-expired"),
                makeInventoryRecord(todayProduct, 2, "batch-today")
            ],
            inventoryBatches: [
                makeBatch(soonProduct, "batch-soon", dateOffset(30)),
                makeBatch(expiredProduct, "batch-expired", dateOffset(-1)),
                makeBatch(todayProduct, "batch-today", dateOffset(0))
            ]
        });

        expect(screen.getByRole("button", {
            name: "Open Expiring Soon details, 1 affected product/variant"
        })).toHaveTextContent("1");
        expect(screen.queryByText("Vaccine · Vials")).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", {
            name: "Open Expiring Soon details, 1 affected product/variant"
        }));
        expect(screen.getByRole("dialog", { name: "Expiring Soon" }))
            .toBeInTheDocument();
        expect(screen.getByText("Vaccine · Vials")).toBeInTheDocument();
        expect(screen.getByText("20 Dec 2026")).toBeInTheDocument();
        expect(screen.getByText("30 days remaining")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", {
            name: "Close Expiring Soon details"
        }));

        fireEvent.click(screen.getByRole("button", {
            name: "Open Expired Products details, 1 affected product/variant"
        }));
        expect(screen.getByRole("dialog", { name: "Expired Products" }))
            .toBeInTheDocument();
        expect(screen.getByText("Antibiotic · Capsules")).toBeInTheDocument();
        expect(screen.getByText("19 Nov 2026")).toBeInTheDocument();
        expect(screen.getByText("Expired 1 day ago")).toBeInTheDocument();
        expect(screen.queryByText("Vaccine · Vials")).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", {
            name: "Close Expired Products details"
        }));

        fireEvent.click(screen.getByRole("button", {
            name: "Open Expired Today details, 1 affected product/variant"
        }));
        expect(screen.getByRole("dialog", { name: "Expired Today" }))
            .toBeInTheDocument();
        expect(screen.getByText("Insulin · Pens")).toBeInTheDocument();
        expect(screen.getByText("20 Nov 2026")).toBeInTheDocument();
        expect(screen.getByText("Expires today")).toBeInTheDocument();
    });

    it("counts affected variants once while listing every matching expiry batch", () => {
        const product = makeProduct(
            "product-multiple-expiry-batches",
            "Panadol",
            "variant-multiple-expiry-batches",
            "500mg Tablets"
        );
        const firstRecord = makeInventoryRecord(product, 2, "batch-first");
        const secondRecord = makeInventoryRecord(product, 3, "batch-second");
        renderDashboard({
            products: [product],
            inventoryRecords: [
                { ...firstRecord, id: "record-first" },
                { ...secondRecord, id: "record-second" }
            ],
            inventoryBatches: [
                makeBatch(product, "batch-first", dateOffset(20)),
                makeBatch(product, "batch-second", dateOffset(45))
            ]
        });

        const card = screen.getByRole("button", {
            name: "Open Expiring Soon details, 1 affected product/variant"
        });
        expect(card).toHaveTextContent("1");
        expect(screen.queryByText("Panadol · 500mg Tablets"))
            .not.toBeInTheDocument();

        fireEvent.click(card);
        const dialog = screen.getByRole("dialog", { name: "Expiring Soon" });
        expect(within(dialog).getAllByRole("listitem")).toHaveLength(2);
        expect(within(dialog).getAllByText("Panadol · 500mg Tablets"))
            .toHaveLength(2);
        expect(within(dialog).getByText("Batch batch-first"))
            .toBeInTheDocument();
        expect(within(dialog).getByText("Batch batch-second"))
            .toBeInTheDocument();
    });

    it("excludes an expired batch when its stock is zero", () => {
        const product = makeProduct(
            "product-zero-expired-stock",
            "Expired medicine",
            "variant-zero-expired-stock",
            "Tablets"
        );
        renderDashboard({
            products: [product],
            inventoryRecords: [{
                ...makeInventoryRecord(product, 0, "batch-zero-expired"),
                id: "record-zero-expired"
            }],
            inventoryBatches: [
                makeBatch(product, "batch-zero-expired", dateOffset(-1))
            ]
        });

        const card = screen.getByRole("button", {
            name: "Open Expired Products details, 0 affected products/variants"
        });
        fireEvent.click(card);

        const dialog = screen.getByRole("dialog", { name: "Expired Products" });
        expect(within(dialog).getByText("0 affected entries"))
            .toBeInTheDocument();
        expect(within(dialog).getByRole("status"))
            .toHaveTextContent("There are no affected entries in this category.");
        expect(within(dialog).queryByText("Batch batch-zero-expired"))
            .not.toBeInTheDocument();
    });

    it("keeps positive-stock expired batches eligible alongside zero-stock batches", () => {
        const product = makeProduct(
            "product-mixed-expired-stock",
            "Medicine",
            "variant-mixed-expired-stock",
            "Capsules"
        );
        renderDashboard({
            products: [product],
            inventoryRecords: [
                {
                    ...makeInventoryRecord(product, 0, "batch-zero-stock"),
                    id: "record-zero-stock"
                },
                {
                    ...makeInventoryRecord(product, 4, "batch-positive-stock"),
                    id: "record-positive-stock"
                }
            ],
            inventoryBatches: [
                makeBatch(product, "batch-zero-stock", dateOffset(-2)),
                makeBatch(product, "batch-positive-stock", dateOffset(-1))
            ]
        });

        const card = screen.getByRole("button", {
            name: "Open Expired Products details, 1 affected product/variant"
        });
        fireEvent.click(card);

        const dialog = screen.getByRole("dialog", { name: "Expired Products" });
        expect(within(dialog).getAllByRole("listitem")).toHaveLength(1);
        expect(within(dialog).getByText("Batch batch-positive-stock"))
            .toBeInTheDocument();
        expect(within(dialog).queryByText("Batch batch-zero-stock"))
            .not.toBeInTheDocument();
    });

    it("keeps distinct product/variant totals while search retains all matching batches", () => {
        const panadol = makeProduct(
            "product-expiry-search-panadol",
            "Panadol",
            "variant-expiry-search-panadol",
            "Tablets"
        );
        const vaccine = makeProduct(
            "product-expiry-search-vaccine",
            "Vaccine",
            "variant-expiry-search-vaccine",
            "Vials"
        );
        renderDashboard({
            products: [panadol, vaccine],
            inventoryRecords: [
                {
                    ...makeInventoryRecord(panadol, 2, "batch-panadol-first"),
                    id: "record-panadol-first"
                },
                {
                    ...makeInventoryRecord(panadol, 3, "batch-panadol-second"),
                    id: "record-panadol-second"
                },
                {
                    ...makeInventoryRecord(vaccine, 1, "batch-vaccine"),
                    id: "record-vaccine"
                }
            ],
            inventoryBatches: [
                makeBatch(panadol, "batch-panadol-first", dateOffset(20)),
                makeBatch(panadol, "batch-panadol-second", dateOffset(45)),
                makeBatch(vaccine, "batch-vaccine", dateOffset(30))
            ]
        });

        const cardName =
            "Open Expiring Soon details, 2 affected products/variants";
        const card = screen.getByRole("button", { name: cardName });
        expect(card).toHaveTextContent("2");
        fireEvent.click(card);

        const dialog = screen.getByRole("dialog", { name: "Expiring Soon" });
        expect(within(dialog).getByText("3 affected entries"))
            .toBeInTheDocument();
        fireEvent.change(within(dialog).getByRole("searchbox", {
            name: "Search Expiring Soon alerts"
        }), { target: { value: "Panadol" } });

        expect(screen.getByRole("button", { name: cardName }))
            .toHaveTextContent("2");
        expect(within(dialog).getByText(
            "Showing 2 of 3 affected entries matching “Panadol”."
        )).toBeInTheDocument();
        expect(within(dialog).getAllByRole("listitem")).toHaveLength(2);
        expect(within(dialog).getByText("Batch batch-panadol-first"))
            .toBeInTheDocument();
        expect(within(dialog).getByText("Batch batch-panadol-second"))
            .toBeInTheDocument();
        expect(within(dialog).queryByText("Batch batch-vaccine"))
            .not.toBeInTheDocument();
    });

    it("omits the Expired Today section when no qualifying stock expires today", () => {
        const soonProduct = makeProduct(
            "product-soon",
            "Vaccine",
            "variant-soon",
            "Vials"
        );
        const expiredProduct = makeProduct(
            "product-expired",
            "Antibiotic",
            "variant-expired",
            "Capsules"
        );
        renderDashboard({
            products: [soonProduct, expiredProduct],
            inventoryRecords: [
                makeInventoryRecord(soonProduct, 2, "batch-soon"),
                makeInventoryRecord(expiredProduct, 2, "batch-expired")
            ],
            inventoryBatches: [
                makeBatch(soonProduct, "batch-soon", dateOffset(30)),
                makeBatch(expiredProduct, "batch-expired", dateOffset(-1))
            ]
        });

        expect(screen.queryByRole("button", {
            name: /Open Expired Today details/
        }))
            .not.toBeInTheDocument();
    });

    it("shows zero totals for empty categories while keeping Expired Today conditional", () => {
        const product = makeProduct(
            "product-healthy-stock",
            "Panadol",
            "variant-healthy-stock",
            "Tablets",
            5
        );
        renderDashboard({
            products: [product],
            inventoryRecords: [makeInventoryRecord(product, 6)]
        });

        for (const category of [
            "Expiring Soon",
            "Expired Products",
            "Low Stock",
            "Out of Stock"
        ]) {
            const card = screen.getByRole("button", {
                name: `Open ${category} details, 0 affected products/variants`
            });
            expect(card).toHaveTextContent("0");
        }
        expect(screen.queryByRole("button", {
            name: /Open Expired Today details/
        })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", {
            name: "Open Low Stock details, 0 affected products/variants"
        }));
        expect(screen.getByRole("dialog", { name: "Low Stock" }))
            .toHaveTextContent("There are no affected entries in this category.");
    });

    it("shows low and out-of-stock identities and includes expired stock in aggregation", () => {
        const lowStockProduct = makeProduct(
            "product-panadol",
            "Panadol",
            "variant-panadol",
            "500mg Tablets",
            5
        );
        const outOfStockProduct = makeProduct(
            "product-amoxicillin",
            "Amoxicillin",
            "variant-amoxicillin",
            "250mg Capsules",
            3
        );
        renderDashboard({
            products: [lowStockProduct, outOfStockProduct],
            inventoryRecords: [
                makeInventoryRecord(lowStockProduct, 5, "expired-panadol"),
                makeInventoryRecord(outOfStockProduct, 0)
            ],
            inventoryBatches: [
                makeBatch(lowStockProduct, "expired-panadol", dateOffset(-3))
            ]
        });

        const lowStockCard = screen.getByRole("button", {
            name: "Open Low Stock details, 1 affected product/variant"
        });
        const outOfStockCard = screen.getByRole("button", {
            name: "Open Out of Stock details, 1 affected product/variant"
        });
        expect(lowStockCard).toHaveTextContent("1");
        expect(outOfStockCard).toHaveTextContent("1");
        expect(screen.queryByText("Panadol · 500mg Tablets"))
            .not.toBeInTheDocument();

        fireEvent.click(lowStockCard);
        const lowStockDialog = screen.getByRole("dialog", { name: "Low Stock" });
        expect(within(lowStockDialog).getByText(
            "Panadol · 500mg Tablets"
        )).toBeInTheDocument();
        expect(within(lowStockDialog).getByText(
            "Current stock: 5 Pack"
        )).toBeInTheDocument();
        expect(within(lowStockDialog).getByText(
            "Threshold: 5 Pack"
        )).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", {
            name: "Close Low Stock details"
        }));

        fireEvent.click(outOfStockCard);
        const outOfStockDialog = screen.getByRole("dialog", {
            name: "Out of Stock"
        });
        expect(within(outOfStockDialog).getByText(
            "Amoxicillin · 250mg Capsules"
        )).toBeInTheDocument();
        expect(within(outOfStockDialog).getByText(
            "Stock status: Out of stock (0)"
        )).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", {
            name: "Close Out of Stock details"
        }));

        fireEvent.click(screen.getByRole("button", {
            name: "Open Expired Products details, 1 affected product/variant"
        }));
        const expiredDialog = screen.getByRole("dialog", {
            name: "Expired Products"
        });
        expect(within(expiredDialog).getByText(
            "Panadol · 500mg Tablets"
        )).toBeInTheDocument();
        expect(within(expiredDialog).getByText(
            "Expired 3 days ago"
        )).toBeInTheDocument();
    });

    it("classifies multiple variants of one product independently", () => {
        const product: productStructure = {
            id: "product-multi-variant",
            name: "Multi Variant Medicine",
            variant: [
                {
                    id: "variant-low",
                    variantName: "Low Variant",
                    lowStockThreshold: {
                        quantity: 5,
                        packagingLevelId: "unit-low"
                    },
                    packagingHierarchy: [{
                        id: "unit-low",
                        name: "Unit",
                        nextLevelId: null,
                        quantityofNextLevel: null,
                        costPrice: null,
                        sellingPrice: null
                    }]
                },
                {
                    id: "variant-in-stock",
                    variantName: "In Stock Variant",
                    lowStockThreshold: {
                        quantity: 5,
                        packagingLevelId: "unit-healthy"
                    },
                    packagingHierarchy: [{
                        id: "unit-healthy",
                        name: "Unit",
                        nextLevelId: null,
                        quantityofNextLevel: null,
                        costPrice: null,
                        sellingPrice: null
                    }]
                }
            ]
        };
        renderDashboard({
            products: [product],
            inventoryRecords: [
                {
                    id: "record-low",
                    productId: product.id,
                    variantId: "variant-low",
                    batchId: null,
                    stockQuantities: [{
                        packagingLevelId: "unit-low",
                        quantity: 5
                    }]
                },
                {
                    id: "record-in-stock",
                    productId: product.id,
                    variantId: "variant-in-stock",
                    batchId: null,
                    stockQuantities: [{
                        packagingLevelId: "unit-healthy",
                        quantity: 6
                    }]
                }
            ]
        });

        const lowStockCard = screen.getByRole("button", {
            name: "Open Low Stock details, 1 affected product/variant"
        });
        expect(lowStockCard).toHaveTextContent("1");
        expect(screen.getByRole("button", {
            name: "Open Out of Stock details, 0 affected products/variants"
        })).toBeInTheDocument();

        fireEvent.click(lowStockCard);
        const dialog = screen.getByRole("dialog", { name: "Low Stock" });
        expect(within(dialog).getByText(
            "Multi Variant Medicine · Low Variant"
        )).toBeInTheDocument();
        expect(within(dialog).queryByText(
            "Multi Variant Medicine · In Stock Variant"
        )).not.toBeInTheDocument();
    });

    it("separates zero-stock and positive low-stock variants of one product", () => {
        const product: productStructure = {
            id: "product-zero-and-low",
            name: "Mixed Stock Medicine",
            variant: [
                {
                    id: "variant-zero",
                    variantName: "Zero Variant",
                    lowStockThreshold: {
                        quantity: 5,
                        packagingLevelId: "unit-zero"
                    },
                    packagingHierarchy: [{
                        id: "unit-zero",
                        name: "Unit",
                        nextLevelId: null,
                        quantityofNextLevel: null,
                        costPrice: null,
                        sellingPrice: null
                    }]
                },
                {
                    id: "variant-positive",
                    variantName: "Positive Variant",
                    lowStockThreshold: {
                        quantity: 5,
                        packagingLevelId: "unit-positive"
                    },
                    packagingHierarchy: [{
                        id: "unit-positive",
                        name: "Unit",
                        nextLevelId: null,
                        quantityofNextLevel: null,
                        costPrice: null,
                        sellingPrice: null
                    }]
                }
            ]
        };
        renderDashboard({
            products: [product],
            inventoryRecords: [
                {
                    id: "record-zero",
                    productId: product.id,
                    variantId: "variant-zero",
                    batchId: null,
                    stockQuantities: [{
                        packagingLevelId: "unit-zero",
                        quantity: 0
                    }]
                },
                {
                    id: "record-positive",
                    productId: product.id,
                    variantId: "variant-positive",
                    batchId: null,
                    stockQuantities: [{
                        packagingLevelId: "unit-positive",
                        quantity: 3
                    }]
                }
            ]
        });

        fireEvent.click(screen.getByRole("button", {
            name: "Open Low Stock details, 1 affected product/variant"
        }));
        const lowStockDialog = screen.getByRole("dialog", { name: "Low Stock" });
        expect(within(lowStockDialog).getByText(
            "Mixed Stock Medicine · Positive Variant"
        )).toBeInTheDocument();
        expect(within(lowStockDialog).queryByText(
            "Mixed Stock Medicine · Zero Variant"
        )).not.toBeInTheDocument();
        fireEvent.click(within(lowStockDialog).getByRole("button", {
            name: "Close Low Stock details"
        }));

        fireEvent.click(screen.getByRole("button", {
            name: "Open Out of Stock details, 1 affected product/variant"
        }));
        const outOfStockDialog = screen.getByRole("dialog", {
            name: "Out of Stock"
        });
        expect(within(outOfStockDialog).getByText(
            "Mixed Stock Medicine · Zero Variant"
        )).toBeInTheDocument();
        expect(within(outOfStockDialog).queryByText(
            "Mixed Stock Medicine · Positive Variant"
        )).not.toBeInTheDocument();
    });

    it("counts multiple batch quantities once after packaging conversion", () => {
        const product: productStructure = {
            id: "product-multi-batch",
            name: "Batch Aggregate Medicine",
            variant: [{
                id: "variant-multi-batch",
                variantName: "Tablets",
                lowStockThreshold: {
                    quantity: 20,
                    packagingLevelId: "unit-batch"
                },
                packagingHierarchy: [
                    {
                        id: "box-batch",
                        name: "Box",
                        nextLevelId: "unit-batch",
                        quantityofNextLevel: 10,
                        costPrice: null,
                        sellingPrice: null
                    },
                    {
                        id: "unit-batch",
                        name: "Unit",
                        nextLevelId: null,
                        quantityofNextLevel: null,
                        costPrice: null,
                        sellingPrice: null
                    }
                ]
            }]
        };
        const inventoryRecords: inventory[] = [
            {
                id: "record-batch-box",
                productId: product.id,
                variantId: "variant-multi-batch",
                batchId: "batch-box",
                stockQuantities: [{
                    packagingLevelId: "box-batch",
                    quantity: 1
                }]
            },
            {
                id: "record-batch-unit",
                productId: product.id,
                variantId: "variant-multi-batch",
                batchId: "batch-unit",
                stockQuantities: [{
                    packagingLevelId: "unit-batch",
                    quantity: 5
                }]
            }
        ];
        renderDashboard({
            products: [product],
            inventoryRecords,
            inventoryBatches: [
                makeBatch(product, "batch-box", dateOffset(120)),
                makeBatch(product, "batch-unit", dateOffset(120))
            ]
        });

        const lowStockCard = screen.getByRole("button", {
            name: "Open Low Stock details, 1 affected product/variant"
        });
        expect(lowStockCard).toHaveTextContent("1");
        fireEvent.click(lowStockCard);
        const dialog = screen.getByRole("dialog", { name: "Low Stock" });
        expect(within(dialog).getAllByRole("listitem")).toHaveLength(1);
        expect(within(dialog).getByText(
            "Batch Aggregate Medicine · Tablets"
        )).toBeInTheDocument();
        expect(within(dialog).getByText(
            "Current stock: 1 Box, 5 Unit"
        )).toBeInTheDocument();
        expect(within(dialog).getByText(
            "Threshold: 20 Unit"
        )).toBeInTheDocument();
    });

    it("includes exact multi-level threshold stock in Low Stock", () => {
        const product: productStructure = {
            id: "product-exact-multilevel",
            name: "Exact Threshold Medicine",
            variant: [{
                id: "variant-exact-multilevel",
                variantName: "Tablets",
                lowStockThreshold: {
                    quantity: 5,
                    packagingLevelId: "box-exact"
                },
                packagingHierarchy: [
                    {
                        id: "case-exact",
                        name: "Case",
                        nextLevelId: "box-exact",
                        quantityofNextLevel: 12,
                        costPrice: null,
                        sellingPrice: null
                    },
                    {
                        id: "box-exact",
                        name: "Box",
                        nextLevelId: "unit-exact",
                        quantityofNextLevel: 10,
                        costPrice: null,
                        sellingPrice: null
                    },
                    {
                        id: "unit-exact",
                        name: "Unit",
                        nextLevelId: null,
                        quantityofNextLevel: null,
                        costPrice: null,
                        sellingPrice: null
                    }
                ]
            }]
        };
        renderDashboard({
            products: [product],
            inventoryRecords: [{
                id: "record-exact",
                productId: product.id,
                variantId: "variant-exact-multilevel",
                batchId: null,
                stockQuantities: [
                    {
                        packagingLevelId: "box-exact",
                        quantity: 4
                    },
                    {
                        packagingLevelId: "unit-exact",
                        quantity: 10
                    }
                ]
            }]
        });

        const lowStockCard = screen.getByRole("button", {
            name: "Open Low Stock details, 1 affected product/variant"
        });
        expect(lowStockCard).toHaveTextContent("1");
        fireEvent.click(lowStockCard);
        const dialog = screen.getByRole("dialog", { name: "Low Stock" });
        expect(within(dialog).getByText(
            "Exact Threshold Medicine · Tablets"
        )).toBeInTheDocument();
        expect(within(dialog).getByText(
            "Threshold: 5 Box"
        )).toBeInTheDocument();
    });

    it("excludes above-threshold stock from Low and Out of Stock", () => {
        const product = makeProduct(
            "product-above-threshold",
            "Above Threshold Medicine",
            "variant-above-threshold",
            "Tablets",
            5
        );
        renderDashboard({
            products: [product],
            inventoryRecords: [makeInventoryRecord(product, 6)]
        });

        expect(screen.getByRole("button", {
            name: "Open Low Stock details, 0 affected products/variants"
        })).toBeInTheDocument();
        expect(screen.getByRole("button", {
            name: "Open Out of Stock details, 0 affected products/variants"
        })).toBeInTheDocument();
    });

    it("converts and aggregates stock across packaging levels before classifying it", () => {
        const product: productStructure = {
            id: "product-multilevel",
            name: "Multilevel Product",
            variant: [{
                id: "variant-multilevel",
                variantName: "Tablets",
                lowStockThreshold: {
                    quantity: 5,
                    packagingLevelId: "box-level"
                },
                packagingHierarchy: [
                    {
                        id: "case-level",
                        name: "Case",
                        nextLevelId: "box-level",
                        quantityofNextLevel: 12,
                        costPrice: null,
                        sellingPrice: null
                    },
                    {
                        id: "box-level",
                        name: "Box",
                        nextLevelId: "unit-level",
                        quantityofNextLevel: 10,
                        costPrice: null,
                        sellingPrice: null
                    },
                    {
                        id: "unit-level",
                        name: "Unit",
                        nextLevelId: null,
                        quantityofNextLevel: null,
                        costPrice: null,
                        sellingPrice: null
                    }
                ]
            }]
        };
        const lowStockControl = makeProduct(
            "product-control",
            "Control Product",
            "variant-control",
            "Capsules",
            5
        );
        const inventoryRecords: inventory[] = [
            {
                id: "record-case",
                productId: product.id,
                variantId: "variant-multilevel",
                batchId: "batch-case",
                stockQuantities: [{
                    packagingLevelId: "case-level",
                    quantity: 1
                }]
            },
            {
                id: "record-box",
                productId: product.id,
                variantId: "variant-multilevel",
                batchId: "batch-box",
                stockQuantities: [{
                    packagingLevelId: "box-level",
                    quantity: 1
                }]
            },
            makeInventoryRecord(lowStockControl, 1)
        ];
        renderDashboard({
            products: [product, lowStockControl],
            inventoryRecords,
            inventoryBatches: [
                makeBatch(product, "batch-case", dateOffset(120)),
                makeBatch(product, "batch-box", dateOffset(120))
            ]
        });

        const stockIdentity = "Multilevel Product · Tablets";
        const lowStockCard = screen.getByRole("button", {
            name: "Open Low Stock details, 1 affected product/variant"
        });
        expect(lowStockCard).toHaveTextContent("1");
        expect(screen.queryByText(stockIdentity)).not.toBeInTheDocument();
        fireEvent.click(lowStockCard);
        const dialog = screen.getByRole("dialog", { name: "Low Stock" });
        expect(within(dialog).getByText(
            "Control Product · Capsules"
        )).toBeInTheDocument();
        expect(within(dialog).getByText("Current stock: 1 Pack"))
            .toBeInTheDocument();
        expect(within(dialog).getByText("Threshold: 5 Pack"))
            .toBeInTheDocument();
        expect(within(dialog).queryByText(stockIdentity))
            .not.toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", {
            name: "Close Low Stock details"
        }));
        expect(screen.getByRole("button", {
            name: "Open Out of Stock details, 0 affected products/variants"
        })).toBeInTheDocument();
    });
});

describe("Dashboard alert controls", () => {
    it("keeps an alert card compact when it contains one entry", () => {
        const product = makeProduct(
            "product-single-alert",
            "Panadol",
            "variant-single-alert",
            "500mg Tablets"
        );
        renderDashboard({
            products: [product],
            inventoryRecords: [makeInventoryRecord(product, 1)]
        });

        const card = screen.getByRole("button", {
            name: "Open Low Stock details, 1 affected product/variant"
        });
        expect(card).toHaveTextContent("Low Stock");
        expect(card).toHaveTextContent("1");
        expect(screen.queryByText("Panadol · 500mg Tablets"))
            .not.toBeInTheDocument();
    });

    it("closes the active alert modal with Escape", () => {
        const product = makeProduct(
            "product-escape",
            "Panadol",
            "variant-escape",
            "Tablets"
        );
        renderDashboard({
            products: [product],
            inventoryRecords: [makeInventoryRecord(product, 1)]
        });

        fireEvent.click(screen.getByRole("button", {
            name: "Open Low Stock details, 1 affected product/variant"
        }));
        expect(screen.getByRole("dialog", { name: "Low Stock" }))
            .toBeInTheDocument();

        fireEvent.keyDown(window, { key: "Escape" });

        expect(screen.queryByRole("dialog", { name: "Low Stock" }))
            .not.toBeInTheDocument();
    });

    it("shows all entries in the modal when a category has more than five products", () => {
        const products = [
            makeProduct("product-1", "Panadol", "variant-1", "Tablets"),
            makeProduct("product-2", "Vitamin C", "variant-2", "Chewables"),
            makeProduct("product-3", "Amoxicillin", "variant-3", "Capsules"),
            makeProduct("product-4", "Ibuprofen", "variant-4", "Tablets"),
            makeProduct("product-5", "Loratadine", "variant-5", "Tablets"),
            makeProduct("product-6", "Omeprazole", "variant-6", "Capsules")
        ];
        renderDashboard({
            products,
            inventoryRecords: products.map((product) =>
                makeInventoryRecord(product, 1)
            )
        });

        const card = screen.getByRole("button", {
            name: "Open Low Stock details, 6 affected products/variants"
        });
        expect(card).toHaveTextContent("6");
        expect(screen.queryByText("Panadol · Tablets"))
            .not.toBeInTheDocument();

        fireEvent.click(card);
        const dialog = screen.getByRole("dialog", { name: "Low Stock" });
        expect(within(dialog).getAllByRole("listitem")).toHaveLength(6);
        for (const product of products) {
            const productVariant = product.variant[0];
            expect(productVariant).toBeDefined();
            expect(within(dialog).getByText(
                `${product.name} · ${productVariant!.variantName}`
            )).toBeInTheDocument();
        }
    });

    it("searches the selected alert modal by product name", () => {
        const panadol = makeProduct(
            "product-panadol-search",
            "Panadol",
            "variant-panadol-search",
            "500mg Tablets"
        );
        const vitaminC = makeProduct(
            "product-vitamin-search",
            "Vitamin C",
            "variant-vitamin-search",
            "Orange Tablets"
        );
        renderDashboard({
            products: [panadol, vitaminC],
            inventoryRecords: [
                makeInventoryRecord(panadol, 1),
                makeInventoryRecord(vitaminC, 1)
            ]
        });

        const card = screen.getByRole("button", {
            name: "Open Low Stock details, 2 affected products/variants"
        });
        fireEvent.click(card);
        const dialog = screen.getByRole("dialog", { name: "Low Stock" });
        fireEvent.change(within(dialog).getByRole("searchbox", {
            name: "Search Low Stock alerts"
        }), { target: { value: "panadol" } });

        expect(card).toHaveTextContent("2");
        expect(within(dialog).getByText(
            "Showing 1 of 2 affected entries matching “panadol”."
        )).toBeInTheDocument();
        expect(within(dialog).getByText(
            "Panadol · 500mg Tablets"
        )).toBeInTheDocument();
        expect(within(dialog).queryByText(
            "Vitamin C · Orange Tablets"
        )).not.toBeInTheDocument();
    });

    it("searches the selected alert modal by variant name", () => {
        const capsules = makeProduct(
            "product-capsules",
            "Medicine A",
            "variant-capsules",
            "250mg Capsules"
        );
        const tablets = makeProduct(
            "product-tablets",
            "Medicine B",
            "variant-tablets",
            "500mg Tablets"
        );
        renderDashboard({
            products: [capsules, tablets],
            inventoryRecords: [
                makeInventoryRecord(capsules, 1),
                makeInventoryRecord(tablets, 1)
            ]
        });

        const card = screen.getByRole("button", {
            name: "Open Low Stock details, 2 affected products/variants"
        });
        fireEvent.click(card);
        const dialog = screen.getByRole("dialog", { name: "Low Stock" });
        fireEvent.change(within(dialog).getByRole("searchbox", {
            name: "Search Low Stock alerts"
        }), { target: { value: "250mg capsules" } });

        expect(card).toHaveTextContent("2");
        expect(within(dialog).getByText(
            "Showing 1 of 2 affected entries matching “250mg capsules”."
        )).toBeInTheDocument();
        expect(within(dialog).getByText(
            "Medicine A · 250mg Capsules"
        )).toBeInTheDocument();
        expect(within(dialog).queryByText(
            "Medicine B · 500mg Tablets"
        )).not.toBeInTheDocument();
    });

    it("clears modal search and restores all entries", () => {
        const panadol = makeProduct(
            "product-panadol-clear",
            "Panadol",
            "variant-panadol-clear",
            "Tablets"
        );
        const vitaminC = makeProduct(
            "product-vitamin-clear",
            "Vitamin C",
            "variant-vitamin-clear",
            "Chewables"
        );
        renderDashboard({
            products: [panadol, vitaminC],
            inventoryRecords: [
                makeInventoryRecord(panadol, 1),
                makeInventoryRecord(vitaminC, 1)
            ]
        });

        const card = screen.getByRole("button", {
            name: "Open Low Stock details, 2 affected products/variants"
        });
        fireEvent.click(card);
        const dialog = screen.getByRole("dialog", { name: "Low Stock" });
        const searchInput = within(dialog).getByRole("searchbox", {
            name: "Search Low Stock alerts"
        });
        fireEvent.change(searchInput, { target: { value: "Panadol" } });
        expect(within(dialog).getAllByRole("listitem")).toHaveLength(1);

        fireEvent.click(within(dialog).getByRole("button", {
            name: "Clear Low Stock search"
        }));
        expect(searchInput).toHaveValue("");
        expect(within(dialog).getAllByRole("listitem")).toHaveLength(2);
    });

    it("provides search in every alert detail modal without Dashboard-level controls", () => {
        const lowStockProduct = makeProduct(
            "product-low-search-modal",
            "Low stock medicine",
            "variant-low-search-modal",
            "Tablets"
        );
        const outOfStockProduct = makeProduct(
            "product-out-search-modal",
            "Out of stock medicine",
            "variant-out-search-modal",
            "Capsules"
        );
        const expiringProduct = makeProduct(
            "product-expiring-search-modal",
            "Vaccine",
            "variant-expiring-search-modal",
            "Vials"
        );
        const expiredProduct = makeProduct(
            "product-expired-search-modal",
            "Expired medicine",
            "variant-expired-search-modal",
            "Liquids"
        );
        const todayProduct = makeProduct(
            "product-today-search-modal",
            "Today medicine",
            "variant-today-search-modal",
            "Pens"
        );
        renderDashboard({
            products: [
                lowStockProduct,
                outOfStockProduct,
                expiringProduct,
                expiredProduct,
                todayProduct
            ],
            inventoryRecords: [
                makeInventoryRecord(lowStockProduct, 1),
                makeInventoryRecord(outOfStockProduct, 0),
                makeInventoryRecord(expiringProduct, 2, "batch-search-soon"),
                makeInventoryRecord(expiredProduct, 2, "batch-search-expired"),
                makeInventoryRecord(todayProduct, 2, "batch-search-today")
            ],
            inventoryBatches: [
                makeBatch(expiringProduct, "batch-search-soon", dateOffset(30)),
                makeBatch(expiredProduct, "batch-search-expired", dateOffset(-1)),
                makeBatch(todayProduct, "batch-search-today", dateOffset(0))
            ]
        });

        expect(screen.queryByRole("button", { name: "Search" }))
            .not.toBeInTheDocument();
        expect(screen.queryByRole("combobox", {
            name: "Filter inventory alerts"
        })).not.toBeInTheDocument();

        for (const [title, expectedCount] of [
            ["Low Stock", 4],
            ["Out of Stock", 1],
            ["Expiring Soon", 1],
            ["Expired Products", 1],
            ["Expired Today", 1]
        ] as const) {
            const card = screen.getByRole("button", {
                name: `Open ${title} details, ${expectedCount} affected ${
                    expectedCount === 1
                        ? "product/variant"
                        : "products/variants"
                }`
            });
            expect(card).toHaveTextContent(String(expectedCount));
            fireEvent.click(card);
            const dialog = screen.getByRole("dialog", { name: title });
            expect(within(dialog).getByRole("searchbox", {
                name: `Search ${title} alerts`
            })).toHaveValue("");
            fireEvent.click(within(dialog).getByRole("button", {
                name: `Close ${title} details`
            }));
        }
    });

    it("shows a no-match state and keeps each modal search independent", () => {
        const panadol = makeProduct(
            "product-independent-search-panadol",
            "Panadol",
            "variant-independent-search-panadol",
            "Tablets"
        );
        const vitaminC = makeProduct(
            "product-independent-search-vitamin",
            "Vitamin C",
            "variant-independent-search-vitamin",
            "Chewables"
        );
        const outOfStockProduct = makeProduct(
            "product-independent-search-out",
            "Amoxicillin",
            "variant-independent-search-out",
            "Capsules"
        );
        renderDashboard({
            products: [panadol, vitaminC, outOfStockProduct],
            inventoryRecords: [
                makeInventoryRecord(panadol, 1),
                makeInventoryRecord(vitaminC, 1),
                makeInventoryRecord(outOfStockProduct, 0)
            ]
        });

        const lowStockCard = screen.getByRole("button", {
            name: "Open Low Stock details, 2 affected products/variants"
        });
        fireEvent.click(lowStockCard);
        const lowStockDialog = screen.getByRole("dialog", { name: "Low Stock" });
        const lowStockSearch = within(lowStockDialog).getByRole("searchbox", {
            name: "Search Low Stock alerts"
        });
        fireEvent.change(lowStockSearch, { target: { value: "no match" } });
        expect(within(lowStockDialog).getByRole("status")).toHaveTextContent(
            "No products or variants match “no match” in Low Stock."
        );
        expect(lowStockCard).toHaveTextContent("2");
        expect(screen.getByRole("button", {
            name: "Open Out of Stock details, 1 affected product/variant"
        })).toBeInTheDocument();
        fireEvent.click(within(lowStockDialog).getByRole("button", {
            name: "Close Low Stock details"
        }));

        fireEvent.click(screen.getByRole("button", {
            name: "Open Out of Stock details, 1 affected product/variant"
        }));
        const outOfStockDialog = screen.getByRole("dialog", {
            name: "Out of Stock"
        });
        const outOfStockSearch = within(outOfStockDialog).getByRole(
            "searchbox",
            { name: "Search Out of Stock alerts" }
        );
        expect(outOfStockSearch).toHaveValue("");
        expect(within(outOfStockDialog).getByText(
            "Amoxicillin · Capsules"
        )).toBeInTheDocument();
        fireEvent.click(within(outOfStockDialog).getByRole("button", {
            name: "Close Out of Stock details"
        }));

        fireEvent.click(lowStockCard);
        const reopenedLowStockDialog = screen.getByRole("dialog", {
            name: "Low Stock"
        });
        expect(within(reopenedLowStockDialog).getByRole("searchbox", {
            name: "Search Low Stock alerts"
        })).toHaveValue("no match");
        expect(within(reopenedLowStockDialog).getByRole("status"))
            .toHaveTextContent("No products or variants match “no match”");
    });
});
