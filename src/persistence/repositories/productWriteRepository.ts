import type { ActivityEvent } from "../../activity/activity";
import type { ProductCreationResult } from "../../products/productCreation";
import { validatePackagingHierarchy } from "../../packaging/packagingValidation";
import type { productStructure, variant } from "../../products/productStructure";
import type { inventory } from "../../inventory/inventoryStock";
import type { inventoryBatch } from "../../inventory/inventoryBatch";
import {
    assertNoDuplicateLogicalBatchIdentities,
    validateBatchPricingCollection
} from "../../inventory/inventoryBatch";
import { validateInventoryRelationships } from "../../inventory/inventoryValidation";
import { hasAtMostTwoDecimalPlaces } from "../../pricing/pricePrecision";
import {
    assertActivityInsertRowsAffected,
    createActivityInsert
} from "./activityWriteRepository";
import {
    querySqlite,
    type SqliteQueryExecutor,
    type SqliteQueryResult,
    type SqliteQueryValue
} from "../query";
import {
    executeTransaction,
    type SqliteStatement
} from "../transaction";

type CatalogueCreatedEvent = Extract<ActivityEvent, { type: "product.created" }>;
type VariantAddedEvent = Extract<ActivityEvent, { type: "product.variant_added" }>;
type ProductUpdatedEvent = Extract<ActivityEvent, { type: "product.updated" }>;

interface ProductWritePlan {
    readonly statements: SqliteStatement[];
    readonly expectedRowsAffected: number[];
    readonly activityIndex: number;
    readonly activityInsert: ReturnType<typeof createActivityInsert>;
}

export interface ProductWriteDependencies {
    readonly execute?: typeof executeTransaction;
    readonly query?: SqliteQueryExecutor;
}

interface PositionRow {
    readonly id: string;
    readonly position: number;
}

interface PackagingPositionRow extends PositionRow {
    readonly variantId: string;
}

function assertText(value: unknown, label: string): asserts value is string {
    if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`${label} must be a non-empty string.`);
    }
}

function minorUnits(value: number | null, label: string): number | null {
    if (value === null) {
        return null;
    }
    if (
        !Number.isFinite(value) ||
        value < 0 ||
        !hasAtMostTwoDecimalPlaces(value)
    ) {
        throw new Error(`${label} must be a non-negative price with at most two decimal places.`);
    }
    const minor = Math.round(value * 100);
    if (!Number.isSafeInteger(minor) || minor / 100 !== value) {
        throw new Error(`${label} exceeds the safe SQLite minor-unit range.`);
    }
    return minor;
}

function nullableText(value: string | undefined): string | null {
    return value === undefined ? null : value;
}

function validateProduct(product: productStructure): void {
    assertText(product.id, "Product ID");
    assertText(product.name, "Product name");
    if (!Array.isArray(product.variant)) {
        throw new Error("Product variants must be an array.");
    }

    const ids = new Set([product.id]);
    for (const productVariant of product.variant) {
        assertText(productVariant.id, "Variant ID");
        assertText(productVariant.variantName, "Variant name");
        if (ids.has(productVariant.id)) {
            throw new Error(`Duplicate Product structure ID: ${productVariant.id}`);
        }
        ids.add(productVariant.id);
        for (const level of productVariant.packagingHierarchy) {
            if (ids.has(level.id)) {
                throw new Error(`Duplicate Product structure ID: ${level.id}`);
            }
            ids.add(level.id);
            minorUnits(level.costPrice, `Cost price for ${level.id}`);
            minorUnits(level.sellingPrice, `Selling price for ${level.id}`);
        }
        validatePackagingHierarchy(productVariant.packagingHierarchy);
        const threshold = productVariant.lowStockThreshold;
        if (threshold) {
            if (!Number.isSafeInteger(threshold.quantity) || threshold.quantity < 0) {
                throw new Error(`Invalid low-stock threshold for ${productVariant.id}.`);
            }
            if (
                threshold.packagingLevelId !== undefined &&
                !productVariant.packagingHierarchy.some(
                    (level) => level.id === threshold.packagingLevelId
                )
            ) {
                throw new Error(
                    `Low-stock threshold references an unknown packaging level for ${productVariant.id}.`
                );
            }
        }
    }
}

function sqliteRows(
    result: SqliteQueryResult,
    requiredColumns: readonly string[]
): ReadonlyMap<string, SqliteQueryValue>[] {
    const indexes = requiredColumns.map((column) => {
        const index = result.columns.indexOf(column);
        if (index === -1) {
            throw new Error(`SQLite Product write query is missing ${column}.`);
        }
        return index;
    });
    return result.rows.map((values) => {
        if (values.length !== result.columns.length) {
            throw new Error("SQLite Product write query returned an invalid row shape.");
        }
        return new Map(
            requiredColumns.map((column, index) => [
                column,
                values[indexes[index] as number]
            ])
        );
    });
}

function requiredText(
    row: ReadonlyMap<string, SqliteQueryValue>,
    column: string
): string {
    const value = row.get(column);
    if (typeof value !== "string") {
        throw new Error(`SQLite Product write query returned an invalid ${column}.`);
    }
    return value;
}

