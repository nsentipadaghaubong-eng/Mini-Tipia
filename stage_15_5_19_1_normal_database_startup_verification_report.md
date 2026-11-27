# Stage 15.5.19.1 — Normal Database Startup Verification

## Verdict: PASS

The normal Mini-Tipia Tauri application was launched using the existing project command after a verified external backup was created. Its normal Pharmacy Management interface appeared with Dashboard, Products, Inventory, Receive Delivery, Sales, and Activity navigation. Products and Inventory showed their normal empty states; no demo records were injected.

Read-only checks before and after startup found the same migration ledger and business-record counts. Integrity and foreign-key checks passed. Migration 003 was already applied before this launch, so startup did not need to apply it.

## Initial worktree and process safety

The initial worktree contained numerous pre-existing unstaged modifications and untracked persistence, migration, test, and report files. No staged changes were shown. They were preserved; no reset, cleanup, revert, or unrelated edit was performed.

An initial check found an already-running `app.exe` and `npm run tauri dev` session. They were not terminated. After the user closed the window and stopped that session, a new process check found no Mini-Tipia app or Tauri dev-session processes; the database WAL/SHM sidecars were also absent. Only after that recheck did the backup and controlled startup proceed.

## Normal database path

- The frontend configures `sqlite:tipia.db` in `src/persistence/database.ts`.
- `src-tauri/tauri.conf.json` sets the identifier to `com.tauri.dev`.
- The installed `tauri-plugin-sql` 2.6.0 source resolves SQLite files beneath `app.path().app_config_dir()` and appends the connection-string filename.
- The resulting and observed normal database path is `C:\Users\hp\AppData\Roaming\com.tauri.dev\tipia.db`.
- `PRAGMA journal_mode` reported `wal`.

## Verified backup

An SQLite online backup was created through Python's SQLite backup API. The source was opened using a read-only URI. The backup was created exclusively at a new path and was not used as a replacement for the source.

| Property | Result |
|---|---|
| Backup path | `C:\Users\hp\Documents\Mini-Tipia-database-backups\mini-tipia-before-stage-15_5_19_1-20261126T2127.db` |
| Location | Outside the application's database directory |
| Size | 331,776 bytes |
| Filesystem modified time | 2026-11-26T20:31:39.538783+00:00 |
| Backup SHA-256 | `adbb9ac7a616491fc567e9f2b485fcbd83de845f930caaba8d5fae0a34e13c78` |
| Independent backup `PRAGMA integrity_check` | `ok` |
| Independent backup `PRAGMA foreign_key_check` | No violations |
| Backup vs source ledger | Exact match |
| Backup vs source business counts | Exact match |

## Migration status and checksums

The runner registers versions 001, 002, and 003 in order. It calculates SHA-256 over each embedded SQL string's bytes, verifies prior migration names/checksums, and applies pending migrations inside a `BEGIN IMMEDIATE` transaction with commit/rollback handling.

All three ledger entries were present before startup, exactly once and in order. Their checksums matched the current migration SQL bytes:

| Version | Name | Ledger and embedded SHA-256 | Applied at (UTC) |
|---:|---|---|---|
| 1 | `001_reconciled_initial_schema` | `2954533e160563e3501bc1096fb28e0dcd691926f98c6c096112bc1555f100e8` | 2026-11-25T22:11:04Z |
| 2 | `002_delivery_inventory_association` | `dd0887ef67b4589ea7164ef82667aa8be1fc5a3c7bf7145aea7eae3f00b9c898` | 2026-11-26T13:01:49Z |
| 3 | `003_received_delivery_inventory_association_guards` | `5a76736450953f2eea9c1e9b2d0424df1e37432b992c081d6b37a295a5beb6a8` | 2026-11-26T19:02:23Z |

Migration 003 was already applied before startup. The ledger remained identical afterward, and version 3 appears once. Its three expected association triggers were present after startup. No migration SQL was pending or manually run during verification.

## Baseline and post-startup integrity

Read-only checks were run against the normal database before startup, against the independently opened backup, and against the normal database after startup.

| Check | Before | Backup | After |
|---|---|---|---|
| `PRAGMA integrity_check` | `ok` | `ok` | `ok` |
| `PRAGMA foreign_key_check` | No violations | No violations | No violations |
| `journal_mode` | `wal` | `wal` | `wal` |
| Migration ledger | Versions 1–3, expected checksums | Exact source match | Exact baseline match |

### Business-record counts

Counts are from the actual schema tables. `sales` contains completed Sales; `deliveries` is split by its `received` and `draft` statuses.

| Collection/table | Before startup | Backup | After startup |
|---|---:|---:|---:|
| Products (`products`) | 0 | 0 | 0 |
| Variants (`variants`) | 0 | 0 | 0 |
| Packaging levels (`packaging_levels`) | 0 | 0 | 0 |
| Inventory records (`inventory_records`) | 0 | 0 | 0 |
| Batches (`batches`) | 0 | 0 | 0 |
| Activity events (`activity_events`) | 0 | 0 | 0 |
| Completed Sales (`sales`) | 0 | 0 | 0 |
| Received Deliveries (`deliveries`, `status='received'`) | 0 | 0 | 0 |
| Active Sales drafts (`sale_drafts`, `status='draft'`) | 0 | 0 | 0 |
| Active Receive Delivery drafts (`deliveries`, `status='draft'`) | 0 | 0 | 0 |
| Sales draft items (`sale_draft_items`) | 0 | 0 | 0 |
| Delivery items (`delivery_items`) | 0 | 0 | 0 |

The normal database file remained 331,776 bytes, with the same observed modification time. The zero counts describe the current SQLite database; they do not prove that earlier in-memory/demo-backed business data was deleted.

## Controlled startup and UI observation

- **Exact command:** `npm run tauri dev` (the existing `package.json` script invokes `tauri dev`; `tauri.conf.json` runs `npm run dev` as `beforeDevCommand`).
- Vite reported ready at `http://localhost:5173/`; Cargo finished the debug build and ran `target\debug\app.exe`.
- The command output contained Rust dead-code warnings for migration helper functions, but no build or startup error.
- The actual Tauri window title was `mini-tipia inventory`. Its observed UI showed the `Pharmacy Management` heading and all six normal navigation entries.
- The Dashboard showed no pending workflows and zero affected products/variants.
- The Products page showed “No products yet” and “Showing 0 of 0 products”; Inventory showed “No inventory found.”
- The UI displayed the SQLite-loaded/in-memory-not-saved status. It was the normal interface, not the temporary read-only verification screen.
- This was observed in the live Tauri window through its accessibility state. No business workflow action was taken; navigation was used only to inspect the Products and Inventory empty states.

## Data preservation and scope

No business records were created, deleted, or modified by this verification. Pre/post business counts and the migration ledger are identical. No demo data was injected. No source code, schema, or migration files were changed; the only repository file created for this stage is this report. The external SQLite backup is an additional safety copy and was not restored over the normal database.

The Tauri application and development session remain running after verification; they were not terminated. Workflow edits remain in-memory only, as documented in Stage 15.5.19. This stage did not implement or test Stage 15.6 write persistence.

## Remaining limitations

The verified SQLite collections are empty. This confirms the live interface handles the current empty database without injecting demo data, but there were no persisted business rows available to validate individually. This verification does not recover or establish the existence of earlier in-memory data.
