# Stage 15.5.8 — Persistence Integration Gap Resolution Plan

## Executive summary

**Read-repository integration is not ready to expose the current interactive
application to persisted state.** Product and Inventory already map to the
current state types. The remaining blockers are:

1. Sales and received-delivery repository DTOs do not losslessly map to the
   existing domain collections.
2. No readers restore `sale_drafts` or draft-status `deliveries`; they are
   necessary to resume drafts and preserve Product-wide locks.
3. Snapshot JSON writer/serialization contracts are not established for
   `sale_items.item_snapshot_json` or `delivery_items.receipt_snapshot_json`.
4. `App.tsx` exposes demo-backed interactive state before database
   initialization, and still exposes it if initialization fails.
5. Existing application workflows update memory; read hydration alone would
   not make subsequent changes durable.

The current schema is sufficient to recover the relational content of active
drafts, with a nullable-header-to-domain decision for Delivery drafts. No
schema change is inherently required to add readers, gate startup, or preserve
opaque historical snapshots. A schema/domain decision is required before
mapping snapshot JSON to strongly typed historical domain items. Additional
schema work would only be necessary if the project requires information the
current schema does not store, such as a separate receipt timestamp or an
explicit version column for snapshot formats.

## Evidence inspected

Inspected the Stage 15.5.7 report; all five repository implementations and
focused tests; Stage 15.5.2–15.5.6 reports; `ApplicationState`, its reducer and
initializer; Sales and Delivery domain types; Product draft-lock helper;
`App.tsx` and `main.tsx`; database/query/transaction wrappers and their tests;
and Migration 001 table definitions, foreign keys, views and lifecycle
triggers.

The repository tests use isolated in-memory SQLite databases initialized from
the actual Migration 001 SQL. Their `querySqlite` mock executes repository SQL
against those databases; they do not prove a composed loader works through
real Tauri IPC. Existing `database.test.ts` and `query.test.ts` mock the
plugin/IPC edges. Prior stage reports document their focused test/build
results; this planning stage did not rerun tests.

| Prior-stage evidence reviewed | Result recorded in the stage report |
|---|---|
| Product repository and persistence-boundary tests | Product: 1 file/6 tests; Product plus query/database/transaction: 4 files/23 tests passed. |
| Inventory and Product repositories | 2 files/9 tests passed. |
| Activity with Product/Inventory repositories; Activity domain/presentation | 3 files/14 tests and 3 files/26 tests passed. |
| Sales repository and Sales domain/draft tests | 1 file/5 repository tests; 3 files/66 combined tests passed. |
| Receive Delivery repository and Delivery domain/approval tests | 1 file/5 repository tests; 3 files/55 combined tests passed. |
| TypeScript, focused lint, and builds | Prior reports record relevant checks passed. Builds emitted a non-fatal Vite chunk-size advisory. |

These are historical outcomes from the cited reports, not checks run in Stage
15.5.8. No existing test covers a complete multi-repository state load or its
startup failure behavior.

The initial worktree contained pre-existing modifications and untracked
deliverables, including `src/App.tsx`, `src-tauri/Cargo.toml`, Rust persistence
files, and the previous stage reports. They were preserved. No application
database was opened.

## Findings confirmed by Stage 15.5.7

- `ApplicationState` stores `productStructure[]`, `inventory[]`,
  `inventoryBatch[]`, `ActivityEvent[]`, `CompletedSale[]`, `SaleDraft[]`, and
  `DeliveryDraft[]`. There is no hydration action or coordinated loader.
- `createInitialApplicationState()` unconditionally returns demo Products and
  Inventory/batches. Activity, Sales and both draft collections start empty.
- `App.tsx` calls `initializeDatabase()` in an effect after its first render.
  It does not load repositories. Loading or failed initialization does not
  block the workflow UI; the status text says data remains in memory.
- Existing Product/Inventory/Activity data shapes are compatible with their
  state collections. Inventory's returned object can be split into its two
  state arrays without loss.
- The Sales repository returns `PersistedSale[]`, not `CompletedSale[]`; the
  Receive Delivery repository returns `PersistedReceivedDelivery[]`, not
  `DeliveryDraft[]`. Both retain opaque snapshot JSON.
- No reader loads persisted Sales drafts or unfinished Delivery drafts.
- Existing reducers implement the accepted in-memory rules, but the
  application does not invoke `executeTransaction()` for workflow changes.
  Loading persisted state would not make later edits or approvals persistent.

