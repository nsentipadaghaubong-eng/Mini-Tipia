# Stage 15.6.4 — Full Product Creation with Initial Inventory

## Verdict

**PASS**

The existing full Product creation workflow now persists catalogue,
initial Inventory, batch, pricing, stock, and Activity records in one
atomic SQLite/Rust SQLx transaction. ApplicationState is published only
after the transaction succeeds.

## Files changed

- `src/persistence/repositories/productWriteRepository.ts`
  - Added `persistFullProduct`.
  - Added full-result association and duplicate-ID validation.
  - Added batch, batch-pricing, Inventory-record, and Inventory-stock SQL
    descriptors.
  - Composes all existing Product and batch-created Activity events in the
    same transaction.
  - Supplies and validates expected affected-row counts.
- `src/persistence/repositories/productWriteRepository.test.ts`
  - Added full batched creation round-trip coverage.
  - Added rollback coverage for middle stock failure.
  - Added mismatched-association coverage.
  - Added stale affected-row rollback coverage.
  - Added Activity-conflict rollback coverage.
- `src/App.tsx`
  - Changed stock-based Product creation from direct reducer dispatch to
    post-commit `persistFullProduct` publication.
  - Preserved catalogue-only creation behavior.
- `src/features/products/components/CreateProductModal.tsx`
  - Waits for asynchronous Product persistence callbacks before closing.
  - Preserves synchronous callback behavior for existing tests.
- `src/features/products/pages/ProductsPage.tsx`
  - Allows the existing create callback to return a promise.
- `src/App.test.tsx`
  - Added full initial-Inventory publication-only-after-commit coverage.

No migration files were changed.

## Persistence operation

The transaction sequence is:

1. Temporarily move existing Product positions to avoid uniqueness conflicts.
2. Insert the created `products` row at position zero.
3. Restore existing Product positions.
4. Insert all Variants and packaging levels.
5. Insert hierarchy relationships with existing self-FK-safe updates.
6. Insert applicable low-stock thresholds.
7. Insert initial batches with Product/Variant associations, batch number,
   expiry date, and received date.
8. Insert batch pricing entries in packaging order.
9. Insert initial Inventory records with batch and Product/Variant associations.
10. Insert every packaging stock quantity for each Inventory record.
11. Insert the existing `product.created` Activity event.
12. Insert each existing `inventory.batch_created` Activity event.

All statements are parameterized. The Rust transaction receives the complete
expected-row-count array and rejects mismatches before commit. On mismatch,
error, uniqueness conflict, foreign-key conflict, or trigger failure, the
transaction rolls back the complete batch.

## IDs and relationships

- Generated IDs continue to come from the existing `ProductCreationResult`,
  with no IDs reconstructed or replaced during persistence.
- Product, Variant, and packaging IDs use the existing generated catalogue
  structure.
- Batch rows use their generated batch IDs and are associated with the exact
  generated Product and Variant IDs.
- Inventory rows use their generated Inventory IDs and remain associated with
  the exact Product, Variant, batch, and packaging IDs.
- Inventory positions are scoped per Variant.
- Batch positions are scoped per Variant.
- Stock positions follow the existing packaging-hierarchy array order.
- Pricing positions follow the existing batch-pricing array order.

## Activity

The existing `buildProductCreationActivityInputs` contract is reused.
Its `product.created` snapshot includes initial Inventory, and
`inventory.batch_created` events include initial batch snapshots.
Both snapshot serialization and Activity insertion use the Stage 15.6.2
foundation.

## Tests

| Check | Result |
|---|---|
| Full Product write repository suite | PASS — 15 tests |
| `src/App.test.tsx --maxWorkers=1` | PASS — 8 tests |
| Full initial-Inventory App test in isolation | PASS — 1 test |
| Create Product modal and focused UI tests | PASS — 19 tests across repository/UI files |
| Targeted ESLint | PASS |
| `npm run build` | PASS |
| Focused Rust affected-row rollback test | PASS — 1 test |
| `cargo fmt -- --check` | PASS |
| `git diff --check` | PASS |

The repository suite proves:

- Full catalogue, batch, pricing, Inventory, stock, and Activity round-trip.
- No partial records remain after middle stock-trigger failure.
- No partial records remain after Activity conflict.
- Stale affected-row mismatch rolls back the full transaction.
- Mismatched Product/Variant/Inventory associations are rejected.
- Duplicate and unknown IDs are rejected before execution.
- Existing catalogue-only Product creation remains unchanged.

## Limitations

- This stage does not implement editing existing Inventory or batches.
- Existing Sales, Receive Delivery, and deletion workflows were not changed.
- No startup/hydration redesign was performed.
- The complete Vitest suite was not run; validation remained focused.
- No new migration was required: migrations 001–003 already support the
  required catalogue, batch, Inventory, stock, pricing, and Activity tables.

## Database safety

The normal `sqlite:tipia.db` database and the existing verified backup were
not opened, modified, seeded, reset, or accessed for testing.
All database tests used migrations 001–003 in isolated in-memory SQLite
databases.

## Next stage

Stage 15.6.5 — Inventory and batch maintenance — was not started.
