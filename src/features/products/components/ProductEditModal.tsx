import { useState } from "react";
import type { productStructure } from "../../../products/productStructure";
import type { inventoryBatch } from "../../../inventory/inventoryBatch";
import type { inventory } from "../../../inventory/inventoryStock";
import {
    addVariantToUpdateDraft,
    addPackagingLevelToUpdateDraft,
    applyPackagingLevelInitialStock,
    buildUpdatedProduct,
    createProductUpdateDraft,
    validateProductUpdateDraft,
    type PackagingUpdateDraft,
    type ProductUpdateDraft,
    type ProductUpdateErrors,
    type VariantUpdateDraft
} from "../../../products/productUpdate";
import {
    validateInventoryPackagingRelationships
} from "../../../inventory/inventoryValidation";
import {
    createInventoryManageIntent,
    resolveInventoryManageTarget
} from "../../../navigation/navigationIntent";
import type { ProductRecordDeletionDraft } from "../../../products/productDeletion";
import "./ProductEditModal.css";

interface ProductEditModalProps {
    product: productStructure;
    inventoryRecords: inventory[];
    inventoryBatches: inventoryBatch[];
    initialVariantId?: string | null;
    onManageStock: (
        variantId: string,
        inventoryId: string,
        batchId: string | null
    ) => void;
    onClose: () => void;
    onSave: (
        product: productStructure,
        reason: string,
        inventoryRecords?: inventory[],
        inventoryBatches?: inventoryBatch[],
        deletions?: ProductRecordDeletionDraft[]
    ) => void;
    draftLockMessages?: string[];
}

function fieldError(errors: ProductUpdateErrors, key: string) {
    return errors[key]
        ? <span className="product-edit-error">{errors[key]}</span>
        : null;
}

function updateVariant(
    draft: ProductUpdateDraft,
    variantIndex: number,
    update: (productVariant: VariantUpdateDraft) => VariantUpdateDraft
): ProductUpdateDraft {
    return {
        ...draft,
        variants: draft.variants.map((productVariant, index) =>
            index === variantIndex ? update(productVariant) : productVariant
        )
    };
}

function updatePackaging(
    productVariant: VariantUpdateDraft,
    levelIndex: number,
    update: (level: PackagingUpdateDraft) => PackagingUpdateDraft
): VariantUpdateDraft {
    return {
        ...productVariant,
        packaging: productVariant.packaging.map((level, index) =>
            index === levelIndex ? update(level) : level
        )
    };
}

