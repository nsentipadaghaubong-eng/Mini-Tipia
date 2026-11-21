import type {
    ActivityBatchSnapshot,
    ActivityEvent,
    ActivityInventorySnapshot,
    ActivityPackagingSnapshot,
    ActivityProductSnapshot,
    ActivityVariantSnapshot
} from "./activity";

export const ACTIVITY_TIME_ZONE = "Africa/Lagos";

export interface ActivityDetailField {
    label: string;
    value: string;
}

export interface ActivityDetailSection {
    title: string;
    fields: ActivityDetailField[];
}

export interface ActivityPresentation {
    title: string;
    summary: string;
    actor?: string;
    details: ActivityDetailSection[];
}

export interface ActivityDateGroup {
    key: string;
    label: string;
    events: ActivityEvent[];
}

export const ACTIVITY_FILTER_OPTIONS = [
    { value: "all", label: "All activities" },
    { value: "product-created", label: "Product created" },
    { value: "product-edited", label: "Product edited" },
    { value: "product-deleted", label: "Product deleted" },
    { value: "received-delivery", label: "Received delivery" },
    { value: "sales", label: "Sales" },
    { value: "inventory-adjusted", label: "Inventory adjusted" }
] as const;

export type ActivityFilterValue = (typeof ACTIVITY_FILTER_OPTIONS)[number]["value"];

type EventType = ActivityEvent["type"];
type EventOfType<Type extends EventType> = Extract<ActivityEvent, { type: Type }>;
type PresentationFactory<Type extends EventType> =
    (event: EventOfType<Type>) => ActivityPresentation;

function cleanText(value: string | null | undefined): string | undefined {
    if (typeof value !== "string") {
        return undefined;
    }
    const text = value.trim();
    return text === "" ? undefined : text;
}

function formatQuantity(value: number | null | undefined): string | undefined {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return undefined;
    }
    return new Intl.NumberFormat("en-NG", {
        maximumFractionDigits: 20
    }).format(value);
}

function formatMoney(value: number | null | undefined): string | undefined {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return undefined;
    }
    return new Intl.NumberFormat("en-NG", {
        style: "currency",
        currency: "NGN",
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    }).format(value);
}

function formatBusinessDate(value: string | null | undefined): string | undefined {
    const text = cleanText(value);
    if (!text) {
        return undefined;
    }

    let date: Date;
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (dateOnly) {
        const [, yearText, monthText, dayText] = dateOnly;
        const year = Number(yearText);
        const month = Number(monthText);
        const day = Number(dayText);
        date = new Date(Date.UTC(year, month - 1, day, 12));
        if (
            date.getUTCFullYear() !== year ||
            date.getUTCMonth() !== month - 1 ||
            date.getUTCDate() !== day
        ) {
            return undefined;
        }
    } else {
        const timestamp = Date.parse(text);
        if (!Number.isFinite(timestamp)) {
            return undefined;
        }
        date = new Date(timestamp);
    }

    return new Intl.DateTimeFormat("en-NG", {
        timeZone: ACTIVITY_TIME_ZONE,
        day: "numeric",
        month: "short",
        year: "numeric"
    }).format(date);
}

function field(
    label: string,
    value: string | undefined
): ActivityDetailField | undefined {
    return value === undefined ? undefined : { label, value };
}

function textField(
    label: string,
    value: string | null | undefined
): ActivityDetailField | undefined {
    return field(label, cleanText(value));
}

function quantityField(
    label: string,
    value: number | null | undefined
): ActivityDetailField | undefined {
    return field(label, formatQuantity(value));
}

function moneyField(
    label: string,
    value: number | null | undefined
): ActivityDetailField | undefined {
    return field(label, formatMoney(value));
}

function dateField(
    label: string,
    value: string | null | undefined
): ActivityDetailField | undefined {
    return field(label, formatBusinessDate(value));
}

function section(
    title: string,
    ...fields: (ActivityDetailField | undefined)[]
): ActivityDetailSection | undefined {
    const recordedFields = fields.filter(
        (value): value is ActivityDetailField => value !== undefined
    );
    return recordedFields.length === 0
        ? undefined
        : { title, fields: recordedFields };
}

function sections(
    ...values: (ActivityDetailSection | undefined)[]
): ActivityDetailSection[] {
    return values.filter(
        (value): value is ActivityDetailSection => value !== undefined
    );
}

