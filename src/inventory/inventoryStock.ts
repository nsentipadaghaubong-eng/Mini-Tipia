

export interface inventory {
    id: string;
    productId: string;
    variantId: string;
    batchId: string;
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

export function createInventory(
    productId: string,
    variantId: string,
    batchId: string,
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
    const normalizedBatchId = batchId.trim();

    if (
        normalizedBatchId === ""
    ) {
        throw new Error("Batch number must not be empty or whitespace");
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

    const index = inventoryRecord.stockQuantities.findIndex((item) => {
        return normalizedPackagingId === item.packagingLevelId;
    });

    if (index === -1) {
        throw new Error(
            `This packaging level with id: ${packagingLevelId} doesn't exist`
        );
    }

    const existingQuantity = inventoryRecord.stockQuantities[index].quantity;

    if (!Number.isSafeInteger(existingQuantity) || existingQuantity < 0) {
        throw new Error(
            "Existing stock quantity must be a non-negative safe integer"
        );
    }

    const newQuantity = existingQuantity + updateStock;

    if (!Number.isSafeInteger(newQuantity)) {
        throw new Error("The sum of these 2 numbers is too large");
    }

    const updatedStock = inventoryRecord.stockQuantities.map((item) => {
        return normalizedPackagingId === item.packagingLevelId
            ? { ...item, quantity: newQuantity }
            : item;
    });

    return {
        ...inventoryRecord,
        stockQuantities: updatedStock
    };
}

export function removeStock(
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

    const index = inventoryRecord.stockQuantities.findIndex((item) => {
        return normalizedPackagingId === item.packagingLevelId;
    });

    if (index === -1) {
        throw new Error(
            `This packaging level with id: ${packagingLevelId} doesn't exist`
        );
    }

    const availableStock =
        inventoryRecord.stockQuantities[index].quantity;

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

    const deductStock = inventoryRecord.stockQuantities.map((item) => {
        return item.packagingLevelId === normalizedPackagingId
            ? { ...item, quantity: updatedStock }
            : item;
    });

    return {
        ...inventoryRecord,
        stockQuantities: deductStock
    };
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
    inventoryRecord: inventory,
    largerPackageId: string,
    smallerPackageId: string,
    conversionQuantity: number,
    shortage: number
): inventory {

    // 1. Validate conversion quantity and shortage
    if (
        !Number.isSafeInteger(conversionQuantity) ||
        conversionQuantity <= 0 ||
        !Number.isSafeInteger(shortage) ||
        shortage <= 0
    ) {
        throw new Error("Quantities must be positive safe integers");
    }

    // 2. Normalize packaging IDs
    const normalizedLargerId = largerPackageId.trim();
    const normalizedSmallerId = smallerPackageId.trim();

    if (!normalizedLargerId || !normalizedSmallerId) {
        throw new Error("Packaging level IDs must not be empty");
    }

    // 3. Reject identical packaging IDs
    if (normalizedLargerId === normalizedSmallerId) {
        throw new Error("Packaging IDs cannot be the same");
    }

    // 4. Find both packaging levels
    const findLargerId = inventoryRecord.stockQuantities.findIndex(
        (item) => normalizedLargerId === item.packagingLevelId
    );

    const findSmallerId = inventoryRecord.stockQuantities.findIndex(
        (item) => normalizedSmallerId === item.packagingLevelId
    );

    if (findLargerId === -1) {
        throw new Error(
            `The packaging level with ID: ${largerPackageId} doesn't exist`
        );
    }

    if (findSmallerId === -1) {
        throw new Error(
            `The packaging level with ID: ${smallerPackageId} doesn't exist`
        );
    }

    // 5. Get existing quantities
    const quantityAvailable =
        inventoryRecord.stockQuantities[findLargerId].quantity;

    const smallerQuantityAvailable =
        inventoryRecord.stockQuantities[findSmallerId].quantity;

    // 6. Validate existing quantities
    if (
        !Number.isSafeInteger(quantityAvailable) ||
        quantityAvailable < 0 ||
        !Number.isSafeInteger(smallerQuantityAvailable) ||
        smallerQuantityAvailable < 0
    ) {
        throw new Error(
            "Available stock quantities must be non-negative safe integers"
        );
    }

    // 7. Calculate the number of larger packages needed
    const quantityNeeded = calculateBreakdownQuantity(
        shortage,
        conversionQuantity
    );

    // 8. Check whether sufficient larger packages exist
    validateSufficientStock(quantityAvailable, quantityNeeded);

    // 9. Calculate the number of smaller packages created
    const smallerPackagesCreated =
        quantityNeeded * conversionQuantity;

    if (!Number.isSafeInteger(smallerPackagesCreated)) {
        throw new Error(
            "Breakdown would produce an unsafe number of smaller packages"
        );
    }

    // 10. Calculate the new smaller-package quantity
    const newSmallerQuantity =
        smallerQuantityAvailable + smallerPackagesCreated;

    if (!Number.isSafeInteger(newSmallerQuantity)) {
        throw new Error(
            "New smaller-package quantity exceeds the safe integer limit"
        );
    }

    // 11. Update both packaging levels
    const result = inventoryRecord.stockQuantities.map((item) => {

        if (normalizedLargerId === item.packagingLevelId) {
            return {
                ...item,
                quantity: item.quantity - quantityNeeded
            };
        }

        if (normalizedSmallerId === item.packagingLevelId) {
            return {
                ...item,
                quantity: newSmallerQuantity
            };
        }

        return item;
    });

    // 12. Validate the completed result array
    if (
        result.some(
            (item) =>
                !Number.isSafeInteger(item.quantity) ||
                item.quantity < 0
        )
    ) {
        throw new Error(
            "Breakdown would produce invalid stock quantities"
        );
    }

    // 13. Return a new inventory record
    return {
        ...inventoryRecord,
        stockQuantities: result
    };
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
    inventoryRecord: inventory,
    largerPackageId: string,
    smallerPackageId: string,
    conversionQuantity: number
): inventory {
    // 1. Validate the conversion quantity
    if (!Number.isSafeInteger(conversionQuantity) || conversionQuantity <= 0) {
        throw new Error("Conversion quantity must be a safe positive integer");
    }

    const normalizedLargerId = largerPackageId.trim()
    const normalizedSmallerId = smallerPackageId.trim()
    // 2. Validate the packaging IDs
    if (
        !normalizedLargerId ||
        !normalizedSmallerId.trim()
    ) {
        throw new Error("Packaging level IDs must not be empty");
    }

    if (normalizedLargerId === normalizedSmallerId) {
        throw new Error("Packaging IDs cannot be the same");
    }

    // 3. Find both packaging levels
    const largerIndex = inventoryRecord.stockQuantities.findIndex(
        (item) => item.packagingLevelId === normalizedLargerId
    );

    const smallerIndex = inventoryRecord.stockQuantities.findIndex(
        (item) => item.packagingLevelId === normalizedSmallerId
    );

    if (largerIndex === -1) {
        throw new Error(
            `Packaging level with ID ${normalizedLargerId} doesn't exist`
        );
    }

    if (smallerIndex === -1) {
        throw new Error(
            `Packaging level with ID ${normalizedSmallerId} doesn't exist`
        );
    }

    // 4. Get the available smaller-package quantity
    const availableSmallerPackages =
        inventoryRecord.stockQuantities[smallerIndex].quantity;

    const availableLargerPackages =
        inventoryRecord.stockQuantities[largerIndex].quantity

    if (!Number.isSafeInteger(availableLargerPackages) ||
        availableLargerPackages < 0 ||
        !Number.isSafeInteger(availableSmallerPackages) ||
        availableSmallerPackages < 0
    ) {
        throw new Error("Available stock quantities must be non-negative safe integers")
    }

    // 5. Calculate the number of complete larger packages
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

    // 6. Calculate the number of smaller packages consumed
    const smallerPackagesConsumed =
        largerPackagesFormed * conversionQuantity;

    if (!Number.isSafeInteger(smallerPackagesConsumed)) {
        throw new Error(
            "Build-up would consume an unsafe number of smaller packages"
        );
    }

    // 7. Update both packaging levels
    const updatedStockQuantities = inventoryRecord.stockQuantities.map(
        (item) => {
            if (item.packagingLevelId === normalizedLargerId) {
                return {
                    ...item,
                    quantity: item.quantity + largerPackagesFormed
                };
            }

            if (item.packagingLevelId === normalizedSmallerId) {
                return {
                    ...item,
                    quantity: item.quantity - smallerPackagesConsumed
                };
            }

            // Preserve every other packaging level
            return item;
        }
    );

    if (updatedStockQuantities.some(
        (item) =>
        !Number.isSafeInteger(item.quantity)||
        item.quantity<0
    )) {
        throw new Error(
            "Build up would produce invalid stock quantities"
        );
    }

    // 8. Return a new inventory record
    return {
        ...inventoryRecord,
        stockQuantities: updatedStockQuantities
    };
}

export function adjustStock(
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

    const index = inventoryRecord.stockQuantities.findIndex((item) => {
        return normalizedPackagingId === item.packagingLevelId;
    });

    if (index === -1) {
        throw new Error(
            `This packaging level with id: ${normalizedPackagingId} doesn't exist`
        );
    }

    const updatedStockQuantities = inventoryRecord.stockQuantities.map(
        (item) => {
            return item.packagingLevelId === normalizedPackagingId
                ? { ...item, quantity: actualQuantity }
                : item;
        }
    );

    if (updatedStockQuantities.some(
        (item) =>
        !Number.isSafeInteger(item.quantity)||
        item.quantity<0
    )) {
        throw new Error(
            "Adjustment would produce invalid stock quantities"
        );
    }

    return {
        ...inventoryRecord,
        stockQuantities: updatedStockQuantities
    };
}
