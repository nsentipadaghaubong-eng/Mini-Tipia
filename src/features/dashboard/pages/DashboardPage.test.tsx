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
        const internalSaleId = "sale-uuid-4a2b9c15";
        const draft = makeSaleDraft(internalSaleId, "draft", [
            makeSaleItem("panadol", "tablets", 5)
        ]);
        const onNavigate = renderDashboard({ saleDrafts: [draft] });

        expect(screen.getByRole("heading", { name: "Pending Activities" }))
            .toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "Pending Sale" }))
            .toBeInTheDocument();
        expect(screen.queryByText(internalSaleId)).not.toBeInTheDocument();
        expect(screen.getByText("1 product")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Open Sales" }));
        expect(onNavigate).toHaveBeenCalledWith("sales");
    });

    it("shows active delivery drafts, their invoice number, and opens Receive Delivery", () => {
        const draft = makeDeliveryDraft(
            "delivery-draft-1",
            "draft",
            [makeDeliveryItem("vitamin-c", "tablets", 10)],
            "INV-204"
        );
        const onNavigate = renderDashboard({ deliveryDrafts: [draft] });

        expect(screen.getByRole("heading", { name: "Pending Delivery" }))
            .toBeInTheDocument();
        expect(screen.getByText("Invoice: INV-204")).toBeInTheDocument();
        expect(screen.getByText("1 product")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", {
            name: "Open Receive Delivery"
        }));
        expect(onNavigate).toHaveBeenCalledWith("delivery");
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

    it("searches alert entries by product name", () => {
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

        fireEvent.click(screen.getByRole("button", { name: "Search" }));
        fireEvent.change(screen.getByRole("searchbox", {
            name: "Search inventory alerts"
        }), { target: { value: "panadol" } });

        const card = screen.getByRole("button", {
            name: "Open Low Stock details, 2 affected products/variants"
        });
        expect(card).toHaveTextContent("2");
        expect(screen.queryByText("Panadol · 500mg Tablets"))
            .not.toBeInTheDocument();

        fireEvent.click(card);
        const dialog = screen.getByRole("dialog", { name: "Low Stock" });
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

    it("searches alert entries by variant name", () => {
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

        fireEvent.click(screen.getByRole("button", { name: "Search" }));
        fireEvent.change(screen.getByRole("searchbox", {
            name: "Search inventory alerts"
        }), { target: { value: "250mg capsules" } });

        const card = screen.getByRole("button", {
            name: "Open Low Stock details, 2 affected products/variants"
        });
        fireEvent.click(card);
        const dialog = screen.getByRole("dialog", { name: "Low Stock" });
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

    it("clears and closes the alert search", () => {
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

        fireEvent.click(screen.getByRole("button", { name: "Search" }));
        const searchInput = screen.getByRole("searchbox", {
            name: "Search inventory alerts"
        });
        fireEvent.change(searchInput, { target: { value: "Panadol" } });
        fireEvent.click(screen.getByRole("button", {
            name: "Open Low Stock details, 2 affected products/variants"
        }));
        expect(screen.getByRole("dialog", { name: "Low Stock" }))
            .toHaveTextContent("Showing 1 of 2 affected entries");
        fireEvent.click(screen.getByRole("button", {
            name: "Close Low Stock details"
        }));

        fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
        fireEvent.click(screen.getByRole("button", {
            name: "Open Low Stock details, 2 affected products/variants"
        }));
        expect(within(screen.getByRole("dialog", { name: "Low Stock" }))
            .getAllByRole("listitem")).toHaveLength(2);
        fireEvent.click(screen.getByRole("button", {
            name: "Close Low Stock details"
        }));

        fireEvent.click(screen.getByRole("button", { name: "Close search" }));
        expect(screen.queryByRole("searchbox", {
            name: "Search inventory alerts"
        })).not.toBeInTheDocument();
        expect(screen.getByRole("button", {
            name: "Open Low Stock details, 2 affected products/variants"
        })).toBeInTheDocument();
    });

    it("filters inventory alert cards by category", () => {
        const expiringProduct = makeProduct(
            "product-expiring-filter",
            "Vaccine",
            "variant-expiring-filter",
            "Vials"
        );
        const lowStockProduct = makeProduct(
            "product-low-filter",
            "Panadol",
            "variant-low-filter",
            "Tablets"
        );
        renderDashboard({
            products: [expiringProduct, lowStockProduct],
            inventoryRecords: [
                makeInventoryRecord(expiringProduct, 2, "batch-filter"),
                makeInventoryRecord(lowStockProduct, 1)
            ],
            inventoryBatches: [
                makeBatch(expiringProduct, "batch-filter", dateOffset(30))
            ]
        });

        fireEvent.change(screen.getByRole("combobox", {
            name: "Filter inventory alerts"
        }), { target: { value: "expiring-soon" } });

        const expiringCard = screen.getByRole("button", {
            name: "Open Expiring Soon details, 1 affected product/variant"
        });
        expect(expiringCard).toBeInTheDocument();
        expect(screen.queryByRole("button", {
            name: /Open Low Stock details/
        }))
            .not.toBeInTheDocument();
        fireEvent.click(expiringCard);
        const dialog = screen.getByRole("dialog", { name: "Expiring Soon" });
        expect(within(dialog).getByText("Vaccine · Vials"))
            .toBeInTheDocument();
        expect(within(dialog).getByText("30 days remaining"))
            .toBeInTheDocument();
    });

    it("shows a clear empty-result message for unmatched searches and filters", () => {
        const product = makeProduct(
            "product-empty-search",
            "Panadol",
            "variant-empty-search",
            "Tablets"
        );
        renderDashboard({
            products: [product],
            inventoryRecords: [makeInventoryRecord(product, 1)]
        });

        fireEvent.click(screen.getByRole("button", { name: "Search" }));
        fireEvent.change(screen.getByRole("searchbox", {
            name: "Search inventory alerts"
        }), { target: { value: "no matching product" } });
        expect(screen.getByRole("status")).toHaveTextContent(
            "No alert entries match “no matching product”."
        );

        fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
        fireEvent.change(screen.getByRole("combobox", {
            name: "Filter inventory alerts"
        }), { target: { value: "expired-today" } });
        expect(screen.getByRole("status")).toHaveTextContent(
            "No Expired Today alerts are currently recorded."
        );
        expect(screen.queryByRole("button", {
            name: /Open Expired Today details/
        }))
            .not.toBeInTheDocument();
    });
});
