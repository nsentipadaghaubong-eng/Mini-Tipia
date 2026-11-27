import {
    querySqlite,
    type SqliteQueryExecutor,
    type SqliteQueryResult,
    type SqliteQueryValue
} from "../query";

const ACTIVE_SALE_DRAFTS_QUERY = `
    SELECT
        draft.draft_position AS draft_position,
        draft.draft_id AS draft_id,
        draft.status AS status,
        draft.created_at AS created_at,
        draft.updated_at AS updated_at,
        draft.customer_name AS customer_name,
        draft.customer_address AS customer_address,
        draft.sale_date AS sale_date,
        draft.staff_user_id AS staff_user_id,
        draft.staff_display_name AS staff_display_name,
        draft.notes AS notes,
        draft.approved_sale_id AS approved_sale_id,
        item.line_id AS line_id,
        item.item_position AS item_position,
        item.product_id AS product_id,
        item.variant_id AS variant_id,
        item.inventory_record_id AS inventory_record_id,
        item.batch_id AS batch_id,
        item.packaging_level_id AS packaging_level_id,
        item.quantity AS quantity,
        item.default_selling_price_minor_units AS default_selling_price_minor_units,
        item.applied_selling_price_minor_units AS applied_selling_price_minor_units,
        item.discount_minor_units AS discount_minor_units
    FROM sale_drafts AS draft
    LEFT JOIN sale_draft_items AS item
        ON item.draft_id = draft.draft_id
    WHERE draft.status = $1
    ORDER BY draft.draft_position ASC, item.item_position ASC
`;

export interface PersistedSaleDraftItem {
    readonly lineId: string;
    readonly itemPosition: number;
    readonly productId: string;
    readonly variantId: string;
    readonly inventoryRecordId: string;
    readonly batchId: string | null;
    readonly packagingLevelId: string;
    readonly quantity: number;
    readonly defaultSellingPriceMinorUnits: number | null;
    readonly appliedSellingPriceMinorUnits: number;
    readonly discountMinorUnits: number;
}

export interface PersistedSaleDraft {
    readonly draftPosition: number;
    readonly draftId: string;
    readonly status: "draft";
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly customerName: string | null;
    readonly customerAddress: string | null;
    readonly saleDate: string | null;
    readonly staffUserId: string | null;
    readonly staffDisplayName: string | null;
    readonly notes: string | null;
    readonly approvedSaleId: string | null;
    readonly items: readonly PersistedSaleDraftItem[];
}

type SaleDraftRow = ReadonlyMap<string, SqliteQueryValue>;

interface SaleDraftGroup {
    readonly draft: Omit<PersistedSaleDraft, "items">;
    readonly itemPositions: Set<number>;
    readonly lineIds: Set<string>;
    readonly items: PersistedSaleDraftItem[];
}

function toSaleDraftRows(result: SqliteQueryResult): SaleDraftRow[] {
    return result.rows.map((values) => {
        if (values.length !== result.columns.length) {
            throw new Error(
                "SQLite Sales draft query returned an invalid row shape."
            );
        }

        const row = new Map<string, SqliteQueryValue>();
        result.columns.forEach((column, index) => {
            if (row.has(column)) {
                throw new Error(
                    "SQLite Sales draft query returned duplicate columns."
                );
            }
            row.set(column, values[index]);
        });
        return row;
    });
}

function requiredValue(row: SaleDraftRow, column: string): SqliteQueryValue {
    const value = row.get(column);
    if (value === undefined) {
        throw new Error(
            `SQLite Sales draft query is missing the ${column} column.`
        );
    }
    return value;
}

function requiredText(row: SaleDraftRow, column: string): string {
    const value = requiredValue(row, column);
    if (typeof value !== "string" || value.trim() === "") {
        throw new Error(
            `SQLite Sales draft query returned an invalid ${column}.`
        );
    }
    return value;
}

function nullableText(row: SaleDraftRow, column: string): string | null {
    const value = requiredValue(row, column);
    if (value === null) {
        return null;
    }
    if (typeof value !== "string") {
        throw new Error(
            `SQLite Sales draft query returned an invalid ${column}.`
        );
    }
    return value;
}

function nullableIdentifier(row: SaleDraftRow, column: string): string | null {
    const value = nullableText(row, column);
    if (value !== null && value.trim() === "") {
        throw new Error(
            `SQLite Sales draft query returned an invalid ${column}.`
        );
    }
    return value;
}

function requiredSafeInteger(
    row: SaleDraftRow,
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
            `SQLite Sales draft query returned an invalid ${column}.`
        );
    }
    return value;
}

function nullableSafeInteger(
    row: SaleDraftRow,
    column: string
): number | null {
    const value = requiredValue(row, column);
    if (value === null) {
        return null;
    }
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        throw new Error(
            `SQLite Sales draft query returned an invalid ${column}.`
        );
    }
    return value;
}

function requiredTimestamp(row: SaleDraftRow, column: string): string {
    const value = requiredText(row, column);
    if (!Number.isFinite(Date.parse(value))) {
        throw new Error(
            `SQLite Sales draft query returned an invalid ${column}.`
        );
    }
    return value;
}

