
import { useState } from "react";
import { getAllInventoryDisplay } from "../../../inventory/inventoryLookup";
import { aggregateVariantStock } from "../../../inventory/inventoryAggregation";
import { getStockQuantity } from "../../../inventory/inventoryStock";
import { adjustInventoryStock } from "../../../inventory/inventoryAdjustment";
import type { stockAdjustment } from "../../../inventory/inventoryAdjustment";
import type { inventory } from "../../../inventory/inventoryStock";
import type { inventoryDisplay } from "../../../inventory/inventoryLookup";
import type { aggregatedVariantStock } from "../../../inventory/inventoryAggregation";
import EditProductModal from "../components/EditProductModal";
import type { EditProductChanges } from "../components/EditProductModal";
import { demoProducts } from "../../../data/demoInventory";
import type { productStructure } from "../../../products/productStructure";
import "./InventoryPage.css";

interface InventoryPageProps {
    inventoryRecords: inventory[];
    onInventoryChange: (records: inventory[]) => void;
}

interface VariantGroup {
    variantId: string;
    variantName: string;
    records: inventoryDisplay[];
    aggregatedStock: aggregatedVariantStock;
}

interface ProductGroup {
    productId: string;
    productName: string;
    records: inventoryDisplay[];
    variants: VariantGroup[];
}

function groupInventoryRecords(
    records: inventoryDisplay[]
): ProductGroup[] {

    const productGroups = new Map<string, inventoryDisplay[]>();

    // First, group all records by product ID.
    for (const record of records) {
        const existingRecords = productGroups.get(record.productId) ?? [];

        existingRecords.push(record);
        productGroups.set(record.productId, existingRecords);
    }

    const result: ProductGroup[] = [];

    for (const [productId, productRecords] of productGroups) {

        const variantGroups = new Map<string, inventoryDisplay[]>();

        // Within each product, group records by variant ID.
        for (const record of productRecords) {
            const existingRecords =
                variantGroups.get(record.variantId) ?? [];

            existingRecords.push(record);
            variantGroups.set(record.variantId, existingRecords);
        }

        const variants: VariantGroup[] = [];

        for (const [variantId, variantRecords] of variantGroups) {

            const aggregatedStock =
                aggregateVariantStock(variantRecords);

            if (!aggregatedStock) {
                throw new Error(
                    `Unable to aggregate variant: ${variantId}`
                );
            }

            variants.push({
                variantId,
                variantName: variantRecords[0].variantName,
                records: variantRecords,
                aggregatedStock
            });
        }

        result.push({
            productId,
            productName: productRecords[0].productName,
            records: productRecords,
            variants
        });
    }

    return result;
}

