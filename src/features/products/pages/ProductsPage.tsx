import { useEffect, useState } from "react";
import type { inventory } from "../../../inventory/inventoryStock";
import type { packagingLevel } from "../../../packaging/packagingHierarchy";
import type { productStructure, variant } from "../../../products/productStructure";
import { productList } from "../../../products/productList";
import "./ProductsPage.css";

interface ProductsPageProps {
    inventoryRecords: inventory[];
}

function orderPackagingHierarchy(levels: packagingLevel[]): packagingLevel[] {
    const levelsById = new Map(levels.map((level) => [level.id, level]));
    const referencedIds = new Set(
        levels.flatMap((level) => level.nextLevelId ? [level.nextLevelId] : [])
    );
    const root = levels.find((level) => !referencedIds.has(level.id)) ?? levels[0];
    const orderedLevels: packagingLevel[] = [];
    const visitedIds = new Set<string>();
    let currentLevel: packagingLevel | undefined = root;

    while (currentLevel && !visitedIds.has(currentLevel.id)) {
        orderedLevels.push(currentLevel);
        visitedIds.add(currentLevel.id);
        currentLevel = currentLevel.nextLevelId
            ? levelsById.get(currentLevel.nextLevelId)
            : undefined;
    }

    for (const level of levels) {
        if (!visitedIds.has(level.id)) {
            orderedLevels.push(level);
        }
    }

    return orderedLevels;
}

function formatPrice(price: number | null): string {
    if (price === null) {
        return "Not set";
    }

    return new Intl.NumberFormat("en-NG", {
        style: "currency",
        currency: "NGN",
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    }).format(price);
}

function formatExpiryDate(date: Date): string {
    return new Intl.DateTimeFormat("en-NG", {
        day: "numeric",
        month: "short",
        year: "numeric"
    }).format(date);
}

function pluralizePackagingName(name: string): string {
    if (/(s|x|ch|sh)$/i.test(name)) {
        return `${name}es`;
    }

    return `${name}s`;
}

