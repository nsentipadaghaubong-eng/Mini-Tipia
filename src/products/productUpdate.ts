import type { packagingLevel } from "../packaging/packagingHierarchy";
import { validatePackagingHierarchy } from "../packaging/packagingValidation";
import type { inventory, stockQuantity } from "../inventory/inventoryStock";
import type { inventoryBatch } from "../inventory/inventoryBatch";
import { createInventory } from "../inventory/inventoryStock";
import type { productStructure, variant } from "./productStructure";

export interface PackagingUpdateDraft {
    id: string;
    name: string;
    nextLevelId: string;
    quantityofNextLevel: string;
    costPrice: string;
    sellingPrice: string;
    initialStock?: string;
    initialStockBatchId?: string;
}

export interface VariantUpdateDraft {
    id: string;
    name: string;
    nafdacRegistrationNumber: string;
    packaging: PackagingUpdateDraft[];
}

export interface ProductUpdateDraft {
    id: string;
    name: string;
    genericName: string;
    manufacturer: string;
    category: string;
    reason: string;
    variants: VariantUpdateDraft[];
}

export type ProductUpdateErrors = Record<string, string>;

export function createProductUpdateDraft(
    product: productStructure
): ProductUpdateDraft {
    return {
        id: product.id,
        name: product.name,
        genericName: product.genericName ?? "",
        manufacturer: product.manufacturer ?? "",
        category: product.category ?? "",
        reason: "",
        variants: product.variant.map((productVariant) => ({
            id: productVariant.id,
            name: productVariant.variantName,
            nafdacRegistrationNumber:
                productVariant.nafdacRegistrationNumber ?? "",
            packaging: productVariant.packagingHierarchy.map((level) => ({
                id: level.id,
                name: level.name,
                nextLevelId: level.nextLevelId ?? "",
                quantityofNextLevel:
                    level.quantityofNextLevel === null
                        ? ""
                        : String(level.quantityofNextLevel),
                costPrice:
                    level.costPrice === null ? "" : String(level.costPrice),
                sellingPrice:
                    level.sellingPrice === null
                        ? ""
                        : String(level.sellingPrice),
                initialStock: "0",
                initialStockBatchId: ""
            }))
        }))
    };
}

export function addVariantToUpdateDraft(
    draft: ProductUpdateDraft,
    makeId: () => string = () => crypto.randomUUID()
): ProductUpdateDraft {
    const id = makeId();
    const existingIds = new Set([
        draft.id,
        ...draft.variants.flatMap((item) => [
            item.id,
            ...item.packaging.map((level) => level.id)
        ])
    ]);
    if (id.trim() === "" || id !== id.trim() || existingIds.has(id)) {
        throw new Error("New variant ID must be unique and non-empty.");
    }

    return {
        ...draft,
        variants: [
            ...draft.variants,
            {
                id,
                name: "",
                nafdacRegistrationNumber: "",
                packaging: []
            }
        ]
    };
}

export function addPackagingLevelToUpdateDraft(
    draft: ProductUpdateDraft,
    variantIndex: number,
    makeId: () => string = () => crypto.randomUUID()
): ProductUpdateDraft {
    const productVariant = draft.variants[variantIndex];
    if (!productVariant) {
        throw new Error("Variant does not belong to this product.");
    }

    const id = makeId();
    const existingIds = new Set(
        [
            draft.id,
            ...draft.variants.flatMap((item) => [
                item.id,
                ...item.packaging.map((level) => level.id)
            ])
        ]
    );
    if (id.trim() === "" || id !== id.trim() || existingIds.has(id)) {
        throw new Error("New packaging level ID must be unique and non-empty.");
    }

    const packaging = productVariant.packaging.map((level) => ({ ...level }));
    const terminalLevel = packaging.find((level) => level.nextLevelId === "");
    if (terminalLevel) {
        terminalLevel.nextLevelId = id;
        terminalLevel.quantityofNextLevel = "";
    }

    const updatedVariant: VariantUpdateDraft = {
        ...productVariant,
        packaging: [
            ...packaging,
            {
                id,
                name: "",
                nextLevelId: "",
                quantityofNextLevel: "",
                costPrice: "",
                sellingPrice: "",
                initialStock: "0",
                initialStockBatchId: ""
            }
        ]
    };

    return {
        ...draft,
        variants: draft.variants.map((item, index) =>
            index === variantIndex ? updatedVariant : item
        )
    };
}

function parseOptionalPrice(value: string): number | null | undefined {
    if (value.trim() === "") {
        return null;
    }

    const price = Number(value);
    return Number.isFinite(price) && price >= 0 ? price : undefined;
}

