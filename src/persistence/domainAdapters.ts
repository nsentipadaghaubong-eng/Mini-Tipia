import {
    validateDeliveryDraft,
    type DeliveryDraft
} from "../deliveries/deliveryDraft";
import {
    validateSaleDraft,
    type SaleDraft
} from "../sales/salesDraft";
import type {
    PersistedDeliveryDraft
} from "./repositories/receiveDeliveryDraftRepository";
import type {
    PersistedSaleDraft
} from "./repositories/salesDraftRepository";

export interface PersistedDomainProjection<TDomain, TPersisted> {
    readonly domain: TDomain;
    readonly persistence: TPersisted;
    readonly persistenceOnlyFields: readonly string[];
}

export interface IncompatibleDeliveryDraftProjection {
    readonly domain: null;
    readonly persistence: PersistedDeliveryDraft;
    readonly incompatibleFields: readonly ("deliveryDate" | "receivedBy")[];
    readonly persistenceOnlyFields: readonly string[];
}

export type DeliveryDraftDomainProjection =
    | PersistedDomainProjection<DeliveryDraft, PersistedDeliveryDraft>
    | IncompatibleDeliveryDraftProjection;

const SALE_DRAFT_PERSISTENCE_ONLY_FIELDS = [
    "draftPosition",
    "itemPositions",
    "approvedSaleId",
    "SQL NULL versus optional-field absence"
] as const;

const DELIVERY_DRAFT_PERSISTENCE_ONLY_FIELDS = [
    "deliveryPosition",
    "itemPositions",
    "receivedEventId",
    "receivedBatchId",
    "receiptSnapshotJson",
    "SQL NULL versus optional-field absence"
] as const;

function assertSafeInteger(
    value: number,
    field: string,
    minimum: number
): void {
    if (!Number.isSafeInteger(value) || value < minimum) {
        throw new Error(`Persisted ${field} must be a safe integer.`);
    }
}

function assertPersistedId(value: string, field: string): void {
    if (value.trim() === "") {
        throw new Error(`Persisted ${field} must not be empty.`);
    }
}

function majorAmountFromMinorUnits(
    minorUnits: number | null,
    field: string
): number | null {
    if (minorUnits === null) {
        return null;
    }
    if (!Number.isSafeInteger(minorUnits) || minorUnits < 0) {
        throw new Error(
            `Persisted ${field} must be a non-negative safe integer.`
        );
    }

    const amount = minorUnits / 100;
    if (
        !Number.isFinite(amount) ||
        Math.round(amount * 100) !== minorUnits
    ) {
        throw new Error(
            `Persisted ${field} cannot be represented losslessly in the domain money type.`
        );
    }
    return amount;
}

function requiredMajorAmountFromMinorUnits(
    minorUnits: number,
    field: string
): number {
    const amount = majorAmountFromMinorUnits(minorUnits, field);
    if (amount === null) {
        throw new Error(`Persisted ${field} must not be NULL.`);
    }
    return amount;
}

function orderedUniqueItems<
    TItem extends { readonly itemPosition: number; readonly deliveryItemId?: string; readonly lineId?: string }
>(
    items: readonly TItem[],
    label: string
): TItem[] {
    const positions = new Set<number>();
    const ids = new Set<string>();
    for (const item of items) {
        assertSafeInteger(item.itemPosition, `${label} item position`, 0);
        const id = item.deliveryItemId ?? item.lineId;
        if (id === undefined || id.trim() === "") {
            throw new Error(`Persisted ${label} item ID must not be empty.`);
        }
        if (positions.has(item.itemPosition) || ids.has(id)) {
            throw new Error(`Persisted ${label} contains duplicate item IDs or positions.`);
        }
        positions.add(item.itemPosition);
        ids.add(id);
    }
    return [...items].sort((left, right) =>
        left.itemPosition - right.itemPosition
    );
}

function orderedUniqueDrafts<TDraft extends {
    readonly draftPosition?: number;
    readonly deliveryPosition?: number;
    readonly draftId?: string;
    readonly deliveryId?: string;
}>(
    drafts: readonly TDraft[],
    label: string
): TDraft[] {
    const positions = new Set<number>();
    const ids = new Set<string>();
    for (const draft of drafts) {
        const position = draft.draftPosition ?? draft.deliveryPosition;
        const id = draft.draftId ?? draft.deliveryId;
        if (position === undefined || id === undefined) {
            throw new Error(`Persisted ${label} is missing its ID or position.`);
        }
        assertSafeInteger(position, `${label} position`, Number.MIN_SAFE_INTEGER);
        assertPersistedId(id, `${label} ID`);
        if (positions.has(position) || ids.has(id)) {
            throw new Error(`Persisted ${label} contains duplicate IDs or positions.`);
        }
        positions.add(position);
        ids.add(id);
    }
    return [...drafts].sort((left, right) => {
        const leftPosition = left.draftPosition ?? left.deliveryPosition ?? 0;
        const rightPosition = right.draftPosition ?? right.deliveryPosition ?? 0;
        return leftPosition - rightPosition;
    });
}