function VariantDetails({
    productVariant,
    productId,
    inventoryRecords
}: {
    productVariant: variant;
    productId: string;
    inventoryRecords: inventory[];
}) {
    const orderedLevels = orderPackagingHierarchy(
        productVariant.packagingHierarchy
    );
    const levelsById = new Map(
        productVariant.packagingHierarchy.map((level) => [level.id, level])
    );
    const stockByBatchAndPackagingLevelId = new Map<
        string,
        Map<string, number>
    >();

    for (const record of inventoryRecords) {
        if (
            record.productId !== productId ||
            record.variantId !== productVariant.id
        ) {
            continue;
        }

        const stockByPackagingLevelId = stockByBatchAndPackagingLevelId.get(
            record.batchId
        ) ?? new Map<string, number>();

        for (const stock of record.stockQuantities) {
            stockByPackagingLevelId.set(
                stock.packagingLevelId,
                (stockByPackagingLevelId.get(stock.packagingLevelId) ?? 0) +
                    stock.quantity
            );
        }

        stockByBatchAndPackagingLevelId.set(
            record.batchId,
            stockByPackagingLevelId
        );
    }

    return (
        <section className="products-variant">
            <h3 className="modal-section-title">{productVariant.variantName}</h3>

            {productVariant.batches.length > 0 && (
                <div className="products-batches">
                    <h4>Batches</h4>
                    <ul>
                        {productVariant.batches.map((batch) => (
                            <li key={batch.batchId}>
                                <span>
                                    {batch.batchNumber ?? "Batch number not set"}
                                </span>
                                <span>Expires {formatExpiryDate(batch.expiryDate)}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <h4 className="products-subsection-title">
                Packaging and stock
            </h4>
            {orderedLevels.length === 0 ? (
                <p className="products-no-packaging">
                    No packaging levels defined.
                </p>
            ) : (
                <ol className="products-packaging-list">
                    {orderedLevels.map((level) => {
                        const nextLevel = level.nextLevelId
                            ? levelsById.get(level.nextLevelId)
                            : undefined;
                        return (
                            <li className="products-packaging-level" key={level.id}>
                                <div className="products-packaging-heading">
                                    <strong>{level.name}</strong>
                                    {nextLevel && level.quantityofNextLevel !== null && (
                                        <span className="products-conversion">
                                            1 {level.name} = {level.quantityofNextLevel}{" "}
                                            {nextLevel.name}
                                        </span>
                                    )}
                                </div>
                                <dl className="products-prices">
                                    <div>
                                        <dt>Cost price</dt>
                                        <dd>{formatPrice(level.costPrice)}</dd>
                                    </div>
                                    <div>
                                        <dt>Selling price</dt>
                                        <dd>{formatPrice(level.sellingPrice)}</dd>
                                    </div>
                                    <div>
                                        <dt>Current stock</dt>
                                        <dd>
                                            <ul className="products-stock-by-batch">
                                                {productVariant.batches.map((batch) => {
                                                    const quantity =
                                                        stockByBatchAndPackagingLevelId
                                                            .get(batch.batchId)
                                                            ?.get(level.id) ?? 0;

                                                    return (
                                                        <li key={batch.batchId}>
                                                            <span>
                                                                {batch.batchNumber ??
                                                                    "Batch number not set"}
                                                            </span>
                                                            <strong>
                                                                {quantity}{" "}
                                                                {quantity === 1
                                                                    ? level.name
                                                                    : pluralizePackagingName(
                                                                        level.name
                                                                    )}
                                                            </strong>
                                                        </li>
                                                    );
                                                })}
                                            </ul>
                                        </dd>
                                    </div>
                                </dl>
                            </li>
                        );
                    })}
                </ol>
            )}
        </section>
    );
}

export default function ProductsPage({
    inventoryRecords
}: ProductsPageProps) {
    const [selectedProductId, setSelectedProductId] = useState<string | null>(
        null
    );
    const selectedProduct = productList.find(
        (product) => product.id === selectedProductId
    );

    useEffect(() => {
        if (!selectedProduct) {
            return;
        }

        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") {
                setSelectedProductId(null);
            }
        }

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [selectedProduct]);

    return (
        <div className="products-page">
            <header className="page-heading">
                <div>
                    <h2>Products</h2>
                    <p>View product, variant, packaging, and stock details.</p>
                </div>
            </header>

            <div className="product-card-grid">
                {productList.map((product: productStructure) => (
                    <article className="product-card" key={product.id}>
                        <div className="product-card-heading">
                            <div>
                                <h3>{product.name}</h3>
                                <p>
                                    {product.variant.length}{" "}
                                    {product.variant.length === 1
                                        ? "variant"
                                        : "variants"}
                                </p>
                            </div>
                        </div>

                        <div className="product-card-actions">
                            <button
                                className="secondary-button"
                                onClick={() => setSelectedProductId(product.id)}
                                type="button"
                            >
                                View
                            </button>
                            <button
                                aria-label={`Edit ${product.name} (not available yet)`}
                                className="secondary-button products-unavailable-action"
                                disabled
                                title="Product editing is not available yet."
                                type="button"
                            >
                                Edit
                            </button>
                            <button
                                aria-label={`Delete ${product.name} (not available yet)`}
                                className="product-delete-button products-unavailable-action"
                                disabled
                                title="Product deletion is not available yet."
                                type="button"
                            >
                                Delete
                            </button>
                        </div>
                    </article>
                ))}
            </div>

            {selectedProduct && (
                <div
                    className="inventory-modal-overlay"
                    onClick={(event) => {
                        if (event.target === event.currentTarget) {
                            setSelectedProductId(null);
                        }
                    }}
                >
                    <section
                        aria-labelledby="products-modal-title"
                        aria-modal="true"
                        className="inventory-modal products-modal"
                        role="dialog"
                    >
                        <div className="inventory-modal-header">
                            <div>
                                <h2 id="products-modal-title">
                                    {selectedProduct.name}
                                </h2>
                                <p>Product information and current stock</p>
                            </div>
                            <button
                                aria-label="Close product details"
                                className="modal-close-button"
                                onClick={() => setSelectedProductId(null)}
                                type="button"
                            >
                                &times;
                            </button>
                        </div>

                        <div className="inventory-modal-content">
                            <section className="products-information">
                                <h3 className="modal-section-title">
                                    Product information
                                </h3>
                                <dl>
                                    <div>
                                        <dt>Product name</dt>
                                        <dd>{selectedProduct.name}</dd>
                                    </div>
                                    <div>
                                        <dt>Product ID</dt>
                                        <dd>{selectedProduct.id}</dd>
                                    </div>
                                </dl>
                            </section>

                            <section aria-label="Product variants">
                                <h3 className="modal-section-title">
                                    Variants ({selectedProduct.variant.length})
                                </h3>
                                <div className="products-variant-list">
                                    {selectedProduct.variant.map(
                                        (productVariant) => (
                                            <VariantDetails
                                                inventoryRecords={inventoryRecords}
                                                key={productVariant.id}
                                                productId={selectedProduct.id}
                                                productVariant={productVariant}
                                            />
                                        )
                                    )}
                                </div>
                            </section>
                        </div>
                    </section>
                </div>
            )}
        </div>
    );
}
