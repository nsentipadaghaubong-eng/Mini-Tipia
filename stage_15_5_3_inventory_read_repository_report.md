# Stage 15.5.3 — Inventory Read Repository

## Outcome

Created `src/persistence/repositories/inventoryRepository.ts` with a read-only `getAllInventory()` function. It uses the existing `querySqlite` boundary and returns the two Inventory state collections as `InventoryRepositoryData`:

- `inventoryRecords: inventory[]`
- `inventoryBatches: inventoryBatch[]`

The repository does not connect to UI or application startup, mutate stock, perform FEFO allocation, or change any workflow.

## Reconstruction and relationships

The repository uses one code-defined `SELECT ... UNION ALL ... SELECT` statement through `querySqlite`. The statement reads inventory records and their stock rows in one arm, and all batch records and their batch-pricing rows in the other. Using one statement avoids combining separate reads from different database snapshots. `LEFT JOIN`s preserve records without stock rows and batches without pricing rows; batches without an Inventory record are included as well.

| Migration 001 source | Domain mapping |
|---|---|
| `inventory_records.inventory_id`, `product_id`, `variant_id`, `batch_id` | `inventory.id`, `productId`, `variantId`, `batchId`; all IDs and nullable batch association are preserved. |
| `inventory_stock.packaging_level_id`, `quantity` | `inventory.stockQuantities[]`; each persisted packaging-level ID and non-negative safe-integer quantity is preserved. Stock rows are ordered by `stock_position`. |
| `batches.batch_id`, `product_id`, `variant_id`, `batch_number` | `inventoryBatch.batchId`, `productId`, `variantId`, `batchNumber`; grouping is by persisted `batch_id`, not batch number or expiry. |
| `batches.expiry_date` | `inventoryBatch.expiryDate`; SQL `NULL` remains `null`, otherwise the date-only value is reconstructed as a UTC `Date`. |
| `batches.received_date` | Optional `inventoryBatch.receivedDate`; SQL `NULL` omits the optional domain property, while a stored date string is preserved. |
| `batch_pricing.packaging_level_id`, `cost_price_minor_units`, `selling_price_minor_units` | `inventoryBatch.pricingByPackagingLevel[]`; packaging association and ordering are preserved, nullable prices remain `null`, and minor units use the existing `/ 100` decimal mapping with a round-trip guard. |
| Product, Variant, Inventory, Batch, stock, and pricing position columns | Restore stable Product/Variant and record/batch/child ordering in the returned arrays. |

Inventory rows and batch rows are grouped independently by their primary IDs. Thus, batches with the same batch number but different expiry dates remain distinct, and anonymous batches with both number and expiry missing are also retained separately. The repository checks joined stock/pricing parent IDs and validates each non-null Inventory `batchId` against the loaded batch's Product and Variant. Malformed or incomplete rows fail explicitly instead of being silently dropped.

If an Inventory record has no `inventory_stock` rows, it is returned with `stockQuantities: []`; no quantity is invented. Batch number, expiry, received date, and batch pricing may be absent according to the schema and are represented using the existing domain nullability.

## Tests and validation

The tests create isolated in-memory `node:sqlite` databases, enable foreign keys, and execute the actual Migration 001 SQL. At the query boundary, the test mock executes the repository's actual SQL against that SQLite database; this is not a real Tauri IPC test.

Coverage added:

- Empty Inventory result.
- Multiple Products and Variants with correctly associated records, stock, batches, and pricing.
- Multiple batches on one Variant with the same batch number and different expiry dates, with no merging.
- Ordered multi-level packaging stock quantities and batch pricing.
- Nullable prices, received date, expiry date, and missing batch number.
- Multiple anonymous batches retained by ID.
- Inventory records with no stock rows and batches with no Inventory record retained.
- No accidental child-record mixing or duplication across parents.

| Check | Command | Result |
|---|---|---|
| Inventory and Product repository tests | `npm test -- --run src/persistence/repositories/inventoryRepository.test.ts src/persistence/repositories/productRepository.test.ts` | **Passed:** 2 files, 9 tests. This includes 3 Inventory tests and all 6 existing Product repository tests. |
| TypeScript application check | `npx tsc -p tsconfig.app.json --pretty false` | **Passed** after a first attempt identified an unused local position variable, which was corrected. |
| Focused lint | `npx eslint src/persistence/repositories/inventoryRepository.ts src/persistence/repositories/inventoryRepository.test.ts` | **Passed** after the same unused-local correction. |

The test command emitted Node's existing experimental `node:sqlite` warning. `npm run build`, the full frontend suite, Rust tests, application launch, and real Tauri IPC were not run; they were not required for this focused read-repository slice.

## Limitations and carry-forward requirements

- The repository is not wired into `App.tsx`, application state, UI, or any business workflow.
- Reads use the existing read-only query wrapper; integration with a running Tauri application was not verified here.
- Batch prices use the existing integer-minor-unit-to-decimal-number contract and round-trip guard. The Stage 15.5.2.2 extreme-value JavaScript precision limitation remains unchanged. Safe minor-unit validation for future Sales money-writing persistence is still required before that work begins; this Inventory stage does not attempt to solve it.
- The intermittent Windows OS error 32 during parallel Rust temporary-database cleanup remains documented. No Rust tests or cleanup behavior were changed in this stage.
- No schema changes were made. The normal database was not opened or modified; tests used only isolated in-memory databases.

## Files created and modified

Created:

- `src/persistence/repositories/inventoryRepository.ts`
- `src/persistence/repositories/inventoryRepository.test.ts`
- `stage_15_5_3_inventory_read_repository_report.md`

No existing files were modified. In particular, Product repository behavior, Migration 001, UI, application state, Inventory workflows, Sales, Receive Delivery, Activity, and production database contents were unchanged.