function requiredPosition(
    row: ReadonlyMap<string, SqliteQueryValue>,
    column: string
): number {
    const value = row.get(column);
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        throw new Error(`SQLite Product write query returned an invalid ${column}.`);
    }
    return value;
}

async function readProductPositions(
    query: SqliteQueryExecutor
): Promise<PositionRow[]> {
    const result = await query(`
        SELECT product_id, product_position
        FROM products
        ORDER BY product_position
    `);
    return sqliteRows(result, ["product_id", "product_position"]).map((row) => ({
        id: requiredText(row, "product_id"),
        position: requiredPosition(row, "product_position")
    }));
}

async function readVariantPositions(
    productId: string,
    query: SqliteQueryExecutor
): Promise<PositionRow[]> {
    const result = await query(`
        SELECT variant_id, variant_position
        FROM variants
        WHERE product_id = $1
        ORDER BY variant_position
    `, [productId]);
    return sqliteRows(result, ["variant_id", "variant_position"]).map((row) => ({
        id: requiredText(row, "variant_id"),
        position: requiredPosition(row, "variant_position")
    }));
}

async function readPackagingPositions(
    productId: string,
    query: SqliteQueryExecutor
): Promise<PackagingPositionRow[]> {
    const result = await query(`
        SELECT variant_id, packaging_level_id, packaging_position
        FROM packaging_levels
        WHERE product_id = $1
        ORDER BY variant_id, packaging_position
    `, [productId]);
    return sqliteRows(
        result,
        ["variant_id", "packaging_level_id", "packaging_position"]
    ).map((row) => ({
        variantId: requiredText(row, "variant_id"),
        id: requiredText(row, "packaging_level_id"),
        position: requiredPosition(row, "packaging_position")
    }));
}

function assertPositionsMatchState(
    persisted: readonly PositionRow[],
    idsInState: readonly string[],
    label: string
): void {
    if (
        persisted.length !== idsInState.length ||
        persisted.some((row, index) => row.id !== idsInState[index])
    ) {
        throw new Error(
            `SQLite ${label} order is stale or inconsistent with ApplicationState.`
        );
    }
}

function assertPackagingPositionsMatchState(
    persisted: readonly PackagingPositionRow[],
    product: productStructure
): void {
    const rowsByVariant = new Map<string, PackagingPositionRow[]>();
    for (const row of persisted) {
        const rows = rowsByVariant.get(row.variantId) ?? [];
        rows.push(row);
        rowsByVariant.set(row.variantId, rows);
    }
    for (const productVariant of product.variant) {
        const rows = rowsByVariant.get(productVariant.id) ?? [];
        assertPositionsMatchState(
            rows,
            productVariant.packagingHierarchy.map((level) => level.id),
            `Product packaging for Variant ${productVariant.id}`
        );
        rowsByVariant.delete(productVariant.id);
    }
    if ([...rowsByVariant.values()].some((rows) => rows.length > 0)) {
        throw new Error("SQLite Product packaging contains an unknown Variant.");
    }
}

function maximumPosition(rows: readonly PositionRow[]): number {
    return rows.reduce((maximum, row) => Math.max(maximum, row.position), -1);
}

function temporaryPositionBase(
    rows: readonly PositionRow[],
    finalRowCount: number
): number {
    const base = maximumPosition(rows) + rows.length + finalRowCount + 1;
    if (!Number.isSafeInteger(base) || base < 0) {
        throw new Error("Product ordering exceeds the safe SQLite position range.");
    }
    return base;
}

function appendStatement(
    plan: Pick<ProductWritePlan, "statements" | "expectedRowsAffected">,
    query: string,
    parameters: SqliteStatement["parameters"]
): number {
    plan.statements.push({ query, parameters });
    plan.expectedRowsAffected.push(1);
    return plan.statements.length - 1;
}

function appendActivity(
    plan: Pick<ProductWritePlan, "statements" | "expectedRowsAffected">,
    event: ActivityEvent
): Pick<ProductWritePlan, "activityIndex" | "activityInsert"> {
    const activityInsert = createActivityInsert(event);
    const activityIndex = appendStatement(
        plan,
        activityInsert.statement.query,
        activityInsert.statement.parameters
    );
    plan.expectedRowsAffected[activityIndex] =
        activityInsert.expectedRowsAffected;
    return { activityIndex, activityInsert };
}

