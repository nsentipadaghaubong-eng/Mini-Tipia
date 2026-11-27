# Stage 15.5.4 — Activity Read Repository

## Summary

Implemented `getAllActivityEvents()` as a read-only repository over the existing `activity_events` table. It returns the complete serialized `ActivityEvent` payload, checks that the duplicated indexed metadata agrees with that payload, and does not depend on current Product or Inventory rows. The repository is not connected to application startup, state, or UI.

## Files created

- `src/persistence/repositories/activityRepository.ts`
- `src/persistence/repositories/activityRepository.test.ts`
- `stage_15_5_4_activity_read_repository_report.md`

No existing files were modified for this stage. Existing unrelated worktree changes were preserved.

## Schema-to-domain mapping

Migration 001 defines `activity_events` with an autoincrementing `event_sequence`, unique `event_id` and `operation_key`, constrained `event_type`, required `occurred_at` and non-empty `event_json`, and nullable `actor_id`. The table has no Product or Inventory foreign keys, and update/delete triggers make it append-only.

The repository queries only `activity_events`, without joins:

| SQLite column | Domain mapping |
|---|---|
| `event_id` | `ActivityEvent.eventId` |
| `operation_key` | `ActivityEvent.operationKey` |
| `event_type` | `ActivityEvent.type` |
| `occurred_at` | `ActivityEvent.occurredAt` |
| `actor_id` | Optional `ActivityEvent.actorId`; SQL `NULL` corresponds to an omitted property |
| `event_json` | Parsed full event object, including event-specific values and historical snapshots |
| `event_sequence` | Ordering tie-breaker only; not exposed in the domain event |

Events are ordered by `occurred_at` newest first using SQLite date-time ordering; equal timestamps retain insertion order through `event_sequence ASC`. The timestamp string itself is returned unchanged; the repository does not convert it to local time. Any Africa/Lagos display formatting remains a presentation responsibility.

The JSON must be an object with a supported Activity event type and the required top-level fields for that union member. Its `eventId`, `operationKey`, `type`, `occurredAt`, and optional `actorId` must match their indexed columns. Invalid JSON, unsupported or malformed event payloads, and metadata mismatches reject the read rather than returning partial or success-shaped data. Valid event payloads are returned as parsed without rebuilding or rewriting their snapshots.

## Historical data handling

The query deliberately does not join `products`, `variants`, `batches`, or inventory tables. Therefore events retain stored Product, Variant, Batch, and other identifiers and snapshots even when the corresponding live records no longer exist. The repository creates no events and performs no writes.

## Test coverage and results

Repository tests execute against isolated `node:sqlite` in-memory databases initialized from the actual Migration 001 SQL. The existing read-query boundary is mocked only to execute the repository's fixed query against that isolated database.

Covered cases:

- Empty Activity history.
- Multiple event types and timestamps, including stable ordering for equal timestamps.
- Full payload and historical snapshot preservation.
- An event referring to a Product/Inventory history snapshot with no live Product row.
- Nullable supplier/invoice fields and omission of a nullable actor.
- Rejection when JSON metadata disagrees with indexed columns.
- Rejection of malformed event JSON.
- Assertion that the repository query reads Activity without live-table joins.

Checks run:

| Command | Result |
|---|---|
| `npx vitest run src/persistence/repositories/activityRepository.test.ts src/persistence/repositories/productRepository.test.ts src/persistence/repositories/inventoryRepository.test.ts` | Passed: 3 files, 14 tests |
| `npx tsc -p tsconfig.app.json --pretty false` | Passed |
| `npx eslint src/persistence/repositories/activityRepository.ts src/persistence/repositories/activityRepository.test.ts src/persistence/repositories/productRepository.ts src/persistence/repositories/inventoryRepository.ts` | Passed |
| `npx vitest run src/activity/activity.test.ts src/activity/activityPresentation.test.ts src/persistence/repositories/activityRepository.test.ts` | Passed: 3 files, 26 tests |
| `npm run build` | Passed; Vite reported that a minified output chunk exceeds 500 kB |

## Limitations and carry-forward items

- Validation checks the supported event type, required top-level payload shape, and duplicated metadata. It preserves nested snapshot data verbatim; it does not recursively validate every nested field in every event snapshot.
- The read path assumes event JSON is serialized using the selected full-`ActivityEvent` contract. The database schema itself enforces non-empty JSON text, not the payload structure.
- The previously documented Windows Rust test cleanup issue (OS error 32) was not changed or investigated in this stage.
- Price precision and safe monetary-total validation remain carry-forward requirements before implementing money-writing persistence. This Activity read repository does not perform monetary calculations or writes.

## Scope confirmation

No schema, UI, application state, business workflow, Product/Inventory behavior, production database, or database contents were changed. Tests used only in-memory databases. The repository remains read-only and unintegrated, and work stops at Stage 15.5.4.
