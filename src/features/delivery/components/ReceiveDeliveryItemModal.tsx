import { useState } from "react";
import type { DeliveryDraftItem } from "../../../deliveries/deliveryDraft";
import type { productStructure, variant } from "../../../products/productStructure";
import { validatePackagingHierarchy } from "../../../packaging/packagingValidation";

interface ReceiveDeliveryItemModalProps {
    product: productStructure;
    productVariant: variant;
    item?: DeliveryDraftItem;
    onClose: () => void;
    onSave: (item: DeliveryDraftItem) => string | undefined;
}

export default function ReceiveDeliveryItemModal({
    product,
    productVariant,
    item,
    onClose,
    onSave
}: ReceiveDeliveryItemModalProps) {
    const [packagingLevelId, setPackagingLevelId] = useState(
        item?.packagingLevelId ?? ""
    );
    const [quantity, setQuantity] = useState(
        item ? String(item.quantity) : "1"
    );
    const [batchNumber, setBatchNumber] = useState(item?.batchNumber ?? "");
    const [expiryDate, setExpiryDate] = useState(item?.expiryDate ?? "");
    const [errorMessage, setErrorMessage] = useState("");

    function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setErrorMessage("");

        try {
            if (!product.variant.some(
                (candidate) => candidate.id === productVariant.id
            )) {
                throw new Error("The selected variant does not belong to this product.");
            }
            validatePackagingHierarchy(productVariant.packagingHierarchy);

            const parsedQuantity = Number(quantity);
            if (!Number.isSafeInteger(parsedQuantity) || parsedQuantity <= 0) {
                throw new Error("Quantity must be a positive whole number.");
            }
            if (!productVariant.packagingHierarchy.some(
                (level) => level.id === packagingLevelId
            )) {
                throw new Error(
                    "Select a packaging level belonging to the selected variant."
                );
            }

            const message = onSave({
                deliveryItemId: item?.deliveryItemId ?? crypto.randomUUID(),
                productId: product.id,
                variantId: productVariant.id,
                packagingLevelId,
                quantity: parsedQuantity,
                batchNumber: batchNumber.trim() || null,
                expiryDate: expiryDate || null
            });
            if (message) {
                setErrorMessage(message);
            }
        } catch (error) {
            setErrorMessage(error instanceof Error
                ? error.message
                : "The delivery item could not be saved.");
        }
    }

    return (
        <div className="delivery-item-modal-overlay">
            <section
                aria-labelledby="receive-delivery-item-title"
                aria-modal="true"
                className="delivery-item-modal"
                role="dialog"
            >
                <header className="delivery-item-modal-header">
                    <div>
                        <h2 id="receive-delivery-item-title">
                            {item ? "Edit Delivery Item" : "Receive Item"}
                        </h2>
                        <p>{product.name} · {productVariant.variantName}</p>
                    </div>
                    <button
                        aria-label="Close delivery item"
                        className="delivery-item-close"
                        onClick={onClose}
                        type="button"
                    >
                        ×
                    </button>
                </header>
                <form onSubmit={handleSubmit}>
                    <div className="delivery-item-modal-content">
                        <div className="delivery-item-product-summary">
                            <span>Selected product</span>
                            <strong>{product.name}</strong>
                            <span>Selected variant</span>
                            <strong>{productVariant.variantName}</strong>
                        </div>
                        <label className="delivery-item-field">
                            <span>Packaging level received</span>
                            <select
                                aria-label="Packaging level received"
                                onChange={(event) =>
                                    setPackagingLevelId(event.target.value)
                                }
                                required
                                value={packagingLevelId}
                            >
                                <option value="">Select packaging level</option>
                                {productVariant.packagingHierarchy.map((level) => (
                                    <option key={level.id} value={level.id}>
                                        {level.name}
                                    </option>
                                ))}
                            </select>
                            {productVariant.packagingHierarchy.length === 0 && (
                                <span className="delivery-item-help">
                                    Add a packaging level to this variant before receiving it.
                                </span>
                            )}
                        </label>
                        <div className="delivery-item-grid">
                            <label className="delivery-item-field">
                                <span>Quantity received</span>
                                <input
                                    aria-label="Quantity received"
                                    min="1"
                                    onChange={(event) => setQuantity(event.target.value)}
                                    required
                                    step="1"
                                    type="number"
                                    value={quantity}
                                />
                            </label>
                            <label className="delivery-item-field">
                                <span>Batch number</span>
                                <input
                                    aria-label="Batch number"
                                    onChange={(event) => setBatchNumber(event.target.value)}
                                    value={batchNumber}
                                />
                            </label>
                            <label className="delivery-item-field">
                                <span>Expiry date</span>
                                <input
                                    aria-label="Expiry date"
                                    onChange={(event) => setExpiryDate(event.target.value)}
                                    type="date"
                                    value={expiryDate}
                                />
                            </label>
                        </div>
                        {errorMessage && (
                            <p className="delivery-item-error" role="alert">
                                {errorMessage}
                            </p>
                        )}
                    </div>
                    <footer className="delivery-item-modal-footer">
                        <button
                            className="delivery-secondary-button"
                            onClick={onClose}
                            type="button"
                        >
                            Cancel
                        </button>
                        <button
                            className="delivery-primary-button"
                            disabled={productVariant.packagingHierarchy.length === 0}
                            type="submit"
                        >
                            {item ? "Save Item" : "Add to Delivery"}
                        </button>
                    </footer>
                </form>
            </section>
        </div>
    );
}
