import { useId, useState } from "react";
import type { productStructure } from "../../../products/productStructure";
import type { inventoryBatch } from "../../../inventory/inventoryBatch";
import type { inventoryDisplay } from "../../../inventory/inventoryLookup";
import type { unbatchedInventoryChange } from "../../../inventory/inventoryAdjustment";
import "./EditProductModal.css";

interface StockQuantityDraft {
    packagingLevelId: string;
    quantity: string;
}

interface BatchDraft {
    variantId: string;
    batchId: string;
    isNew: boolean;
    isConversion: boolean;
    batchNumber: string;
    expiryDate: string;
    inventoryId: string | null;
    stockQuantities: StockQuantityDraft[];
}

type UnbatchedDraft = Omit<unbatchedInventoryChange, "stockQuantities"> & {
    stockQuantities: StockQuantityDraft[];
};

export interface EditProductChanges {
    operationId: string;
    reason: string;
    deletedBatches: {
        variantId: string;
        batchId: string;
        reason: string;
    }[];
    batches: {
        variantId: string;
        batchId: string;
        batchNumber: string | null;
        expiryDate: Date | null;
        inventoryId: string | null;
        stockQuantities: {
            packagingLevelId: string;
            quantity: number;
        }[];
    }[];
    newBatches: {
        variantId: string;
        batchId: string;
        batchNumber: string | null;
        expiryDate: Date | null;
        sourceUnbatchedInventoryId: string | null;
        stockQuantities: {
            packagingLevelId: string;
            quantity: number;
        }[];
    }[];
    unbatched: unbatchedInventoryChange[];
}

interface EditProductModalProps {
    product: productStructure;
    batches: inventoryBatch[];
    inventoryRecords: inventoryDisplay[];
    initialVariantId?: string | null;
    initialInventoryId?: string | null;
    initialBatchId?: string | null;
    onEditProductDetails: (variantId: string) => void;
    onClose: () => void;
    onSave: (changes: EditProductChanges) => void;
    draftLockMessages?: string[];
}

