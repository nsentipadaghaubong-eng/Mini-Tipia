import { useId, useState } from "react";
import type { productStructure } from "../../../products/productStructure";
import type { inventoryDisplay } from "../../../inventory/inventoryLookup";
import "./EditProductModal.css";

interface StockQuantityDraft {
    packagingLevelId: string;
    quantity: string;
}

interface BatchDraft {
    variantId: string;
    batchId: string;
    batchNumber: string;
    expiryDate: string;
    inventoryId: string | null;
    stockQuantities: StockQuantityDraft[];
}

export interface EditProductChanges {
    reason: string;
    batches: {
        variantId: string;
        batchId: string;
        batchNumber: string | null;
        expiryDate: Date;
        inventoryId: string | null;
        stockQuantities: {
            packagingLevelId: string;
            quantity: number;
        }[];
    }[];
}

interface EditProductModalProps {
    product: productStructure;
    inventoryRecords: inventoryDisplay[];
    onClose: () => void;
    onSave: (changes: EditProductChanges) => void;
}

function formatDateForInput(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

export default function EditProductModal({
    product,
    inventoryRecords,
    onClose,
    onSave
}: EditProductModalProps) {

    const modalId = useId();
    const [reason, setReason] = useState("");
    const [saveError, setSaveError] = useState<string | null>(null);

    const [batchDrafts, setBatchDrafts] = useState<BatchDraft[]>(() =>
        product.variant.flatMap((variant) =>
            variant.batches.map((batch) => {

                const matchingInventory = inventoryRecords.find(
                    (record) =>
                        record.variantId === variant.id &&
                        record.batchId === batch.batchId
                );

                return {
                    variantId: variant.id,
                    batchId: batch.batchId,
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

    const validStockQuantities = batchDrafts.every((batch) =>
        batch.stockQuantities.every((stock) => {
            if (stock.quantity.trim() === "") {
                return false;
            }

            const quantity = Number(stock.quantity);

            return Number.isSafeInteger(quantity) && quantity >= 0;
        })
    );

    const validDates = batchDrafts.every((batch) => {
        if (!batch.expiryDate) {
            return false;
        }

        const parsedDate = new Date(`${batch.expiryDate}T00:00:00`);
        return (
            !Number.isNaN(parsedDate.getTime()) &&
            formatDateForInput(parsedDate) === batch.expiryDate
        );
    });

    const canSave =
        reason.trim().length > 0 &&
        validStockQuantities &&
        validDates;

    function handleSave() {
        if (!canSave) {
            return;
        }

        const changes: EditProductChanges = {
            reason: reason.trim(),

            batches: batchDrafts.map((batch) => ({
                variantId: batch.variantId,
                batchId: batch.batchId,
                batchNumber: batch.batchNumber.trim() || null,
                expiryDate: new Date(`${batch.expiryDate}T00:00:00`),
                inventoryId: batch.inventoryId,
                stockQuantities: batch.stockQuantities.map((stock) => ({
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

                <div className="edit-modal-content">

                    <section className="edit-product-section">
                        <h3>Product Information</h3>

                        <div className="edit-readonly-field">
                            <label>Product name</label>
                            <p>{product.name}</p>
                        </div>
                    </section>

                    <section className="edit-product-section">
                        <h3>Variants and Batches</h3>

                        {product.variant.map((variant) => (
                            <div
                                className="edit-variant-section"
                                key={variant.id}
                            >
                                <div className="edit-variant-heading">
                                    <h4>{variant.variantName}</h4>
                                    <span>Read only</span>
                                </div>

                                {variant.batches.map((batch) => {

                                    const draft = batchDrafts.find(
                                        (item) =>
                                            item.variantId === variant.id &&
                                            item.batchId === batch.batchId
                                    );

                                    const matchingInventory =
                                        inventoryRecords.find(
                                            (record) =>
                                                record.batchId === batch.batchId &&
                                                record.variantId === variant.id
                                        );

                                    if (!draft) {
                                        return null;
                                    }

                                    return (
                                        <article
                                            className="edit-batch-card"
                                            key={batch.batchId}
                                        >

                                            <div className="edit-batch-heading">
                                                <h5>Batch information</h5>
                                            </div>

                                            <div className="edit-batch-fields">

                                                <div className="edit-field">
                                                    <label
                                                        htmlFor={`batch-number-${modalId}-${encodeURIComponent(variant.id)}-${encodeURIComponent(batch.batchId)}`}
                                                    >
                                                        Batch number
                                                    </label>

                                                    <input
                                                        id={`batch-number-${modalId}-${encodeURIComponent(variant.id)}-${encodeURIComponent(batch.batchId)}`}
                                                        type="text"
                                                        value={draft.batchNumber}
                                                        placeholder="Enter batch number"
                                                        onChange={(event) =>
                                                            updateBatchDraft(
                                                                variant.id,
                                                                batch.batchId,
                                                                "batchNumber",
                                                                event.target.value
                                                            )
                                                        }
                                                    />
                                                </div>

                                                <div className="edit-field">
                                                    <label
                                                        htmlFor={`expiry-${modalId}-${encodeURIComponent(variant.id)}-${encodeURIComponent(batch.batchId)}`}
                                                    >
                                                        Expiry date
                                                    </label>

                                                    <input
                                                        id={`expiry-${modalId}-${encodeURIComponent(variant.id)}-${encodeURIComponent(batch.batchId)}`}
                                                        type="date"
                                                        value={draft.expiryDate}
                                                        onChange={(event) =>
                                                            updateBatchDraft(
                                                                variant.id,
                                                                batch.batchId,
                                                                "expiryDate",
                                                                event.target.value
                                                            )
                                                        }
                                                    />
                                                </div>

                                            </div>

                                            <div className="edit-stock-section">
                                                <h5>Stock quantities</h5>

                                                {matchingInventory ? (

                                                    draft.stockQuantities.map(
                                                        (stock) => {
                                                            const packagingLevel =
                                                                matchingInventory.packagingLevels.find(
                                                                    (level) =>
                                                                        level.id === stock.packagingLevelId
                                                                );

                                                            return (
                                                                <div
                                                                    className="edit-stock-row"
                                                                    key={stock.packagingLevelId}
                                                                >
                                                                    <label
                                                                        htmlFor={`stock-${modalId}-${encodeURIComponent(variant.id)}-${encodeURIComponent(batch.batchId)}-${encodeURIComponent(stock.packagingLevelId)}`}
                                                                    >
                                                                        {packagingLevel?.name ?? "Unknown packaging"}
                                                                    </label>

                                                                    <input
                                                                        id={`stock-${modalId}-${encodeURIComponent(variant.id)}-${encodeURIComponent(batch.batchId)}-${encodeURIComponent(stock.packagingLevelId)}`}
                                                                        type="number"
                                                                        min="0"
                                                                        step="1"
                                                                        value={stock.quantity}
                                                                        onChange={(event) =>
                                                                            updateStockQuantity(
                                                                                variant.id,
                                                                                batch.batchId,
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
                            </div>
                        ))}
                    </section>

                    <section className="edit-product-section">
                        <h3>Reason for changes</h3>

                        <div className="edit-field">
                            <label htmlFor="edit-reason">
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
                        disabled={!canSave}
                        onClick={handleSave}
                    >
                        Save Changes
                    </button>
                </footer>

            </section>
        </div>
    );
}