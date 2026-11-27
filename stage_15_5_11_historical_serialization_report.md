# Stage 15.5.11 — Historical Serialization Report

## Result

Added production serialization and parsing contracts for completed Sale item
snapshots, received Delivery item snapshots, and ActivityEvent records. The
Activity repository now uses the deep Activity parser. No database writer,
schema migration, ApplicationState integration, approval-rule change, UI
change, or application database access was added.

Implementation and focused tests:

- `src/persistence/historicalSerialization.ts`
- `src/persistence/historicalSerialization.test.ts`
- `src/persistence/repositories/activityRepository.ts`

## Completed Sale snapshot

`completeSale()` constructs one `CompletedSaleItem` for each sale line using
the product, variant, batch and packaging snapshots made during sale
preparation/approval. `serializeCompletedSaleItemSnapshot()` and
`parseCompletedSaleItemSnapshot()` use that existing type directly. The JSON
shape is:

- `lineId`
- `product`: `ActivityProductSnapshot`, including transaction-time product
  ID/name, optional descriptive fields, and variant snapshots
- `variant`: `ActivityVariantSnapshot`, including variant ID/name, optional
  registration/threshold values and packaging hierarchy snapshots
- `batch`: full `ActivityBatchSnapshot` or `null`, including batch/product/
  variant IDs and names, batch number, expiry, optional received date, and
  batch packaging prices/names
- `inventoryRecordId`
- `packagingLevel`: transaction-time packaging ID/name, prices and hierarchy
  relationship fields
- `quantity`
- `defaultSellingPrice` (nullable), `appliedSellingPrice`, `subtotal`,
  `discountAmount`, `finalAmount`, and `expiredBatch`

Money fields are validated as finite, non-negative values at cent precision.
The nullable default price and batch are retained as `null`; optional nested
snapshot fields remain optional. JSON serialization does not resolve any
historical identity or value from current catalog or inventory data.

Migration 001 stores the remaining sale header values relationally in `sales`
(completion timestamp, customer/address/date/staff/notes, subtotal/discount/
final amount and expired-batch confirmation) and line values in `sale_items`
(IDs, item position, inventory/product/variant/batch/packaging IDs, quantity,
prices, amounts and expired flag). The item JSON is the historical typed
snapshot. The domain does not contain `sourceDraftId` or `completedEventId`;
those remain relational associations, not fabricated snapshot fields.

The completed-sale model records one inventory record and one batch snapshot
per line. The sale Activity payload records one corresponding allocation per
line. Neither model records split/multiple inventory allocations for one
completed item; the codec does not invent them.

## Received Delivery snapshot

`prepareDeliveryApproval()` resolves the product, variant and packaging from
the draft, determines/creates the receipt batch, applies the item packaging
prices, updates stock, and creates a `delivery.received` Activity item with
transaction-time product/variant names, a batch snapshot, pricing and stock
packaging/quantity.

The new `ReceivedDeliveryItemSnapshot` is intentionally a separate type from
an Activity event item. Its current JSON contract is:

- `deliveryItemId`
- `productId`, `productName`, `variantId`, `variantName`
- `packagingLevel`: captured `ActivityPackagingSnapshot`
- `quantity`
- `batch`: captured `ActivityBatchSnapshot` or `null`
- `pricingAtReceipt`: packaging-level ID and nullable cost/selling prices

The delivery-item ID comes from the existing draft item; its product and
variant names, packaging snapshot, batch snapshot and prices are present in
receipt approval evidence. In contrast, the Activity event item has no
`deliveryItemId` and represents packaging and quantity as a `stock` array.
Those shapes are validated and serialized independently.

At the delivery level, Migration 001 stores `created_at`, `updated_at`,
`delivery_date`, `received_by`, nullable supplier/invoice values and
`received_event_id`. `receivedAt` exposed by the existing read model is an
alias of `updatedAt`, not an independently persisted timestamp. At item
level, the schema stores the item ID/order, product/variant/packaging IDs,
quantity, nullable batch number/expiry/prices, `received_batch_id`, and
`receipt_snapshot_json`. The received-batch association is preserved in that
relational column; the batch snapshot also has its own batch ID.

The approval logic does not record an inventory-record ID in the Delivery
item or its Activity item. It creates/updates inventory but does not return
that association as receipt history. This exact gap remains; no inventory
association is fabricated. Existing price and date nullable values and IDs
are preserved.

## ActivityEvent serialization

`serializeActivityEvent()` serializes the complete event object and supplies
the duplicate metadata values for `event_id`, `operation_key`, `event_type`,
`occurred_at`, and nullable `actor_id`. `parseActivityEvent()` validates the
full known nested structure and compares those values with the stored
relational metadata. Malformed JSON, missing/invalid nested fields, unknown
event types, invalid timestamps, and metadata mismatches fail explicitly.
The parser returns the complete parsed object without projecting fields away;
unknown additional JSON fields at any level are retained.

All 16 currently defined event variants are covered:

- Product: `product.created`, `product.updated`, `product.deleted`,
  `product.variant_added`, `product.variant_updated`,
  `product.variant_removed`, `product.packaging_added`,
  `product.packaging_updated`, `product.packaging_removed`
- Inventory: `inventory.batch_created`, `inventory.batch_updated`,
  `inventory.batch_removed`, `inventory.stock_adjusted`
- Delivery: `delivery.received`, `delivery.draft_cancelled`
- Sale: `sale.completed`

`getAllActivityEvents()` now delegates event decoding and metadata verification
to this parser. There is still no production SQLite writer: serializer output
defines the writer contract only and its tests do not claim a database write
path was implemented.

## Compatibility and versioning

Migration 001 has no snapshot-version column. No version field or migration is
necessary for the current additive-compatible contracts:

- Sale and Delivery JSON codecs validate required current fields while
  retaining unknown additional fields instead of stripping them.
- Existing Sales and received-Delivery readers still retain the original JSON
  text and expose the parsed value as `unknown`; they can continue preserving
  older opaque shapes and do not require these new typed codecs to accept
  historical legacy JSON.
- Activity events retain unknown additional fields, but an unknown event
  `type` is rejected. Migration 001 also constrains event types. A new event
  variant therefore requires an explicit application/schema compatibility
  change.

The current schema can preserve the known snapshots without a version field.
If a future change makes a required snapshot shape incompatible, it will need
an explicit versioning or migration strategy before a writer emits that shape.
No version was added speculatively.

## Opaque or unresolved information

- Historical Sale and Delivery snapshot JSON already stored by a future/other
  writer may not match the typed current contracts. Existing repositories
  intentionally preserve that JSON as opaque text/value; the new typed
  parsers do not reinterpret or rewrite old data automatically.
- No production writer currently proves that new records serialize using
  these contracts.
- A received Delivery item has a recorded received-batch association but no
  persisted inventory-record association.
- The domain `CompletedSale` does not model the relational source draft and
  completed-event IDs; the Delivery receipt domain has no separate completed
  history type. Those existing relational/read-model values stay outside the
  item snapshot codecs.
- No domain or schema changes are required to establish the scoped contracts.
  Adding a durable per-receipt inventory-record association, if later needed,
  would require a separately scoped model/schema change.

## Validation

See `stage_15_5_11_historical_serialization_test_results.md`. The tests use
isolated test data and Migration 001 in memory where exercising repositories.
No normal application database was accessed or modified.
