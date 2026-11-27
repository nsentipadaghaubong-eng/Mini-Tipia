import {
    querySqlite,
    type SqliteQueryExecutor,
    type SqliteQueryResult,
    type SqliteQueryValue
} from "../query";

const SALES_QUERY = `
    SELECT
        sale.sale_id AS sale_id,
        sale.sale_position AS sale_position,
        sale.source_draft_id AS source_draft_id,
        sale.completed_event_id AS completed_event_id,
        sale.completed_at AS completed_at,
        sale.customer_name AS customer_name,
        sale.customer_address AS customer_address,
        sale.sale_date AS sale_date,
        sale.staff_user_id AS staff_user_id,
        sale.staff_display_name AS staff_display_name,
        sale.notes AS notes,
        sale.subtotal_minor_units AS subtotal_minor_units,
        sale.discount_minor_units AS discount_minor_units,
        sale.final_minor_units AS final_minor_units,
        sale.expired_batch_confirmed AS expired_batch_confirmed,
        item.line_id AS line_id,
        item.item_position AS item_position,
        item.inventory_record_id AS inventory_record_id,
        item.product_id AS product_id,
        item.variant_id AS variant_id,
        item.batch_id AS batch_id,
        item.packaging_level_id AS packaging_level_id,
        item.quantity AS quantity,
        item.default_selling_price_minor_units AS default_selling_price_minor_units,
        item.applied_selling_price_minor_units AS applied_selling_price_minor_units,
        item.subtotal_minor_units AS item_subtotal_minor_units,
        item.discount_minor_units AS item_discount_minor_units,
        item.final_minor_units AS item_final_minor_units,
        item.expired_batch AS item_expired_batch,
        item.item_snapshot_json AS item_snapshot_json
    FROM sales AS sale
    LEFT JOIN sale_items AS item
        ON item.sale_id = sale.sale_id
    ORDER BY
        julianday(sale.completed_at) DESC,
        sale.sale_position ASC,
        item.item_position ASC
`;

export interface PersistedSaleItem {
    readonly lineId: string;
    readonly itemPosition: number;
    readonly inventoryRecordId: string;
    readonly productId: string;
    readonly variantId: string;
    readonly batchId: string | null;
    readonly packagingLevelId: string;
    readonly quantity: number;
    readonly defaultSellingPrice: number | null;
    readonly appliedSellingPrice: number;
    readonly subtotal: number;
    readonly discountAmount: number;
    readonly finalAmount: number;
    readonly expiredBatch: boolean;
    readonly itemSnapshot: unknown;
    readonly itemSnapshotJson: string;
}

export interface PersistedSale {
    readonly saleId: string;
    readonly status: "completed";
    readonly sourceDraftId: string;
    readonly completedEventId: string;
    readonly completedAt: string;
    readonly customerName: string | null;
    readonly customerAddress: string | null;
    readonly saleDate: string | null;
    readonly staffUserId: string | null;
    readonly staffDisplayName: string | null;
    readonly notes: string | null;
    readonly items: readonly PersistedSaleItem[];
    readonly subtotal: number;
    readonly discountAmount: number;
    readonly finalAmount: number;
    readonly expiredBatchConfirmed: boolean;
}

type SaleRow = ReadonlyMap<string, SqliteQueryValue>;

interface SaleGroup {
    readonly sale: PersistedSale;
    readonly salePosition: number;
    readonly items: PersistedSaleItem[];
    readonly lineIds: Set<string>;
}

function toSaleRows(result: SqliteQueryResult): SaleRow[] {
    return result.rows.map((values) => {
        if (values.length !== result.columns.length) {
            throw new Error("SQLite Sales query returned an invalid row shape.");
        }

        const row = new Map<string, SqliteQueryValue>();
        result.columns.forEach((column, index) => {
            if (row.has(column)) {
                throw new Error("SQLite Sales query returned duplicate columns.");
            }
            row.set(column, values[index]);
        });
        return row;
    });
}

function requiredValue(row: SaleRow, column: string): SqliteQueryValue {
    const value = row.get(column);
    if (value === undefined) {
        throw new Error(`SQLite Sales query is missing the ${column} column.`);
    }
    return value;
}

function requiredText(row: SaleRow, column: string): string {
    const value = requiredValue(row, column);
    if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`SQLite Sales query returned an invalid ${column}.`);
    }
    return value;
}

function nullableText(row: SaleRow, column: string): string | null {
    const value = requiredValue(row, column);
    if (value === null) {
        return null;
    }
    if (typeof value !== "string") {
        throw new Error(`SQLite Sales query returned an invalid ${column}.`);
    }
    return value;
}

function requiredSafeInteger(
    row: SaleRow,
    column: string,
    minimum: number
): number {
    const value = requiredValue(row, column);
    if (
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < minimum
    ) {
        throw new Error(`SQLite Sales query returned an invalid ${column}.`);
    }
    return value;
}

function moneyFromMinorUnits(row: SaleRow, column: string): number {
    const minorUnits = requiredSafeInteger(row, column, 0);
    const amount = minorUnits / 100;
    if (
        !Number.isFinite(amount) ||
        Math.round(amount * 100) !== minorUnits
    ) {
        throw new Error(
            `SQLite Sales query returned a ${column} value that cannot be represented safely.`
        );
    }
    return amount;
}

function nullableMoneyFromMinorUnits(
    row: SaleRow,
    column: string
): number | null {
    if (requiredValue(row, column) === null) {
        return null;
    }
    return moneyFromMinorUnits(row, column);
}