function appendVariantAndPackaging(
    plan: Pick<ProductWritePlan, "statements" | "expectedRowsAffected">,
    productId: string,
    productVariant: variant,
    variantPosition: number,
    packagingPositions: readonly number[]
): void {
    appendStatement(plan, `
        INSERT INTO variants (
            variant_id, product_id, variant_position, variant_name,
            nafdac_registration_number
        ) VALUES ($1, $2, $3, $4, $5)
    `, [
        productVariant.id,
        productId,
        variantPosition,
        productVariant.variantName,
        nullableText(productVariant.nafdacRegistrationNumber)
    ]);

    productVariant.packagingHierarchy.forEach((level, index) => {
        const position = packagingPositions[index];
        if (position === undefined) {
            throw new Error("Product packaging position was not prepared.");
        }
        appendStatement(plan, `
            INSERT INTO packaging_levels (
                packaging_level_id, product_id, variant_id, packaging_position,
                name, cost_price_minor_units, selling_price_minor_units,
                quantity_of_next_level, next_level_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL)
        `, [
            level.id,
            productId,
            productVariant.id,
            position,
            level.name,
            minorUnits(level.costPrice, `Cost price for ${level.id}`),
            minorUnits(level.sellingPrice, `Selling price for ${level.id}`)
        ]);
    });
    productVariant.packagingHierarchy.forEach((level) => {
        if (level.nextLevelId === null) {
            return;
        }
        appendStatement(plan, `
            UPDATE packaging_levels
            SET next_level_id = $1, quantity_of_next_level = $2
            WHERE product_id = $3
                AND variant_id = $4
                AND packaging_level_id = $5
                AND next_level_id IS NULL
                AND quantity_of_next_level IS NULL
        `, [
            level.nextLevelId,
            level.quantityofNextLevel,
            productId,
            productVariant.id,
            level.id
        ]);
    });

    if (productVariant.lowStockThreshold) {
        appendStatement(plan, `
            INSERT INTO variant_low_stock_thresholds (
                product_id, variant_id, quantity, packaging_level_id
            ) VALUES ($1, $2, $3, $4)
        `, [
            productId,
            productVariant.id,
            productVariant.lowStockThreshold.quantity,
            productVariant.lowStockThreshold.packagingLevelId ?? null
        ]);
    }
}

function expiryDateValue(batch: inventoryBatch): string | null {
    if (batch.expiryDate === null) {
        return null;
    }
    if (!(batch.expiryDate instanceof Date) || !Number.isFinite(batch.expiryDate.getTime())) {
        throw new Error(`Invalid expiry date for batch ${batch.batchId}.`);
    }
    const value = batch.expiryDate.toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error(`Invalid expiry date for batch ${batch.batchId}.`);
    }
    return value;
}

function receivedDateValue(batch: inventoryBatch): string | null {
    if (batch.receivedDate === undefined) {
        return null;
    }
    if (
        !/^\d{4}-\d{2}-\d{2}$/.test(batch.receivedDate) ||
        new Date(`${batch.receivedDate}T00:00:00.000Z`).toISOString().slice(0, 10)
            !== batch.receivedDate
    ) {
        throw new Error(`Invalid received date for batch ${batch.batchId}.`);
    }
    return batch.receivedDate;
}

function validateFullCreationResult(
    result: ProductCreationResult,
    existingProducts: readonly productStructure[],
    existingInventory: readonly inventory[],
    existingBatches: readonly inventoryBatch[]
): void {
    validateProduct(result.product);
    if (existingProducts.some((product) => product.id === result.product.id)) {
        throw new Error(`Product already exists: ${result.product.id}`);
    }
    if (existingInventory.some((record) =>
        result.inventoryRecords.some((candidate) => candidate.id === record.id)
    )) {
        throw new Error("Initial Inventory ID already exists.");
    }
    if (existingBatches.some((batch) =>
        result.inventoryBatches.some((candidate) => candidate.batchId === batch.batchId)
    )) {
        throw new Error("Initial batch ID already exists.");
    }

    const existingIds = new Set(existingProducts.flatMap((product) => [
        product.id,
        ...product.variant.flatMap((productVariant) => [
            productVariant.id,
            ...productVariant.packagingHierarchy.map((level) => level.id)
        ])
    ]));
    existingInventory.forEach((record) => existingIds.add(record.id));
    existingBatches.forEach((batch) => existingIds.add(batch.batchId));
    for (const productVariant of result.product.variant) {
        for (const id of [
            productVariant.id,
            ...productVariant.packagingHierarchy.map((level) => level.id)
        ]) {
            if (existingIds.has(id)) {
                throw new Error(`Product structure ID already exists: ${id}`);
            }
            existingIds.add(id);
        }
    }
    for (const record of result.inventoryRecords) {
        assertText(record.id, "Initial Inventory ID");
        if (existingIds.has(record.id)) {
            throw new Error(`Duplicate or stale initial record ID: ${record.id}`);
        }
        existingIds.add(record.id);
    }
    for (const batch of result.inventoryBatches) {
        assertText(batch.batchId, "Batch ID");
        if (existingIds.has(batch.batchId)) {
            throw new Error(`Duplicate or stale initial batch ID: ${batch.batchId}`);
        }
        existingIds.add(batch.batchId);
    }

    assertNoDuplicateLogicalBatchIdentities(result.inventoryBatches);
    const batchIds = new Set<string>();
    for (const batch of result.inventoryBatches) {
        assertText(batch.batchId, "Batch ID");
        if (batch.productId !== result.product.id) {
            throw new Error(`Batch ${batch.batchId} does not belong to the created Product.`);
        }
        const productVariant = result.product.variant.find(
            (candidate) => candidate.id === batch.variantId
        );
        if (!productVariant) {
            throw new Error(`Batch ${batch.batchId} references an unknown Variant.`);
        }
        if (batchIds.has(batch.batchId)) {
            throw new Error(`Duplicate batch ID: ${batch.batchId}`);
        }
        batchIds.add(batch.batchId);
        validateBatchPricingCollection(
            batch.pricingByPackagingLevel,
            productVariant.packagingHierarchy.map((level) => level.id)
        );
        for (const pricing of batch.pricingByPackagingLevel) {
            if (!productVariant.packagingHierarchy.some(
                (level) => level.id === pricing.packagingLevelId
            )) {
                throw new Error(
                    `Batch ${batch.batchId} contains pricing for unknown packaging.`
                );
            }
            minorUnits(pricing.costPrice, `Batch cost price for ${batch.batchId}`);
            minorUnits(pricing.sellingPrice, `Batch selling price for ${batch.batchId}`);
        }
        expiryDateValue(batch);
        receivedDateValue(batch);
    }

    const inventoryIds = new Set<string>();
    for (const record of result.inventoryRecords) {
        if (inventoryIds.has(record.id)) {
            throw new Error(`Duplicate initial Inventory ID: ${record.id}`);
        }
        inventoryIds.add(record.id);
        validateInventoryRelationships(
            result.product,
            record,
            result.inventoryBatches
        );
    }
}

