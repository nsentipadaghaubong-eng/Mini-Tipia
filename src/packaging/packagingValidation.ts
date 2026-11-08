import type { inventory } from "../inventory/inventoryStock";
import type { productStructure } from "../products/productStructure";
import type { packagingLevel } from "./packagingHierarchy";

export interface PackagingStockReference {
    inventoryId: string;
    batchId: string | null;
    packagingLevelId: string;
    quantity: number;
}

export interface PackagingHierarchyReference {
    packagingLevelId: string;
    packagingLevelName: string;
    relation: "contains" | "contained-by";
}

export interface PackagingRemovalAssessment {
    canRemove: boolean;
    packagingLevel: packagingLevel;
    stockReferences: PackagingStockReference[];
    hierarchyReferences: PackagingHierarchyReference[];
    blockingReasons: string[];
}

export interface PackagingHierarchyChangePlan {
    updatedProduct: productStructure;
    inventoryRecords: inventory[];
    addedPackagingLevels: packagingLevel[];
    removedPackagingLevels: packagingLevel[];
}

function validateInventoryPackagingReferences(
    productId: string,
    variantId: string,
    levels: readonly packagingLevel[],
    inventoryRecords: readonly inventory[]
): void {
    const levelIds = new Set(levels.map((level) => level.id));
    for (const record of inventoryRecords) {
        if (
            record.productId !== productId ||
            record.variantId !== variantId
        ) {
            continue;
        }

        const stockIds = new Set<string>();
        for (const stock of record.stockQuantities) {
            if (stockIds.has(stock.packagingLevelId)) {
                throw new Error(
                    `Duplicate stock quantity for packaging level: ${stock.packagingLevelId}`
                );
            }
            stockIds.add(stock.packagingLevelId);

            if (!levelIds.has(stock.packagingLevelId)) {
                throw new Error(
                    `Inventory record ${record.id} references an unknown packaging level: ${stock.packagingLevelId}`
                );
            }
            if (!Number.isSafeInteger(stock.quantity) || stock.quantity < 0) {
                throw new Error(
                    `Inventory record ${record.id} has an invalid stock quantity for packaging level: ${stock.packagingLevelId}`
                );
            }
        }
    }
}

export function validatePackagingHierarchy(
    levels: readonly packagingLevel[]
): void {
    if (levels.length === 0) {
        return;
    }

    const levelsById = new Map<string, packagingLevel>();
    for (const level of levels) {
        if (level.id.trim() === "" || level.id !== level.id.trim()) {
            throw new Error("Packaging level IDs must be non-empty and trimmed.");
        }
        if (levelsById.has(level.id)) {
            throw new Error(`Duplicate packaging level ID: ${level.id}`);
        }
        if (level.name.trim() === "") {
            throw new Error("Packaging level names must not be empty.");
        }
        if (
            level.costPrice !== null &&
            (!Number.isFinite(level.costPrice) || level.costPrice < 0)
        ) {
            throw new Error(`Invalid cost price for packaging level: ${level.id}`);
        }
        if (
            level.sellingPrice !== null &&
            (!Number.isFinite(level.sellingPrice) || level.sellingPrice < 0)
        ) {
            throw new Error(`Invalid selling price for packaging level: ${level.id}`);
        }

        levelsById.set(level.id, level);
    }

    const referencedIds = new Set<string>();
    for (const level of levels) {
        if (level.nextLevelId === null) {
            if (level.quantityofNextLevel !== null) {
                throw new Error(
                    `Terminal packaging level must not have a conversion quantity: ${level.id}`
                );
            }
            continue;
        }

        if (
            level.nextLevelId.trim() === "" ||
            level.nextLevelId !== level.nextLevelId.trim()
        ) {
            throw new Error(`Invalid next packaging level ID: ${level.id}`);
        }
        if (level.nextLevelId === level.id) {
            throw new Error(`Packaging level cannot contain itself: ${level.id}`);
        }
        if (!levelsById.has(level.nextLevelId)) {
            throw new Error(
                `Next packaging level not found: ${level.nextLevelId}`
            );
        }
        if (
            level.quantityofNextLevel === null ||
            !Number.isSafeInteger(level.quantityofNextLevel) ||
            level.quantityofNextLevel <= 0
        ) {
            throw new Error(
                `Conversion quantity must be a positive safe integer: ${level.id}`
            );
        }

        referencedIds.add(level.nextLevelId);
    }

    const roots = levels.filter((level) => !referencedIds.has(level.id));
    if (roots.length !== 1) {
        throw new Error("Packaging hierarchy must have exactly one root.");
    }

    const visited = new Set<string>();
    let current: packagingLevel | undefined = roots[0];
    while (current) {
        if (visited.has(current.id)) {
            throw new Error(`Circular packaging relationship: ${current.id}`);
        }
        visited.add(current.id);
        current = current.nextLevelId === null
            ? undefined
            : levelsById.get(current.nextLevelId);
    }

    if (visited.size !== levels.length) {
        throw new Error("Packaging hierarchy contains a disconnected or circular chain.");
    }
}

export function getPackagingLevelFromHierarchy(
    levels: readonly packagingLevel[],
    packagingLevelId: string
): packagingLevel {
    validatePackagingHierarchy(levels);
    const normalizedId = packagingLevelId.trim();
    const level = levels.find((candidate) => candidate.id === normalizedId);
    if (!level) {
        throw new Error("Packaging level does not belong to this variant.");
    }
    return level;
}

