# Stage 15.5.2 — Test Results

**Platform:** Windows  
**Product repository test database:** fresh in-memory SQLite database populated by executing the actual Migration 001 SQL. No normal `sqlite:tipia.db` was opened or modified.

## Passed

| Check | Command | Result |
|---|---|---|
| Focused Product repository tests | `npm test -- --run src/persistence/repositories/productRepository.test.ts` | 1 file, 6 tests passed |
| Product repository plus existing frontend persistence tests | `npm test -- --run src/persistence/repositories/productRepository.test.ts src/persistence/query.test.ts src/persistence/database.test.ts src/persistence/transaction.test.ts` | 4 files, 23 tests passed |
| TypeScript check and frontend production build | `npm run build` | Passed; Vite emitted a non-fatal >500 kB chunk advisory |
| Focused lint | `npx eslint src/persistence/repositories/productRepository.ts src/persistence/repositories/productRepository.test.ts src/persistence/query.ts src/persistence/query.test.ts` | Passed |
| Rust Product-boundary-specific reruns | `cargo test --manifest-path src-tauri\Cargo.toml --lib persistence::tests::read_query_rejects_mutation_statements_and_blocks_writes_in_ctes -- --nocapture` and `...persistence::tests::read_query_returns_column_names_when_there_are_no_rows -- --nocapture` | Each isolated test passed on rerun |

The six Product repository tests cover empty catalog; a Product with one Variant; multiple Variants; packaging ordering, hierarchy links and conversion quantities; default prices; thresholds with and without a packaging ID; optional NAFDAC; nullable metadata/prices; no-Variant Products; and isolation of child rows across Products. A high minor-unit price that cannot round-trip to the existing domain number is verified to fail explicitly.

## Failed / intermittent

`cargo test --manifest-path src-tauri\Cargo.toml --lib persistence::tests` was run twice. Each run had 10 of 11 tests pass and one different test fail during temporary database teardown: Windows returned OS error 32 (“file is being used by another process”) from `fs::remove_file`. Each corresponding read test passed when rerun individually. This appears to be an intermittent cleanup failure in the existing Rust test helper, not a Product repository failure. No Rust source or cleanup helper was changed in this stage.

Cargo also emitted its existing non-fatal dead-code warning for `initialize_sqlite_schema_for_instances`. The Product repository test run emitted Node’s experimental `node:sqlite` warning.

## Not run

- Full frontend test suite and full repository lint were not run; focused persistence tests and lint passed.
- Full Rust library suite was not run during this stage. The relevant Rust persistence module was attempted as described above; its individual implicated tests passed on rerun.
- No real Tauri IPC or UI/startup integration was performed.

## Files changed for this stage

- `src/persistence/repositories/productRepository.ts`
- `src/persistence/repositories/productRepository.test.ts`
- `stage_15_5_2_product_read_repository_report.md`
- `stage_15_5_2_test_results.md`