async function executePlan(
    plan: ProductWritePlan,
    dependencies: ProductWriteDependencies
): Promise<void> {
    const execute = dependencies.execute ?? executeTransaction;
    const rowsAffected = await execute(
        plan.statements,
        plan.expectedRowsAffected
    );
    if (rowsAffected.length !== plan.expectedRowsAffected.length) {
        throw new Error("SQLite Product transaction returned an unexpected row-count result.");
    }
    plan.expectedRowsAffected.forEach((expected, index) => {
        if (rowsAffected[index] !== expected) {
            throw new Error(
                `SQLite Product transaction statement ${index + 1} expected ${expected} affected row, received ${rowsAffected[index] ?? "no result"}.`
            );
        }
    });
    const activityRows = rowsAffected[plan.activityIndex];
    assertActivityInsertRowsAffected(plan.activityInsert, activityRows);
}

export async function persistCatalogueProduct(
    product: productStructure,
    existingProducts: readonly productStructure[],
    event: CatalogueCreatedEvent,
    dependencies: ProductWriteDependencies = {}
): Promise<void> {
    validateProduct(product);
    if (event.product.productId !== product.id || event.type !== "product.created") {
        throw new Error("Catalogue Product Activity does not match the Product.");
    }
    const query = dependencies.query ?? querySqlite;
    const productRows = await readProductPositions(query);
    assertPositionsMatchState(
        productRows,
        existingProducts.map((item) => item.id),
        "Product"
    );
    if (existingProducts.some((item) => item.id === product.id)) {
        throw new Error(`Product already exists: ${product.id}`);
    }
    const knownIds = new Set(existingProducts.flatMap((item) => [
        item.id,
        ...item.variant.flatMap((productVariant) => [
            productVariant.id,
            ...productVariant.packagingHierarchy.map((level) => level.id)
        ])
    ]));
    for (const productVariant of product.variant) {
        for (const id of [
            productVariant.id,
            ...productVariant.packagingHierarchy.map((level) => level.id)
        ]) {
            if (knownIds.has(id)) {
                throw new Error(`Product structure ID already exists: ${id}`);
            }
            knownIds.add(id);
        }
    }

    const statements: SqliteStatement[] = [];
    const expectedRowsAffected: number[] = [];
    const positionBase = temporaryPositionBase(productRows, productRows.length);
    productRows.forEach((row, index) => {
        appendStatement({ statements, expectedRowsAffected }, `
            UPDATE products
            SET product_position = $1
            WHERE product_id = $2 AND product_position = $3
        `, [positionBase + index, row.id, row.position]);
    });

    appendStatement({ statements, expectedRowsAffected }, `
        INSERT INTO products (
            product_id, product_position, name, description,
            generic_name, manufacturer, category
        ) VALUES ($1, 0, $2, $3, $4, $5, $6)
    `, [
        product.id,
        product.name,
        product.description ?? null,
        product.genericName ?? null,
        product.manufacturer ?? null,
        product.category ?? null
    ]);
    productRows.forEach((row, index) => {
        appendStatement({ statements, expectedRowsAffected }, `
            UPDATE products
            SET product_position = $1
            WHERE product_id = $2 AND product_position = $3
        `, [index + 1, row.id, positionBase + index]);
    });

    product.variant.forEach((productVariant, index) =>
        appendVariantAndPackaging(
            { statements, expectedRowsAffected },
            product.id,
            productVariant,
            index,
            productVariant.packagingHierarchy.map((_, packagingIndex) =>
                packagingIndex
            )
        )
    );
    const activityInsert = appendActivity(
        { statements, expectedRowsAffected },
        event
    );
    await executePlan({
        statements,
        expectedRowsAffected,
        ...activityInsert
    }, dependencies);
}

