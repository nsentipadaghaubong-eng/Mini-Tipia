import { useState } from "react";
import type { inventory } from "../../../inventory/inventoryStock";
import type { inventoryBatch } from "../../../inventory/inventoryBatch";
import { getInventoryDisplay } from "../../../inventory/inventoryLookup";
import type { productStructure, variant } from "../../../products/productStructure";
import { getInventoryBatchById } from "../../../inventory/inventoryBatch";
import { prepareSaleDraft } from "../../../sales/salesEngine";
import type { SaleDraft } from "../../../sales/salesDraft";
import {
    recommendInventoryByFefo,
    resolveDefaultSellingPrice
} from "../../../sales/salesEngine";
import type { SaleDraftItem } from "../../../sales/salesDraft";
import {
    calculateSaleLineAmounts,
    getAvailableQuantity
} from "../pages/salesProductSelection";
import "./SalesItemModal.css";

interface SalesItemModalProps {
    product: productStructure;
    variant: variant;
    products: productStructure[];
    inventoryRecords: inventory[];
    inventoryBatches: inventoryBatch[];
    currentDraft?: SaleDraft;
    initialItem?: SaleDraftItem;
    onSave: (item: SaleDraftItem) => void;
    onClose: () => void;
}

function percentageFromItem(item: SaleDraftItem | undefined): string {
    if (!item) {
        return "0";
    }
    const subtotal = item.appliedSellingPrice * item.quantity;
    return subtotal === 0
        ? "0"
        : String((item.discountAmount / subtotal) * 100);
}

