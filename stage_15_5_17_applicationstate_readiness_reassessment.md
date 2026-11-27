# Stage 15.5.17 — ApplicationState Integration Readiness Reassessment

## Verdict

**PARTIALLY READY.**

Stages 15.5.14–15.5.16 resolve the core read-model blockers: the loader has a shared SQLite read snapshot, the hydration model retains each of its eight loader collections with its source record and optional domain projection, nullable Delivery drafts remain persistence-only, and received Delivery items retain their recorded Inventory association (or explicitly unresolved legacy state).

Mini-Tipia is **not ready to expose that data through the existing interactive `ApplicationState` workflows**. `App.tsx` still initializes demo data and only initializes the database; it never calls the loader or hydration builder. The app remains interactive while SQLite initializes and after initialization failure. Domain-only workflow state also has no destination for persistence envelopes or persistence-only rows. Reading SQLite is not equivalent to persisting workflow changes.

The smallest safe next step is a fail-closed, read-only hydration bootstrap that retains the hydration model separately from `ApplicationState`, gates the demo-backed workflows, and exposes only a minimal read-only readiness summary. Do not enable workflow mutations or claim write persistence in that stage.

## Evidence basis and inspection limits

Reviewed the requested Stage 15.5.13–15.5.16 reports, current `src/applicationState.ts`, `src/App.tsx`, `src/main.tsx`, the loader, hydration model, query executor, database initializer, domain adapters, historical serialization, all seven loader repositories, the approval plan, migration executor, and migrations 001 and 002.

The worktree was already modified and contained numerous untracked Stage 15.5.x reports and persistence files. The existing `App.tsx`, `applicationState.ts`, Rust/Tauri files, and other listed modifications were left intact. This stage adds only this report. No database was opened, no migration was run, and no tests/builds were run; test outcomes referenced below are those reported in Stage 15.5.16, not independently rerun here.

## Original blocker assessment

