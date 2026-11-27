import {
    querySqlite,
    type SqliteQueryExecutor,
    type SqliteQueryResult,
    type SqliteQueryValue
} from "../query";

const RECEIVED_DELIVERIES_QUERY = `
    SELECT
        delivery.delivery_id AS delivery_id,
        delivery.delivery_position AS delivery_position,
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
        item.received_inventory_id AS received_inventory_id,
        item.receipt_snapshot_json AS receipt_snapshot_json
    FROM deliveries AS delivery
    LEFT JOIN delivery_items AS item
        ON item.delivery_id = delivery.delivery_id
    WHERE delivery.status = 'received'
    ORDER BY
        julianday(delivery.updated_at) DESC,
        delivery.delivery_position ASC,
        item.item_position ASC
`;

export interface PersistedReceivedDeliveryItem {
    readonly deliveryItemId: string;
    readonly itemPosition: number;
    readonly productId: string;
    readonly variantId: string;
    readonly packagingLevelId: string;
    readonly quantity: number;
    readonly batchNumber: string | null;
    readonly expiryDate: string | null;
    readonly costPrice: number | null;
    readonly sellingPrice: number | null;
    readonly receivedBatchId: string;
    readonly receivedInventoryId: string | null;
    readonly receiptSnapshot: unknown;
    readonly receiptSnapshotJson: string;
}

export interface PersistedReceivedDelivery {
    readonly deliveryId: string;
    readonly status: "received";
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly receivedAt: string;
    readonly deliveryDate: string;
    readonly receivedBy: string;
    readonly supplierName: string | null;
    readonly invoiceNumber: string | null;
    readonly receivedEventId: string;
    readonly items: readonly PersistedReceivedDeliveryItem[];
}

type DeliveryRow = ReadonlyMap<string, SqliteQueryValue>;

interface DeliveryGroup {
    readonly delivery: PersistedReceivedDelivery;
    readonly deliveryPosition: number;
    readonly items: PersistedReceivedDeliveryItem[];
    readonly itemIds: Set<string>;
}

function toDeliveryRows(result: SqliteQueryResult): DeliveryRow[] {
    return result.rows.map((values) => {
        if (values.length !== result.columns.length) {
            throw new Error(
                "SQLite Receive Delivery query returned an invalid row shape."
            );
        }

        const row = new Map<string, SqliteQueryValue>();
        result.columns.forEach((column, index) => {
            if (row.has(column)) {
                throw new Error(
                    "SQLite Receive Delivery query returned duplicate columns."
                );
            }
            row.set(column, values[index]);
        });
        return row;
    });
}

function requiredValue(row: DeliveryRow, column: string): SqliteQueryValue {
    const value = row.get(column);
    if (value === undefined) {
        throw new Error(
            `SQLite Receive Delivery query is missing the ${column} column.`
        );
    }
    return value;
}

function requiredText(row: DeliveryRow, column: string): string {
    const value = requiredValue(row, column);
    if (typeof value !== "string" || value.trim() === "") {
        throw new Error(
            `SQLite Receive Delivery query returned an invalid ${column}.`
        );
    }
    return value;
}

function nullableText(row: DeliveryRow, column: string): string | null {
    const value = requiredValue(row, column);
    if (value === null) {
        return null;
    }
    if (typeof value !== "string") {
        throw new Error(
            `SQLite Receive Delivery query returned an invalid ${column}.`
        );
    }
    return value;
}

function nullableIdentifier(row: DeliveryRow, column: string): string | null {
    const value = nullableText(row, column);
    if (value !== null && value.trim() === "") {
        throw new Error(
            `SQLite Receive Delivery query returned an invalid ${column}.`
        );
    }
    return value;
}

function requiredSafeInteger(
    row: DeliveryRow,
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
            `SQLite Receive Delivery query returned an invalid ${column}.`
        );
    }
    return value;
}

function moneyFromMinorUnits(
    row: DeliveryRow,
    column: string
): number {
    const minorUnits = requiredSafeInteger(row, column, 0);
    const amount = minorUnits / 100;
    if (
        !Number.isFinite(amount) ||
        Math.round(amount * 100) !== minorUnits
    ) {
        throw new Error(
            `SQLite Receive Delivery query returned a ${column} value that cannot be represented safely.`
        );
    }
    return amount;
}

function nullableMoneyFromMinorUnits(
    row: DeliveryRow,
    column: string
): number | null {
    if (requiredValue(row, column) === null) {
        return null;
    }
    return moneyFromMinorUnits(row, column);
}