## Complete compatibility matrix

### Product, Inventory and Activity

| Persisted source and repository | Current state/domain destination | Mapping result |
|---|---|---|
| `products`, `variants`, `packaging_levels`, thresholds → `getAllProducts()` | `products: productStructure[]` | Direct mapping. IDs, hierarchy, ordering and nullable optional catalog metadata are preserved. Prices use checked minor-unit conversion. |
| Inventory records, stock, batches and pricing → `getAllInventory()` | `inventoryRecords: inventory[]`, `inventoryBatches: inventoryBatch[]` | Direct after splitting the repository result. IDs, associations, stock quantities, batch identity, expiry and nullable pricing are retained. The repository checks live relationships; no current Product data is used to invent stock. |
| `activity_events.event_json` → `getAllActivityEvents()` | `activityEvents: ActivityEvent[]` | Type-compatible if persisted JSON is the full `ActivityEvent` shape expected by the reader. Indexed metadata is checked against top-level payload metadata. The repository does not join current Product or Inventory. The writer is not present/confirmed, and nested payload validation is not exhaustive. |

### Sales: persisted columns versus current domain

| Persisted field/source | Existing domain field | Lossless mapping? | Required resolution |
|---|---|---|---|
| `sales.sale_id` | `CompletedSale.saleId` | Yes | Direct. |
| `sales.sale_position` | No field; `ApplicationState.sales` array order only | Array order can be preserved; numeric position cannot | Sort by persisted position as a tie-breaker; decide whether numeric position itself must be retained in a persistence envelope. |
| `sales.source_draft_id`, `completed_event_id` | No corresponding fields on `CompletedSale` | No, if mapped to `CompletedSale` alone | Retain in a persistence envelope or extend the model. The linkage is material for matching an approved draft and `sale.completed` Activity. |
| `sales` table membership | No `CompletedSale.status` field | Status can be inferred as completed | Keep the inferred literal on a persisted read model or document this adapter rule. Do not treat cancelled drafts as Sales. |
| `completed_at` | `completedAt` | Yes | Return stored timestamp unchanged. |
| `customer_name`, `customer_address`, `sale_date`, `notes` (nullable) | Optional strings on `CompletedSale` | Values map; SQL `NULL` versus absent is not represented | Map `NULL` to absent only if the domain contract treats them equivalently; otherwise extend the persistence-facing model. Never substitute values. |
| `staff_user_id`, `staff_display_name` (nullable) | `staffMember?: { userId?, displayName? }` | Non-null values can be composed; null-versus-absent is not represented | Explicit adapter; preserve partial staff metadata and do not infer a name. |
| Header minor-unit totals and `expired_batch_confirmed` | Decimal number totals and boolean | Yes within the repository's safe-integer/round-trip checks | Preserve checks; safe range for future writes remains a separate prerequisite. |
| `sale_items.line_id`, `inventory_record_id`, `product_id`, `variant_id`, nullable `batch_id`, `packaging_level_id`, `quantity`, `expired_batch` | `CompletedSaleItem.lineId`, `inventoryRecordId`, snapshot Product/Variant/Batch/Packaging, quantity, expired flag | IDs/quantity/flag map; Product/Variant/Batch/Packaging objects do not | Item snapshot contract is required. Do not join current records to synthesize historical snapshots. |
| `sale_items.item_position` | Ordered `CompletedSale.items[]`; no position field | Stable sequence can be retained; raw position value cannot | Sort and retain ordered array; extend a persistence envelope only if original position values are required. |
| Item minor-unit prices/totals and nullable default price | Decimal amounts and nullable default price | Yes within safe-integer and round-trip checks | Use the current checked conversion. Do not round/truncate unsafe values. |
| `item_snapshot_json` | Required structured `CompletedSaleItem` snapshot | **No current safe mapping** | It is parsed as `unknown` and raw text is retained. The schema only requires non-empty text; no writer or JSON shape is established. Decide the exact serializer/compatibility contract before typing it. |

`CompletedSale` also has no fields for `sourceDraftId`, `completedEventId`,
persisted status, or Sale ordering position. Conversely, `PersistedSale`
currently has those relational fields but has only opaque item snapshots.
Mapping to `CompletedSale` without a contract would lose relational metadata
and/or fabricate historical snapshots.

