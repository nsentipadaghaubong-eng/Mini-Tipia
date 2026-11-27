# Stage 15.5.13 — ApplicationState Cutover Plan

This plan is inspection-only. It does not connect the loader to `App.tsx`, add a hydration action, change UI, or implement persistence.

## Ordered implementation stages

### Stage A — Define the persisted-state envelope and lifecycle contract

**Purpose / dependency:** Resolve the current domain/state shape gaps before deciding what can be published. This is prerequisite to the read-boundary and startup work.

**Deliverable**

- An explicit state/load result type that retains the persistence DTO alongside each domain projection where needed.
- A documented lifecycle policy for active versus terminal Sale drafts and received Delivery history.
- An explicit representation for schema-valid active Delivery drafts whose `deliveryDate` or `receivedBy` is NULL.
- A policy for historical Sale/Delivery rows whose typed projection is null: retain them as persistence-only, or fail the whole hydration. Never filter them out.
- A policy for original repository metadata already lost before assembly (NULL distinctions/raw positions); decide whether the existing ordered domain representation is sufficient for current features or whether repository DTO extensions are needed.
- Preservation of received `receivedEventId`, per-item `receivedBatchId`, and receipt JSON. Do not invent a received Inventory-record ID.

**Focused tests**

- Adapter/state mapping tests for all seven `ApplicationState` properties.
- Active Sale and Delivery draft round trips with IDs, relationships, item ordering, prices, timestamps, optional/nullable fields and status.
- Nullable Delivery header rows remain visible and keep product-wide draft locks; no date or recipient is fabricated.
- Approved/cancelled Sale draft and completed Sale relations are either retained in the chosen lifecycle destination or explicitly proven out of scope without loss.
- Malformed/opaque historical snapshots preserve source data or fail according to the explicit policy.
- Received Delivery snapshot, event link, and batch association remain available separately from current domain projection.

**Acceptance criteria**

- Every repository-returned row has exactly one defined destination; none are silently dropped.
- Domain projections are used only when validators succeed.
- Terminal and active records are distinct; only active `draft` records contribute to locks.
- Current UI-facing domain types do not receive invented values.
- No schema change is made unless an approved product requirement calls for information absent from Migration 001.

**Exit condition:** A typed candidate-state mapping can preserve every loader record and identify every intentionally domain-projected versus persistence-only field.

### Stage B — Establish a consistent read boundary

**Purpose / dependency:** Make the seven-repository assembly internally coherent before users can operate on it. Depends on Stage A's exact required dataset and lifecycle policy.

**Deliverable**

- Either a backend-supported single SQLite read transaction/snapshot shared by all required repository queries, or an explicitly enforced and tested no-writer/single-instance startup window for the full load.
- Keep repository SQL/read behavior unchanged unless a narrowly identified defect blocks the chosen boundary; no writes or migration changes.
- Keep `loadApplicationData` failure all-or-nothing and ensure validation happens before publication.

**Focused tests**

- An isolated database test that changes a related Product/Inventory/draft relationship between query steps and proves the loader sees one snapshot or rejects/blocks the concurrent writer under the selected policy.
- Existing loader per-repository failure tests remain valid.
- Verify no records/quantities/statuses change as a consequence of reads.
- Test relationship checks against the same snapshot used for projection.

**Acceptance criteria**

- The consistency guarantee is demonstrated, not inferred from `Promise.all`.
- The chosen boundary uses the existing SQLite pool and Migration 001 database; it does not create a second pool or touch the normal database.
- Read-only hydration performs no DML and all repository errors remain explicit.

**Exit condition:** A bounded, tested guarantee states whether all collections are one SQLite snapshot, and that guarantee applies to the actual query path used by hydration.

### Stage C — Add fail-closed candidate hydration and startup gating

**Purpose / dependency:** Load persisted state without exposing partial/demo-backed state. Depends on Stages A and B.

**Deliverable**

- A coordinator that awaits `initializeDatabase()` (database open, foreign-key verification and migration) before reads.
- A candidate builder that loads all required sources, applies Stage A mapping, runs cross-collection validation and publishes through one explicit whole-state replacement/hydration action.
- An App readiness state (`loading`, `ready`, `failed`) that gates operational pages until the full candidate is published.
- A blocking initialization/load failure screen with an actionable retry; no demo fallback and no partial state.
- An idempotent boot/read promise or equivalent deduplication safe under React StrictMode remounts, with stale retry/unmount protection.
- Empty persisted state remains empty.