function appendSection(
    target: ActivityDetailSection[],
    value: ActivityDetailSection | undefined
): void {
    if (value) {
        target.push(value);
    }
}

function joinSummary(...values: (string | undefined)[]): string {
    return values.filter((value): value is string => value !== undefined)
        .join(" · ");
}

function changeField(
    label: string,
    before: string | number | null | undefined,
    after: string | number | null | undefined,
    format: (value: string | number) => string | undefined = (value) =>
        typeof value === "number" ? formatQuantity(value) : cleanText(value)
): ActivityDetailField | undefined {
    if (before === after) {
        return undefined;
    }
    const beforeText = before === null || before === undefined
        ? undefined
        : format(before);
    const afterText = after === null || after === undefined
        ? undefined
        : format(after);
    if (!beforeText && !afterText) {
        return undefined;
    }
    if (!beforeText) {
        return field(label, `Added: ${afterText}`);
    }
    if (!afterText) {
        return field(label, `Removed: ${beforeText}`);
    }
    return field(label, `${beforeText} → ${afterText}`);
}

function changeMoneyField(
    label: string,
    before: number | null,
    after: number | null
): ActivityDetailField | undefined {
    return changeField(label, before, after, (value) =>
        typeof value === "number" ? formatMoney(value) : undefined
    );
}

function changeDateField(
    label: string,
    before: string | null,
    after: string | null
): ActivityDetailField | undefined {
    return changeField(label, before, after, (value) =>
        typeof value === "string" ? formatBusinessDate(value) : undefined
    );
}

function packagingFields(
    packaging: ActivityPackagingSnapshot
): (ActivityDetailField | undefined)[] {
    const nextLevelName = cleanText(packaging.nextLevelName);
    const nextLevelQuantity = formatQuantity(packaging.quantityOfNextLevel);
    return [
        textField("Packaging", packaging.name),
        moneyField("Selling price", packaging.sellingPrice),
        nextLevelName && nextLevelQuantity
            ? field("Conversion", `${nextLevelQuantity} ${nextLevelName}`)
            : quantityField("Units per next level", packaging.quantityOfNextLevel)
    ];
}

function variantSections(
    variant: ActivityVariantSnapshot,
    titlePrefix = "Variant"
): ActivityDetailSection[] {
    const variantSection = section(
        `${titlePrefix}: ${cleanText(variant.variantName) ?? "Variant details"}`,
        textField("Variant", variant.variantName),
        textField("Registration number", variant.nafdacRegistrationNumber)
    );
    return sections(
        variantSection,
        ...variant.packaging.map((packaging) =>
            section(
                `Packaging: ${cleanText(packaging.name) ?? "Packaging details"}`,
                ...packagingFields(packaging)
            )
        )
    );
}

function packagingChangeSection(
    before: ActivityPackagingSnapshot | undefined,
    after: ActivityPackagingSnapshot | undefined
): ActivityDetailSection | undefined {
    const packaging = after ?? before;
    if (!packaging) {
        return undefined;
    }
    if (!before) {
        return section(
            `Packaging added: ${cleanText(packaging.name) ?? "Packaging"}`,
            ...packagingFields(packaging)
        );
    }
    if (!after) {
        return section(
            `Packaging removed: ${cleanText(packaging.name) ?? "Packaging"}`,
            textField("Packaging", packaging.name)
        );
    }
    return section(
        `Packaging: ${cleanText(after.name) ?? "Packaging details"}`,
        changeField("Name", before.name, after.name),
        changeMoneyField("Cost price", before.costPrice, after.costPrice),
        changeMoneyField("Selling price", before.sellingPrice, after.sellingPrice),
        changeField(
            "Units per next level",
            before.quantityOfNextLevel,
            after.quantityOfNextLevel
        ),
        changeField(
            "Next packaging level",
            before.nextLevelName,
            after.nextLevelName
        )
    );
}