The associated `sale_drafts` row has `approved_sale_id`, which is not on
`SaleDraft`. Migration 001 ties it to a Sale and makes terminal draft rows and
items immutable. When restoring state, verify the approved-draft/Sale
relationship, but do not collapse the approved draft into the completed Sale:
the current in-memory state retains both.

### Receive Delivery: persisted columns versus current domain

| Persisted field/source | Existing domain field | Lossless mapping? | Required resolution |
|---|---|---|---|
| `deliveries.delivery_id`, `created_at`, `updated_at` | `deliveryId`, `createdAt`, `updatedAt` | Yes | Preserve strings unchanged. |
| `deliveries.status` (`draft` / `received`) | `DeliveryDraft.status` also allows `cancelled` | Yes for stored statuses | Keep draft and received distinct. Cancellation deletes the row and is represented in Activity; do not synthesize a cancelled row. |
| `delivery_date`, `received_by` | Required `DeliveryDraft.deliveryDate` and `receivedBy` strings | **Not for every schema-valid draft** | Both columns can be `NULL` for drafts, while the domain requires strings. Preserve nullable values in a persisted draft DTO, or define a validated writer invariant/domain extension. Do not invent a date or recipient. Received rows are constrained to valid date/non-empty recipient. |
| `supplier_name`, `invoice_number` (nullable) | Optional `supplier`, `invoiceNumber` | Values map; exact null/absent distinction does not | Explicitly map names and preserve null if the persistence-facing type requires it. Do not normalize/replace historical values. |
| `delivery_position` | Delivery array order only | Order can be preserved; number cannot | Sort by position; retain the raw position only if consumers need it. |
| Item ID, Product/Variant/packaging IDs, quantity, nullable batch number/expiry/prices | `DeliveryDraftItem` fields | Substantially direct | Preserve values and item order. `item_position` has no domain field; ordering can be retained in the array. Prices require checked conversion. Draft references must be validated against current catalog if needed for editing. |
| `received_event_id` | No `DeliveryDraft` field | No, if mapped to `DeliveryDraft` alone | Retain it in a persisted receipt envelope or explicit type extension; validate its Activity association without using current Product joins. |
| `received_batch_id` | No `DeliveryDraftItem` field | No, if mapped to `DeliveryDraftItem` alone | Retain in the persisted received-item model. It has no current Batch foreign key and must not be resolved from current Inventory. |
| `receipt_snapshot_json` | No `DeliveryDraftItem` field; expected to carry receipt history | **No current typed mapping** | JSON contract is undefined. Preserve parsed `unknown` and raw text; do not normalize or replace from current Product/Inventory. |
| Receipt time | Domain has `updatedAt`, not `receivedAt`; schema has no `received_at` | The stored `updated_at` maps exactly; a separate receipt timestamp does not exist | Do not treat the repository’s `receivedAt = updatedAt` alias as an independently stored fact. If a separate timestamp is required, decide on a schema migration; otherwise document the existing approval-time `updated_at` convention. |

For received items, Migration 001's transition trigger requires both
`receipt_snapshot_json` and `received_batch_id` to be non-null, despite those
columns being nullable for draft rows. The current received-only repository's
requirement is therefore consistent with the normal schema transition. The
schema still does not constrain the JSON shape or ensure that
`received_batch_id` refers to a current batch.

The current `DeliveryDraft` state also does not contain `received_event_id`,
receipt batch IDs, or snapshots. A lossless design must either extend the
received-history model or keep a separate persisted received-delivery
collection; dropping those values during hydration is not acceptable.

## What can be resolved without schema changes

| Gap | No-schema resolution |
|---|---|
| Startup currently exposes demo state before database initialization | Add a future initialization gate and candidate-state loader; keep demo construction behind an explicit test/development option. |
| Missing draft reads | Add read-only queries for `sale_drafts`/`sale_draft_items` and `deliveries`/`delivery_items`. Migration 001 already stores draft IDs, lifecycle, timestamps, fields, references and ordering. |
| Nullable draft text and position fields do not exactly match domain models | Preserve nullability in persistence-facing DTOs or make an explicit, validated domain-adapter decision; sort by stored positions. This is a domain contract decision, not a missing database column. |
| Opaque Sale/Delivery snapshot handling | Keep parsed `unknown` plus original JSON in a persisted history DTO. A writer/reader serialization contract can be specified in application code without changing these text columns, provided backward compatibility is handled. |
| Activity serializer is unconfirmed | Define the writer to store the full `ActivityEvent` payload and keep the current duplicated-metadata checks. The existing columns already store the indexed fields and JSON. |
| All-or-nothing publication | Assemble a complete candidate state and publish once after validation; no schema change is involved. |

