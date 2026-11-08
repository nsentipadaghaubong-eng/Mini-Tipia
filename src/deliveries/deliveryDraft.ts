export type DeliveryDraftStatus = "draft" | "cancelled" | "received";

export interface DeliveryDraftItem {
    deliveryItemId: string;
    productId: string;
    variantId: string;
    packagingLevelId: string;
    quantity: number;
    batchNumber: string | null;
    expiryDate: string | null;
}

export interface DeliveryDraft {
    deliveryId: string;
    status: DeliveryDraftStatus;
    createdAt: string;
    updatedAt: string;
    deliveryDate: string;
    receivedBy: string;
    supplier?: string;
    invoiceNumber?: string;
    items: DeliveryDraftItem[];
}

export interface CreateDeliveryDraftInput {
    deliveryDate?: string;
    receivedBy?: string | null;
    supplier?: string | null;
    invoiceNumber?: string | null;
}

export interface DeliveryDraftOptions {
    makeId?: () => string;
    now?: () => Date;
}

export interface DeliveryDraftDetailsChanges {
    deliveryDate?: string;
    receivedBy?: string;
    supplier?: string | null;
    invoiceNumber?: string | null;
}

export interface DeliveryDraftItemChanges {
    productId?: string;
    variantId?: string;
    packagingLevelId?: string;
    quantity?: number;
    batchNumber?: string | null;
    expiryDate?: string | null;
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

function normalizeOptionalText(value: unknown, label: string): string | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }
    if (typeof value !== "string") {
        throw new Error(`${label} must be a string.`);
    }

    const normalized = value.trim();
    return normalized === "" ? undefined : normalized;
}

function normalizeDate(value: unknown, label: string): string {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error(`${label} must be a valid date in YYYY-MM-DD format.`);
    }
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (
        Number.isNaN(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== value
    ) {
        throw new Error(`${label} must be a valid date in YYYY-MM-DD format.`);
    }
    return value;
}

function normalizeOptionalDate(value: unknown, label: string): string | null {
    if (value === undefined || value === null || value === "") {
        return null;
    }
    return normalizeDate(value, label);
}

function validTimestamp(value: unknown, label: string): string {
    if (
        typeof value !== "string" ||
        value.trim() === "" ||
        !Number.isFinite(Date.parse(value))
    ) {
        throw new Error(`${label} must be a valid timestamp.`);
    }
    return value;
}

function timestampFrom(options: DeliveryDraftOptions): string {
    const now = options.now?.() ?? new Date();
    if (!Number.isFinite(now.getTime())) {
        throw new Error("Delivery draft timestamp must be a valid date.");
    }
    return now.toISOString();
}

function dateFromTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function validateItem(item: unknown): DeliveryDraftItem {
    if (
        item === null ||
        typeof item !== "object" ||
        Array.isArray(item)
    ) {
        throw new Error("Delivery draft item must be an object.");
    }
    const source = item as Record<string, unknown>;
    const quantity = source.quantity;
    if (typeof quantity !== "number") {
        throw new Error("Delivery quantity must be a number.");
    }
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
        throw new Error("Delivery quantity must be a positive safe integer.");
    }

    const batchNumber = normalizeOptionalText(
        source.batchNumber,
        "Batch number"
    ) ?? null;

    return {
        deliveryItemId: normalizedId(
            source.deliveryItemId,
            "Delivery item ID"
        ),
        productId: normalizedId(source.productId, "Product ID"),
        variantId: normalizedId(source.variantId, "Variant ID"),
        packagingLevelId: normalizedId(
            source.packagingLevelId,
            "Packaging level ID"
        ),
        quantity,
        batchNumber,
        expiryDate: normalizeOptionalDate(source.expiryDate, "Expiry date")
    };
}

function assertEditable(draft: DeliveryDraft): void {
    if (draft.status !== "draft") {
        throw new Error(`Cannot edit a ${draft.status} delivery draft.`);
    }
}

