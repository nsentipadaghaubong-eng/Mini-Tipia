# Stage 15.5.1.1 — Test Results

**Platform:** Windows  
**Database scope:** isolated temporary SQLite files only; the normal `sqlite:tipia.db` was not used.

## Passed checks

| Check | Command | Result |
|---|---|---|
| Focused Rust read-query regressions | `cargo test --manifest-path src-tauri\Cargo.toml --lib persistence::tests::read_query -- --nocapture` | 6 passed, 0 failed |
| Complete Rust library suite | `cargo test --manifest-path src-tauri\Cargo.toml --lib` | 16 passed, 0 failed |
| Frontend persistence tests | `npm test -- --run src/persistence/query.test.ts src/persistence/database.test.ts src/persistence/transaction.test.ts` | 3 files, 17 tests passed |
| TypeScript check and frontend production build | `npm run build` | Passed; Vite emitted a non-fatal >500 kB chunk advisory |
| Focused frontend lint | `npx eslint src/persistence/query.ts src/persistence/query.test.ts` | Passed |
| Rust boundary formatting | `rustfmt --check --edition 2024 src-tauri\src\persistence.rs` | Passed |

The focused Rust tests cover parameter binding, multiple/zero rows, leading comments and whitespace, direct DML and schema/database mutation rejection, PRAGMA/ATTACH/DETACH rejection, write-form CTE blocking, semicolon/comment/whitespace statement forms, and connection mode restoration after successful and failed reads. The full library suite also passed the existing transaction rollback/concurrency tests and migration rollback/checksum/idempotency/concurrency tests.

Cargo emitted the existing non-fatal dead-code warning for `initialize_sqlite_schema_for_instances`; no migration code was changed. A full repository lint was not run; focused lint on the wrapper and its tests passed. No real-Tauri-IPC query invocation was run.

## Files changed for this stage

- `src-tauri/src/persistence.rs` — expanded isolated regression tests only; production boundary logic is unchanged.
- `stage_15_5_1_1_read_query_security_review.md` — security review and recommendation.
- `stage_15_5_1_1_test_results.md` — this validation record.
