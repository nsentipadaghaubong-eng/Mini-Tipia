import {
    prepareActivityEvents,
    snapshotBatch,
    snapshotPackagingLevel,
    snapshotProduct,
    snapshotVariant,
    type ActivityBatchSnapshot,
    type ActivityEvent,
    type ActivityProductSnapshot,
    type ActivityVariantSnapshot
} from "../activity/activity";
import type { inventoryBatch } from "../inventory/inventoryBatch";
import { getInventoryBatchById } from "../inventory/inventoryBatch";
import type { inventory } from "../inventory/inventoryStock";
import {
    breakdownPackaging,
    getStockQuantityOrZero,
    removeStock
} from "../inventory/inventoryStock";
import { validateInventoryRelationships } from "../inventory/inventoryValidation";
import {
    getPackagingConversionQuantity,
    validatePackagingHierarchy
} from "../packaging/packagingValidation";
import type { packagingLevel } from "../packaging/packagingHierarchy";
import { getPackagingLevelById, getVariantById } from "../products/productValidation";
import type { productStructure, variant } from "../products/productStructure";
import {
    normalizeSaleDate,
    validateSaleDraft,
    type SaleDraft
} from "./salesDraft";

export interface SaleStaffMember {
    userId?: string;
    displayName?: string;
}

export interface SaleRequest {
    productId: string;
    variantId: string;
    inventoryRecordId: string;
    batchId: string | null;
    packagingLevelId: string;
    quantity: number;
    appliedSellingPrice?: number;
    discountAmount?: number;
    customerName?: string;
    customerAddress?: string;
    saleDate?: string;
    staffMember?: SaleStaffMember;
    notes?: string;
}

export interface SaleContext {
    products: readonly productStructure[];
    inventoryRecords: readonly inventory[];
    inventoryBatches: readonly inventoryBatch[];
}

export interface FefoBatchRecommendation {
    inventoryRecord: inventory;
    batch: inventoryBatch;
    expired: boolean;
    availableStock: readonly {
        packagingLevelId: string;
        quantity: number;
    }[];
}

export interface FefoRecommendations {
    batches: readonly FefoBatchRecommendation[];
    unbatched: readonly inventory[];
}

export interface CompletedSaleItem {
    readonly lineId: string;
    readonly product: ActivityProductSnapshot;
    readonly variant: ActivityVariantSnapshot;
    readonly batch: ActivityBatchSnapshot | null;
    readonly inventoryRecordId: string;
    readonly packagingLevel: ReturnType<typeof snapshotPackagingLevel>;
    readonly quantity: number;
    readonly defaultSellingPrice: number;
    readonly appliedSellingPrice: number;
    readonly subtotal: number;
    readonly discountAmount: number;
    readonly finalAmount: number;
    readonly expiredBatch: boolean;
}

export interface CompletedSale {
    readonly saleId: string;
    readonly completedAt: string;
    readonly customerName?: string;
    readonly customerAddress?: string;
    readonly saleDate?: string;
    readonly staffMember?: SaleStaffMember;
    readonly notes?: string;
    readonly items: readonly CompletedSaleItem[];
    readonly subtotal: number;
    readonly discountAmount: number;
    readonly finalAmount: number;
    readonly expiredBatchConfirmed: boolean;
}

export interface SalePlan {
    saleId: string;
    lineId?: string;
    request: SaleRequest;
    expectedInventory: inventory;
    updatedInventory: inventory;
    product: productStructure;
    productSnapshot: ActivityProductSnapshot;
    variant: variant;
    variantSnapshot: ActivityVariantSnapshot;
    batchSnapshot: ActivityBatchSnapshot | null;
    packagingLevel: packagingLevel;
    defaultSellingPrice: number;
    appliedSellingPrice: number;
    subtotal: number;
    discountAmount: number;
    finalAmount: number;
    expiredBatch: boolean;
}

export interface SaleCompletion {
    sale: CompletedSale;
    expectedInventory: readonly inventory[];
    updatedInventory: readonly inventory[];
    events: readonly ActivityEvent[];
    draftId?: string;
    expectedDraft?: SaleDraft;
}

