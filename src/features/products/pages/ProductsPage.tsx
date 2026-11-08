import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { inventory } from "../../../inventory/inventoryStock";
import type { inventoryBatch } from "../../../inventory/inventoryBatch";
import type { packagingLevel } from "../../../packaging/packagingHierarchy";
import type { productStructure, variant } from "../../../products/productStructure";
import {
    validatePackagingHierarchy
} from "../../../packaging/packagingValidation";
import {
    validateInventoryPackagingRelationships
} from "../../../inventory/inventoryValidation";
import {
    filterProducts,
    getProductEmptyState,
    isProductFilter,
    searchProducts,
    type ProductFilter
} from "../../../products/productFiltering";
import CreateProductModal from "../components/CreateProductModal";
import ProductEditModal from "../components/ProductEditModal";
import type { ProductCreationResult } from "../../../products/productCreation";
import {
    createInventoryManageIntent,
    isProductEditContextValid,
    resolveNavigationProduct,
    type NavigationIntent,
    type NavigationRequest
} from "../../../navigation/navigationIntent";
import "./ProductsPage.css";

interface ProductsPageProps {
    products: productStructure[];
    inventoryRecords: inventory[];
    inventoryBatches: inventoryBatch[];
    onCreateProduct: (result: ProductCreationResult) => void;
    onUpdateProduct: (product: productStructure, reason: string) => void;
    navigationRequest: NavigationRequest | null;
    onNavigate: (intent: NavigationIntent) => void;
    onNavigationConsumed: (requestId: number, handled: boolean) => void;
    onNavigationDismissed: (requestId: number) => void;
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
    if (Number.isNaN(date.getTime())) {
        return "Expiry date unavailable";
    }

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

export function VariantDetails({
    productVariant,
    product,
    inventoryRecords,
    inventoryBatches
}: {
    productVariant: variant;
    product: productStructure;
    inventoryRecords: inventory[];
    inventoryBatches: inventoryBatch[];
}) {
    const nafdacRegistrationNumber =
        productVariant.nafdacRegistrationNumber?.trim();
    let packagingError: string | null = null;
    try {
        validatePackagingHierarchy(productVariant.packagingHierarchy);
    } catch (error) {
        packagingError = error instanceof Error
            ? error.message
            : "Packaging hierarchy is invalid.";
    }
    const orderedLevels = packagingError
        ? []
        : orderPackagingHierarchy(productVariant.packagingHierarchy);
    const levelsById = new Map(orderedLevels.map((level) => [level.id, level]));
    const variantInventoryRecords = inventoryRecords.filter(
        (record) =>
            record.productId === product.id &&
            record.variantId === productVariant.id
    );
    let inventoryError: string | null = null;
    for (const record of variantInventoryRecords) {
        try {
            validateInventoryPackagingRelationships(product, record);
        } catch (error) {
            inventoryError = error instanceof Error
                ? error.message
                : "Inventory quantities are unavailable.";
            break;
        }
    }
    const validInventoryRecords = inventoryError
        ? []
        : variantInventoryRecords;
    const variantBatches = inventoryBatches.filter(
        (batch) =>
            batch.productId === product.id &&
            batch.variantId === productVariant.id
    );
    const batchIds = new Set(variantBatches.map((batch) => batch.batchId));
    const recordsWithMissingBatchMetadata = validInventoryRecords.filter(
        (record) => record.batchId !== null && !batchIds.has(record.batchId)
    );
    const unbatchedRecords = validInventoryRecords.filter(
        (record) => record.batchId === null
    );

    function renderStockQuantities(records: inventory[]) {
        const quantities = new Map<string, number>();
        for (const record of records) {
            for (const stock of record.stockQuantities) {
                quantities.set(
                    stock.packagingLevelId,
                    (quantities.get(stock.packagingLevelId) ?? 0) + stock.quantity
                );
            }
        }
        const entries = orderedLevels.filter((level) =>
            quantities.has(level.id)
        );

        if (entries.length === 0) {
            return <p className="products-no-packaging">No stock quantities recorded.</p>;
        }

        return (
            <ul className="products-stock-by-batch">
                {entries.map((level) => {
                    const quantity = quantities.get(level.id) ?? 0;
                    return (
                        <li key={level.id}>
                            <span>{level.name}</span>
                            <strong>
                                {quantity}{" "}
                                {quantity === 1
                                    ? level.name
                                    : pluralizePackagingName(level.name)}
                            </strong>
                        </li>
                    );
                })}
            </ul>
        );
    }

    return (
        <section className="products-variant">
            <h3 className="modal-section-title">{productVariant.variantName}</h3>
            {nafdacRegistrationNumber && (
                <dl className="products-prices products-variant-registration">
                    <div>
                        <dt>NAFDAC Registration Number</dt>
                        <dd>{nafdacRegistrationNumber}</dd>
                    </div>
                </dl>
            )}
            {inventoryError && (
                <p className="products-no-packaging" role="status">
                    Inventory information unavailable: {inventoryError}
                </p>
            )}

            <div className="products-batches">
                <h4>Inventory batches</h4>
                {variantBatches.length === 0 &&
                recordsWithMissingBatchMetadata.length === 0 ? (
                    <p className="products-no-packaging">
                        {inventoryError
                            ? "Batch information cannot be verified because the inventory data is invalid."
                            : "No inventory batches are associated with this variant."}
                    </p>
                ) : (
                    <ul>
                        {variantBatches.map((batch) => {
                            const batchRecords = validInventoryRecords.filter(
                                (record) => record.batchId === batch.batchId
                            );
                            return (
                                <li className="products-batch-item" key={batch.batchId}>
                                    <div className="products-batch-heading">
                                        <strong>
                                            {batch.batchNumber ?? "Batch number not set"}
                                        </strong>
                                        <span>Variant: {productVariant.variantName}</span>
                                        <span>
                                            {batch.expiryDate
                                                ? `Expires ${formatExpiryDate(batch.expiryDate)}`
                                                : "Expiry date unavailable"}
                                        </span>
                                    </div>
                                    {inventoryError ? (
                                        <p className="products-no-packaging">
                                            Stock quantities unavailable: {inventoryError}
                                        </p>
                                    ) : (
                                        renderStockQuantities(batchRecords)
                                    )}
                                </li>
                            );
                        })}
                        {recordsWithMissingBatchMetadata.length > 0 && (
                            <li className="products-batch-item">
                                <strong>Batch details unavailable</strong>
                                {inventoryError ? (
                                    <p className="products-no-packaging">
                                        Stock quantities unavailable: {inventoryError}
                                    </p>
                                ) : (
                                    renderStockQuantities(
                                        recordsWithMissingBatchMetadata
                                    )
                                )}
                            </li>
                        )}
                    </ul>
                )}
            </div>
            {unbatchedRecords.length > 0 && (
                <div className="products-batches">
                    <h4>Unbatched stock</h4>
                    {inventoryError ? (
                        <p className="products-no-packaging">
                            Stock quantities unavailable: {inventoryError}
                        </p>
                    ) : (
                        renderStockQuantities(unbatchedRecords)
                    )}
                </div>
            )}

            <h4 className="products-subsection-title">Packaging</h4>
            {packagingError ? (
                <p className="products-no-packaging" role="status">
                    Packaging information unavailable: {packagingError}
                </p>
            ) : orderedLevels.length === 0 ? (
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
                                    <span className="products-conversion">
                                        {nextLevel && level.quantityofNextLevel !== null
                                            ? `1 ${level.name} = ${level.quantityofNextLevel} ${nextLevel.name}`
                                            : "Lowest packaging level"}
                                    </span>
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
                                </dl>
                            </li>
                        );
                    })}
                </ol>
            )}
        </section>
    );
}

