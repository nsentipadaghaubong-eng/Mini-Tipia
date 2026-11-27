# Stage 15.5.18.2 — Migration 002 Checksum Investigation

## Verdict

**Root cause established:** the Migration 002 SQL currently embedded by the application is not the SQL recorded as applied in the configured normal database. Migration 002 was applied successfully with an earlier SQL version; the current source later changed the receipt-association trigger and added two Inventory identity triggers without increasing the migration version. The migration checksum is correctly rejecting that drift.

The exact applied SQL text is recoverable from an unreachable Git blob. Its Windows CRLF byte representation hashes to the database's stored checksum exactly. No correction was applied in this investigation.

## Evidence

### Checksum implementation and current source

- [`migrations.rs`](src-tauri/src/migrations.rs) embeds Migration 002 with `include_str!("./migrations/migration_002_delivery_inventory_association.sql")`.
- Its `sha256` function hashes `sql.as_bytes()` directly. There is no line-ending normalization or other transformation in the checksum path. Applied ledger rows are checked before pending migrations are executed; a mismatch returns an error, and the surrounding transaction is rolled back.
- The current [`migration_002_delivery_inventory_association.sql`](src-tauri/src/migrations/migration_002_delivery_inventory_association.sql) is 2,643 bytes with CRLF line endings. Its raw-byte SHA-256 is `c5fa0d683fd6022bb4e520f0a60a17b7c8da48658cc933a971fd4afea43eba61`, matching the embedded checksum reported at startup.
- The two versions reachable in Git history, commits `8705255351b44d97523898fcc8cfdbc4e26add60` and `122a86d327f820f71d6a4ae7f228359b03211ea4`, contain identical SQL text using LF endings (2,566 bytes; SHA-256 `8d84a163439b4261507ba151c841333b48c5f3e28bad101c2aa5e435a319078b`). Converting that text to CRLF yields the current source checksum, not the database checksum.

### Recoverable applied version

An unreachable Git blob, `5ecdffdedd7f5c1786ceab760cb174566570e949`, contains the earlier Migration 002 SQL:

- The blob's LF text is 959 bytes.
- Converting its line endings to CRLF produces 987 bytes with SHA-256 `dd0887ef67b4589ea7164ef82667aa8be1fc5a3c7bf7145aea7eae3f00b9c898`—an exact match for the reported and stored ledger checksum.
- This version adds `received_inventory_id` and creates `delivery_receipt_requires_inventory_association`. The current file changes that trigger's condition and error text, and adds `inventory_record_received_delivery_association_insert` and `inventory_record_received_delivery_association_update`.
- The trigger SQL stored in the database matches the earlier blob's trigger body, not the current migration's body.

The exact SQL text and checksum-producing line endings are therefore recoverable. The blob is unreachable from current refs and may be pruned by Git maintenance; preserve it in the corrective task before relying on it. Another unreachable migration-like blob (`930e79ad096d7e9a02778bd0b4ae2a354fc9f5fc`) does not match the stored checksum.

### Database identity and read-only inspection

- [`tauri.conf.json`](src-tauri/tauri.conf.json) sets the current application identifier to `com.tauri.dev`; the configured normal database is `%APPDATA%\com.tauri.dev\tipia.db`.
- This normal database was opened with SQLite read-only mode and `PRAGMA query_only=ON`. No isolated test database was inspected for the current ledger result.
- Its ledger contains Migration 001 and Migration 002. Version 2 is named `002_delivery_inventory_association`, has checksum `dd0887ef67b4589ea7164ef82667aa8be1fc5a3c7bf7145aea7eae3f00b9c898`, and was applied at `2026-11-26T13:01:49Z`.
- `delivery_items.received_inventory_id` and `delivery_receipt_requires_inventory_association` are present. The two Inventory identity triggers in the current source are absent.
- `delivery_items` contains zero rows, so there are no existing delivery-item associations to count. No business row contents or unrelated business records were inspected. `PRAGMA integrity_check` returned `ok`.
- The database file's size, modification time, and SHA-256 were identical before and after inspection; no `-wal` or `-shm` sidecars were present. The file was not modified.

These observations establish that Migration 002 was applied to the configured normal database, but that its applied definition is earlier than the current embedded definition. The mismatch is not explained by line endings alone: the earlier SQL's CRLF checksum exactly reproduces the ledger value, while the current SQL's CRLF checksum is different.

## Safest correction

1. In a separate corrective task, restore [`migration_002_delivery_inventory_association.sql`](src-tauri/src/migrations/migration_002_delivery_inventory_association.sql) from blob `5ecdffdedd7f5c1786ceab760cb174566570e949`, preserving the CRLF bytes that reproduce the stored checksum. Verify the resulting SHA-256 before startup. Do not edit the database or migration ledger, and do not rerun Migration 002.
2. Do not put later schema changes into Migration 002. If the newer trigger behavior and Inventory identity triggers are still required, add them in a new forward-only Migration 003 after restoring the immutable original. That conditional change would add a new SQL file under [`src-tauri/src/migrations/`](src-tauri/src/migrations/), register version 3 in [`migrations.rs`](src-tauri/src/migrations.rs), and add focused migration tests. First verify the intended business constraints; this investigation does not establish that the newer behavior is required.

For the restoration-only correction, the only source file that needs to change is `src-tauri/src/migrations/migration_002_delivery_inventory_association.sql`. If Migration 003 is approved, the migration executor/registration, new SQL file, and related tests are additional files for that separate change. No ledger rewrite or database reset is appropriate.

## Files and state

Inspected: [`migrations.rs`](src-tauri/src/migrations.rs), [`migration_001.sql`](src-tauri/src/migrations/migration_001.sql), [`migration_002_delivery_inventory_association.sql`](src-tauri/src/migrations/migration_002_delivery_inventory_association.sql), [`tauri.conf.json`](src-tauri/tauri.conf.json), and [`migration_real_runtime_verification_report.md`](migration_real_runtime_verification_report.md), along with reachable and unreachable Git history and the configured normal database's migration/schema metadata.

No migration, application source, database, or ledger was changed. No migration or test suite was run; this was an inspection-only investigation. The only deliverable added is this report.
