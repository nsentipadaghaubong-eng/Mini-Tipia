# Stage 15.6.2 — Append-only Activity Write Foundation

## Result

Implemented a shared, append-only Activity insert foundation. The writer validates and serializes the existing `ActivityEvent` contract, builds a parameterized insert for the current `activity_events` schema, and exposes the exact expected row count to both standalone and composed transaction callers.

No business workflow or UI handler uses the writer yet. Product, Inventory, Sales, Receive Delivery, ApplicationState, startup/hydration, migrations, the normal database, and its verified backup were not changed or accessed.

## Files changed

- `src/persistence/repositories/activityWriteRepository.ts` — new production insert mapping and writer API.
- `src/persistence/repositories/activityWriteRepository.test.ts` — isolated SQLite tests for mapping, validation, constraints, immutability, and rollback.
- `stage_15_6_2_activity_write_foundation_report.md` — this report.

Existing worktree changes were preserved. No existing source, migration, or test file was overwritten.

## Writer API

`createActivityInsert(event)` returns an `ActivityInsert`:

- `statement`: a `SqliteStatement` with a fixed `INSERT INTO activity_events` query and six bound parameters in schema order.
- `expectedRowsAffected: 1`: a literal expectation available to transaction callers.

The parameter order is `event_id`, `operation_key`, `event_type`, `occurred_at`, nullable `actor_id`, and `event_json`. Event values are never interpolated into SQL.

`insertActivityEvent(event)` is the standalone convenience path. It sends the insert through the existing `executeTransaction`, then calls `assertActivityInsertRowsAffected`; it resolves only when the transaction reports exactly one affected row.

Later multi-table writers must not call `insertActivityEvent` separately from their workflow transaction. Instead:

1. Build the descriptor with `createActivityInsert(event)`.
2. Add `descriptor.statement` to the same statement array as the workflow DML.
3. Execute that array once through `executeTransaction`.
4. Pass the corresponding result entry to `assertActivityInsertRowsAffected(descriptor, rowsAffected[index])`.

The helper rejects zero, multiple, or missing result counts. Duplicate event IDs and operation keys are not caught or ignored by the repository; SQLite’s unique constraints reject them and the transaction error propagates to the caller.

## Validation and serialization

Before any statement is returned:

1. `serializeActivityEvent(event)` applies the existing runtime validator for the typed event union and its nested snapshot fields. This rejects malformed, unsupported, or invalid nested event values.
2. The serialized JSON and relational metadata are passed to `parseActivityEvent`. This verifies that `eventId`, `operationKey`, `type`, `occurredAt`, and actor metadata agree with the serialized payload.
3. Only the validated serialized metadata is used to form the parameter list.

An event without `actorId` is persisted as SQL `NULL`; the existing parser then reads it back without introducing an `actorId` property. No event fields or schema columns were added. Activity remains append-only; there is no update or delete API.

## Tests and exact validation results

New tests create an in-memory `DatabaseSync`, enable foreign keys, and apply the existing Migration 001, Migration 002, and Migration 003 SQL files. They cover:

- Product-created and received-Delivery events inserted through the production serializer/mapping and read back with the existing Activity reader.
- All six persisted columns, complete event JSON, and nullable actor metadata.
- Rejection of malformed nested data, an unsupported event type, and JSON whose metadata conflicts with the relational values, before any transaction call.
- Duplicate event ID and duplicate operation key errors from the database’s existing unique constraints.
- Explicit expected-row assertion for exactly one row, including rejection of zero, two, and missing results; the standalone writer also rejects a zero-row transaction result.
- Existing Activity UPDATE and DELETE triggers.
- A transaction rollback case with valid DML before a duplicate Activity insert; the preceding DML is rolled back and the original Activity row remains.

Commands run:

| Command | Result |
|---|---|
| `npm test -- --run src/persistence/repositories/activityWriteRepository.test.ts src/persistence/repositories/activityRepository.test.ts src/persistence/historicalSerialization.test.ts src/persistence/transaction.test.ts` | Passed: 4 files, 28 tests |
| `npx eslint src/persistence/repositories/activityWriteRepository.ts src/persistence/repositories/activityWriteRepository.test.ts` | Passed |
| `npm run build` | Passed: TypeScript project checks and Vite production build |
| `git diff --check` | Passed (Git also printed pre-existing LF-to-CRLF working-copy warnings for other modified files) |

The build emitted Vite’s existing-style warning that a minified JavaScript chunk exceeds 500 kB. No Rust code changed, so Rust tests were not run. The complete Vitest suite was not run.

The rollback test uses an in-memory SQLite transaction adapter for the mocked frontend transaction boundary; it executes the generated DML against the real SQLite engine and proves the batch’s rollback behavior. The native Rust transaction implementation was not changed or invoked by this test. Existing Rust transaction code remains responsible for the production atomic batch boundary.

## Limitations

- This stage provides the reusable SQL descriptor and standalone insert function; no business write workflow is connected.
- A caller composing an Activity insert into a larger transaction must check the Activity descriptor’s row count at its result-array position. The SQL transaction may already have committed before a caller that ignores this check can detect a count mismatch.
- The caller remains responsible for handling transaction errors, unique conflicts, and post-commit ApplicationState synchronization. No retry or idempotency behavior was introduced.
- Activity validation follows the existing serializer/parser contract and current migration event-type constraint. Adding event kinds still requires a separately reviewed schema/application compatibility change.

## Scope and preservation confirmation

No Product, Inventory, Sales, or Receive Delivery handler was connected to SQLite. No business workflow persistence, reducer/state/startup/UI change, schema edit, or migration was added. The normal Mini-Tipia database and verified backup were not opened, written, reset, seeded, or modified. Existing staged, unstaged, and untracked work was preserved.

**Stage 15.6.2 is complete. Stage 15.6.3 was not started.**
