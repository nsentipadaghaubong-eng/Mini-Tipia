import { useState } from "react";
import {
    addVariantCreationDraft,
    createCatalogueProductFromDraft,
    createProductFromDraft,
    createEmptyVariantCreationDraft,
    removeVariantCreationDraft,
    validateProductCreationDraft,
    type ProductCreationDraft,
    type ProductCreationErrors,
    type ProductCreationResult,
    type VariantCreationDraft
} from "../../../products/productCreation";
import type { productStructure } from "../../../products/productStructure";
import type { inventory } from "../../../inventory/inventoryStock";
import type { inventoryBatch } from "../../../inventory/inventoryBatch";
import "./CreateProductModal.css";

interface CommonCreateProductModalProps {
    products: productStructure[];
    inventoryRecords: inventory[];
    inventoryBatches: inventoryBatch[];
    onClose: () => void;
}

type CreateProductModalProps = CommonCreateProductModalProps & (
    | {
        mode?: "stock";
        onCreate: (result: ProductCreationResult) => void;
        onCreateCatalogue?: never;
    }
    | {
        mode: "catalogue";
        onCreateCatalogue: (product: productStructure) => void;
        onCreate?: never;
    }
);

function emptyDraft(): ProductCreationDraft {
    return {
        name: "",
        genericName: "",
        manufacturer: "",
        category: "",
        addVariants: false,
        variants: [createEmptyVariantCreationDraft()]
    };
}

function fieldError(errors: ProductCreationErrors, key: string) {
    return errors[key] ? <span className="create-field-error">{errors[key]}</span> : null;
}

