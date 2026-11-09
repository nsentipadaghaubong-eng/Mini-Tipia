import { useReducer, useRef, useState } from "react";
import type { productStructure, variant } from "../../../products/productStructure";
import type { inventory } from "../../../inventory/inventoryStock";
import type { inventoryBatch } from "../../../inventory/inventoryBatch";
import { getInventoryBatchById } from "../../../inventory/inventoryBatch";
import { getInventoryDisplay } from "../../../inventory/inventoryLookup";
import {
    addSaleDraftItem,
    createSaleDraft,
    updateSaleDraftDetails,
    updateSaleDraftItem,
    type SaleDraft,
    type SaleDraftDetailsChanges,
    type SaleDraftItem,
    type SaleDraftItemChanges
} from "../../../sales/salesDraft";
import {
    prepareSaleDraft
} from "../../../sales/salesEngine";
import SalesItemModal from "../components/SalesItemModal";
import {
    initialSalesSelection,
    salesSelectionReducer,
    searchProductsByName
} from "./salesProductSelection";
import "./SalesPage.css";

interface SalesPageProps {
    products: productStructure[];
    inventoryRecords: inventory[];
    inventoryBatches: inventoryBatch[];
    saleDrafts: SaleDraft[];
    onDraftCreated: (draft: SaleDraft) => void;
    onDraftDetailsUpdated: (
        draftId: string,
        changes: SaleDraftDetailsChanges,
        updatedAt: string
    ) => void;
    onDraftItemAdded: (
        draftId: string,
        item: SaleDraftItem,
        updatedAt: string
    ) => void;
    onDraftItemUpdated: (
        draftId: string,
        lineId: string,
        changes: SaleDraftItemChanges,
        updatedAt: string
    ) => void;
    onDraftItemRemoved: (
        draftId: string,
        lineId: string,
        updatedAt: string
    ) => void;
    onApproveSale: (
        draftId: string,
        confirmExpiredBatch: boolean
    ) => SaleApprovalResult;
}

export type SaleApprovalResult =
    | { success: true }
    | {
        success: false;
        error: string;
        requiresExpiredBatchConfirmation?: boolean;
    };

interface ActiveItemModal {
    productId: string;
    variantId: string;
    lineId?: string;
}

interface SaleInformation {
    customerName: string;
    customerAddress: string;
    date: string;
    receivedBy: string;
}

