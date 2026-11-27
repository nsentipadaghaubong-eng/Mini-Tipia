# Stage 15.5.15 — Consistent Read Snapshot Test Results

## Final validation

| Check | Command | Result |
|---|---|---|
| Rust persistence boundary | `cargo test --manifest-path src-tauri\Cargo.toml persistence::tests::` | Passed: 15 tests, 0 failures (5 other Rust tests filtered out). |
| Frontend query, loader, and all seven repository tests | `npm test -- --run src/persistence/query.test.ts src/persistence/applicationDataLoader.test.ts src/persistence/repositories/productRepository.test.ts src/persistence/repositories/inventoryRepository.test.ts src/persistence/repositories/activityRepository.test.ts src/persistence/repositories/salesRepository.test.ts src/persistence/repositories/receiveDeliveryRepository.test.ts src/persistence/repositories/salesDraftRepository.test.ts src/persistence/repositories/receiveDeliveryDraftRepository.test.ts` | Passed: 9 files, 52 tests. |
| TypeScript check and production build | `npm run build` | Passed (`tsc -b` and Vite production build). Vite emitted its existing advisory for a minified chunk larger than 500 kB. |
| Focused ESLint | `npx eslint src/persistence/query.ts src/persistence/query.test.ts src/persistence/applicationDataLoader.ts src/persistence/applicationDataLoader.test.ts src/persistence/repositories/productRepository.ts src/persistence/repositories/inventoryRepository.ts src/persistence/repositories/activityRepository.ts src/persistence/repositories/salesRepository.ts src/persistence/repositories/receiveDeliveryRepository.ts src/persistence/repositories/salesDraftRepository.ts src/persistence/repositories/receiveDeliveryDraftRepository.ts` | Passed. |
| Rust formatting | `rustfmt --edition 2024 --config skip_children=true --check src-tauri\src\persistence.rs src-tauri\src\lib.rs` | Passed. |
| Whitespace/error check | `git diff --check` | Passed; only pre-existing line-ending conversion warnings from modified `src-tauri` files were reported. |

Coverage includes one batch call for all seven repository SELECTs and assembly of all eight collections; parameter and result-order preservation; standalone repository compatibility; snapshot transaction behavior on a single acquired pool connection; a synchronized concurrent committed write in WAL mode; rollback and pooled-connection reuse after query failure; and rejection of writes, hidden CTE writes, multi-statement SQL, and batches over the configured limit.

The Rust concurrency fixture and persistence tests use isolated temporary SQLite files. The loader integration fixture uses `DatabaseSync(":memory:")` initialized from Migration 001. No test accessed the normal `sqlite:tipia.db`.

## Initial failures and corrections

- The first TypeScript build after adding the snapshot executor reported a missing `SqliteQueryExecutor` type import and a boolean parameter type mismatch in the in-memory fixture. Both were corrected; the final build and focused ESLint passed.
- The first Rust compile reported an incorrect dereference when passing a pooled connection to the shared query runner. The dereference was corrected.
- The first compiled Rust run passed 14 of 15 persistence tests; the new failure-cleanup test hit a Windows file lock while removing its temporary database. After explicitly closing/dropping its pool, the next run exposed the same transient lock in two existing tests. The persistence test module now retries removal only for Windows sharing-violation error 32, following the migration tests' existing cleanup pattern. The final Rust run passed all 15 tests.
- An initial `rustfmt --check` invocation used rustfmt's default Rust 2015 edition and traversed child modules. The corrected Rust 2024, `skip_children` check on the two changed Rust source files passed.

Rust emitted existing dead-code warnings from the migration module; they do not fail tests and were not changed in this stage.

## Scope confirmation

No schema or migration files were changed. No write operation was added to the snapshot boundary. `App.tsx`, `applicationState.ts`, startup, UI, domain workflows, and historical serialization contracts were not changed. Existing worktree changes were preserved.
