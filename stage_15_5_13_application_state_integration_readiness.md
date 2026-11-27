# Stage 15.5.13 — ApplicationState Integration Readiness

## Verdict

# NOT READY FOR READ-ONLY APPLICATIONSTATE INTEGRATION

The Stage 15.5.12 loader is a sound read-only candidate-data assembler: it reads all seven repositories, validates the assembled live relationships and historical Activity links, preserves persistence DTOs where projections are incomplete, and rejects any repository failure. It is not yet a safe direct source for the current `ApplicationState`:

1. `ApplicationState` has no place for persistence envelopes that the loader intentionally retains. Mapping only `.domain` would discard persisted lifecycle/event/batch/snapshot fields, and filtering out null projections would discard entire historical records.
2. The current domain cannot represent active Delivery drafts with nullable `deliveryDate` or `receivedBy`. The loader returns such drafts with `domain: null`; putting only successful projections into `deliveryDrafts` would lose active drafts and potentially their product-wide locks.
3. The loader reads concurrently with independent queries and has no shared read-snapshot guarantee. The current code has no app workflow writer, but the SQLite pool and DML transaction command provide no enforced no-writer window for the database as a whole.
4. `App.tsx` renders interactive demo-backed state while SQLite initializes and after initialization failure. There is no all-or-nothing hydration action, error gate, or retry path.
5. Active draft resumption and approval still operate on in-memory state. The existing workflows do not persist their changes, and received Delivery presentation still resolves names from current Product data.

The smallest safe sequence is to define state/persistence envelopes and nullable-draft behavior, establish a consistent read boundary or enforced no-writer startup window, then add a single fail-closed hydration publication and adapt the affected UI. Keep database write persistence separate.

## Evidence and scope

Inspected the current `src/applicationState.ts`, `src/App.tsx`, `src/main.tsx`, `src/persistence/applicationDataLoader.ts`, adapters, historical codecs, all seven read repositories, relevant Product/Inventory/Sales/Delivery/Activity domain and workflow types, and the Dashboard and six feature pages. Reviewed the Stage 15.5.7, 15.5.8 gap-resolution and acceptance-criteria, 15.5.10, 15.5.11, and 15.5.12 reports and results.

The worktree was already dirty before this inspection. It includes an existing `src/App.tsx` modification, Rust/Tauri changes, and untracked persistence and prior-stage files. No existing work was reverted. This stage made no source, test, schema, migration, or configuration changes and did not open the normal `sqlite:tipia.db`. No test/build commands were run because this is an inspection-only stage.

## What the current loader provides

`loadApplicationData()` invokes Product, Inventory, active Sale draft, active Delivery draft, completed Sale, received Delivery, and Activity readers concurrently with `Promise.all`. It returns Products, Inventory records, Inventory batches, Activity events, completed Sale projection envelopes, received Delivery projection envelopes, active Sale draft projection envelopes, active Delivery draft projection unions, and `persistenceLimitations`.

The loader rejects on any repository error; it does not return a partial aggregate. It validates current Product/Variant/packaging/inventory relationships for live inventory and active drafts. It validates completed Sale/received Delivery event IDs against Activity events. It uses typed Sale and Delivery snapshot parsers and compares each snapshot to its duplicated relational item columns. A malformed but still retained historical snapshot can produce `domain: null` with its original repository DTO; inconsistent duplicate values reject the assembly.

The loader's parallel reads are separate SQL calls. Its successful result is not a SQLite transaction snapshot. See the consistency finding below.

## ApplicationState mapping

`ApplicationState` has seven fields. The complete field-by-field map is in [stage_15_5_13_application_state_field_mapping.md](./stage_15_5_13_application_state_field_mapping.md). The central distinction is that Products and Inventory can be projected into existing domain fields, while Sales, Delivery, and drafts need persistence envelopes or explicitly handled persistence-only rows to avoid loss.

