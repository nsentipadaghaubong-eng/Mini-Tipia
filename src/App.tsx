
import { useReducer, useRef, useState } from "react";
import AppLayout from "./components/layout/AppLayout";
import InventoryPage from "./features/inventory/pages/InventoryPage";
import type { InventoryCommit } from "./features/inventory/pages/InventoryPage";
import ReceiveDeliveryPage from "./features/delivery/pages/ReceiveDeliveryPage";
import ProductsPage from "./features/products/pages/ProductsPage";
import SalesPage from "./features/sales/pages/SalesPage";
import {
    buildProductCreationActivityInputs,
    prepareActivityEvents
} from "./activity/activity";
import {
    applicationReducer,
    createInitialApplicationState
} from "./applicationState";
import type { ProductCreationResult } from "./products/productCreation";
import type { productStructure } from "./products/productStructure";
import type { variant } from "./products/productStructure";
import type { inventory } from "./inventory/inventoryStock";
import type { inventoryBatch } from "./inventory/inventoryBatch";
import type {
    SaleDraft,
    SaleDraftItem,
    SaleDraftItemChanges
} from "./sales/salesDraft";
import {
    type DeliveryDraft,
    type DeliveryDraftDetailsChanges,
    type DeliveryDraftItem,
    type DeliveryDraftItemChanges
} from "./deliveries/deliveryDraft";
import { prepareDeliveryApproval } from "./deliveries/deliveryApproval";
import { completeSale, prepareSaleDraft } from "./sales/salesEngine";
import { snapshotProduct } from "./activity/activity";
import { validateInventoryPackagingRelationships } from "./inventory/inventoryValidation";
import {
    consumeNavigationRequest,
    dismissNavigationRequest,
    getNavigationDestination,
    type NavigationIntent,
    type NavigationRequest
} from "./navigation/navigationIntent";

type AppPage = "products" | "inventory" | "delivery" | "sales";