## Decisions that may require domain or schema changes

| Decision | Needed when | Likely change |
|---|---|---|
| Map `item_snapshot_json` into `CompletedSaleItem` | Consumers require strongly typed persisted Sales in `ApplicationState.sales` | Approve a precise serializer/compatibility contract and add a validating adapter. Extend the Sale/persistence model for source-draft/event metadata if these must remain accessible. A schema version column is only needed if the selected compatibility strategy requires stored versions. |
| Map `receipt_snapshot_json` into typed received-delivery history | Consumers require typed historical snapshots rather than opaque values | Define a receipt snapshot contract and add an adapter or received-history type retaining `receivedEventId`, `receivedBatchId`, and raw snapshot. Do not equate Activity's payload to the receipt-item JSON without a verified mapping. |
| Represent nullable draft `delivery_date` / `received_by` | Any supported draft row may contain SQL `NULL` | Extend a persistence/domain type to preserve null, or establish a writer invariant and reject incompatible rows. A stricter schema constraint is an alternative only if null is not a supported state. |
| Preserve an independent received timestamp | Business requirements distinguish receipt time from `updated_at` | Add an explicit schema column and migration. Otherwise keep `updated_at` as the stored timestamp and do not claim a separate `received_at`. |
| Preserve raw positions or full relational links in reducer state | Consumers need exact positions, `approved_sale_id`, or event IDs after loading | Add a persistence envelope or extend domain types; current arrays only preserve ordered sequence. No schema change is needed because the database already stores those values. |
| Support money outside current JavaScript safe range | Required by an approved business use case | Requires a money/domain representation and likely schema-bound decision before writes; it is not solved by read hydration. |

## Draft restoration and schema sufficiency

### Sales drafts

`sale_drafts` contains `draft_position`, `draft_id`, status (`draft`,
`cancelled`, `approved`), creation/update timestamps, nullable customer/date/
staff/notes fields, and `approved_sale_id`. `sale_draft_items` contains
`line_id`, `item_position`, Product/Variant/Inventory/Batch/packaging IDs,
quantity, nullable default price, applied price and discount.

This is sufficient to reconstruct the relational `SaleDraft` values without
inventing an item snapshot; active draft items are references and inputs, not
historical Sales snapshots. Minor-unit values need the established checked
conversion. Ordering is available from the position columns. `SaleDraft`
does not preserve the position numbers themselves or `approved_sale_id`; the
result can preserve ordering, but a persistence envelope/type extension is
needed if exact position metadata or the approved-sale link must remain in
state.

The schema has no foreign keys from Sale draft items to their selected live
Product/Variant/Inventory rows. Insert/update triggers validate these
relationships, and `active_draft_products` plus Product/Inventory triggers
enforce product-wide locks. A restoration loader must still validate each
draft item's IDs against loaded Product/Inventory data; it must not allocate
stock or reduce quantities.

Read all persisted Sale draft statuses if mirroring current `ApplicationState`
semantics: active drafts are `draft`; cancelled drafts remain terminal rows;
approved drafts link to the completed Sales records. Only `draft` rows
contribute locks. A draft repository can use the existing schema; it must not
call or reproduce business write behavior.

### Receive Delivery drafts

`deliveries` and `delivery_items` contain header/item IDs, status, timestamps,
positions, Product/Variant/packaging identifiers, quantity, batch/expiry and
nullable pricing. The item insertion triggers validate current Variant and
packaging references. There is no snapshot requirement for an active draft,
and loading it must not change Inventory or Activity.

The schema therefore holds the relational content needed for an active
Delivery draft, but not a universally lossless mapping to `DeliveryDraft`
because draft `delivery_date` and `received_by` may be SQL `NULL` while the
domain requires strings. Preserve those values until the domain/writer
contract decides whether nullable domain fields or a stricter persisted
invariant is intended. Use `delivery_position` and `item_position` for stable
array ordering.

Received Deliveries are also in `deliveries`; they need to remain distinct
from drafts. The received-only repository can remain historical and
read-only, but a future coordinator must combine its result with the draft
rows. Cancelled delivery rows do not exist after cancellation; the immutable
`delivery.draft_cancelled` Activity snapshot is the historical record.

### Product-wide locks and stock invariants