export function ProductInformation({
    product
}: {
    product: productStructure;
}) {
    return (
        <section className="products-information">
            <h3 className="modal-section-title">Product information</h3>
            <dl>
                <div>
                    <dt>Product name</dt>
                    <dd>{product.name}</dd>
                </div>
                {product.genericName?.trim() && (
                    <div>
                        <dt>Generic name</dt>
                        <dd>{product.genericName}</dd>
                    </div>
                )}
                {product.manufacturer?.trim() && (
                    <div>
                        <dt>Manufacturer</dt>
                        <dd>{product.manufacturer}</dd>
                    </div>
                )}
            </dl>
        </section>
    );
}

export default function ProductsPage({
    products,
    inventoryRecords,
    inventoryBatches,
    onCreateProduct,
    onUpdateProduct,
    navigationRequest,
    onNavigate,
    onNavigationConsumed,
    onNavigationDismissed
}: ProductsPageProps) {
    const [isCreatingProduct, setIsCreatingProduct] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [productFilter, setProductFilter] = useState<ProductFilter>("all");
    const [selectedProductId, setSelectedProductId] = useState<string | null>(
        null
    );
    const [viewingProductId, setViewingProductId] = useState<string | null>(
        null
    );
    const [editingProductId, setEditingProductId] = useState<string | null>(
        null
    );
    const handledNavigationRequestId = useRef<number | null>(null);
    useEffect(() => {
        if (
            !navigationRequest ||
            navigationRequest.consumed ||
            handledNavigationRequestId.current === navigationRequest.requestId
        ) {
            return;
        }

        const { intent, requestId } = navigationRequest;
        if (intent.type !== "product.view" && intent.type !== "product.edit") {
            return;
        }
        handledNavigationRequestId.current = requestId;
        const product = resolveNavigationProduct(intent, products);
        const valid = product !== undefined &&
            (intent.type !== "product.edit" ||
                isProductEditContextValid(intent, product));
        onNavigationConsumed(requestId, valid);
    }, [navigationRequest, onNavigationConsumed, products]);

    const searchMatches = searchProducts(products, searchTerm);
    const filteredProducts = filterProducts(
        searchMatches,
        productFilter,
        inventoryBatches
    );
    const navigationProduct =
        navigationRequest?.intent.type === "product.view" ||
        navigationRequest?.intent.type === "product.edit"
            ? resolveNavigationProduct(navigationRequest.intent, products)
            : undefined;
    const selectedProduct = navigationRequest
        ? navigationRequest.intent.type === "product.view"
            ? navigationProduct
            : undefined
        : products.find((product) => product.id === viewingProductId);
    const navigationEditProduct =
        navigationRequest?.intent.type === "product.edit"
            ? resolveNavigationProduct(navigationRequest.intent, products)
            : undefined;
    const validNavigationEditProduct =
        navigationEditProduct &&
        navigationRequest?.intent.type === "product.edit" &&
        isProductEditContextValid(navigationRequest.intent, navigationEditProduct)
            ? navigationEditProduct
            : undefined;
    const editingProduct = navigationRequest
        ? validNavigationEditProduct
        : products.find((product) => product.id === editingProductId);
    const activeSelectedProductId =
        navigationProduct?.id ?? selectedProductId;
    const emptyMessage = getProductEmptyState(
        products.length,
        searchMatches.length,
        filteredProducts.length,
        searchTerm,
        productFilter
    );

    useEffect(() => {
        if (!selectedProduct && !editingProduct) {
            return;
        }

        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") {
                if (selectedProduct) {
                    if (navigationRequest?.intent.type === "product.view") {
                        onNavigationDismissed(navigationRequest.requestId);
                    }
                    setSelectedProductId(null);
                    setViewingProductId(null);
                } else if (editingProduct) {
                    if (navigationRequest?.intent.type === "product.edit") {
                        onNavigationDismissed(navigationRequest.requestId);
                    }
                    setEditingProductId(null);
                }
            }
        }

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [editingProduct, navigationRequest, onNavigationDismissed, selectedProduct]);

    function openProductEdit(productId: string) {
        if (navigationRequest) {
            onNavigationDismissed(navigationRequest.requestId);
        }
        setSelectedProductId(null);
        setViewingProductId(null);
        setEditingProductId(productId);
    }

    function closeProductEdit() {
        if (navigationRequest?.intent.type === "product.edit") {
            onNavigationDismissed(navigationRequest.requestId);
        }
        setEditingProductId(null);
    }

    function viewProduct(productId: string) {
        if (navigationRequest) {
            onNavigationDismissed(navigationRequest.requestId);
        }
        setSelectedProductId(productId);
        setViewingProductId(productId);
    }

    function manageStock(
        productId: string,
        variantId: string,
        inventoryId: string,
        batchId: string | null
    ) {
        setEditingProductId(null);
        onNavigate(createInventoryManageIntent(
            productId,
            variantId,
            inventoryId,
            batchId
        ));
    }

    function closeProductView() {
        if (navigationRequest?.intent.type === "product.view") {
            onNavigationDismissed(navigationRequest.requestId);
        }
        setSelectedProductId(null);
        setViewingProductId(null);
    }

    return (
        <div className="products-page">
            <header className="page-heading">
                <div>
                    <h2>Products</h2>
                    <p>View product, variant, packaging, and stock details.</p>
                </div>
                <button
                    className="primary-button"
                    onClick={() => setIsCreatingProduct(true)}
                    type="button"
                >
                    Create Product
                </button>
            </header>

            <section className="products-controls" aria-label="Search and filter products">
                <label className="products-search">
                    <Search aria-hidden="true" size={18} />
                    <span className="visually-hidden">Search products</span>
                    <input
                        type="search"
                        value={searchTerm}
                        onChange={(event) => setSearchTerm(event.target.value)}
                        placeholder="Search products"
                    />
                    {searchTerm !== "" && (
                        <button
                            aria-label="Clear search"
                            className="products-search-clear"
                            onClick={() => setSearchTerm("")}
                            type="button"
                        >
                            <X aria-hidden="true" size={16} />
                        </button>
                    )}
                </label>

                <label className="products-filter">
                    <span>Filters</span>
                    <select
                        aria-label="Filter products"
                        value={productFilter}
                        onChange={(event) => {
                            const value = event.target.value;
                            if (isProductFilter(value)) {
                                setProductFilter(value);
                            }
                        }}
                    >
                        <option value="all">All products</option>
                        <option value="single-variant">Single variant</option>
                        <option value="multiple-variants">Multiple variants</option>
                        <option value="with-batches">With batches</option>
                        <option value="without-batches">Without batches</option>
                    </select>
                </label>

                <p className="products-result-count" aria-live="polite">
                    Showing {filteredProducts.length} of {products.length}{" "}
                    {products.length === 1 ? "product" : "products"}
                </p>
            </section>

            <div className="product-card-grid">
                {filteredProducts.map((product) => (
                    <article
                        className={`product-card${activeSelectedProductId === product.id
                            ? " product-card-selected"
                            : ""}`}
                        key={product.id}
                    >
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
                                onClick={() => viewProduct(product.id)}
                                type="button"
                            >
                                View
                            </button>
                            <button
                                aria-label={`Edit ${product.name}`}
                                className="secondary-button products-unavailable-action"
                                onClick={() => openProductEdit(product.id)}
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
            {emptyMessage && (
                <p className="products-empty-state" role="status">
                    {emptyMessage}
                </p>
            )}

            {isCreatingProduct && (
                <CreateProductModal
                    inventoryRecords={inventoryRecords}
                    inventoryBatches={inventoryBatches}
                    onClose={() => setIsCreatingProduct(false)}
                    onCreate={onCreateProduct}
                    products={products}
                />
            )}

            {selectedProduct && (
                <div
                    className="inventory-modal-overlay"
                    onClick={(event) => {
                        if (event.target === event.currentTarget) {
                            closeProductView();
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
                                <p>Product information, packaging, and inventory</p>
                            </div>
                            <button
                                aria-label="Close product details"
                                className="modal-close-button"
                                onClick={closeProductView}
                                type="button"
                            >
                                &times;
                            </button>
                        </div>

                        <div className="inventory-modal-content">
                            <ProductInformation product={selectedProduct} />

                            <section aria-label="Product variants">
                                <h3 className="modal-section-title">
                                    Variants ({selectedProduct.variant.length})
                                </h3>
                                <div className="products-variant-list">
                                    {selectedProduct.variant.map(
                                        (productVariant) => (
                                            <VariantDetails
                                                inventoryRecords={inventoryRecords}
                                                inventoryBatches={inventoryBatches}
                                                key={productVariant.id}
                                                product={selectedProduct}
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
            {editingProduct && (
                <ProductEditModal
                    key={editingProduct.id}
                    initialVariantId={
                        navigationRequest?.intent.type === "product.edit"
                            ? navigationRequest.intent.variantId ?? null
                            : null
                    }
                    inventoryRecords={inventoryRecords}
                    inventoryBatches={inventoryBatches}
                    onManageStock={(variantId, inventoryId, batchId) =>
                        manageStock(
                            editingProduct.id,
                            variantId,
                            inventoryId,
                            batchId
                        )
                    }
                    onClose={closeProductEdit}
                    onSave={onUpdateProduct}
                    product={editingProduct}
                />
            )}
        </div>
    );
}