function parseReceiptSnapshot(value: string): unknown {
    try {
        return JSON.parse(value);
    } catch {
        throw new Error(
            "SQLite Receive Delivery query returned invalid receipt snapshot JSON."
        );
    }
}

function deliveryFromRow(row: DeliveryRow): {
    delivery: PersistedReceivedDelivery;
    deliveryPosition: number;
} {
    const updatedAt = requiredText(row, "updated_at");
    return {
        delivery: {
            deliveryId: requiredText(row, "delivery_id"),
            status: "received",
            createdAt: requiredText(row, "created_at"),
            updatedAt,
            receivedAt: updatedAt,
            deliveryDate: requiredText(row, "delivery_date"),
            receivedBy: requiredText(row, "received_by"),
            supplierName: nullableText(row, "supplier_name"),
            invoiceNumber: nullableText(row, "invoice_number"),
            receivedEventId: requiredText(row, "received_event_id"),
            items: []
        },
        deliveryPosition: requiredSafeInteger(row, "delivery_position", 0)
    };
}

function itemFromRow(row: DeliveryRow): PersistedReceivedDeliveryItem | null {
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
            "received_inventory_id",
            "receipt_snapshot_json"
        ];
        if (childColumns.some((column) => requiredValue(row, column) !== null)) {
            throw new Error(
                "SQLite Receive Delivery query returned an incomplete delivery item."
            );
        }
        return null;
    }
    if (deliveryItemId === null || itemPositionValue === null) {
        throw new Error(
            "SQLite Receive Delivery query returned an incomplete delivery item."
        );
    }

    const snapshotJson = requiredText(row, "receipt_snapshot_json");
    return {
        deliveryItemId,
        itemPosition: requiredSafeInteger(row, "item_position", 0),
        productId: requiredText(row, "product_id"),
        variantId: requiredText(row, "variant_id"),
        packagingLevelId: requiredText(row, "packaging_level_id"),
        quantity: requiredSafeInteger(row, "quantity", 1),
        batchNumber: nullableText(row, "batch_number"),
        expiryDate: nullableText(row, "expiry_date"),
        costPrice: nullableMoneyFromMinorUnits(
            row,
            "cost_price_minor_units"
        ),
        sellingPrice: nullableMoneyFromMinorUnits(
            row,
            "selling_price_minor_units"
        ),
        receivedBatchId: requiredText(row, "received_batch_id"),
        receivedInventoryId: nullableIdentifier(row, "received_inventory_id"),
        receiptSnapshot: parseReceiptSnapshot(snapshotJson),
        receiptSnapshotJson: snapshotJson
    };
}

function sameDelivery(
    left: PersistedReceivedDelivery,
    right: PersistedReceivedDelivery
): boolean {
    return left.deliveryId === right.deliveryId &&
        left.createdAt === right.createdAt &&
        left.updatedAt === right.updatedAt &&
        left.receivedAt === right.receivedAt &&
        left.deliveryDate === right.deliveryDate &&
        left.receivedBy === right.receivedBy &&
        left.supplierName === right.supplierName &&
        left.invoiceNumber === right.invoiceNumber &&
        left.receivedEventId === right.receivedEventId;
}

export async function getAllReceivedDeliveries(
    query: SqliteQueryExecutor = querySqlite
): Promise<PersistedReceivedDelivery[]> {
    const result = await query(RECEIVED_DELIVERIES_QUERY);
    const deliveries = new Map<string, DeliveryGroup>();

    for (const row of toDeliveryRows(result)) {
        const { delivery, deliveryPosition } = deliveryFromRow(row);
        const existing = deliveries.get(delivery.deliveryId);
        let group = existing;

        if (!group) {
            group = {
                delivery,
                deliveryPosition,
                items: [],
                itemIds: new Set()
            };
            deliveries.set(delivery.deliveryId, group);
        } else if (
            !sameDelivery(group.delivery, delivery) ||
            group.deliveryPosition !== deliveryPosition
        ) {
            throw new Error(
                "SQLite Receive Delivery query returned conflicting delivery rows."
            );
        }

        const item = itemFromRow(row);
        if (!item) {
            continue;
        }
        if (group.itemIds.has(item.deliveryItemId)) {
            throw new Error(
                "SQLite Receive Delivery query returned duplicate delivery items."
            );
        }
        group.itemIds.add(item.deliveryItemId);
        group.items.push(item);
    }

    return [...deliveries.values()].map(({ delivery, items }) => {
        if (items.length === 0) {
            throw new Error(
                "SQLite Receive Delivery query returned a received delivery without items."
            );
        }
        return { ...delivery, items };
    });
}
