
import type { productStructure } from "../products/productStructure";
import { getVariantById, getPackagingLevelById } from "../products/productValidation";
import {
    getPackagingConversionQuantity
} from "../packaging/packagingValidation";
import { validateInventoryPackagingRelationships } from "./inventoryValidation";

export interface inventory {
    id: string;
    productId: string;
    variantId: string;
    batchId: string | null;
    stockQuantities: stockQuantity[];
}

export interface stockQuantity {
    packagingLevelId: string;
    quantity: number;
}

function validateSufficientStock(
    availableStock: number,
    requestedStock: number
): void {
    if (requestedStock > availableStock) {
        throw new Error(
            `Insufficient stock: requested ${requestedStock}, but only ${availableStock} available.`
        );
    }
}

function validateStockOperation(
    product: productStructure,
    inventoryRecord: inventory,
    packagingLevelIds: string[]
): void {
    validateInventoryPackagingRelationships(product, inventoryRecord);
    const selectedVariant = getVariantById(product, inventoryRecord.variantId);
    for (const packagingLevelId of packagingLevelIds) {
        getPackagingLevelById(selectedVariant, packagingLevelId);
    }
}

export function getStockQuantityOrZero(
    inventoryRecord: inventory,
    packagingLevelId: string
): number {
    const normalizedPackagingId = packagingLevelId.trim();
    if (normalizedPackagingId === "") {
        throw new Error("Packaging level ID must not be empty.");
    }

    const matches = inventoryRecord.stockQuantities.filter(
        (item) => item.packagingLevelId === normalizedPackagingId
    );
    if (matches.length > 1) {
        throw new Error(
            `Duplicate stock quantity for packaging level: ${packagingLevelId}`
        );
    }
    if (matches.length === 0) {
        return 0;
    }

    const quantity = matches[0].quantity;
    if (!Number.isSafeInteger(quantity) || quantity < 0) {
        throw new Error("Stock quantity must be a non-negative safe integer.");
    }
    return quantity;
}

function applyQuantityUpdates(
    inventoryRecord: inventory,
    updates: Map<string, number>
): inventory {
    const updatedIds = new Set<string>();
    const stockQuantities = inventoryRecord.stockQuantities.map((stock) => {
        const quantity = updates.get(stock.packagingLevelId);
        if (quantity === undefined) {
            return stock;
        }
        updatedIds.add(stock.packagingLevelId);
        return { ...stock, quantity };
    });

    for (const [packagingLevelId, quantity] of updates) {
        if (!updatedIds.has(packagingLevelId)) {
            stockQuantities.push({ packagingLevelId, quantity });
        }
    }

    if (
        stockQuantities.some(
            (stock) =>
                !Number.isSafeInteger(stock.quantity) ||
                stock.quantity < 0
        )
    ) {
        throw new Error("Stock operation would produce invalid quantities.");
    }

    return { ...inventoryRecord, stockQuantities };
}

export function createInventory(
    productId: string,
    variantId: string,
    batchId: string | null,
    stock: stockQuantity[],
    id?: string
): inventory {

    // 1. Normalize and validate product ID
    const normalizedProductId = productId.trim();

    if (normalizedProductId === "") {
        throw new Error("Product ID must not be empty");
    }

    // 2. Normalize and validate variant ID
    const normalizedVariantId = variantId.trim();

    if (normalizedVariantId === "") {
        throw new Error("Variant ID must not be empty");
    }

    // 3. Batch number may be null, but not empty
    const normalizedBatchId = batchId?.trim() ?? null;

    if (batchId !== null && normalizedBatchId === "") {
        throw new Error("Batch ID must not be empty or whitespace");
    }

    // 4. Inventory must contain at least one stock entry
    if (stock.length === 0) {
        throw new Error("Inventory must contain at least one stock entry");
    }

    // 5. Normalize packaging-level IDs
    const normalizedStock = stock.map((item) => ({
        ...item,
        packagingLevelId: item.packagingLevelId.trim()
    }));

    // 6. Packaging-level IDs must not be empty
    for (const item of normalizedStock) {
        if (item.packagingLevelId === "") {
            throw new Error("Packaging level ID must not be empty");
        }
    }

    // 7. Packaging-level IDs must be unique
    const packagingIds = normalizedStock.map(
        (item) => item.packagingLevelId
    );

    const uniqueIds = new Set(packagingIds);

    if (packagingIds.length !== uniqueIds.size) {
        throw new Error("Duplicate packaging level IDs are not allowed");
    }

    // 8. Initial quantities must be non-negative safe integers
    for (const item of normalizedStock) {
        if (
            !Number.isSafeInteger(item.quantity) ||
            item.quantity < 0
        ) {
            throw new Error(
                "Initial stock quantities must be non-negative safe integers"
            );
        }
    }

    // 9. Create the inventory record after validation
    const inventoryRecord: inventory = {
        id: id ?? crypto.randomUUID(),
        productId: normalizedProductId,
        variantId: normalizedVariantId,
        batchId: normalizedBatchId,
        stockQuantities: normalizedStock
    };

    return inventoryRecord;
}