function parseOptionalSafeInteger(value: string | undefined): number | undefined {
    const normalized = value ?? "";
    if (normalized.trim() === "") {
        return 0;
    }

    const quantity = Number(normalized);
    return Number.isSafeInteger(quantity) && quantity >= 0
        ? quantity
        : undefined;
}

export function applyPackagingLevelInitialStock(
    product: productStructure,
    inventoryRecords: inventory[],
    inventoryBatches: inventoryBatch[],
    variantId: string,
    packagingLevelId: string,
    initialStock: string,
    batchId: string | null = null
): inventory[] {
    const quantity = parseOptionalSafeInteger(initialStock);
    if (quantity === undefined) {
        throw new Error("Initial stock quantity must be a non-negative safe integer.");
    }
    if (quantity === 0) {
        return inventoryRecords;
    }

    const variant = product.variant.find((item) => item.id === variantId);
    if (!variant) {
        throw new Error("Variant does not belong to this product.");
    }

    const existingIds = new Set(variant.packagingHierarchy.map((level) => level.id));
    if (existingIds.has(packagingLevelId)) {
        return inventoryRecords;
    }

    const normalizedBatchId = batchId?.trim() ?? null;
    const matchingBatch = normalizedBatchId === null
        ? null
        : inventoryBatches.find((candidate) =>
            candidate.productId === product.id &&
            candidate.variantId === variantId &&
            candidate.batchId === normalizedBatchId
        );

    if (normalizedBatchId !== null && !matchingBatch) {
        throw new Error("Batch does not belong to this variant.");
    }

    const existingRecord = inventoryRecords.find((record) =>
        record.productId === product.id &&
        record.variantId === variantId &&
        record.batchId === normalizedBatchId
    );

    const nextStock: stockQuantity[] = existingRecord
        ? [...existingRecord.stockQuantities]
        : [];
    const index = nextStock.findIndex(
        (stock) => stock.packagingLevelId === packagingLevelId
    );

    if (index === -1) {
        nextStock.push({ packagingLevelId: packagingLevelId, quantity });
    } else {
        nextStock[index] = {
            ...nextStock[index],
            quantity: nextStock[index].quantity + quantity
        };
    }

    if (existingRecord) {
        return inventoryRecords.map((record) =>
            record.id === existingRecord.id
                ? { ...record, stockQuantities: nextStock }
                : record
        );
    }

    return [
        ...inventoryRecords,
        createInventory(
            product.id,
            variantId,
            normalizedBatchId,
            nextStock,
            crypto.randomUUID()
        )
    ];
}

function validateRetainedIds(
    original: productStructure,
    draft: ProductUpdateDraft,
    errors: ProductUpdateErrors
): void {
    if (draft.id !== original.id) {
        errors.id = "Product ID cannot be changed.";
    }

    const originalVariantIds = original.variant.map((item) => item.id);
    const draftVariantIds = draft.variants.map((item) => item.id);
    if (
        originalVariantIds.some((id) => !draftVariantIds.includes(id)) ||
        new Set(draftVariantIds).size !== draftVariantIds.length ||
        draftVariantIds.includes(original.id)
    ) {
        errors.variants =
            "Existing variants cannot be removed or replaced, and new variant IDs must be unique.";
    }

    original.variant.forEach((productVariant, variantIndex) => {
        const draftVariant = draft.variants.find(
            (item) => item.id === productVariant.id
        );
        if (!draftVariant) {
            return;
        }

        const oldIds = productVariant.packagingHierarchy.map((level) => level.id);
        const newIds = draftVariant.packaging.map((level) => level.id);
        if (
            oldIds.length !== newIds.length &&
            oldIds.some((id) => !newIds.includes(id))
        ) {
            errors[`variants.${variantIndex}.packaging`] =
                "Packaging levels cannot be removed in this stage.";
        }
        if (oldIds.some((id) => !newIds.includes(id))) {
            errors[`variants.${variantIndex}.packaging`] =
                "Packaging levels cannot be removed in this stage.";
        }
        if (new Set(newIds).size !== newIds.length) {
            errors[`variants.${variantIndex}.packaging`] =
                "Packaging level IDs must be unique.";
        }
    });

    const originalVariantIdSet = new Set(originalVariantIds);
    draft.variants.forEach((productVariant, variantIndex) => {
        if (originalVariantIdSet.has(productVariant.id)) {
            return;
        }

        const collidesWithPackaging = draft.variants.some((item) =>
            item.packaging.some((level) => level.id === productVariant.id)
        );
        if (collidesWithPackaging) {
            errors[`variants.${variantIndex}.id`] =
                "Variant IDs must not match packaging level IDs.";
        }
    });
}