| Current state field | Loader source | Directly safe as the current field? | Main gap |
|---|---|---|---|
| `products` | `products` | Yes for current domain behavior | Product repository has already collapsed SQL NULL to optional absence and raw positions to array order. |
| `inventoryRecords` | `inventoryRecords` | Yes for current domain behavior | Inventory repository has already collapsed raw position/NULL distinctions; preserve arrays and do not rebuild stock. |
| `inventoryBatches` | `inventoryBatches` | Yes for current domain behavior | As above; batch IDs, expiry, pricing, and associations are domain-projected. |
| `activityEvents` | `activityEvents` | Yes, subject to known-version policy | Full payloads are parsed and metadata-checked, but unknown event variants are rejected and Activity UI copy currently says “session”. |
| `sales` | `completedSales[].domain` | Not as an unconditional lossless mapping | Some `.domain` values can be null; `CompletedSale` has no source draft/event IDs or raw persistence envelope. Never filter nulls and silently omit Sales. |
| `saleDrafts` | `activeSaleDrafts[].domain` | Only for active editable rows, not full lifecycle state | Loader returns only status `draft`; current reducer retains approved/cancelled Sale drafts. Adapter wrappers also hold persisted positions and nullable/source metadata. |
| `deliveryDrafts` | `activeDeliveryDrafts[].domain` plus `receivedDeliveries[].domain` | Not unconditionally | Nullable active headers can yield null projection; received projection omits receipt snapshot/event/batch associations. Current state cannot retain these sidecars. |

`createInitialApplicationState()` currently supplies demo Products and Inventory/batches, and empty Activity/Sales/draft arrays. Hydration must replace the initial source atomically, never merge persisted data with those demos. In particular, an empty database must publish empty operational collections.

## Workflow and page compatibility

### Products and Inventory

- `ProductsPage` consumes Products, Inventory records/batches, and both draft collections. It displays the current Product hierarchy and stock, edits Product structure, and consults product-wide draft locks.
- `InventoryPage` consumes current Product/Inventory/Batch structures, displays/aggregates stock and expiry, adjusts inventory in memory, and also consults both draft collections for product-wide locks.
- The Product and Inventory domain repositories produce shapes those pages already understand. The loader checks active Sale inventory references and current Product/Variant/packaging links; this avoids presenting structurally broken active drafts as loaded.
- Existing handlers dispatch in-memory reducer actions. They do not write those Product/Inventory changes to SQLite. The global status text currently tells the user that application data is not saved; it must remain accurate and cannot be interpreted as write compatibility.

### Sales drafts and completed Sales

- `SalesPage` reads only active `SaleDraft` objects. It displays and resumes drafts by `draftId`, and resolves item names, packaging, batches, and expiry from current Product/Inventory/Batch data. For editable active drafts this is consistent with the loader's live-reference checks.
- Approval calls `prepareSaleDraft()` and `completeSale()` against current loaded Product/Inventory data, then updates reducer state only. It does not persist approval, stock changes, or events.
- The draft adapter validates prices and domain rules, preserves IDs/order in the projected arrays, and returns the source DTO. If hydration stores only `.domain`, exact positions and SQL NULL-versus-absent/source lifecycle metadata are discarded.
- Completed Sales have transaction-time snapshots in the typed projection when parsing succeeds, independent of current Product/Inventory. The current UI has no completed-Sales history page; `applicationState.sales` is maintained by the reducer but is not passed to a page. Sale Activity details do display snapshot fields directly from `sale.completed` events.
- For any Sale whose snapshot cannot be projected, the loader deliberately returns `domain: null` and retains the persistence DTO. The current `CompletedSale[]` field cannot hold that row. A sidecar/history field or a fail-closed compatibility rule is required before integration.

### Receive Delivery drafts and received Deliveries

