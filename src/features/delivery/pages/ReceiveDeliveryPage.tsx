import { useState } from "react";
import type { inventory } from "../../../inventory/inventoryStock";
import type { inventoryBatch } from "../../../inventory/inventoryBatch";
import type { productStructure, variant } from "../../../products/productStructure";
import { validatePackagingHierarchy } from "../../../packaging/packagingValidation";
import {
    addDeliveryDraftItem,
    createDeliveryDraft,
    removeDeliveryDraftItem,
    updateDeliveryDraftItem,
    updateDeliveryDraftDetails,
    type DeliveryDraft,
    type DeliveryDraftDetailsChanges,
    type DeliveryDraftItem,
    type DeliveryDraftItemChanges
} from "../../../deliveries/deliveryDraft";
import CreateProductModal from "../../products/components/CreateProductModal";
import AddDeliveryVariantModal from "../components/AddDeliveryVariantModal";
import ReceiveDeliveryItemModal from "../components/ReceiveDeliveryItemModal";
import "./ReceiveDeliveryPage.css";

interface ReceiveDeliveryPageProps {
    products: productStructure[];
    inventoryRecords: inventory[];
    inventoryBatches: inventoryBatch[];
    deliveryDrafts: DeliveryDraft[];
    onCatalogueProductCreated: (product: productStructure) => void;
    onVariantCreated: (productId: string, productVariant: variant) => void;
    onDraftCreated: (draft: DeliveryDraft) => void;
    onDraftDetailsUpdated: (
        deliveryId: string,
        changes: DeliveryDraftDetailsChanges,
        updatedAt: string
    ) => void;
    onDraftItemAdded: (
        deliveryId: string,
        item: DeliveryDraftItem,
        updatedAt: string
    ) => void;
    onDraftItemUpdated: (
        deliveryId: string,
        deliveryItemId: string,
        changes: DeliveryDraftItemChanges,
        updatedAt: string
    ) => void;
    onDraftItemRemoved: (
        deliveryId: string,
        deliveryItemId: string,
        updatedAt: string
    ) => void;
    onApproveDelivery: (
        deliveryId: string
    ) => { success: true } | { success: false; error: string };
}

interface DeliveryHeaderForm {
    supplier: string;
    invoiceNumber: string;
    deliveryDate: string;
    receivedBy: string;
}

type HeaderField = keyof DeliveryHeaderForm;
type HeaderErrors = Partial<Record<HeaderField, string>>;

