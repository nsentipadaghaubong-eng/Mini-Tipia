import {
    querySqlite,
    type SqliteQueryExecutor,
    type SqliteQueryResult,
    type SqliteQueryValue
} from "../query";

const ACTIVE_DELIVERY_DRAFTS_QUERY = `
    SELECT
        delivery.delivery_position AS delivery_position,
        delivery.delivery_id AS delivery_id,
        delivery.status AS status,
        delivery.created_at AS created_at,
        delivery.updated_at AS updated_at,
        delivery.delivery_date AS delivery_date,
        delivery.received_by AS received_by,
        delivery.supplier_name AS supplier_name,
        delivery.invoice_number AS invoice_number,
        delivery.received_event_id AS received_event_id,
        item.delivery_item_id AS delivery_item_id,
        item.item_position AS item_position,
        item.product_id AS product_id,
        item.variant_id AS variant_id,
        item.packaging_level_id AS packaging_level_id,
        item.quantity AS quantity,
        item.batch_number AS batch_number,
        item.expiry_date AS expiry_date,
        item.cost_price_minor_units AS cost_price_minor_units,
        item.selling_price_minor_units AS selling_price_minor_units,
        item.received_batch_id AS received_batch_id,
        item.receipt_snapshot_json AS receipt_snapshot_json
    FROM deliveries AS delivery
    LEFT JOIN delivery_items AS item
        ON item.delivery_id = delivery.delivery_id
    WHERE delivery.status = $1
    ORDER BY delivery.delivery_position ASC, item.item_position ASC
`;

export interface PersistedDeliveryDraftItem {
    readonly deliveryItemId: string;
    readonly itemPosition: number;
    readonly productId: string;
    readonly variantId: string;
    readonly packagingLevelId: string;
    readonly quantity: number;
    readonly batchNumber: string | null;
    readonly expiryDate: string | null;
    readonly costPriceMinorUnits: number | null;
    readonly sellingPriceMinorUnits: number | null;
    readonly receivedBatchId: string | null;
    readonly receiptSnapshotJson: string | null;
}

export interface PersistedDeliveryDraft {
    readonly deliveryPosition: number;
    readonly deliveryId: string;
    readonly status: "draft";
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly deliveryDate: string | null;
    readonly receivedBy: string | null;
    readonly supplierName: string | null;
    readonly invoiceNumber: string | null;
    readonly receivedEventId: string | null;
    readonly items: readonly PersistedDeliveryDraftItem[];
}

type DeliveryDraftRow = ReadonlyMap<string, SqliteQueryValue>;

interface DeliveryDraftGroup {
    readonly draft: Omit<PersistedDeliveryDraft, "items">;
    readonly itemPositions: Set<number>;
    readonly itemIds: Set<string>;
    readonly items: PersistedDeliveryDraftItem[];
}

function toDeliveryDraftRows(result: SqliteQueryResult): DeliveryDraftRow[] {
    return result.rows.map((values) => {
        if (values.length !== result.columns.length) {
            throw new Error(
                "SQLite Receive Delivery draft query returned an invalid row shape."
            );
        }

        const row = new Map<string, SqliteQueryValue>();
        result.columns.forEach((column, index) => {
            if (row.has(column)) {
                throw new Error(
                    "SQLite Receive Delivery draft query returned duplicate columns."
                );
            }
            row.set(column, values[index]);
        });
        return row;
    });
}

function requiredValue(
    row: DeliveryDraftRow,
    column: string
): SqliteQueryValue {
    const value = row.get(column);
    if (value === undefined) {
        throw new Error(
            `SQLite Receive Delivery draft query is missing the ${column} column.`
        );
    }
    return value;
}

function requiredText(row: DeliveryDraftRow, column: string): string {
    const value = requiredValue(row, column);
    if (typeof value !== "string" || value.trim() === "") {
        throw new Error(
            `SQLite Receive Delivery draft query returned an invalid ${column}.`
        );
    }
    return value;
}

function nullableText(row: DeliveryDraftRow, column: string): string | null {
    const value = requiredValue(row, column);
    if (value === null) {
        return null;
    }
    if (typeof value !== "string") {
        throw new Error(
            `SQLite Receive Delivery draft query returned an invalid ${column}.`
        );
    }
    return value;
}

function nullableIdentifier(
    row: DeliveryDraftRow,
    column: string
): string | null {
    const value = nullableText(row, column);
    if (value !== null && value.trim() === "") {
        throw new Error(
            `SQLite Receive Delivery draft query returned an invalid ${column}.`
        );
    }
    return value;
}

function requiredSafeInteger(
    row: DeliveryDraftRow,
    column: string,
    minimum: number
): number {
    const value = requiredValue(row, column);
    if (
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < minimum
    ) {
        throw new Error(
            `SQLite Receive Delivery draft query returned an invalid ${column}.`
        );
    }
    return value;
}

function nullableSafeInteger(
    row: DeliveryDraftRow,
    column: string
): number | null {
    const value = requiredValue(row, column);
    if (value === null) {
        return null;
    }
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        throw new Error(
            `SQLite Receive Delivery draft query returned an invalid ${column}.`
        );
    }
    return value;
}

function requiredTimestamp(row: DeliveryDraftRow, column: string): string {
    const value = requiredText(row, column);
    if (!Number.isFinite(Date.parse(value))) {
        throw new Error(
            `SQLite Receive Delivery draft query returned an invalid ${column}.`
        );
    }
    return value;
}