function inventorySections(
    inventories: readonly ActivityInventorySnapshot[],
    additionalBatches: readonly ActivityBatchSnapshot[] = []
): ActivityDetailSection[] {
    const representedBatchIds = new Set(
        inventories.flatMap((inventory) =>
            inventory.batch ? [inventory.batch.batchId] : []
        )
    );
    const stockSections = inventories.map((inventory) => {
        const batchNumber = cleanText(inventory.batch?.batchNumber);
        const title = joinSummary(
            "Stock",
            cleanText(inventory.variantName),
            batchNumber ? `Batch ${batchNumber}` : undefined
        );
        return section(
            title,
            textField("Batch", batchNumber),
            dateField("Expiry date", inventory.batch?.expiryDate),
            ...inventory.stock.map((stock) => {
                const packagingName = cleanText(stock.packagingLevel.name);
                return quantityField(
                    packagingName ? `${packagingName} quantity` : "Quantity",
                    stock.quantity
                );
            })
        );
    });

    const unrepresentedBatchSections = additionalBatches
        .filter((batch) => !representedBatchIds.has(batch.batchId))
        .map((batch) => batchSection(batch, "Batch"));

    return sections(...stockSections, ...unrepresentedBatchSections);
}

function batchSection(
    batch: ActivityBatchSnapshot,
    title: string
): ActivityDetailSection | undefined {
    return section(
        `${title}${cleanText(batch.batchNumber) ? `: ${cleanText(batch.batchNumber)}` : ""}`,
        textField("Product", batch.productName),
        textField("Variant", batch.variantName),
        textField("Batch number", batch.batchNumber),
        dateField("Expiry date", batch.expiryDate),
        dateField("Received date", batch.receivedDate)
    );
}

function stockSummary(
    stock: readonly {
        packagingLevel: ActivityPackagingSnapshot;
        quantity: number;
    }[]
): string | undefined {
    const first = stock[0];
    if (!first) {
        return undefined;
    }
    const quantity = formatQuantity(first.quantity);
    const packagingName = cleanText(first.packagingLevel.name);
    return joinSummary(
        quantity && packagingName ? `${quantity} ${packagingName}` : undefined,
        stock.length > 1 ? `+${stock.length - 1} more stock lines` : undefined
    );
}

function changeProductDetails(
    before: ActivityProductSnapshot,
    after: ActivityProductSnapshot
): ActivityDetailSection[] {
    const result: ActivityDetailSection[] = [];
    const productChanges = section(
        "Product details",
        changeField("Name", before.productName, after.productName),
        changeField("Description", before.description, after.description),
        changeField("Generic name", before.genericName, after.genericName),
        changeField("Manufacturer", before.manufacturer, after.manufacturer),
        changeField("Category", before.category, after.category)
    );
    if (productChanges) {
        result.push(productChanges);
    }

    const beforeVariants = new Map(
        before.variants.map((variant) => [variant.variantId, variant])
    );
    const afterVariants = new Map(
        after.variants.map((variant) => [variant.variantId, variant])
    );

    for (const variant of after.variants) {
        const previous = beforeVariants.get(variant.variantId);
        if (!previous) {
            result.push(...variantSections(variant, "Variant added"));
            continue;
        }

        const variantChanges = section(
            `Variant: ${cleanText(variant.variantName) ?? "Variant details"}`,
            changeField("Name", previous.variantName, variant.variantName),
            changeField(
                "Registration number",
                previous.nafdacRegistrationNumber,
                variant.nafdacRegistrationNumber
            )
        );
        if (variantChanges) {
            result.push(variantChanges);
        }

        const previousPackaging = new Map(
            previous.packaging.map((packaging) => [
                packaging.packagingLevelId,
                packaging
            ])
        );
        const currentPackaging = new Map(
            variant.packaging.map((packaging) => [
                packaging.packagingLevelId,
                packaging
            ])
        );
        for (const packaging of variant.packaging) {
            const priorPackaging = previousPackaging.get(
                packaging.packagingLevelId
            );
            const packagingChanges = packagingChangeSection(
                priorPackaging,
                packaging
            );
            if (packagingChanges) {
                result.push(packagingChanges);
            }
        }
        for (const packaging of previous.packaging) {
            if (!currentPackaging.has(packaging.packagingLevelId)) {
                appendSection(
                    result,
                    packagingChangeSection(packaging, undefined)
                );
            }
        }
    }

    for (const variant of before.variants) {
        if (!afterVariants.has(variant.variantId)) {
            result.push(...variantSections(variant, "Variant removed"));
        }
    }

    return result;
}

function firstChangeLabel(details: readonly ActivityDetailSection[]): string | undefined {
    const first = details[0];
    const firstField = first?.fields[0];
    if (firstField) {
        return [
            "Product details",
            "Variant details",
            "Packaging changes"
        ].includes(first.title)
            ? `${firstField.label.toLowerCase()} changed`
            : first.title.toLowerCase();
    }
    return undefined;
}