export function validateProductUpdateDraft(
    draft: ProductUpdateDraft,
    original: productStructure
): ProductUpdateErrors {
    const errors: ProductUpdateErrors = {};
    if (draft.name.trim() === "") {
        errors.name = "Product name is required.";
    }
    if (draft.reason.trim() === "") {
        errors.reason = "A reason for this product update is required.";
    }
    if (draft.variants.length === 0) {
        errors.variants = "At least one variant is required.";
    }

    validateRetainedIds(original, draft, errors);

    draft.variants.forEach((productVariant, variantIndex) => {
        const prefix = `variants.${variantIndex}`;
        if (
            productVariant.id.trim() === "" ||
            productVariant.id !== productVariant.id.trim()
        ) {
            errors[`${prefix}.id`] = "Variant IDs must be non-empty and trimmed.";
        }
        if (productVariant.name.trim() === "") {
            errors[`${prefix}.name`] = "Variant name is required.";
        }

        const hierarchy: packagingLevel[] = productVariant.packaging.map(
            (level, levelIndex) => {
                if (level.name.trim() === "") {
                    errors[`${prefix}.packaging.${levelIndex}.name`] =
                        "Packaging level name is required.";
                }

                const quantity =
                    level.quantityofNextLevel.trim() === ""
                        ? null
                        : Number(level.quantityofNextLevel);
                const costPrice = parseOptionalPrice(level.costPrice);
                const sellingPrice = parseOptionalPrice(level.sellingPrice);

                if (
                    level.nextLevelId !== "" &&
                    (quantity === null ||
                        !Number.isSafeInteger(quantity) ||
                        quantity <= 0)
                ) {
                    errors[
                        `${prefix}.packaging.${levelIndex}.quantityofNextLevel`
                    ] = "Enter a positive whole number.";
                }
                if (level.nextLevelId === "" && quantity !== null) {
                    errors[
                        `${prefix}.packaging.${levelIndex}.quantityofNextLevel`
                    ] = "The lowest packaging level must not have a conversion quantity.";
                }
                if (costPrice === undefined) {
                    errors[`${prefix}.packaging.${levelIndex}.costPrice`] =
                        "Enter a non-negative price.";
                }
                if (sellingPrice === undefined) {
                    errors[`${prefix}.packaging.${levelIndex}.sellingPrice`] =
                        "Enter a non-negative price.";
                }

                const initialStock = parseOptionalSafeInteger(level.initialStock);
                if (initialStock === undefined) {
                    errors[`${prefix}.packaging.${levelIndex}.initialStock`] =
                        "Initial stock must be a non-negative whole number.";
                }

                return {
                    id: level.id,
                    name: level.name.trim(),
                    nextLevelId: level.nextLevelId || null,
                    quantityofNextLevel: quantity,
                    costPrice: costPrice ?? null,
                    sellingPrice: sellingPrice ?? null
                };
            }
        );

        try {
            validatePackagingHierarchy(hierarchy);
        } catch (error) {
            errors[`${prefix}.packaging.hierarchy`] =
                error instanceof Error
                    ? error.message
                    : "Packaging hierarchy is invalid.";
        }
    });

    return errors;
}

export function buildUpdatedProduct(
    original: productStructure,
    draft: ProductUpdateDraft
): productStructure {
    const errors = validateProductUpdateDraft(draft, original);
    if (Object.keys(errors).length > 0) {
        throw new Error(Object.values(errors)[0]);
    }

    const updatedVariants: variant[] = draft.variants.map((item) => ({
        id: item.id,
        variantName: item.name.trim(),
        ...(item.nafdacRegistrationNumber.trim() === ""
            ? {}
            : { nafdacRegistrationNumber: item.nafdacRegistrationNumber.trim() }),
        packagingHierarchy: item.packaging.map((level) => ({
            id: level.id,
            name: level.name.trim(),
            costPrice: parseOptionalPrice(level.costPrice) ?? null,
            sellingPrice: parseOptionalPrice(level.sellingPrice) ?? null,
            quantityofNextLevel:
                level.nextLevelId === ""
                    ? null
                    : Number(level.quantityofNextLevel),
            nextLevelId: level.nextLevelId || null
        }))
    }));

    return {
        ...original,
        name: draft.name.trim(),
        ...(draft.genericName.trim() === ""
            ? { genericName: undefined }
            : { genericName: draft.genericName.trim() }),
        ...(draft.manufacturer.trim() === ""
            ? { manufacturer: undefined }
            : { manufacturer: draft.manufacturer.trim() }),
        ...(draft.category.trim() === ""
            ? { category: undefined }
            : { category: draft.category.trim() }),
        variant: updatedVariants
    };
}