| Blocker | Current status | Evidence and concrete remaining gap | Smallest appropriate next action |
|---|---|---|---|
| 1. Lossless application data representation | **READY at the hydration-model boundary; not integrated into ApplicationState.** | `ApplicationStateHydration` in [applicationStateHydration.ts](./src/persistence/applicationStateHydration.ts) contains Products, Inventory records, Inventory batches, Activity events, completed Sales, received Deliveries, active Sale drafts, and active Delivery drafts. Its `HydratedRecord` keeps `sourceRecord`, an available or persistence-only `domainProjection`, and `persistenceOnlyFields`. Historical opaque rows and nullable-header drafts are retained instead of filtered out. `createApplicationStateHydration()` maps all eight collections. The upstream Product and Inventory repositories already collapse some SQL NULL distinctions and numeric positions; the loader reports these in `persistenceLimitations`, and hydration cannot restore information the repositories do not return. The loader also intentionally returns only active Sale drafts, not every terminal Sale-draft row. | Keep the hydration model as the integration source of record; carry forward its limitations and active-only lifecycle scope. Do not map it to domain arrays by filtering null projections. Decide terminal-draft archive behavior before claiming complete lifecycle reconstruction. |
| 2. Nullable Delivery drafts | **READY in the read model.** | `adaptPersistedDeliveryDraft()` in [domainAdapters.ts](./src/persistence/domainAdapters.ts) returns `domain: null` and the incompatible headers when `deliveryDate` or `receivedBy` is NULL; it does not fabricate values. `hydrateActiveDeliveryDraft()` in [applicationStateHydration.ts](./src/persistence/applicationStateHydration.ts) verifies and retains the original DTO as `persistence-only`. Focused hydration tests documented in Stage 15.5.16 cover the nullable-header case. However, the existing `DeliveryDraft[]` state and consumers cannot represent or lock such a row without an additional integration contract. | Preserve persistence-only drafts alongside domain drafts in the read-only integration model. Before enabling Product/Inventory workflows, define and test how those rows remain visible and contribute to active-draft locks. |
| 3. Consistent read snapshot | **READY for the current loader path.** | `loadApplicationData()` in [applicationDataLoader.ts](./src/persistence/applicationDataLoader.ts) passes one `snapshot.query` to every repository read and awaits `snapshot.execute()` before awaiting/assembling results. [query.ts](./src/persistence/query.ts) queues the query descriptors and invokes `query_sqlite_readonly_snapshot` once. The native handler in [persistence.rs](./src-tauri/src/persistence.rs) acquires one pool connection; `execute_read_snapshot_transaction()` runs the reads sequentially inside one SQLite transaction on that connection, with query-only mode enabled. This verifies the actual path rather than relying on `Promise.all`. The Stage 15.5.15 report records a deterministic concurrent-writer snapshot test; it was not rerun during this inspection. This guarantee is per loader invocation, not across separate invocations. | No consistency-boundary work is currently blocking hydration. Keep the loader using this executor and its focused snapshot regression test. |
| 4. Received Delivery / Inventory association | **READY as preserved/read historical metadata; persistence workflow still absent.** | `prepareDeliveryApproval()` in [deliveryApproval.ts](./src/deliveries/deliveryApproval.ts) emits one association per item from the exact selected/created Inventory record and batch. `applicationReducer` validates submitted associations against its deterministic plan. The Stage 15.5.16 migration [migration_002_delivery_inventory_association.sql](./src-tauri/src/migrations/migration_002_delivery_inventory_association.sql) adds `received_inventory_id` and consistency triggers without a foreign key to mutable Inventory rows. [receiveDeliveryRepository.ts](./src/persistence/repositories/receiveDeliveryRepository.ts) reads that ID without deriving it through current Product/Inventory joins. Hydration retains the source ID and labels it recorded/present, recorded/not-currently-present, invalid, or unresolved. Legacy rows with no recorded value remain explicitly unresolved; no backfill is inferred. The source association and receipt snapshots are independent of current stock/catalog data, although hydration consults current Inventory only to classify target presence/identity. No Delivery write repository currently persists the planned association and stock changes. | Retain this sidecar and its legacy unresolved state. Implement no association writer as part of read hydration; atomic Delivery writes require a distinct stage. |
| 5. Startup and failure safety | **NOT READY for SQLite-backed application integration.** | [main.tsx](./src/main.tsx) mounts `App` under `StrictMode`. `App` initializes `applicationState` with `createInitialApplicationState()`; that initializer in [applicationState.ts](./src/applicationState.ts) returns demo Products and Inventory/batches. The `App` effect calls only `initializeDatabase()`; it does not call `loadApplicationData()` or `createApplicationStateHydration()`. All pages remain rendered and their handlers remain enabled during connection and after failure. The status text explicitly says data is in memory and not saved, which mitigates false claims, but it does not prevent users from continuing with demo-backed state or provide a fail-closed retry/hydration flow. StrictMode can also cause independent boot attempts; the database initializer deduplicates connection initialization, not the absent load/hydrate operation. | Add a single boot coordinator: initialize, load, hydrate, then publish atomically. Gate the operational UI while loading and on error; provide explicit retry; never fall back to demo data in a SQLite-ready mode. |
| 6. Domain and persistence boundary | **PARTIALLY READY.** | The hydration model safely retains persistence DTOs, snapshots, associations, and rows without a valid domain projection. In contrast, [ApplicationState](./src/applicationState.ts) has only domain arrays and no hydration action/sidecar. Its initializer is demo-backed, and the reducer contains workflow mutations. `App` pages receive those domain arrays, not the hydration model. Mapping only available projections would drop persistence-only rows; replacing initial values alone would not represent terminal draft history or persistence-only Delivery locks. Existing workflow handlers dispatch reducer actions in memory. A generic [executeTransaction](./src/persistence/transaction.ts) exists, but read hydration does not call it and no workflow persistence boundary is wired into `App`. | Keep the read model distinct from write/workflow state in the first integration stage. Define and test UI projection/locking semantics before enabling domain workflows; implement write repositories and transactional workflows separately. |

### Additional lifecycle and representation limits

- “All eight collections” means all records returned by the Stage 15.5.12 loader contract, not every row in every underlying table. `getAllActiveSaleDrafts()` deliberately selects active drafts. Terminal/cancelled Sale-draft reconstruction remains outside that loader/hydration model; do not silently imply otherwise.
- Product and Inventory are retained as complete loader values, but those repository values are already domain-projected. Numeric ordering positions and some original SQL NULL distinctions are not recoverable. This is an explicit reported limitation, not a hydration-model loss.
- Valid historical projections use the typed Sale/Delivery snapshot codecs and are checked against persisted item columns. Unprojectable historical rows remain persistence-only. No UI has yet been adapted to display these persistence-only rows.
- Database initialization calls the migration executor. This assessment did not invoke it or open `sqlite:tipia.db`. Future tests of the new bootstrap should use isolated databases and must not use a normal user database as a test fixture.

## New issues discovered

No new schema or snapshot defect was found in the inspected loader path. The integration boundary is still absent: the new source records and optional projections are not retained anywhere in the running `App`. This means the successful Stage 15.5.14–15.5.16 data-layer work currently has no effect on user-visible application state.