function normalizeDraftDetails(
    deliveryDate: unknown,
    receivedBy: unknown
): Pick<DeliveryDraft, "deliveryDate" | "receivedBy"> {
    if (typeof deliveryDate !== "string") {
        throw new Error("Delivery date must be a string.");
    }
    if (receivedBy !== undefined && receivedBy !== null &&
        typeof receivedBy !== "string") {
        throw new Error("Received by must be a string.");
    }

    return {
        deliveryDate: deliveryDate.trim(),
        receivedBy: typeof receivedBy === "string" ? receivedBy.trim() : ""
    };
}

export function validateDeliveryApprovalDetails(
    deliveryDate: unknown,
    receivedBy: unknown
): Pick<DeliveryDraft, "deliveryDate" | "receivedBy"> {
    const normalizedReceivedBy = normalizeOptionalText(receivedBy, "Received by");
    if (!normalizedReceivedBy) {
        throw new Error("Received by is required.");
    }
    return {
        deliveryDate: normalizeDate(deliveryDate, "Delivery date"),
        receivedBy: normalizedReceivedBy
    };
}

export function validateDeliveryDraft(draft: DeliveryDraft): DeliveryDraft {
    if (
        draft === null ||
        typeof draft !== "object" ||
        Array.isArray(draft)
    ) {
        throw new Error("Delivery draft must be an object.");
    }
    if (!Array.isArray(draft.items)) {
        throw new Error("Delivery draft items must be an array.");
    }
    if (
        draft.status !== "draft" &&
        draft.status !== "cancelled" &&
        draft.status !== "received"
    ) {
        throw new Error("Delivery draft status is invalid.");
    }

    const deliveryId = normalizedId(draft.deliveryId, "Delivery ID");
    const createdAt = validTimestamp(
        draft.createdAt,
        "Delivery draft creation timestamp"
    );
    const updatedAt = validTimestamp(
        draft.updatedAt,
        "Delivery draft update timestamp"
    );
    if (Date.parse(updatedAt) < Date.parse(createdAt)) {
        throw new Error(
            "Delivery draft update timestamp cannot precede its creation timestamp."
        );
    }

    const details = normalizeDraftDetails(draft.deliveryDate, draft.receivedBy);
    const itemIds = new Set<string>();
    const items = draft.items.map((item) => {
        const normalizedItem = validateItem(item);
        if (itemIds.has(normalizedItem.deliveryItemId)) {
            throw new Error(
                `Duplicate delivery item ID: ${normalizedItem.deliveryItemId}`
            );
        }
        itemIds.add(normalizedItem.deliveryItemId);
        return normalizedItem;
    });

    const supplier = normalizeOptionalText(draft.supplier, "Supplier");
    const invoiceNumber = normalizeOptionalText(
        draft.invoiceNumber,
        "Invoice number"
    );

    return {
        deliveryId,
        status: draft.status,
        createdAt,
        updatedAt,
        ...details,
        ...(supplier ? { supplier } : {}),
        ...(invoiceNumber ? { invoiceNumber } : {}),
        items
    };
}

export function createDeliveryDraft(
    input: CreateDeliveryDraftInput,
    options: DeliveryDraftOptions = {}
): DeliveryDraft {
    const createdAt = timestampFrom(options);
    const details = normalizeDraftDetails(
        input.deliveryDate === undefined
            ? dateFromTimestamp(createdAt)
            : input.deliveryDate,
        input.receivedBy
    );
    const supplier = normalizeOptionalText(input.supplier, "Supplier");
    const invoiceNumber = normalizeOptionalText(
        input.invoiceNumber,
        "Invoice number"
    );
    return validateDeliveryDraft({
        deliveryId: normalizedId(
            (options.makeId ?? (() => crypto.randomUUID()))(),
            "Delivery ID"
        ),
        status: "draft",
        createdAt,
        updatedAt: createdAt,
        ...details,
        ...(supplier ? { supplier } : {}),
        ...(invoiceNumber ? { invoiceNumber } : {}),
        items: []
    });
}

