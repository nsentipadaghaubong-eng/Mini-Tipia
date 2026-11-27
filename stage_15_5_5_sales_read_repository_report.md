# Stage 15.5.5 — Sales Read Repository

## Summary

Added `getAllSales()` as a read-only query over completed `sales` records and their persisted `sale_items`. It returns completed rows newest first, preserves nullable relational fields and item ordering, and does not join current Product or Inventory tables.

Migration 001 stores item history in `item_snapshot_json`, but neither the schema nor existing application code defines its serialization contract. Following the selected contract, the repository exposes both the parsed JSON value as `unknown` and the original JSON string. It does not interpret the snapshot or invent a `CompletedSaleItem` shape.

## Files created

- `src/persistence/repositories/salesRepository.ts`
- `src/persistence/repositories/salesRepository.test.ts`
- `stage_15_5_5_sales_read_repository_report.md`

No existing files were modified for this stage. Unrelated existing worktree changes were preserved.

## Schema and mapping

Migration 001 represents a completed sale as a row in `sales`; that table has no `status` column. The repository maps its presence to the read-model literal `status: "completed"`. Cancelled sales are represented as `sale_drafts.status = 'cancelled'`, not as rows in `sales`. Accordingly, `getAllSales()` returns completed sales only; cancelled drafts are not returned as completed sales.

The repository queries `sales` with a `LEFT JOIN` to `sale_items` only. It does not join `sale_drafts`, Activity, Products, Variants, batches, packaging, or Inventory for reconstruction.

| Persisted field | Read-model mapping |
|---|---|
| `sale_id` | `saleId` |
| `source_draft_id` | `sourceDraftId` |
| `completed_event_id` | `completedEventId` |
| `completed_at` | `completedAt`, returned unchanged |
| `customer_name`, `customer_address`, `sale_date`, `notes` | Nullable text fields, retaining SQL `NULL` |
| `staff_user_id`, `staff_display_name` | Nullable staff identifiers/display name; the display name is the persisted “Received By” value |
| Sale minor-unit totals | `subtotal`, `discountAmount`, and `finalAmount` as checked decimal domain numbers |
| `expired_batch_confirmed` | Boolean, accepting only integer `0` or `1` |
| Sale item IDs, `item_position`, quantity, batch and packaging IDs | Corresponding `PersistedSaleItem` fields |
| Nullable `default_selling_price_minor_units` and item minor-unit amounts | Checked decimal numbers; default price remains `null` when SQL is `NULL` |
| `expired_batch` | Item `expiredBatch` boolean |
| `item_snapshot_json` | Parsed opaque `itemSnapshot` plus exact original `itemSnapshotJson` |

Sales are ordered newest first by `completed_at`, with `sale_position` as a stable tie-breaker. Items are ordered by `item_position`. These internal position values are used for ordering and are not exposed as Sale history fields except item position, which is retained in each item.

## Historical snapshots and cancellations

The repository never derives historical names or structures from live catalog or stock data. The item snapshot is not interpreted because its JSON contract is undefined; consumers can retain/use the parsed value opaquely or use `itemSnapshotJson` where exact serialized representation matters. Keeping the original string also avoids losing numeric token precision during JSON parsing.

Cancelled drafts are deliberately excluded. Their records live in `sale_drafts` and `sale_draft_items`; those tables do not provide the completed item snapshot contract and do not represent completed Sales. The test verifies a cancelled draft is not returned.

## Money precision

The Sales schema stores prices and totals in integer minor units. Sale header totals are constrained to non-negative safe integers; several `sale_items` monetary columns do not have equivalent SQLite type/range constraints. The repository therefore independently requires every non-null monetary column to be a non-negative `Number.isSafeInteger`, converts minor units by dividing by 100 in line with the existing Product and Inventory repositories, and rejects a converted amount unless multiplying it back and rounding exactly recovers the stored minor-unit integer. It never silently rounds or truncates persisted values.

The schema names the unit as “minor units” but does not define a currency. The existing frontend domain convention uses 100 minor units per displayed unit; no new currency assumption or monetary calculation was introduced.

## Test coverage and results

Tests create an isolated `node:sqlite` in-memory database, enable foreign keys, and execute the actual Migration 001 SQL. Fixtures satisfy the migration’s Sales triggers and relationships. The existing read-query boundary is mocked only to execute the repository’s fixed query against that in-memory database.

Coverage includes:

- Empty Sales history.
- Completed Sales with multiple items, exact item ordering, totals, timestamps, customer and staff fields.
- Nullable customer/staff/date/notes values, batch IDs, and default prices.
- Opaque historical item snapshots without live Product/Inventory joins.
- Stable newest-first Sale ordering, including equal timestamps.
- Exclusion of cancelled drafts from completed Sales results.
- Rejection of malformed item snapshot JSON.
- Rejection of a fractional minor-unit price that the schema permits in an item monetary column.

Checks run:

| Command | Result |
|---|---|
| `npx vitest run src/persistence/repositories/salesRepository.test.ts` (initial unsafe-integer fixture) | Failed before repository mapping: `node:sqlite` refused to materialize `9007199254740992` as a JavaScript number. The fixture was changed to a fractional value that Migration 001 permits in the item price column, so the repository validator could be exercised. |
| `npx vitest run src/persistence/repositories/salesRepository.test.ts` (after fixture correction) | Passed: 1 file, 5 tests |
| `npx vitest run src/persistence/repositories/salesRepository.test.ts src/sales/salesEngine.test.ts src/sales/salesDraft.test.ts` | Passed: 3 files, 66 tests |
| `npx tsc -p tsconfig.app.json --pretty false` | Passed |
| `npx eslint src/persistence/repositories/salesRepository.ts src/persistence/repositories/salesRepository.test.ts` | Passed |
| `npm run build` | Passed; Vite reported a minified JavaScript chunk of 528.84 kB, above its 500 kB advisory threshold |

The out-of-safe-range integer was not directly validated by the repository in the test adapter because `node:sqlite` rejected it while materializing the query result. The repository guard still rejects any non-safe integer it receives. The final focused unsafe-value test verifies rejection of a fractional persisted minor-unit amount.

## Limitations and unresolved questions

- The schema’s `item_snapshot_json` has only a non-empty-text constraint, and no existing writer defines its object shape. The repository therefore cannot expose or validate snapshot members as `CompletedSaleItem`; the raw and parsed payloads are preserved without interpretation.
- `JSON.parse` can represent large numeric tokens imprecisely as JavaScript numbers. The original `itemSnapshotJson` is retained exactly for consumers requiring its original representation. Repository monetary fields are mapped separately from checked relational minor-unit columns.
- Cancelled drafts are not part of this completed-Sales repository. A future draft-history reader would need its own explicit representation and must not infer missing historical Product/Inventory snapshots.
- The test adapter’s safe-integer conversion failure limits direct coverage of an over-`MAX_SAFE_INTEGER` item value; fractional malformed persisted values are covered.
- Price-total safety remains a requirement for future money-writing persistence. This stage adds no write path or total calculation.

## Scope confirmation

No UI, schema/migration SQL, Sales workflow, write behavior, transaction boundary, or normal application database was changed or used. Tests used only in-memory databases. The repository remains unintegrated, and work stops at Stage 15.5.5.
