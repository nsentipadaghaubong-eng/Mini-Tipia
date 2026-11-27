# Stage 15.5.7 — Read Repository Integration Readiness Audit

## Executive verdict: NOT READY

The five repositories are useful read-only persistence components, but they are
not yet a complete or lossless source for hydrating the current
`ApplicationState` and resuming its workflows.

Product and Inventory map directly to existing domain types. Activity has a
compatible return type, subject to confirming its event JSON writer contract.
Sales and Receive Delivery return persistence DTOs that do not match the
existing application-state types, and preserve snapshot JSON as `unknown`.
There are no readers for persisted Sales drafts or unfinished Delivery drafts.
Those drafts are required to resume work and preserve product-structure locks.

There is also no application load coordinator or hydration action. `App.tsx`
constructs demo-backed state synchronously, initializes SQLite afterward in an
effect, and continues rendering the interactive application during connection
or after initialization failure. Existing workflow actions update memory only.
Hydrating database records without resolving these concerns would risk
overwriting user activity, losing active drafts, displaying incomplete
historical data, or implying that new changes are persisted.

This verdict is for integration into the current interactive application. The
repositories remain individually usable for read-only inspection or tests.

## Repository findings and domain compatibility matrix

| Repository | Return type and state target | Compatibility | Findings |
|---|---|---|---|
| Product | `getAllProducts(): productStructure[]` → `ApplicationState.products` | **Compatible** | Reconstructs Product → Variant → Packaging hierarchy with persisted IDs and ordering. Nullable optional catalog text is omitted to match optional domain fields. Packaging prices are converted from minor units with precision checks. |
| Inventory | `getAllInventory(): InventoryRepositoryData` → `inventoryRecords` and `inventoryBatches` | **Compatible with coordinated split** | Reconstructs the two existing state collections, preserving Product/Variant/Batch/package IDs, quantities, batch numbers, expiry, and pricing. Expiry is mapped to `Date | null`; nullable batch numbers and expiry remain nullable. Referential checks reject inconsistent live Product/Variant/packaging relationships rather than substituting data. |
| Activity | `getAllActivityEvents(): ActivityEvent[]` → `activityEvents` | **Type-compatible; contract-dependent** | Reads stored event JSON without joining live catalog or stock tables, preserving historical snapshots after deletion. It validates indexed metadata against the JSON and orders newest-first with event-sequence stability for equal timestamps. The Stage 15.5.4 report did not establish a production writer; the repository also cannot deeply validate every nested payload field. |
| Sales | `getAllSales(): PersistedSale[]` → `sales: CompletedSale[]` | **Not directly compatible** | `sales` rows represent completed Sales; `status: "completed"` is inferred from table membership. Cancelled and unfinished drafts are in `sale_drafts` and are not returned. Item rows retain normalized IDs/amounts plus opaque parsed and raw `item_snapshot_json`. `CompletedSaleItem` instead requires typed historical Product, Variant, Batch, and Packaging snapshots. No established snapshot writer/shape exists, so mapping to `CompletedSale` would require guessing or discarding historical data. Safe money conversion rejects unsafe persisted values. |
| Receive Delivery | `getAllReceivedDeliveries(): PersistedReceivedDelivery[]` → `deliveryDrafts: DeliveryDraft[]` | **Not directly compatible** | Returns only `status = 'received'`; drafts are excluded. It preserves normalized item fields and opaque parsed/raw receipt JSON. Existing state uses `DeliveryDraft`, including active drafts and received entries. Supplier field naming differs (`supplierName` vs `supplier`); the repository also has receipt-specific fields not represented by the domain type. `receivedAt` aliases `updated_at`, because the schema has no `received_at` column. No snapshot writer/shape is established. Mapping without a defined contract risks dropping snapshots or receipt metadata. |

### Per-repository details

- **Product:** Optional text and threshold fields follow the existing optional
  domain shape. A missing Product/Variant/packaging relationship causes a
  repository error; it is not silently replaced with a demo or current
  fallback value.