export async function persistFullProduct(
    result: ProductCreationResult,
    existingProducts: readonly productStructure[],
    existingInventory: readonly inventory[],
    existingBatches: readonly inventoryBatch[],
    events: readonly ActivityEvent[],
    dependencies: ProductWriteDependencies = {}
): Promise<void> {
    validateFullCreationResult(
        result,
        existingProducts,
        existingInventory,
        existingBatches
    );

    const productEvents = events.filter((event) => event.type === "product.created");
    if (productEvents.length !== 1) {
        throw new Error("Full Product creation requires exactly one product-created event.");
    }
    const productEvent = productEvents[0];
    if (
        productEvent.type !== "product.created" ||
        productEvent.product.productId !== result.product.id
    ) {
        throw new Error("Product-created Activity does not match the full creation.");
    }

    const batchEvents = events.filter(
        (event) => event.type === "inventory.batch_created"
    );
    if (
        events.length !== 1 + result.inventoryBatches.length ||
        batchEvents.length !== result.inventoryBatches.length
    ) {
        throw new Error("Full Product creation Activity does not match its batches.");
    }
    for (const event of batchEvents) {
        if (
            event.type !== "inventory.batch_created" ||
            event.source !== "product_creation" ||
            event.batch.productId !== result.product.id
        ) {
            throw new Error("Initial batch Activity does not match the created Product.");
        }
        if (!result.inventoryBatches.some(
            (batch) => batch.batchId === event.batch.batchId
        )) {
            throw new Error("Initial batch Activity references an unknown batch.");
        }
    }

    const query = dependencies.query ?? querySqlite;
    const productRows = await readProductPositions(query);
    assertPositionsMatchState(
        productRows,
        existingProducts.map((item) => item.id),
        "Product"
    );

    const statements: SqliteStatement[] = [];
    const expectedRowsAffected: number[] = [];
    const positionBase = temporaryPositionBase(productRows, productRows.length);
    productRows.forEach((row, index) => {
        appendStatement({ statements, expectedRowsAffected }, `
            UPDATE products
            SET product_position = $1
            WHERE product_id = $2 AND product_position = $3
        `, [positionBase + index, row.id, row.position]);
    });

    appendStatement({ statements, expectedRowsAffected }, `
        INSERT INTO products (
            product_id, product_position, name, description,
            generic_name, manufacturer, category
        ) VALUES ($1, 0, $2, $3, $4, $5, $6)
    `, [
        result.product.id,
        result.product.name,
        result.product.description ?? null,
        result.product.genericName ?? null,
        result.product.manufacturer ?? null,
        result.product.category ?? null
    ]);
    productRows.forEach((row, index) => {
        appendStatement({ statements, expectedRowsAffected }, `
            UPDATE products
            SET product_position = $1
            WHERE product_id = $2 AND product_position = $3
        `, [index + 1, row.id, positionBase + index]);
    });

    result.product.variant.forEach((productVariant, variantPosition) =>
        appendVariantAndPackaging(
            { statements, expectedRowsAffected },
            result.product.id,
            productVariant,
            variantPosition,
            productVariant.packagingHierarchy.map((_, packagingIndex) =>
                packagingIndex
            )
        )
    );

    const batchPositionByVariant = new Map<string, number>();
    for (const batch of result.inventoryBatches) {
        const batchPosition = batchPositionByVariant.get(batch.variantId) ?? 0;
        batchPositionByVariant.set(batch.variantId, batchPosition + 1);
        appendStatement({ statements, expectedRowsAffected }, `
            INSERT INTO batches (
                batch_id, product_id, variant_id, batch_position,
                batch_number, expiry_date, received_date
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
            batch.batchId,
            batch.productId,
            batch.variantId,
            batchPosition,
            batch.batchNumber,
            expiryDateValue(batch),
            receivedDateValue(batch)
        ]);

        batch.pricingByPackagingLevel.forEach((pricing, pricingPosition) => {
            appendStatement({ statements, expectedRowsAffected }, `
                INSERT INTO batch_pricing (
                    batch_id, product_id, variant_id, packaging_level_id,
                    pricing_position, cost_price_minor_units,
                    selling_price_minor_units
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [
                batch.batchId,
                batch.productId,
                batch.variantId,
                pricing.packagingLevelId,
                pricingPosition,
                minorUnits(pricing.costPrice, `Batch cost price for ${batch.batchId}`),
                minorUnits(pricing.sellingPrice, `Batch selling price for ${batch.batchId}`)
            ]);
        });
    }

    const inventoryPositionByVariant = new Map<string, number>();
    for (const record of result.inventoryRecords) {
        const inventoryPosition =
            inventoryPositionByVariant.get(record.variantId) ?? 0;
        inventoryPositionByVariant.set(record.variantId, inventoryPosition + 1);
        appendStatement({ statements, expectedRowsAffected }, `
            INSERT INTO inventory_records (
                inventory_id, product_id, variant_id,
                inventory_position, batch_id
            ) VALUES ($1, $2, $3, $4, $5)
        `, [
            record.id,
            record.productId,
            record.variantId,
            inventoryPosition,
            record.batchId
        ]);

        record.stockQuantities.forEach((stock, stockPosition) => {
            appendStatement({ statements, expectedRowsAffected }, `
                INSERT INTO inventory_stock (
                    inventory_id, product_id, variant_id,
                    packaging_level_id, stock_position, quantity
                ) VALUES ($1, $2, $3, $4, $5, $6)
            `, [
                record.id,
                record.productId,
                record.variantId,
                stock.packagingLevelId,
                stockPosition,
                stock.quantity
            ]);
        });
    }

    const activityInserts: Array<{
        readonly index: number;
        readonly insert: ReturnType<typeof createActivityInsert>;
    }> = [];
    for (const event of events) {
        const activityInsert = createActivityInsert(event);
        const index = appendStatement(
            { statements, expectedRowsAffected },
            activityInsert.statement.query,
            activityInsert.statement.parameters
        );
        expectedRowsAffected[index] = activityInsert.expectedRowsAffected;
        activityInserts.push({ index, insert: activityInsert });
    }

    const execute = dependencies.execute ?? executeTransaction;
    const rowsAffected = await execute(
        statements,
        expectedRowsAffected
    );
    if (rowsAffected.length !== expectedRowsAffected.length) {
        throw new Error("SQLite full Product transaction returned an unexpected row-count result.");
    }
    expectedRowsAffected.forEach((expected, index) => {
        if (rowsAffected[index] !== expected) {
            throw new Error(
                `SQLite full Product transaction statement ${index + 1} expected ${expected} affected row, received ${rowsAffected[index] ?? "no result"}.`
            );
        }
    });
    activityInserts.forEach(({ index, insert }) =>
        assertActivityInsertRowsAffected(insert, rowsAffected[index])
    );
}

