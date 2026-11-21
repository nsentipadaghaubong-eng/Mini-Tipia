
import { useEffect, useRef, useState } from "react";
import { getAllInventoryDisplay } from "../../../inventory/inventoryLookup";
import { aggregateVariantStock } from "../../../inventory/inventoryAggregation";
import {
    getVariantLowStockStatus,
    type VariantLowStockStatus
} from "../../../inventory/lowStock";
import { getStockQuantity } from "../../../inventory/inventoryStock";
import { createInventory } from "../../../inventory/inventoryStock";
import { validateInventoryPackagingRelationships } from "../../../inventory/inventoryValidation";
import {
    adjustInventoryStock,
    applyUnbatchedInventoryChanges
} from "../../../inventory/inventoryAdjustment";
import type { stockAdjustment } from "../../../inventory/inventoryAdjustment";
import type { inventory } from "../../../inventory/inventoryStock";
import type { inventoryBatch } from "../../../inventory/inventoryBatch";
import {
    buildBatchCreatedActivityInput,
    buildBatchRemovalActivityInput,
    buildBatchUpdatedActivityInput,
    buildStockAdjustmentActivityInput,
    type ActivityEventInput
} from "../../../activity/activity";
import type { inventoryDisplay } from "../../../inventory/inventoryLookup";
import type { aggregatedVariantStock } from "../../../inventory/inventoryAggregation";
import EditProductModal from "../components/EditProductModal";
import type { EditProductChanges } from "../components/EditProductModal";
import type { productStructure } from "../../../products/productStructure";
import type { SaleDraft } from "../../../sales/salesDraft";
import type { DeliveryDraft } from "../../../deliveries/deliveryDraft";
import { getProductDraftLockMessages } from "../../../products/productDraftLock";
import { getExpiryDisplay } from "../../../expiry/expiryDisplay";
import {
    createProductEditIntent,
    resolveInventoryManageTarget,
    type NavigationIntent,
    type NavigationRequest
} from "../../../navigation/navigationIntent";
import "./InventoryPage.css";
import "../../../expiry/expiryDisplay.css";

interface InventoryPageProps {
    inventoryRecords: inventory[];
    inventoryBatches: inventoryBatch[];
    onInventoryCommit: (commit: InventoryCommit) => void;
    products: productStructure[];
    navigationRequest: NavigationRequest | null;
    onNavigate: (intent: NavigationIntent) => void;
    onNavigationConsumed: (requestId: number, handled: boolean) => void;
    onNavigationDismissed: (requestId: number) => void;
    saleDrafts?: SaleDraft[];
    deliveryDrafts?: DeliveryDraft[];
}

export interface InventoryCommit {
    inventoryRecords: inventory[];
    inventoryBatches: inventoryBatch[];
    activityEvents: ActivityEventInput[];
}

interface VariantGroup {
    variantId: string;
    variantName: string;
    records: inventoryDisplay[];
    aggregatedStock: aggregatedVariantStock;
    lowStockStatus?: VariantLowStockStatus;
}

interface ProductGroup {
    productId: string;
    productName: string;
    records: inventoryDisplay[];
    variants: VariantGroup[];
}

type StockFilter = "all" | "in-stock" | "low-stock" | "out-of-stock";