export default function CreateProductModal({
    products,
    inventoryRecords,
    inventoryBatches,
    mode = "stock",
    onCreate,
    onCreateCatalogue,
    onClose
}: CreateProductModalProps) {
    const [draft, setDraft] = useState(emptyDraft);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const errors = validateProductCreationDraft(draft);

    function updateVariant(
        variantIndex: number,
        update: (variant: VariantCreationDraft) => VariantCreationDraft
    ) {
        setDraft((current) => ({
            ...current,
            variants: current.variants.map((item, index) =>
                index === variantIndex ? update(item) : item
            )
        }));
        setSubmitError(null);
    }

    function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (Object.keys(errors).length > 0) {
            return;
        }

        try {
            if (mode === "catalogue") {
                if (!onCreateCatalogue) {
                    throw new Error("Catalogue product creation is not configured.");
                }
                const product = createCatalogueProductFromDraft(
                    draft,
                    products,
                    inventoryRecords,
                    undefined,
                    inventoryBatches
                );
                onCreateCatalogue(product);
            } else {
                if (!onCreate) {
                    throw new Error("Product creation is not configured.");
                }
                const result = createProductFromDraft(
                    draft,
                    products,
                    inventoryRecords,
                    undefined,
                    inventoryBatches
                );
                onCreate(result);
            }
            onClose();
        } catch (error) {
            setSubmitError(
                error instanceof Error
                    ? error.message
                    : "The product could not be created."
            );
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
                aria-labelledby="create-product-title"
                aria-modal="true"
                className="inventory-modal create-product-modal"
                role="dialog"
            >
                <div className="inventory-modal-header">
                    <div>
                        <h2 id="create-product-title">Create Product</h2>
                        <p>
                            {mode === "catalogue"
                                ? "Add product information and packaging"
                                : "Add product information and starting stock"}
                        </p>
                    </div>
                    <button
                        aria-label="Close create product"
                        className="modal-close-button"
                        onClick={onClose}
                        type="button"
                    >
                        &times;
                    </button>
                </div>

                <form className="create-product-form" onSubmit={handleSubmit}>
                    <div className="inventory-modal-content create-product-content">
                        <section className="create-product-section">
                            <h3 className="modal-section-title">Product information</h3>
                            <div className="create-product-fields">
                                <label className="create-field create-field-wide">
                                    <span>Product name <span aria-hidden="true">*</span></span>
                                    <input
                                        autoFocus
                                        onChange={(event) => setDraft((current) => ({
                                            ...current,
                                            name: event.target.value
                                        }))}
                                        value={draft.name}
                                    />
                                    {fieldError(errors, "name")}
                                </label>
                                <label className="create-field">
                                    <span>Generic name</span>
                                    <input
                                        onChange={(event) => setDraft((current) => ({
                                            ...current,
                                            genericName: event.target.value
                                        }))}
                                        value={draft.genericName}
                                    />
                                </label>
                                <label className="create-field">
                                    <span>Manufacturer</span>
                                    <input
                                        onChange={(event) => setDraft((current) => ({
                                            ...current,
                                            manufacturer: event.target.value
                                        }))}
                                        value={draft.manufacturer}
                                    />
                                </label>
                                {!draft.addVariants && (
                                    <label className="create-field">
                                        <span>NAFDAC Registration Number</span>
                                        <input
                                            onChange={(event) => updateVariant(0, (item) => ({
                                                ...item,
                                                nafdacRegistrationNumber: event.target.value
                                            }))}
                                            value={draft.variants[0]?.nafdacRegistrationNumber ?? ""}
                                        />
                                    </label>
                                )}
                                <label className="create-field">
                                    <span>Category</span>
                                    <input
                                        onChange={(event) => setDraft((current) => ({
                                            ...current,
                                            category: event.target.value
                                        }))}
                                        value={draft.category}
                                    />
                                </label>
                            </div>
                        </section>

                        <label className="create-toggle">
                            <input
                                checked={draft.addVariants}
                                onChange={(event) => setDraft((current) => ({
                                    ...current,
                                    addVariants: event.target.checked
                                }))}
                                type="checkbox"
                            />
                            <span>Add Variants</span>
                        </label>

                        {draft.addVariants && (
                            <section className="create-product-section create-variants-section">
                                <div className="create-section-heading">
                                    <h3 className="modal-section-title">Variants</h3>
                                </div>
                                {fieldError(errors, "variants")}
                                {draft.variants.map((productVariant, variantIndex) => {
                                    const variantPrefix = `variants.${variantIndex}`;
                                    return (
                                        <section className="create-variant" key={productVariant.key}>
                                            <div className="create-section-heading">
                                                <h4>Variant {variantIndex + 1}</h4>
                                                {draft.variants.length > 1 && (
                                                    <button
                                                        aria-label={`Remove Variant ${variantIndex + 1}`}
                                                        className="create-remove-button"
                                                        onClick={() => setDraft((current) => ({
                                                            ...current,
                                                            variants: removeVariantCreationDraft(current.variants, variantIndex)
                                                        }))}
                                                        type="button"
                                                    >
                                                        Remove
                                                    </button>
                                                )}
                                            </div>
                                            <label className="create-field">
                                                <span>Name or description</span>
                                                <input
                                                    onChange={(event) => updateVariant(variantIndex, (item) => ({
                                                        ...item,
                                                        name: event.target.value
                                                    }))}
                                                    value={productVariant.name}
                                                />
                                                {fieldError(errors, `${variantPrefix}.name`)}
                                            </label>
                                            <label className="create-field">
                                                <span>NAFDAC Registration Number</span>
                                                <input
                                                    onChange={(event) => updateVariant(variantIndex, (item) => ({
                                                        ...item,
                                                        nafdacRegistrationNumber: event.target.value
                                                    }))}
                                                    value={productVariant.nafdacRegistrationNumber}
                                                />
                                            </label>
                                            {renderVariantContents(productVariant, variantIndex, variantPrefix)}
                                        </section>
                                    );
                                })}
                                <div className="create-section-heading create-list-add">
                                    <button
                                        className="secondary-button create-small-button"
                                        onClick={() => setDraft((current) => ({
                                            ...current,
                                            variants: addVariantCreationDraft(current.variants)
                                        }))}
                                        type="button"
                                    >
                                        Add Another Variant
                                    </button>
                                </div>
                            </section>
                        )}

                        {!draft.addVariants && renderVariantContents(
                            draft.variants[0],
                            0,
                            "variants.0",
                            mode !== "catalogue"
                        )}

                        {submitError && (
                            <p className="create-submit-error" role="alert">{submitError}</p>
                        )}
                    </div>

                    <footer className="create-product-footer">
                        <button className="secondary-button" onClick={onClose} type="button">
                            Cancel
                        </button>
                        <button
                            className="primary-button"
                            disabled={Object.keys(errors).length > 0}
                            type="submit"
                        >
                            {mode === "catalogue"
                                ? "Create Catalogue Product"
                                : "Create Product"}
                        </button>
                    </footer>
                </form>
            </section>
        </div>
    );

    function renderVariantContents(
        productVariant: VariantCreationDraft,
        variantIndex: number,
        variantPrefix: string,
        showStockFields = mode !== "catalogue"
    ) {
        return (
            <>
                <section className="create-subsection">
                    <div className="create-section-heading">
                        <h4>Packaging</h4>
                    </div>
                    {productVariant.packaging.map((level, levelIndex) => {
                        const levelPrefix = `${variantPrefix}.packaging.${levelIndex}`;
                        const nextLevelName = productVariant.packaging[levelIndex + 1]?.name.trim();
                        return (
                            <div className="create-entry" key={level.key}>
                                <div className="create-section-heading">
                                    <strong>Packaging level {levelIndex + 1}</strong>
                                    <button
                                        className="create-remove-button"
                                        onClick={() => updateVariant(variantIndex, (item) => ({
                                            ...item,
                                            packaging: item.packaging.filter((entry) => entry.key !== level.key)
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
                                            onChange={(event) => updateVariant(variantIndex, (item) => ({
                                                ...item,
                                                packaging: item.packaging.map((entry) => entry.key === level.key
                                                    ? { ...entry, name: event.target.value }
                                                    : entry)
                                            }))}
                                            value={level.name}
                                        />
                                        {fieldError(errors, `${levelPrefix}.name`)}
                                    </label>
                                    {levelIndex < productVariant.packaging.length - 1 && (
                                        <label className="create-field">
                                            <span>Units in one {nextLevelName || "next smaller level"}</span>
                                            <input
                                                inputMode="numeric"
                                                min="1"
                                                onChange={(event) => updateVariant(variantIndex, (item) => ({
                                                    ...item,
                                                    packaging: item.packaging.map((entry) => entry.key === level.key
                                                        ? { ...entry, quantityOfNextLevel: event.target.value }
                                                        : entry)
                                                }))}
                                                step="1"
                                                type="number"
                                                value={level.quantityOfNextLevel}
                                            />
                                            {fieldError(errors, `${levelPrefix}.quantityOfNextLevel`)}
                                        </label>
                                    )}
                                    <label className="create-field">
                                        <span>Cost price <span className="create-optional">(optional)</span></span>
                                        <input
                                            min="0"
                                            onChange={(event) => updateVariant(variantIndex, (item) => ({
                                                ...item,
                                                packaging: item.packaging.map((entry) => entry.key === level.key
                                                    ? { ...entry, costPrice: event.target.value }
                                                    : entry)
                                            }))}
                                            step="any"
                                            type="number"
                                            value={level.costPrice}
                                        />
                                        {fieldError(errors, `${levelPrefix}.costPrice`)}
                                    </label>
                                    <label className="create-field">
                                        <span>Selling price <span className="create-optional">(optional)</span></span>
                                        <input
                                            min="0"
                                            onChange={(event) => updateVariant(variantIndex, (item) => ({
                                                ...item,
                                                packaging: item.packaging.map((entry) => entry.key === level.key
                                                    ? { ...entry, sellingPrice: event.target.value }
                                                    : entry)
                                            }))}
                                            step="any"
                                            type="number"
                                            value={level.sellingPrice}
                                        />
                                        {fieldError(errors, `${levelPrefix}.sellingPrice`)}
                                    </label>
                                </div>
                            </div>
                        );
                    })}
                    <div className="create-section-heading create-list-add">
                        <button
                            className="secondary-button create-small-button"
                            onClick={() => updateVariant(variantIndex, (item) => ({
                                ...item,
                                packaging: [...item.packaging, {
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
                </section>

                {showStockFields && (
                    <section className="create-subsection">
                        <div className="create-section-heading">
                            <h4>Batches and starting stock</h4>
                        </div>

                    {productVariant.batches.length === 0 ? (
                        productVariant.packaging.length > 0 && (
                            <StockFields
                                errors={errors}
                                packaging={productVariant.packaging}
                                prefix={`${variantPrefix}.unbatchedStock`}
                                stock={productVariant.unbatchedStock}
                                onChange={(key, value) => updateVariant(variantIndex, (item) => ({
                                    ...item,
                                    unbatchedStock: { ...item.unbatchedStock, [key]: value }
                                }))}
                            />
                        )
                    ) : productVariant.batches.map((batch, batchIndex) => (
                        <div className="create-entry" key={`${productVariant.key}-batch-${batchIndex}`}>
                            <div className="create-section-heading">
                                <strong>Batch {batchIndex + 1}</strong>
                                <button
                                    className="create-remove-button"
                                    onClick={() => updateVariant(variantIndex, (item) => ({
                                        ...item,
                                        batches: item.batches.filter((_, index) => index !== batchIndex)
                                    }))}
                                    type="button"
                                >
                                    Remove
                                </button>
                            </div>
                            <div className="create-product-fields">
                                <label className="create-field">
                                    <span>Batch number <span className="create-optional">(optional)</span></span>
                                    <input
                                        onChange={(event) => updateVariant(variantIndex, (item) => ({
                                            ...item,
                                            batches: item.batches.map((entry, index) => index === batchIndex
                                                ? { ...entry, batchNumber: event.target.value }
                                                : entry)
                                        }))}
                                        value={batch.batchNumber}
                                    />
                                </label>
                                <label className="create-field">
                                    <span>Expiry date <span className="create-optional">(optional)</span></span>
                                    <input
                                        onChange={(event) => updateVariant(variantIndex, (item) => ({
                                            ...item,
                                            batches: item.batches.map((entry, index) => index === batchIndex
                                                ? { ...entry, expiryDate: event.target.value }
                                                : entry)
                                        }))}
                                        type="date"
                                        value={batch.expiryDate}
                                    />
                                </label>
                            </div>
                            {productVariant.packaging.length > 0 && (
                                <StockFields
                                    errors={errors}
                                    packaging={productVariant.packaging}
                                    prefix={`${variantPrefix}.batches.${batchIndex}.stock`}
                                    stock={batch.stock}
                                    onChange={(key, value) => updateVariant(variantIndex, (item) => ({
                                        ...item,
                                        batches: item.batches.map((entry, index) => index === batchIndex
                                            ? { ...entry, stock: { ...entry.stock, [key]: value } }
                                            : entry)
                                    }))}
                                />
                            )}
                        </div>
                    ))}
                        <div className="create-section-heading create-list-add">
                            <button
                                className="secondary-button create-small-button"
                                onClick={() => updateVariant(variantIndex, (item) => ({
                                    ...item,
                                    batches: [...item.batches, {
                                        batchNumber: "",
                                        expiryDate: "",
                                        stock: {}
                                    }]
                                }))}
                                type="button"
                            >
                                Add Batch
                            </button>
                        </div>
                    </section>
                )}
            </>
        );
    }
}

function StockFields({
    packaging,
    stock,
    prefix,
    errors,
    onChange
}: {
    packaging: VariantCreationDraft["packaging"];
    stock: VariantCreationDraft["unbatchedStock"];
    prefix: string;
    errors: ProductCreationErrors;
    onChange: (packagingKey: string, value: string) => void;
}) {
    return (
        <div className="create-stock-fields">
            <h5>Starting stock by packaging level</h5>
            <div className="create-product-fields">
                {packaging.map((level) => (
                    <label className="create-field" key={level.key}>
                        <span>{level.name.trim() || "Packaging level"} quantity</span>
                        <input
                            inputMode="numeric"
                            min="0"
                            onChange={(event) => onChange(level.key, event.target.value)}
                            step="1"
                            type="number"
                            value={stock[level.key] ?? "0"}
                        />
                        {fieldError(errors, `${prefix}.${level.key}`)}
                    </label>
                ))}
            </div>
        </div>
    );
}