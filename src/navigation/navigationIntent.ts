import type { productStructure } from "../products/productStructure";
import type { inventory } from "../inventory/inventoryStock";
import type { inventoryBatch } from "../inventory/inventoryBatch";

export type ApplicationPage = "products" | "inventory";

export type NavigationIntent =
    | {
        type: "page.navigate";
        page: ApplicationPage;
    }
    | {
        type: "product.view";
        productId: string;
    }
    | {
        type: "product.edit";
        productId: string;
        variantId?: string;
    }
    | {
        type: "inventory.manage";
        productId: string;
        variantId: string;
        inventoryId: string;
        batchId: string | null;
    };

export interface NavigationRequest {
    requestId: number;
    intent: Exclude<NavigationIntent, { type: "page.navigate" }>;
    consumed: boolean;
}

export function getNavigationDestination(
    intent: NavigationIntent
): ApplicationPage {
    switch (intent.type) {
        case "page.navigate":
        case "product.view":
        case "product.edit":
            return intent.type === "page.navigate" ? intent.page : "products";
        case "inventory.manage":
            return "inventory";
    }
}

export function resolveNavigationProduct(
    intent: NavigationRequest["intent"],
    products: productStructure[]
): productStructure | undefined {
    return products.find((product) => product.id === intent.productId);
}

export function isProductEditContextValid(
    intent: Extract<NavigationRequest["intent"], { type: "product.edit" }>,
    product: productStructure
): boolean {
    return intent.variantId === undefined ||
        product.variant.filter((variant) => variant.id === intent.variantId).length === 1;
}

export function createInventoryManageIntent(
    productId: string,
    variantId: string,
    inventoryId: string,
    batchId: string | null
): Extract<NavigationIntent, { type: "inventory.manage" }> {
    return {
        type: "inventory.manage",
        productId,
        variantId,
        inventoryId,
        batchId
    };
}

export function createProductEditIntent(
    productId: string,
    variantId: string
): Extract<NavigationIntent, { type: "product.edit" }> {
    return {
        type: "product.edit",
        productId,
        variantId
    };
}

export interface InventoryManageTarget {
    product: productStructure;
    inventoryRecord: inventory;
    batch: inventoryBatch | null;
}

export function resolveInventoryManageTarget(
    intent: Extract<NavigationRequest["intent"], { type: "inventory.manage" }>,
    products: productStructure[],
    inventoryRecords: inventory[],
    inventoryBatches: inventoryBatch[]
): InventoryManageTarget | undefined {
    const matchingProducts = products.filter(
        (product) => product.id === intent.productId
    );
    if (matchingProducts.length !== 1) {
        return undefined;
    }

    const [product] = matchingProducts;
    if (
        product.variant.filter((variant) => variant.id === intent.variantId)
            .length !== 1
    ) {
        return undefined;
    }

    const matchingRecords = inventoryRecords.filter(
        (record) =>
            record.id === intent.inventoryId &&
            record.productId === intent.productId &&
            record.variantId === intent.variantId &&
            record.batchId === intent.batchId
    );
    if (matchingRecords.length !== 1) {
        return undefined;
    }

    if (intent.batchId === null) {
        return {
            product,
            inventoryRecord: matchingRecords[0],
            batch: null
        };
    }

    const matchingBatches = inventoryBatches.filter(
        (batch) =>
            batch.batchId === intent.batchId &&
            batch.productId === intent.productId &&
            batch.variantId === intent.variantId
    );
    if (matchingBatches.length !== 1) {
        return undefined;
    }

    return {
        product,
        inventoryRecord: matchingRecords[0],
        batch: matchingBatches[0]
    };
}

export function consumeNavigationRequest(
    current: NavigationRequest | null,
    requestId: number
): NavigationRequest | null {
    return current?.requestId === requestId
        ? { ...current, consumed: true }
        : current;
}

export function dismissNavigationRequest(
    current: NavigationRequest | null,
    requestId: number
): NavigationRequest | null {
    return current?.requestId === requestId ? null : current;
}