The SQL `active_draft_products` view unions Product IDs referenced by active
Sales and Delivery draft items. Triggers block Product structure, packaging,
batch, Inventory-record, stock and pricing changes for any Product in that
view. The frontend `getProductDraftLockMessages()` similarly checks `status
=== "draft"` and matching `productId`, independent of Variant. Hydration must
load both draft collections before enabling Product/Inventory mutations, or
the UI could temporarily bypass the lock.

Draft hydration is a read operation only: it does not reserve/deduct stock or
record Activity. Approval atomicity remains an existing workflow requirement
for a later, separately scoped write-persistence stage. Product deletion must
not cancel drafts to avoid the lock.

## Startup and state safety design

Recommended future startup states are explicit `loading`, `ready`, and
`failed` states; they must not contain partially usable application data.

1. Start the application behind a loading gate. Do not construct/render the
   operational reducer with `createInitialApplicationState()`'s demo data.
2. Await `initializeDatabase()`. It opens the existing SQL-plugin connection,
   verifies foreign-key enforcement, and runs migrations; failure must stop
   before repository reads and preserve the existing partial-connection
   cleanup behavior.
3. Within the coordinated load, read Product and Inventory first as the
   current catalog/stock basis. Read Sale draft and Delivery draft rows next;
   their references must be checked against that basis before actions are
   enabled. Read completed Sales, received Deliveries, and Activity as
   historical records without joins to current catalog/stock. Activity is
   also the source for validating stored Sale/Delivery event links.
4. Build and validate a complete candidate state off to the side. Check live
   Product/Inventory and active-draft references, duplicate IDs, lifecycle
   associations, item ordering, and money conversions. Do not require
   historical Sales/Delivery/Activity identifiers to exist in current Product
   or Inventory.
5. Publish the entire candidate once. Do not dispatch a sequence of state
   mutations that exposes partially loaded datasets or runs normal workflows.
6. On initialization/query/validation failure, show an explicit blocking
   error with a retry path. Do not fall back to demo data or publish empty
   collections as a success-shaped fallback.
7. Keep demo fixtures available only via a deliberate test fixture or
   development-only opt-in. The production/default path must never silently
   select them.

Each current repository uses one SQL statement, so each result is internally
consistent. A coordinator using separate query calls does **not** create one
cross-repository SQLite snapshot. The current frontend has no database-backed
workflow writes, so a single-instance startup can gate the UI and complete
loading before enabling any application action. If concurrent external or
multi-instance database writers must be supported, decide before integration
whether to add a read-snapshot operation on the existing pool; `Promise.all`
alone guarantees all-or-nothing UI publication, not a shared database
snapshot. Do not repurpose the existing write transaction command as a read
snapshot.

## How workflows eventually use the loaded state

The read-integration stage should hydrate the existing domain state and leave
the current reducer/workflow rules intact; it should not simulate commits by
dispatching Product, Inventory, Sale, or Delivery actions during startup. The
same loaded Product/Inventory/draft state is then used by existing workflow
selectors and lock checks.

Database-backed mutations are a separate future stage. At that point, the
existing workflow plans/actions should be persisted through the existing
transaction boundary without changing their business semantics:

- Product and Inventory changes persist their records and corresponding
  Activity events atomically.
- Sale draft create/edit/cancel operations persist `sale_drafts` and
  `sale_draft_items`; drafts remain non-reserving. Sale approval persists the
  stock mutation, completed Sale/items, approved draft state, and
  `sale.completed` Activity in one transaction.
- Delivery draft create/edit operations persist `deliveries` and
  `delivery_items` without stock or Activity changes. Cancellation records its
  Activity snapshot and removes the draft atomically. Approval persists batch
  and stock changes, received item/header snapshots, and receipt Activity in
  one transaction.
- Activity remains the immutable history boundary; Product deletion does not
  cancel drafts or delete historical Sales, Delivery, or Activity snapshots.

These are future persistence requirements, not implemented or validated by
this planning stage. Until then, the current unsaved-data warning remains
necessary.

## Ordered implementation plan for Stage 15.5.9 onward