function requiredBoolean(row: SaleRow, column: string): boolean {
    const value = requiredSafeInteger(row, column, 0);
    if (value !== 0 && value !== 1) {
        throw new Error(`SQLite Sales query returned an invalid ${column}.`);
    }
    return value === 1;
}

function parseItemSnapshot(value: string): unknown {
    try {
        return JSON.parse(value);
    } catch {
        throw new Error("SQLite Sales query returned invalid item snapshot JSON.");
    }
}

function sameSale(left: PersistedSale, right: PersistedSale): boolean {
    return left.saleId === right.saleId &&
        left.sourceDraftId === right.sourceDraftId &&
        left.completedEventId === right.completedEventId &&
        left.completedAt === right.completedAt &&
        left.customerName === right.customerName &&
        left.customerAddress === right.customerAddress &&
        left.saleDate === right.saleDate &&
        left.staffUserId === right.staffUserId &&
        left.staffDisplayName === right.staffDisplayName &&
        left.notes === right.notes &&
        left.subtotal === right.subtotal &&
        left.discountAmount === right.discountAmount &&
        left.finalAmount === right.finalAmount &&
        left.expiredBatchConfirmed === right.expiredBatchConfirmed;
}

function saleFromRow(row: SaleRow): {
    sale: PersistedSale;
    salePosition: number;
} {
    return {
        sale: {
            saleId: requiredText(row, "sale_id"),
            status: "completed",
            sourceDraftId: requiredText(row, "source_draft_id"),
            completedEventId: requiredText(row, "completed_event_id"),
            completedAt: requiredText(row, "completed_at"),
            customerName: nullableText(row, "customer_name"),
            customerAddress: nullableText(row, "customer_address"),
            saleDate: nullableText(row, "sale_date"),
            staffUserId: nullableText(row, "staff_user_id"),
            staffDisplayName: nullableText(row, "staff_display_name"),
            notes: nullableText(row, "notes"),
            items: [],
            subtotal: moneyFromMinorUnits(row, "subtotal_minor_units"),
            discountAmount: moneyFromMinorUnits(row, "discount_minor_units"),
            finalAmount: moneyFromMinorUnits(row, "final_minor_units"),
            expiredBatchConfirmed: requiredBoolean(
                row,
                "expired_batch_confirmed"
            )
        },
        salePosition: requiredSafeInteger(row, "sale_position", 0)
    };
}

function itemFromRow(row: SaleRow): PersistedSaleItem | null {
    const lineId = nullableText(row, "line_id");
    const itemPositionValue = requiredValue(row, "item_position");
    if (lineId === null && itemPositionValue === null) {
        const childColumns = [
            "inventory_record_id",
            "product_id",
            "variant_id",
            "batch_id",
            "packaging_level_id",
            "quantity",
            "default_selling_price_minor_units",
            "applied_selling_price_minor_units",
            "item_subtotal_minor_units",
            "item_discount_minor_units",
            "item_final_minor_units",
            "item_expired_batch",
            "item_snapshot_json"
        ];
        if (childColumns.some((column) => requiredValue(row, column) !== null)) {
            throw new Error("SQLite Sales query returned an incomplete sale item.");
        }
        return null;
    }
    if (lineId === null || itemPositionValue === null) {
        throw new Error("SQLite Sales query returned an incomplete sale item.");
    }

    const itemPosition = requiredSafeInteger(row, "item_position", 0);
    const snapshotJson = requiredText(row, "item_snapshot_json");
    const expiredBatch = requiredBoolean(row, "item_expired_batch");

    return {
        lineId,
        itemPosition,
        inventoryRecordId: requiredText(row, "inventory_record_id"),
        productId: requiredText(row, "product_id"),
        variantId: requiredText(row, "variant_id"),
        batchId: nullableText(row, "batch_id"),
        packagingLevelId: requiredText(row, "packaging_level_id"),
        quantity: requiredSafeInteger(row, "quantity", 1),
        defaultSellingPrice: nullableMoneyFromMinorUnits(
            row,
            "default_selling_price_minor_units"
        ),
        appliedSellingPrice: moneyFromMinorUnits(
            row,
            "applied_selling_price_minor_units"
        ),
        subtotal: moneyFromMinorUnits(row, "item_subtotal_minor_units"),
        discountAmount: moneyFromMinorUnits(row, "item_discount_minor_units"),
        finalAmount: moneyFromMinorUnits(row, "item_final_minor_units"),
        expiredBatch,
        itemSnapshot: parseItemSnapshot(snapshotJson),
        itemSnapshotJson: snapshotJson
    };
}

export async function getAllSales(
    query: SqliteQueryExecutor = querySqlite
): Promise<PersistedSale[]> {
    const result = await query(SALES_QUERY);
    const sales = new Map<string, SaleGroup>();

    for (const row of toSaleRows(result)) {
        const { sale, salePosition } = saleFromRow(row);
        const existing = sales.get(sale.saleId);
        let group = existing;

        if (!group) {
            group = {
                sale,
                salePosition,
                items: [],
                lineIds: new Set()
            };
            sales.set(sale.saleId, group);
        } else if (
            !sameSale(group.sale, sale) ||
            group.salePosition !== salePosition
        ) {
            throw new Error("SQLite Sales query returned conflicting sale rows.");
        }

        const item = itemFromRow(row);
        if (!item) {
            continue;
        }
        if (group.lineIds.has(item.lineId)) {
            throw new Error("SQLite Sales query returned duplicate sale items.");
        }
        group.lineIds.add(item.lineId);
        group.items.push(item);
    }

    return [...sales.values()].map(({ sale, items }) => ({
        ...sale,
        items
    }));
}
