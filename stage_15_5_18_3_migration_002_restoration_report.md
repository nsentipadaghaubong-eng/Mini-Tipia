# Stage 15.5.18.3 — Migration 002 Restoration Report

## Result

Migration 002 was restored byte-for-byte to the recovered original's CRLF representation. Its final size is 987 bytes and its SHA-256 is `dd0887ef67b4589ea7164ef82667aa8be1fc5a3c7bf7145aea7eae3f00b9c898`, matching the applied checksum. The final file bytes exactly equal the recovered Git blob's LF bytes converted to CRLF; independent hashing found 28 CRLF sequences and no bare line endings.

The later, useful Delivery/Inventory protections were moved into forward-only Migration 003. Migration 001 and the checksum-verification logic were not changed. The normal application database was not opened, targeted, or modified; this source correction does not establish that the normal app has started successfully or that its database has been repaired.

## Trigger assessment

The pre-restoration Migration 002 contained three triggers:

| Trigger | Difference from recovered original | Assessment and action |
|---|---|---|
| `delivery_receipt_requires_inventory_association` | Modified from requiring a matching Inventory row at the `draft` → `received` transition to requiring a non-empty ID and checking identity only if a row with that ID already exists. | Necessary for the documented receipt workflow: Migration 001's active-draft lock prevents inserting a new Inventory record while its Delivery remains a draft. The receipt transition releases that lock so a preplanned Inventory ID can be materialized afterward. Migration 003 replaces the original trigger with this behavior and rejects a mismatching row if it already exists. |
| `inventory_record_received_delivery_association_insert` | Added. | Necessary because the association is deliberately not a foreign key and an Inventory ID may be reused after its record is deleted. A matching received Delivery association rejects later insertion of a record with a different Product, Variant, or batch identity. Added to Migration 003. |
| `inventory_record_received_delivery_association_update` | Added. | Necessary because Migration 001's Inventory identity lock covers active drafts, not received Delivery history. This trigger prevents changing an associated record's ID, Product, Variant, or batch after receipt. Stock quantities remain mutable in `inventory_stock`. Added to Migration 003. |

The original Migration 002 receipt trigger checked that the associated Inventory row already existed and matched. That behavior cannot support the planned-ID write order above. Migration 003 replaces it only after Migration 002's original checksum has been restored. No foreign key or deletion prohibition was added: the association intentionally retains its text ID if the Inventory row is deleted, and the read model can represent that unresolved association.

The earlier migration rationale and active-draft behavior are documented in [`stage_15_5_16_delivery_inventory_association_report.md`](stage_15_5_16_delivery_inventory_association_report.md) and [`migration_001.sql`](src-tauri/src/migrations/migration_001.sql).

## Migration 003

New [`migration_003_received_delivery_inventory_association_guards.sql`](src-tauri/src/migrations/migration_003_received_delivery_inventory_association_guards.sql):

1. Replaces `delivery_receipt_requires_inventory_association` with the planned-ID-compatible check.
2. Adds the received-delivery Inventory insert identity guard.
3. Adds the received-delivery Inventory update identity guard.

[`migrations.rs`](src-tauri/src/migrations.rs) registers version 3 as `003_received_delivery_inventory_association_guards` and reports migrations through version 3. The existing migration ledger mechanism checks the migration's checksum, applies it transactionally after versions 1 and 2, and makes later initialization a no-op. Migration 003 does not update or backfill application rows.

## Isolated validation

Ran `cargo test migrations::tests --lib` from `src-tauri`: **8 passed, 0 failed**. The tests use temporary databases under the system temp directory; none target the normal application database.

Coverage includes:

- Fresh database application of versions 1, 2, and 3, including exact Migration 002 checksum, ordered ledger entries, Migration 003 checksum/name, foreign-key check, integrity check, and no-op reinitialization.
- An original-version-2 fixture with a received Delivery association before Migration 003. The upgrade retains the existing Delivery and association, and rerunning initialization does not reapply migrations.
- Rejection of Inventory identity changes and mismatched ID reuse; acceptance of matching ID reuse and planned Inventory insertion after receipt; continued blocking of Inventory insertion while the draft is active; and continued allowance of stock-quantity changes.

`cargo fmt --check -- src/migrations.rs` passed. `git diff --check` reported no whitespace errors; it emitted existing LF-to-CRLF notices for unrelated modified files. No production build or full application test suite was run.

## Files changed in this stage

- [`migration_002_delivery_inventory_association.sql`](src-tauri/src/migrations/migration_002_delivery_inventory_association.sql) — restored original content and checksum-producing CRLF bytes.
- [`migration_003_received_delivery_inventory_association_guards.sql`](src-tauri/src/migrations/migration_003_received_delivery_inventory_association_guards.sql) — added forward-only schema protections.
- [`migrations.rs`](src-tauri/src/migrations.rs) — registered Migration 003 and added isolated migration coverage.
- `stage_15_5_18_3_migration_002_restoration_report.md` — this report.

Pre-existing unstaged modifications and untracked files were preserved; the initial status showed no staged changes. No schema or ledger changes were made to the normal database.

## Limitations

- Normal-app startup and Migration 003 application to the normal database remain unverified. Do not treat this source correction or isolated test success as proof of a database repair.
- The planned-ID behavior permits a non-empty association to have no Inventory row at the instant a Delivery becomes received. A future persistent Receive Delivery writer must create the Delivery and resulting Inventory data atomically; that write workflow is not part of this stage.
- The association remains a historical text ID rather than a live foreign key. Deletion can leave an explicitly unresolved association, by design.
