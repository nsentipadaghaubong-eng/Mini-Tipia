import {
    CalendarClock,
    CalendarX,
    ChevronRight,
    ClockAlert,
    PackageX,
    Search,
    TriangleAlert,
    X
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { inventory, stockQuantity } from "../../../inventory/inventoryStock";
import type { inventoryBatch } from "../../../inventory/inventoryBatch";
import type { packagingLevel } from "../../../packaging/packagingHierarchy";
import {
    aggregateVariantStock
} from "../../../inventory/inventoryAggregation";
import { getAllInventoryDisplay } from "../../../inventory/inventoryLookup";
import { getVariantLowStockStatus } from "../../../inventory/lowStock";
import { getExpiryDisplay, type ExpiryDisplay } from "../../../expiry/expiryDisplay";
import type { productStructure } from "../../../products/productStructure";
import type { SaleDraft } from "../../../sales/salesDraft";
import type { DeliveryDraft } from "../../../deliveries/deliveryDraft";
import "./DashboardPage.css";
import "../../../expiry/expiryDisplay.css";

type DashboardWorkflowPage = "sales" | "delivery";
type DashboardAlertFilter =
    | "all"
    | "expiring-soon"
    | "expired-products"
    | "expired-today"
    | "low-stock"
    | "out-of-stock";
type DashboardAlertCategory = Exclude<DashboardAlertFilter, "all">;

const dashboardAlertIcons = {
    "low-stock": TriangleAlert,
    "out-of-stock": PackageX,
    "expiring-soon": CalendarClock,
    "expired-products": CalendarX,
    "expired-today": ClockAlert
} satisfies Record<DashboardAlertCategory, typeof TriangleAlert>;

function isDashboardAlertFilter(value: string): value is DashboardAlertFilter {
    return value === "all" ||
        value === "expiring-soon" ||
        value === "expired-products" ||
        value === "expired-today" ||
        value === "low-stock" ||
        value === "out-of-stock";
}

interface DashboardPageProps {
    products: readonly productStructure[];
    inventoryRecords: readonly inventory[];
    inventoryBatches: readonly inventoryBatch[];
    saleDrafts: readonly SaleDraft[];
    deliveryDrafts: readonly DeliveryDraft[];
    onNavigate: (page: DashboardWorkflowPage) => void;
}

interface ExpiryAlert {
    inventoryId: string;
    productId: string;
    variantId: string;
    productName: string;
    variantName: string;
    batchNumber: string | null;
    display: ExpiryDisplay;
}

interface StockAlert {
    productId: string;
    variantId: string;
    productName: string;
    variantName: string;
    stockQuantities: stockQuantity[];
    packagingLevels: packagingLevel[];
    thresholdQuantity?: number;
    thresholdPackagingLevelId?: string;
    hasStock: boolean;
}

function countSelectedProductEntries(
    items: readonly { productId: string; variantId: string }[]
): number {
    return items.filter(
        (item) => item.productId.trim() !== "" && item.variantId.trim() !== ""
    ).length;
}

function countAffectedProductVariants(
    items: readonly { productId: string; variantId: string }[]
): number {
    return new Set(items.map((item) =>
        JSON.stringify([item.productId, item.variantId])
    )).size;
}

function filterAlertItems<T extends {
    productName: string;
    variantName: string;
}>(
    items: readonly T[],
    searchTerm: string
): T[] {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    if (normalizedSearch === "") {
        return [...items];
    }

    return items.filter((item) =>
        `${item.productName} ${item.variantName}`
            .toLowerCase()
            .includes(normalizedSearch)
    );
}

function DashboardAlertCard({
    category,
    title,
    count,
    onClick
}: {
    category: DashboardAlertCategory;
    title: string;
    count: number;
    onClick: () => void;
}) {
    const CategoryIcon = dashboardAlertIcons[category];

    return (
        <button
            aria-haspopup="dialog"
            aria-label={`Open ${title} details, ${count} ${
                count === 1
                    ? "affected product/variant"
                    : "affected products/variants"
            }`}
            className={`dashboard-alert-card dashboard-alert-card--${category}`}
            onClick={onClick}
            type="button"
        >
            <span aria-hidden="true" className="dashboard-alert-card-icon">
                <CategoryIcon size={20} strokeWidth={1.9} />
            </span>
            <span className="dashboard-alert-card-title">{title}</span>
            <span className="dashboard-alert-card-count">{count}</span>
            <ChevronRight aria-hidden="true" className="dashboard-alert-card-cue" />
        </button>
    );
}

function ExpiryAlertList({ items }: { items: readonly ExpiryAlert[] }) {
    return (
        <ul className="dashboard-alert-list">
            {items.map((item) => (
                <li className="dashboard-alert-item" key={item.inventoryId}>
                    <div className="dashboard-alert-identity">
                        <strong>
                            {item.productName} · {item.variantName}
                        </strong>
                        {item.batchNumber && (
                            <span>Batch {item.batchNumber}</span>
                        )}
                    </div>
                    <span
                        className={`expiry-display expiry-display--${item.display.colorCategory}`}
                    >
                        {item.display.dateLabel}
                        <span>{item.display.remainingLabel}</span>
                    </span>
                </li>
            ))}
        </ul>
    );
}

function StockAlertList({
    items,
    category
}: {
    items: readonly StockAlert[];
    category: "low-stock" | "out-of-stock";
}) {
    return (
        <ul className="dashboard-alert-list">
            {items.map((item) => (
                <li
                    className="dashboard-alert-item dashboard-stock-alert-item"
                    key={`${item.productId}:${item.variantId}`}
                >
                    <div className="dashboard-alert-identity">
                        <strong>
                            {item.productName} · {item.variantName}
                        </strong>
                        {category === "low-stock" ? (
                            <>
                                <span>
                                    Current stock: {item.stockQuantities.map((stock) => {
                                        const level = item.packagingLevels.find(
                                            (candidate) =>
                                                candidate.id === stock.packagingLevelId
                                        );
                                        return `${stock.quantity} ${level?.name ?? "units"}`;
                                    }).join(", ") || "0"}
                                </span>
                                {item.thresholdQuantity !== undefined && (
                                    <span>
                                        Threshold: {item.thresholdQuantity}{" "}
                                        {item.packagingLevels.find(
                                            (level) =>
                                                level.id ===
                                                item.thresholdPackagingLevelId
                                        )?.name ?? "units"}
                                    </span>
                                )}
                            </>
                        ) : (
                            <span>
                                Stock status: {item.hasStock ? "In stock" : "Out of stock (0)"}
                            </span>
                        )}
                    </div>
                </li>
            ))}
        </ul>
    );
}

export default function DashboardPage({
    products,
    inventoryRecords,
    inventoryBatches,
    saleDrafts,
    deliveryDrafts,
    onNavigate
}: DashboardPageProps) {
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [alertFilter, setAlertFilter] =
        useState<DashboardAlertFilter>("all");
    const [selectedAlertCategory, setSelectedAlertCategory] =
        useState<DashboardAlertCategory | null>(null);
    const modalCloseButtonRef = useRef<HTMLButtonElement>(null);
    const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        if (selectedAlertCategory === null) {
            return;
        }

        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") {
                setSelectedAlertCategory(null);
            }
        }

        window.addEventListener("keydown", handleKeyDown);
        modalCloseButtonRef.current?.focus();
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            previouslyFocusedElementRef.current?.focus();
        };
    }, [selectedAlertCategory]);

    function openAlertModal(category: DashboardAlertCategory) {
        if (document.activeElement instanceof HTMLElement) {
            previouslyFocusedElementRef.current = document.activeElement;
        }
        setSelectedAlertCategory(category);
    }

    const pendingSales = saleDrafts.filter((draft) => draft.status === "draft");
    const pendingDeliveries = deliveryDrafts.filter(
        (draft) => draft.status === "draft"
    );
    const inventoryDisplay = getAllInventoryDisplay(
        [...inventoryRecords],
        [...products],
        [...inventoryBatches]
    );
    const expiryAlerts = inventoryDisplay.flatMap((record) => {
        if (
            !record.expiryDate ||
            !record.stockQuantities.some((stock) => stock.quantity > 0)
        ) {
            return [];
        }

        return [{
            inventoryId: record.inventoryId,
            productId: record.productId,
            variantId: record.variantId,
            productName: record.productName,
            variantName: record.variantName,
            batchNumber: record.batchNumber,
            display: getExpiryDisplay(record.expiryDate)
        }];
    });
    const expiringSoon = expiryAlerts.filter(
        (alert) => alert.display.classification === "near-expiry"
    );
    const expiredProducts = expiryAlerts.filter(
        (alert) => alert.display.classification === "expired"
    );
    const expiredToday = expiryAlerts.filter(
        (alert) => alert.display.classification === "expires-today"
    );

    const lowStock: StockAlert[] = [];
    const outOfStock: StockAlert[] = [];
    for (const product of products) {
        for (const productVariant of product.variant) {
            const variantRecords = inventoryDisplay.filter(
                (record) =>
                    record.productId === product.id &&
                    record.variantId === productVariant.id
            );
            const aggregatedStock = aggregateVariantStock(variantRecords);
            const status = getVariantLowStockStatus(
                productVariant,
                aggregatedStock
            );
            const alert = {
                productId: product.id,
                variantId: productVariant.id,
                productName: product.name,
                variantName: productVariant.variantName,
                stockQuantities: aggregatedStock?.stockQuantities ?? [],
                packagingLevels:
                    aggregatedStock?.packagingLevels ??
                    productVariant.packagingHierarchy,
                thresholdQuantity: status.thresholdQuantity,
                thresholdPackagingLevelId: status.thresholdPackagingLevelId,
                hasStock: status.hasStock
            };

            if (!status.hasStock) {
                outOfStock.push(alert);
            } else if (status.thresholdConfigured && status.isLowStock) {
                lowStock.push(alert);
            }
        }
    }

    const filteredExpiringSoon = filterAlertItems(expiringSoon, searchTerm);
    const filteredExpiredProducts = filterAlertItems(expiredProducts, searchTerm);
    const filteredExpiredToday = filterAlertItems(expiredToday, searchTerm);
    const filteredLowStock = filterAlertItems(lowStock, searchTerm);
    const filteredOutOfStock = filterAlertItems(outOfStock, searchTerm);
    const alertCards = [
        {
            category: "expiring-soon",
            title: "Expiring Soon",
            items: expiringSoon,
            matchingItems: filteredExpiringSoon
        },
        {
            category: "expired-products",
            title: "Expired Products",
            items: expiredProducts,
            matchingItems: filteredExpiredProducts
        },
        {
            category: "expired-today",
            title: "Expired Today",
            items: expiredToday,
            matchingItems: filteredExpiredToday
        },
        {
            category: "low-stock",
            title: "Low Stock",
            items: lowStock,
            matchingItems: filteredLowStock
        },
        {
            category: "out-of-stock",
            title: "Out of Stock",
            items: outOfStock,
            matchingItems: filteredOutOfStock
        }
    ] as const;
    const visibleAlertCards = alertCards.filter((card) =>
        (alertFilter === "all" || card.category === alertFilter) &&
        (card.category !== "expired-today" || expiredToday.length > 0) &&
        (searchTerm.trim() === "" || card.matchingItems.length > 0)
    );
    const selectedAlert = alertCards.find(
        (card) => card.category === selectedAlertCategory
    );
    const noMatchingAlerts =
        (searchTerm.trim() !== "" && visibleAlertCards.length === 0) ||
        (alertFilter === "expired-today" && expiredToday.length === 0);

    return (
        <div className="dashboard-page">
            <header className="dashboard-page-header">
                <p className="dashboard-eyebrow">Pharmacy overview</p>
                <h2>Dashboard</h2>
                <p>Pending workflows and inventory that needs attention.</p>
            </header>

            <section
                aria-labelledby="dashboard-pending-title"
                className="dashboard-section"
            >
                <div className="dashboard-section-heading">
                    <h2 id="dashboard-pending-title">Pending Activities</h2>
                </div>
                {pendingSales.length === 0 && pendingDeliveries.length === 0 ? (
                    <p className="dashboard-empty">
                        There are no pending Sales or Receive Delivery drafts.
                    </p>
                ) : (
                    <div className="dashboard-pending-grid">
                        {pendingSales.map((draft) => {
                            const productCount =
                                countSelectedProductEntries(draft.items);
                            return (
                                <article
                                    className="dashboard-pending-entry"
                                    key={`sale:${draft.draftId}`}
                                >
                                    <div>
                                        <h3>Pending Sale</h3>
                                        <p>
                                            {productCount}{" "}
                                            {productCount === 1 ? "product" : "products"}
                                        </p>
                                    </div>
                                    <button
                                        className="dashboard-action"
                                        onClick={() => onNavigate("sales")}
                                        type="button"
                                    >
                                        Open Sales
                                    </button>
                                </article>
                            );
                        })}
                        {pendingDeliveries.map((draft) => {
                            const productCount =
                                countSelectedProductEntries(draft.items);
                            return (
                                <article
                                    className="dashboard-pending-entry"
                                    key={`delivery:${draft.deliveryId}`}
                                >
                                    <div>
                                        <h3>Pending Delivery</h3>
                                        {draft.invoiceNumber?.trim() && (
                                            <p>Invoice: {draft.invoiceNumber}</p>
                                        )}
                                        <p>
                                            {productCount}{" "}
                                            {productCount === 1 ? "product" : "products"}
                                        </p>
                                    </div>
                                    <button
                                        className="dashboard-action"
                                        onClick={() => onNavigate("delivery")}
                                        type="button"
                                    >
                                        Open Receive Delivery
                                    </button>
                                </article>
                            );
                        })}
                    </div>
                )}
            </section>

            <section
                aria-labelledby="dashboard-inventory-title"
                className="dashboard-section"
            >
                <div className="dashboard-section-heading">
                    <h2 id="dashboard-inventory-title">Inventory Alerts</h2>
                </div>
                <div className="dashboard-alert-controls">
                    <button
                        aria-controls={searchOpen
                            ? "dashboard-alert-search"
                            : undefined}
                        aria-expanded={searchOpen}
                        className="dashboard-search-toggle"
                        onClick={() => {
                            if (searchOpen) {
                                setSearchOpen(false);
                                setSearchTerm("");
                            } else {
                                setSearchOpen(true);
                            }
                        }}
                        type="button"
                    >
                        {searchOpen ? (
                            <X aria-hidden="true" size={16} />
                        ) : (
                            <Search aria-hidden="true" size={16} />
                        )}
                        <span>{searchOpen ? "Close search" : "Search"}</span>
                    </button>
                    {searchOpen && (
                        <label className="dashboard-search-field">
                            <span className="dashboard-visually-hidden">
                                Search inventory alerts
                            </span>
                            <Search aria-hidden="true" size={16} />
                            <input
                                aria-label="Search inventory alerts"
                                id="dashboard-alert-search"
                                onChange={(event) =>
                                    setSearchTerm(event.target.value)
                                }
                                placeholder="Product or variant name"
                                type="search"
                                value={searchTerm}
                            />
                            {searchTerm !== "" && (
                                <button
                                    aria-label="Clear search"
                                    className="dashboard-search-clear"
                                    onClick={() => setSearchTerm("")}
                                    type="button"
                                >
                                    <X aria-hidden="true" size={15} />
                                </button>
                            )}
                        </label>
                    )}
                    <label className="dashboard-filter-field">
                        <span>Filter alerts</span>
                        <select
                            aria-label="Filter inventory alerts"
                            onChange={(event) => {
                                if (isDashboardAlertFilter(event.target.value)) {
                                    setAlertFilter(event.target.value);
                                }
                            }}
                            value={alertFilter}
                        >
                            <option value="all">All categories</option>
                            <option value="expiring-soon">Expiring Soon</option>
                            <option value="expired-products">Expired Products</option>
                            <option value="expired-today">Expired Today</option>
                            <option value="low-stock">Low Stock</option>
                            <option value="out-of-stock">Out of Stock</option>
                        </select>
                    </label>
                </div>
                <p className="dashboard-alert-filter-note">
                    Search narrows matching categories and modal entries; card totals
                    always show all affected products/variants.
                </p>
                {noMatchingAlerts ? (
                    <p
                        aria-live="polite"
                        className="dashboard-alert-no-results"
                        role="status"
                    >
                        {searchTerm.trim() !== ""
                            ? `No alert entries match “${searchTerm.trim()}”.`
                            : "No Expired Today alerts are currently recorded."}
                    </p>
                ) : (
                    <div className="dashboard-alert-grid">
                        {visibleAlertCards.map((card) => (
                            <DashboardAlertCard
                                category={card.category}
                                count={countAffectedProductVariants(card.items)}
                                key={card.category}
                                onClick={() => openAlertModal(card.category)}
                                title={card.title}
                            />
                        ))}
                    </div>
                )}
            </section>
            {selectedAlert && (
                <div
                    className="dashboard-alert-modal-overlay"
                    onClick={(event) => {
                        if (event.target === event.currentTarget) {
                            setSelectedAlertCategory(null);
                        }
                    }}
                >
                    <section
                        aria-labelledby="dashboard-alert-modal-title"
                        aria-modal="true"
                        className="dashboard-alert-modal"
                        role="dialog"
                    >
                        <header className="dashboard-alert-modal-header">
                            <div>
                                <p className="dashboard-eyebrow">Inventory alert</p>
                                <h2 id="dashboard-alert-modal-title">
                                    {selectedAlert.title}
                                </h2>
                                <p className="dashboard-alert-modal-count">
                                    {searchTerm.trim() !== ""
                                        ? `Showing ${selectedAlert.matchingItems.length} of ${selectedAlert.items.length} affected entries matching “${searchTerm.trim()}”.`
                                        : `${selectedAlert.items.length} affected entries`}
                                </p>
                            </div>
                            <button
                                aria-label={`Close ${selectedAlert.title} details`}
                                className="dashboard-alert-modal-close"
                                onClick={() => setSelectedAlertCategory(null)}
                                ref={modalCloseButtonRef}
                                type="button"
                            >
                                <X aria-hidden="true" size={19} />
                            </button>
                        </header>
                        <div className="dashboard-alert-modal-body">
                            {selectedAlert.matchingItems.length === 0 ? (
                                <p
                                    className="dashboard-alert-modal-empty"
                                    role="status"
                                >
                                    There are no affected entries in this category.
                                </p>
                            ) : selectedAlert.category === "low-stock" ? (
                                <StockAlertList
                                    category="low-stock"
                                    items={selectedAlert.matchingItems}
                                />
                            ) : selectedAlert.category === "out-of-stock" ? (
                                <StockAlertList
                                    category="out-of-stock"
                                    items={selectedAlert.matchingItems}
                                />
                            ) : (
                                <ExpiryAlertList
                                    items={selectedAlert.matchingItems}
                                />
                            )}
                        </div>
                    </section>
                </div>
            )}
        </div>
    );
}