export interface SaleDraftPlan {
    draftId: string;
    draft: SaleDraft;
    customerName?: string;
    customerAddress?: string;
    saleDate?: string;
    staffMember?: SaleStaffMember;
    notes?: string;
    linePlans: readonly SalePlan[];
    expectedInventory: readonly inventory[];
    updatedInventory: readonly inventory[];
}

export interface SaleEngineOptions {
    makeId?: () => string;
    now?: () => Date;
    makeEventId?: () => string;
}

export function resolveDefaultSellingPrice(
    product: productStructure,
    variantId: string,
    packagingLevelId: string,
    batch: inventoryBatch | null
): number | null {
    const selectedVariant = getVariantById(product, variantId);
    const packagingLevel = getPackagingLevelById(
        selectedVariant,
        packagingLevelId
    );

    if (batch) {
        if (
            batch.productId !== product.id ||
            batch.variantId !== selectedVariant.id
        ) {
            throw new Error("Batch does not belong to this variant.");
        }

        const receivedPricing = batch.receivedPricing;
        if (receivedPricing) {
            getPackagingLevelById(
                selectedVariant,
                receivedPricing.packagingLevelId
            );
            if (
                !Number.isFinite(receivedPricing.sellingPrice) ||
                receivedPricing.sellingPrice < 0
            ) {
                throw new Error("Batch received selling price must be non-negative.");
            }
            if (receivedPricing.packagingLevelId === packagingLevel.id) {
                return receivedPricing.sellingPrice;
            }
        }
    }

    return packagingLevel.sellingPrice;
}

function isValidDate(date: Date, label: string): number {
    const timestamp = date.getTime();
    if (!Number.isFinite(timestamp)) {
        throw new Error(`${label} must be a valid date.`);
    }
    return timestamp;
}

function isExpired(expiryDate: Date | null, now: Date): boolean {
    if (expiryDate === null) {
        return false;
    }

    const expiryTimestamp = isValidDate(expiryDate, "Batch expiry date");
    const currentTimestamp = isValidDate(now, "Current date");
    const expiryDay = Date.UTC(
        expiryDate.getUTCFullYear(),
        expiryDate.getUTCMonth(),
        expiryDate.getUTCDate()
    );
    const currentDay = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate()
    );
    if (!Number.isFinite(expiryTimestamp) || !Number.isFinite(currentTimestamp)) {
        throw new Error("Expiry comparison requires valid dates.");
    }
    return expiryDay < currentDay;
}

function hasAvailableStock(record: inventory): boolean {
    return record.stockQuantities.some((stock) => stock.quantity > 0);
}

export function recommendInventoryByFefo(
    product: productStructure,
    variantId: string,
    inventoryRecords: readonly inventory[],
    inventoryBatches: readonly inventoryBatch[],
    now: Date = new Date()
): FefoRecommendations {
    const selectedVariant = getVariantById(product, variantId);
    validatePackagingHierarchy(selectedVariant.packagingHierarchy);
    isValidDate(now, "Current date");
    const batches: FefoBatchRecommendation[] = [];
    const unbatched: inventory[] = [];

    for (const record of inventoryRecords) {
        if (
            record.productId !== product.id ||
            record.variantId !== selectedVariant.id
        ) {
            continue;
        }

        validateInventoryRelationships(product, record, [...inventoryBatches]);
        if (!hasAvailableStock(record)) {
            continue;
        }

        if (record.batchId === null) {
            unbatched.push(record);
            continue;
        }

        const batch = getInventoryBatchById(
            [...inventoryBatches],
            record.batchId
        );
        batches.push({
            inventoryRecord: record,
            batch,
            expired: isExpired(batch.expiryDate, now),
            availableStock: record.stockQuantities.filter(
                (stock) => stock.quantity > 0
            )
        });
    }

    batches.sort((left, right) => {
        const leftExpiry = left.batch.expiryDate;
        const rightExpiry = right.batch.expiryDate;
        if (leftExpiry === null && rightExpiry === null) {
            return 0;
        }
        if (leftExpiry === null) {
            return 1;
        }
        if (rightExpiry === null) {
            return -1;
        }
        return (
            isValidDate(leftExpiry, "Batch expiry date") -
            isValidDate(rightExpiry, "Batch expiry date")
        );
    });

    return { batches, unbatched };
}