function sameDraft(
    left: Omit<PersistedSaleDraft, "items">,
    right: Omit<PersistedSaleDraft, "items">
): boolean {
    return left.draftPosition === right.draftPosition &&
        left.draftId === right.draftId &&
        left.status === right.status &&
        left.createdAt === right.createdAt &&
        left.updatedAt === right.updatedAt &&
        left.customerName === right.customerName &&
        left.customerAddress === right.customerAddress &&
        left.saleDate === right.saleDate &&
        left.staffUserId === right.staffUserId &&
        left.staffDisplayName === right.staffDisplayName &&
        left.notes === right.notes &&
        left.approvedSaleId === right.approvedSaleId;
}

function draftFromRow(row: SaleDraftRow): Omit<PersistedSaleDraft, "items"> {
    const status = requiredText(row, "status");
    if (status !== "draft") {
        throw new Error(
            "SQLite Sales draft query returned a non-active draft."
        );
    }

    const approvedSaleId = nullableIdentifier(row, "approved_sale_id");
    if (approvedSaleId !== null) {
        throw new Error(
            "SQLite active Sales draft unexpectedly references an approved Sale."
        );
    }

    const createdAt = requiredTimestamp(row, "created_at");
    const updatedAt = requiredTimestamp(row, "updated_at");
    if (Date.parse(updatedAt) < Date.parse(createdAt)) {
        throw new Error(
            "SQLite Sales draft query returned an update timestamp before creation."
        );
    }

    return {
        draftPosition: requiredSafeInteger(
            row,
            "draft_position",
            Number.MIN_SAFE_INTEGER
        ),
        draftId: requiredText(row, "draft_id"),
        status,
        createdAt,
        updatedAt,
        customerName: nullableText(row, "customer_name"),
        customerAddress: nullableText(row, "customer_address"),
        saleDate: nullableText(row, "sale_date"),
        staffUserId: nullableIdentifier(row, "staff_user_id"),
        staffDisplayName: nullableText(row, "staff_display_name"),
        notes: nullableText(row, "notes"),
        approvedSaleId
    };
}

function itemFromRow(row: SaleDraftRow): PersistedSaleDraftItem | null {
    const lineId = nullableText(row, "line_id");
    const itemPositionValue = requiredValue(row, "item_position");

    if (lineId === null && itemPositionValue === null) {
        const childColumns = [
            "product_id",
            "variant_id",
            "inventory_record_id",
            "batch_id",
            "packaging_level_id",
            "quantity",
            "default_selling_price_minor_units",
            "applied_selling_price_minor_units",
            "discount_minor_units"
        ];
        if (childColumns.some((column) => requiredValue(row, column) !== null)) {
            throw new Error(
                "SQLite Sales draft query returned an incomplete item row."
            );
        }
        return null;
    }
    if (lineId === null || itemPositionValue === null) {
        throw new Error(
            "SQLite Sales draft query returned an incomplete item row."
        );
    }

    const itemPosition = requiredSafeInteger(row, "item_position", 0);
    const batchId = nullableIdentifier(row, "batch_id");

    return {
        lineId,
        itemPosition,
        productId: requiredText(row, "product_id"),
        variantId: requiredText(row, "variant_id"),
        inventoryRecordId: requiredText(row, "inventory_record_id"),
        batchId,
        packagingLevelId: requiredText(row, "packaging_level_id"),
        quantity: requiredSafeInteger(row, "quantity", 1),
        defaultSellingPriceMinorUnits: nullableSafeInteger(
            row,
            "default_selling_price_minor_units"
        ),
        appliedSellingPriceMinorUnits: requiredSafeInteger(
            row,
            "applied_selling_price_minor_units",
            0
        ),
        discountMinorUnits: requiredSafeInteger(
            row,
            "discount_minor_units",
            0
        )
    };
}

export async function getAllActiveSaleDrafts(
    query: SqliteQueryExecutor = querySqlite
): Promise<PersistedSaleDraft[]> {
    const result = await query(ACTIVE_SALE_DRAFTS_QUERY, ["draft"]);
    const drafts = new Map<string, SaleDraftGroup>();
    const draftPositions = new Set<number>();

    for (const row of toSaleDraftRows(result)) {
        const draft = draftFromRow(row);
        let group = drafts.get(draft.draftId);

        if (!group) {
            if (draftPositions.has(draft.draftPosition)) {
                throw new Error(
                    "SQLite Sales draft query returned duplicate draft positions."
                );
            }
            draftPositions.add(draft.draftPosition);
            group = {
                draft,
                itemPositions: new Set(),
                lineIds: new Set(),
                items: []
            };
            drafts.set(draft.draftId, group);
        } else if (!sameDraft(group.draft, draft)) {
            throw new Error(
                "SQLite Sales draft query returned conflicting draft rows."
            );
        }

        const item = itemFromRow(row);
        if (!item) {
            continue;
        }
        if (group.lineIds.has(item.lineId)) {
            throw new Error(
                "SQLite Sales draft query returned duplicate item IDs."
            );
        }
        if (group.itemPositions.has(item.itemPosition)) {
            throw new Error(
                "SQLite Sales draft query returned duplicate item positions."
            );
        }
        group.lineIds.add(item.lineId);
        group.itemPositions.add(item.itemPosition);
        group.items.push(item);
    }

    return [...drafts.values()]
        .sort((left, right) =>
            left.draft.draftPosition - right.draft.draftPosition
        )
        .map(({ draft, items }) => ({
            ...draft,
            items: items.sort(
                (left, right) => left.itemPosition - right.itemPosition
            )
        }));
}