function updateFields(
    before: ActivityVariantSnapshot,
    after: ActivityVariantSnapshot
): ActivityDetailSection[] {
    const result = sections(section(
        "Variant details",
        changeField("Name", before.variantName, after.variantName),
        changeField(
            "Registration number",
            before.nafdacRegistrationNumber,
            after.nafdacRegistrationNumber
        )
    ));
    const beforePackaging = new Map(
        before.packaging.map((packaging) => [
            packaging.packagingLevelId,
            packaging
        ])
    );
    const afterPackaging = new Map(
        after.packaging.map((packaging) => [
            packaging.packagingLevelId,
            packaging
        ])
    );
    for (const packaging of after.packaging) {
        const previous = beforePackaging.get(packaging.packagingLevelId);
        appendSection(
            result,
            packagingChangeSection(previous, packaging)
        );
    }
    for (const packaging of before.packaging) {
        if (!afterPackaging.has(packaging.packagingLevelId)) {
            appendSection(
                result,
                packagingChangeSection(packaging, undefined)
            );
        }
    }
    return result;
}

function affectedInventorySummary(
    inventories: readonly ActivityInventorySnapshot[]
): string | undefined {
    return inventories.length > 0
        ? `${formatQuantity(inventories.length)} stock records affected`
        : undefined;
}

function removedStockQuantity(
    stock: readonly { quantity: number }[]
): number | undefined {
    return stock.length === 0
        ? undefined
        : stock.reduce((total, item) => total + item.quantity, 0);
}