export function addStock(
    product: productStructure,
    inventoryRecord: inventory,
    packagingLevelId: string,
    updateStock: number
): inventory {
    if (updateStock <= 0 || !Number.isSafeInteger(updateStock)) {
        throw new Error("Enter a positive safe integer");
    }

    const normalizedPackagingId = packagingLevelId.trim()

    if (normalizedPackagingId === "") {
        throw new Error("Packaging Id must not be empty");
    }

    validateStockOperation(product, inventoryRecord, [normalizedPackagingId]);
    const existingQuantity = getStockQuantityOrZero(
        inventoryRecord,
        normalizedPackagingId
    );

    const newQuantity = existingQuantity + updateStock;

    if (!Number.isSafeInteger(newQuantity)) {
        throw new Error("The sum of these 2 numbers is too large");
    }

    return applyQuantityUpdates(
        inventoryRecord,
        new Map([[normalizedPackagingId, newQuantity]])
    );
}

export function removeStock(
    product: productStructure,
    inventoryRecord: inventory,
    packagingLevelId: string,
    updateStock: number
): inventory {
    if (updateStock <= 0 || !Number.isSafeInteger(updateStock)) {
        throw new Error("Enter a positive safe integer");
    }

    const normalizedPackagingId = packagingLevelId.trim()

    if (normalizedPackagingId === "") {
        throw new Error("Packaging Id must not be empty");
    }

    validateStockOperation(product, inventoryRecord, [normalizedPackagingId]);
    const availableStock = getStockQuantityOrZero(
        inventoryRecord,
        normalizedPackagingId
    );

    if (!Number.isSafeInteger(availableStock) || availableStock < 0) {
        throw new Error(
            "Existing stock quantity must be a non-negative safe integer"
        )
    }

    validateSufficientStock(availableStock, updateStock);

    const updatedStock = availableStock - updateStock

    if (!Number.isSafeInteger(updatedStock)) {
        throw new Error("The difference of these 2 numbers is too large");
    }

    return applyQuantityUpdates(
        inventoryRecord,
        new Map([[normalizedPackagingId, updatedStock]])
    );
}


export function getStockQuantity(inventoryRecord: inventory, packagingLevelId: string): number {
    const normalizedPackagingId = packagingLevelId.trim()
    if (normalizedPackagingId === "") {
        throw new Error(`This packaging level with id: ${packagingLevelId} doesn't exist`
        )

    }

    const stock = inventoryRecord.stockQuantities.find(
        (item) => normalizedPackagingId === item.packagingLevelId
    );
    if (!stock) {
        throw new Error(
            `This packaging level with id: ${normalizedPackagingId} doesn't exist`
        );
    }


    const currentStock = stock.quantity
    if (!Number.isSafeInteger(currentStock) || currentStock < 0) {
        throw new Error("Stock quantity must be a non-negative safe integer.")
    }


    return currentStock;
}

//
function calculateBreakdownQuantity(
    shortage: number,
    quantityPerLargerPackage: number
): number {
    if (
        !Number.isSafeInteger(shortage) ||
        shortage <= 0 ||
        !Number.isSafeInteger(quantityPerLargerPackage) ||
        quantityPerLargerPackage <= 0
    ) {
        throw new Error("Quantities must be positive integers");
    }

    return Math.ceil(shortage / quantityPerLargerPackage);
}