- **Inventory:** The repository returns one object, while state stores the
  `inventory` and `inventoryBatch` arrays separately. Splitting those arrays
  is lossless. The repository validates current Product, Variant and packaging
  links; it does not reconstruct Inventory from Product defaults or perform
  FEFO allocation.
- **Activity:** The Activity type is already a snapshot-oriented event union.
  The repository retains event IDs, JSON payloads, timestamps, and nullable
  actor metadata. Migration 001 does not make Activity depend on live Product
  or Inventory rows. The unresolved writer contract is a persistence concern,
  not a reason to synthesize historical events during reads.
- **Sales:** `sales` is a completed-history table, not a complete view of
  `sale_drafts`. The current `CompletedSale` domain type includes full
  snapshots and optional fields, whereas the repository's history DTO keeps
  snapshot data opaque. Although some normalized columns overlap, no adapter
  can safely construct the required typed snapshots until their persisted
  contract is defined. The repository's money validation is useful, but the
  separately documented safe-range validation requirement remains outstanding
  before money-writing persistence is implemented.
- **Receive Delivery:** The schema's `deliveries` table contains both draft and
  received rows; the repository intentionally returns received rows only.
  Cancelled deliveries are deleted by the existing workflow and represented
  by Activity history, not by a cancelled delivery row. The UI/state currently
  carries both draft and received `DeliveryDraft` values. It cannot be
  reconstructed completely from the received-only DTO without a mapping
  contract, and reading only received rows would omit active work.

## Cross-repository relationship assessment

Current-state relationships are retained across Product and Inventory:

- Product, Variant, Packaging, Batch, Inventory record, and stock-level IDs are
  preserved. Migration 001 uses foreign keys and composite relationships for
  the live catalog and Inventory associations.
- Inventory's repository validates that its Product, Variant, Batch, and
  packaging references are coherent. The Product and Inventory outputs can
  therefore be combined without using Product data to invent stock.
- A coordinated loader should still validate the combined state before
  publishing it. It must not infer that every historical Product/Batch ID in
  Sales, Delivery, or Activity must exist in the current catalog.

Historical relationships are intentionally independent of current catalog
records:

- Activity has no live Product/Inventory foreign-key dependency and is read
  without those joins.
- Sale item history is attached to its Sale; the persisted Product, Variant,
  Batch, and Packaging identifiers/snapshots are historical data, not a
  request to look up current values.
- Received Delivery history is attached to the Delivery and its receipt event.
  Delivery item Product/Variant/Packaging references and `received_batch_id`
  are not all protected by durable foreign keys to current entities. They
  must be retained as stored, not validated by joining current Product or
  Inventory rows.
- Sale and received-Delivery headers reference their corresponding Activity
  event IDs in the schema. Activity rows themselves remain independent
  snapshots. A future loader may validate these event associations but should
  not use joins that cause the historical rows to disappear.

The five independent repository tests do not constitute a composed
cross-repository hydration test. They exercise mapping against isolated
in-memory databases initialized with the actual Migration 001 SQL; the
repository query boundary is mocked to execute against those test databases.
No application-level loader currently checks a combined dataset.

## Application startup and state integration assessment

1. `src/App.tsx` calls `initializeDatabase()` in a React effect. The established
   initialization sequence opens the existing SQL-plugin connection, verifies
   foreign-key enforcement, and initializes the schema. `querySqlite()` also
   awaits that cached initialization before invoking the read-only Rust
   command. This reuses the established pool and should remain unchanged.
2. `useReducer` synchronously initializes state with
   `createInitialApplicationState()`. That initializer seeds demo Products and
   Inventory/batches; Activity, Sales, and drafts start empty. There is no
   hydration action or repository import in the application startup path.
