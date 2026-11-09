export type SaleDraftStatus = "draft" | "cancelled" | "approved";

export interface SaleDraftStaffMember {
    userId?: string;
    displayName?: string;
}

export interface SaleDraftItem {
    lineId: string;
    productId: string;
    variantId: string;
    inventoryRecordId: string;
    batchId: string | null;
    packagingLevelId: string;
    quantity: number;
    defaultSellingPrice: number;
    appliedSellingPrice: number;
    discountAmount: number;
}

export interface SaleDraft {
    draftId: string;
    status: SaleDraftStatus;
    createdAt: string;
    updatedAt: string;
    customerName?: string;
    customerAddress?: string;
    saleDate?: string;
    staffMember?: SaleDraftStaffMember;
    notes?: string;
    items: SaleDraftItem[];
}

export interface SaleDraftOptions {
    makeId?: () => string;
    now?: () => Date;
}

export interface SaleDraftItemChanges {
    productId?: string;
    variantId?: string;
    inventoryRecordId?: string;
    batchId?: string | null;
    packagingLevelId?: string;
    quantity?: number;
    defaultSellingPrice?: number;
    appliedSellingPrice?: number;
    discountAmount?: number;
}

export interface SaleDraftDetailsChanges {
    customerName?: string | null;
    customerAddress?: string | null;
    saleDate?: string | null;
    staffMember?: SaleDraftStaffMember | null;
    notes?: string | null;
}

function normalizedId(value: unknown, label: string): string {
    if (typeof value !== "string") {
        throw new Error(`${label} must be a string.`);
    }
    const result = value.trim();
    if (result === "") {
        throw new Error(`${label} must not be empty.`);
    }
    return result;
}

function validTimestamp(value: unknown, label: string): string {
    if (typeof value !== "string") {
        throw new Error(`${label} must be a valid timestamp.`);
    }
    if (value.trim() === "" || !Number.isFinite(Date.parse(value))) {
        throw new Error(`${label} must be a valid timestamp.`);
    }
    return value;
}

function timestampFrom(options: SaleDraftOptions): string {
    const now = options.now?.() ?? new Date();
    if (!Number.isFinite(now.getTime())) {
        throw new Error("Sale draft timestamp must be a valid date.");
    }
    return now.toISOString();
}

function roundMoney(value: number, label: string): number {
    if (!Number.isFinite(value) || value < 0) {
        throw new Error(`${label} must be a non-negative number.`);
    }
    const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
    if (!Number.isFinite(rounded)) {
        throw new Error(`${label} must be a finite amount.`);
    }
    return rounded;
}

function requireString(value: unknown, label: string): string {
    if (typeof value !== "string") {
        throw new Error(`${label} must be a string.`);
    }

    return value;
}

function requireNumber(value: unknown, label: string): number {
    if (typeof value !== "number") {
        throw new Error(`${label} must be a number.`);
    }

    return value;
}

function validateItem(item: unknown): SaleDraftItem {
    if (
        item === null ||
        typeof item !== "object" ||
        Array.isArray(item)
    ) {
        throw new Error("Sale draft item must be an object.");
    }

    const source = item as Record<string, unknown>;

    const normalized: SaleDraftItem = {
        lineId: normalizedId(
            requireString(source.lineId, "Sale draft line ID"),
            "Sale draft line ID"
        ),
        productId: normalizedId(
            requireString(source.productId, "Product ID"),
            "Product ID"
        ),
        variantId: normalizedId(
            requireString(source.variantId, "Variant ID"),
            "Variant ID"
        ),
        inventoryRecordId: normalizedId(
            requireString(source.inventoryRecordId, "Inventory record ID"),
            "Inventory record ID"
        ),
        batchId: source.batchId === null
            ? null
            : normalizedId(
                requireString(source.batchId, "Batch ID"),
                "Batch ID"
            ),
        packagingLevelId: normalizedId(
            requireString(source.packagingLevelId, "Packaging level ID"),
            "Packaging level ID"
        ),
        quantity: requireNumber(source.quantity, "Sale draft quantity"),
        defaultSellingPrice: requireNumber(
            source.defaultSellingPrice,
            "Default selling price"
        ),
        appliedSellingPrice: requireNumber(
            source.appliedSellingPrice,
            "Applied selling price"
        ),
        discountAmount: requireNumber(
            source.discountAmount,
            "Discount amount"
        )
    };

    if (!Number.isSafeInteger(normalized.quantity) || normalized.quantity <= 0) {
        throw new Error("Sale draft quantity must be a positive safe integer.");
    }

    normalized.defaultSellingPrice = roundMoney(
        normalized.defaultSellingPrice,
        "Default selling price"
    );
    normalized.appliedSellingPrice = roundMoney(
        normalized.appliedSellingPrice,
        "Applied selling price"
    );
    normalized.discountAmount = roundMoney(
        normalized.discountAmount,
        "Discount amount"
    );

    const subtotal = roundMoney(
        normalized.appliedSellingPrice * normalized.quantity,
        "Sale draft subtotal"
    );
    if (normalized.discountAmount > subtotal) {
        throw new Error("Discount amount cannot exceed the sale draft subtotal.");
    }

    return normalized;
}