function formatDateForInput(date: Date | null): string {
    if (date === null) {
        return "";
    }

    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

export default function EditProductModal({
    product,
    batches,
    inventoryRecords,
    initialVariantId = null,
    initialInventoryId = null,
    initialBatchId = null,
    onEditProductDetails,
    onClose,
    onSave,
    draftLockMessages = []
}: EditProductModalProps) {

    const modalId = useId();
    const isDraftLocked = draftLockMessages.length > 0;
    const [reason, setReason] = useState("");
    const [saveError, setSaveError] = useState<string | null>(null);
    const [pendingBatchDeletion, setPendingBatchDeletion] = useState<string | null>(null);
    const [stagedBatchDeletions, setStagedBatchDeletions] = useState<Array<{
        id: string;
        variantId: string;
        batchId: string;
    }>>([]);

    const [batchDrafts, setBatchDrafts] = useState<BatchDraft[]>(() =>
        product.variant.flatMap((variant) =>
            batches
                .filter(
                    (batch) =>
                        batch.productId === product.id &&
                        batch.variantId === variant.id
                )
                .sort((first, second) =>
                    first.batchId === initialBatchId
                        ? -1
                        : second.batchId === initialBatchId
                            ? 1
                            : 0
                )
                .map((batch) => {

                const matchingInventory = inventoryRecords.find(
                    (record) =>
                        (batch.batchId !== initialBatchId ||
                            initialInventoryId === null ||
                            record.inventoryId === initialInventoryId) &&
                        record.productId === product.id &&
                        record.variantId === variant.id &&
                        record.batchId === batch.batchId
                );

                return {
                    variantId: variant.id,
                    batchId: batch.batchId,
                    isNew: false,
                    isConversion: false,
                    batchNumber: batch.batchNumber ?? "",
                    expiryDate: formatDateForInput(batch.expiryDate),
                    inventoryId: matchingInventory?.inventoryId ?? null,
                    stockQuantities:
                        matchingInventory?.stockQuantities.map((stock) => ({
                            packagingLevelId: stock.packagingLevelId,
                            quantity: String(stock.quantity)
                        })) ?? []
                };
            })
        )
    );

    const [unbatchedDrafts, setUnbatchedDrafts] =
        useState<UnbatchedDraft[]>(() =>
            inventoryRecords
                .filter(
                    (record) =>
                        record.productId === product.id &&
                        record.batchId === null &&
                        product.variant.some(
                            (variant) => variant.id === record.variantId
                        )
                )
                .map((record) => ({
                    inventoryId: record.inventoryId,
                    variantId: record.variantId,
                    stockQuantities: record.stockQuantities.map((stock) => ({
                        packagingLevelId: stock.packagingLevelId,
                        quantity: String(stock.quantity)
                    }))
                }))
                .sort((first, second) =>
                    first.inventoryId === initialInventoryId
                        ? -1
                        : second.inventoryId === initialInventoryId
                            ? 1
                            : 0
                )
        );

    function updateBatchDraft(
        variantId: string,
        batchId: string,
        field: "batchNumber" | "expiryDate",
        value: string
    ) {
        setSaveError(null);
        setBatchDrafts((currentDrafts) =>
            currentDrafts.map((draft) =>
                draft.variantId === variantId && draft.batchId === batchId
                    ? { ...draft, [field]: value }
                    : draft
            )
        );
    }

    function addBatch(variantId: string) {
        const productVariant = product.variant.find(
            (candidate) => candidate.id === variantId
        );
        if (!productVariant || productVariant.packagingHierarchy.length === 0) {
            setSaveError("Add a packaging level to this variant before creating a batch.");
            return;
        }
        if (batchDrafts.some((draft) =>
            draft.variantId === variantId && draft.isConversion
        )) {
            setSaveError("Save the unbatched-stock conversion before adding another batch.");
            return;
        }

        const unbatchedRecord = inventoryRecords.find((record) =>
            record.productId === product.id &&
            record.variantId === variantId &&
            record.batchId === null
        );
        if (unbatchedRecord) {
            const unbatchedDraft = unbatchedDrafts.find(
                (draft) => draft.inventoryId === unbatchedRecord.inventoryId
            );
            if (!unbatchedDraft) {
                setSaveError("The unbatched inventory record is no longer available.");
                return;
            }

            const stockIsUnchanged =
                unbatchedDraft.stockQuantities.length ===
                    unbatchedRecord.stockQuantities.length &&
                unbatchedRecord.stockQuantities.every((stock) => {
                    const draftStock = unbatchedDraft.stockQuantities.find(
                        (candidate) =>
                            candidate.packagingLevelId === stock.packagingLevelId
                    );
                    return draftStock !== undefined &&
                        draftStock.quantity.trim() !== "" &&
                        Number(draftStock.quantity) === stock.quantity;
                });
            if (!stockIsUnchanged) {
                setSaveError(
                    "Save the unbatched stock adjustment before converting it to a batch."
                );
                return;
            }

            setSaveError(null);
            setBatchDrafts((currentDrafts) => [
                ...currentDrafts,
                {
                    variantId,
                    batchId: `batch-${crypto.randomUUID()}`,
                    isNew: true,
                    isConversion: true,
                    batchNumber: "",
                    expiryDate: "",
                    inventoryId: unbatchedRecord.inventoryId,
                    stockQuantities: unbatchedRecord.stockQuantities.map((stock) => ({
                        packagingLevelId: stock.packagingLevelId,
                        quantity: String(stock.quantity)
                    }))
                }
            ]);
            setUnbatchedDrafts((currentDrafts) =>
                currentDrafts.filter(
                    (draft) => draft.inventoryId !== unbatchedRecord.inventoryId
                )
            );
            return;
        }

        setSaveError(null);
        setBatchDrafts((currentDrafts) => [
            ...currentDrafts,
            {
                variantId,
                batchId: `batch-${crypto.randomUUID()}`,
                isNew: true,
                isConversion: false,
                batchNumber: "",
                expiryDate: "",
                inventoryId: null,
                stockQuantities: productVariant.packagingHierarchy.map((level) => ({
                    packagingLevelId: level.id,
                    quantity: "0"
                }))
            }
        ]);
    }

    function updateStockQuantity(
        variantId: string,
        batchId: string,
        packagingLevelId: string,
        value: string
    ) {
        setSaveError(null);
        setBatchDrafts((currentDrafts) =>
            currentDrafts.map((draft) => {
                if (draft.variantId !== variantId || draft.batchId !== batchId) {
                    return draft;
                }
                if (draft.isConversion) {
                    return draft;
                }

                return {
                    ...draft,
                    stockQuantities: draft.stockQuantities.map((stock) =>
                        stock.packagingLevelId === packagingLevelId
                            ? { ...stock, quantity: value }
                            : stock
                    )
                };
            })
        );
    }

    function updateUnbatchedStockQuantity(
        inventoryId: string,
        packagingLevelId: string,
        value: string
    ) {
        setSaveError(null);
        setUnbatchedDrafts((currentDrafts) =>
            currentDrafts.map((draft) =>
                draft.inventoryId === inventoryId
                    ? {
                        ...draft,
                        stockQuantities: draft.stockQuantities.map((stock) =>
                            stock.packagingLevelId === packagingLevelId
                                ? { ...stock, quantity: value }
                                : stock
                        )
                    }
                    : draft
            )
        );
    }

    const activeBatchDrafts = batchDrafts.filter((draft) =>
        !stagedBatchDeletions.some((deletion) =>
            deletion.variantId === draft.variantId &&
            deletion.batchId === draft.batchId
        )
    );
    const validStockQuantities =
        [...activeBatchDrafts, ...unbatchedDrafts].every((draft) =>
            draft.stockQuantities.every((stock) => {
                if (stock.quantity.trim() === "") {
                    return false;
                }

                const quantity = Number(stock.quantity);

                return Number.isSafeInteger(quantity) && quantity >= 0;
            })
        );

    const validDates = activeBatchDrafts.every((batch) => {
        if (!batch.expiryDate) {
            return true;
        }

        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(batch.expiryDate);
        if (!match) {
            return false;
        }

        const [, yearText, monthText, dayText] = match;
        const parsedDate = new Date(
            `${batch.expiryDate}T00:00:00.000Z`
        );
        return !Number.isNaN(parsedDate.getTime()) &&
            parsedDate.getUTCFullYear() === Number(yearText) &&
            parsedDate.getUTCMonth() + 1 === Number(monthText) &&
            parsedDate.getUTCDate() === Number(dayText);
    });
    const validBatchNumbers = true;

    const canSave =
        reason.trim().length > 0 &&
        validStockQuantities &&
        validDates &&
        validBatchNumbers;

    const unbatchedDraftsByVariant = new Map<string, UnbatchedDraft[]>();
    for (const draft of unbatchedDrafts) {
        const variantDrafts =
            unbatchedDraftsByVariant.get(draft.variantId) ?? [];
        variantDrafts.push(draft);
        unbatchedDraftsByVariant.set(draft.variantId, variantDrafts);
    }
    const orderedVariants = initialVariantId
        ? [...product.variant].sort((first, second) =>
            first.id === initialVariantId
                ? -1
                : second.id === initialVariantId
                    ? 1
                    : 0
        )
        : product.variant;

    function handleSave() {
        if (!canSave) {
            return;
        }

        const changes: EditProductChanges = {
            operationId: crypto.randomUUID(),
            reason: reason.trim(),
            deletedBatches: stagedBatchDeletions.map((deletion) => ({
                variantId: deletion.variantId,
                batchId: deletion.batchId,
                reason: reason.trim()
            })),

            batches: batchDrafts
                .filter((batch) =>
                    !batch.isNew &&
                    !stagedBatchDeletions.some(
                        (deletion) => deletion.batchId === batch.batchId
                    )
                )
                .map((batch) => ({
                variantId: batch.variantId,
                batchId: batch.batchId,
                batchNumber: batch.batchNumber.trim() || null,
                expiryDate: batch.expiryDate
                    ? new Date(`${batch.expiryDate}T00:00:00.000Z`)
                    : null,
                inventoryId: batch.inventoryId,
                stockQuantities: batch.stockQuantities.map((stock) => ({
                    packagingLevelId: stock.packagingLevelId,
                    quantity: Number(stock.quantity)
                }))
                })),
            newBatches: batchDrafts
                .filter((batch) =>
                    batch.isNew &&
                    !stagedBatchDeletions.some(
                        (deletion) => deletion.batchId === batch.batchId
                    )
                )
                .map((batch) => ({
                    variantId: batch.variantId,
                    batchId: batch.batchId,
                    batchNumber: batch.batchNumber.trim() || null,
                    expiryDate: batch.expiryDate
                        ? new Date(`${batch.expiryDate}T00:00:00.000Z`)
                        : null,
                    sourceUnbatchedInventoryId: batch.isConversion
                        ? batch.inventoryId
                        : null,
                    stockQuantities: batch.stockQuantities.map((stock) => ({
                        packagingLevelId: stock.packagingLevelId,
                        quantity: Number(stock.quantity)
                    }))
                })),
            unbatched: unbatchedDrafts.map((draft) => ({
                inventoryId: draft.inventoryId,
                variantId: draft.variantId,
                stockQuantities: draft.stockQuantities.map((stock) => ({
                    packagingLevelId: stock.packagingLevelId,
                    quantity: Number(stock.quantity)
                }))
            }))
        };

        try {
            onSave(changes);
        } catch (error) {
            setSaveError(
                error instanceof Error
                    ? error.message
                    : "Unable to save inventory changes."
            );
        }
    }

    function requestBatchDeletion(batch: BatchDraft) {
        if (isDraftLocked) {
            setSaveError(draftLockMessages.join(" "));
            return;
        }
        setPendingBatchDeletion(batch.batchId);
        setSaveError(null);
    }

    function confirmBatchDeletion() {
        const batchId = pendingBatchDeletion;
        if (!batchId) {
            return;
        }
        if (isDraftLocked) {
            setPendingBatchDeletion(null);
            setSaveError(draftLockMessages.join(" "));
            return;
        }
        const batch = batchDrafts.find(
            (draft) => draft.batchId === batchId && !draft.isNew
        );
        if (!batch) {
            setPendingBatchDeletion(null);
            setSaveError("The batch is no longer available for deletion.");
            return;
        }
        if (!stagedBatchDeletions.some((deletion) =>
            deletion.variantId === batch.variantId &&
            deletion.batchId === batch.batchId
        )) {
            setStagedBatchDeletions((current) => [
                ...current,
                {
                    id: crypto.randomUUID(),
                    variantId: batch.variantId,
                    batchId: batch.batchId
                }
            ]);
        }
        setPendingBatchDeletion(null);
    }

    return (
        <div
            className="edit-modal-overlay"
            onClick={(event) => {
                if (event.target === event.currentTarget) {
                    onClose();
                }
            }}
        >
            <section
                className="edit-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="edit-modal-title"
            >

                <header className="edit-modal-header">
                    <div>
                        <h2 id="edit-modal-title">Edit Inventory</h2>
                        <p>{product.name}</p>
                    </div>

                    <button
                        className="edit-modal-close"
                        type="button"
                        onClick={onClose}
                        aria-label="Close edit modal"
                    >
                        &times;
                    </button>
                </header>

                <section className="edit-product-section edit-reason-section">
                    <h3>Reason for changes</h3>

                    <div className="edit-field">
                        <label
                            className="edit-reason-label"
                            htmlFor="edit-reason"
                        >
                            Why are you making these changes?
                        </label>

                        <textarea
                            id="edit-reason"
                            value={reason}
                            onChange={(event) => {
                                setSaveError(null);
                                setReason(event.target.value);
                            }}
                            placeholder="Enter the reason for these changes..."
                            rows={3}
                        />
                    </div>
                </section>

                <div className="edit-modal-content">
                    <section className="edit-product-section">
                        <h3>Product Information</h3>

                        <div className="edit-readonly-field">
                            <label>Product name</label>
                            <p>{product.name}</p>
                        </div>
                    </section>

                    <section className="edit-product-section">
                        <h3>Variants and Inventory</h3>
                        {isDraftLocked && (
                            <p role="alert">
                                {draftLockMessages.join(" ")}
                            </p>
                        )}
                        {stagedBatchDeletions.length > 0 && (
                            <section aria-label="Staged batch deletions">
                                <h4>Staged batch deletions</h4>
                                {stagedBatchDeletions.map((deletion) => {
                                    const batch = batches.find(
                                        (candidate) =>
                                            candidate.batchId === deletion.batchId &&
                                            candidate.variantId === deletion.variantId
                                    );
                                    const variant = product.variant.find(
                                        (candidate) => candidate.id === deletion.variantId
                                    );
                                    const label =
                                        `${variant?.variantName ?? "Variant"} / ${batch?.batchNumber ?? "Batch number not set"}`;
                                    return (
                                        <p key={deletion.id}>
                                            {label} will be deleted when you save these changes.
                                        </p>
                                    );
                                })}
                                <p>
                                    The reason above will be recorded for each staged deletion.
                                </p>
                            </section>
                        )}

                        {orderedVariants.map((variant) => (
                            <div
                                className="edit-variant-section"
                                key={variant.id}
                            >
                                <div className="edit-variant-heading">
                                    <h4>{variant.variantName}</h4>
                                    <span>Read only</span>
                                    <button
                                        className="secondary-button"
                                        onClick={() => addBatch(variant.id)}
                                        disabled={
                                            isDraftLocked ||
                                            batchDrafts.some((draft) =>
                                                draft.variantId === variant.id &&
                                                draft.isConversion
                                            )
                                        }
                                        type="button"
                                    >
                                        Add batch
                                    </button>
                                    <button
                                        className="secondary-button"
                                        onClick={() => onEditProductDetails(variant.id)}
                                        type="button"
                                    >
                                        Edit Product Details
                                    </button>
                                </div>

                                {activeBatchDrafts
                                    .filter((draft) => draft.variantId === variant.id)
                                    .map((draft) => {
                                    const batch = batches.find(
                                        (candidate) =>
                                            candidate.productId === product.id &&
                                            candidate.variantId === variant.id &&
                                            candidate.batchId === draft.batchId
                                    );
                                    if (!draft.isNew && !batch) {
                                        return null;
                                    }

                                    const matchingInventory =
                                        inventoryRecords.find(
                                            (record) =>
                                                (draft.inventoryId === null ||
                                                    record.inventoryId === draft.inventoryId) &&
                                                record.productId === product.id &&
                                                record.batchId === draft.batchId &&
                                                record.variantId === variant.id
                                        );

                                    return (
                                        <article
                                            className="edit-batch-card"
                                            key={draft.batchId}
                                        >

                                            <div className="edit-batch-heading">
                                                <h5>Batch information</h5>
                                                {!draft.isNew && (
                                                    <button
                                                        className="product-delete-button"
                                                        disabled={
                                                            isDraftLocked ||
                                                            stagedBatchDeletions.some(
                                                                (deletion) =>
                                                                    deletion.batchId === draft.batchId
                                                            )
                                                        }
                                                        onClick={() => requestBatchDeletion(draft)}
                                                        type="button"
                                                    >
                                                        {stagedBatchDeletions.some(
                                                            (deletion) =>
                                                                deletion.batchId === draft.batchId
                                                        ) ? "Deletion staged" : "Delete Batch"}
                                                    </button>
                                                )}
                                            </div>

                                            <div className="edit-batch-fields">

                                                <div className="edit-field">
                                                    <label
                                                        htmlFor={`batch-number-${modalId}-${encodeURIComponent(variant.id)}-${encodeURIComponent(draft.batchId)}`}
                                                    >
                                                        Batch number
                                                    </label>

                                                    <input
                                                        id={`batch-number-${modalId}-${encodeURIComponent(variant.id)}-${encodeURIComponent(draft.batchId)}`}
                                                        disabled={isDraftLocked}
                                                        type="text"
                                                        value={draft.batchNumber}
                                                        placeholder="Enter batch number"
                                                        onChange={(event) =>
                                                            updateBatchDraft(
                                                                variant.id,
                                                                draft.batchId,
                                                                "batchNumber",
                                                                event.target.value
                                                            )
                                                        }
                                                    />
                                                </div>

                                                <div className="edit-field">
                                                    <label
                                                        htmlFor={`expiry-${modalId}-${encodeURIComponent(variant.id)}-${encodeURIComponent(draft.batchId)}`}
                                                    >
                                                        Expiry date
                                                    </label>

                                                    <input
                                                        id={`expiry-${modalId}-${encodeURIComponent(variant.id)}-${encodeURIComponent(draft.batchId)}`}
                                                        disabled={isDraftLocked}
                                                        type="date"
                                                        value={draft.expiryDate}
                                                        onChange={(event) =>
                                                            updateBatchDraft(
                                                                variant.id,
                                                                draft.batchId,
                                                                "expiryDate",
                                                                event.target.value
                                                            )
                                                        }
                                                    />
                                                </div>

                                            </div>

                                            <div className="edit-stock-section">
                                                <h5>Stock quantities</h5>
                                                {draft.isConversion && (
                                                    <p>
                                                        Existing unbatched stock will move into this batch without changing its quantities.
                                                    </p>
                                                )}

                                                {matchingInventory || draft.isNew ? (

                                                    draft.stockQuantities.map(
                                                        (stock) => {
                                                                const packagingLevel =
                                                                    variant.packagingHierarchy.find(
                                                                        (level) =>
                                                                            level.id === stock.packagingLevelId
                                                                    );

                                                            return (
                                                                <div
                                                                    className="edit-stock-row"
                                                                    key={stock.packagingLevelId}
                                                                >
                                                                    <label
                                                                        htmlFor={`stock-${modalId}-${encodeURIComponent(variant.id)}-${encodeURIComponent(draft.batchId)}-${encodeURIComponent(stock.packagingLevelId)}`}
                                                                    >
                                                                        {packagingLevel?.name ?? "Unknown packaging"}
                                                                    </label>

                                                                    <input
                                                                        id={`stock-${modalId}-${encodeURIComponent(variant.id)}-${encodeURIComponent(draft.batchId)}-${encodeURIComponent(stock.packagingLevelId)}`}
                                                                        disabled={isDraftLocked}
                                                                        type="number"
                                                                        min="0"
                                                                        step="1"
                                                                        readOnly={draft.isConversion}
                                                                        value={stock.quantity}
                                                                        onChange={(event) =>
                                                                            updateStockQuantity(
                                                                                variant.id,
                                                                                draft.batchId,
                                                                                stock.packagingLevelId,
                                                                                event.target.value
                                                                            )
                                                                        }
                                                                    />
                                                                </div>
                                                            );
                                                        }
                                                    )

                                                ) : (
                                                    <p className="edit-no-stock">
                                                        No inventory record found for this batch.
                                                    </p>
                                                )}

                                            </div>

                                        </article>
                                    );
                                    })}

                                {(unbatchedDraftsByVariant.get(variant.id) ?? []).length > 0 && (
                                    <section
                                        className="edit-stock-section"
                                        aria-label="Unbatched Inventory"
                                    >
                                        <h5>Unbatched Inventory</h5>

                                        {(unbatchedDraftsByVariant.get(variant.id) ?? [])
                                            .map((draft) => {
                                                const matchingInventory =
                                                    inventoryRecords.find(
                                                        (record) =>
                                                            record.inventoryId === draft.inventoryId &&
                                                            record.productId === product.id &&
                                                            record.variantId === variant.id &&
                                                            record.batchId === null
                                                    );

                                                if (!matchingInventory) {
                                                    return null;
                                                }

                                                return (
                                                    <div key={draft.inventoryId}>
                                                        {draft.stockQuantities.map((stock) => {
                                                            const packagingLevel =
                                                                matchingInventory.packagingLevels.find(
                                                                    (level) =>
                                                                        level.id === stock.packagingLevelId
                                                                );
                                                            const inputId =
                                                                `unbatched-stock-${modalId}-${encodeURIComponent(draft.inventoryId)}-${encodeURIComponent(stock.packagingLevelId)}`;

                                                            return (
                                                                <div
                                                                    className="edit-stock-row"
                                                                    key={stock.packagingLevelId}
                                                                >
                                                                    <label htmlFor={inputId}>
                                                                        {packagingLevel?.name ?? "Unknown packaging"}
                                                                    </label>
                                                                    <input
                                                                        id={inputId}
                                                                        disabled={isDraftLocked}
                                                                        type="number"
                                                                        min="0"
                                                                        step="1"
                                                                        value={stock.quantity}
                                                                        onChange={(event) =>
                                                                            updateUnbatchedStockQuantity(
                                                                                draft.inventoryId,
                                                                                stock.packagingLevelId,
                                                                                event.target.value
                                                                            )
                                                                        }
                                                                    />
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                );
                                            })}
                                    </section>
                                )}
                            </div>
                        ))}
                    </section>

                    {saveError && (
                        <p role="alert">{saveError}</p>
                    )}

                </div>

                <footer className="edit-modal-footer">
                    <button
                        className="edit-cancel-button"
                        type="button"
                        onClick={onClose}
                    >
                        Cancel
                    </button>

                    <button
                        className="edit-save-button"
                        type="button"
                        disabled={!canSave || isDraftLocked}
                        onClick={handleSave}
                    >
                        Save Changes
                    </button>
                </footer>
            </section>
            {pendingBatchDeletion && (
                <div className="inventory-modal-overlay">
                    <section
                        aria-labelledby="inventory-batch-deletion-title"
                        aria-modal="true"
                        className="inventory-modal"
                        role="alertdialog"
                    >
                        <header className="inventory-modal-header">
                            <h2 id="inventory-batch-deletion-title">Delete batch?</h2>
                        </header>
                        <div className="inventory-modal-content">
                            <p>
                                {(() => {
                                    const batch = batches.find(
                                        (candidate) =>
                                            candidate.batchId === pendingBatchDeletion &&
                                            candidate.productId === product.id
                                    );
                                    return `Confirm deleting ${batch?.batchNumber ?? "this batch"}? Its batch and associated stock will only be removed when you save these changes.`;
                                })()}
                            </p>
                            {isDraftLocked && (
                                <p role="alert">{draftLockMessages.join(" ")}</p>
                            )}
                            <div className="product-deletion-actions">
                                <button
                                    className="secondary-button"
                                    onClick={() => setPendingBatchDeletion(null)}
                                    type="button"
                                >
                                    Cancel
                                </button>
                                <button
                                    className="product-delete-button"
                                    disabled={isDraftLocked}
                                    onClick={confirmBatchDeletion}
                                    type="button"
                                >
                                    Confirm Delete
                                </button>
                            </div>
                        </div>
                    </section>
                </div>
            )}
        </div>
    );
}