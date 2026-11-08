import { useState } from "react";
import {
    createEmptyVariantCreationDraft,
    createVariantFromDraft,
    validateProductCreationDraft,
    type ProductCreationDraft,
    type ProductCreationErrors,
    type VariantCreationDraft
} from "../../../products/productCreation";
import type { inventory } from "../../../inventory/inventoryStock";
import type { inventoryBatch } from "../../../inventory/inventoryBatch";
import type { productStructure, variant } from "../../../products/productStructure";

interface AddDeliveryVariantModalProps {
    product: productStructure;
    products: productStructure[];
    inventoryRecords: inventory[];
    inventoryBatches: inventoryBatch[];
    onCreate: (productVariant: variant) => void;
    onClose: () => void;
}

function validationDraft(
    product: productStructure,
    productVariant: VariantCreationDraft
): ProductCreationDraft {
    return {
        name: product.name,
        genericName: "",
        manufacturer: "",
        category: "",
        addVariants: true,
        variants: [{ ...productVariant, batches: [], unbatchedStock: {} }]
    };
}

function fieldError(errors: ProductCreationErrors, key: string) {
    return errors[key]
        ? <span className="create-field-error">{errors[key]}</span>
        : null;
}

export default function AddDeliveryVariantModal({
    product,
    products,
    inventoryRecords,
    inventoryBatches,
    onCreate,
    onClose
}: AddDeliveryVariantModalProps) {
    const [draft, setDraft] = useState(createEmptyVariantCreationDraft);
    const [submitError, setSubmitError] = useState("");
    const errors = validateProductCreationDraft(validationDraft(product, draft));
    const variantPrefix = "variants.0";

    function updateDraft(update: (current: VariantCreationDraft) => VariantCreationDraft) {
        setDraft(update);
        setSubmitError("");
    }

    function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (Object.keys(errors).length > 0) {
            return;
        }

        try {
            const productVariant = createVariantFromDraft(
                product,
                draft,
                products,
                inventoryRecords,
                undefined,
                inventoryBatches
            );
            onCreate(productVariant);
            onClose();
        } catch (error) {
            setSubmitError(error instanceof Error
                ? error.message
                : "The variant could not be created.");
        }
    }

    return (
        <div
            className="inventory-modal-overlay"
            onClick={(event) => {
                if (event.target === event.currentTarget) {
                    onClose();
                }
            }}
        >
            <section
                aria-labelledby="delivery-variant-title"
                aria-modal="true"
                className="inventory-modal delivery-variant-modal"
                role="dialog"
            >
                <div className="inventory-modal-header">
                    <div>
                        <h2 id="delivery-variant-title">Add Variant</h2>
                        <p>For {product.name}</p>
                    </div>
                    <button
                        aria-label="Close add variant"
                        className="modal-close-button"
                        onClick={onClose}
                        type="button"
                    >
                        &times;
                    </button>
                </div>

                <form className="delivery-variant-form" onSubmit={handleSubmit}>
                    <div className="inventory-modal-content delivery-variant-content">
                        <label className="create-field">
                            <span>Name or description <span aria-hidden="true">*</span></span>
                            <input
                                autoFocus
                                onChange={(event) => updateDraft((current) => ({
                                    ...current,
                                    name: event.target.value
                                }))}
                                value={draft.name}
                            />
                            {fieldError(errors, `${variantPrefix}.name`)}
                        </label>
                        <label className="create-field">
                            <span>NAFDAC Registration Number</span>
                            <input
                                onChange={(event) => updateDraft((current) => ({
                                    ...current,
                                    nafdacRegistrationNumber: event.target.value
                                }))}
                                value={draft.nafdacRegistrationNumber}
                            />
                        </label>

                        <section className="create-subsection">
                            <div className="delivery-variant-heading">
                                <h3 className="modal-section-title">Packaging hierarchy</h3>
                                <button
                                    className="secondary-button create-small-button"
                                    onClick={() => updateDraft((current) => ({
                                        ...current,
                                        packaging: [...current.packaging, {
                                            key: crypto.randomUUID(),
                                            name: "",
                                            quantityOfNextLevel: "",
                                            costPrice: "",
                                            sellingPrice: ""
                                        }]
                                    }))}
                                    type="button"
                                >
                                    Add Packaging Level
                                </button>
                            </div>
                            {draft.packaging.length === 0 && (
                                <p className="delivery-variant-empty">
                                    No packaging levels added.
                                </p>
                            )}
                            {draft.packaging.map((level, index) => {
                                const levelPrefix = `${variantPrefix}.packaging.${index}`;
                                const nextName = draft.packaging[index + 1]?.name.trim();
                                return (
                                    <div className="create-entry" key={level.key}>
                                        <div className="delivery-variant-heading">
                                            <strong>Packaging level {index + 1}</strong>
                                            <button
                                                className="create-remove-button"
                                                onClick={() => updateDraft((current) => ({
                                                    ...current,
                                                    packaging: current.packaging.filter(
                                                        (candidate) => candidate.key !== level.key
                                                    )
                                                }))}
                                                type="button"
                                            >
                                                Remove
                                            </button>
                                        </div>
                                        <div className="create-product-fields">
                                            <label className="create-field">
                                                <span>Packaging name</span>
                                                <input
                                                    onChange={(event) => updateDraft((current) => ({
                                                        ...current,
                                                        packaging: current.packaging.map((candidate) =>
                                                            candidate.key === level.key
                                                                ? { ...candidate, name: event.target.value }
                                                                : candidate
                                                        )
                                                    }))}
                                                    value={level.name}
                                                />
                                                {fieldError(errors, `${levelPrefix}.name`)}
                                            </label>
                                            {index < draft.packaging.length - 1 && (
                                                <label className="create-field">
                                                    <span>
                                                        Units in one {nextName || "next smaller level"}
                                                    </span>
                                                    <input
                                                        inputMode="numeric"
                                                        min="1"
                                                        onChange={(event) => updateDraft((current) => ({
                                                            ...current,
                                                            packaging: current.packaging.map((candidate) =>
                                                                candidate.key === level.key
                                                                    ? {
                                                                        ...candidate,
                                                                        quantityOfNextLevel: event.target.value
                                                                    }
                                                                    : candidate
                                                            )
                                                        }))}
                                                        step="1"
                                                        type="number"
                                                        value={level.quantityOfNextLevel}
                                                    />
                                                    {fieldError(
                                                        errors,
                                                        `${levelPrefix}.quantityOfNextLevel`
                                                    )}
                                                </label>
                                            )}
                                            <label className="create-field">
                                                <span>Cost price</span>
                                                <input
                                                    min="0"
                                                    onChange={(event) => updateDraft((current) => ({
                                                        ...current,
                                                        packaging: current.packaging.map((candidate) =>
                                                            candidate.key === level.key
                                                                ? { ...candidate, costPrice: event.target.value }
                                                                : candidate
                                                        )
                                                    }))}
                                                    step="any"
                                                    type="number"
                                                    value={level.costPrice}
                                                />
                                                {fieldError(
                                                    errors,
                                                    `${levelPrefix}.costPrice`
                                                )}
                                            </label>
                                            <label className="create-field">
                                                <span>Selling price</span>
                                                <input
                                                    min="0"
                                                    onChange={(event) => updateDraft((current) => ({
                                                        ...current,
                                                        packaging: current.packaging.map((candidate) =>
                                                            candidate.key === level.key
                                                                ? { ...candidate, sellingPrice: event.target.value }
                                                                : candidate
                                                        )
                                                    }))}
                                                    step="any"
                                                    type="number"
                                                    value={level.sellingPrice}
                                                />
                                                {fieldError(
                                                    errors,
                                                    `${levelPrefix}.sellingPrice`
                                                )}
                                            </label>
                                        </div>
                                    </div>
                                );
                            })}
                        </section>
                        {submitError && (
                            <p className="create-submit-error" role="alert">
                                {submitError}
                            </p>
                        )}
                    </div>

                    <footer className="create-product-footer">
                        <button
                            className="secondary-button"
                            onClick={onClose}
                            type="button"
                        >
                            Cancel
                        </button>
                        <button
                            className="primary-button"
                            disabled={Object.keys(errors).length > 0}
                            type="submit"
                        >
                            Add Variant
                        </button>
                    </footer>
                </form>
            </section>
        </div>
    );
}