function updatedDraft(
    draft: DeliveryDraft,
    updatedAt: string,
    changes: Partial<DeliveryDraft>
): DeliveryDraft {
    assertEditable(draft);
    const normalizedUpdatedAt = validTimestamp(
        updatedAt,
        "Delivery draft update timestamp"
    );
    if (Date.parse(normalizedUpdatedAt) < Date.parse(draft.updatedAt)) {
        throw new Error(
            "Delivery draft update timestamp cannot precede its current timestamp."
        );
    }
    return {
        ...draft,
        ...changes,
        updatedAt: normalizedUpdatedAt
    };
}

export function updateDeliveryDraftDetails(
    draft: DeliveryDraft,
    changes: DeliveryDraftDetailsChanges,
    updatedAt: string
): DeliveryDraft {
    const nextDraft = updatedDraft(draft, updatedAt, {});
    if ("deliveryDate" in changes || "receivedBy" in changes) {
        const details = normalizeDraftDetails(
            "deliveryDate" in changes
                ? changes.deliveryDate
                : nextDraft.deliveryDate,
            "receivedBy" in changes
                ? changes.receivedBy
                : nextDraft.receivedBy
        );
        nextDraft.deliveryDate = details.deliveryDate;
        nextDraft.receivedBy = details.receivedBy;
    }
    if ("supplier" in changes) {
        const supplier = normalizeOptionalText(changes.supplier, "Supplier");
        if (supplier === undefined) {
            delete nextDraft.supplier;
        } else {
            nextDraft.supplier = supplier;
        }
    }
    if ("invoiceNumber" in changes) {
        const invoiceNumber = normalizeOptionalText(
            changes.invoiceNumber,
            "Invoice number"
        );
        if (invoiceNumber === undefined) {
            delete nextDraft.invoiceNumber;
        } else {
            nextDraft.invoiceNumber = invoiceNumber;
        }
    }
    return validateDeliveryDraft(nextDraft);
}

export function addDeliveryDraftItem(
    draft: DeliveryDraft,
    item: DeliveryDraftItem,
    updatedAt: string
): DeliveryDraft {
    assertEditable(draft);
    const normalizedItem = validateItem(item);
    if (draft.items.some(
        (existing) =>
            existing.deliveryItemId === normalizedItem.deliveryItemId
    )) {
        throw new Error(
            `Duplicate delivery item ID: ${normalizedItem.deliveryItemId}`
        );
    }
    return validateDeliveryDraft(updatedDraft(draft, updatedAt, {
        items: [...draft.items, normalizedItem]
    }));
}

export function updateDeliveryDraftItem(
    draft: DeliveryDraft,
    deliveryItemId: string,
    changes: DeliveryDraftItemChanges,
    updatedAt: string
): DeliveryDraft {
    assertEditable(draft);
    const normalizedIdValue = normalizedId(
        deliveryItemId,
        "Delivery item ID"
    );
    const itemIndex = draft.items.findIndex(
        (item) => item.deliveryItemId === normalizedIdValue
    );
    if (itemIndex === -1) {
        throw new Error(`Delivery item not found: ${normalizedIdValue}`);
    }
    const items = [...draft.items];
    items[itemIndex] = validateItem({
        ...items[itemIndex],
        ...changes,
        deliveryItemId: normalizedIdValue
    });
    return validateDeliveryDraft(updatedDraft(draft, updatedAt, { items }));
}

export function removeDeliveryDraftItem(
    draft: DeliveryDraft,
    deliveryItemId: string,
    updatedAt: string
): DeliveryDraft {
    assertEditable(draft);
    const normalizedIdValue = normalizedId(
        deliveryItemId,
        "Delivery item ID"
    );
    if (!draft.items.some(
        (item) => item.deliveryItemId === normalizedIdValue
    )) {
        throw new Error(`Delivery item not found: ${normalizedIdValue}`);
    }
    return validateDeliveryDraft(updatedDraft(draft, updatedAt, {
        items: draft.items.filter(
            (item) => item.deliveryItemId !== normalizedIdValue
        )
    }));
}