- `ReceiveDeliveryPage` consumes `DeliveryDraft[]`, displays drafts and received records, and permits edits/approval only for status `draft`. Approval calls `prepareDeliveryApproval()` with current Products/Inventory/Batches and updates memory only.
- An active persisted Delivery can have NULL `deliveryDate` and/or `receivedBy`; these values are valid in the schema but required by `DeliveryDraft`. The current adapter correctly returns a persistence-only projection (`domain: null`) with the exact incompatible headers. Replacing them with a current date or empty/guessed recipient is not safe.
- Such rows must remain visible as persistence-only and count for active Product locks, or the domain/state/UI contract must be extended. Simply omitting them risks losing draft visibility and weakening locks.
- Received Delivery projections use relational item IDs, batch number/expiry/prices, but `DeliveryDraftItem` has no historical Product/Variant names, `receivedBatchId`, or receipt snapshot. The current page resolves Product and Variant names from the current catalog and may fall back to IDs if the Product was removed/changed. It therefore is not a complete historical-detail view.
- The Activity page does display received Delivery event snapshots without looking up current Product/Inventory values. The typed receipt snapshot and Activity event intentionally have different structures; the latter cannot be treated as a replacement for the former.
- No received Inventory-record association exists in the workflow/schema. Do not infer one from a current batch or stock record.

### Activity and Dashboard

- `ActivityPage` consumes the full `ActivityEvent[]`; `activityPresentation.ts` renders event payload snapshots directly and does not resolve historical names through current Product/Inventory. The Activity parser and serializer cover the 16 currently defined event variants, and the repository validates duplicated relational metadata.
- If persisted events are loaded, current Activity page copy (“Changes recorded during this session” / “Session activity”) is inaccurate. It should be changed to historical/database-backed wording as part of cutover. The known event-type union is not forward compatible with an unknown future event type; the parser rejects it.
- `DashboardPage` derives stock, expiry and low-stock alerts from current Products/Inventory/Batches and counts only `status === "draft"` in its pending Sale and Delivery collections. It uses draft IDs for navigation. The loader supplies these inputs if all active drafts, including nullable-header persistence-only rows, remain represented. Completed Sale counts/history are not currently a Dashboard feature.

## Draft lifecycle and data preservation

- Active Sale draft DTOs contain status, original ID, ordered item references, quantities and minor-unit prices. The adapter converts checked monetary values into the workflow number representation, sorts arrays by stored positions, validates the result, and retains the DTO.
- The current Sale draft repository filters `status = 'draft'`. By contrast, the reducer retains Sale drafts after cancellation and approval; approval marks the source draft `approved` while also appending the completed Sale. Thus active-only loader output is sufficient for active continuation/locking but not an exact reconstruction of every record the current in-memory `saleDrafts` field can contain. Decide whether to load terminal Sale drafts into an archive/sidecar or define the state field as active-only.
- Active Delivery draft DTOs preserve nullable headers, ordered item IDs/references, quantity, batch/expiry/prices, and nullable receipt batch/snapshot fields. Domain projection normalizes some optional text and drops persisted position/receipt-only fields from the domain object; the wrapper is required to preserve them.
- Received Deliveries are not active drafts; they are separately returned with status `received`, receipt metadata and item snapshots. If projected into the current combined `deliveryDrafts` field, preserve a received-delivery envelope separately so neither the receipt snapshot nor event/batch IDs disappear.
- Cancelled Delivery rows are removed by current workflow behavior and represented in Activity, not in the active/received Delivery tables. Do not synthesize them as current Delivery drafts.

## Historical-record compatibility

- Completed Sale item snapshots use the existing typed snapshot codec. A valid snapshot contains the approval-time Product, Variant, Batch, packaging, quantity, price, totals, discount and expiry data; the loader cross-checks duplicated relational item fields. Current Product/Inventory is not used to reconstruct it.
- Received Delivery item snapshots use a separate codec/shape from `delivery.received` Activity items. Valid receipt snapshots preserve receipt-time Product/Variant names, packaging, quantity, batch, and receipt pricing. The relational received-batch ID is distinct and remains in the DTO.
- Activity JSON contains complete typed events and their event-specific snapshots. The reader validates all current variants and relational metadata. Unknown added fields in supported JSON shapes are retained, but future unknown event types are rejected.
- Existing snapshots may be opaque/older or invalid against the current typed codec. The loader preserves source JSON/DTO and emits `domain: null`; state hydration must not drop those rows or silently repair them from current catalog data.
- Migration 001 has no snapshot-version field. The current contract can read valid current-version payloads and preserve unsupported payloads opaquely; a new version column is not an integration prerequisite unless a future incompatible format is approved. No production database writer currently proves these codecs are the emitted persistent format.