export function breakdownPackaging(
    product: productStructure,
    inventoryRecord: inventory,
    largerPackageId: string,
    smallerPackageId: string,
    shortage: number
): inventory {
    const normalizedLargerId = largerPackageId.trim();
    const normalizedSmallerId = smallerPackageId.trim();
    if (!normalizedLargerId || !normalizedSmallerId) {
        throw new Error("Packaging level IDs must not be empty");
    }
    if (normalizedLargerId === normalizedSmallerId) {
        throw new Error("Packaging IDs cannot be the same");
    }
    validateStockOperation(product, inventoryRecord, [
        normalizedLargerId,
        normalizedSmallerId
    ]);
    const conversionQuantity = getPackagingConversionQuantity(
        getVariantById(product, inventoryRecord.variantId).packagingHierarchy,
        normalizedLargerId,
        normalizedSmallerId
    );
    if (!Number.isSafeInteger(shortage) || shortage <= 0) {
        throw new Error("Shortage must be a positive safe integer");
    }

    const quantityAvailable = getStockQuantityOrZero(
        inventoryRecord,
        normalizedLargerId
    );
    const smallerQuantityAvailable = getStockQuantityOrZero(
        inventoryRecord,
        normalizedSmallerId
    );
    const quantityNeeded = calculateBreakdownQuantity(
        shortage,
        conversionQuantity
    );
    validateSufficientStock(quantityAvailable, quantityNeeded);
    const smallerPackagesCreated =
        quantityNeeded * conversionQuantity;
    if (!Number.isSafeInteger(smallerPackagesCreated)) {
        throw new Error(
            "Breakdown would produce an unsafe number of smaller packages"
        );
    }
    const newSmallerQuantity =
        smallerQuantityAvailable + smallerPackagesCreated;
    if (!Number.isSafeInteger(newSmallerQuantity)) {
        throw new Error(
            "New smaller-package quantity exceeds the safe integer limit"
        );
    }
    return applyQuantityUpdates(
        inventoryRecord,
        new Map([
            [normalizedLargerId, quantityAvailable - quantityNeeded],
            [normalizedSmallerId, newSmallerQuantity]
        ])
    );
}



function calculateBuildUpQuantity(
    availableSmallerPackages: number,
    quantityPerLargerPackage: number
): number {
    //validation
    if (!Number.isSafeInteger(availableSmallerPackages) ||
        availableSmallerPackages < 0 ||
        !Number.isSafeInteger(quantityPerLargerPackage) ||
        quantityPerLargerPackage <= 0) {

        throw new Error("Quantities must be positive integers");

    }

    return Math.floor(availableSmallerPackages / quantityPerLargerPackage)

}

export function buildUpPackaging(
    product: productStructure,
    inventoryRecord: inventory,
    largerPackageId: string,
    smallerPackageId: string
): inventory {
    const normalizedLargerId = largerPackageId.trim()
    const normalizedSmallerId = smallerPackageId.trim()
    if (
        !normalizedLargerId ||
        !normalizedSmallerId.trim()
    ) {
        throw new Error("Packaging level IDs must not be empty");
    }

    if (normalizedLargerId === normalizedSmallerId) {
        throw new Error("Packaging IDs cannot be the same");
    }
    validateStockOperation(product, inventoryRecord, [
        normalizedLargerId,
        normalizedSmallerId
    ]);
    const conversionQuantity = getPackagingConversionQuantity(
        getVariantById(product, inventoryRecord.variantId).packagingHierarchy,
        normalizedLargerId,
        normalizedSmallerId
    );
    const availableSmallerPackages = getStockQuantityOrZero(
        inventoryRecord,
        normalizedSmallerId
    );
    const availableLargerPackages = getStockQuantityOrZero(
        inventoryRecord,
        normalizedLargerId
    );
    const largerPackagesFormed = calculateBuildUpQuantity(
        availableSmallerPackages,
        conversionQuantity
    );

    if (largerPackagesFormed === 0) {
        throw new Error(
            "Insufficient smaller packages to form one complete larger package"
        );
    }

    if (!Number.isSafeInteger(largerPackagesFormed)) {
        throw new Error(
            "Number of larger packages formed exceeds the safe integer limit"
        );
    }
    const smallerPackagesConsumed =
        largerPackagesFormed * conversionQuantity;
    if (!Number.isSafeInteger(smallerPackagesConsumed)) {
        throw new Error(
            "Build-up would consume an unsafe number of smaller packages"
        );
    }
    const newLargerQuantity =
        availableLargerPackages + largerPackagesFormed;
    if (!Number.isSafeInteger(newLargerQuantity)) {
        throw new Error("Build-up would produce an unsafe stock quantity");
    }

    return applyQuantityUpdates(
        inventoryRecord,
        new Map([
            [normalizedLargerId, newLargerQuantity],
            [
                normalizedSmallerId,
                availableSmallerPackages - smallerPackagesConsumed
            ]
        ])
    );
}

export function adjustStock(
    product: productStructure,
    inventoryRecord: inventory,
    packagingLevelId: string,
    actualQuantity: number
): inventory {
    if (actualQuantity < 0 || !Number.isSafeInteger(actualQuantity)) {
        throw new Error("Quantity must be a safe non-negative integer");
    }

    const normalizedPackagingId = packagingLevelId.trim()

    if (normalizedPackagingId === "") {
        throw new Error("Packaging level ID must not be empty");
    }
    validateStockOperation(product, inventoryRecord, [normalizedPackagingId]);
    return applyQuantityUpdates(
        inventoryRecord,
        new Map([[normalizedPackagingId, actualQuantity]])
    );
}