3. The app renders its pages while SQLite initializes. Its status message says
   data remains in memory and is not saved. A failed initialization changes
   the status message but does not prevent workflow controls from rendering.
   The current UI therefore remains usable with demo-backed state during
   loading and after failure.
4. `src/main.tsx` mounts `<App />` immediately. An asynchronous repository
   load added only after the current render would expose the demo state first;
   dispatching a later replacement could overwrite actions made before load
   completion. Hydration must be gated before workflow interaction or performed
   before the operational application is rendered.
5. Existing reducers implement the accepted in-memory rules: Sale drafts do
   not reserve stock, Sale approval updates stock and appends Sale/Activity
   state, Delivery drafts do not change stock, and Delivery approval updates
   stock and appends Activity state. Product draft locks depend on both Sale
   and Delivery draft collections. A hydration action must not re-run these
   workflows or mutate stock.
6. `executeTransaction()` exists as a transaction boundary, but the current
   application workflow path does not call it. No current repository load
   writes data. Thus, after read hydration, existing user changes would still
   be in-memory only and would not survive restart.

### Startup and failure cases

| Case | Safe behavior for a future integration |
|---|---|
| Database initialization fails | Show an explicit blocking error/retry state; do not display or operate on demo data as if it were persisted. |
| Any repository query fails | Surface which load failed and publish no partial state. Do not silently fall back to demo values or empty collections. |
| One repository succeeds and another fails | Keep the loaded result unpublished; treat hydration as all-or-nothing. |
| Database has no operational rows | Treat empty arrays as valid persisted state. Do not seed demo Product or Inventory data over the empty database. |
| Restart with persisted records | Re-load the persisted state. Draft readers are required before claiming workflows can resume safely. |
| User input during loading | Prevent interactions until hydration has completed, so a final state replacement cannot erase early actions. |

## Load strategy recommendation

Use **one coordinated application initialization operation**: await
`initializeDatabase()`, load all required datasets, validate the combined
result, and publish one complete state replacement. Independent repository
functions should remain focused and read-only; the coordinator should not
reimplement their SQL or mapping.

The coordinator can start independent reads together and commit only after all
resolve, provided the application is gated and no database writer can race
those reads. `Promise.all` provides all-or-nothing application publication,
but the repositories issue separate SQL queries and do not share a read
transaction/snapshot. If concurrent external database writers must be
supported during startup, a consistent read-snapshot mechanism is a separate
design requirement; the current write transaction boundary is not itself a
read-snapshot API. Do not replace the existing SQL plugin pool or introduce a
second pool to solve this.

## Persistence-contract gaps and severity

| Gap | Severity for read integration | Assessment |
|---|---|---|
| No persisted readers for Sales drafts or unfinished Delivery drafts | **Blocking** | Active drafts and their IDs/items are required to resume workflows and preserve product-structure locks. Loading only completed Sales and received Deliveries is incomplete. |
| Sales `item_snapshot_json` has no established writer/shape | **Blocking for `CompletedSale` mapping** | Keep the existing opaque `unknown` plus raw JSON handling unless a writer contract is explicitly established. Do not manufacture typed historical snapshots. |
| Delivery `receipt_snapshot_json` has no established writer/shape | **Blocking for lossless `DeliveryDraft` mapping** | Keep the opaque representation. Do not normalize/repair JSON or replace historical fields from current catalog data. |
| Activity `event_json` writer not confirmed | **Conditional** | The repository expects a full `ActivityEvent` payload and validates duplicated top-level metadata. Confirm the writer emits that contract before relying on all persisted Activity rows. |
| Interactive workflows remain memory-only | **Blocking for durable operational integration** | Read hydration alone does not make subsequent Product, Inventory, Sale, Delivery, or Activity changes persist. Keep the existing unsaved-data warning or use an explicitly read-only mode until a separately scoped write-persistence stage is completed. |
| Money safe-range validation for future writes | **Required before money-writing persistence** | Preserve the Sales repository's rejection of unsafe stored values. Do not address this in this read-only audit. |

