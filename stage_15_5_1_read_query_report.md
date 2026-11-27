# Stage 15.5.1 — Read-only SQLite Query Boundary

## Outcome

Implemented a dedicated Rust/Tauri read command and a TypeScript invocation wrapper. The command retrieves the existing `sqlite:tipia.db` pool from the SQL plugin's `DbInstances`; it does not create another pool or use unrestricted SQL plugin `execute`/`select` permissions. The existing DML transaction command and migration behavior were not changed.

## Boundary behavior

- Accepts SQL text and a separate parameter array; values are bound through SQLx and never interpolated into SQL.
- Accepts one `SELECT` or `WITH` statement. It rejects empty SQL, non-read leading keywords, and multiple statements. Semicolons in quoted strings/comments are handled by the statement scanner.
- Enables SQLite `query_only` for the acquired pool connection while executing and restores its previous mode afterward. This also blocks writes hidden behind a `WITH` prefix. If restoring the mode fails, the connection is discarded rather than returned in an uncertain state.
- Ensures foreign-key enforcement is enabled on the acquired connection.
- Returns `{ columns, rows }`. `rows` are row-major values; `NULL`, booleans/integers/reals/text and blobs have predictable JSON representations. Integers outside JavaScript's safe integer range are decimal strings, and blobs are arrays of byte values.
- Logs database failures internally while returning a generic read-query failure to the caller, avoiding exposure of SQL/table error details through the IPC response.
- The TypeScript `querySqlite` wrapper initializes the existing database path, forwards SQL and parameters separately, rejects empty SQL and unsafe numeric parameters locally, and surfaces invocation failures.

No product or inventory repository/UI integration, schema change, migration SQL change, or SQL plugin capability expansion was made for this stage.

## Verification summary

On temporary SQLite databases, focused Rust tests verified parameter binding and multiple rows, zero-row column metadata, rejection of direct DML, query-only blocking of a write-form CTE, rejection of multiple statements, generic SQL errors, restoration of connection mode, and continued writability through the existing transaction boundary. Frontend tests verified initialization/invocation ordering, separate parameter forwarding, unsafe input rejection, and surfaced failures.

See [stage_15_5_1_test_results.md](./stage_15_5_1_test_results.md) for commands and outcomes.

## Prior migration-runtime limitation

The Stage 15.4.3.2 successful real-Tauri-IPC idempotency evidence remains documented in [migration_real_runtime_verification_report.md](./migration_real_runtime_verification_report.md). Real-IPC migration failure cleanup remains **unverified**; no Stage 15.5.1 test is presented as evidence for that separate scenario.