function App() {
    const [activePage, setActivePage] =
        useState<AppPage>("inventory");
    const [navigationRequest, setNavigationRequest] =
        useState<NavigationRequest | null>(null);
    const nextNavigationRequestId = useRef(0);
    const approvedDeliveries = useRef(new Set<string>());
    const [applicationState, dispatch] = useReducer(
        applicationReducer,
        undefined,
        createInitialApplicationState
    );

    function handleNavigation(intent: NavigationIntent) {
        const destination = getNavigationDestination(intent);
        setActivePage(destination);

        if (intent.type === "page.navigate") {
            setNavigationRequest(null);
            return;
        }

        setNavigationRequest({
            requestId: ++nextNavigationRequestId.current,
            intent,
            consumed: false
        });
    }

    function handlePageSelection(page: AppPage) {
        setActivePage(page);
        setNavigationRequest(null);
    }

    function handleNavigationConsumed(requestId: number, handled: boolean) {
        setNavigationRequest((current) => handled
            ? consumeNavigationRequest(current, requestId)
            : dismissNavigationRequest(current, requestId)
        );
    }

    function handleNavigationDismissed(requestId: number) {
        setNavigationRequest((current) =>
            dismissNavigationRequest(current, requestId)
        );
    }

    function handleCreateProduct(result: ProductCreationResult) {
        dispatch({
            type: "product.created",
            result,
            events: prepareActivityEvents(
                buildProductCreationActivityInputs(
                    result.product,
                    result.inventoryRecords,
                    result.inventoryBatches
                )
            )
        });
    }

    function handleCatalogueProductCreated(product: productStructure) {
        dispatch({
            type: "product.catalogue_created",
            product
        });
    }

    function handleDeliveryVariantCreated(
        productId: string,
        productVariant: variant
    ) {
        dispatch({
            type: "product.variant_added",
            productId,
            variant: productVariant
        });
    }

    function handleInventoryCommit(commit: InventoryCommit) {
        dispatch({
            type: "inventory.saved",
            inventoryRecords: commit.inventoryRecords,
            inventoryBatches: commit.inventoryBatches,
            events: prepareActivityEvents(commit.activityEvents)
        });
    }

    function handleDeliveryDraftDetailsUpdated(
        deliveryId: string,
        changes: DeliveryDraftDetailsChanges,
        updatedAt: string
    ) {
        dispatch({
            type: "delivery.draft_details_updated",
            deliveryId,
            changes,
            updatedAt
        });
    }

    function handleDeliveryDraftCreated(draft: DeliveryDraft) {
        dispatch({
            type: "delivery.draft_created",
            draft
        });
    }

    function handleDeliveryDraftItemAdded(
        deliveryId: string,
        item: DeliveryDraftItem,
        updatedAt: string
    ) {
        dispatch({
            type: "delivery.draft_item_added",
            deliveryId,
            item,
            updatedAt
        });
    }

    function handleDeliveryDraftItemUpdated(
        deliveryId: string,
        deliveryItemId: string,
        changes: DeliveryDraftItemChanges,
        updatedAt: string
    ) {
        dispatch({
            type: "delivery.draft_item_updated",
            deliveryId,
            deliveryItemId,
            changes,
            updatedAt
        });
    }

    function handleDeliveryDraftItemRemoved(
        deliveryId: string,
        deliveryItemId: string,
        updatedAt: string
    ) {
        dispatch({
            type: "delivery.draft_item_removed",
            deliveryId,
            deliveryItemId,
            updatedAt
        });
    }

    function handleApproveDelivery(
        deliveryId: string
    ): { success: true } | { success: false; error: string } {
        if (approvedDeliveries.current.has(deliveryId)) {
            return { success: false, error: "This delivery has already been approved." };
        }
        approvedDeliveries.current.add(deliveryId);
        try {
            const draft = applicationState.deliveryDrafts.find(
                (candidate) => candidate.deliveryId === deliveryId
            );
            if (!draft) {
                throw new Error("The current delivery draft is no longer available.");
            }
            const plan = prepareDeliveryApproval(
                draft,
                applicationState.products,
                applicationState.inventoryRecords,
                applicationState.inventoryBatches
            );
            const [event] = prepareActivityEvents([plan.activity]);
            const action = {
                type: "delivery.approved" as const,
                plan,
                event
            };
            applicationReducer(applicationState, action);
            dispatch(action);
            return { success: true };
        } catch (error) {
            approvedDeliveries.current.delete(deliveryId);
            return {
                success: false,
                error: error instanceof Error
                    ? error.message
                    : "The delivery could not be approved."
            };
        }
    }

    function handleSaleDraftCreated(draft: SaleDraft) {
        dispatch({
            type: "sale.draft_created",
            draft
        });
    }

    function handleSaleDraftItemAdded(
        draftId: string,
        item: SaleDraftItem,
        updatedAt: string
    ) {
        dispatch({
            type: "sale.draft_item_added",
            draftId,
            item,
            updatedAt
        });
    }

    function handleSaleDraftItemRemoved(
        draftId: string,
        lineId: string,
        updatedAt: string
    ) {
        dispatch({
            type: "sale.draft_item_removed",
            draftId,
            lineId,
            updatedAt
        });
    }

    function handleSaleDraftItemUpdated(
        draftId: string,
        lineId: string,
        changes: SaleDraftItemChanges,
        updatedAt: string
    ) {
        dispatch({
            type: "sale.draft_item_updated",
            draftId,
            lineId,
            changes,
            updatedAt
        });
    }

    function handleApproveSale(
        draftId: string,
        confirmExpiredBatch: boolean
    ):
        | { success: true }
        | {
            success: false;
            error: string;
            requiresExpiredBatchConfirmation?: boolean;
        } {
        const draft = applicationState.saleDrafts.find(
            (saleDraft) =>
                saleDraft.draftId === draftId &&
                saleDraft.status === "draft"
        );
        if (!draft) {
            return {
                success: false,
                error: "The current sale draft is no longer available."
            };
        }

        try {
            const plan = prepareSaleDraft(draft, {
                products: applicationState.products,
                inventoryRecords: applicationState.inventoryRecords,
                inventoryBatches: applicationState.inventoryBatches
            });
            if (
                !confirmExpiredBatch &&
                plan.linePlans.some((linePlan) => linePlan.expiredBatch)
            ) {
                return {
                    success: false,
                    error: "This sale includes an expired batch. Confirm explicitly to continue.",
                    requiresExpiredBatchConfirmation: true
                };
            }

            const completion = completeSale(plan, {
                continueWithExpiredBatch: confirmExpiredBatch
            });
            const action = {
                type: "sale.completed" as const,
                completion
            };
            applicationReducer(applicationState, action);
            dispatch(action);
            return { success: true };
        } catch (error) {
            const message = error instanceof Error
                ? error.message
                : "The sale could not be approved.";
            return {
                success: false,
                error: message,
                ...(message.includes("Explicit confirmation is required")
                    ? { requiresExpiredBatchConfirmation: true }
                    : {})
            };
        }
    }

    function handleUpdateProduct(
          product: productStructure,
          reason: string,
          nextInventoryRecords?: inventory[],
          nextInventoryBatches?: inventoryBatch[]
      ) {
          const previousProduct = applicationState.products.find(
              (current) => current.id === product.id
          );
          if (!previousProduct) {
              throw new Error(`Product not found: ${product.id}`);
        }
          const resolvedInventoryRecords = nextInventoryRecords ?? applicationState.inventoryRecords;
          const resolvedInventoryBatches = nextInventoryBatches ?? applicationState.inventoryBatches;
          for (const record of resolvedInventoryRecords) {
              if (record.productId === product.id) {
                  validateInventoryPackagingRelationships(product, record);
              }
          }

          const operationKey = `product.updated:${product.id}:${crypto.randomUUID()}`;
          dispatch({
              type: "product.updated",
              product,
              inventoryRecords: resolvedInventoryRecords,
              inventoryBatches: resolvedInventoryBatches,
              events: prepareActivityEvents([{
                  type: "product.updated",
                  operationKey,
                  productId: product.id,
                  productName: product.name,
                  before: snapshotProduct(previousProduct),
                  after: snapshotProduct(product),
                  reason
              }])
          });
      }

    return (
        <AppLayout
            activePage={activePage}
            onSelectPage={handlePageSelection}
        >
            <div hidden={activePage !== "products"}>
                <ProductsPage
                    navigationRequest={
                        activePage === "products" ? navigationRequest : null
                    }
                    inventoryRecords={applicationState.inventoryRecords}
                    inventoryBatches={applicationState.inventoryBatches}
                    onCreateProduct={handleCreateProduct}
                    onUpdateProduct={handleUpdateProduct}
                    onNavigate={handleNavigation}
                    onNavigationConsumed={handleNavigationConsumed}
                    onNavigationDismissed={handleNavigationDismissed}
                    products={applicationState.products}
                />
            </div>
            <div hidden={activePage !== "inventory"}>
                <InventoryPage
                    navigationRequest={
                        activePage === "inventory" ? navigationRequest : null
                    }
                    inventoryRecords={applicationState.inventoryRecords}
                    inventoryBatches={applicationState.inventoryBatches}
                    onInventoryCommit={handleInventoryCommit}
                    onNavigate={handleNavigation}
                    onNavigationConsumed={handleNavigationConsumed}
                    onNavigationDismissed={handleNavigationDismissed}
                    products={applicationState.products}
                />
            </div>
            <div hidden={activePage !== "delivery"}>
                <ReceiveDeliveryPage
                    products={applicationState.products}
                    inventoryRecords={applicationState.inventoryRecords}
                    inventoryBatches={applicationState.inventoryBatches}
                    deliveryDrafts={applicationState.deliveryDrafts}
                    onDraftCreated={handleDeliveryDraftCreated}
                    onDraftDetailsUpdated={handleDeliveryDraftDetailsUpdated}
                    onDraftItemAdded={handleDeliveryDraftItemAdded}
                    onDraftItemUpdated={handleDeliveryDraftItemUpdated}
                    onDraftItemRemoved={handleDeliveryDraftItemRemoved}
                    onApproveDelivery={handleApproveDelivery}
                    onCatalogueProductCreated={handleCatalogueProductCreated}
                    onVariantCreated={handleDeliveryVariantCreated}
                />
            </div>
            <div hidden={activePage !== "sales"}>
                <SalesPage
                    products={applicationState.products}
                    inventoryRecords={applicationState.inventoryRecords}
                    inventoryBatches={applicationState.inventoryBatches}
                    saleDrafts={applicationState.saleDrafts}
                    onDraftCreated={handleSaleDraftCreated}
                    onDraftItemAdded={handleSaleDraftItemAdded}
                    onDraftItemUpdated={handleSaleDraftItemUpdated}
                    onDraftItemRemoved={handleSaleDraftItemRemoved}
                    onApproveSale={handleApproveSale}
                />
            </div>
        </AppLayout>
    );
}

export default App;