## Recommended implementation sequence

| Proposed stage | Likely files | Behavior, dependencies, and acceptance criteria |
|---|---|---|
| **A. Complete read coverage and mapping contracts** | Add `src/persistence/repositories/saleDraftRepository.ts` and its test; add a Delivery draft reader (or extend the Delivery reader with a clearly typed all-lifecycle API) and its test. Update `salesRepository.ts` / `receiveDeliveryRepository.ts` and corresponding tests only if a lossless adapter is agreed. Update `src/sales/salesEngine.ts` and/or `src/deliveries/deliveryDraft.ts` only if the existing state types need an explicit persisted snapshot representation. | Prerequisite to resuming existing workflows. Preserve sale draft statuses and item ordering; load active Delivery drafts without changing stock; preserve received/cancelled lifecycle evidence as the schema actually stores it. Define, rather than infer, how opaque snapshot DTOs relate to domain records. Tests use isolated Migration 001 databases, cover status/nullable/foreign historical values, and reject malformed or unsafe values. No workflow writes or stock changes. |
| **B. Add coordinated, fail-closed state hydration** | Add `src/persistence/applicationStateLoader.ts` and focused tests; update `src/applicationState.ts` and `src/applicationState.test.ts` for an explicit whole-state hydration action if needed; update `src/App.tsx` and `src/App.test.tsx` to gate startup, show load errors, and publish one complete state. `src/persistence/database.ts` should need no change unless a specific failure/retry defect is demonstrated. | Depends on A and the compatible shape of all state collections. Initialize SQLite first; load all required records; validate current Product/Inventory relationships; publish once. Keep empty DBs empty; do not expose demo data during loading/failure; do not invoke business workflow reducers to hydrate; preserve accepted approval, stock, and draft-lock rules. Tests cover no pre-hydration interaction, no partial state on query failure, empty DB, persisted restart data, and no demo fallback. Existing in-memory edits remain explicitly unsaved until the separate write stage. |
| **C. Separate persistence-write stage (not part of read integration)** | Reuse `src/persistence/transaction.ts`; add only the required domain persistence modules and focused transaction/workflow tests. Likely integration points include `src/applicationState.ts` and the existing Product, Inventory, Sales, Receive Delivery, and Activity workflow handlers. | This is a prerequisite to claiming mutations survive restart, but must be separately scoped and must preserve atomic Sale and Delivery approval semantics. Use the existing transaction/pool boundary; do not add writes during Stage 15.5.7 or merge this work into the read loader. Acceptance includes rollback, idempotency/replay, concurrency, draft locks, and explicit proof that only successful approvals mutate persisted stock/history. |

### Risks, dependencies, and rollback-safe approach

- Do not replace existing workflows with repository DTOs until an explicit,
  tested mapping exists. If mapping validation fails, fail the load; do not
  drop a record or substitute current catalog values.
- Stage A is required before Stage B because draft absence and opaque snapshots
  prevent a complete state reconstruction.
- Keep the coordinator isolated from workflow writes. If the hydration stage
  fails validation, retain no partially hydrated operational state and show an
  explicit error. The rollback-safe fallback is the prior application build,
  not a silent demo-data substitution.
- Keep write persistence (Stage C) separate. Until it is complete, make no
  claim that changes made after hydration are durable.
- Prior Stage 15.5.2–15.5.6 reports document repository-focused tests and
  checks. This audit did not re-run those suites; it used the reports and
  targeted source inspection. No current audit test verifies the five
  repositories together through real Tauri IPC and an application-state
  hydration path.

## Scope and change confirmation

This stage was inspection-only. It made no application source, schema,
migration, test, configuration, or database changes. No migrations or tests
were run, and the normal application database was not accessed or modified.
The requested report is the only file created for Stage 15.5.7. Pre-existing
uncommitted work, including the already-modified `src/App.tsx`, was preserved.