function orderedPackagingLevels(
    selectedVariant: variant
): packagingLevel[] {
    const levels = selectedVariant.packagingHierarchy;
    validatePackagingHierarchy(levels);
    if (levels.length === 0) {
        throw new Error("The selected variant has no packaging levels.");
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

    const levelsById = new Map(levels.map((level) => [level.id, level]));
    const ordered: packagingLevel[] = [];
    let current: packagingLevel | undefined = root;
    while (current) {
        ordered.push(current);
        current = current.nextLevelId === null
            ? undefined
            : levelsById.get(current.nextLevelId);
    }
    return ordered;
}

function roundMoney(value: number): number {
    if (!Number.isFinite(value)) {
        throw new Error("Sale amount must be a finite number.");
    }
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

function prepareInventoryAllocation(
    product: productStructure,
    selectedVariant: variant,
    record: inventory,
    packagingLevelId: string,
    quantity: number
): inventory {
    const levels = orderedPackagingLevels(selectedVariant);
    const selectedIndex = levels.findIndex(
        (level) => level.id === packagingLevelId
    );
    if (selectedIndex === -1) {
        throw new Error("Packaging level does not belong to this variant.");
    }

    let shortage = Math.max(
        0,
        quantity - getStockQuantityOrZero(record, packagingLevelId)
    );
    const breakdownShortages = new Map<number, number>();
    for (let childIndex = selectedIndex; childIndex > 0 && shortage > 0; childIndex--) {
        const parent = levels[childIndex - 1];
        const child = levels[childIndex];
        const conversionQuantity = getPackagingConversionQuantity(
            selectedVariant.packagingHierarchy,
            parent.id,
            child.id
        );
        breakdownShortages.set(childIndex, shortage);
        const parentPackagesNeeded = Math.ceil(
            shortage / conversionQuantity
        );
        const parentAvailable = getStockQuantityOrZero(record, parent.id);
        shortage = Math.max(0, parentPackagesNeeded - parentAvailable);
    }
    if (shortage > 0) {
        throw new Error("Insufficient stock to fulfill the selected packaging quantity.");
    }

    let updated = record;
    for (let childIndex = 1; childIndex <= selectedIndex; childIndex++) {
        const childShortage = breakdownShortages.get(childIndex);
        if (childShortage === undefined) {
            continue;
        }
        updated = breakdownPackaging(
            product,
            updated,
            levels[childIndex - 1].id,
            levels[childIndex].id,
            childShortage
        );
    }

    return removeStock(product, updated, packagingLevelId, quantity);
}

function normalizeOptionalText(value: string | undefined): string | undefined {
    const normalized = value?.trim();
    return normalized ? normalized : undefined;
}

export function prepareSale(
    request: SaleRequest,
    context: SaleContext,
    options: Pick<SaleEngineOptions, "makeId" | "now"> = {}
): SalePlan {
    const productId = request.productId.trim();
    const variantId = request.variantId.trim();
    const inventoryRecordId = request.inventoryRecordId.trim();
    const packagingLevelId = request.packagingLevelId.trim();
    if (!productId || !variantId || !inventoryRecordId || !packagingLevelId) {
        throw new Error("Product, variant, inventory record, and packaging level are required.");
    }
    if (!Number.isSafeInteger(request.quantity) || request.quantity <= 0) {
        throw new Error("Sale quantity must be a positive safe integer.");
    }

    const matchingProducts = context.products.filter(
        (product) => product.id === productId
    );
    if (matchingProducts.length !== 1) {
        throw new Error("Selected product was not found uniquely.");
    }
    const product = matchingProducts[0];
    const selectedVariant = getVariantById(product, variantId);
    const matchingRecords = context.inventoryRecords.filter(
        (record) => record.id === inventoryRecordId
    );
    if (matchingRecords.length !== 1) {
        throw new Error("Selected inventory record was not found uniquely.");
    }
    const selectedInventory = matchingRecords[0];
    if (
        selectedInventory.productId !== product.id ||
        selectedInventory.variantId !== selectedVariant.id ||
        selectedInventory.batchId !== request.batchId
    ) {
        throw new Error("Selected inventory does not match the explicitly selected product, variant, and batch.");
    }

    validateInventoryRelationships(
        product,
        selectedInventory,
        [...context.inventoryBatches]
    );
    const selectedPackaging = getPackagingLevelById(
        selectedVariant,
        packagingLevelId
    );
    const selectedBatch = selectedInventory.batchId === null
        ? null
        : getInventoryBatchById(
            [...context.inventoryBatches],
            selectedInventory.batchId
        );
    const defaultSellingPrice = resolveDefaultSellingPrice(
        product,
        selectedVariant.id,
        selectedPackaging.id,
        selectedBatch
    );
    if (
        defaultSellingPrice === null ||
        !Number.isFinite(defaultSellingPrice) ||
        defaultSellingPrice < 0
    ) {
        throw new Error("A valid default selling price is required for the selected packaging level.");
    }

    const appliedSellingPrice = request.appliedSellingPrice ??
        defaultSellingPrice;
    if (
        !Number.isFinite(appliedSellingPrice) ||
        appliedSellingPrice < 0
    ) {
        throw new Error("Applied selling price must be a non-negative number.");
    }
    const subtotal = roundMoney(appliedSellingPrice * request.quantity);
    const discountAmount = roundMoney(request.discountAmount ?? 0);
    if (discountAmount < 0 || discountAmount > subtotal) {
        throw new Error("Discount must be non-negative and no greater than the sale subtotal.");
    }
    const finalAmount = roundMoney(subtotal - discountAmount);
    const now = options.now?.() ?? new Date();
    const expiredBatch = selectedBatch
        ? isExpired(selectedBatch.expiryDate, now)
        : false;
    const makeId = options.makeId ?? (() => crypto.randomUUID());
    const saleId = makeId().trim();
    if (!saleId) {
        throw new Error("Sale ID must not be empty.");
    }

    return {
        saleId,
        request: {
            ...request,
            productId,
            variantId,
            inventoryRecordId,
            batchId: selectedInventory.batchId,
            packagingLevelId,
            appliedSellingPrice,
            discountAmount,
            customerName: normalizeOptionalText(request.customerName),
            customerAddress: normalizeOptionalText(request.customerAddress),
            saleDate: normalizeSaleDate(request.saleDate),
            notes: normalizeOptionalText(request.notes),
            staffMember: request.staffMember
                ? {
                    ...(normalizeOptionalText(request.staffMember.userId)
                        ? { userId: normalizeOptionalText(request.staffMember.userId) }
                        : {}),
                    ...(normalizeOptionalText(request.staffMember.displayName)
                        ? { displayName: normalizeOptionalText(request.staffMember.displayName) }
                        : {})
                }
                : undefined
        },
        expectedInventory: selectedInventory,
        updatedInventory: prepareInventoryAllocation(
            product,
            selectedVariant,
            selectedInventory,
            selectedPackaging.id,
            request.quantity
        ),
        product,
        productSnapshot: snapshotProduct(product),
        variant: selectedVariant,
        variantSnapshot: snapshotVariant(selectedVariant),
        batchSnapshot: selectedBatch
            ? snapshotBatch(selectedBatch, product)
            : null,
        packagingLevel: selectedPackaging,
        defaultSellingPrice,
        appliedSellingPrice,
        subtotal,
        discountAmount,
        finalAmount,
        expiredBatch
    };
}

export function prepareSaleDraft(
    sourceDraft: SaleDraft,
    context: SaleContext,
    options: Pick<SaleEngineOptions, "now"> = {}
): SaleDraftPlan {
    const draft = validateSaleDraft(sourceDraft);
    if (draft.status !== "draft") {
        throw new Error("Only an editable sale draft can be prepared.");
    }
    if (draft.items.length === 0) {
        throw new Error("An empty sale draft cannot be prepared.");
    }

    const workingRecords = [...context.inventoryRecords];
    const originalRecords = new Map<string, inventory>();
    const linePlans: SalePlan[] = [];

    for (const item of draft.items) {
        const request: SaleRequest = {
            productId: item.productId,
            variantId: item.variantId,
            inventoryRecordId: item.inventoryRecordId,
            batchId: item.batchId,
            packagingLevelId: item.packagingLevelId,
            quantity: item.quantity,
            appliedSellingPrice: item.appliedSellingPrice,
            discountAmount: item.discountAmount,
            ...(draft.customerName ? { customerName: draft.customerName } : {}),
            ...(draft.customerAddress
                ? { customerAddress: draft.customerAddress }
                : {}),
            ...(draft.saleDate ? { saleDate: draft.saleDate } : {}),
            ...(draft.staffMember ? { staffMember: draft.staffMember } : {}),
            ...(draft.notes ? { notes: draft.notes } : {})
        };
        const plan = prepareSale(
            request,
            { ...context, inventoryRecords: workingRecords },
            {
                now: options.now,
                makeId: () => `${draft.draftId}:${item.lineId}`
            }
        );
        if (plan.defaultSellingPrice !== item.defaultSellingPrice) {
            throw new Error(
                "Default selling price changed after the sale draft was updated. Refresh the draft before approval."
            );
        }
        if (!originalRecords.has(plan.expectedInventory.id)) {
            const original = context.inventoryRecords.find(
                (record) => record.id === plan.expectedInventory.id
            );
            if (!original) {
                throw new Error("Selected inventory record is no longer available.");
            }
            originalRecords.set(original.id, original);
        }
        const workingIndex = workingRecords.findIndex(
            (record) => record.id === plan.updatedInventory.id
        );
        if (workingIndex === -1) {
            throw new Error("Selected inventory record is no longer available.");
        }
        workingRecords[workingIndex] = plan.updatedInventory;
        linePlans.push({ ...plan, lineId: item.lineId });
    }

    return {
        draftId: draft.draftId,
        draft,
        ...(draft.customerName ? { customerName: draft.customerName } : {}),
        ...(draft.customerAddress ? { customerAddress: draft.customerAddress } : {}),
        ...(draft.saleDate ? { saleDate: draft.saleDate } : {}),
        ...(draft.staffMember ? { staffMember: draft.staffMember } : {}),
        ...(draft.notes ? { notes: draft.notes } : {}),
        linePlans,
        expectedInventory: [...originalRecords.values()],
        updatedInventory: [...originalRecords.keys()].map((recordId) => {
            const updated = workingRecords.find((record) => record.id === recordId);
            if (!updated) {
                throw new Error(`Updated inventory record not found: ${recordId}`);
            }
            return updated;
        })
    };
}

type SalePlanInput = SalePlan | SaleDraftPlan;

export function completeSale(
    plan: SalePlanInput,
    options: {
        continueWithExpiredBatch?: boolean;
        now?: () => Date;
        makeId?: () => string;
        makeEventId?: () => string;
    } = {}
): SaleCompletion {
    const completedAt = options.now?.() ?? new Date();
    isValidDate(completedAt, "Sale completion date");
    const linePlans = "linePlans" in plan ? plan.linePlans : [plan];
    if (linePlans.length === 0) {
        throw new Error("A sale must contain at least one item.");
    }
    const completedItems = linePlans.map((linePlan) => {
        const expiredAtCompletion = linePlan.batchSnapshot?.expiryDate
            ? isExpired(
                new Date(linePlan.batchSnapshot.expiryDate),
                completedAt
            )
            : false;
        const expiredBatch = linePlan.expiredBatch || expiredAtCompletion;
        if (expiredBatch && options.continueWithExpiredBatch !== true) {
            throw new Error("Explicit confirmation is required to sell an expired batch.");
        }
        return {
            lineId: linePlan.lineId ?? linePlan.saleId,
            product: linePlan.productSnapshot,
            variant: linePlan.variantSnapshot,
            batch: linePlan.batchSnapshot,
            inventoryRecordId: linePlan.request.inventoryRecordId,
            packagingLevel: snapshotPackagingLevel(
                linePlan.packagingLevel,
                linePlan.variant.packagingHierarchy
            ),
            quantity: linePlan.request.quantity,
            defaultSellingPrice: linePlan.defaultSellingPrice,
            appliedSellingPrice: linePlan.appliedSellingPrice,
            subtotal: linePlan.subtotal,
            discountAmount: linePlan.discountAmount,
            finalAmount: linePlan.finalAmount,
            expiredBatch
        };
    });
    const subtotal = roundMoney(
        completedItems.reduce((sum, item) => sum + item.subtotal, 0)
    );
    const discountAmount = roundMoney(
        completedItems.reduce((sum, item) => sum + item.discountAmount, 0)
    );
    const finalAmount = roundMoney(
        completedItems.reduce((sum, item) => sum + item.finalAmount, 0)
    );
    const makeId = options.makeId ?? (() => crypto.randomUUID());
    const saleId = ("linePlans" in plan ? makeId() : plan.saleId).trim();
    if (!saleId) {
        throw new Error("Sale ID must not be empty.");
    }
    const firstPlan = linePlans[0];
    const customerName = "linePlans" in plan
        ? plan.customerName
        : firstPlan.request.customerName;
    const customerAddress = "linePlans" in plan
        ? plan.customerAddress
        : firstPlan.request.customerAddress;
    const saleDate = "linePlans" in plan
        ? plan.saleDate
        : firstPlan.request.saleDate;
    const staffMember = "linePlans" in plan
        ? plan.staffMember
        : firstPlan.request.staffMember;
    const notes = "linePlans" in plan ? plan.notes : firstPlan.request.notes;
    const sale: CompletedSale = {
        saleId,
        completedAt: completedAt.toISOString(),
        ...(customerName ? { customerName } : {}),
        ...(customerAddress ? { customerAddress } : {}),
        ...(saleDate ? { saleDate } : {}),
        ...(staffMember ? { staffMember } : {}),
        ...(notes ? { notes } : {}),
        items: completedItems,
        subtotal,
        discountAmount,
        finalAmount,
        expiredBatchConfirmed: completedItems.some((item) => item.expiredBatch)
    };
    const events = prepareActivityEvents([{
        type: "sale.completed",
        operationKey: `sale.completed:${saleId}`,
        ...(staffMember?.userId ? { actorId: staffMember.userId } : {}),
        saleId,
        ...(sale.customerName ? { customerName: sale.customerName } : {}),
        ...(sale.customerAddress ? { customerAddress: sale.customerAddress } : {}),
        ...(sale.saleDate ? { saleDate: sale.saleDate } : {}),
        ...(sale.staffMember ? { staffMember: sale.staffMember } : {}),
        ...(sale.notes ? { notes: sale.notes } : {}),
        subtotal,
        discountAmount,
        finalAmount,
        expiredBatchConfirmed: sale.expiredBatchConfirmed,
        items: linePlans.map((linePlan, index) => {
            const item = completedItems[index];
            return {
                productId: linePlan.product.id,
                productName: linePlan.product.name,
                variantId: linePlan.variant.id,
                variantName: linePlan.variant.variantName,
                product: item.product,
                variant: item.variant,
                packagingLevel: item.packagingLevel,
                quantity: item.quantity,
                defaultSellingPrice: item.defaultSellingPrice,
                appliedSellingPrice: item.appliedSellingPrice,
                subtotal: item.subtotal,
                discountAmount: item.discountAmount,
                finalAmount: item.finalAmount,
                allocations: [{
                    inventoryId: item.inventoryRecordId,
                    batch: item.batch,
                    quantity: item.quantity
                }]
            };
        })
    }], {
        makeId: options.makeEventId,
        now: () => completedAt
    });
    const expectedInventory = "linePlans" in plan
        ? plan.expectedInventory
        : [plan.expectedInventory];
    const updatedInventory = "linePlans" in plan
        ? plan.updatedInventory
        : [plan.updatedInventory];

    return {
        sale,
        expectedInventory,
        updatedInventory,
        events,
        ...("linePlans" in plan
            ? { draftId: plan.draftId, expectedDraft: plan.draft }
            : {})
    };
}