const presentations: {
    [Type in EventType]: PresentationFactory<Type>;
} = {
    "product.created": (event) => ({
        title: "Product created",
        summary: joinSummary(
            cleanText(event.product.productName),
            cleanText(event.product.category),
            event.initialInventory[0] &&
                stockSummary(event.initialInventory[0].stock)
                ? `Initial stock: ${stockSummary(event.initialInventory[0].stock)}`
                : undefined,
            event.initialInventory.length > 1
                ? `+${event.initialInventory.length - 1} more stock entries`
                : undefined
        ),
        details: sections(
            section(
                "Product details",
                textField("Description", event.product.description),
                textField("Generic name", event.product.genericName),
                textField("Manufacturer", event.product.manufacturer),
                textField("Category", event.product.category)
            ),
            ...event.product.variants.flatMap((variant) =>
                variantSections(variant)
            ),
            ...inventorySections(event.initialInventory)
        )
    }),
    "product.updated": (event) => {
        const details = changeProductDetails(event.before, event.after);
        const reason = section("Reason", textField("Reason", event.reason));
        return {
            title: "Product updated",
            summary: joinSummary(
                cleanText(event.after.productName),
                firstChangeLabel(details)
            ),
            details: sections(...details, reason)
        };
    },
    "product.deleted": (event) => ({
        title: "Product deleted",
        summary: joinSummary(
            cleanText(event.productName),
            `${formatQuantity(event.product.variants.length)} variants removed`,
            event.batches.length > 0
                ? `${formatQuantity(event.batches.length)} batches affected`
                : undefined
        ),
        details: sections(
            section("Reason", textField("Reason", event.reason)),
            section(
                "Product details",
                textField("Description", event.product.description),
                textField("Category", event.product.category),
                ...event.product.variants.map((variant, index) =>
                    textField(`Variant ${index + 1}`, variant.variantName)
                )
            ),
            ...inventorySections(event.inventory, event.batches)
        )
    }),
    "product.variant_added": (event) => ({
        title: "Variant added",
        summary: joinSummary(
            cleanText(event.productName),
            cleanText(event.variant.variantName)
        ),
        details: sections(
            ...variantSections(event.variant),
            section("Reason", textField("Reason", event.reason))
        )
    }),
    "product.variant_updated": (event) => {
        const details = updateFields(event.before, event.after);
        return {
            title: "Variant updated",
            summary: joinSummary(
                cleanText(event.productName),
                cleanText(event.after.variantName),
                firstChangeLabel(details)
            ),
            details: sections(
                ...details,
                section("Reason", textField("Reason", event.reason))
            )
        };
    },
    "product.variant_removed": (event) => ({
        title: "Variant removed",
        summary: joinSummary(
            cleanText(event.productName),
            cleanText(event.removedVariant.variantName),
            affectedInventorySummary(event.affectedInventory)
        ),
        details: sections(
            ...variantSections(event.removedVariant, "Removed variant"),
            ...inventorySections(
                event.affectedInventory,
                event.removedBatches
            ),
            section("Reason", textField("Reason", event.reason))
        )
    }),
    "product.packaging_added": (event) => ({
        title: "Packaging added",
        summary: joinSummary(
            cleanText(event.productName),
            cleanText(event.variantName),
            cleanText(event.packaging.name)
        ),
        details: sections(
            section(
                "Packaging details",
                ...packagingFields(event.packaging)
            ),
            section("Reason", textField("Reason", event.reason))
        )
    }),
    "product.packaging_updated": (event) => {
        const details = section(
            "Packaging changes",
            changeField("Name", event.before.name, event.after.name),
            changeMoneyField(
                "Cost price",
                event.before.costPrice,
                event.after.costPrice
            ),
            changeMoneyField(
                "Selling price",
                event.before.sellingPrice,
                event.after.sellingPrice
            ),
            changeField(
                "Units per next level",
                event.before.quantityOfNextLevel,
                event.after.quantityOfNextLevel
            ),
            changeField(
                "Next packaging level",
                event.before.nextLevelName,
                event.after.nextLevelName
            )
        );
        return {
            title: "Packaging updated",
            summary: joinSummary(
                cleanText(event.productName),
                cleanText(event.variantName),
                cleanText(event.after.name),
                firstChangeLabel(details ? [details] : [])
            ),
            details: sections(
                section(
                    `Packaging: ${cleanText(event.after.name) ?? "Packaging details"}`,
                    ...(details?.fields ?? [])
                ),
                section("Reason", textField("Reason", event.reason))
            )
        };
    },
    "product.packaging_removed": (event) => {
        const quantity = removedStockQuantity(event.removedStock);
        const packagingName = cleanText(event.removedPackaging.name);
        return {
            title: "Packaging removed",
            summary: joinSummary(
                cleanText(event.productName),
                cleanText(event.variantName),
                packagingName,
                quantity === undefined || !packagingName
                    ? undefined
                    : `${formatQuantity(quantity)} ${packagingName} affected`
            ),
            details: sections(
                section(
                    "Removed packaging",
                    ...packagingFields(event.removedPackaging)
                ),
                ...event.removedStock.map((stock) => section(
                    joinSummary(
                        "Affected stock",
                        cleanText(stock.batch?.batchNumber)
                            ? `Batch ${cleanText(stock.batch?.batchNumber)}`
                            : undefined
                    ) || "Affected stock",
                    textField("Batch", stock.batch?.batchNumber),
                    dateField("Expiry date", stock.batch?.expiryDate),
                    quantityField(
                        `${cleanText(event.removedPackaging.name) ?? "Packaging"} quantity`,
                        stock.quantity
                    )
                )),
                section("Reason", textField("Reason", event.reason))
            )
        };
    },
    "inventory.batch_created": (event) => ({
        title: "Inventory batch created",
        summary: joinSummary(
            cleanText(event.batch.productName),
            cleanText(event.batch.variantName),
            cleanText(event.batch.batchNumber)
                ? `Batch ${cleanText(event.batch.batchNumber)}`
                : undefined,
            formatBusinessDate(event.batch.expiryDate),
            event.inventory ? stockSummary(event.inventory.stock) : undefined
        ),
        details: sections(
            batchSection(event.batch, "Batch"),
            ...(event.inventory
                ? inventorySections([event.inventory])
                : [])
        )
    }),
    "inventory.batch_updated": (event) => {
        const batchNumberChange = changeField(
            "Batch number",
            event.before.batchNumber,
            event.after.batchNumber
        );
        const expiryChange = changeDateField(
            "Expiry date",
            event.before.expiryDate,
            event.after.expiryDate
        );
        const beforePricing = new Map(
            event.before.pricingByPackagingLevel.map((entry) => [
                entry.packagingLevelId,
                entry
            ])
        );
        const afterPricing = new Map(
            event.after.pricingByPackagingLevel.map((entry) => [
                entry.packagingLevelId,
                entry
            ])
        );
        const pricingChanges = [...new Set([
            ...beforePricing.keys(),
            ...afterPricing.keys()
        ])].flatMap((packagingLevelId) => {
            const before = beforePricing.get(packagingLevelId);
            const after = afterPricing.get(packagingLevelId);
            if (
                before?.costPrice === after?.costPrice &&
                before?.sellingPrice === after?.sellingPrice &&
                Boolean(before) === Boolean(after)
            ) {
                return [];
            }
            const summary = (pricing: typeof before) => pricing
                ? `Cost ${formatMoney(pricing.costPrice) ?? "Empty"}; Selling ${
                    formatMoney(pricing.sellingPrice) ?? "Empty"
                }`
                : "Not recorded";
            const packagingLevelName =
                after?.packagingLevelName ?? before?.packagingLevelName;
            return [field(
                packagingLevelName
                    ? `${packagingLevelName} pricing`
                    : "Packaging-level pricing",
                `${summary(before)} → ${summary(after)}`
            )];
        });
        const changes = section(
            "Batch changes",
            batchNumberChange,
            expiryChange,
            ...pricingChanges
        );
        const firstChange = changes?.fields[0];
        return {
            title: "Inventory batch updated",
            summary: joinSummary(
                cleanText(event.after.productName),
                cleanText(event.after.variantName),
                cleanText(event.after.batchNumber)
                    ? `Batch ${cleanText(event.after.batchNumber)}`
                    : undefined,
                firstChange
                    ? `${firstChange.label}: ${firstChange.value}`
                    : undefined
            ),
            details: sections(
                section(
                    "Batch details",
                    textField("Batch number", event.after.batchNumber),
                    dateField("Expiry date", event.after.expiryDate),
                    dateField("Received date", event.after.receivedDate),
                    ...event.after.pricingByPackagingLevel.flatMap((pricing) => [
                        moneyField(
                            `${pricing.packagingLevelName} cost price`,
                            pricing.costPrice
                        ),
                        moneyField(
                            `${pricing.packagingLevelName} selling price`,
                            pricing.sellingPrice
                        )
                    ])
                ),
                changes,
                section("Reason", textField("Reason", event.reason))
            )
        };
    },
    "inventory.batch_removed": (event) => ({
        title: "Inventory batch removed",
        summary: joinSummary(
            cleanText(event.removedBatch.productName),
            cleanText(event.removedBatch.variantName),
            cleanText(event.removedBatch.batchNumber)
                ? `Batch ${cleanText(event.removedBatch.batchNumber)}`
                : undefined,
            affectedInventorySummary(event.affectedInventory)
        ),
        details: sections(
            batchSection(event.removedBatch, "Removed batch"),
            ...inventorySections(event.affectedInventory),
            section("Reason", textField("Reason", event.reason))
        )
    }),
    "inventory.stock_adjusted": (event) => {
        const packagingName = cleanText(event.packagingLevel.name);
        const previous = formatQuantity(event.previousQuantity);
        const next = formatQuantity(event.newQuantity);
        const difference = formatQuantity(Math.abs(event.quantityDifference));
        const signedDifference = difference
            ? `${event.quantityDifference > 0 ? "+" : event.quantityDifference < 0 ? "−" : ""}${difference}`
            : undefined;
        const transition = previous && next && packagingName
            ? `${previous} ${packagingName} → ${next} ${packagingName}${
                signedDifference ? ` (${signedDifference})` : ""
            }`
            : undefined;
        return {
            title: "Stock adjusted",
            summary: joinSummary(
                cleanText(event.productName),
                cleanText(event.variantName),
                transition
            ),
            details: sections(
                section(
                    "Stock adjustment",
                    textField("Packaging", event.packagingLevel.name),
                    quantityField("Previous quantity", event.previousQuantity),
                    quantityField("New quantity", event.newQuantity),
                    quantityField("Difference", event.quantityDifference),
                    textField("Reason", event.reason),
                    textField("Batch", event.batch?.batchNumber),
                    dateField("Batch expiry", event.batch?.expiryDate)
                )
            )
        };
    },
    "delivery.received": (event) => {
        const itemSummaries = event.items.map((item) => {
            const stock = stockSummary(item.stock);
            return joinSummary(
                cleanText(item.productName),
                cleanText(item.variantName),
                stock
            );
        }).filter((value) => value !== "");
        const itemSummary = itemSummaries.length === 1
            ? itemSummaries[0]
            : itemSummaries.length > 1
                ? `${itemSummaries[0]} +${itemSummaries.length - 1} more lines`
                : undefined;
        const receiver = cleanText(event.receivedBy);
        return {
            title: "Delivery received",
            summary: joinSummary(
                formatBusinessDate(event.deliveryDate),
                cleanText(event.supplierName),
                itemSummary
            ),
            actor: receiver ? `Received by: ${receiver}` : undefined,
            details: sections(
                section(
                    "Receipt details",
                    dateField("Delivery date", event.deliveryDate),
                    textField("Receiver", event.receivedBy),
                    textField("Supplier", event.supplierName),
                    textField("Invoice", event.invoiceNumber)
                ),
                ...event.items.map((item, index) => section(
                    joinSummary(
                        `Item ${index + 1}`,
                        cleanText(item.productName),
                        cleanText(item.variantName)
                    ),
                    ...item.stock.flatMap((stock) => [
                        textField("Packaging", stock.packagingLevel.name),
                        quantityField("Quantity received", stock.quantity)
                    ]),
                    textField("Batch", item.batch?.batchNumber),
                    dateField("Expiry date", item.batch?.expiryDate),
                    dateField("Received date", item.batch?.receivedDate),
                    field(
                        "Cost price received",
                        formatMoney(item.pricingAtReceipt.costPrice) ?? "Empty"
                    ),
                    field(
                        "Selling price received",
                        formatMoney(item.pricingAtReceipt.sellingPrice) ?? "Empty"
                    )
                ))
            )
        };
    },
    "sale.completed": (event) => {
        const staffName = cleanText(event.staffMember?.displayName);
        const finalAmount = formatMoney(event.finalAmount);
        return {
            title: "Sale completed",
            summary: joinSummary(
                finalAmount ? `Final amount ${finalAmount}` : undefined,
                cleanText(event.customerName)
            ),
            actor: staffName ? `Staff: ${staffName}` : undefined,
            details: sections(
                section(
                    "Sale details",
                    dateField("Sale date", event.saleDate),
                    textField("Customer", event.customerName),
                    textField("Staff member", staffName),
                    moneyField("Subtotal", event.subtotal),
                    moneyField("Total discount", event.discountAmount),
                    moneyField("Final amount", event.finalAmount),
                    event.expiredBatchConfirmed
                        ? field("Expired batch", "Sale confirmation recorded")
                        : undefined
                ),
                ...event.items.map((item, index) => section(
                    joinSummary(
                        `Item ${index + 1}`,
                        cleanText(item.productName),
                        cleanText(item.variantName)
                    ),
                    textField("Product", item.productName),
                    textField("Variant", item.variantName),
                    textField("Packaging", item.packagingLevel.name),
                    quantityField("Quantity sold", item.quantity),
                    moneyField("Unit selling price", item.appliedSellingPrice),
                    moneyField("Line subtotal", item.subtotal),
                    moneyField("Line discount", item.discountAmount),
                    moneyField("Line total", item.finalAmount)
                ))
            )
        };
    }
};