export default function ProductEditModal({
    product,
    inventoryRecords,
    inventoryBatches,
    initialVariantId = null,
    onManageStock,
    onClose,
    onSave,
    draftLockMessages = []
}: ProductEditModalProps) {
    const [draft, setDraft] = useState(() => createProductUpdateDraft(product));
    const [saveError, setSaveError] = useState<string | null>(null);
    const [pendingDeletion, setPendingDeletion] =
        useState<ProductRecordDeletionDraft | null>(null);
    const [stagedDeletions, setStagedDeletions] = useState<Array<{
        id: string;
        deletion: ProductRecordDeletionDraft;
    }>>([]);
    const errors = validateProductUpdateDraft(draft, product);
    const hasErrors = Object.keys(errors).length > 0;
    const isDraftLocked = draftLockMessages.length > 0;
    const isProductStructureReadOnly =
        isDraftLocked || stagedDeletions.length > 0;
    const originalVariantDraft = createProductUpdateDraft(product).variants;
    const hasStructuralChanges =
        JSON.stringify(draft.variants) !== JSON.stringify(originalVariantDraft);
    const saveDisabled =
        hasErrors ||
        (isDraftLocked &&
            (hasStructuralChanges || stagedDeletions.length > 0)) ||
        stagedDeletions.some(({ deletion }) => deletion.reason.trim() === "");
    const orderedVariants = initialVariantId
        ? [...draft.variants].sort((first, second) =>
            first.id === initialVariantId
                ? -1
                : second.id === initialVariantId
                    ? 1
                    : 0
        )
        : draft.variants;

    function variantInventoryRecords(variantId: string) {
        return inventoryRecords.filter(
            (record) =>
                record.productId === product.id &&
                record.variantId === variantId
        );
    }

    function getBatch(variantId: string, batchId: string | null) {
        if (batchId === null) {
            return undefined;
        }

        const matches = inventoryBatches.filter(
            (candidate) =>
                candidate.batchId === batchId &&
                candidate.productId === product.id &&
                candidate.variantId === variantId
        );
        return matches.length === 1 ? matches[0] : undefined;
    }

    function batchLabel(variantId: string, batchId: string | null): string {
        if (batchId === null) {
            return "Unbatched stock";
        }

        return getBatch(variantId, batchId)?.batchNumber ??
            (getBatch(variantId, batchId)
                ? "Batch number not set"
                : "Batch details unavailable");
    }

    function canManageStock(variantId: string, record: inventory): boolean {
        return resolveInventoryManageTarget(
            createInventoryManageIntent(
                product.id,
                variantId,
                record.id,
                record.batchId
            ),
            [product],
            inventoryRecords,
            inventoryBatches
        ) !== undefined;
    }

    function updateDraft(update: (current: ProductUpdateDraft) => ProductUpdateDraft) {
        setDraft(update);
        setSaveError(null);
    }

    function addVariant() {
        try {
            updateDraft((current) => addVariantToUpdateDraft(current));
        } catch (error) {
            setSaveError(
                error instanceof Error
                    ? error.message
                    : "A new variant could not be added."
            );
        }
    }

    function addPackagingLevel(variantIndex: number) {
        try {
            updateDraft((current) =>
                addPackagingLevelToUpdateDraft(current, variantIndex)
            );
        } catch (error) {
            setSaveError(
                error instanceof Error
                    ? error.message
                    : "A packaging level could not be added."
            );
        }
    }

    function requestDeletion(deletion: ProductRecordDeletionDraft) {
        if (isDraftLocked) {
            setSaveError(draftLockMessages.join(" "));
            return;
        }
        if (hasStructuralChanges) {
            setSaveError(
                "Save or cancel product structure changes before staging a deletion."
            );
            return;
        }
        const alreadyStaged = stagedDeletions.some(({ deletion: staged }) =>
            staged.variantId === deletion.variantId &&
            (staged.type === "variant" ||
                (deletion.type === "packaging" &&
                    staged.packagingLevelId === deletion.packagingLevelId))
        );
        if (alreadyStaged) {
            return;
        }
        setSaveError(null);
        setPendingDeletion(deletion);
    }

    function confirmDeletion() {
        if (!pendingDeletion) {
            return;
        }
        if (isDraftLocked) {
            setPendingDeletion(null);
            setSaveError(draftLockMessages.join(" "));
            return;
        }
        setStagedDeletions((current) => [
            ...current,
            { id: crypto.randomUUID(), deletion: pendingDeletion }
        ]);
        setPendingDeletion(null);
    }

    function updateDeletionReason(id: string, reason: string) {
        setStagedDeletions((current) => current.map((staged) =>
            staged.id === id
                ? { ...staged, deletion: { ...staged.deletion, reason } }
                : staged
        ));
        setSaveError(null);
    }

    function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (
            isDraftLocked &&
            (hasStructuralChanges || stagedDeletions.length > 0)
        ) {
            setSaveError(draftLockMessages.join(" "));
            return;
        }
        if (hasErrors) {
            return;
        }
        if (stagedDeletions.some(({ deletion }) => deletion.reason.trim() === "")) {
            return;
        }

        try {
            const updatedProduct = buildUpdatedProduct(product, draft);
            let nextInventoryRecords = [...inventoryRecords];
            const nextInventoryBatches = [...inventoryBatches];

            for (const productVariant of draft.variants) {
                const originalVariant = product.variant.find(
                    (item) => item.id === productVariant.id
                );
                if (!originalVariant) {
                    continue;
                }
                const existingIds = new Set(
                    originalVariant.packagingHierarchy.map((level) => level.id)
                );

                for (const level of productVariant.packaging) {
                    if (existingIds.has(level.id)) {
                        continue;
                    }

                    nextInventoryRecords = applyPackagingLevelInitialStock(
                        product,
                        nextInventoryRecords,
                        nextInventoryBatches,
                        productVariant.id,
                        level.id,
                        level.initialStock ?? "0",
                        level.initialStockBatchId?.trim() || null
                    );
                }
            }

            for (const record of nextInventoryRecords) {
                if (record.productId === product.id) {
                    validateInventoryPackagingRelationships(
                        updatedProduct,
                        record
                    );
                }
            }
            onSave(
                updatedProduct,
                draft.reason.trim(),
                nextInventoryRecords,
                nextInventoryBatches,
                stagedDeletions.map(({ deletion }) => ({
                    ...deletion,
                    reason: deletion.reason.trim()
                }))
            );
            onClose();
        } catch (error) {
            setSaveError(
                error instanceof Error
                    ? error.message
                    : "The product could not be updated."
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
                aria-labelledby="product-edit-title"
                aria-modal="true"
                className="inventory-modal product-edit-modal"
                role="dialog"
            >
                <header className="inventory-modal-header">
                    <div>
                        <h2 id="product-edit-title">Edit Product</h2>
                        <p>{product.name}</p>
                    </div>
                    <button
                        aria-label="Close product editor"
                        className="modal-close-button"
                        onClick={onClose}
                        type="button"
                    >
                        &times;
                    </button>
                </header>

                <form onSubmit={handleSubmit}>
                    <div className="inventory-modal-content product-edit-content">
                        <section className="product-edit-section">
                            <h3 className="modal-section-title">
                                Product information
                            </h3>
                            <label className="product-edit-field">
                                Product name
                                <input
                                    autoComplete="off"
                                    onChange={(event) => updateDraft((current) => ({
                                        ...current,
                                        name: event.target.value
                                    }))}
                                    value={draft.name}
                                />
                                {fieldError(errors, "name")}
                            </label>
                            <label className="product-edit-field">
                                Description
                                <textarea
                                    onChange={(event) => updateDraft((current) => ({
                                        ...current,
                                        description: event.target.value
                                    }))}
                                    rows={2}
                                    value={draft.description}
                                />
                            </label>
                            <div className="product-edit-field-grid">
                                <label className="product-edit-field">
                                    Generic name
                                    <input
                                        onChange={(event) => updateDraft((current) => ({
                                            ...current,
                                            genericName: event.target.value
                                        }))}
                                        value={draft.genericName}
                                    />
                                </label>
                                <label className="product-edit-field">
                                    Manufacturer
                                    <input
                                        onChange={(event) => updateDraft((current) => ({
                                            ...current,
                                            manufacturer: event.target.value
                                        }))}
                                        value={draft.manufacturer}
                                    />
                                </label>
                                <label className="product-edit-field">
                                    Category
                                    <input
                                        onChange={(event) => updateDraft((current) => ({
                                            ...current,
                                            category: event.target.value
                                        }))}
                                        value={draft.category}
                                    />
                                </label>
                            </div>
                        </section>

                        <section className="product-edit-section">
                            <div className="product-edit-packaging-heading">
                                <h3 className="modal-section-title">
                                    Variants and packaging
                                </h3>
                                <button
                                    className="secondary-button"
                                    onClick={addVariant}
                                    disabled={isProductStructureReadOnly}
                                    type="button"
                                >
                                    Add variant
                                </button>
                            </div>
                            {fieldError(errors, "variants")}
                            {orderedVariants.map((productVariant) => {
                                const variantIndex = draft.variants.findIndex(
                                    (item) => item.id === productVariant.id
                                );
                                const variantPrefix = `variants.${variantIndex}`;
                                const variantErrors = Object.entries(errors).filter(
                                    ([key]) => key.startsWith(
                                        `${variantPrefix}.packaging`
                                    )
                                );
                                return (
                                    <section
                                        className="product-edit-variant"
                                        key={productVariant.id}
                                    >
                                        <div className="product-edit-variant-heading">
                                            <h4>{productVariant.name || "New variant"}</h4>
                                            {product.variant.some(
                                                (item) => item.id === productVariant.id
                                            ) && (
                                                <button
                                                    className="product-delete-button"
                                                    disabled={
                                                        isDraftLocked ||
                                                        stagedDeletions.some(
                                                            ({ deletion }) =>
                                                                deletion.variantId === productVariant.id
                                                        )
                                                    }
                                                    onClick={() => requestDeletion({
                                                        type: "variant",
                                                        variantId: productVariant.id,
                                                        reason: ""
                                                    })}
                                                    type="button"
                                                >
                                                    Delete Variant
                                                </button>
                                            )}
                                        </div>
                                        <label className="product-edit-field">
                                            Variant name
                                            <input
                                                disabled={isProductStructureReadOnly}
                                                onChange={(event) => updateDraft((current) =>
                                                    updateVariant(
                                                        current,
                                                        variantIndex,
                                                        (item) => ({
                                                            ...item,
                                                            name: event.target.value
                                                        })
                                                    )
                                                )}
                                                value={productVariant.name}
                                            />
                                            {fieldError(
                                                errors,
                                                `${variantPrefix}.name`
                                            )}
                                        </label>
                                        <label className="product-edit-field">
                                            NAFDAC registration number
                                            <input
                                                disabled={isProductStructureReadOnly}
                                                onChange={(event) => updateDraft((current) =>
                                                    updateVariant(
                                                        current,
                                                        variantIndex,
                                                        (item) => ({
                                                            ...item,
                                                            nafdacRegistrationNumber:
                                                                event.target.value
                                                        })
                                                    )
                                                )}
                                                value={productVariant.nafdacRegistrationNumber}
                                            />
                                        </label>
                                        <div className="product-edit-inventory">
                                            <h5>Inventory (read only)</h5>
                                            {variantInventoryRecords(productVariant.id).length === 0 ? (
                                                <p className="product-edit-help">
                                                    No inventory records for this variant.
                                                </p>
                                            ) : (
                                                variantInventoryRecords(productVariant.id).map((record) => (
                                                    <div
                                                        className="product-edit-inventory-record"
                                                        key={record.id}
                                                    >
                                                        <span>
                                                            {batchLabel(
                                                                productVariant.id,
                                                                record.batchId
                                                            )}
                                                        </span>
                                                        {getBatch(
                                                            productVariant.id,
                                                            record.batchId
                                                        )?.expiryDate && (
                                                            <span>
                                                                Expires {getBatch(
                                                                    productVariant.id,
                                                                    record.batchId
                                                                )?.expiryDate?.toLocaleDateString()}
                                                            </span>
                                                        )}
                                                        <span>
                                                            {record.stockQuantities.map((stock) => {
                                                                const level = productVariant.packaging.find(
                                                                    (candidate) => candidate.id === stock.packagingLevelId
                                                                );
                                                                return `${stock.quantity} ${level?.name ?? "Unknown"}`;
                                                            }).join(", ")}
                                                        </span>
                                                        {canManageStock(productVariant.id, record) && (
                                                            <button
                                                                className="secondary-button"
                                                                disabled={isProductStructureReadOnly}
                                                                onClick={() => onManageStock(
                                                                    productVariant.id,
                                                                    record.id,
                                                                    record.batchId
                                                                )}
                                                                type="button"
                                                            >
                                                                Manage Stock
                                                            </button>
                                                        )}
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                        <div className="product-edit-packaging-heading">
                                            <h5>Packaging hierarchy</h5>
                                            <button
                                                className="secondary-button"
                                                disabled={isProductStructureReadOnly}
                                                onClick={() => addPackagingLevel(variantIndex)}
                                                type="button"
                                            >
                                                Add packaging level
                                            </button>
                                        </div>
                                        {variantErrors.map(([key, message]) => (
                                            <p className="product-edit-error" key={key}>
                                                {message}
                                            </p>
                                        ))}
                                        {productVariant.packaging.length === 0 && (
                                            <p className="product-edit-help">
                                                No packaging levels defined.
                                            </p>
                                        )}
                                        {productVariant.packaging.map((level, levelIndex) => {
                                            const levelPrefix =
                                                `${variantPrefix}.packaging.${levelIndex}`;
                                            return (
                                                <article
                                                    className="product-edit-packaging"
                                                    key={level.id}
                                                >
                                                    <div className="product-edit-packaging-heading">
                                                        <strong>
                                                            {level.name || "Packaging level"}
                                                        </strong>
                                                        {productVariant.packaging.some(
                                                            (item) => item.id === level.id
                                                        ) && (
                                                            <button
                                                                className="secondary-button"
                                                                disabled={
                                                                    isDraftLocked ||
                                                                    stagedDeletions.some(
                                                                        ({ deletion }) =>
                                                                            deletion.variantId === productVariant.id
                                                                    )
                                                                }
                                                                onClick={() => requestDeletion({
                                                                    type: "packaging",
                                                                    variantId: productVariant.id,
                                                                    packagingLevelId: level.id,
                                                                    reason: ""
                                                                })}
                                                                type="button"
                                                            >
                                                                Delete Packaging Level
                                                            </button>
                                                        )}
                                                    </div>
                                                    <div className="product-edit-field-grid">
                                                        <label className="product-edit-field">
                                                            Packaging level name
                                                            <input
                                                                disabled={isProductStructureReadOnly}
                                                                onChange={(event) => updateDraft((current) =>
                                                                    updateVariant(
                                                                        current,
                                                                        variantIndex,
                                                                        (item) => updatePackaging(
                                                                            item,
                                                                            levelIndex,
                                                                            (packaging) => ({
                                                                                ...packaging,
                                                                                name: event.target.value
                                                                            })
                                                                        )
                                                                    )
                                                                )}
                                                                value={level.name}
                                                            />
                                                            {fieldError(
                                                                errors,
                                                                `${levelPrefix}.name`
                                                            )}
                                                        </label>
                                                        <label className="product-edit-field">
                                                            Next packaging level
                                                            <select
                                                                disabled={isProductStructureReadOnly}
                                                                onChange={(event) => updateDraft((current) =>
                                                                    updateVariant(
                                                                        current,
                                                                        variantIndex,
                                                                        (item) => updatePackaging(
                                                                            item,
                                                                            levelIndex,
                                                                            (packaging) => ({
                                                                                ...packaging,
                                                                                nextLevelId: event.target.value,
                                                                                quantityofNextLevel:
                                                                                    event.target.value === ""
                                                                                        ? ""
                                                                                        : packaging.quantityofNextLevel
                                                                            })
                                                                        )
                                                                    )
                                                                )}
                                                                value={level.nextLevelId}
                                                            >
                                                                <option value="">
                                                                    Lowest packaging level
                                                                </option>
                                                                {productVariant.packaging
                                                                    .filter((candidate) =>
                                                                        candidate.id !== level.id
                                                                    )
                                                                    .map((candidate) => (
                                                                        <option
                                                                            key={candidate.id}
                                                                            value={candidate.id}
                                                                        >
                                                                            {candidate.name || "Unnamed packaging"}
                                                                        </option>
                                                                    ))}
                                                            </select>
                                                        </label>
                                                        <label className="product-edit-field">
                                                            Quantity of next level
                                                            <input
                                                                disabled={isProductStructureReadOnly || level.nextLevelId === ""}
                                                                min="1"
                                                                onChange={(event) => updateDraft((current) =>
                                                                    updateVariant(
                                                                        current,
                                                                        variantIndex,
                                                                        (item) => updatePackaging(
                                                                            item,
                                                                            levelIndex,
                                                                            (packaging) => ({
                                                                                ...packaging,
                                                                                quantityofNextLevel:
                                                                                    event.target.value
                                                                            })
                                                                        )
                                                                    )
                                                                )}
                                                                type="number"
                                                                value={level.quantityofNextLevel}
                                                            />
                                                            {fieldError(
                                                                errors,
                                                                `${levelPrefix}.quantityofNextLevel`
                                                            )}
                                                        </label>
                                                        <label className="product-edit-field">
                                                            Cost price
                                                            <input
                                                                disabled={isProductStructureReadOnly}
                                                                min="0"
                                                                onChange={(event) => updateDraft((current) =>
                                                                    updateVariant(
                                                                        current,
                                                                        variantIndex,
                                                                        (item) => updatePackaging(
                                                                            item,
                                                                            levelIndex,
                                                                            (packaging) => ({
                                                                                ...packaging,
                                                                                costPrice: event.target.value
                                                                            })
                                                                        )
                                                                    )
                                                                )}
                                                                step="any"
                                                                type="number"
                                                                value={level.costPrice}
                                                            />
                                                            {fieldError(
                                                                errors,
                                                                `${levelPrefix}.costPrice`
                                                            )}
                                                        </label>
                                                        <label className="product-edit-field">
                                                            Selling price
                                                            <input
                                                                disabled={isProductStructureReadOnly}
                                                                min="0"
                                                                onChange={(event) => updateDraft((current) =>
                                                                    updateVariant(
                                                                        current,
                                                                        variantIndex,
                                                                        (item) => updatePackaging(
                                                                            item,
                                                                            levelIndex,
                                                                            (packaging) => ({
                                                                                ...packaging,
                                                                                sellingPrice: event.target.value
                                                                            })
                                                                        )
                                                                    )
                                                                )}
                                                                step="any"
                                                                type="number"
                                                                value={level.sellingPrice}
                                                            />
                                                            {fieldError(
                                                                errors,
                                                                `${levelPrefix}.sellingPrice`
                                                            )}
                                                        </label>
                                                        <label className="product-edit-field">
                                                            Initial stock quantity
                                                            <input
                                                                disabled={isProductStructureReadOnly}
                                                                min="0"
                                                                onChange={(event) => updateDraft((current) =>
                                                                    updateVariant(
                                                                        current,
                                                                        variantIndex,
                                                                        (item) => updatePackaging(
                                                                            item,
                                                                            levelIndex,
                                                                            (packaging) => ({
                                                                                ...packaging,
                                                                                initialStock: event.target.value
                                                                            })
                                                                        )
                                                                    )
                                                                )}
                                                                step="1"
                                                                type="number"
                                                                value={level.initialStock}
                                                            />
                                                            {fieldError(
                                                                errors,
                                                                `${levelPrefix}.initialStock`
                                                            )}
                                                        </label>
                                                        {inventoryBatches.some(
                                                            (batch) =>
                                                                batch.productId === product.id &&
                                                                batch.variantId === productVariant.id
                                                        ) && (
                                                            <label className="product-edit-field">
                                                                Initial stock batch
                                                                <select
                                                                    disabled={isProductStructureReadOnly}
                                                                    onChange={(event) => updateDraft((current) =>
                                                                        updateVariant(
                                                                            current,
                                                                            variantIndex,
                                                                            (item) => updatePackaging(
                                                                                item,
                                                                                levelIndex,
                                                                                (packaging) => ({
                                                                                    ...packaging,
                                                                                    initialStockBatchId: event.target.value
                                                                                })
                                                                            )
                                                                        )
                                                                    )}
                                                                    value={
                                                                        level.initialStockBatchId ||
                                                                        inventoryBatches.find(
                                                                            (batch) =>
                                                                                batch.productId === product.id &&
                                                                                batch.variantId === productVariant.id
                                                                        )?.batchId || ""
                                                                    }
                                                                >
                                                                    <option value="">Unbatched stock</option>
                                                                    {inventoryBatches
                                                                        .filter(
                                                                            (batch) =>
                                                                                batch.productId === product.id &&
                                                                                batch.variantId === productVariant.id
                                                                        )
                                                                        .map((batch) => (
                                                                            <option
                                                                                key={batch.batchId}
                                                                                value={batch.batchId}
                                                                            >
                                                                                {batch.batchNumber ?? "Batch"}
                                                                            </option>
                                                                        ))}
                                                                </select>
                                                            </label>
                                                        )}
                                                    </div>
                                                </article>
                                            );
                                        })}
                                    </section>
                                );
                            })}
                        </section>

                        <label className="product-edit-field">
                            Reason for update
                            <textarea
                                onChange={(event) => updateDraft((current) => ({
                                    ...current,
                                    reason: event.target.value
                                }))}
                                rows={3}
                                value={draft.reason}
                            />
                            {fieldError(errors, "reason")}
                        </label>

                        {stagedDeletions.length > 0 && (
                            <section aria-label="Staged deletions">
                                <h3 className="modal-section-title">Staged deletions</h3>
                                {stagedDeletions.map(({ id, deletion }) => {
                                    const productVariant = product.variant.find(
                                        (item) => item.id === deletion.variantId
                                    );
                                    const packagingName =
                                        deletion.type === "packaging"
                                            ? productVariant?.packagingHierarchy.find(
                                                (level) =>
                                                    level.id === deletion.packagingLevelId
                                            )?.name ?? "packaging level"
                                            : null;
                                    const targetName = deletion.type === "variant"
                                        ? productVariant?.variantName ?? "variant"
                                        : `${packagingName} packaging level`;
                                    return (
                                        <label className="product-edit-field" key={id}>
                                            Reason for deleting {targetName}
                                            <textarea
                                                aria-label={`Reason for deleting ${targetName}`}
                                                onChange={(event) => updateDeletionReason(
                                                    id,
                                                    event.target.value
                                                )}
                                                rows={2}
                                                value={deletion.reason}
                                            />
                                        </label>
                                    );
                                })}
                            </section>
                        )}

                        {saveError && (
                            <p className="product-edit-save-error" role="alert">
                                {saveError}
                            </p>
                        )}
                        {isDraftLocked && (
                            <p className="product-edit-save-error" role="alert">
                                {draftLockMessages.join(" ")}
                            </p>
                        )}
                    </div>

                    <footer className="product-edit-footer">
                        <button
                            className="secondary-button"
                            onClick={onClose}
                            type="button"
                        >
                            Cancel
                        </button>
                        <button
                            className="primary-button"
                            disabled={saveDisabled}
                            type="submit"
                        >
                            Save Changes
                        </button>
                    </footer>
                </form>
            </section>
            {pendingDeletion && (
                <div className="inventory-modal-overlay">
                    <section
                        aria-labelledby="product-record-deletion-title"
                        aria-modal="true"
                        className="inventory-modal product-deletion-dialog"
                        role="alertdialog"
                    >
                        {(() => {
                            const productVariant = product.variant.find(
                                (item) => item.id === pendingDeletion.variantId
                            );
                            const packagingLevel =
                                pendingDeletion.type === "packaging"
                                    ? productVariant?.packagingHierarchy.find(
                                        (level) =>
                                            level.id === pendingDeletion.packagingLevelId
                                    )
                                    : undefined;
                            const targetLabel =
                                pendingDeletion.type === "variant"
                                    ? productVariant?.variantName ?? "variant"
                                    : `${packagingLevel?.name ?? "packaging level"} packaging level`;
                            return (
                                <>
                        <div className="inventory-modal-header">
                            <h2 id="product-record-deletion-title">
                                Delete {targetLabel}?
                            </h2>
                        </div>
                        <div className="inventory-modal-content">
                            <p>
                                {pendingDeletion.type === "variant"
                                    ? `${targetLabel}, its batches, inventory records, and stock quantities will be deleted when you save these changes.`
                                    : `${targetLabel} and its associated stock quantities will be deleted when you save these changes.`}
                            </p>
                            {isDraftLocked && (
                                <p role="alert">{draftLockMessages.join(" ")}</p>
                            )}
                            <div className="product-deletion-actions">
                                <button
                                    className="secondary-button"
                                    onClick={() => setPendingDeletion(null)}
                                    type="button"
                                >
                                    Cancel
                                </button>
                                <button
                                    className="product-delete-button"
                                    disabled={isDraftLocked}
                                    onClick={confirmDeletion}
                                    type="button"
                                >
                                    Confirm Delete
                                </button>
                            </div>
                        </div>
                                </>
                            );
                        })()}
                    </section>
                </div>
            )}
        </div>
    );
}
