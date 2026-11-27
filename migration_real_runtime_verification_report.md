# Mini-Tipia Real Tauri Migration Startup Verification

**Stage:** 15.4.3.2  
**Date:** 2026-11-25  
**Platform:** Windows

## Result

The isolated Windows Tauri application started successfully, verified SQLite foreign-key enforcement, and completed its startup migration path. A subsequent real Tauri IPC call returned the explicit idempotent no-op result. Migration 001's committed ledger entry, checksum, schema, foreign-key check, and database integrity were verified read-only.

The initial migration was already applied before this verification session opened the app. Its successful commit is evidenced by the isolated database ledger and matching embedded SQL checksum; the original session's IPC console output was not retained. The new app startup and explicit DevTools IPC call provide live IPC evidence for the subsequent no-op path.

## Isolated application and database

- Executable: `C:\Users\hp\AppData\Local\Temp\mini-tipia-stage15432\mini-tipia-stage15432.exe`
- Executable SHA-256: `F039E1AEC3130BB7132881FD1BE6FD55DD57E5B5EEB7FAC44B1770209A29AFE2`
- Runtime database: `%APPDATA%\com.minitipia.stage15432\tipia.db`
- SQLite `PRAGMA database_list` resolved the active file to `C:\Users\hp\AppData\Roaming\com.minitipia.stage15432\tipia.db`.
- The app window displayed: “SQLite connection ready; foreign-key enforcement verified. Application data remains in memory and is not saved to SQLite.”

## Migration and schema evidence

Read-only inspection found exactly one ledger row:

| version | name | checksum SHA-256 | applied_at |
|---:|---|---|---|
| 1 | `001_reconciled_initial_schema` | `2954533e160563e3501bc1096fb28e0dcd691926f98c6c096112bc1555f100e8` | `2026-11-25T13:37:57Z` |

The SHA-256 of `src-tauri/src/migrations/migration_001.sql` is the same `2954533e...100e8` value. The migrated database contains 83 non-internal schema objects: 16 tables, 1 view, 53 triggers, and 13 explicitly named indexes. The object names and whitespace-normalized SQL definitions match the embedded Migration 001 script.

- `PRAGMA foreign_key_check`: no violations.
- `PRAGMA integrity_check`: `ok`.
- The Rust startup verifier displayed in the application confirms that foreign-key enforcement was enabled and verified on the plugin connection.

## Real IPC evidence

The application was launched from the isolated executable. Its startup path called `Database.load("sqlite:tipia.db")`, then `verify_sqlite_connection`, then `initialize_sqlite_schema`; the UI reached its connected status only after those promises resolved.

In the app's WebView DevTools console, this command was executed:

```js
window.__TAURI_INTERNALS__.invoke('initialize_sqlite_schema')
```

The returned promise resolved, and the console displayed:

> Migration 1 001_reconciled_initial_schema is already applied; no migration SQL was rerun.

This is the real Tauri IPC no-op result. The ledger remained at one row with the original checksum and timestamp; schema integrity and foreign-key checks remained clean.

## SQL plugin pool reuse

The registered Rust command obtains the existing SQLite pool from `DbInstances` under `sqlite:tipia.db` and clones that pool handle for the migration. It does not construct a second pool. The frontend loads the database through `@tauri-apps/plugin-sql` before invoking the Rust verification and migration commands. The app's successful startup status and the resolved IPC result corroborate that runtime path.

## Normal database protection

The configured normal identifier is `com.tauri.dev`. Its database, `%APPDATA%\com.tauri.dev\tipia.db`, was inspected read-only before and after the isolated app run:

- Size: 4096 bytes both times.
- SHA-256: `1FE8F6113488865C546D2FAA55B21482662CE4BE19D4F505EEEFA09BC3131489` both times.
- Last-write time: `2026-11-24T19:53:42.0874221Z` both times.
- It contained no non-internal schema objects and passed `PRAGMA integrity_check`.

The isolated app's active database path was the separate `com.minitipia.stage15432` directory. The normal database was not modified.

## Failure-path boundary

Isolated Rust and frontend tests passed for migration rollback, checksum mismatch rejection, and partial-connection cleanup; see [migration_real_runtime_test_results.md](./migration_real_runtime_test_results.md). The rollback tests use temporary SQLite databases, and the frontend cleanup tests mock the SQL plugin/IPC boundary.

A real Tauri startup with a deliberately failing migration and runtime partial-connection cleanup was **not verified**. Injecting a failure into the already-migrated app database would compromise the successful evidence, while no separate disposable failure-identity Tauri executable was available. No mock is presented as proof of that real-runtime failure scenario.

## Scope and worktree

No application, migration, schema, configuration, or business-workflow code was changed for this verification. The existing uncommitted changes were preserved. Only the two requested verification reports were added.