export async function persistVariantAddition(
    product: productStructure,
    productVariant: variant,
    event: VariantAddedEvent,
    dependencies: ProductWriteDependencies = {}
): Promise<void> {
    validateProduct(product);
    assertText(productVariant.id, "Variant ID");
    assertText(productVariant.variantName, "Variant name");
    validatePackagingHierarchy(productVariant.packagingHierarchy);
    const query = dependencies.query ?? querySqlite;
    const persistedVariants = await readVariantPositions(product.id, query);
    assertPositionsMatchState(
        persistedVariants,
        product.variant.map((item) => item.id),
        `Variants for Product ${product.id}`
    );
    if (event.productId !== product.id || event.variant.variantId !== productVariant.id) {
        throw new Error("Variant Activity does not match the Product and Variant.");
    }
    const knownIds = new Set([
        product.id,
        ...product.variant.flatMap((item) => [
            item.id,
            ...item.packagingHierarchy.map((level) => level.id)
        ])
    ]);
    for (const id of [
        productVariant.id,
        ...productVariant.packagingHierarchy.map((level) => level.id)
    ]) {
        if (knownIds.has(id)) {
            throw new Error(`Product structure ID already exists: ${id}`);
        }
        knownIds.add(id);
    }
    const statements: SqliteStatement[] = [];
    const expectedRowsAffected: number[] = [];
    appendVariantAndPackaging(
        { statements, expectedRowsAffected },
        product.id,
        productVariant,
        maximumPosition(persistedVariants) + 1,
        productVariant.packagingHierarchy.map((_, index) => index)
    );
    const activityInsert = appendActivity(
        { statements, expectedRowsAffected },
        event
    );
    await executePlan({
        statements,
        expectedRowsAffected,
        ...activityInsert
    }, dependencies);
}

function appendThresholdChange(
    plan: Pick<ProductWritePlan, "statements" | "expectedRowsAffected">,
    productId: string,
    previousVariant: variant | undefined,
    nextVariant: variant,
    verifyUnchanged = false
): void {
    const previous = previousVariant?.lowStockThreshold;
    const next = nextVariant.lowStockThreshold;
    if (
        previous &&
        next &&
        previous.quantity === next.quantity &&
        (previous.packagingLevelId ?? null) === (next.packagingLevelId ?? null)
    ) {
        if (verifyUnchanged) {
            appendStatement(plan, `
                UPDATE variant_low_stock_thresholds
                SET quantity = quantity
                WHERE product_id = $1 AND variant_id = $2
                    AND quantity = $3
                    AND packaging_level_id IS $4
            `, [
                productId,
                nextVariant.id,
                previous.quantity,
                previous.packagingLevelId ?? null
            ]);
        }
        return;
    }
    if (previous && next) {
        appendStatement(plan, `
            UPDATE variant_low_stock_thresholds
            SET quantity = $1, packaging_level_id = $2
            WHERE product_id = $3 AND variant_id = $4
                AND quantity = $5
                AND packaging_level_id IS $6
        `, [
            next.quantity,
            next.packagingLevelId ?? null,
            productId,
            nextVariant.id,
            previous.quantity,
            previous.packagingLevelId ?? null
        ]);
    } else if (previous) {
        appendStatement(plan, `
            DELETE FROM variant_low_stock_thresholds
            WHERE product_id = $1 AND variant_id = $2
                AND quantity = $3
                AND packaging_level_id IS $4
        `, [
            productId,
            nextVariant.id,
            previous.quantity,
            previous.packagingLevelId ?? null
        ]);
    } else if (next) {
        appendStatement(plan, `
            INSERT INTO variant_low_stock_thresholds (
                product_id, variant_id, quantity, packaging_level_id
            ) VALUES ($1, $2, $3, $4)
        `, [
            productId,
            nextVariant.id,
            next.quantity,
            next.packagingLevelId ?? null
        ]);
    }
}

