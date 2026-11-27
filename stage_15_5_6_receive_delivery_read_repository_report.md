# Stage 15.5.6 — Receive Delivery Read Repository

## Summary

Implemented `getAllReceivedDeliveries()` as a read-only query over `deliveries` and `delivery_items`. It returns only rows whose persisted lifecycle status is `received`, keeps item ordering and nullable values, and does not reconstruct historical details from current Product or Inventory tables.

## Files created

- `src/persistence/repositories/receiveDeliveryRepository.ts`
- `src/persistence/repositories/receiveDeliveryRepository.test.ts`
- `stage_15_5_6_receive_delivery_read_repository_report.md`

No existing files were modified for this stage. Existing unrelated and uncommitted changes were preserved.

## Schema and domain mapping

Migration 001 stores delivery headers in `deliveries` with `delivery_id`, `status`, `created_at`, `updated_at`, `delivery_date`, `received_by`, nullable supplier/invoice fields, and nullable `received_event_id`. Its persisted status constraint allows only `draft` and `received`; there is no persisted `cancelled` status.

Each `delivery_items` row stores a stable item ID and position, Product/Variant/packaging identifiers, quantity, nullable batch number/expiry/prices, `received_batch_id`, and nullable `receipt_snapshot_json`. The schema has no `received_at` column. The existing approval workflow sets the Delivery draft's `updatedAt` to its receipt timestamp; the repository exposes `updated_at` as both `updatedAt` and `receivedAt`, retaining the original timestamp string. The database trigger does not independently verify that timestamp semantics.

| Persisted field | Read-model mapping |
|---|---|
| `delivery_id` | `deliveryId` |
| `status` | Literal `status: "received"`; only received rows are queried |
| `created_at`, `updated_at` | `createdAt`, `updatedAt`; `updated_at` is also exposed as `receivedAt` per the approval workflow |
| `delivery_date`, `received_by` | `deliveryDate`, `receivedBy` |
| `supplier_name`, `invoice_number` | Nullable `supplierName`, `invoiceNumber`, retaining SQL `NULL` |
| `received_event_id` | `receivedEventId`; linked Activity content is not reconstructed or rewritten |
| Item ID/position, Product/Variant/packaging IDs, quantity | Corresponding `PersistedReceivedDeliveryItem` fields |
| `batch_number`, `expiry_date` | Nullable text values returned unchanged |
| `received_batch_id` | Required `receivedBatchId` |
| Cost/selling price minor units | Nullable decimal values after safe-integer and round-trip validation |
| `receipt_snapshot_json` | Parsed opaque `receiptSnapshot: unknown` and the exact `receiptSnapshotJson` text |

Deliveries are ordered newest first by `updated_at`, with `delivery_position` as a stable tie-breaker; items are ordered by `item_position`. Position values are retained for items.

## Lifecycle and integrity scope

The query filters explicitly on `delivery.status = 'received'`. Drafts are excluded. Cancellation is represented by inserting a `delivery.draft_cancelled` Activity event and deleting the draft row; Migration 001 has a trigger requiring that event before deletion. The test exercises this cancellation path and confirms the event remains while the delivery is absent from the result.

The received transition requires a non-empty `received_by`, a valid delivery date, a matching `delivery.received` Activity event, at least one item, and non-null `receipt_snapshot_json` and `received_batch_id` for every item. Received headers and items are immutable. The in-memory test fixtures receive deliveries through those migration constraints.

Although item insertion triggers validate Product, Variant, and packaging references when a draft item is added, delivery-item rows do not depend on live Product/Inventory joins for reading. The repository reads neither current catalog, inventory, nor batch rows. Historical names and details remain opaque inside the persisted snapshot JSON unless a future explicit snapshot contract is established.

## Snapshot contract

The schema only requires `receipt_snapshot_json` to be non-null at receipt time; it does not define a JSON shape or constrain it to valid JSON. No existing application writer serializes this column. The repository therefore does not assume that `DeliveryDraft` or `ActivityEvent` describes its contents. It parses valid JSON as `unknown`, preserves the original serialized text, and throws explicitly for malformed JSON instead of repairing or normalizing it.

## Money handling

Delivery item cost and selling price columns use integer-minor-unit names but have no SQLite type/range checks. The repository rejects non-safe-integer, negative, or non-round-trippable values; nullable prices remain `null`. Conversion follows the existing repository convention of 100 minor units per displayed unit. Migration 001 does not identify a currency.

## Test coverage and results

Tests use isolated `node:sqlite` in-memory databases, enable foreign keys, and execute the actual Migration 001 SQL. The existing query boundary is mocked only to execute the repository's fixed, code-defined SELECT against the isolated database.

Coverage includes:

- Empty results.
- Received deliveries with multiple items and stable item ordering.
- Received timestamp, delivery date, Received By, supplier/invoice, and nullable values.
- Packaging/product identifiers, quantities, prices, batch number, expiry, and received batch ID.
- Opaque historical snapshots whose names differ from the current catalog; assertion that the repository query does not join current Product/Inventory tables.
- Exclusion of unfinished drafts.
- Exclusion of cancelled drafts after the migration-required cancellation event and deletion.
- Rejection of malformed receipt JSON and fractional persisted minor-unit values.
- Successful receipt transition through the actual migration's lifecycle triggers.

Checks run:

| Command | Result |
|---|---|
| `npx vitest run src/persistence/repositories/receiveDeliveryRepository.test.ts` (initial malformed-JSON fixture) | Failed because the test attempted to update an item after receipt; Migration 001 correctly rejected the update as immutable. The fixture was corrected to insert malformed JSON before receipt. |
| `npx vitest run src/persistence/repositories/receiveDeliveryRepository.test.ts` (after fixture correction) | Passed: 1 file, 5 tests |
| `npx vitest run src/persistence/repositories/receiveDeliveryRepository.test.ts src/deliveries/deliveryDraft.test.ts src/deliveries/deliveryApproval.test.ts` | Passed: 3 files, 55 tests |
| `npx tsc -p tsconfig.app.json --pretty false` | Passed |
| `npx eslint src/persistence/repositories/receiveDeliveryRepository.ts src/persistence/repositories/receiveDeliveryRepository.test.ts` | Passed |
| `npm run build` | Passed; Vite reported a minified JavaScript chunk of 528.84 kB, above its 500 kB advisory threshold |

## Limitations and unresolved questions

- There is no established writer or serialization contract for `receipt_snapshot_json`. The repository preserves its content opaquely and cannot safely expose typed historical Product, Variant, packaging, or batch snapshot members yet.
- There is no dedicated `received_at` column. `receivedAt` is an alias of `updated_at` based on the existing approval workflow; the schema itself does not enforce that equality.
- `received_batch_id` is required by the receipt trigger but has no foreign key. It is returned as stored and is not checked against current batches.
- Money/currency interpretation and safe total validation remain requirements before future money-writing persistence; this read repository performs no calculations or writes.

## Scope confirmation

No UI, schema/migration SQL, Receive Delivery workflow, approval/cancellation logic, inventory mutation, transaction boundary, or normal application database was changed or used. Tests used only in-memory databases. The repository remains unintegrated, and work stops at Stage 15.5.6.