export function getActivityPresentation(
    event: ActivityEvent
): ActivityPresentation {
    return createEventPresentation(event);
}

export function getActivitySearchText(event: ActivityEvent): string {
    const presentation = getActivityPresentation(event);
    const detailText = presentation.details
        .flatMap((section) => [
            section.title,
            ...section.fields.flatMap((field) => [field.label, field.value])
        ])
        .join(" ");
    return [
        presentation.title,
        presentation.summary,
        presentation.actor,
        detailText
    ]
        .filter((value): value is string => value !== undefined)
        .join(" ")
        .toLowerCase();
}

function matchesActivityType(
    event: ActivityEvent,
    selectedFilter: ActivityFilterValue
): boolean {
    switch (selectedFilter) {
        case "all":
            return true;
        case "product-created":
            return event.type === "product.created";
        case "product-edited":
            return [
                "product.updated",
                "product.variant_added",
                "product.variant_updated",
                "product.variant_removed",
                "product.packaging_added",
                "product.packaging_updated",
                "product.packaging_removed"
            ].includes(event.type);
        case "product-deleted":
            return event.type === "product.deleted";
        case "received-delivery":
            return event.type === "delivery.received";
        case "sales":
            return event.type === "sale.completed";
        case "inventory-adjusted":
            return [
                "inventory.batch_created",
                "inventory.batch_updated",
                "inventory.batch_removed",
                "inventory.stock_adjusted"
            ].includes(event.type);
    }
}