function localDateToday(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function saleDetailsChanges(
    information: SaleInformation,
    currentStaffMember?: SaleDraft["staffMember"]
): SaleDraftDetailsChanges {
    const userId = currentStaffMember?.userId;
    return {
        customerName: information.customerName,
        customerAddress: information.customerAddress,
        saleDate: information.date,
        staffMember: information.receivedBy.trim()
            ? {
                ...(userId ? { userId } : {}),
                displayName: information.receivedBy
            }
            : userId ? { userId } : null
    };
}

function nextDraftUpdatedAt(draft: SaleDraft): string {
    return new Date(Math.max(
        Date.now(),
        Date.parse(draft.updatedAt) + 1
    )).toISOString();
}

function roundMoney(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

export default function SalesPage({
    products,
    inventoryRecords,
    inventoryBatches,
    saleDrafts,
    onDraftCreated,
    onDraftDetailsUpdated,
    onDraftItemAdded,
    onDraftItemUpdated,
    onDraftItemRemoved,
    onApproveSale
}: SalesPageProps) {
    const currentDraft = saleDrafts.find((draft) => draft.status === "draft");
    const [selection, dispatchSelection] = useReducer(
        salesSelectionReducer,
        initialSalesSelection
    );
    const [saleInformation, setSaleInformation] = useState<SaleInformation>(() => ({
        customerName: currentDraft?.customerName ?? "",
        customerAddress: currentDraft?.customerAddress ?? "",
        date: currentDraft?.saleDate ?? localDateToday(),
        receivedBy: currentDraft?.staffMember?.displayName ?? ""
    }));
    const [productSearch, setProductSearch] = useState("");
    const [activeItemModal, setActiveItemModal] =
        useState<ActiveItemModal | null>(null);
    const [errorMessage, setErrorMessage] = useState("");
    const [confirmExpiredBatch, setConfirmExpiredBatch] = useState(false);
    const [approvalInProgress, setApprovalInProgress] = useState(false);
    const approvalLock = useRef(false);
    const searchRef = useRef<HTMLInputElement>(null);

    const selectedProduct = products.find(
        (product) => product.id === selection.productId
    );
    const matchingProducts = productSearch.trim()
        ? searchProductsByName(products, productSearch)
        : [];
    const modalProduct = activeItemModal
        ? products.find((product) => product.id === activeItemModal.productId)
        : undefined;
    const modalVariant: variant | undefined = modalProduct?.variant.find(
        (productVariant) => productVariant.id === activeItemModal?.variantId
    );
    const editingItem = activeItemModal?.lineId
        ? currentDraft?.items.find(
            (item) => item.lineId === activeItemModal.lineId
        )
        : undefined;

    function closeItemModal() {
        setActiveItemModal(null);
    }

    function returnToSearch() {
        setProductSearch("");
        dispatchSelection({ type: "product.selected", productId: "" });
        setActiveItemModal(null);
        setErrorMessage("");
        searchRef.current?.focus();
    }

    function updateSaleInformation(field: keyof SaleInformation, value: string) {
        const nextInformation = { ...saleInformation, [field]: value };
        setSaleInformation(nextInformation);
        if (field === "receivedBy" && value.trim()) {
            setErrorMessage("");
        }
        if (currentDraft) {
            const updatedAt = nextDraftUpdatedAt(currentDraft);
            const changes: SaleDraftDetailsChanges = field === "customerName"
                ? { customerName: value }
                : field === "customerAddress"
                    ? { customerAddress: value }
                    : field === "date"
                        ? { saleDate: value }
                        : {
                            staffMember: value.trim()
                                ? {
                                    ...(currentDraft.staffMember?.userId
                                        ? { userId: currentDraft.staffMember.userId }
                                        : {}),
                                    displayName: value
                                }
                                : currentDraft.staffMember?.userId
                                    ? { userId: currentDraft.staffMember.userId }
                                    : null
                        };
            onDraftDetailsUpdated(currentDraft.draftId, changes, updatedAt);
            return;
        }

        const draft = createSaleDraft();
        const updatedAt = nextDraftUpdatedAt(draft);
        onDraftCreated(updateSaleDraftDetails(
            draft,
            saleDetailsChanges(nextInformation),
            updatedAt
        ));
    }

    function saveItem(item: SaleDraftItem) {
        const isEditing = activeItemModal?.lineId !== undefined;
        const draft = currentDraft ?? createSaleDraft();
        const updatedAt = nextDraftUpdatedAt(draft);
        let candidateDraft: SaleDraft;

        try {
            const draftWithDetails = updateSaleDraftDetails(
                draft,
                saleDetailsChanges(saleInformation, draft.staffMember),
                updatedAt
            );
            if (isEditing) {
                if (!currentDraft || !activeItemModal?.lineId) {
                    throw new Error("The sale draft item is no longer available.");
                }
                const { lineId, ...changes } = item;
                candidateDraft = updateSaleDraftItem(
                    draftWithDetails,
                    lineId,
                    changes,
                    updatedAt
                );
            } else {
                candidateDraft = addSaleDraftItem(draftWithDetails, item, updatedAt);
            }
            prepareSaleDraft(candidateDraft, {
                products,
                inventoryRecords,
                inventoryBatches
            });
        } catch (error) {
            setErrorMessage(
                error instanceof Error
                    ? error.message
                    : "The sale item could not be validated."
            );
            return;
        }

        if (isEditing) {
            onDraftDetailsUpdated(
                candidateDraft.draftId,
                saleDetailsChanges(saleInformation, draft.staffMember),
                updatedAt
            );
            const { lineId, ...changes } = item;
            onDraftItemUpdated(
                candidateDraft.draftId,
                lineId,
                changes,
                updatedAt
            );
        } else {
            if (!currentDraft) {
                onDraftCreated(candidateDraft);
            } else {
                onDraftDetailsUpdated(
                    candidateDraft.draftId,
                    saleDetailsChanges(saleInformation, draft.staffMember),
                    updatedAt
                );
                onDraftItemAdded(candidateDraft.draftId, item, updatedAt);
            }
        }
        returnToSearch();
    }

    function editItem(item: SaleDraftItem) {
        setErrorMessage("");
        setActiveItemModal({
            productId: item.productId,
            variantId: item.variantId,
            lineId: item.lineId
        });
    }

    function removeItem(item: SaleDraftItem) {
        if (!currentDraft) {
            return;
        }
        onDraftItemRemoved(
            currentDraft.draftId,
            item.lineId,
            new Date().toISOString()
        );
    }

    function approveSale(confirmExpired = false) {
        if (!saleInformation.receivedBy.trim()) {
            setErrorMessage(
                "Please enter the name of the person who carried out this sale."
            );
            setConfirmExpiredBatch(false);
            return;
        }
        if (
            !currentDraft ||
            currentDraft.items.length === 0 ||
            approvalLock.current
        ) {
            return;
        }

        approvalLock.current = true;
        setApprovalInProgress(true);
        let result: SaleApprovalResult;
        try {
            result = onApproveSale(currentDraft.draftId, confirmExpired);
        } catch (error) {
            result = {
                success: false,
                error: error instanceof Error
                    ? error.message
                    : "The sale could not be approved."
            };
        } finally {
            approvalLock.current = false;
            setApprovalInProgress(false);
        }
        if (!result.success) {
            setConfirmExpiredBatch(
                result.requiresExpiredBatchConfirmation === true
            );
            setErrorMessage(
                result.requiresExpiredBatchConfirmation ? "" : result.error
            );
            return;
        }

        returnToSearch();
        setConfirmExpiredBatch(false);
    }

    const draftTotals = currentDraft?.items.reduce(
        (totals, item) => {
            const subtotal = roundMoney(
                item.appliedSellingPrice * item.quantity
            );
            totals.subtotal += subtotal;
            totals.discountAmount += item.discountAmount;
            totals.finalAmount += roundMoney(subtotal - item.discountAmount);
            return totals;
        },
        { subtotal: 0, discountAmount: 0, finalAmount: 0 }
    );

    return (
        <div className="sales-page">
            <header className="page-heading">
                <div>
                    <h2>Sales</h2>
                    <p>Search for a medicine to add it to the current sale.</p>
                </div>
            </header>

            <section className="sales-information" aria-label="Sale information">
                <label className="sales-field">
                    <span>Customer Name</span>
                    <input
                        onChange={(event) => updateSaleInformation(
                            "customerName",
                            event.target.value
                        )}
                        value={saleInformation.customerName}
                    />
                </label>
                <label className="sales-field">
                    <span>Customer Address</span>
                    <input
                        onChange={(event) => updateSaleInformation(
                            "customerAddress",
                            event.target.value
                        )}
                        value={saleInformation.customerAddress}
                    />
                </label>
                <label className="sales-field">
                    <span>Date</span>
                    <input
                        onChange={(event) => updateSaleInformation(
                            "date",
                            event.target.value
                        )}
                        type="date"
                        value={saleInformation.date}
                    />
                </label>
                <label className="sales-field">
                    <span>Received By <span aria-hidden="true">*</span></span>
                    <input
                        onChange={(event) => updateSaleInformation(
                            "receivedBy",
                            event.target.value
                        )}
                        required
                        value={saleInformation.receivedBy}
                    />
                </label>
            </section>

            <section className="sales-selection" aria-label="Product search and selection">
                <label className="sales-field sales-search-field">
                    <span>Search products</span>
                    <input
                        ref={searchRef}
                        aria-label="Search products"
                        autoComplete="off"
                        onChange={(event) => {
                            setProductSearch(event.target.value);
                            dispatchSelection({
                                type: "product.selected",
                                productId: ""
                            });
                            setErrorMessage("");
                        }}
                        placeholder="Search by medicine name"
                        type="search"
                        value={productSearch}
                    />
                </label>

                {productSearch.trim() !== "" && products.length === 0 && (
                    <p className="sales-empty-state" role="status">
                        No products are available. Create a product before starting a sale.
                    </p>
                )}
                {productSearch.trim() !== "" &&
                    products.length > 0 &&
                    matchingProducts.length === 0 && (
                        <p className="sales-empty-state" role="status">
                            No products match “{productSearch.trim()}”.
                        </p>
                    )}
                {productSearch.trim() !== "" && matchingProducts.length > 0 && (
                    <ul className="sales-product-results" aria-label="Matching products">
                        {matchingProducts.map((product) => (
                            <li key={product.id}>
                                <button
                                    aria-pressed={selection.productId === product.id}
                                    className="sales-product-result"
                                    onClick={() => {
                                        dispatchSelection({
                                            type: "product.selected",
                                            productId: product.id
                                        });
                                        setProductSearch("");
                                        setErrorMessage("");
                                    }}
                                    type="button"
                                >
                                    <span>{product.name}</span>
                                    {product.variant.length === 0 && (
                                        <span className="sales-product-note">
                                            No variants
                                        </span>
                                    )}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}

                {selectedProduct && (
                    <section className="sales-selected-product" aria-label="Selected product">
                        <h3>{selectedProduct.name}</h3>
                        {selectedProduct.genericName && (
                            <p>{selectedProduct.genericName}</p>
                        )}
                        {selectedProduct.variant.length === 0 ? (
                            <p role="status">
                                This product has no variants and cannot be selected for a sale.
                            </p>
                        ) : (
                            <div className="sales-variant-list" aria-label="Available variants">
                                <span>Available variants</span>
                                {selectedProduct.variant.map((productVariant) => (
                                    <button
                                        className="sales-variant-button"
                                        key={productVariant.id}
                                        onClick={() => setActiveItemModal({
                                            productId: selectedProduct.id,
                                            variantId: productVariant.id
                                        })}
                                        type="button"
                                    >
                                        {productVariant.variantName}
                                    </button>
                                ))}
                            </div>
                        )}
                    </section>
                )}
            </section>

            {currentDraft && currentDraft.items.length > 0 && (
                <section className="sales-draft" aria-label="Current sale draft">
                    <h3>Current sale</h3>
                    <ul className="sales-draft-items" aria-label="Draft items">
                        {currentDraft.items.map((item) => {
                            const product = products.find(
                                (candidate) => candidate.id === item.productId
                            );
                            const itemVariant = product?.variant.find(
                                (candidate) => candidate.id === item.variantId
                            );
                            const packagingLevel = itemVariant?.packagingHierarchy.find(
                                (level) => level.id === item.packagingLevelId
                            );
                            const subtotal = roundMoney(
                                item.appliedSellingPrice * item.quantity
                            );
                            const finalAmount = roundMoney(
                                subtotal - item.discountAmount
                            );
                            const inventoryRecord = inventoryRecords.find(
                                (record) => record.id === item.inventoryRecordId
                            );
                            const batch = inventoryRecord?.batchId
                                ? getInventoryBatchById(
                                    inventoryBatches,
                                    inventoryRecord.batchId
                                )
                                : null;
                            const display = inventoryRecord && product
                                ? getInventoryDisplay(
                                    inventoryRecord,
                                    products,
                                    inventoryBatches
                                )
                                : undefined;

                            return (
                                <li key={item.lineId}>
                                    <div className="sales-draft-item-details">
                                        <strong>{product?.name ?? item.productId}</strong>
                                        <span>
                                            {itemVariant?.variantName ?? item.variantId}
                                            {" · "}
                                            {packagingLevel?.name ?? item.packagingLevelId}
                                            {" · "}
                                            {item.quantity} × {item.appliedSellingPrice.toFixed(2)}
                                        </span>
                                        <span>
                                            {batch
                                                ? `Batch ${display?.batchNumber ?? batch.batchNumber ?? batch.batchId}`
                                                : "Unbatched"}
                                            {display?.expiryDate
                                                ? ` · expires ${display.expiryDate.toISOString().slice(0, 10)}`
                                                : ""}
                                            {" · "}
                                            Discount {item.discountAmount.toFixed(2)}
                                            {" · "}
                                            Line total {finalAmount.toFixed(2)}
                                        </span>
                                    </div>
                                    <div className="sales-draft-item-actions">
                                        <button
                                            aria-label={`Edit ${product?.name ?? item.productId}`}
                                            className="sales-remove-button"
                                            onClick={() => editItem(item)}
                                            type="button"
                                        >
                                            Edit
                                        </button>
                                        <button
                                            aria-label={`Remove ${product?.name ?? item.productId}`}
                                            className="sales-remove-button"
                                            onClick={() => removeItem(item)}
                                            type="button"
                                        >
                                            Remove
                                        </button>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                    {draftTotals && (
                        <div
                            aria-label="Sale totals"
                            className="sales-draft-totals"
                            role="region"
                        >
                            <span>Subtotal <strong>{roundMoney(draftTotals.subtotal).toFixed(2)}</strong></span>
                            <span>Discount <strong>{roundMoney(draftTotals.discountAmount).toFixed(2)}</strong></span>
                            <span>Final amount <strong>{roundMoney(draftTotals.finalAmount).toFixed(2)}</strong></span>
                        </div>
                    )}
                    {confirmExpiredBatch && (
                        <div className="sales-expired-confirmation" role="alert">
                            <p>
                                This sale includes an expired batch. Confirm explicitly to continue.
                            </p>
                            <div>
                                <button
                                    className="sales-remove-button"
                                    disabled={approvalInProgress}
                                    onClick={() => setConfirmExpiredBatch(false)}
                                    type="button"
                                >
                                    Cancel
                                </button>
                                <button
                                    className="sales-approve-button"
                                    disabled={approvalInProgress}
                                    onClick={() => approveSale(true)}
                                    type="button"
                                >
                                    Confirm Sale with Expired Stock
                                </button>
                            </div>
                        </div>
                    )}
                    <button
                        className="sales-approve-button"
                        disabled={approvalInProgress}
                        onClick={() => approveSale()}
                        type="button"
                    >
                        Approve Sale
                    </button>
                </section>
            )}

            {errorMessage && (
                <p className="sales-error" role="alert">{errorMessage}</p>
            )}

            {activeItemModal && modalProduct && modalVariant && (
                <SalesItemModal
                    key={activeItemModal.lineId ?? `${modalProduct.id}:${modalVariant.id}`}
                    product={modalProduct}
                    variant={modalVariant}
                    products={products}
                    inventoryRecords={inventoryRecords}
                    inventoryBatches={inventoryBatches}
                    currentDraft={currentDraft}
                    initialItem={editingItem}
                    onSave={saveItem}
                    onClose={closeItemModal}
                />
            )}
        </div>
    );
}
