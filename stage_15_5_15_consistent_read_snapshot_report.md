# Stage 15.5.15 — Consistent SQLite Read Snapshot

## Result

The read-only application data loader now obtains all repository query results through one native SQLite read-snapshot operation. The seven repositories still provide the same eight data collections; Products, Inventory records/batches, Activity, completed Sales, received Deliveries, active Sales drafts, and active Receive Delivery drafts are parsed and validated by their existing repository logic.

The loader uses a scoped query executor to collect the repository SELECTs, then sends them together to the Rust/SQLx command `query_sqlite_readonly_snapshot`. The repositories continue to default to `querySqlite` when called independently, so standalone reads retain their existing behavior.

## Snapshot boundary

1. `loadApplicationData()` creates one `SqliteReadSnapshotExecutor` and passes its query function to each of the seven existing repository reads.
2. The reads queue their SQL text and bound parameters. Inventory remains one query that produces both Inventory records and Inventory batches.
3. The executor initializes the existing database boundary and invokes the native command once with all queued query descriptors. Result order is mapped back to the corresponding repository promise.
4. Rust validates a non-empty batch of at most 16 queries. Each query must be one SELECT or WITH statement under the existing multi-statement scanner. Values are converted and bound using the existing scalar parameter rules; SQL is never concatenated with parameter values.
5. Rust obtains the existing `sqlite:tipia.db` pool from the SQL plugin's `DbInstances`, acquires one pooled connection, enables SQLite `query_only`, and runs all validated SELECTs sequentially inside one deferred read transaction on that connection. The first read establishes SQLite's transaction snapshot.
6. On success, Rust commits before restoring the connection's prior `query_only` setting. On a query failure it explicitly rolls back, restores the setting, and returns an error; if restoring connection mode fails, the connection is discarded rather than returned in an uncertain mode. A failure from any repository still rejects the overall loader operation.

The scope is limited to repository reads used by the loader. No connection is held across multiple frontend/native invocations, and no second pool or UI-facing arbitrary executor was introduced.

## Consistency conclusion

**All eight application data collections are now assembled from one consistent SQLite read snapshot.** The loader's repository functions are still started together at the TypeScript level, but their queries are only queued there; the database executes them serially within the single Rust transaction. Concurrency of JavaScript promises is not relied on for consistency.

The deterministic Rust test pauses after the first SELECT, commits a write from a second pool connection while the read transaction remains open in WAL mode, then resumes the next SELECT. Both reads observe the pre-write count; a later independent read observes the committed row.

## Compatibility, security, and scope

- Repository SELECT text, bound parameters, output shape, parsing, ordering, nullable handling, validation, and error wrapping remain in the existing repository implementations.
- Standalone repository reads still use `query_sqlite_readonly` through `querySqlite`.
- The batch endpoint accepts only read queries. It rejects mutation/schema statements and multi-statement SQL; SQLite `query_only` also blocks writes hidden behind a WITH clause.
- The SQL plugin remains limited to its existing load/close capabilities. No raw SQL plugin `select` or `execute` permissions were added. The existing Rust/SQLx command boundary and pool are reused.
- The `sqlite:tipia.db` key identifies the existing plugin pool. Tests use temporary SQLite files or an in-memory Node SQLite database; the normal user database was not accessed.
- No migration/schema, historical serialization, business workflow, `ApplicationState`, `App.tsx`, startup, or UI integration was changed. The missing received Inventory-record association remains unresolved and out of scope.

## Remaining limitations

- The read is consistent within each invocation; separate loader invocations naturally may observe different database states.
- The batch is capped at 16 SELECTs. The current loader submits seven (Inventory contributes two collections).
- SQLite journal mode controls concurrent writer scheduling. The read transaction preserves its snapshot; in rollback-journal mode SQLite may defer a writer's commit until the reader completes.
- Existing dead-code warnings in the previously added migration module remain unrelated to this stage.

## Validation

See [stage_15_5_15_consistent_read_snapshot_test_results.md](./stage_15_5_15_consistent_read_snapshot_test_results.md) for exact commands, final outcomes, initial failures and corrections.