function localDateToday(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function formFromDraft(draft: DeliveryDraft | undefined): DeliveryHeaderForm {
    return {
        supplier: draft?.supplier ?? "",
        invoiceNumber: draft?.invoiceNumber ?? "",
        deliveryDate: draft?.deliveryDate ?? localDateToday(),
        receivedBy: draft?.receivedBy ?? ""
    };
}

function errorField(message: string): HeaderField | undefined {
    if (message.includes("Delivery date")) {
        return "deliveryDate";
    }
    if (message.includes("Received by")) {
        return "receivedBy";
    }
    if (message.includes("Supplier")) {
        return "supplier";
    }
    if (message.includes("Invoice number")) {
        return "invoiceNumber";
    }
    return undefined;
}

function validateItemRelationships(
    item: DeliveryDraftItem,
    products: readonly productStructure[]
): void {
    const productMatches = products.filter(
        (candidate) => candidate.id === item.productId
    );
    if (productMatches.length !== 1) {
        throw new Error("The selected product is no longer available.");
    }

    const variantMatches = productMatches[0].variant.filter(
        (candidate) => candidate.id === item.variantId
    );
    if (variantMatches.length !== 1) {
        throw new Error("The selected variant does not belong to this product.");
    }

    const productVariant = variantMatches[0];
    validatePackagingHierarchy(productVariant.packagingHierarchy);
    if (!productVariant.packagingHierarchy.some(
        (level) => level.id === item.packagingLevelId
    )) {
        throw new Error(
            "The selected packaging level does not belong to this variant."
        );
    }
}

export default function ReceiveDeliveryPage({
    products,
    inventoryRecords,
    inventoryBatches,
    deliveryDrafts,
    onCatalogueProductCreated,
    onVariantCreated,
    onDraftCreated,
    onDraftDetailsUpdated,
    onDraftItemAdded,
    onDraftItemUpdated,
    onDraftItemRemoved,
    onApproveDelivery
}: ReceiveDeliveryPageProps) {
    const initialDraft = deliveryDrafts.find(
        (draft) => draft.status === "draft"
    ) ?? deliveryDrafts[0];
    const [selectedDeliveryId, setSelectedDeliveryId] = useState(
        initialDraft?.deliveryId ?? ""
    );
    const [isNewDeliveryEntry, setIsNewDeliveryEntry] = useState(
        deliveryDrafts.length === 0
    );
    const [form, setForm] = useState(() => formFromDraft(initialDraft));
    const [errors, setErrors] = useState<HeaderErrors>({});
    const [formMessage, setFormMessage] = useState("");
    const [productSearch, setProductSearch] = useState("");
    const [showProductResults, setShowProductResults] = useState(false);
    const [selectedProductId, setSelectedProductId] = useState("");
    const [selectedVariantId, setSelectedVariantId] = useState("");
    const [isCreatingProduct, setIsCreatingProduct] = useState(false);
    const [isAddingVariant, setIsAddingVariant] = useState(false);
    const [isReceivingItem, setIsReceivingItem] = useState(false);
    const [editingItem, setEditingItem] = useState<DeliveryDraftItem>();
    const [isApproving, setIsApproving] = useState(false);

    const selectedDraft = deliveryDrafts.find(
        (draft) => draft.deliveryId === selectedDeliveryId
    );
    const selectedProduct = products.find(
        (product) => product.id === selectedProductId
    );
    const selectedVariant = selectedProduct?.variant.find(
        (productVariant) => productVariant.id === selectedVariantId
    );
    const editingProduct = editingItem
        ? products.find((product) => product.id === editingItem.productId)
        : undefined;
    const editingVariant = editingProduct?.variant.find(
        (productVariant) => productVariant.id === editingItem?.variantId
    );
    const modalProduct = editingItem ? editingProduct : selectedProduct;
    const modalVariant = editingItem ? editingVariant : selectedVariant;
    const matchingProducts = productSearch.trim() === ""
        ? []
        : products.filter((product) =>
            product.name.toLocaleLowerCase().includes(
                productSearch.trim().toLocaleLowerCase()
            )
        );
    const canEditHeader = isNewDeliveryEntry || selectedDraft?.status === "draft";
    const canAddItems = isNewDeliveryEntry || selectedDraft?.status === "draft";

    function nextUpdatedAt(draft: DeliveryDraft): string {
        const now = new Date().toISOString();
        return now > draft.updatedAt
            ? now
            : new Date(Date.parse(draft.updatedAt) + 1).toISOString();
    }

    function updateField(field: HeaderField, value: string) {
        setForm((current) => ({ ...current, [field]: value }));
        setErrors((current) => ({ ...current, [field]: undefined }));
        setFormMessage("");
        if (selectedDraft?.status === "draft") {
            try {
                const changes: DeliveryDraftDetailsChanges = {
                    [field]: value
                };
                const updatedAt = nextUpdatedAt(selectedDraft);
                updateDeliveryDraftDetails(selectedDraft, changes, updatedAt);
                onDraftDetailsUpdated(
                    selectedDraft.deliveryId,
                    changes,
                    updatedAt
                );
            } catch (error) {
                setFormMessage(error instanceof Error
                    ? error.message
                    : "The delivery information could not be updated.");
            }
        }
    }

    function selectProduct(product: productStructure) {
        setSelectedProductId(product.id);
        setSelectedVariantId("");
        setEditingItem(undefined);
        setIsReceivingItem(false);
        setProductSearch("");
        setShowProductResults(false);
    }

    function handleCatalogueProductCreated(product: productStructure) {
        onCatalogueProductCreated(product);
        setSelectedProductId(product.id);
        setSelectedVariantId("");
        setEditingItem(undefined);
        setIsReceivingItem(false);
        setProductSearch("");
        setShowProductResults(false);
        setIsCreatingProduct(false);
    }

    function selectVariant(variantId: string) {
        const isValidVariant = canAddItems && (selectedProduct?.variant.some(
            (productVariant) => productVariant.id === variantId
        ) ?? false);
        setSelectedVariantId(isValidVariant ? variantId : "");
        setEditingItem(undefined);
        setIsReceivingItem(isValidVariant);
    }

    function handleVariantCreated(productVariant: variant) {
        if (!selectedProduct || !canAddItems) {
            return;
        }
        onVariantCreated(selectedProduct.id, productVariant);
        setSelectedVariantId(productVariant.id);
        setEditingItem(undefined);
        setIsReceivingItem(true);
        setIsAddingVariant(false);
    }

    function handleApproveDelivery() {
        if (!selectedDraft || selectedDraft.status !== "draft" || isApproving) {
            return;
        }
        setIsApproving(true);
        setErrors({});
        setFormMessage("");
        try {
            const result = onApproveDelivery(selectedDraft.deliveryId);
            if (result.success) {
                return;
            }
            const field = errorField(result.error);
            if (field) {
                setErrors({ [field]: result.error });
                setFormMessage("");
            } else {
                setFormMessage(result.error);
            }
        } finally {
            setIsApproving(false);
        }
    }

    function handleSaveItem(item: DeliveryDraftItem): string | undefined {
        try {
            validateItemRelationships(item, products);
            const updatedAt = selectedDraft
                ? nextUpdatedAt(selectedDraft)
                : new Date().toISOString();

            if (editingItem) {
                if (!selectedDraft || selectedDraft.status !== "draft") {
                    throw new Error("The delivery draft is no longer editable.");
                }
                const changes: DeliveryDraftItemChanges = {
                    productId: item.productId,
                    variantId: item.variantId,
                    packagingLevelId: item.packagingLevelId,
                    quantity: item.quantity,
                    batchNumber: item.batchNumber,
                    expiryDate: item.expiryDate
                };
                updateDeliveryDraftItem(
                    selectedDraft,
                    editingItem.deliveryItemId,
                    changes,
                    updatedAt
                );
                onDraftItemUpdated(
                    selectedDraft.deliveryId,
                    editingItem.deliveryItemId,
                    changes,
                    updatedAt
                );
            } else if (selectedDraft) {
                if (selectedDraft.status !== "draft") {
                    throw new Error("The delivery draft is no longer editable.");
                }
                addDeliveryDraftItem(selectedDraft, item, updatedAt);
                onDraftItemAdded(selectedDraft.deliveryId, item, updatedAt);
            } else {
                const draft = createDeliveryDraft({
                    deliveryDate: form.deliveryDate,
                    receivedBy: form.receivedBy,
                    supplier: form.supplier,
                    invoiceNumber: form.invoiceNumber
                });
                const draftWithFirstItem = addDeliveryDraftItem(
                    draft,
                    item,
                    draft.createdAt
                );
                onDraftCreated(draftWithFirstItem);
                setSelectedDeliveryId(draft.deliveryId);
                setIsNewDeliveryEntry(false);
                setForm(formFromDraft(draftWithFirstItem));
            }

            setEditingItem(undefined);
            setIsReceivingItem(false);
            setFormMessage("");
            return undefined;
        } catch (error) {
            return error instanceof Error
                ? error.message
                : "The delivery item could not be saved.";
        }
    }

    function handleRemoveItem(item: DeliveryDraftItem) {
        if (!selectedDraft || selectedDraft.status !== "draft") {
            setFormMessage("The delivery draft is no longer editable.");
            return;
        }
        try {
            const updatedAt = nextUpdatedAt(selectedDraft);
            removeDeliveryDraftItem(selectedDraft, item.deliveryItemId, updatedAt);
            onDraftItemRemoved(
                selectedDraft.deliveryId,
                item.deliveryItemId,
                updatedAt
            );
            setFormMessage("");
        } catch (error) {
            setFormMessage(error instanceof Error
                ? error.message
                : "The delivery item could not be removed.");
        }
    }

    const headerIsReadOnly = !canEditHeader;
    const status = selectedDraft?.status ?? "draft";

    return (
        <div className="receive-delivery-page">
            <header className="page-heading">
                <div>
                    <h2>Receive Delivery</h2>
                    <p>Prepare delivery details and review draft items.</p>
                </div>
            </header>

            <section aria-label="Delivery entry" className="delivery-entry">
                {selectedDraft && (
                    <p className="delivery-draft-notice" role="status">
                        {status === "draft"
                            ? "This delivery is a draft. Draft preparation does not change inventory."
                            : status === "received"
                                ? "Delivery received successfully. Inventory has been updated."
                                : `This delivery has ${status} status; its header is read-only.`}
                    </p>
                )}

                <form
                    aria-label="Delivery information"
                    className="delivery-header-card"
                    onSubmit={(event) => event.preventDefault()}
                >
                    <h3>Delivery information</h3>
                    <div className="delivery-header-fields">
                        <label className="delivery-field">
                            <span>Supplier</span>
                            <input
                                aria-invalid={Boolean(errors.supplier)}
                                aria-describedby={errors.supplier ? "delivery-supplier-error" : undefined}
                                disabled={headerIsReadOnly}
                                onChange={(event) => updateField("supplier", event.target.value)}
                                value={form.supplier}
                            />
                            {errors.supplier && (
                                <span className="delivery-field-error" id="delivery-supplier-error">
                                    {errors.supplier}
                                </span>
                            )}
                        </label>
                        <label className="delivery-field">
                            <span>Invoice Number</span>
                            <input
                                aria-invalid={Boolean(errors.invoiceNumber)}
                                aria-describedby={errors.invoiceNumber ? "delivery-invoice-error" : undefined}
                                disabled={headerIsReadOnly}
                                onChange={(event) => updateField("invoiceNumber", event.target.value)}
                                value={form.invoiceNumber}
                            />
                            {errors.invoiceNumber && (
                                <span className="delivery-field-error" id="delivery-invoice-error">
                                    {errors.invoiceNumber}
                                </span>
                            )}
                        </label>
                        <label className="delivery-field">
                            <span>Delivery Date <span aria-hidden="true">*</span></span>
                            <input
                                aria-required="true"
                                aria-invalid={Boolean(errors.deliveryDate)}
                                aria-describedby={errors.deliveryDate ? "delivery-date-error" : undefined}
                                disabled={headerIsReadOnly}
                                onChange={(event) => updateField("deliveryDate", event.target.value)}
                                type="date"
                                value={form.deliveryDate}
                            />
                            {errors.deliveryDate && (
                                <span className="delivery-field-error" id="delivery-date-error">
                                    {errors.deliveryDate}
                                </span>
                            )}
                        </label>
                        <label className="delivery-field">
                            <span>Received By <span aria-hidden="true">*</span></span>
                            <input
                                aria-required="true"
                                aria-invalid={Boolean(errors.receivedBy)}
                                aria-describedby={errors.receivedBy ? "delivery-received-by-error" : undefined}
                                disabled={headerIsReadOnly}
                                onChange={(event) => updateField("receivedBy", event.target.value)}
                                value={form.receivedBy}
                            />
                            {errors.receivedBy && (
                                <span className="delivery-field-error" id="delivery-received-by-error">
                                    {errors.receivedBy}
                                </span>
                            )}
                        </label>
                    </div>
                    {formMessage && (
                        <p className="delivery-form-message" role="alert">
                            {formMessage}
                        </p>
                    )}
                </form>
                {isNewDeliveryEntry && (
                    <p className="delivery-draft-notice" role="status">
                        Delivery details are staged here. The draft will be created when its first item is added.
                    </p>
                )}

                <section aria-label="Product and variant selection" className="delivery-header-card">
                    <h3>Product selection</h3>
                    <div className="delivery-product-search">
                        <label className="delivery-field">
                            <span>Search products</span>
                            <input
                                aria-label="Search products"
                                autoComplete="off"
                                onChange={(event) => {
                                    setProductSearch(event.target.value);
                                    setShowProductResults(true);
                                }}
                                onFocus={() => setShowProductResults(true)}
                                placeholder="Search by product name"
                                role="combobox"
                                aria-expanded={showProductResults && productSearch.trim() !== ""}
                                aria-controls="delivery-product-results"
                                value={productSearch}
                            />
                        </label>
                        {showProductResults && productSearch.trim() !== "" && (
                            <div
                                className="delivery-product-results"
                                id="delivery-product-results"
                                role="listbox"
                            >
                                {matchingProducts.length > 0 ? (
                                    matchingProducts.map((product) => (
                                        <button
                                            aria-label={`Select product ${product.name}`}
                                            className="delivery-product-result"
                                            key={product.id}
                                            onClick={() => selectProduct(product)}
                                            role="option"
                                            type="button"
                                        >
                                            {product.name}
                                        </button>
                                    ))
                                ) : (
                                    <p className="delivery-product-no-results" role="status">
                                        No products match “{productSearch.trim()}”.
                                    </p>
                                )}
                                {matchingProducts.length === 0 && (
                                    <button
                                        className="delivery-primary-button"
                                        onClick={() => setIsCreatingProduct(true)}
                                        type="button"
                                    >
                                        Create New Product
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                    {selectedProduct && (
                        <p className="delivery-selected-product" role="status">
                            Selected product: <strong>{selectedProduct.name}</strong>
                        </p>
                    )}
                    {selectedProduct && (
                        <div className="delivery-variant-selection">
                            {selectedProduct.variant.length > 0 ? (
                                <label className="delivery-field">
                                    <span>Variant</span>
                                    <select
                                        aria-label="Select variant"
                                        disabled={!canAddItems}
                                        onChange={(event) => selectVariant(event.target.value)}
                                        value={selectedVariantId}
                                    >
                                        <option value="">Select a variant</option>
                                        {selectedProduct.variant.map((productVariant) => (
                                            <option
                                                key={productVariant.id}
                                                value={productVariant.id}
                                            >
                                                {productVariant.variantName}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            ) : (
                                <p className="delivery-product-no-results" role="status">
                                    This product has no variants yet.
                                </p>
                            )}
                            <button
                                className="delivery-secondary-button"
                                disabled={!canAddItems}
                                onClick={() => setIsAddingVariant(true)}
                                type="button"
                            >
                                Add Variant
                            </button>
                            {selectedVariantId && (
                                <p className="delivery-selected-variant" role="status">
                                    Selected variant: {selectedVariant?.variantName}
                                </p>
                            )}
                        </div>
                    )}
                </section>
            </section>

            {deliveryDrafts.length > 0 && (
                <section
                    aria-label="Current delivery draft"
                    className="delivery-items-card"
                >
                    <div className="delivery-items-heading">
                        <h3>Current delivery draft</h3>
                    </div>
                    {selectedDraft ? (
                        <>
                            <div className="delivery-items-heading">
                                <div>
                                    <h4>Items</h4>
                                    <p>
                                        {selectedDraft.items.length}{" "}
                                        {selectedDraft.items.length === 1 ? "item" : "items"}
                                    </p>
                                </div>
                                <span className="delivery-status-badge">
                                    {selectedDraft.status}
                                </span>
                            </div>
                            {selectedDraft.status === "draft" && (
                                <button
                                    className="delivery-primary-button"
                                    disabled={isApproving}
                                    onClick={handleApproveDelivery}
                                    type="button"
                                >
                                    {isApproving ? "Approving Delivery…" : "Approve Delivery"}
                                </button>
                            )}
                            {selectedDraft.items.length === 0 ? (
                                <p className="delivery-empty-state" role="status">
                                    No items have been added to this delivery draft yet.
                                </p>
                            ) : (
                                <ul className="delivery-item-list">
                                    {selectedDraft.items.map((item) => {
                                        const product = products.find(
                                            (candidate) => candidate.id === item.productId
                                        );
                                        const variant = product?.variant.find(
                                            (candidate) => candidate.id === item.variantId
                                        );
                                        const packaging = variant?.packagingHierarchy.find(
                                            (level) => level.id === item.packagingLevelId
                                        );
                                        return (
                                            <li key={item.deliveryItemId}>
                                                <strong>{product?.name ?? item.productId}</strong>
                                                <span>
                                                    {variant?.variantName ?? item.variantId}
                                                    {" · "}
                                                    {packaging?.name ?? item.packagingLevelId}
                                                    {" · "}
                                                    Quantity {item.quantity}
                                                </span>
                                                <span>
                                                    Batch {item.batchNumber ?? "not specified"}
                                                    {" · "}
                                                    Expiry {item.expiryDate ?? "not specified"}
                                                </span>
                                                {selectedDraft.status === "draft" && (
                                                    <div className="delivery-item-actions">
                                                        <button
                                                            className="delivery-secondary-button"
                                                            onClick={() => {
                                                                setEditingItem(item);
                                                                setIsReceivingItem(true);
                                                            }}
                                                            type="button"
                                                        >
                                                            Edit Item
                                                        </button>
                                                        <button
                                                            className="delivery-secondary-button"
                                                            onClick={() => handleRemoveItem(item)}
                                                            type="button"
                                                        >
                                                            Remove Item
                                                        </button>
                                                    </div>
                                                )}
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                            {selectedDraft.status === "draft" && (
                                <p className="delivery-inventory-notice">
                                    This is a draft only. Inventory and batch records remain unchanged until a future approval step.
                                </p>
                            )}
                        </>
                    ) : (
                        <p className="delivery-empty-state" role="status">
                            No delivery draft has been created. Add the first delivery item to create one.
                        </p>
                    )}
                </section>
            )}
            {isReceivingItem && modalProduct && modalVariant && (
                <ReceiveDeliveryItemModal
                    item={editingItem}
                    onClose={() => {
                        setEditingItem(undefined);
                        setIsReceivingItem(false);
                    }}
                    onSave={handleSaveItem}
                    product={modalProduct}
                    productVariant={modalVariant}
                />
            )}
            {isCreatingProduct && (
                <CreateProductModal
                    inventoryRecords={inventoryRecords}
                    inventoryBatches={inventoryBatches}
                    mode="catalogue"
                    onCreateCatalogue={handleCatalogueProductCreated}
                    onClose={() => setIsCreatingProduct(false)}
                    products={products}
                />
            )}
            {isAddingVariant && selectedProduct && (
                <AddDeliveryVariantModal
                    inventoryRecords={inventoryRecords}
                    inventoryBatches={inventoryBatches}
                    onClose={() => setIsAddingVariant(false)}
                    onCreate={handleVariantCreated}
                    product={selectedProduct}
                    products={products}
                />
            )}
        </div>
    );
}
