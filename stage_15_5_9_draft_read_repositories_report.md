# Stage 15.5.9 — Draft Read Repositories Report

## Outcome

Implemented read-only persistence-facing repositories for active Sales and
Receive Delivery drafts. Both repositories use the existing parameterized
`querySqlite` read boundary and select directly from Migration 001 tables. They
do not join current Product or Inventory tables, mutate SQLite, reserve stock,
or reconstruct draft data.

## Files created

- `src/persistence/repositories/salesDraftRepository.ts`
- `src/persistence/repositories/salesDraftRepository.test.ts`
- `src/persistence/repositories/receiveDeliveryDraftRepository.ts`
- `src/persistence/repositories/receiveDeliveryDraftRepository.test.ts`
- `stage_15_5_9_draft_read_repositories_report.md`
- `stage_15_5_9_draft_read_repositories_test_results.md`

No existing source file was modified. In particular, ApplicationState, App,
startup, workflows, domain types, UI, Migration 001, and schema were unchanged.

## Lifecycle scope

### Sales

Migration 001 permits `sale_drafts.status` values `draft`, `cancelled`, and
`approved`. `approved_sale_id` must be NULL for a draft or cancelled row and
non-NULL for an approved row. `getAllActiveSaleDrafts()` uses the parameterized
filter `draft.status = $1` with `"draft"`; it does not include cancelled or
approved drafts. A LEFT JOIN preserves valid empty drafts and items are ordered
by `item_position` within `draft_position`.

The returned read model preserves draft identifiers and status, creation/update
timestamps, nullable customer and staff fields, nullable sale date, notes,
approved-sale association, item identifiers and positions, Product/Variant/
Inventory/Batch/packaging identifiers, quantities, and raw integer minor-unit
prices/discounts. No historical Sale snapshot is present in `sale_draft_items`.

### Receive Delivery

Migration 001 allows `deliveries.status` values `draft` and `received`;
cancellation is represented by a `delivery.draft_cancelled` Activity event and
deletion of the draft, not by a persisted cancelled status. The
`getAllActiveDeliveryDrafts()` query filters `delivery.status = $1` with
`"draft"`. It therefore excludes received records, while cancelled deliveries
are absent after the schema-required deletion. A LEFT JOIN preserves empty
drafts; items are ordered by `item_position` within `delivery_position`.

The returned read model preserves identifiers, lifecycle status, timestamps,
nullable delivery date/recipient/supplier/invoice/event link, item ordering,
Product/Variant/packaging identifiers, quantity, nullable batch/expiry/prices,
received-batch association, and `receipt_snapshot_json` as its exact raw string
or SQL NULL. Snapshot JSON is not parsed or normalized; malformed JSON remains
opaque data.

## Persistence DTOs and domain compatibility

Both repositories expose persistence-facing DTOs rather than coercing rows into
workflow types.

| Persisted field | Read-model representation | Existing domain compatibility |
|---|---|---|
| Sales nullable header values | `string \| null` | `SaleDraft` uses optional strings; a future adapter must decide how to preserve NULL versus absent values. |
| Sales staff user/display fields | Separate nullable strings | `SaleDraft` uses an optional nested `staffMember`; conversion belongs in an explicit adapter. |
| Sales prices/discounts | Integer minor units | `SaleDraft` uses major-unit numbers; conversion must be deliberate and precision-safe. |
| Sales draft/item positions | Preserved numeric positions | Not represented in the current `SaleDraft` domain type; retained for stable restoration order. |
| Delivery date and recipient | `string \| null` | `DeliveryDraft` currently requires both values as strings, so direct, lossless mapping is not possible. Do not invent defaults. |
| Delivery supplier | Nullable `supplierName` | Domain calls this optional `supplier`; adapter needed. |
| Delivery prices | Nullable integer minor units | Domain uses nullable major-unit numbers; conversion needs an explicit rule. |
| Delivery positions and receipt metadata | Preserved position, event/batch IDs and raw snapshot string | Not all fields exist in `DeliveryDraft`; keep in the persistence model until a contract is approved. |

No domain types or snapshot serialization contracts were changed. Domain
adapters remain necessary before application-state integration. In particular,
the Delivery draft's nullable required-by-domain fields cannot be faithfully
mapped to non-null domain strings without a future domain or adapter decision.
No persisted fields are reconstructed from current Product or Inventory data.

## Validation and integrity behavior

The mappers reject malformed query row shapes, missing/duplicate query columns,
invalid required text, invalid timestamps or update-before-create timestamps,
unsafe or out-of-range numeric values, incomplete LEFT JOIN item rows,
conflicting repeated header data, and duplicate identifiers or item positions.
Values are not silently rounded, defaulted, or repaired. SQL NULL is retained
as `null`.

Prices remain minor-unit integers rather than being converted. Delivery receipt
snapshot JSON remains opaque, including malformed JSON. The SQL is fixed in
code, uses the existing parameterized query boundary, and contains only SELECT
operations.

## Test coverage

Focused tests use isolated `node:sqlite` in-memory databases initialized from
the actual `src-tauri/src/migrations/migration_001.sql`. They cover:

- Multiple active drafts and multiple items, ordered by persisted positions.
- Nullable metadata and exact retention of persisted text values.
- Valid Product, Variant, Inventory, Batch, and packaging identifiers.
- Empty active drafts.
- Exclusion of cancelled and approved Sales drafts.
- Exclusion of received deliveries; cancellation represented by its required
  Activity event and deletion.
- Delivery quantities, batch numbers, expiry, minor-unit prices, received-batch
  values, and opaque snapshot values.
- No writes to draft, Activity, or inventory-stock data during repository reads.
- Explicit rejection of unsafe persisted numeric values.
- No SQL joins to current catalog or inventory tables.

## Validation results

See `stage_15_5_9_draft_read_repositories_test_results.md` for exact commands
and outcomes. The final focused repository test run passed all 18 tests across
four files. `npm run build` passed TypeScript compilation and the Vite
production build. Focused ESLint passed. The build emitted Vite's existing
large-chunk warning; it did not fail the build.

## Scope and limitations

- No application-state hydration or UI integration was implemented.
- No write workflows, schema changes, or domain type changes were made.
- Snapshot JSON has no established writer/serializer contract and is preserved
  only as opaque raw data.
- The nullable Delivery header/domain mismatch and integer-minor-unit/domain
  price mismatch require explicit adapters or future domain decisions before
  hydration.
- Tests use Migration 001 in-memory SQLite databases; the normal application
  database was not accessed or modified.