**Focused tests**

- App tests prove pages/actions are unavailable before the complete load and remain unavailable after DB, migration, repository, mapping or validation failure.
- A failure in each repository publishes no partial state and does not display demo data.
- Empty DB publishes empty domain collections.
- Successful load publishes exactly once after every read and validation succeeds.
- StrictMode/remount/retry tests prove no duplicate publication, stale result or stuck rejected initialization promise.
- Existing `applicationState` reducer tests verify hydration is a replacement, not a workflow action that changes stock or emits Activity.

**Acceptance criteria**

- Database initialization completes before any persisted data is exposed.
- No ready state is possible with a partial loader result, incompatible dropped row, or demo-backed fallback.
- Failure message identifies initialization/loading failure and retry starts a fresh attempt.
- No business workflow reducer is invoked during hydration.

**Exit condition:** Startup can only reach ready with one complete, validated candidate; all failure cases remain blocked and visibly failed.

### Stage D — Make page behavior compatible with persisted and persistence-only data

**Purpose / dependency:** Ensure pages preserve the existing workflow semantics and do not imply that read hydration created write persistence. Depends on Stage C's ready-state contract.

**Deliverable**

- Safe presentation/lock behavior for persistence-only active Delivery drafts and persistence-only historical Sale/Delivery entries.
- Historical received Delivery detail rendering uses its receipt snapshot (or clearly routes to Activity snapshot detail), not current Product names as historical truth.
- Activity page wording describes persisted history rather than “this session”.
- An explicit read-only mode that disables mutation/approval actions until a separately scoped write-persistence implementation is complete, or a separately approved behavior that retains the current in-memory editing warning. The recommended cutover is read-only mode.
- Preserve Product-wide active-draft locking before Product and Inventory controls become available.

**Focused tests**

- Page tests for loaded state, nullable-header drafts, received history after Product changes/deletion, and Activity event snapshot presentation.
- Lock tests confirm a persistence-only active Delivery still blocks Product/Inventory structure changes.
- Read-only tests confirm no reducer-mutating action can be triggered from edit, draft, adjustment, cancellation, or approval UI while in read-only mode.
- Dashboard count/navigation tests use only active drafts and do not count received/terminal records as pending.

**Acceptance criteria**

- No persistence-only row disappears from its required read view or lock calculation.
- Historical names/details come from transaction-time snapshots, not current records.
- UI does not claim workflow changes are saved; in recommended read-only mode no such mutations are offered.
- Completed Sales, received Deliveries, and active drafts remain lifecycle-distinct.

**Exit condition:** Every page exposed after hydration handles the chosen state contract without fabricated data, broken locks, or implied write support.

### Stage E — Isolated end-to-end cutover verification

**Purpose / dependency:** Confirm the real desktop SQLite read path and complete integration behavior after Stages A–D.

**Deliverable**

- A focused test harness using a temporary isolated database and the actual registered Tauri readonly query path (not `sqlite:tipia.db`).
- Final integration report with exact tested command(s), failure behavior, consistency guarantee, and remaining write-persistence boundary.

**Focused tests**

- Successful desktop startup with empty and populated isolated fixtures.
- Failure paths for connection/foreign-key verification, migration, one repository, candidate validation and retry.
- Full-state relationship/lifecycle mapping, read-only UI behavior, and no mutations from hydration.
- Focused TypeScript/build/lint and directly related existing tests only.

**Acceptance criteria**

- The production startup coordinator uses the same tested read boundary and candidate mapping.
- Isolated fixtures prove no DML or normal database access.
- The loader and application state remain all-or-nothing under the real query command.

**Exit condition:** A reviewer can reproduce the isolated end-to-end checks, and all Stage 15.5.8 acceptance criteria relevant to read hydration are satisfied or explicitly deferred.

## Separate future stage: write persistence

Read-only hydration does not make subsequent actions durable. Do not add Product/Inventory/Sale/Delivery/Activity writes as part of these stages. A later write-persistence project must separately prove transactional approval, rollback, idempotency/replay, and preservation of product-wide draft locks. Until then, the integrated application should remain explicitly read-only.

## Overall cutover acceptance

Cutover is safe only when every persisted row has a non-lossy destination (domain or retained persistence-only envelope), the cross-repository read consistency policy is proven, SQLite initialization and all reads precede one whole-state publish, no demo/partial data is exposed on failure, nullable drafts do not disappear or lose locks, historical displays use snapshots, and no UI suggests that non-existent database writes are durable.
