import type { productStructure } from "../../../products/productStructure";
import type { variant } from "../../../products/productStructure";
import type { inventory } from "../../../inventory/inventoryStock";
import { getStockQuantityOrZero } from "../../../inventory/inventoryStock";
import {
    getPackagingConversionQuantity,
    validatePackagingHierarchy
} from "../../../packaging/packagingValidation";

export interface SalesSelection {
    productId: string;
    variantId: string;
}

export type SalesSelectionAction =
    | { type: "product.selected"; productId: string }
    | { type: "variant.selected"; variantId: string };

export const initialSalesSelection: SalesSelection = {
    productId: "",
    variantId: ""
};

export function salesSelectionReducer(
    selection: SalesSelection,
    action: SalesSelectionAction
): SalesSelection {
    if (action.type === "product.selected") {
        return {
            productId: action.productId,
            variantId: ""
        };
    }

    return {
        ...selection,
        variantId: action.variantId
    };
}

export function searchProductsByName(
    products: productStructure[],
    searchTerm: string
): productStructure[] {
    const normalizedSearchTerm = searchTerm.trim().toLocaleLowerCase();
    if (!normalizedSearchTerm) {
        return products;
    }

    return products.filter((product) =>
        product.name.toLocaleLowerCase().includes(normalizedSearchTerm)
    );
}

export interface SaleLineAmounts {
    subtotal: number;
    discountAmount: number;
    finalAmount: number;
}

export function calculateSaleLineAmounts(
    appliedSellingPrice: number,
    quantity: number,
    discountPercentage: number
): SaleLineAmounts | null {
    if (
        !Number.isFinite(appliedSellingPrice) ||
        appliedSellingPrice < 0 ||
        !Number.isSafeInteger(quantity) ||
        quantity <= 0 ||
        !Number.isFinite(discountPercentage) ||
        discountPercentage < 0 ||
        discountPercentage > 100
    ) {
        return null;
    }

    const roundMoney = (value: number) =>
        Math.round((value + Number.EPSILON) * 100) / 100;
    const subtotal = roundMoney(appliedSellingPrice * quantity);
    if (!Number.isFinite(subtotal)) {
        return null;
    }
    const discountAmount = roundMoney(
        subtotal * (discountPercentage / 100)
    );
    const finalAmount = roundMoney(subtotal - discountAmount);
    if (!Number.isFinite(discountAmount) || !Number.isFinite(finalAmount)) {
        return null;
    }
    return {
        subtotal,
        discountAmount,
        finalAmount
    };
}

export function getAvailableQuantity(
    selectedVariant: variant,
    inventoryRecord: inventory,
    packagingLevelId: string
): number {
    const levels = selectedVariant.packagingHierarchy;
    validatePackagingHierarchy(levels);
    if (!levels.some((level) => level.id === packagingLevelId)) {
        throw new Error("Packaging level does not belong to this variant.");
    }

    const referencedIds = new Set(
        levels.flatMap((level) =>
            level.nextLevelId === null ? [] : [level.nextLevelId]
        )
    );
    const root = levels.find((level) => !referencedIds.has(level.id));
    if (!root) {
        throw new Error("The selected variant has no packaging root.");
    }
    const orderedLevels: typeof levels = [];
    const levelsById = new Map(levels.map((level) => [level.id, level]));
    let current: (typeof levels)[number] | undefined = root;
    while (current) {
        orderedLevels.push(current);
        current = current.nextLevelId === null
            ? undefined
            : levelsById.get(current.nextLevelId);
    }
    const selectedIndex = orderedLevels.findIndex(
        (level) => level.id === packagingLevelId
    );
    if (selectedIndex === -1) {
        throw new Error("The selected packaging level is not in the hierarchy.");
    }

    let available = getStockQuantityOrZero(
        inventoryRecord,
        packagingLevelId
    );
    let conversion = 1;
    for (let index = selectedIndex - 1; index >= 0; index--) {
        conversion *= getPackagingConversionQuantity(
            levels,
            orderedLevels[index].id,
            orderedLevels[index + 1].id
        );
        const ancestorQuantity = getStockQuantityOrZero(
            inventoryRecord,
            orderedLevels[index].id
        );
        available += ancestorQuantity * conversion;
        if (!Number.isSafeInteger(available)) {
            return Number.MAX_SAFE_INTEGER;
        }
    }
    return available;
}