function appendVariantStages(
    plan: Pick<ProductWritePlan, "statements" | "expectedRowsAffected">,
    previousProduct: productStructure,
    nextProduct: productStructure,
    variantPositions: readonly PositionRow[],
    packagingPositions: readonly PackagingPositionRow[]
): void {
    const previousById = new Map(
        previousProduct.variant.map((item) => [item.id, item])
    );
    const nextById = new Map(
        nextProduct.variant.map((item) => [item.id, item])
    );
    const newVariants = nextProduct.variant.filter((item) => !previousById.has(item.id));
    const variantBase = temporaryPositionBase(
        variantPositions,
        nextProduct.variant.length
    );
    variantPositions.forEach((position, index) => {
        const previous = previousById.get(position.id);
        if (!previous) {
            throw new Error(`SQLite returned an unknown Variant: ${position.id}`);
        }
        appendStatement(plan, `
            UPDATE variants
            SET variant_position = $1
            WHERE product_id = $2 AND variant_id = $3
                AND variant_position = $4
                AND variant_name IS $5
                AND nafdac_registration_number IS $6
        `, [
            variantBase + index,
            previousProduct.id,
            previous.id,
            position.position,
            previous.variantName,
            nullableText(previous.nafdacRegistrationNumber)
        ]);
    });

    for (const previousVariant of previousProduct.variant) {
        const rows = packagingPositions.filter(
            (row) => row.variantId === previousVariant.id
        );
        const nextVariant = nextById.get(previousVariant.id);
        const base = temporaryPositionBase(
            rows,
            nextVariant?.packagingHierarchy.length ?? 0
        );
        rows.forEach((position, index) => {
            const previousLevel = previousVariant.packagingHierarchy[index];
            if (!previousLevel || previousLevel.id !== position.id) {
                throw new Error(
                    `SQLite packaging order is stale for Variant ${previousVariant.id}.`
                );
            }
            appendStatement(plan, `
                UPDATE packaging_levels
                SET packaging_position = $1,
                    next_level_id = NULL,
                    quantity_of_next_level = NULL
                WHERE product_id = $2 AND variant_id = $3
                    AND packaging_level_id = $4
                    AND packaging_position = $5
                    AND name IS $6
                    AND cost_price_minor_units IS $7
                    AND selling_price_minor_units IS $8
                    AND quantity_of_next_level IS $9
                    AND next_level_id IS $10
            `, [
                base + index,
                previousProduct.id,
                previousVariant.id,
                previousLevel.id,
                position.position,
                previousLevel.name,
                minorUnits(previousLevel.costPrice, `Cost price for ${previousLevel.id}`),
                minorUnits(previousLevel.sellingPrice, `Selling price for ${previousLevel.id}`),
                previousLevel.quantityofNextLevel,
                previousLevel.nextLevelId
            ]);
        });
        const oldPackagingIds = new Set(
            previousVariant.packagingHierarchy.map((level) => level.id)
        );
        nextVariant?.packagingHierarchy
            .filter((level) => !oldPackagingIds.has(level.id))
            .forEach((level, index) => {
                appendStatement(plan, `
                    INSERT INTO packaging_levels (
                        packaging_level_id, product_id, variant_id,
                        packaging_position, name, cost_price_minor_units,
                        selling_price_minor_units, quantity_of_next_level,
                        next_level_id
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL)
                `, [
                    level.id,
                    previousProduct.id,
                    previousVariant.id,
                    base + rows.length + index,
                    level.name,
                    minorUnits(level.costPrice, `Cost price for ${level.id}`),
                    minorUnits(level.sellingPrice, `Selling price for ${level.id}`)
                ]);
            });
    }

    newVariants.forEach((productVariant, index) => {
        const position = variantBase + variantPositions.length + index;
        appendVariantAndPackaging(
            plan,
            previousProduct.id,
            productVariant,
            position,
            productVariant.packagingHierarchy.map((_, packagingIndex) =>
                temporaryPositionBase(
                    packagingPositions.filter((row) => row.variantId === productVariant.id),
                    productVariant.packagingHierarchy.length
                ) + packagingIndex
            )
        );
    });

    for (const [position, productVariant] of nextProduct.variant.entries()) {
        const temporaryVariantPosition = variantBase +
            (previousById.has(productVariant.id)
                ? variantPositions.findIndex((row) => row.id === productVariant.id)
                : variantPositions.length + newVariants.findIndex(
                    (item) => item.id === productVariant.id
                ));
        appendStatement(plan, `
            UPDATE variants
            SET variant_position = $1, variant_name = $2,
                nafdac_registration_number = $3
            WHERE product_id = $4 AND variant_id = $5
                AND variant_position = $6
        `, [
            position,
            productVariant.variantName,
            nullableText(productVariant.nafdacRegistrationNumber),
            previousProduct.id,
            productVariant.id,
            temporaryVariantPosition
        ]);

        const previousVariant = previousById.get(productVariant.id);
        const oldPackagingRows = packagingPositions.filter(
            (row) => row.variantId === productVariant.id
        );
        const packagingBase = temporaryPositionBase(
            oldPackagingRows,
            productVariant.packagingHierarchy.length
        );
        for (const [packagingPosition, level] of
            productVariant.packagingHierarchy.entries()) {
            const oldPositionIndex = oldPackagingRows.findIndex(
                (row) => row.id === level.id
            );
            const temporaryPackagingPosition = oldPositionIndex >= 0
                ? packagingBase + oldPositionIndex
                : packagingBase + oldPackagingRows.length +
                    productVariant.packagingHierarchy
                        .filter((candidate) =>
                            !previousVariant?.packagingHierarchy.some(
                                (oldLevel) => oldLevel.id === candidate.id
                            )
                        )
                        .findIndex((candidate) => candidate.id === level.id);
            appendStatement(plan, `
                UPDATE packaging_levels
                SET packaging_position = $1, name = $2,
                    cost_price_minor_units = $3,
                    selling_price_minor_units = $4,
                    quantity_of_next_level = $5,
                    next_level_id = $6
                WHERE product_id = $7 AND variant_id = $8
                    AND packaging_level_id = $9
                    AND packaging_position = $10
            `, [
                packagingPosition,
                level.name,
                minorUnits(level.costPrice, `Cost price for ${level.id}`),
                minorUnits(level.sellingPrice, `Selling price for ${level.id}`),
                level.quantityofNextLevel,
                level.nextLevelId,
                nextProduct.id,
                productVariant.id,
                level.id,
                temporaryPackagingPosition
            ]);
        }
        if (previousVariant) {
            appendThresholdChange(
                plan,
                previousProduct.id,
                previousVariant,
                productVariant,
                true
            );
        }
    }
}