export function filterActivityEvents(
    events: readonly ActivityEvent[],
    selectedFilter: ActivityFilterValue = "all",
    query = ""
): ActivityEvent[] {
    const normalizedQuery = query.trim().toLowerCase();
    return events.filter((event) => {
        if (!matchesActivityType(event, selectedFilter)) {
            return false;
        }
        if (normalizedQuery === "") {
            return true;
        }
        return getActivitySearchText(event).includes(normalizedQuery);
    });
}

function createEventPresentation(event: ActivityEvent): ActivityPresentation {
    switch (event.type) {
        case "product.created":
            return presentations[event.type](event);
        case "product.updated":
            return presentations[event.type](event);
        case "product.deleted":
            return presentations[event.type](event);
        case "product.variant_added":
            return presentations[event.type](event);
        case "product.variant_updated":
            return presentations[event.type](event);
        case "product.variant_removed":
            return presentations[event.type](event);
        case "product.packaging_added":
            return presentations[event.type](event);
        case "product.packaging_updated":
            return presentations[event.type](event);
        case "product.packaging_removed":
            return presentations[event.type](event);
        case "inventory.batch_created":
            return presentations[event.type](event);
        case "inventory.batch_updated":
            return presentations[event.type](event);
        case "inventory.batch_removed":
            return presentations[event.type](event);
        case "inventory.stock_adjusted":
            return presentations[event.type](event);
        case "delivery.received":
            return presentations[event.type](event);
        case "sale.completed":
            return presentations[event.type](event);
    }
}