export default function SalesItemModal({
    product,
    variant,
    products,
    inventoryRecords,
    inventoryBatches,
    currentDraft,
    initialItem,
    onSave,
    onClose
}: SalesItemModalProps) {
    const [inventoryRecordId, setInventoryRecordId] = useState(
        initialItem?.inventoryRecordId ?? ""
    );
    const [packagingLevelId, setPackagingLevelId] = useState(
        initialItem?.packagingLevelId ?? ""
    );
    const [quantity, setQuantity] = useState(
        String(initialItem?.quantity ?? 1)
    );
    const [appliedSellingPrice, setAppliedSellingPrice] = useState(
        initialItem ? String(initialItem.appliedSellingPrice) : ""
    );
    const [discountPercentage, setDiscountPercentage] = useState(
        percentageFromItem(initialItem)
    );
    const [submitError, setSubmitError] = useState("");

    const recommendations = recommendInventoryByFefo(
        product,
        variant.id,
        inventoryRecords,
        inventoryBatches
    );
    const choices = [
        ...recommendations.batches.map((recommendation, index) => ({
            inventoryRecord: recommendation.inventoryRecord,
            batch: recommendation.batch,
            expired: recommendation.expired,
            recommended: index === 0
        })),
        ...recommendations.unbatched.map((inventoryRecord) => ({
            inventoryRecord,
            batch: null,
            expired: false,
            recommended: false
        }))
    ];
    for (const inventoryRecord of inventoryRecords) {
        if (
            inventoryRecord.productId !== product.id ||
            inventoryRecord.variantId !== variant.id ||
            choices.some((choice) =>
                choice.inventoryRecord.id === inventoryRecord.id
            )
        ) {
            continue;
        }
        const batch = inventoryRecord.batchId === null
            ? null
            : getInventoryBatchById(
                inventoryBatches,
                inventoryRecord.batchId
            );
        choices.push({
            inventoryRecord,
            batch,
            expired: batch?.expiryDate
                ? Date.UTC(
                    batch.expiryDate.getUTCFullYear(),
                    batch.expiryDate.getUTCMonth(),
                    batch.expiryDate.getUTCDate()
                ) < Date.UTC(
                    new Date().getUTCFullYear(),
                    new Date().getUTCMonth(),
                    new Date().getUTCDate()
                )
                : false,
            recommended: false
        });
    }
    const selectedChoice = choices.find(
        (choice) => choice.inventoryRecord.id === inventoryRecordId
    );
    const selectedPackaging = variant.packagingHierarchy.find(
        (level) => level.id === packagingLevelId
    );
    const defaultSellingPrice = selectedChoice && selectedPackaging
        ? resolveDefaultSellingPrice(
            product,
            variant.id,
            selectedPackaging.id,
            selectedChoice.batch
        )
        : null;
    let availableRecord = selectedChoice?.inventoryRecord;
    let availabilityError = "";
    if (currentDraft && selectedChoice) {
        const otherItems = currentDraft.items.filter(
            (item) => item.lineId !== initialItem?.lineId
        );
        if (otherItems.length > 0) {
            try {
                const otherDraft = { ...currentDraft, items: otherItems };
                const otherPlan = prepareSaleDraft(otherDraft, {
                    products,
                    inventoryRecords,
                    inventoryBatches
                });
                availableRecord = otherPlan.updatedInventory.find(
                    (record) => record.id === selectedChoice.inventoryRecord.id
                ) ?? availableRecord;
            } catch (error) {
                availabilityError = error instanceof Error
                    ? error.message
                    : "Available stock could not be calculated.";
            }
        }
    }
    const availableQuantity = !availabilityError && selectedPackaging && availableRecord
        ? getAvailableQuantity(
            variant,
            availableRecord,
            selectedPackaging.id
        )
        : null;
    const parsedQuantity = Number(quantity);
    const parsedPrice = Number(appliedSellingPrice);
    const parsedPercentage = Number(discountPercentage);
    const validPercentageInput = discountPercentage.trim() !== "" &&
        Number.isFinite(parsedPercentage) &&
        parsedPercentage >= 0 &&
        parsedPercentage <= 100;
    const amounts = validPercentageInput
        ? calculateSaleLineAmounts(
            parsedPrice,
            parsedQuantity,
            parsedPercentage
        )
        : null;
    const invalidQuantity = !Number.isSafeInteger(parsedQuantity) ||
        parsedQuantity <= 0;
    const insufficientStock = selectedChoice !== undefined &&
        selectedPackaging !== undefined &&
        availableQuantity !== null &&
        parsedQuantity > availableQuantity;
    const canSave = Boolean(
        selectedChoice &&
        selectedPackaging &&
        defaultSellingPrice !== null &&
        Number.isFinite(defaultSellingPrice) &&
        Number.isFinite(parsedPrice) &&
        parsedPrice >= 0 &&
        amounts &&
        !invalidQuantity &&
        !availabilityError &&
        !insufficientStock
    );

    function packagingQuantityLabel(value: number, name: string): string {
        const normalizedName = name.toLocaleLowerCase();
        if (value === 1 || normalizedName.endsWith("s")) {
            return normalizedName;
        }
        if (normalizedName.endsWith("x")) {
            return `${normalizedName}es`;
        }
        return `${normalizedName}s`;
    }

    function updateInventoryRecord(nextId: string) {
        setInventoryRecordId(nextId);
        const choice = choices.find(
            (candidate) => candidate.inventoryRecord.id === nextId
        );
        const selectedLevel = variant.packagingHierarchy.find(
            (level) => level.id === packagingLevelId
        );
        const price = choice && selectedLevel
            ? resolveDefaultSellingPrice(
                product,
                variant.id,
                selectedLevel.id,
                choice.batch
            )
            : null;
        if (price !== null) {
            setAppliedSellingPrice(String(price));
        } else {
            setAppliedSellingPrice("");
        }
        setSubmitError("");
    }

    function updatePackagingLevel(nextId: string) {
        setPackagingLevelId(nextId);
        const selected = choices.find(
            (choice) => choice.inventoryRecord.id === inventoryRecordId
        );
        const price = selected && nextId
            ? resolveDefaultSellingPrice(
                product,
                variant.id,
                nextId,
                selected.batch
            )
            : null;
        if (price !== null) {
            setAppliedSellingPrice(String(price));
        } else {
            setAppliedSellingPrice("");
        }
        setSubmitError("");
    }

    function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!validPercentageInput) {
            setSubmitError("Discount percentage must be between 0 and 100.");
            return;
        }
        if (
            !selectedChoice ||
            !selectedPackaging ||
            defaultSellingPrice === null ||
            !Number.isFinite(defaultSellingPrice) ||
            !amounts ||
            !Number.isFinite(parsedPrice) ||
            parsedPrice < 0 ||
            !Number.isSafeInteger(parsedQuantity) ||
            parsedQuantity <= 0
        ) {
            setSubmitError("Select eligible stock and packaging, then enter valid prices and quantity.");
            return;
        }

        onSave({
            lineId: initialItem?.lineId ?? crypto.randomUUID(),
            productId: product.id,
            variantId: variant.id,
            inventoryRecordId: selectedChoice.inventoryRecord.id,
            batchId: selectedChoice.inventoryRecord.batchId,
            packagingLevelId: selectedPackaging.id,
            quantity: parsedQuantity,
            defaultSellingPrice,
            appliedSellingPrice: parsedPrice,
            discountAmount: amounts.discountAmount
        });
    }

    return (
        <div
            className="sales-item-modal-overlay"
            onClick={(event) => {
                if (event.target === event.currentTarget) {
                    onClose();
                }
            }}
        >
            <section
                aria-labelledby="sales-item-title"
                aria-modal="true"
                className="sales-item-modal"
                role="dialog"
            >
                <header className="sales-item-modal-header">
                    <div>
                        <h2 id="sales-item-title">
                            {initialItem ? "Edit sale item" : "Add medicine to sale"}
                        </h2>
                        <p>{product.name} · {variant.variantName}</p>
                    </div>
                    <button
                        aria-label="Close sales item"
                        className="sales-item-close"
                        onClick={onClose}
                        type="button"
                    >
                        &times;
                    </button>
                </header>
                <form onSubmit={handleSubmit}>
                    <div className="sales-item-modal-content">
                        <label className="sales-item-field">
                            <span>Inventory record and batch</span>
                            <select
                                aria-label="Select inventory record"
                                onChange={(event) => updateInventoryRecord(event.target.value)}
                                value={inventoryRecordId}
                            >
                                <option value="">Select eligible stock</option>
                                {choices.map((choice) => {
                                    const display = getInventoryDisplay(
                                        choice.inventoryRecord,
                                        [product],
                                        inventoryBatches
                                    );
                                    const batchText = choice.batch
                                        ? `Batch ${display.batchNumber ?? choice.batch.batchId}`
                                        : "Unbatched stock";
                                    const expiry = display.expiryDate
                                        ? ` · expires ${display.expiryDate.toISOString().slice(0, 10)}`
                                        : "";
                                    const stockText = display.stockQuantities
                                        .filter((stock) => stock.quantity > 0)
                                        .map((stock) => {
                                            const level = display.packagingLevels.find(
                                                (candidate) => candidate.id === stock.packagingLevelId
                                            );
                                            return `${stock.quantity} ${level?.name ?? stock.packagingLevelId}`;
                                        })
                                        .join(", ");
                                    return (
                                        <option
                                            key={choice.inventoryRecord.id}
                                            value={choice.inventoryRecord.id}
                                        >
                                            {batchText}{expiry}
                                            {choice.expired ? " · EXPIRED" : ""}
                                            {choice.recommended ? " · FEFO recommended" : ""}
                                            {" · "}{stockText || "No available stock"}
                                        </option>
                                    );
                                })}
                            </select>
                        </label>
                        {choices.length === 0 && (
                            <p role="status">No eligible inventory records are available.</p>
                        )}
                        {selectedChoice?.expired && (
                            <p className="sales-expired-warning" role="alert">
                                This batch is expired. It is not blocked by FEFO; approval requires confirmation.
                            </p>
                        )}
                        {selectedChoice && selectedPackaging && availableQuantity !== null && (
                            <p className="sales-item-stock-summary">
                                Selected inventory: {selectedChoice.inventoryRecord.id}
                                {selectedChoice.batch
                                    ? ` · Batch ${selectedChoice.batch.batchNumber ?? selectedChoice.batch.batchId}`
                                    : " · Unbatched"}
                                {selectedChoice.recommended
                                    ? " · FEFO recommended"
                                    : ""}
                                {selectedChoice.batch?.expiryDate
                                    ? ` · Expires ${selectedChoice.batch.expiryDate.toISOString().slice(0, 10)}`
                                    : ""}
                                {" · "}
                                Available {availableQuantity}{" "}
                                {packagingQuantityLabel(
                                    availableQuantity,
                                    selectedPackaging.name
                                )}
                            </p>
                        )}
                        {availabilityError && (
                            <p className="sales-item-error" role="alert">
                                Available stock could not be calculated: {availabilityError}
                            </p>
                        )}
                        <label className="sales-item-field">
                            <span>Packaging level</span>
                            <select
                                aria-label="Select packaging level"
                                onChange={(event) => updatePackagingLevel(event.target.value)}
                                value={packagingLevelId}
                            >
                                <option value="">Select a packaging level</option>
                                {variant.packagingHierarchy.map((level) => (
                                    <option key={level.id} value={level.id}>
                                        {level.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <div className="sales-item-grid">
                            <label className="sales-item-field">
                                <span>Quantity</span>
                                <input
                                    aria-label="Sale quantity"
                                    min="1"
                                    onChange={(event) => {
                                        setQuantity(event.target.value);
                                        setSubmitError("");
                                    }}
                                    step="1"
                                    type="number"
                                    value={quantity}
                                />
                            </label>
                            <label className="sales-item-field">
                                <span>Selling price</span>
                                <input
                                    aria-label="Selling price"
                                    min="0"
                                    onChange={(event) => {
                                        setAppliedSellingPrice(event.target.value);
                                        setSubmitError("");
                                    }}
                                    step="0.01"
                                    type="number"
                                    value={appliedSellingPrice}
                                />
                            </label>
                            <label className="sales-item-field">
                                <span>Discount percentage</span>
                                <input
                                    aria-label="Discount percentage"
                                    aria-invalid={!validPercentageInput}
                                    max="100"
                                    min="0"
                                    onChange={(event) => {
                                        setDiscountPercentage(event.target.value);
                                        setSubmitError("");
                                    }}
                                    step="any"
                                    type="number"
                                    value={discountPercentage}
                                />
                            </label>
                        </div>
                        {!validPercentageInput && discountPercentage.trim() !== "" && (
                            <p className="sales-item-error" role="alert">
                                Discount percentage must be a finite number between 0 and 100.
                            </p>
                        )}
                        {insufficientStock && selectedPackaging && availableQuantity !== null && (
                            <p className="sales-item-error" role="alert">
                                Insufficient stock. Current quantity available:{" "}
                                {availableQuantity}{" "}
                                {packagingQuantityLabel(
                                    availableQuantity,
                                    selectedPackaging.name
                                )}.
                            </p>
                        )}
                        {invalidQuantity && (
                            <p className="sales-item-error" role="alert">
                                Enter a whole-number quantity greater than zero.
                            </p>
                        )}
                        <div className="sales-item-totals" aria-live="polite">
                            <span>Subtotal <strong>{amounts?.subtotal.toFixed(2) ?? "—"}</strong></span>
                            <span>Discount amount <strong>{amounts?.discountAmount.toFixed(2) ?? "—"}</strong></span>
                            <span>Final amount <strong>{amounts?.finalAmount.toFixed(2) ?? "—"}</strong></span>
                        </div>
                        {submitError && (
                            <p className="sales-item-error" role="alert">{submitError}</p>
                        )}
                    </div>
                    <footer className="sales-item-modal-footer">
                        <button
                            className="sales-item-cancel"
                            onClick={onClose}
                            type="button"
                        >
                            Cancel
                        </button>
                        <button
                            className="sales-item-submit"
                            disabled={!canSave}
                            type="submit"
                        >
                            {initialItem ? "Save Changes" : "Add to Sales"}
                        </button>
                    </footer>
                </form>
            </section>
        </div>
    );
}