function isStockFilter(value: string): value is StockFilter {
    return value === "all" ||
        value === "in-stock" ||
        value === "low-stock" ||
        value === "out-of-stock";
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

function createEmptyVariantGroup(
    product: productStructure,
    productVariant: productStructure["variant"][number],
    batches: readonly inventoryBatch[]
): VariantGroup {
    return {
        variantId: productVariant.id,
        variantName: productVariant.variantName,
        records: [],
        aggregatedStock: {
            productId: product.id,
            variantId: productVariant.id,
            batchCount: batches.filter(
                (batch) =>
                    batch.productId === product.id &&
                    batch.variantId === productVariant.id
            ).length,
            stockQuantities: productVariant.packagingHierarchy.map((level) => ({
                packagingLevelId: level.id,
                quantity: 0
            })),
            packagingLevels: productVariant.packagingHierarchy.map((level) => ({
                ...level
            }))
        }
    };
}

function describeStockGrouping(records: inventoryDisplay[], batchCount: number): string {
    const hasUnbatchedStock = records.some((record) => record.batchId === null);
    if (hasUnbatchedStock && batchCount === 0) {
        return "Unbatched stock";
    }
    if (hasUnbatchedStock) {
        return `Across ${batchCount} ${batchCount === 1 ? "batch" : "batches"} and unbatched stock`;
    }
    return `Across ${batchCount} ${batchCount === 1 ? "batch" : "batches"}`;
}

function describeVariantStockStatus(
    status: VariantLowStockStatus | undefined
): string {
    if (status && !status.hasStock) {
        return "Out of stock";
    }
    if (!status?.thresholdConfigured) {
        return "Threshold not configured";
    }
    if (status.isLowStock) {
        return "Low stock";
    }
    return "In stock";
}

export default function InventoryPage({
    inventoryRecords: inventoryState,
    inventoryBatches: inventoryBatchesState,
    onInventoryCommit,
    products: productsState,
    navigationRequest,
    onNavigate,
    onNavigationConsumed,
    onNavigationDismissed,
    saleDrafts = [],
    deliveryDrafts = []
}: InventoryPageProps) {
    const [searchTerm, setSearchTerm] = useState("");
    const [stockFilter, setStockFilter] = useState<StockFilter>("all");

    const [selectedProductId, setSelectedProductId] =
        useState<string | null>(null);

    const [selectedVariantId, setSelectedVariantId] =
        useState<string | null>(null);

    const [editingProductId, setEditingProductId] =
    useState<string | null>(null);
    const [inventoryLockMessages, setInventoryLockMessages] = useState<string[]>([]);
    const handledNavigationRequestId = useRef<number | null>(null);

    useEffect(() => {
        if (
            !navigationRequest ||
            navigationRequest.consumed ||
            handledNavigationRequestId.current === navigationRequest.requestId ||
            navigationRequest.intent.type !== "inventory.manage"
        ) {
            return;
        }

        const { intent, requestId } = navigationRequest;
        handledNavigationRequestId.current = requestId;
        const target = resolveInventoryManageTarget(
            intent,
            productsState,
            inventoryState,
            inventoryBatchesState
        );
        onNavigationConsumed(requestId, target !== undefined);
    }, [
        inventoryBatchesState,
        inventoryState,
        navigationRequest,
        onNavigationConsumed,
        productsState
    ]);

    const inventoryRecords = getAllInventoryDisplay(
        inventoryState,
        productsState,
        inventoryBatchesState
    );

    // Build product and variant groups using all inventory records.
    const productGroups = groupInventoryRecords(inventoryRecords);
    for (const product of productsState) {
        let group = productGroups.find((candidate) => candidate.productId === product.id);
        if (!group) {
            group = {
                productId: product.id,
                productName: product.name,
                records: [],
                variants: []
            };
            productGroups.push(group);
        }
        const currentGroup = group;
        group.variants = product.variant.map((productVariant) => {
            const variantGroup =
                currentGroup.variants.find(
                    (candidate) => candidate.variantId === productVariant.id
                ) ??
                createEmptyVariantGroup(
                    product,
                    productVariant,
                    inventoryBatchesState
                );
            return {
                ...variantGroup,
                lowStockStatus: getVariantLowStockStatus(
                    productVariant,
                    variantGroup.aggregatedStock
                )
            };
        });
    }

    const inventoryNavigationIntent =
        navigationRequest?.intent.type === "inventory.manage"
            ? navigationRequest.intent
            : null;
    const inventoryNavigationTarget = inventoryNavigationIntent
        ? resolveInventoryManageTarget(
            inventoryNavigationIntent,
            productsState,
            inventoryState,
            inventoryBatchesState
        )
        : undefined;
    const inventoryNavigationProduct = inventoryNavigationTarget?.product;
    const editingProduct = inventoryNavigationIntent
        ? inventoryNavigationProduct
        : productsState.find((product) => product.id === editingProductId);

    const editingInventoryRecords = productGroups.find(
        (product) => product.productId === editingProduct?.id
    )?.records ?? [];

    // Search filters product cards, not the underlying aggregation.
    const normalizedSearch = searchTerm.trim().toLowerCase();

    const filteredProducts = productGroups.filter((product) =>
        product.records.length === 0
            ? product.productName.toLowerCase().includes(normalizedSearch) ||
                product.variants.some((variant) =>
                    variant.variantName.toLowerCase().includes(normalizedSearch)
                )
            : product.records.some((record) =>
            record.productName.toLowerCase().includes(normalizedSearch) ||
            record.variantName.toLowerCase().includes(normalizedSearch) ||
            (record.batchNumber ?? "")
                .toLowerCase()
                .includes(normalizedSearch)
            )
    ).filter((product) => stockFilter === "all" ||
        product.variants.some((variant) => {
            const status = variant.lowStockStatus;
            if (!status) {
                return false;
            }
            if (stockFilter === "in-stock") {
                return status.hasStock;
            }
            if (stockFilter === "low-stock") {
                return status.hasStock &&
                    status.thresholdConfigured &&
                    status.isLowStock;
            }
            return !status.hasStock;
        })
    );

    const selectedProduct = productGroups.find(
        (product) =>
            product.productId ===
            (inventoryNavigationProduct?.id ?? selectedProductId)
    );

    const selectedVariant = selectedProduct?.variants.find(
        (variant) =>
            variant.variantId ===
            (inventoryNavigationTarget?.inventoryRecord.variantId ?? selectedVariantId)
    );
    const selectedVariantBatches = selectedProduct && selectedVariant
        ? inventoryBatchesState.filter(
            (batch) =>
                batch.productId === selectedProduct.productId &&
                batch.variantId === selectedVariant.variantId
        )
        : [];

    function openProduct(productId: string) {
        setSelectedProductId(productId);
        setSelectedVariantId(null);
    }

    function closeProduct() {
        setSelectedProductId(null);
        setSelectedVariantId(null);
        setInventoryLockMessages([]);
    }

    function handleSaveInventoryChanges(changes: EditProductChanges) {
        const productId = inventoryNavigationIntent
            ? inventoryNavigationTarget?.product.id
            : editingProductId;
        if (!productId) {
            throw new Error("No product is currently being edited.");
        }

        const currentProduct = productsState.find(
            (product) => product.id === productId
        );

        if (!currentProduct) {
            throw new Error(`Product not found: ${productId}`);
        }

        const draftLockMessages = getProductDraftLockMessages(
            productId,
            saleDrafts,
            deliveryDrafts
        );
        if (draftLockMessages.length > 0) {
            throw new Error(draftLockMessages.join(" "));
        }

        if (changes.reason.trim() === "") {
            throw new Error("An adjustment reason is required.");
        }

        const deletionKeys = new Set<string>();
        for (const deletion of changes.deletedBatches) {
            const key = JSON.stringify([
                productId,
                deletion.variantId,
                deletion.batchId
            ]);
            if (deletion.reason.trim() === "") {
                throw new Error("A reason is required for every deletion.");
            }
            if (deletionKeys.has(key)) {
                throw new Error("A batch can only be deleted once per save.");
            }
            const matches = inventoryBatchesState.filter(
                (batch) =>
                    batch.productId === productId &&
                    batch.variantId === deletion.variantId &&
                    batch.batchId === deletion.batchId
            );
            if (matches.length !== 1) {
                throw new Error(`Batch not found: ${deletion.batchId}`);
            }
            deletionKeys.add(key);
        }

        if (inventoryNavigationTarget) {
            const target = inventoryNavigationTarget.inventoryRecord;
            const targetIncluded = target.batchId === null
                ? changes.unbatched.some(
                    (item) => item.inventoryId === target.id &&
                        item.variantId === target.variantId
                )
                : changes.batches.some(
                    (item) => item.inventoryId === target.id &&
                        item.variantId === target.variantId &&
                        item.batchId === target.batchId
                ) || changes.deletedBatches.some(
                    (item) =>
                        item.variantId === target.variantId &&
                        item.batchId === target.batchId
                );
            if (!targetIncluded) {
                throw new Error(
                    "The selected inventory record is missing from the edit."
                );
            }
        }

        const changesByBatch = new Map<
            string,
            EditProductChanges["batches"][number]
        >();

        for (const batchChanges of changes.batches) {
            const batchKey = JSON.stringify([
                batchChanges.variantId,
                batchChanges.batchId
            ]);

            const matchingBatches = inventoryBatchesState.filter(
                (batch) => batch.batchId === batchChanges.batchId
            );
            const selectedVariant = currentProduct.variant.find(
                (variant) => variant.id === batchChanges.variantId
            );

            if (
                matchingBatches.length !== 1 ||
                matchingBatches[0].productId !== productId ||
                matchingBatches[0].variantId !== batchChanges.variantId ||
                !selectedVariant
            ) {
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
                batchChanges.expiryDate !== null &&
                (!(batchChanges.expiryDate instanceof Date) ||
                    Number.isNaN(batchChanges.expiryDate.getTime()))
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
        const nextInventoryBatches = inventoryBatchesState.map((batch) => {
            const batchChanges = batch.productId === productId
                ? changesByBatch.get(
                    JSON.stringify([batch.variantId, batch.batchId])
                )
                : undefined;

            if (!batchChanges) {
                return batch;
            }

            return {
                ...batch,
                batchNumber: batchChanges.batchNumber,
                expiryDate: batchChanges.expiryDate === null
                    ? null
                    : new Date(batchChanges.expiryDate)
            };
        }).filter((batch) => !deletionKeys.has(JSON.stringify([
            batch.productId,
            batch.variantId,
            batch.batchId
        ])));

        const nextInventory = inventoryState.filter((record) =>
            record.batchId === null ||
            !deletionKeys.has(JSON.stringify([
                record.productId,
                record.variantId,
                record.batchId
            ]))
        );
        const createdBatchIds = new Set<string>();
        const createdBatches: inventoryBatch[] = [];
        const createdInventoryRecords: inventory[] = [];
        for (const newBatch of changes.newBatches) {
            const productVariant = currentProduct.variant.find(
                (variant) => variant.id === newBatch.variantId
            );
            if (!productVariant || newBatch.batchId.trim() === "") {
                throw new Error("A new batch requires a valid variant and batch ID.");
            }
            if (
                inventoryBatchesState.some((batch) => batch.batchId === newBatch.batchId) ||
                createdBatchIds.has(newBatch.batchId)
            ) {
                throw new Error(`Duplicate batch ID: ${newBatch.batchId}`);
            }
            createdBatchIds.add(newBatch.batchId);
            if (
                newBatch.batchNumber !== null &&
                typeof newBatch.batchNumber !== "string"
            ) {
                throw new Error(`Invalid batch number for batch: ${newBatch.batchId}`);
            }
            if (
                newBatch.expiryDate !== null &&
                (!(newBatch.expiryDate instanceof Date) ||
                    Number.isNaN(newBatch.expiryDate.getTime()))
            ) {
                throw new Error(`Invalid expiry date for batch: ${newBatch.batchId}`);
            }
            const seenPackagingLevels = new Set<string>();
            for (const stock of newBatch.stockQuantities) {
                if (!productVariant.packagingHierarchy.some(
                    (level) => level.id === stock.packagingLevelId
                )) {
                    throw new Error(
                        `Packaging level not found: ${stock.packagingLevelId}`
                    );
                }
                if (
                    seenPackagingLevels.has(stock.packagingLevelId) ||
                    !Number.isSafeInteger(stock.quantity) ||
                    stock.quantity < 0
                ) {
                    throw new Error("New batch stock quantities must use unique packaging levels and non-negative whole numbers.");
                }
                seenPackagingLevels.add(stock.packagingLevelId);
            }
            const batch: inventoryBatch = {
                batchId: newBatch.batchId,
                productId,
                variantId: newBatch.variantId,
                batchNumber: newBatch.batchNumber,
                expiryDate: newBatch.expiryDate === null
                    ? null
                    : new Date(newBatch.expiryDate),
                pricingByPackagingLevel: []
            };
            const record = createInventory(
                productId,
                newBatch.variantId,
                newBatch.batchId,
                newBatch.stockQuantities
            );
            validateInventoryPackagingRelationships(currentProduct, record);
            createdBatches.push(batch);
            createdInventoryRecords.push(record);
            nextInventoryBatches.push(batch);
            nextInventory.push(record);
        }
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
                    currentProduct,
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

        const unbatchedResult = applyUnbatchedInventoryChanges(
            currentProduct,
            nextInventory,
            changes.unbatched,
            changes.reason,
            seenInventoryIds
        );
        newAdjustments.push(...unbatchedResult.adjustments);

        const activityEvents: ActivityEventInput[] = [];

        for (const deletion of changes.deletedBatches) {
            const batch = inventoryBatchesState.find(
                (candidate) =>
                    candidate.productId === productId &&
                    candidate.variantId === deletion.variantId &&
                    candidate.batchId === deletion.batchId
            );
            if (!batch) {
                throw new Error(`Batch not found: ${deletion.batchId}`);
            }
            activityEvents.push(
                buildBatchRemovalActivityInput(
                    changes.operationId,
                    currentProduct,
                    batch,
                    inventoryState,
                    inventoryBatchesState,
                    deletion.reason.trim()
                )
            );
        }

        for (let index = 0; index < createdBatches.length; index += 1) {
            const batch = createdBatches[index];
            const record = createdInventoryRecords[index];
            if (!batch || !record) {
                throw new Error("A new batch is missing its inventory snapshot.");
            }
            activityEvents.push(
                buildBatchCreatedActivityInput(
                    changes.operationId,
                    currentProduct,
                    batch,
                    record
                )
            );
        }

        for (const batchChanges of changes.batches) {
            const previousBatch = inventoryBatchesState.find(
                (batch) =>
                    batch.batchId === batchChanges.batchId &&
                    batch.productId === productId &&
                    batch.variantId === batchChanges.variantId
            );
            const updatedBatch = nextInventoryBatches.find(
                (batch) =>
                    batch.batchId === batchChanges.batchId &&
                    batch.productId === productId &&
                    batch.variantId === batchChanges.variantId
            );
            if (!previousBatch || !updatedBatch) {
                throw new Error(
                    `Batch not found for variant: ${batchChanges.variantId}, batch: ${batchChanges.batchId}`
                );
            }

            const batchUpdateEvent = buildBatchUpdatedActivityInput(
                changes.operationId,
                previousBatch,
                updatedBatch,
                currentProduct,
                changes.reason
            );
            if (batchUpdateEvent) {
                activityEvents.push(batchUpdateEvent);
            }
        }

        for (const adjustment of newAdjustments) {
            activityEvents.push(
                buildStockAdjustmentActivityInput(
                    adjustment,
                    currentProduct,
                    inventoryBatchesState,
                    changes.operationId
                )
            );
        }

        if (activityEvents.length > 0) {
            onInventoryCommit({
                inventoryRecords: unbatchedResult.updatedInventory.filter((record) =>
                    record.batchId === null ||
                    !deletionKeys.has(JSON.stringify([
                        record.productId,
                        record.variantId,
                        record.batchId
                    ]))
                ),
                inventoryBatches: nextInventoryBatches,
                activityEvents
            });
        }

        setEditingProductId(null);
        dismissInventoryNavigation();
    }

    function openVariant(variantId: string) {
        setSelectedVariantId(variantId);
    }

    function openInventoryEditor(productId: string) {
        const blockers = getProductDraftLockMessages(
            productId,
            saleDrafts,
            deliveryDrafts
        );
        if (blockers.length > 0) {
            setInventoryLockMessages(blockers);
            return;
        }
        setInventoryLockMessages([]);
        setEditingProductId(productId);
    }

    function openProductEditor(variantId: string) {
        if (!editingProduct?.variant.some((variant) => variant.id === variantId)) {
            throw new Error(`Variant not found: ${variantId}`);
        }
        setEditingProductId(null);
        dismissInventoryNavigation();
        onNavigate(createProductEditIntent(editingProduct.id, variantId));
    }

    function dismissInventoryNavigation() {
        if (inventoryNavigationIntent && navigationRequest) {
            onNavigationDismissed(navigationRequest.requestId);
        }
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

                <select
                    id="stock-filter"
                    onChange={(event) => {
                        if (isStockFilter(event.target.value)) {
                            setStockFilter(event.target.value);
                        }
                    }}
                    value={stockFilter}
                >
                    <option value="all">All stock</option>
                    <option value="in-stock">In stock</option>
                    <option value="low-stock">Low stock</option>
                    <option value="out-of-stock">Out of stock</option>
                </select>

            </div>

            {inventoryLockMessages.length > 0 && (
                <p role="alert">{inventoryLockMessages.join(" ")}</p>
            )}

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
                                        <ul className="product-card-stock-status">
                                            {product.variants.map((variant) => (
                                                <li key={variant.variantId}>
                                                    <span>{variant.variantName}</span>
                                                    <strong>
                                                        {describeVariantStockStatus(
                                                            variant.lowStockStatus
                                                        )}
                                                    </strong>
                                                </li>
                                            ))}
                                        </ul>
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
                                        onClick={() => openInventoryEditor(product.productId)}
                                    >
                                        Edit Stock
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
                                                        {variant.records.length === 0
                                                            ? <span>No stock recorded</span>
                                                            : displayStock(
                                                            variant.aggregatedStock.stockQuantities,
                                                            variant.aggregatedStock.packagingLevels
                                                        )}

                                                    </div>

                                                    <p className="variant-batch-count">
                                                        {describeStockGrouping(
                                                            variant.records,
                                                            variant.aggregatedStock.batchCount
                                                        )}
                                                    </p>
                                                    <p className="variant-stock-status">
                                                        {describeVariantStockStatus(
                                                            variant.lowStockStatus
                                                        )}
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
                                            {selectedVariant.records.length === 0
                                                ? <span>No stock recorded</span>
                                                : displayStock(
                                                selectedVariant.aggregatedStock.stockQuantities,
                                                selectedVariant.aggregatedStock.packagingLevels
                                            )}

                                        </div>

                                        <span className="variant-batch-count">
                                            {describeStockGrouping(
                                                selectedVariant.records,
                                                selectedVariant.aggregatedStock.batchCount
                                            )}
                                        </span>

                                    </div>

                                    <h3 className="modal-section-title">
                                        Stock records
                                    </h3>

                                    <div className="batch-card-list">

                                        {selectedVariant.records.map((record) => {
                                            const expiryDisplay = record.expiryDate
                                                ? getExpiryDisplay(record.expiryDate)
                                                : undefined;
                                            return (

                                                <article
                                                    className="batch-card"
                                                    key={record.inventoryId}
                                                >

                                                    <div className="batch-card-heading">

                                                        <strong>
                                                            {record.batchId === null
                                                                ? "No batch association"
                                                                : record.batchNumber ?? "No batch number"}
                                                        </strong>

                                                        {expiryDisplay && (
                                                            <span className={`expiry-display expiry-display--${expiryDisplay.colorCategory}`}>
                                                                <span>
                                                                    Expires: {expiryDisplay.dateLabel}
                                                                </span>
                                                                <span>
                                                                    {expiryDisplay.remainingLabel}
                                                                </span>
                                                            </span>
                                                        )}

                                                    </div>

                                                    <div className="batch-stock">

                                                        {displayStock(
                                                            record.stockQuantities,
                                                            record.packagingLevels
                                                        )}

                                                    </div>

                                                </article>

                                            );
                                        })}

                                        {selectedVariantBatches
                                            .filter((batch) => !selectedVariant.records.some(
                                                (record) => record.batchId === batch.batchId
                                            ))
                                            .map((batch) => {
                                                const expiryDisplay = batch.expiryDate
                                                    ? getExpiryDisplay(batch.expiryDate)
                                                    : undefined;
                                                return (
                                                    <article className="batch-card" key={batch.batchId}>
                                                        <div className="batch-card-heading">
                                                            <strong>{batch.batchNumber ?? "Batch number not set"}</strong>
                                                            {expiryDisplay && (
                                                                <span className={`expiry-display expiry-display--${expiryDisplay.colorCategory}`}>
                                                                    <span>
                                                                        Expires: {expiryDisplay.dateLabel}
                                                                    </span>
                                                                    <span>
                                                                        {expiryDisplay.remainingLabel}
                                                                    </span>
                                                                </span>
                                                            )}
                                                        </div>
                                                        <p>No inventory record is associated with this batch.</p>
                                                    </article>
                                                );
                                            })}

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
                    batches={inventoryBatchesState}
                    inventoryRecords={editingInventoryRecords}
                    initialVariantId={
                        inventoryNavigationTarget?.inventoryRecord.variantId ?? null
                    }
                    initialInventoryId={
                        inventoryNavigationTarget?.inventoryRecord.id ?? null
                    }
                    initialBatchId={
                        inventoryNavigationTarget?.inventoryRecord.batchId ?? null
                    }
                    onEditProductDetails={openProductEditor}
                    onClose={() => {
                        dismissInventoryNavigation();
                        setEditingProductId(null);
                    }}
                    onSave={handleSaveInventoryChanges}
                    draftLockMessages={getProductDraftLockMessages(
                        editingProduct.id,
                        saleDrafts,
                        deliveryDrafts
                    )}
                />
            )}

        </section>
    );
}
