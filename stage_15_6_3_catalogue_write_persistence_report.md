# Stage 15.6.3 — Catalogue, Variant, and Packaging SQLite Write Persistence

## Verdict

**PASS**

Catalogue-only Product creation, Variant addition, catalogue edits, and
Activity persistence are implemented and covered by isolated SQLite tests.
The unresolved App.test.tsx assertion was fixed and the final focused App test
passes.

## Implementation summary

- Added and completed
  `src/persistence/repositories/productWriteRepository.ts`.
- Added isolated repository tests in
  `src/persistence/repositories/productWriteRepository.test.ts`.
- Catalogue-only Product creation persists only `products`, `variants`,
  `packaging_levels`, and applicable low-stock thresholds. It does not create
  batches or Inventory records.
- Variant addition persists the new Variant, packaging hierarchy, and threshold
  in the same transaction.
- Product, Variant, packaging, conversion, nullable price, NAFDAC, and threshold
  edits use stale-safe conditional SQL.
- Existing packaging hierarchy links and ordering are preserved, including
  nullable prices and conversion values.
- All catalogue operations compose the existing
  `src/persistence/repositories/activityWriteRepository.ts` insert into the
  same Rust/SQLx transaction.
- Rust transaction expectations are supplied before commit. An unexpected
  affected-row count rolls back the complete batch.
- `src/App.tsx` commits catalogue persistence before dispatching
  `ApplicationState` changes and leaves state unchanged when persistence fails.
- UI write failures remain visible in the existing create/edit modal error
  surfaces.
- Product-wide active-draft lock behavior remains enforced. Product name and
  description edits remain allowed; structure and Inventory changes remain
  blocked.
- The App catalogue status assertion in `src/App.test.tsx` was corrected to
  verify the split “Selected product:” and product-name elements without
  weakening the UI behavior check.

## Files changed or directly completed for this stage

Stage implementation and UI integration files:

- `src/persistence/repositories/productWriteRepository.ts`
- `src/persistence/repositories/productWriteRepository.test.ts`
- `src/App.tsx`
- `src/App.test.tsx`
- `src/features/delivery/pages/ReceiveDeliveryPage.tsx`
- `src/features/delivery/components/AddDeliveryVariantModal.tsx`
- `src/features/products/components/CreateProductModal.tsx`
- `src/features/products/components/ProductEditModal.tsx`
- `src/features/products/pages/ProductsPage.tsx`

The existing Activity write foundation was reused; no duplicate Activity writer
was introduced.

No migration file was added or changed. Migrations 001–003 and the normal
`sqlite:tipia.db` database/backup were not modified.

## Test results

| Check | Result |
|---|---|
| `npm test -- --run src/persistence/repositories/productWriteRepository.test.ts --maxWorkers=1` | PASS — 10 tests |
| `npm test -- --run src/App.test.tsx --maxWorkers=1` | PASS — 7 tests |
| Receive Delivery and Create Product focused UI tests | PASS — 42 tests across 2 files |
| Focused App catalogue UI test after final lint changes | PASS — 7 tests |
| `npx eslint ...catalogue implementation files...` | PASS |
| `npm run build` | PASS |
| `cargo fmt -- --check` | PASS |
| `git diff --check` | PASS |
| Full `cargo test` | 23 passed; 1 temporary Windows file-cleanup failure in the stale-row test. The stale-row test's database assertions passed; its temporary database could not be removed immediately after the test. |
| Focused Rust stale-row test rerun | PASS — 1 test |

The full Rust run identified no rollback/assertion failure. It had a Windows
`Os { code: 32 }` temporary-file cleanup race after the test completed. A direct
rerun of that test passed and removed the database successfully.

## Coverage retained

The isolated Product write suite covers:

- Catalogue-only creation and Variant addition.
- No creation of stock, batches, Inventory records, or batch pricing.
- Product prepend ordering.
- Product/Variant/packaging position and hierarchy updates.
- Conversion, nullable prices, thresholds, and NAFDAC data.
- Unsupported price precision and unsafe minor-unit rejection.
- Product name and description edits under an active delivery draft lock.
- Rejection of structure changes under a Product-wide draft lock.
- Middle-statement rollback.
- Stale conditional update rollback.
- Activity conflict rollback.

The App suite covers successful post-commit publication and unchanged state
with transaction failure.

## Limitations

- This stage does not implement initial Inventory or stock creation.
- Inventory and batch maintenance remain deferred.
- Sales and Receive Delivery persistence remain deferred.
- Product deletion remains deferred.
- The complete Vitest suite was not run; validation used the focused
  persistence and UI suites requested for this stage.
- The full Rust suite had a single transient Windows cleanup failure, which
  passed on focused rerun.

## Next stage

Stage 15.6.4 — Full Product creation with initial Inventory — is not started.