export function getPackagingConversionQuantity(
    levels: readonly packagingLevel[],
    largerPackageId: string,
    smallerPackageId: string
): number {
    validatePackagingHierarchy(levels);
    const larger = getPackagingLevelFromHierarchy(levels, largerPackageId);
    getPackagingLevelFromHierarchy(levels, smallerPackageId);

    if (larger.nextLevelId !== smallerPackageId.trim()) {
        throw new Error("Packaging levels are not directly related.");
    }
    if (larger.quantityofNextLevel === null) {
        throw new Error("Packaging conversion quantity is not defined.");
    }

    return larger.quantityofNextLevel;
}

export function assessPackagingLevelRemoval(
    productId: string,
    variantId: string,
    levels: readonly packagingLevel[],
    packagingLevelId: string,
    inventoryRecords: readonly inventory[]
): PackagingRemovalAssessment {
    validatePackagingHierarchy(levels);
    const target = getPackagingLevelFromHierarchy(levels, packagingLevelId);
    validateInventoryPackagingReferences(
        productId,
        variantId,
        levels,
        inventoryRecords
    );
    const stockReferences: PackagingStockReference[] = [];

    for (const record of inventoryRecords) {
        if (
            record.productId !== productId ||
            record.variantId !== variantId ||
            !record.stockQuantities.some(
                (stock) => stock.packagingLevelId === target.id
            )
        ) {
            continue;
        }

        for (const stock of record.stockQuantities) {
            if (stock.packagingLevelId === target.id) {
                stockReferences.push({
                    inventoryId: record.id,
                    batchId: record.batchId,
                    packagingLevelId: target.id,
                    quantity: stock.quantity
                });
            }
        }
    }

    const hierarchyReferences: PackagingHierarchyReference[] = [];
    for (const level of levels) {
        if (level.id === target.id && level.nextLevelId !== null) {
            const child = levels.find(
                (candidate) => candidate.id === level.nextLevelId
            );
            if (child) {
                hierarchyReferences.push({
                    packagingLevelId: child.id,
                    packagingLevelName: child.name,
                    relation: "contains"
                });
            }
        } else if (level.nextLevelId === target.id) {
            hierarchyReferences.push({
                packagingLevelId: level.id,
                packagingLevelName: level.name,
                relation: "contained-by"
            });
        }
    }

    const blockingReasons: string[] = [];
    if (stockReferences.length > 0) {
        blockingReasons.push(
            "Inventory records reference this packaging level; its quantities cannot be orphaned."
        );
    }
    if (hierarchyReferences.length > 0) {
        blockingReasons.push(
            "Other packaging levels depend on this hierarchy relationship."
        );
    }

    return {
        canRemove: blockingReasons.length === 0,
        packagingLevel: { ...target },
        stockReferences,
        hierarchyReferences,
        blockingReasons
    };
}

export function preparePackagingHierarchyChange(
    product: productStructure,
    variantId: string,
    nextLevels: readonly packagingLevel[],
    inventoryRecords: inventory[]
): PackagingHierarchyChangePlan {
    const variants = product.variant.filter((item) => item.id === variantId);
    if (variants.length !== 1) {
        throw new Error(
            variants.length === 0
                ? "Variant does not belong to this product."
                : "Duplicate variant ID found in product."
        );
    }

    const selectedVariant = variants[0];
    const currentLevels = selectedVariant.packagingHierarchy;
    validatePackagingHierarchy(currentLevels);
    validatePackagingHierarchy(nextLevels);
    validateInventoryPackagingReferences(
        product.id,
        variantId,
        currentLevels,
        inventoryRecords
    );

    const currentIds = new Set(currentLevels.map((level) => level.id));
    const nextIds = new Set(nextLevels.map((level) => level.id));
    const removedPackagingLevels = currentLevels
        .filter((level) => !nextIds.has(level.id))
        .map((level) => ({ ...level }));
    const addedPackagingLevels = nextLevels
        .filter((level) => !currentIds.has(level.id))
        .map((level) => ({ ...level }));
    const removedIds = new Set(
        removedPackagingLevels.map((level) => level.id)
    );

    const orphanedStock = inventoryRecords.flatMap((record) =>
        record.productId === product.id && record.variantId === variantId
            ? record.stockQuantities.filter((stock) =>
                removedIds.has(stock.packagingLevelId)
            ).map((stock) => ({
                inventoryId: record.id,
                packagingLevelId: stock.packagingLevelId
            }))
            : []
    );
    if (orphanedStock.length > 0) {
        const refs = orphanedStock
            .map((item) => `${item.inventoryId}:${item.packagingLevelId}`)
            .join(", ");
        throw new Error(
            `Packaging change would orphan inventory references: ${refs}`
        );
    }

    const updatedProduct: productStructure = {
        ...product,
        variant: product.variant.map((item) =>
            item.id === variantId
                ? {
                    ...item,
                    packagingHierarchy: nextLevels.map((level) => ({ ...level }))
                }
                : item
        )
    };

    return {
        updatedProduct,
        inventoryRecords,
        addedPackagingLevels,
        removedPackagingLevels
    };
}