| Order | Proposed work and likely files | Acceptance and constraints |
|---|---|---|
| **15.5.9.1 — Finalize persistence/domain contracts** | Document Sale/Delivery snapshot serialization and compatibility policy; choose how to preserve Sale source/event IDs and positions, Delivery receipt/event/batch metadata, and nullable draft headers. Likely types: `src/sales/salesEngine.ts`, `src/deliveries/deliveryDraft.ts`, repository DTOs/tests. | No guessing, current-catalog snapshot reconstruction, silent null substitution, or money rounding. If no JSON contract is approved, keep opaque raw read models and do not claim they hydrate `CompletedSale`/`DeliveryDraft` losslessly. No schema change unless a separate timestamp/versioning decision requires one. |
| **15.5.9.2 — Add draft read repositories** | Add `src/persistence/repositories/saleDraftRepository.ts` and test; add a Delivery draft reader/test, or a lifecycle-aware API alongside `receiveDeliveryRepository.ts`. | Use existing `querySqlite`; read only. Preserve all Sale draft statuses, items, nullable fields and order; restore Delivery `draft` rows and combine them with received history without mislabeling lifecycle. Validate live draft references after loading Product/Inventory. No stock/Activity mutations and no writer behavior. |
| **15.5.9.3 — Add a complete state loader and startup gate** | Add `src/persistence/applicationStateLoader.ts` and tests; update `src/applicationState.ts`, `src/applicationState.test.ts`, `src/App.tsx`, and `src/App.test.tsx` only in the implementation stage. Keep database/query code unchanged unless a proven snapshot/retry requirement needs a narrow extension. | Initialize first; load Product/Inventory, both draft collections, completed Sales, received Delivery, and Activity; validate dependencies; publish once. Fail closed; do not expose demo data during loading/failure; preserve read-only historical snapshots. No workflow writes or state transitions as a side effect of hydration. |
| **15.5.9.4 — Verify integration behavior** | Focused loader and App tests, repository/domain regression tests, then targeted TypeScript/lint/build checks. Add a combined database fixture test using actual Migration 001; use an isolated database. | Verify empty DB, lifecycle matrix, history after Product deletion, query/validation failures with no partial state, lock restoration before interaction, and no quantity changes. Do not access the normal database or perform production migration tests. |
| **Later, separately approved — Database-backed writes** | Use existing `src/persistence/transaction.ts` and Rust transaction/pool boundary. Add narrow persistence operations at the existing workflow boundaries only after the writer and money contracts are settled. | Keep draft creation/edit/cancel and Product-wide locks correct; Sales/Delivery drafts do not mutate stock; approval, stock mutation, Activity, and completed record writes are atomic; rollback/replay/concurrency are tested. This is not part of read integration. |

## Decisions and unresolved questions

1. Should completed Sales map into existing `CompletedSale` by defining a
   versioned `item_snapshot_json` contract, or should persisted Sale history
   remain a separate typed envelope until a contract is selected?
2. What exact value type and compatibility/version rule will be serialized in
   `delivery_items.receipt_snapshot_json`? It must preserve the receipt-time
   product, variant, batch, packaging, pricing and stock snapshots required by
   history without reading current entities.
3. Should nullable draft `delivery_date`/`received_by` be represented in the
   domain, or should a future writer guarantee non-null values for created
   drafts and the reader reject older/invalid rows? Do not choose by filling
   missing values.
4. Should `approved_sale_id`, `completed_event_id`, `received_event_id`, and
   original position values be retained in `ApplicationState` wrappers, or are
   sorted arrays plus validated cross-links sufficient?
5. Is concurrent external/multi-instance writing during startup supported? If
   yes, require a consistent read snapshot on the existing pool; otherwise
   explicitly constrain startup loading to a no-writer window.
6. Until write persistence is delivered, should the integrated application
   remain explicitly marked as unsaved, or should the persisted-data view be
   read-only? This is a rollout/UI decision, not a reason to claim writes are
   durable.

## Risks that should not block read-integration planning

- Existing focused repository tests, TypeScript checks, lint and builds are
  documented as passing in the prior stage reports. Prior builds emitted a
  non-fatal Vite chunk-size advisory above 500 kB; it is unrelated to this
  plan.
- The `node:sqlite` tests emit an existing experimental warning. The
  intermittent Windows Rust test cleanup OS error 32 remains documented; it
  should not be suppressed or used to weaken tests.
- Safe money conversion already rejects values it cannot represent. The
  outstanding safe-range validation for money-writing persistence remains
  required before such writes, but it does not block read-only repository
  planning.
- No full test suite is necessary for this documentation-only stage.

## Scope and validation record

This stage produced a gap-resolution plan only. No source, test, configuration,
schema, or migration files were changed. No repository tests, builds, or
migrations were run. The normal application database was not accessed. Existing
uncommitted work was preserved.
