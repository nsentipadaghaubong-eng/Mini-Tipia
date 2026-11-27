
import { useEffect, useReducer, useRef, useState } from "react";
import AppLayout from "./components/layout/AppLayout";
import InventoryPage from "./features/inventory/pages/InventoryPage";
import type { InventoryCommit } from "./features/inventory/pages/InventoryPage";
import ReceiveDeliveryPage from "./features/delivery/pages/ReceiveDeliveryPage";
import ProductsPage from "./features/products/pages/ProductsPage";
import SalesPage from "./features/sales/pages/SalesPage";
import ActivityPage from "./features/activity/pages/ActivityPage";
import DashboardPage from "./features/dashboard/pages/DashboardPage";
import {
    buildProductDeletionActivityInput,
    buildProductCreationActivityInputs,
    buildDeliveryDraftCancellationActivityInput,
    buildProductUpdateActivityInputs,
    prepareActivityEvents,
    snapshotVariant
} from "./activity/activity";
import {
    applicationReducer
} from "./applicationState";
import type { ApplicationAction, ApplicationState } from "./applicationState";
import type { ProductCreationResult } from "./products/productCreation";
import type { productStructure } from "./products/productStructure";
import type { variant } from "./products/productStructure";
import {
    getProductDeletionBlockMessages
} from "./products/productDeletion";
import type { ProductRecordDeletionDraft } from "./products/productDeletion";
import type {
    SaleDraft,
    SaleDraftDetailsChanges,
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
import { validateInventoryPackagingRelationships } from "./inventory/inventoryValidation";
import {
    consumeNavigationRequest,
    dismissNavigationRequest,
    getNavigationDestination,
    type NavigationIntent,
    type NavigationRequest
} from "./navigation/navigationIntent";
import { loadApplicationStateHydration } from "./persistence/applicationStartup";
import type { ApplicationStateHydration } from "./persistence/applicationStateHydration";
import { createApplicationStateFromHydration } from "./persistence/applicationStateProjection";
import {
    persistCatalogueProduct,
    persistFullProduct,
    persistProductUpdate,
    persistVariantAddition
} from "./persistence/repositories/productWriteRepository";
import { getProductDraftLockMessages } from "./products/productDraftLock";

type AppPage =
    | "dashboard"
    | "products"
    | "inventory"
    | "delivery"
    | "sales"
    | "activity";

interface WorkflowAppProps {
    initialApplicationState: ApplicationState;
    hydration: ApplicationStateHydration;
    onCommittedWriteRecovery: () => void;
}

export function WorkflowApp({
    initialApplicationState,
    hydration,
    onCommittedWriteRecovery
}: WorkflowAppProps) {
    const [activePage, setActivePage] =
        useState<AppPage>("dashboard");
    const [navigationRequest, setNavigationRequest] =
        useState<NavigationRequest | null>(null);
    const nextNavigationRequestId = useRef(0);
    const approvedDeliveries = useRef(new Set<string>());
    const cancellingDeliveries = useRef(new Set<string>());
    const [applicationState, dispatch] = useReducer(
        applicationReducer,
        initialApplicationState
    );
    const applicationStateRef = useRef(applicationState);
    const productWriteInProgress = useRef(false);
    const [isProductWritePending, setIsProductWritePending] = useState(false);
    const persistenceOnlyActiveDraftCount =
        getPersistenceOnlyActiveDraftCount(hydration);
    const persistenceOnlyRecordCount = getPersistenceOnlyCount(hydration);

    useEffect(() => {
        applicationStateRef.current = applicationState;
    }, [applicationState]);

    async function commitCatalogueAction(
        action: ApplicationAction,
        persist: (state: ApplicationState) => Promise<void>
    ): Promise<void> {
        if (productWriteInProgress.current) {
            throw new Error("Another catalogue write is already in progress.");
        }
        productWriteInProgress.current = true;
        setIsProductWritePending(true);
        const stateBeforeWrite = applicationStateRef.current;
        try {
            applicationReducer(stateBeforeWrite, action);
            await persist(stateBeforeWrite);
            try {
                applicationReducer(applicationStateRef.current, action);
            } catch (error) {
                onCommittedWriteRecovery();
                throw new Error(
                    `SQLite committed the catalogue write, but ApplicationState could not publish it. The application is reloading persisted data. ${describeError(error)}`,
                    { cause: error }
                );
            }
            dispatch(action);
        } finally {
            productWriteInProgress.current = false;
            setIsProductWritePending(false);
        }
    }

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

    async function handleCreateProduct(result: ProductCreationResult): Promise<void> {
        const events = prepareActivityEvents(
            buildProductCreationActivityInputs(
                result.product,
                result.inventoryRecords,
                result.inventoryBatches
            )
        );
        if (events.length !== 1 + result.inventoryBatches.length) {
            throw new Error(
                "Full Product creation Activity could not be prepared."
            );
        }
        const action = {
            type: "product.created",
            result,
            events
        } satisfies ApplicationAction;
        await commitCatalogueAction(action, (currentState) =>
            persistFullProduct(
                result,
                currentState.products,
                currentState.inventoryRecords,
                currentState.inventoryBatches,
                events
            )
        );
    }

    async function handleCatalogueProductCreated(
        product: productStructure
    ): Promise<void> {
        const [event] = prepareActivityEvents(
            buildProductCreationActivityInputs(product, [], [])
        );
        if (!event || event.type !== "product.created") {
            throw new Error("Catalogue Product Activity could not be prepared.");
        }
        const action = {
            type: "product.catalogue_created",
            product,
            events: [event]
        } satisfies ApplicationAction;
        await commitCatalogueAction(action, (currentState) =>
            persistCatalogueProduct(product, currentState.products, event)
        );
    }

    async function handleDeliveryVariantCreated(
        productId: string,
        productVariant: variant
    ): Promise<void> {
        const state = applicationStateRef.current;
        const product = state.products.find(
            (candidate) => candidate.id === productId
        );
        if (!product) {
            throw new Error(`Product not found: ${productId}`);
        }
        const lockMessages = getProductDraftLockMessages(
            productId,
            state.saleDrafts,
            state.deliveryDrafts
        );
        if (lockMessages.length > 0) {
            throw new Error(lockMessages.join(" "));
        }
        const [event] = prepareActivityEvents([{
            type: "product.variant_added",
            operationKey: `product.variant_added:${productId}:${productVariant.id}`,
            productId,
            productName: product.name,
            variant: snapshotVariant(productVariant),
            reason: "Added through Receive Delivery"
        }]);
        if (!event || event.type !== "product.variant_added") {
            throw new Error("Variant Activity could not be prepared.");
        }
        const action = {
            type: "product.variant_added",
            productId,
            variant: productVariant,
            events: [event]
        } satisfies ApplicationAction;
        await commitCatalogueAction(action, () =>
            persistVariantAddition(product, productVariant, event)
        );
    }

    function handleInventoryCommit(commit: InventoryCommit) {
        const action = {
            type: "inventory.saved",
            inventoryRecords: commit.inventoryRecords,
            inventoryBatches: commit.inventoryBatches,
            events: prepareActivityEvents(commit.activityEvents)
        } satisfies ApplicationAction;
        applicationReducer(applicationState, action);
        dispatch(action);
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

    function handleCancelDeliveryDraft(deliveryId: string): boolean {
        if (cancellingDeliveries.current.has(deliveryId)) {
            return false;
        }
        const matchingDrafts = applicationState.deliveryDrafts.filter(
            (draft) => draft.deliveryId === deliveryId
        );
        if (matchingDrafts.length !== 1 || matchingDrafts[0].status !== "draft") {
            return false;
        }

        cancellingDeliveries.current.add(deliveryId);
        try {
            const [event] = prepareActivityEvents([
                buildDeliveryDraftCancellationActivityInput(
                    matchingDrafts[0],
                    applicationState.products
                )
            ]);
            if (!event) {
                throw new Error("Delivery cancellation Activity could not be created.");
            }
            const action = {
                type: "delivery.draft_cancelled" as const,
                deliveryId,
                event
            };
            applicationReducer(applicationState, action);
            dispatch(action);
            return true;
        } catch (error) {
            cancellingDeliveries.current.delete(deliveryId);
            throw error;
        }
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
            const [event] = prepareActivityEvents([plan.activity], {
                now: () => new Date(plan.draft.updatedAt)
            });
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

    function handleSaleDraftDetailsUpdated(
        draftId: string,
        changes: SaleDraftDetailsChanges,
        updatedAt: string
    ) {
        dispatch({
            type: "sale.draft_details_updated",
            draftId,
            changes,
            updatedAt
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

    async function handleUpdateProduct(
        product: productStructure,
        reason: string,
        stagedDeletions: ProductRecordDeletionDraft[] = []
    ): Promise<void> {
        if (stagedDeletions.length > 0) {
            throw new Error(
                "Product, Variant, and packaging deletions are not persisted in this stage. Remove staged deletions before saving catalogue edits."
            );
        }
        const state = applicationStateRef.current;
        const previousProduct = state.products.find(
            (current) => current.id === product.id
        );
        if (!previousProduct) {
            throw new Error(`Product not found: ${product.id}`);
        }
        const lockMessages = getProductDraftLockMessages(
            product.id,
            state.saleDrafts,
            state.deliveryDrafts
        );
        const hasStructureChanges =
            JSON.stringify(previousProduct.variant) !==
                JSON.stringify(product.variant) ||
            previousProduct.genericName !== product.genericName ||
            previousProduct.manufacturer !== product.manufacturer ||
            previousProduct.category !== product.category;
        if (lockMessages.length > 0 && hasStructureChanges) {
            throw new Error(lockMessages.join(" "));
        }
        for (const record of state.inventoryRecords) {
            if (record.productId === product.id) {
                validateInventoryPackagingRelationships(product, record);
            }
        }

        const operationKey = `product.updated:${product.id}:${crypto.randomUUID()}`;
        const action = {
            type: "product.updated",
            product,
            events: prepareActivityEvents(buildProductUpdateActivityInputs(
                previousProduct,
                product,
                state.inventoryRecords,
                state.inventoryRecords,
                state.inventoryBatches,
                operationKey,
                reason
            ))
        } satisfies ApplicationAction;
        const updateEvent = action.events.find(
            (event) => event.type === "product.updated"
        );
        if (!updateEvent || updateEvent.type !== "product.updated") {
            throw new Error("Product update Activity could not be prepared.");
        }
        await commitCatalogueAction(action, () =>
            persistProductUpdate(previousProduct, product, updateEvent)
        );
    }

    function handleDeleteProduct(
        productId: string,
        reason: string
    ): { success: true } | { success: false; error: string } {
        const normalizedReason = reason.trim();
        if (normalizedReason === "") {
            return {
                success: false,
                error: "A reason is required to delete a product."
            };
        }

        const blockers = getProductDeletionBlockMessages(
            productId,
            applicationState.saleDrafts,
            applicationState.deliveryDrafts
        );
        if (blockers.length > 0) {
            return { success: false, error: blockers.join(" ") };
        }

        const matchingProducts = applicationState.products.filter(
            (product) => product.id === productId
        );
        if (matchingProducts.length !== 1) {
            return {
                success: false,
                error: `Product not found: ${productId}`
            };
        }

        try {
            const operationKey =
                `product.deleted:${productId}:${crypto.randomUUID()}`;
            const event = prepareActivityEvents([
                buildProductDeletionActivityInput(
                    matchingProducts[0],
                    applicationState.inventoryRecords,
                    applicationState.inventoryBatches,
                    operationKey,
                    normalizedReason
                )
            ]);
            const action = {
                type: "product.deleted",
                productId,
                events: event
            } satisfies ApplicationAction;
            applicationReducer(applicationState, action);
            dispatch(action);
            return { success: true };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error
                    ? error.message
                    : "Product deletion failed."
            };
        }
    }

    return (
        <AppLayout
            activePage={activePage}
            onSelectPage={handlePageSelection}
        >
            <div className="persistence-status" role="status">
                <p>
                    Catalogue-only Product creation, Variant addition, and
                    Product and packaging edits are saved to SQLite. Other
                    workflows are not persisted yet.
                </p>
                {isProductWritePending && (
                    <p aria-live="polite">Saving catalogue changes to SQLite.</p>
                )}
                {persistenceOnlyRecordCount > 0 && (
                    <p>
                        {persistenceOnlyRecordCount} persistence-only record(s)
                        remain retained in the hydration model because the
                        current workflows cannot represent them.
                    </p>
                )}
                {persistenceOnlyActiveDraftCount > 0 && (
                    <p role="alert">
                        {persistenceOnlyActiveDraftCount} active persisted
                        draft(s) cannot be represented safely. Workflow
                        controls are disabled to protect their draft locks.
                    </p>
                )}
            </div>
            <div inert={
                persistenceOnlyActiveDraftCount > 0 ||
                isProductWritePending ||
                undefined
            }>
                <div hidden={activePage !== "dashboard"}>
                    <DashboardPage
                        products={applicationState.products}
                        inventoryRecords={applicationState.inventoryRecords}
                        inventoryBatches={applicationState.inventoryBatches}
                        saleDrafts={applicationState.saleDrafts}
                        deliveryDrafts={applicationState.deliveryDrafts}
                        onNavigate={handleNavigation}
                    />
                </div>
                <div hidden={activePage !== "products"}>
                    <ProductsPage
                        navigationRequest={
                            activePage === "products" ? navigationRequest : null
                        }
                        inventoryRecords={applicationState.inventoryRecords}
                        inventoryBatches={applicationState.inventoryBatches}
                        onCreateProduct={handleCreateProduct}
                        onDeleteProduct={handleDeleteProduct}
                        onUpdateProduct={handleUpdateProduct}
                        saleDrafts={applicationState.saleDrafts}
                        deliveryDrafts={applicationState.deliveryDrafts}
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
                        saleDrafts={applicationState.saleDrafts}
                        deliveryDrafts={applicationState.deliveryDrafts}
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
                        saleDrafts={applicationState.saleDrafts}
                        navigationRequest={
                            activePage === "delivery" ? navigationRequest : null
                        }
                        onNavigationConsumed={handleNavigationConsumed}
                        onNavigationDismissed={handleNavigationDismissed}
                        onDraftCreated={handleDeliveryDraftCreated}
                        onDraftCancelled={handleCancelDeliveryDraft}
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
                        navigationRequest={
                            activePage === "sales" ? navigationRequest : null
                        }
                        onNavigationConsumed={handleNavigationConsumed}
                        onNavigationDismissed={handleNavigationDismissed}
                        onDraftCreated={handleSaleDraftCreated}
                        onDraftDetailsUpdated={handleSaleDraftDetailsUpdated}
                        onDraftItemAdded={handleSaleDraftItemAdded}
                        onDraftItemUpdated={handleSaleDraftItemUpdated}
                        onDraftItemRemoved={handleSaleDraftItemRemoved}
                        onApproveSale={handleApproveSale}
                    />
                </div>
                <div hidden={activePage !== "activity"}>
                    <ActivityPage
                        activityEvents={applicationState.activityEvents}
                    />
                </div>
            </div>
        </AppLayout>
    );
}

type StartupState =
    | { state: "loading"; message?: string }
    | {
        state: "ready";
        hydration: ApplicationStateHydration;
        applicationState: ApplicationState;
    }
    | { state: "failed"; message: string };

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function getPersistenceOnlyCount(
    hydration: ApplicationStateHydration
): number {
    return [
        ...hydration.completedSales,
        ...hydration.receivedDeliveries,
        ...hydration.activeDeliveryDrafts
    ].filter((record) =>
        record.domainProjection.status === "persistence-only"
    ).length;
}

function getPersistenceOnlyActiveDraftCount(
    hydration: ApplicationStateHydration
): number {
    return [
        ...hydration.activeSaleDrafts,
        ...hydration.activeDeliveryDrafts
    ].filter((record) =>
        record.domainProjection.status === "persistence-only"
    ).length;
}

function App() {
    const [startupState, setStartupState] =
        useState<StartupState>({ state: "loading" });
    const [startupAttempt, setStartupAttempt] = useState(0);

    function recoverAfterCommittedWrite() {
        setStartupState({
            state: "loading",
            message:
                "A SQLite catalogue write committed, but ApplicationState could not publish it. Reloading from a consistent SQLite snapshot."
        });
        setStartupAttempt((attempt) => attempt + 1);
    }

    useEffect(() => {
        let isMounted = true;

        loadApplicationStateHydration()
            .then((hydration) => {
                if (isMounted) {
                    setStartupState({
                        state: "ready",
                        hydration,
                        applicationState:
                            createApplicationStateFromHydration(hydration)
                    });
                }
            })
            .catch((error: unknown) => {
                if (isMounted) {
                    setStartupState({
                        state: "failed",
                        message: describeError(error)
                    });
                }
            });

        return () => {
            isMounted = false;
        };
    }, [startupAttempt]);

    if (startupState.state === "loading") {
        return (
            <main aria-busy="true">
                <h1>Loading SQLite application data</h1>
                <p role="status">
                    {startupState.message ??
                        "The application is unavailable until database initialization and read-only hydration complete."}
                </p>
            </main>
        );
    }

    if (startupState.state === "failed") {
        return (
            <main>
                <h1>SQLite application data unavailable</h1>
                <p role="alert">{startupState.message}</p>
                <button
                    type="button"
                    onClick={() => {
                        setStartupState({ state: "loading" });
                        setStartupAttempt((attempt) => attempt + 1);
                    }}
                >
                    Retry
                </button>
            </main>
        );
    }

    return (
        <WorkflowApp
            initialApplicationState={startupState.applicationState}
            hydration={startupState.hydration}
            onCommittedWriteRecovery={recoverAfterCommittedWrite}
        />
    );
}

export default App;