export default function InventoryPage({
    inventoryRecords: inventoryState,
    onInventoryChange
}: InventoryPageProps) {

    const [productsState, setProductsState] =
        useState<productStructure[]>(() => demoProducts);

    const [, setAdjustmentHistory] =
        useState<stockAdjustment[]>([]);

    const [searchTerm, setSearchTerm] = useState("");

    const [selectedProductId, setSelectedProductId] =
        useState<string | null>(null);

    const [selectedVariantId, setSelectedVariantId] =
        useState<string | null>(null);

    const [editingProductId, setEditingProductId] =
    useState<string | null>(null);

    const inventoryRecords = getAllInventoryDisplay(inventoryState, productsState);

    // Build product and variant groups using all inventory records.
    const productGroups = groupInventoryRecords(inventoryRecords);

    const editingProduct = productsState.find(
        (product) => product.id === editingProductId
    );

    const editingInventoryRecords = productGroups.find(
        (product) => product.productId === editingProductId
    )?.records ?? [];

    // Search filters product cards, not the underlying aggregation.
    const normalizedSearch = searchTerm.trim().toLowerCase();

    const filteredProducts = productGroups.filter((product) =>
        product.records.some((record) =>
            record.productName.toLowerCase().includes(normalizedSearch) ||
            record.variantName.toLowerCase().includes(normalizedSearch) ||
            (record.batchNumber ?? "")
                .toLowerCase()
                .includes(normalizedSearch)
        )
    );

    const selectedProduct = productGroups.find(
        (product) => product.productId === selectedProductId
    );

    const selectedVariant = selectedProduct?.variants.find(
        (variant) => variant.variantId === selectedVariantId
    );

    function openProduct(productId: string) {
        setSelectedProductId(productId);
        setSelectedVariantId(null);
    }

    function closeProduct() {
        setSelectedProductId(null);
        setSelectedVariantId(null);
    }

    function handleSaveInventoryChanges(changes: EditProductChanges) {
        if (!editingProductId) {
            throw new Error("No product is currently being edited.");
        }

        const productId = editingProductId;
        const currentProduct = productsState.find(
            (product) => product.id === productId
        );

        if (!currentProduct) {
            throw new Error(`Product not found: ${productId}`);
        }

        if (changes.reason.trim() === "") {
            throw new Error("An adjustment reason is required.");
        }

        const validBatchKeys = new Set(
            currentProduct.variant.flatMap((variant) =>
                variant.batches.map((batch) =>
                    JSON.stringify([variant.id, batch.batchId])
                )
            )
        );
        const changesByBatch = new Map<
            string,
            EditProductChanges["batches"][number]
        >();

        for (const batchChanges of changes.batches) {
            const batchKey = JSON.stringify([
                batchChanges.variantId,
                batchChanges.batchId
            ]);

            if (!validBatchKeys.has(batchKey)) {
                throw new Error(
                    `Batch not found for variant: ${batchChanges.variantId}, batch: ${batchChanges.batchId}`
                );
            }

            if (changesByBatch.has(batchKey)) {
                throw new Error(
                    `Duplicate changes for batch: ${batchChanges.batchId}`
                );
            }

            if (
                batchChanges.batchNumber !== null &&
                typeof batchChanges.batchNumber !== "string"
            ) {
                throw new Error(
                    `Invalid batch number for batch: ${batchChanges.batchId}`
                );
            }

            if (
                !(batchChanges.expiryDate instanceof Date) ||
                Number.isNaN(batchChanges.expiryDate.getTime())
            ) {
                throw new Error(
                    `Invalid expiry date for batch: ${batchChanges.batchId}`
                );
            }

            const seenPackagingLevels = new Set<string>();
            for (const stock of batchChanges.stockQuantities) {
                if (stock.packagingLevelId.trim() === "") {
                    throw new Error("Packaging level ID must not be empty.");
                }

                if (seenPackagingLevels.has(stock.packagingLevelId)) {
                    throw new Error(
                        `Duplicate stock quantity for packaging level: ${stock.packagingLevelId}`
                    );
                }

                seenPackagingLevels.add(stock.packagingLevelId);

                if (
                    !Number.isSafeInteger(stock.quantity) ||
                    stock.quantity < 0
                ) {
                    throw new Error(
                        "Quantity must be a safe non-negative integer."
                    );
                }
            }

            changesByBatch.set(batchKey, batchChanges);
        }

        // Work with local copies first. React state is not changed
        // until every requested change has been processed successfully.
        const nextProducts = productsState.map((product) => {
            if (product.id !== productId) {
                return product;
            }

            return {
                ...product,
                variant: product.variant.map((variant) => ({
                    ...variant,
                    batches: variant.batches.map((batch) => {
                        const batchChanges = changesByBatch.get(
                            JSON.stringify([variant.id, batch.batchId])
                        );

                        if (!batchChanges) {
                            return batch;
                        }

                        return {
                            ...batch,
                            batchNumber: batchChanges.batchNumber,
                            expiryDate: new Date(batchChanges.expiryDate)
                        };
                    })
                }))
            };
        });

        const nextInventory = [...inventoryState];
        const newAdjustments: stockAdjustment[] = [];
        const seenInventoryIds = new Set<string>();

        for (const batchChanges of changes.batches) {
            if (batchChanges.inventoryId === null) {
                continue;
            }

            if (seenInventoryIds.has(batchChanges.inventoryId)) {
                throw new Error(
                    `Duplicate inventory record in changes: ${batchChanges.inventoryId}`
                );
            }
            seenInventoryIds.add(batchChanges.inventoryId);

            const inventoryIndex = nextInventory.findIndex(
                (record) =>
                    record.id === batchChanges.inventoryId &&
                    record.productId === productId &&
                    record.variantId === batchChanges.variantId &&
                    record.batchId === batchChanges.batchId
            );

            if (inventoryIndex === -1) {
                throw new Error(
                    `Inventory record not found for batch: ${batchChanges.batchId}`
                );
            }

            let updatedRecord = nextInventory[inventoryIndex];

            for (const stock of batchChanges.stockQuantities) {
                const previousQuantity = getStockQuantity(
                    updatedRecord,
                    stock.packagingLevelId
                );

                if (previousQuantity === stock.quantity) {
                    continue;
                }

                const result = adjustInventoryStock(
                    updatedRecord,
                    stock.packagingLevelId,
                    stock.quantity,
                    changes.reason
                );

                updatedRecord = result.updatedInventory;
                newAdjustments.push(result.adjustment);
            }

            nextInventory[inventoryIndex] = updatedRecord;
        }

        // Commit all changes only after processing succeeds.
        setProductsState(nextProducts);
        onInventoryChange(nextInventory);

        if (newAdjustments.length > 0) {
            setAdjustmentHistory((previous) => [
                ...previous,
                ...newAdjustments
            ]);
        }

        setEditingProductId(null);
    }

    function openVariant(variantId: string) {
        setSelectedVariantId(variantId);
    }

    function displayStock(
        quantities: inventoryDisplay["stockQuantities"],
        packagingLevels: inventoryDisplay["packagingLevels"]
    ) {
        return quantities.map((stock) => {
            const packagingLevel = packagingLevels.find(
                (level) => level.id === stock.packagingLevelId
            );

            return (
                <div className="stock-item" key={stock.packagingLevelId}>
                    <span className="stock-quantity">
                        {stock.quantity}
                    </span>

                    <span>
                        {packagingLevel?.name ?? "Unknown"}
                    </span>
                </div>
            );
        });
    }

    return (
        <section className="inventory-page">

            <div className="page-heading">
                <div>
                    <h2>Inventory management</h2>
                    <p>
                        Manage pharmacy products, batches, and stock levels.
                    </p>
                </div>

                <button className="primary-button" type="button">
                    Adjust Stock
                </button>
            </div>

            <div className="inventory-toolbar">

                <label className="inventory-search">
                    <span className="visually-hidden">
                        Search inventory
                    </span>

                    <input
                        type="search"
                        placeholder="Search products, variants, or batches"
                        value={searchTerm}
                        onChange={(event) =>
                            setSearchTerm(event.target.value)
                        }
                    />
                </label>

                <label
                    className="visually-hidden"
                    htmlFor="stock-filter"
                >
                    Filter by stock level
                </label>

                <select id="stock-filter" defaultValue="all">
                    <option value="all">All stock</option>
                    <option value="in-stock">In stock</option>
                    <option value="low-stock">Low stock</option>
                    <option value="out-of-stock">Out of stock</option>
                </select>

            </div>

            {/* Product cards */}

            <div className="product-card-grid">

                {filteredProducts.length === 0 ? (

                    <div className="product-empty-state">
                        <strong>No inventory found</strong>
                        <p>
                            No products or inventory records match your search.
                        </p>
                    </div>

                ) : (

                    filteredProducts.map((product) => {

                        const batchCount = product.variants.reduce(
                            (total, variant) =>
                                total + variant.aggregatedStock.batchCount,
                            0
                        );

                        return (
                            <article
                                className="product-card"
                                key={product.productId}
                            >

                                <div className="product-card-heading">
                                    <div>
                                        <h3>{product.productName}</h3>

                                        <p>
                                            {product.variants.length}{" "}
                                            {product.variants.length === 1
                                                ? "variant"
                                                : "variants"}
                                            {" · "}
                                            {batchCount}{" "}
                                            {batchCount === 1
                                                ? "batch"
                                                : "batches"}
                                        </p>
                                    </div>
                                </div>

                                <div className="product-card-actions">

                                    <button
                                        className="secondary-button"
                                        type="button"
                                        onClick={() =>
                                            openProduct(product.productId)
                                        }
                                    >
                                        View
                                    </button>

                                    <button
    className="secondary-button"
    type="button"
    onClick={() => setEditingProductId(product.productId)}
>
    Edit
</button>

                                    <button
                                        className="product-delete-button"
                                        type="button"
                                    >
                                        Delete
                                    </button>

                                </div>

                            </article>
                        );
                    })
                )}

            </div>

            {/* Product details modal */}

            {selectedProduct && (

                <div
                    className="inventory-modal-overlay"
                    onClick={(event) => {
                        if (event.target === event.currentTarget) {
                            closeProduct();
                        }
                    }}
                >

                    <section
                        className="inventory-modal"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="inventory-modal-title"
                    >

                        <div className="inventory-modal-header">

                            <div>
                                <h2 id="inventory-modal-title">
                                    {selectedProduct.productName}
                                </h2>

                                <p>
                                    {selectedVariant
                                        ? "Variant batch details"
                                        : "Product variants and stock"}
                                </p>
                            </div>

                            <button
                                className="modal-close-button"
                                type="button"
                                onClick={closeProduct}
                                aria-label="Close product details"
                            >
                                &times;
                            </button>

                        </div>

                        <div className="inventory-modal-content">

                            {!selectedVariant ? (

                                <>

                                    <h3 className="modal-section-title">
                                        Product variants
                                    </h3>

                                    <div className="variant-card-list">

                                        {selectedProduct.variants.map(
                                            (variant) => (

                                                <button
                                                    className="variant-card"
                                                    type="button"
                                                    key={variant.variantId}
                                                    onClick={() =>
                                                        openVariant(
                                                            variant.variantId
                                                        )
                                                    }
                                                >

                                                    <div className="variant-card-heading">

                                                        <strong>
                                                            {variant.variantName}
                                                        </strong>

                                                        <span className="variant-arrow">
                                                            &rarr;
                                                        </span>

                                                    </div>

                                                    <div className="aggregated-stock">

                                                        {displayStock(
                                                            variant.aggregatedStock.stockQuantities,
                                                            variant.aggregatedStock.packagingLevels
                                                        )}

                                                    </div>

                                                    <p className="variant-batch-count">
                                                        Across{" "}
                                                        {variant.aggregatedStock.batchCount}{" "}
                                                        {variant.aggregatedStock.batchCount === 1
                                                            ? "batch"
                                                            : "batches"}
                                                    </p>

                                                </button>

                                            )
                                        )}

                                    </div>

                                </>

                            ) : (

                                <>

                                    <button
                                        className="back-to-variants"
                                        type="button"
                                        onClick={() =>
                                            setSelectedVariantId(null)
                                        }
                                    >
                                        &larr; Back to variants
                                    </button>

                                    <div className="selected-variant-heading">

                                        <h3>
                                            {selectedVariant.variantName}
                                        </h3>

                                        <p>
                                            Aggregated stock
                                        </p>

                                        <div className="aggregated-stock">

                                            {displayStock(
                                                selectedVariant.aggregatedStock.stockQuantities,
                                                selectedVariant.aggregatedStock.packagingLevels
                                            )}

                                        </div>

                                        <span className="variant-batch-count">
                                            Across{" "}
                                            {selectedVariant.aggregatedStock.batchCount}{" "}
                                            {selectedVariant.aggregatedStock.batchCount === 1
                                                ? "batch"
                                                : "batches"}
                                        </span>

                                    </div>

                                    <h3 className="modal-section-title">
                                        Individual batches
                                    </h3>

                                    <div className="batch-card-list">

                                        {selectedVariant.records.map(
                                            (record) => (

                                                <article
                                                    className="batch-card"
                                                    key={record.batchId}
                                                >

                                                    <div className="batch-card-heading">

                                                        <strong>
                                                            {record.batchNumber ?? "No batch number"}
                                                        </strong>

                                                        <span>
                                                            Expires:{" "}
                                                            {record.expiryDate.toLocaleDateString()}
                                                        </span>

                                                    </div>

                                                    <div className="batch-stock">

                                                        {displayStock(
                                                            record.stockQuantities,
                                                            record.packagingLevels
                                                        )}

                                                    </div>

                                                </article>

                                            )
                                        )}

                                    </div>

                                </>

                            )}

                        </div>

                    </section>

                </div>

            )}

            {editingProduct && (
                <EditProductModal
                    product={editingProduct}
                    inventoryRecords={editingInventoryRecords}
                    onClose={() => setEditingProductId(null)}
                    onSave={handleSaveInventoryChanges}
                />
            )}

        </section>
    );
}
