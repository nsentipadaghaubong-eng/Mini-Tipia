# Real Runtime Migration Test Results

**Date:** 2026-11-25  
**Platform:** Windows

## Real Tauri application

| Check | Result | Evidence |
|---|---|---|
| Existing first application of Migration 001 | Passed at ledger level | One row for version 1, expected migration name, matching checksum, and recorded applied timestamp existed before the current app launch. The original IPC console output was not retained. |
| Tauri startup initialization | Passed | The isolated executable launched, and the app displayed “SQLite connection ready; foreign-key enforcement verified.” |
| Subsequent migration IPC | Passed | `window.__TAURI_INTERNALS__.invoke('initialize_sqlite_schema')` resolved in the app DevTools console with `Migration 1 001_reconciled_initial_schema is already applied; no migration SQL was rerun.` |
| Ledger/schema/FK/integrity inspection | Passed | One ledger row; 83 non-internal schema objects matching the embedded script after whitespace normalization; no FK violations; integrity result `ok`. |
| Existing SQL plugin pool reuse | Passed by implementation/runtime path | The migration command obtains the existing `DbInstances` SQLite pool; no second production pool is constructed. Startup initialization and the explicit IPC call succeeded. |
| Normal DB remained untouched | Passed | Its SHA-256, size, and last-write time were identical before and after the isolated app run. |

## Focused automated tests

### Frontend database initialization

Command:

```text
npm test -- --run src/persistence/database.test.ts
```

Result: **passed** — 1 test file, 7 tests, 0 failures (1.56 seconds).

Coverage includes migration failure propagation and closing the partially initialized SQL plugin connection, foreign-key verification failure cleanup, and reporting when close cannot confirm cleanup. These tests mock the SQL plugin and IPC boundary; they are component tests, not real IPC evidence.

### Rust migration behavior

Command:

```text
cargo test --manifest-path src-tauri\Cargo.toml --lib migrations::tests -- --nocapture
```

Result: **passed** — 5 tests, 0 failures (0.23 seconds after compilation).

Coverage includes fresh migration and ledger recording, idempotency, concurrent application, checksum mismatch rejection, migration-ledger immutability, foreign-key enforcement, and rollback of malformed migration SQL. Test databases are temporary SQLite files.

Cargo emitted a non-fatal `dead_code` warning for `initialize_sqlite_schema_for_instances`; no code was changed to address it because it is outside this verification task.

## Unverified

- A deliberately failing migration through real Tauri IPC against a separate disposable app database, including observed runtime partial-connection cleanup, was not exercised. Rust temporary-database rollback tests and mocked frontend cleanup tests do not establish that full real-runtime scenario.
- No migration SQL was run again on the app's existing database; this was intentional because it already held the matching committed Migration 001 ledger row.