function sameDraft(
    left: Omit<PersistedDeliveryDraft, "items">,
    right: Omit<PersistedDeliveryDraft, "items">
): boolean {
    return left.deliveryPosition === right.deliveryPosition &&
        left.deliveryId === right.deliveryId &&
        left.status === right.status &&
        left.createdAt === right.createdAt &&
        left.updatedAt === right.updatedAt &&
        left.deliveryDate === right.deliveryDate &&
        left.receivedBy === right.receivedBy &&
        left.supplierName === right.supplierName &&
        left.invoiceNumber === right.invoiceNumber &&
        left.receivedEventId === right.receivedEventId;
}

function draftFromRow(
    row: DeliveryDraftRow
): Omit<PersistedDeliveryDraft, "items"> {
    const status = requiredText(row, "status");
    if (status !== "draft") {
        throw new Error(
            "SQLite Receive Delivery draft query returned a non-active draft."
        );
    }

    const createdAt = requiredTimestamp(row, "created_at");
    const updatedAt = requiredTimestamp(row, "updated_at");
    if (Date.parse(updatedAt) < Date.parse(createdAt)) {
        throw new Error(
            "SQLite Receive Delivery draft query returned an update timestamp before creation."
        );
    }

    return {
        deliveryPosition: requiredSafeInteger(
            row,
            "delivery_position",
            Number.MIN_SAFE_INTEGER
        ),
        deliveryId: requiredText(row, "delivery_id"),
        status,
        createdAt,
        updatedAt,
        deliveryDate: nullableText(row, "delivery_date"),
        receivedBy: nullableText(row, "received_by"),
        supplierName: nullableText(row, "supplier_name"),
        invoiceNumber: nullableText(row, "invoice_number"),
        receivedEventId: nullableIdentifier(row, "received_event_id")
    };
}

function itemFromRow(
    row: DeliveryDraftRow
): PersistedDeliveryDraftItem | null {
    const deliveryItemId = nullableText(row, "delivery_item_id");
    const itemPositionValue = requiredValue(row, "item_position");

    if (deliveryItemId === null && itemPositionValue === null) {
        const childColumns = [
            "product_id",
            "variant_id",
            "packaging_level_id",
            "quantity",
            "batch_number",
            "expiry_date",
            "cost_price_minor_units",
            "selling_price_minor_units",
            "received_batch_id",
            "receipt_snapshot_json"
        ];
        if (childColumns.some((column) => requiredValue(row, column) !== null)) {
            throw new Error(
                "SQLite Receive Delivery draft query returned an incomplete item row."
            );
        }
        return null;
    }
    if (deliveryItemId === null || itemPositionValue === null) {
        throw new Error(
            "SQLite Receive Delivery draft query returned an incomplete item row."
        );
    }

    return {
        deliveryItemId,
        itemPosition: requiredSafeInteger(row, "item_position", 0),
        productId: requiredText(row, "product_id"),
        variantId: requiredText(row, "variant_id"),
        packagingLevelId: requiredText(row, "packaging_level_id"),
        quantity: requiredSafeInteger(row, "quantity", 1),
        batchNumber: nullableText(row, "batch_number"),
        expiryDate: nullableText(row, "expiry_date"),
        costPriceMinorUnits: nullableSafeInteger(
            row,
            "cost_price_minor_units"
        ),
        sellingPriceMinorUnits: nullableSafeInteger(
            row,
            "selling_price_minor_units"
        ),
        receivedBatchId: nullableIdentifier(row, "received_batch_id"),
        receiptSnapshotJson: nullableText(row, "receipt_snapshot_json")
    };
}

export async function getAllActiveDeliveryDrafts(
    query: SqliteQueryExecutor = querySqlite
): Promise<PersistedDeliveryDraft[]> {
    const result = await query(ACTIVE_DELIVERY_DRAFTS_QUERY, ["draft"]);
    const drafts = new Map<string, DeliveryDraftGroup>();
    const deliveryPositions = new Set<number>();

    for (const row of toDeliveryDraftRows(result)) {
        const draft = draftFromRow(row);
        let group = drafts.get(draft.deliveryId);

        if (!group) {
            if (deliveryPositions.has(draft.deliveryPosition)) {
                throw new Error(
                    "SQLite Receive Delivery draft query returned duplicate draft positions."
                );
            }
            deliveryPositions.add(draft.deliveryPosition);
            group = {
                draft,
                itemPositions: new Set(),
                itemIds: new Set(),
                items: []
            };
            drafts.set(draft.deliveryId, group);
        } else if (!sameDraft(group.draft, draft)) {
            throw new Error(
                "SQLite Receive Delivery draft query returned conflicting draft rows."
            );
        }

        const item = itemFromRow(row);
        if (!item) {
            continue;
        }
        if (group.itemIds.has(item.deliveryItemId)) {
            throw new Error(
                "SQLite Receive Delivery draft query returned duplicate item IDs."
            );
        }
        if (group.itemPositions.has(item.itemPosition)) {
            throw new Error(
                "SQLite Receive Delivery draft query returned duplicate item positions."
            );
        }
        group.itemIds.add(item.deliveryItemId);
        group.itemPositions.add(item.itemPosition);
        group.items.push(item);
    }

    return [...drafts.values()]
        .sort((left, right) =>
            left.draft.deliveryPosition - right.draft.deliveryPosition
        )
        .map(({ draft, items }) => ({
            ...draft,
            items: items.sort(
                (left, right) => left.itemPosition - right.itemPosition
            )
        }));
}