## Startup and failure behavior

Current startup order is:

1. `src/main.tsx` mounts `<App />` immediately under React `StrictMode`.
2. The `useReducer` initializer synchronously creates demo-backed state.
3. `App` calls `initializeDatabase()` in `useEffect`.
4. `initializeDatabase()` loads `sqlite:tipia.db`, invokes connection/foreign-key verification, then schema initialization; only then does it mark the connection initialized.
5. `App` changes a status message but renders all workflow pages during connection and after initialization failure. It has no repository load, blocking gate, or retry control.

`initializeDatabase()` memoizes the connection and an in-flight initialization promise, which helps avoid duplicate connection setup. React StrictMode can still mount/effect twice in development; a new application-data loading operation should be idempotent too, otherwise both mounts can issue seven independent reads. The existing `isMounted` flag prevents the first mount from updating React after cleanup, but does not deduplicate loader work.

Safe future behavior:

- Await database open, foreign-key verification, and migrations before calling the loader.
- Build and validate one candidate in local variables. Do not dispatch collections as each repository resolves.
- Publish exactly once through an explicit whole-state hydration action only after every required projection/persistence-only record has a defined destination.
- Render a loading gate before operational pages. On failure, show an explicit blocking error and retry action; never show demo or partial persisted data as ready.
- Treat empty persisted tables as valid empty state, not as permission to seed demo data.
- Deduplicate the full boot/read operation across StrictMode mounts and guard stale attempts/retries. A failed initialization or read must not leave a cached rejected promise that prevents a deliberate retry.
- Until database write persistence exists, either make the post-hydration mode explicitly read-only by disabling mutating/approval controls, or keep a prominent and unambiguous unsaved-data warning. Do not imply that draft edits, Product/Inventory changes, Sales, Delivery approvals, or Activity events persist.

## Read consistency

`Promise.all` gives all-or-nothing JavaScript publication, not a database snapshot. Each repository calls `querySqlite()` independently; the Rust readonly query command acquires a connection from `SqlitePool` per call. Reads may therefore use different connections/transactions and observe changes between collections. The TypeScript transaction helper invokes a DML-only transaction API; it is not a read snapshot.

The current React workflow handlers update memory and do not call the DML transaction helper, so the current UI has no normal application write racing these reads. This is not an enforced database-wide no-writer guarantee: the Tauri backend exposes a DML transaction command and the pool may be used by another app instance or external writer. Loader-side cross-reference checks catch some inconsistencies but cannot prove that all collections came from the same point in time.

For a guaranteed production hydration, use one shared SQLite read transaction/snapshot for all required repository queries, or enforce and test a strict single-writer/no-writer window for the full read. Given the existing pool and callable DML command, a shared snapshot is the safer cutover requirement. The loader does not currently provide it; do not claim consistency until the read boundary is implemented and tested.

## Unresolved contracts and recommended sequence

The exact remaining work is staged in [stage_15_5_13_application_state_cutover_plan.md](./stage_15_5_13_application_state_cutover_plan.md):

1. Define state destinations for persistence envelopes, terminal Sale draft records, nullable active Delivery drafts, and persistence-only historical rows.
2. Add a consistent read boundary or an enforced no-writer alternative.
3. Build and validate one complete candidate and publish it once behind fail-closed startup/retry UI.
4. Adapt current pages for persisted-history wording and safe presentation/locking of persistence-only rows; keep writes explicitly unavailable until a separate write-persistence stage.
5. Verify the integrated startup/read path with isolated data and focused tests.

The received Inventory-record association remains absent from Migration 001 and approval data. No association can be invented. No schema change is required merely to retain available DTOs; a schema change is only needed if the product requirement expands to persist information that is not currently stored (such as a distinct received timestamp or inventory-record association).