The existing app does display an explicit “not saved to SQLite” warning during connecting, connected, and failed states. This is better than a success-shaped persistence claim, but it is not a substitute for fail-closed startup: users can still interact with demo data after a database failure, and database connection success currently says nothing about whether application data was loaded.

## Recommended next implementation stage

### Stage 15.5.18 — Fail-Closed Read-Only Hydration Bootstrap

**Objective:** Integrate the existing loader and persistence-aware hydration model into startup without rewriting `ApplicationState`, exposing unrepresentable rows as domain objects, or enabling database writes.

**Bounded deliverable**

1. Coordinate `initializeDatabase()` → `loadApplicationData()` → `createApplicationStateHydration()` as one deduplicated boot attempt.
2. Retain the completed `ApplicationStateHydration` separately from the current domain `ApplicationState`; do not filter persistence-only records or convert the envelopes into domain-only arrays.
3. Gate all existing demo-backed operational pages and mutation/approval handlers while loading and after failure. Show an explicit error and retry path; never report “connected/ready” until read and hydration have succeeded.
4. On success, expose only a minimal read-only readiness summary (counts for each of the eight returned collections plus persistence-only/unresolved counts). Do not enable existing business workflows or imply that data changes are saved.
5. Treat an empty database as a successful empty hydration. Retain the snapshot executor and add focused startup tests using isolated fixtures only.

**Acceptance criteria**

- No operational page or business mutation is available before complete hydration or after a failed attempt.
- No demo values are shown as SQLite data; an empty SQLite database yields zero counts, not demo data.
- Every one of the eight loader collections remains available in the retained hydration model, including original returned DTOs, persistence-only projections, nullable Delivery drafts, and received-item association status.
- A repository, snapshot, projection, or database-initialization failure publishes no ready state or partial result; retry starts a fresh attempt.
- Repeated StrictMode effects do not create duplicate publications or stale results.
- The new startup path performs reads only beyond the existing database initialization/migration lifecycle; no business write, migration/schema change, or business-rule change is included.
- Focused tests cover successful populated/empty startup, representative initialization and load failures, persistence-only retention, and retry. Do not rerun the full suite without a specific failure requiring it.

**Rollback-safe boundary:** This stage changes only the read-only bootstrap and its presentation. It adds no workflow DML or new migration. Reverting the application change must not attempt to reverse already-applied migrations or modify user data. The normal user database must not be used by tests.

### Responsibility sequence after Stage 15.5.18

1. **Loading SQLite data:** already implemented by the repositories and snapshot-backed loader; Stage 15.5.18 wires it into startup.
2. **Retaining persistence-aware hydration:** already implemented by `ApplicationStateHydration`; Stage 15.5.18 keeps it outside `ApplicationState`.
3. **Exposing data to UI:** Stage 15.5.18 exposes only read-only summary counts. A later, separate stage can add read-only domain/history screens that explicitly handle persistence-only rows and legacy associations.
4. **Enabling business workflow mutations:** remains disabled until hydrated records, persistence-only draft locks, and workflow lifecycle semantics are safely supported.
5. **Persisting workflow changes:** remains a separate future project requiring write repositories, atomic workflow transactions, rollback/idempotency behavior, and tests. Hydration does not make Product, Inventory, Sales, Receive Delivery, or Activity mutations SQLite-persistent.

## Explicitly non-persistent workflows

At the current source state, **all** application business workflows remain non-persistent: Product/catalogue creation, edits and deletion; Inventory/batch/stock edits; Sale draft create/edit/cancel and Sale approval; Receive Delivery draft create/edit/cancel and Delivery approval/stock updates; and resulting Activity events. The generic SQLite transaction command is not wired to these handlers. Existing in-memory reducer changes do not become durable merely because a SQLite connection or read snapshot is available.

## Suggested next Copilot prompt

> Implement Stage 15.5.18 only: add a deduplicated, fail-closed, read-only startup bootstrap that awaits SQLite initialization, `loadApplicationData()`, and `createApplicationStateHydration()`, retains hydration separately from demo-backed `ApplicationState`, gates all existing operational pages and mutation handlers until successful hydration, and shows an explicit retryable failure state. On success show only collection and persistence-only/unresolved counts for the eight loader collections. Preserve all existing worktree changes. Do not change repositories, snapshot/transaction boundaries, schema/migrations, business rules, or add workflow write persistence. Add focused isolated-database/startup tests for populated and empty results, failure/no-partial-publication, persistence-only retention, and StrictMode/retry behavior; do not access the normal user database.