function assertEditable(draft: SaleDraft): void {
    if (draft.status !== "draft") {
        throw new Error(`Cannot edit a ${draft.status} sale draft.`);
    }
}

function updatedDraft(
    draft: SaleDraft,
    updatedAt: string,
    changes: Partial<SaleDraft>
): SaleDraft {
    assertEditable(draft);
    const normalizedUpdatedAt = validTimestamp(
        updatedAt,
        "Sale draft update timestamp"
    );
    if (Date.parse(normalizedUpdatedAt) < Date.parse(draft.updatedAt)) {
        throw new Error("Sale draft update timestamp cannot precede its current timestamp.");
    }
    return {
        ...draft,
        ...changes,
        updatedAt: normalizedUpdatedAt
    };
}

export function validateSaleDraft(draft: SaleDraft): SaleDraft {
    if (
        draft === null ||
        typeof draft !== "object" ||
        Array.isArray(draft)
    ) {
        throw new Error("Sale draft must be an object.");
    }

    const source = draft as SaleDraft;
    if (!Array.isArray(source.items)) {
        throw new Error("Sale draft items must be an array.");
    }

    const draftId = normalizedId(source.draftId, "Sale draft ID");
    if (
        source.status !== "draft" &&
        source.status !== "cancelled" &&
        source.status !== "approved"
    ) {
        throw new Error("Sale draft status is invalid.");
    }
    const createdAt = validTimestamp(
        source.createdAt,
        "Sale draft creation timestamp"
    );
    const updatedAt = validTimestamp(
        source.updatedAt,
        "Sale draft update timestamp"
    );
    if (Date.parse(updatedAt) < Date.parse(createdAt)) {
        throw new Error("Sale draft update timestamp cannot precede its creation timestamp.");
    }

    const lineIds = new Set<string>();
    const items = source.items.map((item) => {
        const normalizedItem = validateItem(item);
        if (lineIds.has(normalizedItem.lineId)) {
            throw new Error(`Duplicate sale draft line ID: ${normalizedItem.lineId}`);
        }
        lineIds.add(normalizedItem.lineId);
        return normalizedItem;
    });

    const customerName = normalizeOptionalText(source.customerName);
    const customerAddress = normalizeOptionalText(source.customerAddress);
    const saleDate = normalizeSaleDate(source.saleDate);
    const notes = normalizeOptionalText(source.notes);
    const staffMember = normalizeStaffMember(source.staffMember);

    return {
        draftId,
        status: source.status,
        createdAt,
        updatedAt,
        ...(customerName ? { customerName } : {}),
        ...(customerAddress ? { customerAddress } : {}),
        ...(saleDate ? { saleDate } : {}),
        ...(staffMember ? { staffMember } : {}),
        ...(notes ? { notes } : {}),
        items
    };
}

export function createSaleDraft(
    options: SaleDraftOptions = {}
): SaleDraft {
    const makeId = options.makeId ?? (() => crypto.randomUUID());
    const draftId = normalizedId(makeId(), "Sale draft ID");
    const createdAt = timestampFrom(options);
    return {
        draftId,
        status: "draft",
        createdAt,
        updatedAt: createdAt,
        items: []
    };
}

export function addSaleDraftItem(
    draft: SaleDraft,
    item: SaleDraftItem,
    updatedAt: string
): SaleDraft {
    assertEditable(draft);
    const normalizedItem = validateItem(item);
    if (draft.items.some((existing) => existing.lineId === normalizedItem.lineId)) {
        throw new Error(`Duplicate sale draft line ID: ${normalizedItem.lineId}`);
    }
    return updatedDraft(draft, updatedAt, {
        items: [...draft.items, normalizedItem]
    });
}

