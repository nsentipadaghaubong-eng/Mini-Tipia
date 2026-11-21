import type { packagingLevel } from "../packaging/packagingHierarchy";
import { validatePackagingHierarchy } from "../packaging/packagingValidation";
import type { productStructure, variant } from "./productStructure";
import { hasAtMostTwoDecimalPlaces } from "../pricing/pricePrecision";

export interface PackagingUpdateDraft {
    id: string;
    name: string;
    nextLevelId: string;
    quantityofNextLevel: string;
    costPrice: string;
    sellingPrice: string;
}

export interface VariantUpdateDraft {
    id: string;
    name: string;
    nafdacRegistrationNumber: string;
    lowStockThresholdQuantity: string;
    lowStockThresholdPackagingLevelId: string;
    packaging: PackagingUpdateDraft[];
}

export interface ProductUpdateDraft {
    id: string;
    name: string;
    description: string;
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
        description: product.description ?? "",
        genericName: product.genericName ?? "",
        manufacturer: product.manufacturer ?? "",
        category: product.category ?? "",
        reason: "",
        variants: product.variant.map((productVariant) => ({
            id: productVariant.id,
            name: productVariant.variantName,
            nafdacRegistrationNumber:
                productVariant.nafdacRegistrationNumber ?? "",
            lowStockThresholdQuantity:
                productVariant.lowStockThreshold === undefined
                    ? ""
                    : String(productVariant.lowStockThreshold.quantity),
            lowStockThresholdPackagingLevelId:
                productVariant.lowStockThreshold?.packagingLevelId ?? "",
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
                        : String(level.sellingPrice)
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
                lowStockThresholdQuantity: "",
                lowStockThresholdPackagingLevelId: "",
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
                sellingPrice: ""
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
    return Number.isFinite(price) &&
        price >= 0 &&
        hasAtMostTwoDecimalPlaces(price)
        ? price
        : undefined;
}

function parseLowStockThresholdQuantity(value: string): number | undefined {
    const normalized = value.trim();
    if (!/^\d+$/.test(normalized)) {
        return undefined;
    }

    const quantity = Number(normalized);
    return Number.isSafeInteger(quantity) ? quantity : undefined;
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
                        "Enter a non-negative price with at most two decimal places.";
                }
                if (sellingPrice === undefined) {
                    errors[`${prefix}.packaging.${levelIndex}.sellingPrice`] =
                        "Enter a non-negative price with at most two decimal places.";
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

        const isNewVariant = !original.variant.some(
            (item) => item.id === productVariant.id
        );
        const thresholdQuantity =
            (productVariant.lowStockThresholdQuantity ?? "").trim();
        const hasPackaging = productVariant.packaging.length > 0;
        const thresholdRequired = hasPackaging || isNewVariant;
        if (thresholdRequired && thresholdQuantity === "") {
            errors[`${prefix}.lowStockThresholdQuantity`] =
                "A low-stock threshold is required for variants with packaging.";
        }
        if (
            !hasPackaging &&
            (isNewVariant || thresholdQuantity !== "")
        ) {
            errors[`${prefix}.packaging`] =
                "Add a packaging level to configure the low-stock threshold.";
        }
        if (
            thresholdQuantity !== "" &&
            parseLowStockThresholdQuantity(thresholdQuantity) === undefined
        ) {
            errors[`${prefix}.lowStockThresholdQuantity`] =
                "Enter a non-negative whole-number low-stock threshold.";
        }
        if (
            (productVariant.lowStockThresholdPackagingLevelId ?? "") !== "" &&
            !productVariant.packaging.some(
                (level) =>
                    level.id ===
                    productVariant.lowStockThresholdPackagingLevelId
            )
        ) {
            errors[`${prefix}.lowStockThresholdPackagingLevelId`] =
                "Select a valid threshold packaging level.";
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
        ...((item.lowStockThresholdQuantity ?? "").trim() === ""
            ? {}
            : {
                lowStockThreshold: {
                    quantity: Number(item.lowStockThresholdQuantity),
                    ...((item.lowStockThresholdPackagingLevelId ?? "") === ""
                        ? {}
                        : {
                            packagingLevelId:
                                item.lowStockThresholdPackagingLevelId
                        })
                }
            }),
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
        ...(draft.description.trim() === ""
            ? { description: undefined }
            : { description: draft.description.trim() }),
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