export function adaptPersistedSaleDraft(
    persisted: PersistedSaleDraft
): PersistedDomainProjection<SaleDraft, PersistedSaleDraft> {
    assertPersistedId(persisted.draftId, "Sale draft ID");
    if (persisted.status !== "draft") {
        throw new Error("Only active persisted Sale drafts can be adapted.");
    }
    assertSafeInteger(
        persisted.draftPosition,
        "Sale draft position",
        Number.MIN_SAFE_INTEGER
    );
    if (persisted.approvedSaleId !== null) {
        throw new Error(
            "An active persisted Sale draft cannot reference an approved Sale."
        );
    }

    const items = orderedUniqueItems(persisted.items, "Sale draft");
    const staffMember = {
        ...(persisted.staffUserId === null
            ? {}
            : { userId: persisted.staffUserId }),
        ...(persisted.staffDisplayName === null
            ? {}
            : { displayName: persisted.staffDisplayName })
    };

    const candidate: SaleDraft = {
        draftId: persisted.draftId,
        status: "draft",
        createdAt: persisted.createdAt,
        updatedAt: persisted.updatedAt,
        ...(persisted.customerName === null
            ? {}
            : { customerName: persisted.customerName }),
        ...(persisted.customerAddress === null
            ? {}
            : { customerAddress: persisted.customerAddress }),
        ...(persisted.saleDate === null ? {} : { saleDate: persisted.saleDate }),
        ...(staffMember.userId === undefined &&
            staffMember.displayName === undefined
            ? {}
            : { staffMember }),
        ...(persisted.notes === null ? {} : { notes: persisted.notes }),
        items: items.map((item) => ({
            lineId: item.lineId,
            productId: item.productId,
            variantId: item.variantId,
            inventoryRecordId: item.inventoryRecordId,
            batchId: item.batchId,
            packagingLevelId: item.packagingLevelId,
            quantity: item.quantity,
            defaultSellingPrice: majorAmountFromMinorUnits(
                item.defaultSellingPriceMinorUnits,
                "Sale draft default selling price"
            ),
            appliedSellingPrice: requiredMajorAmountFromMinorUnits(
                item.appliedSellingPriceMinorUnits,
                "Sale draft applied selling price"
            ),
            discountAmount: requiredMajorAmountFromMinorUnits(
                item.discountMinorUnits,
                "Sale draft discount"
            )
        }))
    };

    return {
        domain: validateSaleDraft(candidate),
        persistence: persisted,
        persistenceOnlyFields: SALE_DRAFT_PERSISTENCE_ONLY_FIELDS
    };
}

export function adaptPersistedSaleDrafts(
    drafts: readonly PersistedSaleDraft[]
): PersistedDomainProjection<SaleDraft, PersistedSaleDraft>[] {
    return orderedUniqueDrafts(drafts, "Sale draft").map(
        adaptPersistedSaleDraft
    );
}

export function adaptPersistedDeliveryDraft(
    persisted: PersistedDeliveryDraft
): DeliveryDraftDomainProjection {
    const deliveryDate = persisted.deliveryDate;
    const receivedBy = persisted.receivedBy;
    assertPersistedId(persisted.deliveryId, "Delivery draft ID");
    if (persisted.status !== "draft") {
        throw new Error(
            "Only active persisted Delivery drafts can be adapted."
        );
    }
    assertSafeInteger(
        persisted.deliveryPosition,
        "Delivery draft position",
        Number.MIN_SAFE_INTEGER
    );

    const items = orderedUniqueItems(persisted.items, "Delivery draft");
    const domainItems = items.map((item) => {
        assertPersistedId(item.productId, "Delivery Product ID");
        assertPersistedId(item.variantId, "Delivery Variant ID");
        assertPersistedId(item.packagingLevelId, "Delivery packaging level ID");
        assertSafeInteger(item.quantity, "Delivery quantity", 1);
        return {
            deliveryItemId: item.deliveryItemId,
            productId: item.productId,
            variantId: item.variantId,
            packagingLevelId: item.packagingLevelId,
            quantity: item.quantity,
            batchNumber: item.batchNumber,
            expiryDate: item.expiryDate,
            costPrice: majorAmountFromMinorUnits(
                item.costPriceMinorUnits,
                "Delivery draft cost price"
            ),
            sellingPrice: majorAmountFromMinorUnits(
                item.sellingPriceMinorUnits,
                "Delivery draft selling price"
            )
        };
    });

    const incompatibleFields: ("deliveryDate" | "receivedBy")[] = [];
    if (deliveryDate === null) {
        incompatibleFields.push("deliveryDate");
    }
    if (receivedBy === null) {
        incompatibleFields.push("receivedBy");
    }
    if (deliveryDate === null || receivedBy === null) {
        return {
            domain: null,
            persistence: persisted,
            incompatibleFields,
            persistenceOnlyFields: DELIVERY_DRAFT_PERSISTENCE_ONLY_FIELDS
        };
    }

    const candidate: DeliveryDraft = {
        deliveryId: persisted.deliveryId,
        status: "draft",
        createdAt: persisted.createdAt,
        updatedAt: persisted.updatedAt,
        deliveryDate,
        receivedBy,
        ...(persisted.supplierName === null
            ? {}
            : { supplier: persisted.supplierName }),
        ...(persisted.invoiceNumber === null
            ? {}
            : { invoiceNumber: persisted.invoiceNumber }),
        items: domainItems
    };

    return {
        domain: validateDeliveryDraft(candidate),
        persistence: persisted,
        persistenceOnlyFields: DELIVERY_DRAFT_PERSISTENCE_ONLY_FIELDS
    };
}

export function adaptPersistedDeliveryDrafts(
    drafts: readonly PersistedDeliveryDraft[]
): DeliveryDraftDomainProjection[] {
    return orderedUniqueDrafts(drafts, "Delivery draft").map(
        adaptPersistedDeliveryDraft
    );
}