export async function persistProductUpdate(
    previousProduct: productStructure,
    nextProduct: productStructure,
    event: ProductUpdatedEvent,
    dependencies: ProductWriteDependencies = {}
): Promise<void> {
    validateProduct(previousProduct);
    validateProduct(nextProduct);
    if (
        previousProduct.id !== nextProduct.id ||
        event.productId !== nextProduct.id ||
        event.after.productId !== nextProduct.id
    ) {
        throw new Error("Product update Activity does not match the Product.");
    }

    const structureChanged =
        JSON.stringify(previousProduct.variant) !==
        JSON.stringify(nextProduct.variant);
    const query = dependencies.query ?? querySqlite;
    const variantPositions = structureChanged
        ? await readVariantPositions(previousProduct.id, query)
        : [];
    if (structureChanged) {
        assertPositionsMatchState(
            variantPositions,
            previousProduct.variant.map((item) => item.id),
            `Variants for Product ${previousProduct.id}`
        );
    }
    const packagingPositions = structureChanged
        ? await readPackagingPositions(previousProduct.id, query)
        : [];
    if (structureChanged) {
        assertPackagingPositionsMatchState(packagingPositions, previousProduct);
    }

    const statements: SqliteStatement[] = [];
    const expectedRowsAffected: number[] = [];
    appendStatement({ statements, expectedRowsAffected }, `
        UPDATE products
        SET name = $1, description = $2, generic_name = $3,
            manufacturer = $4, category = $5
        WHERE product_id = $6
            AND name IS $7
            AND description IS $8
            AND generic_name IS $9
            AND manufacturer IS $10
            AND category IS $11
            AND (SELECT COUNT(*) FROM variants WHERE product_id = $6) = $12
            AND (SELECT COUNT(*) FROM packaging_levels WHERE product_id = $6) = $13
            AND (SELECT COUNT(*) FROM variant_low_stock_thresholds WHERE product_id = $6) = $14
    `, [
        nextProduct.name,
        nextProduct.description ?? null,
        nextProduct.genericName ?? null,
        nextProduct.manufacturer ?? null,
        nextProduct.category ?? null,
        previousProduct.id,
        previousProduct.name,
        previousProduct.description ?? null,
        previousProduct.genericName ?? null,
        previousProduct.manufacturer ?? null,
        previousProduct.category ?? null,
        previousProduct.variant.length,
        previousProduct.variant.reduce(
            (count, productVariant) =>
                count + productVariant.packagingHierarchy.length,
            0
        ),
        previousProduct.variant.filter(
            (productVariant) => productVariant.lowStockThreshold !== undefined
        ).length
    ]);

    if (structureChanged) {
        appendVariantStages(
            { statements, expectedRowsAffected },
            previousProduct,
            nextProduct,
            variantPositions,
            packagingPositions
        );
    }

    const activityInsert = appendActivity(
        { statements, expectedRowsAffected },
        event
    );
    await executePlan({
        statements,
        expectedRowsAffected,
        ...activityInsert
    }, dependencies);
}