function getLagosDateKey(date: Date): string {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: ACTIVITY_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(date);
    const values = Object.fromEntries(
        parts.map((part) => [part.type, part.value])
    );
    return `${values.year}-${values.month}-${values.day}`;
}

function validTimestamp(event: ActivityEvent): number | null {
    const timestamp = Date.parse(event.occurredAt);
    return Number.isFinite(timestamp) ? timestamp : null;
}

export function sortActivityEvents(
    events: readonly ActivityEvent[]
): ActivityEvent[] {
    return events
        .map((event, index) => ({ event, index, timestamp: validTimestamp(event) }))
        .sort((left, right) => {
            if (left.timestamp === null && right.timestamp !== null) {
                return 1;
            }
            if (left.timestamp !== null && right.timestamp === null) {
                return -1;
            }
            if (left.timestamp !== null && right.timestamp !== null) {
                return right.timestamp - left.timestamp || left.index - right.index;
            }
            return left.index - right.index;
        })
        .map(({ event }) => event);
}

function getDateGroupLabel(dateKey: string, today: string): string {
    const date = Date.parse(`${dateKey}T00:00:00.000Z`);
    const todayDate = Date.parse(`${today}T00:00:00.000Z`);
    const daysAgo = (todayDate - date) / 86_400_000;
    if (daysAgo === 0) {
        return "Today";
    }
    if (daysAgo === 1) {
        return "Yesterday";
    }
    return new Intl.DateTimeFormat("en-NG", {
        timeZone: ACTIVITY_TIME_ZONE,
        day: "numeric",
        month: "long",
        year: "numeric"
    }).format(new Date(`${dateKey}T12:00:00.000Z`));
}

export function groupActivityEvents(
    events: readonly ActivityEvent[],
    now: Date = new Date()
): ActivityDateGroup[] {
    const today = getLagosDateKey(now);
    const groups = new Map<string, ActivityDateGroup>();

    for (const event of sortActivityEvents(events)) {
        const timestamp = validTimestamp(event);
        const key = timestamp === null
            ? "unavailable"
            : getLagosDateKey(new Date(timestamp));
        let group = groups.get(key);
        if (!group) {
            group = {
                key,
                label: key === "unavailable"
                    ? "Date unavailable"
                    : getDateGroupLabel(key, today),
                events: []
            };
            groups.set(key, group);
        }
        group.events.push(event);
    }

    return [...groups.values()];
}

export function formatActivityTime(occurredAt: string): string {
    const timestamp = Date.parse(occurredAt);
    return Number.isFinite(timestamp)
        ? new Intl.DateTimeFormat("en-NG", {
            timeZone: ACTIVITY_TIME_ZONE,
            hour: "numeric",
            minute: "2-digit"
        }).format(new Date(timestamp))
        : "Time unavailable";
}