export function updateSaleDraftItem(
    draft: SaleDraft,
    lineId: string,
    changes: SaleDraftItemChanges,
    updatedAt: string
): SaleDraft {
    assertEditable(draft);
    const normalizedLineId = normalizedId(lineId, "Sale draft line ID");
    const itemIndex = draft.items.findIndex(
        (item) => item.lineId === normalizedLineId
    );
    if (itemIndex === -1) {
        throw new Error(`Sale draft line not found: ${normalizedLineId}`);
    }

    const items = [...draft.items];
    items[itemIndex] = validateItem({
        ...items[itemIndex],
        ...changes,
        lineId: normalizedLineId
    });
    return updatedDraft(draft, updatedAt, { items });
}

export function removeSaleDraftItem(
    draft: SaleDraft,
    lineId: string,
    updatedAt: string
): SaleDraft {
    assertEditable(draft);
    const normalizedLineId = normalizedId(lineId, "Sale draft line ID");
    if (!draft.items.some((item) => item.lineId === normalizedLineId)) {
        throw new Error(`Sale draft line not found: ${normalizedLineId}`);
    }
    return updatedDraft(draft, updatedAt, {
        items: draft.items.filter((item) => item.lineId !== normalizedLineId)
    });
}

function normalizeOptionalText(value: unknown): string | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }

    if (typeof value !== "string") {
        throw new Error("Optional sale draft details must be strings.");
    }

    const normalized = value.trim();
    return normalized === "" ? undefined : normalized;
}

export function normalizeSaleDate(value: unknown): string | undefined {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error("Sale date must be a valid date in YYYY-MM-DD format.");
    }
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (
        Number.isNaN(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== value
    ) {
        throw new Error("Sale date must be a valid date in YYYY-MM-DD format.");
    }
    return value;
}

function normalizeStaffMember(
    member: unknown
): SaleDraftStaffMember | undefined {
    if (member === null || member === undefined) {
        return undefined;
    }

    if (
        typeof member !== "object" ||
        Array.isArray(member)
    ) {
        throw new Error("Sale draft staff member must be an object.");
    }

    const staff = member as Record<string, unknown>;
    const userId = normalizeOptionalText(staff.userId);
    const displayName = normalizeOptionalText(staff.displayName);
    if (!userId && !displayName) {
        return undefined;
    }
    return {
        ...(userId ? { userId } : {}),
        ...(displayName ? { displayName } : {})
    };
}

export function updateSaleDraftDetails(
    draft: SaleDraft,
    changes: SaleDraftDetailsChanges,
    updatedAt: string
): SaleDraft {
    assertEditable(draft);
    const nextDraft = updatedDraft(draft, updatedAt, {});
    if ("customerName" in changes) {
        const customerName = normalizeOptionalText(changes.customerName);
        if (customerName === undefined) {
            delete nextDraft.customerName;
        } else {
            nextDraft.customerName = customerName;
        }
    }
    if ("customerAddress" in changes) {
        const customerAddress = normalizeOptionalText(changes.customerAddress);
        if (customerAddress === undefined) {
            delete nextDraft.customerAddress;
        } else {
            nextDraft.customerAddress = customerAddress;
        }
    }
    if ("saleDate" in changes) {
        const saleDate = normalizeSaleDate(changes.saleDate);
        if (saleDate === undefined) {
            delete nextDraft.saleDate;
        } else {
            nextDraft.saleDate = saleDate;
        }
    }
    if ("staffMember" in changes) {
        const staffMember = normalizeStaffMember(changes.staffMember);
        if (staffMember === undefined) {
            delete nextDraft.staffMember;
        } else {
            nextDraft.staffMember = staffMember;
        }
    }
    if ("notes" in changes) {
        const notes = normalizeOptionalText(changes.notes);
        if (notes === undefined) {
            delete nextDraft.notes;
        } else {
            nextDraft.notes = notes;
        }
    }

    return validateSaleDraft(nextDraft);
}

export function cancelSaleDraft(
    draft: SaleDraft,
    updatedAt: string
): SaleDraft {
    assertEditable(draft);
    return {
        ...updatedDraft(draft, updatedAt, {}),
        status: "cancelled"
    };
}
