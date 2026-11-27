# Stage 15.6.1 — SQLite Write Persistence Architecture and Implementation Plan

**Assessment type:** Read-only architecture and implementation-readiness assessment  
**Scope:** Stage 15.6 SQLite business-write persistence  
**Result:** Read architecture is integrated; no business write repository or workflow is connected to SQLite.

## Executive summary

The current application starts from SQLite-hydrated data, but all interactive business changes are still reducer-only and are lost on restart. There are seven read repositories, a typed historical serialization/hydration path, and a Rust transaction command capable of executing parameterized DML batches atomically. There are **no production write repositories** and no call from the business handlers to `executeTransaction`.

The schema already expresses most of the intended persistence contract: relational Product/Inventory data; active and terminal draft states; immutable completed-sale and received-delivery history; append-only Activity events; foreign-key and trigger guards; and an explicit received-Delivery-to-Inventory identifier introduced by migrations 002/003. A new schema migration is not established as necessary by this inspection.

The principal implementation risks are transaction statement ordering, strict row-count/stale-state handling, position and minor-unit mapping, faithfully persisting generated snapshots, and updating the live `ApplicationState` only after a successful database commit. One schema/domain interaction needs an explicit workflow decision: active drafts lock Product inventory at the database layer, so approving one draft can be rejected while another active draft for the same Product remains.

## Scope, safety, and evidence labels

This assessment inspected source and existing reports only. It did **not** open the normal database or its backup, run SQL or migrations, change source/tests, or run a build/test command. The normal database’s reported zero business-row counts are not interpreted as loss of persisted business data. The verified backup was not accessed or changed.

The worktree already contained staged/unstaged/untracked work when inspected. All of it was preserved.

- **Confirmed fact** means directly visible in inspected source or a referenced prior report.
- **Recommendation** means a proposed Stage 15.6 implementation/validation approach.
- **Unresolved** means the existing source/schema does not define a sufficient answer.

## Current architecture

1. `src/persistence/database.ts` initializes `sqlite:tipia.db`, verifies foreign keys, and invokes the Rust migration command.
2. `src/persistence/applicationStartup.ts` coordinates initialization, `loadApplicationData()`, and hydration. `src/App.tsx` passes a domain projection and the retained hydration model to `WorkflowApp`.
3. Seven SQLite read repositories return Products, Inventory/batches, active Sale drafts, active Receive Delivery drafts, completed Sales, received Deliveries, and Activity events. The loader assembles eight collections; its reads use the existing consistent snapshot executor.
4. `createApplicationStateFromHydration()` projects available domain records into `ApplicationState`. Persistence-only records remain in a separate hydration model. The live reducer is initialized from this projected state.
5. UI handlers prepare domain workflow results and call `applicationReducer`/`dispatch` directly. The existing status message explicitly says that changes are in memory and not saved.
6. `src/persistence/transaction.ts` exposes `executeTransaction(statements)`. The Rust `execute_sqlite_transaction` command accepts a non-empty list of parameterized single `INSERT`, `UPDATE`, or `DELETE` statements, enables/verifies foreign keys, runs them on one connection under `BEGIN IMMEDIATE`, rolls back on a statement error, and returns a row-count for each statement.

**Important boundary limits:** The write command returns affected-row counts, not result rows. It accepts DML only, so a caller must plan IDs, positions, serialized payloads, and expected values before execution. Callers must inspect row counts themselves; a zero-row conditional update is not automatically an error. Read-then-write plans need stale-state protection (conditional DML/expected values and row-count checks), since their reads occur before the transaction.

### Existing persistence repositories

| Area | Existing production repository | Current capability |
|---|---|---|
| Product | `src/persistence/repositories/productRepository.ts` | Read Products, Variants, packaging, thresholds |
| Inventory | `src/persistence/repositories/inventoryRepository.ts` | Read inventory records/stock, batches, batch pricing |
| Activity | `src/persistence/repositories/activityRepository.ts` | Read and validate append-only Activity events |
| Sale drafts | `src/persistence/repositories/salesDraftRepository.ts` | Read active Sale drafts only |
| Completed Sales | `src/persistence/repositories/salesRepository.ts` | Read completed Sale headers/items/snapshots |
| Receive Delivery drafts | `src/persistence/repositories/receiveDeliveryDraftRepository.ts` | Read active Delivery drafts only |
| Received Deliveries | `src/persistence/repositories/receiveDeliveryRepository.ts` | Read received Delivery history/snapshots/recorded IDs |

**Confirmed:** None of these has a write method. `transaction.ts` is a generic execution boundary, not a domain repository. The existing repository tests primarily use isolated in-memory SQLite fixtures; the transaction wrapper test mocks the Tauri command. The Rust transaction implementation has its own tests.

## Schema and persisted-record inventory

Migration 001 defines the relational base. Migrations 002 and 003 add and guard `delivery_items.received_inventory_id`. The prior Stage 15.5.19.1 report records that migration 003 is already applied; this assessment did not verify the normal database itself.

| Table | Persisted purpose and key relationships |
|---|---|
| `products` | Product ID/order, name, description, generic name, manufacturer, category |
| `variants` | Variant ID/order/name/registration, parent Product |
| `packaging_levels` | Per-Variant level ID/order/name/prices/conversion quantity/next-level link; self-FK and cycle guards |
| `variant_low_stock_thresholds` | Optional per-Variant threshold quantity and packaging reference |
| `batches` | Batch ID/order/number/expiry/received date, owned by Product/Variant |
| `inventory_records` | Inventory ID/order, Product/Variant, nullable batch; one record per non-null batch identity |
| `inventory_stock` | Per-inventory-record/per-packaging quantity and order |
| `batch_pricing` | Per-batch/per-packaging cost/selling prices and order |
| `sale_drafts`, `sale_draft_items` | Sale draft header/status/details and ordered editable lines |
| `sales`, `sale_items` | Immutable completed Sale header/lines, totals and typed historical item JSON |
| `deliveries`, `delivery_items` | Active/received Delivery header and lines; received rows retain batch, Inventory ID, receipt snapshot |
| `activity_events` | Append-only event metadata and complete JSON snapshot; unique event ID and operation key |

Positions are persisted and have uniqueness constraints. Money is persisted in integer minor units. Foreign keys are enabled by the Rust persistence boundary. Product/Inventory rows are mutable; Activity and completed Sales are immutable; received Deliveries are immutable. Draft-specific triggers enforce legal state transitions and item edits. Historical Sale/Delivery item identity columns intentionally are not foreign keys to mutable Product or Inventory rows.

## Mapping of existing business writes

The mapping below describes records the transaction must commit together for the corresponding existing reducer action/workflow. “Activity” means an event already generated by the current domain workflow; it does not prescribe new event types.

### Product, Variant, and packaging

| Existing operation | SQLite records to affect in one commit | Activity and notes |
|---|---|---|
| Catalogue Product creation (`product.catalogue_created`, also used by Receive Delivery) | Insert `products`; insert its `variants`; insert each `packaging_levels` row; insert `variant_low_stock_thresholds` where the domain has a threshold. No Inventory row is created by this catalogue-only operation. | Append the existing `product.created` snapshot event. Insert parent rows before dependent rows; create hierarchy links in a valid order or use a safe two-step link update. |
| Full Product creation (`product.created`) | Same catalogue rows plus new `batches`, `inventory_records`, `inventory_stock`, and any `batch_pricing` represented in the creation result. One record is created per produced batch/unbatched stock group when packaging exists; zero-stock/empty structures may have no corresponding stock row. | Append `product.created` and each existing `inventory.batch_created` event for batches in the same transaction. Do not publish a Product in `ApplicationState` if any child/event write fails. |
| Add Variant (`product.variant_added`) | Insert `variants`, its `packaging_levels`, and its threshold row when present. | Append the existing `product.variant_added` event. This can be initiated from Product UI or Receive Delivery. |
| Edit Product / Variant / packaging / conversions (`product.updated`) | Update Product scalar columns; update/insert Variant rows; update/insert packaging rows (name, nullable prices, `next_level_id`, `quantity_of_next_level`); upsert/delete threshold rows as needed. Existing update validation disallows removing existing Variant/packaging IDs; removals use separate actions. | Append the generated `product.updated` event and any `inventory.stock_adjusted` events the current builder produces. Position values must match the submitted order. |
| Remove Variant (`product.records_deleted`) | Remove its inventory stock/records and batch pricing/batches; remove packaging rows and threshold/Variant records in FK-safe order. Other Variants and historical Sale/Delivery/Activity rows remain. | Append the matching `product.variant_removed` snapshot event(s) in the same commit. |
| Remove packaging level (`product.records_deleted` / `product.packaging_removed`) | Rewire adjacent packaging links and conversion quantities; remove that packaging level’s `inventory_stock` and `batch_pricing` rows; remove Inventory records that the current plan drops when they have no remaining stock entries; delete the packaging row. Update any threshold only where current workflow allows it. | Append the existing packaging-removal snapshot event. Self-FK references must be rewired before delete. |
| Permanently delete Product (`product.deleted`) | Delete all dependent `inventory_stock`, `inventory_records`, `batch_pricing`, `batches`, thresholds, packaging, Variants, then Product, respecting `ON DELETE RESTRICT` and packaging self-links. Existing completed Sale, received Delivery, and Activity history must remain. | Insert the `product.deleted` snapshot event before deleting the Product; schema trigger requires a matching `product.deleted:<productId>:` operation-key prefix. Entire event-plus-delete operation must roll back together. |

Product name and description are explicitly allowed to change while a Product is represented in an active draft. The UI lock messages say inventory/structure cannot change, but name/description can. The SQL lock trigger similarly targets `generic_name`, `manufacturer`, and `category`, not `name` or `description`. Preserve this distinction rather than applying a broader lock.

### Inventory and batches

| Existing operation | SQLite records to affect in one commit | Activity and notes |
|---|---|---|
| Initial stock/batches during full Product creation | Covered by the full Product transaction above: insert batch, inventory record, stock rows, and any pricing rows. | Same Product-create transaction and generated batch events. |
| Inventory save/stock adjustment (`inventory.saved`) | Upsert or insert/delete the affected `inventory_records` and `inventory_stock` rows; insert/update/delete `batches` and `batch_pricing` rows represented by the submitted state. Preserve each inventory ID, batch association, packaging ID, and order. | Persist every generated `inventory.stock_adjusted`, `inventory.batch_created`, and `inventory.batch_updated` event in the same transaction. |
| Batch removal (`inventory.batch_removed`) | Delete associated `inventory_stock`/`inventory_records` and `batch_pricing`, then delete the `batches` row. Preserve all historic Sale/Delivery/Activity references. | Append the existing `inventory.batch_removed` snapshot event atomically with deletion. |
| Stock mutations from Sale/Delivery approval | Update the exact affected `inventory_stock` rows; add a row only when the domain plan creates a packaging-level quantity entry. | Approval event and completed workflow rows are part of the same transaction (see below). There is no separate stock-movement table; current stock plus Activity snapshots carry this information. |

### Sales drafts and approval

| Existing operation | SQLite records to affect in one commit | Activity and notes |
|---|---|---|
| Create Sale draft | Insert `sale_drafts` with status `draft`, timestamps, nullable customer/address/date/staff/notes. An empty draft is valid. | Current `sale.draft_created` action has no Activity event. |
| Edit Sale draft header or line | Update `sale_drafts.updated_at` and changed detail columns; insert/update/delete ordered `sale_draft_items` rows for add/edit/remove. Preserve line IDs and item positions. If removing the final line, current reducer removes the draft from application state; persistence should delete the still-active header (child items cascade), not leave an unrepresented empty draft. | Current draft-edit actions generate no Activity event. Item insert/update triggers verify the active status and Product/Variant/packaging/Inventory/batch association. |
| Cancel Sale draft | Update `sale_drafts.status` to `cancelled` and `updated_at`; retain its items and header. It is terminal and immutable by schema trigger. | Current `sale.draft_cancelled` action has no Activity event. The active-draft read repository omits cancelled rows; do not treat them as active after restart. |
| Approve Sale (`sale.completed`) | Update exact affected `inventory_stock`; insert `activity_events`; insert `sales` header and all `sale_items` with minor-unit values and serialized transaction-time snapshots. Inserting `sales` fires the trigger that changes the source `sale_drafts` row to `approved`, sets `approved_sale_id`, and copies completion time to `updated_at`. Completed Sale and item rows are immutable. | The `sales` insert trigger requires an active non-empty source draft and a matching `sale.completed` Activity event (`sale.completed:<saleId>`). Include stock, event, header, lines, and draft approval in the **same transaction**. |

### Receive Delivery drafts and receipt approval

| Existing operation | SQLite records to affect in one commit | Activity and notes |
|---|---|---|
| Create Delivery draft | Insert `deliveries` with status `draft`, timestamps and nullable header values; insert `delivery_items` on item creation. | No Activity event on draft creation. Persist nullable required-header fields without inventing domain defaults. |
| Edit Delivery draft | Update `deliveries.updated_at` and changed header values; insert/update/delete ordered `delivery_items`. Received-item fields remain null until approval. | No Activity event on ordinary draft edits. Schema triggers reject item edits once received. |
| Cancel Delivery draft | Insert matching `delivery.draft_cancelled` event, then delete the `deliveries` row; its draft items cascade. The schema has no `cancelled` Delivery status. | Event and deletion are atomic. The delete trigger requires the matching `delivery.draft_cancelled:<deliveryId>` event. |
| Approve/receive Delivery (`delivery.approved`) | Update existing or insert `batches`; update/insert `batch_pricing`; update/insert `inventory_records` and `inventory_stock`; update each `delivery_items` row with `received_batch_id`, `received_inventory_id`, and `receipt_snapshot_json`; insert the `delivery.received` Activity event; set `deliveries.status='received'`, `updated_at`, valid date/recipient and `received_event_id`. | One transaction must include every item’s stock effect and history. `DeliveryApprovalPlan.receivedItemAssociations` provides the exact item→Inventory/batch IDs. Migration 003 requires valid non-empty Inventory associations on the draft→received transition and guards association identity. |

### Activity and historical snapshot persistence

There is no standalone Activity UI write action; Activity is produced alongside Product, Inventory, Sale approval, and Delivery lifecycle writes. The event repository is read-only. For each existing event, the writer must persist relational metadata (`event_id`, `operation_key`, `event_type`, `occurred_at`, nullable `actor_id`) and the complete `event_json`, with these duplicated values matching the serialized event. `activity_events` has unique event and operation keys and rejects update/delete.

Completed Sale lines require the existing `CompletedSaleItem` transaction-time snapshot in `sale_items.item_snapshot_json`; Delivery receipt lines require `ReceivedDeliveryItemSnapshot` in `delivery_items.receipt_snapshot_json`. These are not interchangeable with Activity item shapes. In particular, the receipt snapshot has `deliveryItemId`; the `delivery.received` Activity item does not. Keep IDs, nullable values, item order, prices, batches, and snapshots from the prepared workflow plan; never reconstruct historical fields from current catalog/stock rows.

No Sale-draft create/edit/cancel Activity event is generated by current code, and the current schema event-type constraint contains no Sale draft lifecycle event. **Unresolved:** Whether those events are intentionally outside Activity or should be a future business/schema requirement. Do not fabricate event types or change business rules as part of an implementation that assumes the current contract.

## Product-wide locks and historical references

- The schema’s `active_draft_products` view includes Product IDs referenced by items in `sale_drafts.status='draft'` or `deliveries.status='draft'`. Empty drafts do not lock a Product, matching the current helper’s item-based lock.
- Triggers block Variant/packaging/threshold/batch/Inventory/stock/batch-pricing changes for a locked Product. Product generic name/manufacturer/category edits are also locked; Product name/description edits are intentionally allowed.
- Existing reducer guards check locks for many structure and Inventory actions. Approval writes need careful sequencing because they mutate stock and release their own draft; any *other* active draft for the same Product remains in the view.
- **Confirmed interaction risk:** Sale/Delivery approval may update `inventory_stock` while a different active draft still references the same Product. The SQL lock trigger can reject that statement, even though the in-memory approval path can prepare/dispatch it. The transaction should fail without partial changes and the UI must surface failure. **Unresolved workflow decision:** Is this intended “cancel/complete all same-Product drafts first” behavior, or should the lock policy be narrowed? Resolve with focused tests and existing business-rule owners before altering schema or rules.
- Sale historical item rows and received Delivery item rows keep Product/Variant/packaging/Inventory identifiers without restrictive foreign keys to mutable records. Activity stores snapshots as JSON. Hard deletion can therefore preserve historical evidence, provided the generated deletion event is inserted and child operational rows are removed in the required FK order.
- Received Delivery associations are intentionally not live foreign keys. Migration 003 validates association consistency at receipt and when the targeted Inventory identity is inserted/changed; deletion of a current Product/Inventory row must not erase the stored ID or receipt snapshot.

## Domain/schema and integration mismatches

1. **Persistence-only state:** `ApplicationState` has no received-Delivery history collection or source DTO envelopes. Its `sales` field contains `CompletedSale` projections, which omit relational `sourceDraftId`/`completedEventId`; `ApplicationStateHydration` retains the persisted forms separately.
2. **Nullable Delivery draft headers:** SQLite permits nullable `delivery_date`/`received_by` while a Delivery is a draft. `DeliveryDraft` requires strings. Hydration retains such rows as persistence-only, and the projection omits them from `ApplicationState`; write/lock coordination must not lose their active Product lock.
3. **Received Delivery association/snapshot:** The read DTO has `receivedInventoryId`, `receivedBatchId`, and receipt snapshot JSON; the domain `DeliveryDraftItem` has none of those fields. Preserve exact `receivedItemAssociations` and serialized receipt DTOs outside that domain type.
4. **Read projections omit storage distinctions:** Product/Inventory repositories return domain arrays and discard some SQL NULL distinctions and numeric order columns. They cannot supply exact old positions for update by themselves. Writes need an explicit ordering strategy based on the submitted domain order/current state.
5. **Status representation:** Sale drafts support `draft/cancelled/approved`, but only active drafts are loaded into the domain list. Delivery rows are `draft/received`; cancellation deletes the draft and keeps a cancellation Activity snapshot. Do not map the two cancellation lifecycles as if identical.
6. **Money and quantities:** Domain prices are decimal numbers, while SQL uses integer minor units. Convert and validate cent precision at the boundary. SQL quantities are safe non-negative integers; transaction parameters also reject unsafe JavaScript integers.
7. **Uniqueness/order:** Product, Variant, packaging, batch, Inventory, stock, pricing, Sale item, and Delivery item positions have unique constraints. Reordering/re-numbering multiple existing rows may conflict with immediate unique checks; use a tested temporary-position or safe update strategy within the same transaction.
8. **Operation idempotency:** Activity `operation_key` is unique. Generated event IDs/operation keys are often prepared in memory before commit. Retry after an uncertain commit must verify the persisted operation and not blindly duplicate or silently diverge.
9. **State synchronization:** A successful SQL commit followed by a failed/stale reducer action would leave SQLite ahead of memory. Conversely, dispatching before commit would show a write that later rolls back. The current immutable `hydration` prop is a startup snapshot and does not automatically change after reducer actions.

## Atomicity and post-commit state requirements

**Recommendation for every write stage:** Build and validate the prospective action/state first; execute a parameterized transaction; check all expected affected-row counts; only after confirmed commit publish the matching reducer action and update/refresh any persistence sidecar. Serialize writes or reject stale plans so a second in-flight action cannot invalidate the action being committed. If post-commit in-memory publication fails, report it explicitly and rehydrate from SQLite rather than showing success with divergent state.

For approval workflows, precompute one immutable plan from the current `ApplicationState`; use conditional DML or equivalent expected-value guards for stock and draft state; put every resulting row, all event rows, and history rows in the same transaction. Verify rollback when each intermediate statement fails. The Rust boundary guarantees statement-batch rollback, but it does not validate domain-specific row counts or synchronize React state.

After each write, `ApplicationState` must match committed Products/stock/batches/active drafts/completed Sales/events. Persistence-only historical records and `receivedItemAssociations` must also be updated from the committed plan or a fresh consistent hydration; they must not be silently lost behind the startup hydration snapshot. A re-read must use the existing snapshot path, not separate inconsistent reads.

## Dependency-aware Stage 15.6.2 onward

The sequence below is intentionally split by workflow. Every database test must use isolated in-memory/temp fixtures with the current migrations embedded as appropriate; never use the normal database or its backup.

### Stage 15.6.2 — Append-only Activity write foundation

**Depends on:** Existing transaction boundary and historical serializer (already present).  
**Scope:** Add only the common Activity insert mapping/validation used by later write transactions. No business workflow writes or UI persistence yet.

**Acceptance criteria**
- The typed event writer persists all relational metadata and the complete serialized event consistently.
- Duplicate event/operation keys and malformed/incompatible events fail explicitly.
- It exposes row-count expectations to transaction callers and does not claim that a zero-row mutation succeeded.
- No migration/schema or normal-database change.

**Focused tests:** Event union round-trip/metadata agreement; duplicate key rejection; append-only update/delete constraint; isolated transaction rollback when event insertion fails.  
**Exit:** Existing event types can be inserted/read through production serialization on an isolated database, and a failed event write leaves no transaction changes.

### Stage 15.6.3 — Catalogue, Variant, and packaging writes

**Depends on:** 15.6.2.  
**Scope:** Persist catalogue-only Product creation, Variant addition, and Product/Variant/packaging/conversion/threshold edits; wire only their current actions to commit-before-dispatch. Exclude initial-stock Product creation, deletions, and Inventory maintenance.

**Acceptance criteria:** Correct nullable metadata, minor-unit prices, threshold references, hierarchy links, ordering, and Activity snapshots round-trip; SQL active-draft and cycle guards surface errors without changing live state.

**Focused tests:** Create/edit/append round trips; conversion-chain and threshold references; order changes; null/empty boundary behavior; active draft rejection; injected middle-statement failure proves no partial rows/event/state.

**Exit:** These structural operations survive restart in the isolated fixture and failed writes leave both SQL and `ApplicationState` unchanged.

### Stage 15.6.4 — Full Product creation with initial Inventory

**Depends on:** 15.6.2–15.6.3.  
**Scope:** Persist the `product.created` path including initial batches, Inventory records, stock, and batch-created Activity. Do not include later Inventory editing/deletion.

**Acceptance criteria:** Each generated ID and parent relationship from `ProductCreationResult` is stored once; empty/catalogue-only and batched/unbatched cases preserve existing behavior; event snapshots match generated inventory/batch rows.

**Focused tests:** Batched and unbatched creation; no packaging/no stock; nullable prices/expiry; FK order; collision/duplicate failure; failure at each child/event insertion rolls back the complete Product creation.

**Exit:** Full creation round-trips through existing read repositories and is never partially visible.

### Stage 15.6.5 — Inventory and batch maintenance

**Depends on:** 15.6.3–15.6.4.  
**Scope:** Persist `inventory.saved` (stock adjustments, batch creation/metadata edit/pricing) and `inventory.batch_removed`. Exclude Product/Variant deletion and approval stock effects.

**Acceptance criteria:** Stable IDs/batch associations/order and all prices/quantities persist; generated stock/batch events are in the same commit; draft locks and received-history association guards are honored.

**Focused tests:** Stock row insert/update; batch/pricing create/edit; batch removal/cascade; same-value/no-op behavior; active lock; received Delivery historical association after current Inventory deletion; failed writes roll back all updates and Activity.

**Exit:** Inventory/batch edits round-trip via existing read repositories; no reducer publication occurs for a rejected or rolled-back write.

### Stage 15.6.6 — Sale draft lifecycle

**Depends on:** 15.6.2–15.6.5 (draft lines reference persisted inventory).  
**Scope:** Persist Sale draft creation, header/line edits, item add/remove, final-item removal semantics, and cancellation. No completed Sale approval.

**Acceptance criteria:** Active drafts/items and their ordering round-trip; cancellation retains a terminal row; deleting the last line removes the draft if matching current reducer behavior; schema triggers reject invalid statuses/references; zero Activity event is added for draft actions unless separately specified.

**Focused tests:** Empty and populated drafts; full header nullability; line mutations and ordering; last-line removal; cancellation/terminal immutability; product-wide active locks; invalid stale Inventory reference; failure leaves the prior draft intact.

**Exit:** All current Sale draft actions survive restart and active draft locks are reconstructed without dropping source state.

### Stage 15.6.7 — Atomic Sale approval

**Depends on:** 15.6.2, 15.6.5, and 15.6.6.  
**Scope:** Persist `sale.completed`, stock decrement, matching Activity, Sale header/items/snapshots, and approved source-draft state as one transaction.

**Acceptance criteria:** Sale insert trigger sees a matching event and non-empty active draft; all totals/minor units/snapshots match the prepared completion; source draft transitions once; Sale history is immutable; only post-commit state is published.

**Focused tests:** Multi-line and shared-record stock decrements; nullable data and batch snapshots; expired confirmation metadata; conditional stale stock/draft rejection; duplicate operation retry; fail each statement and assert stock, draft, event, Sale, and items all unchanged. Test a second active same-Product draft and document the expected lock result.

**Exit:** Approval is all-or-nothing and completed Sale/history plus `ApplicationState` agree after reload.

### Stage 15.6.8 — Receive Delivery draft lifecycle

**Depends on:** 15.6.2–15.6.4 and 15.6.6 (shared draft/lock behavior).  
**Scope:** Persist Delivery draft create/edit/item mutations and cancellation. Exclude receipt approval.

**Acceptance criteria:** Nullable draft header fields are preserved in persistence DTOs; cancellation appends its Activity before deleting the draft and cascade items; committed domain state does not fabricate required fields for persistence-only drafts.

**Focused tests:** Empty and populated drafts; header/item updates; nullable required values; cancellation event plus deletion; missing/wrong cancellation event rejection; active lock from a persistence-only draft; rollback at cancellation event/delete.

**Exit:** Draft CRUD and cancellation survive restart and locks remain accurate for all persisted active rows.

### Stage 15.6.9 — Atomic Receive Delivery approval

**Depends on:** 15.6.2, 15.6.5, and 15.6.8.  
**Scope:** Persist one prepared approval plan’s batches/pricing, Inventory/stock, per-item receipt IDs/snapshots, Activity, and received header status as one transaction.

**Acceptance criteria:** Every item’s exact `receivedItemAssociations` is persisted; migrations 002/003 guards pass; item snapshot matches relational fields; an existing or newly created batch/record is associated correctly; status change and resulting stock/history cannot partially commit.

**Focused tests:** Existing versus new batch/Inventory; two lines sharing a batch/record; nullable pricing/expiry; recorded ID preserved if Inventory is later deleted; migration-003 mismatch rejection; failure at each intermediate write leaves draft, stock, batch, snapshot, event, and status unchanged. Include the same-Product active-draft lock case.

**Exit:** Receipt round-trips through received Delivery and Inventory readers with associations intact, and every injected failure leaves the active draft untouched.

### Stage 15.6.10 — Permanent Product/Variant/packaging/batch deletion

**Depends on:** 15.6.3, 15.6.5, 15.6.6, and 15.6.8; seed historical Sale/receipt fixtures to prove retention.  
**Scope:** Persist the existing staged Variant/packaging/batch deletion and Product permanent-deletion actions. No new deletion semantics.

**Acceptance criteria:** Matching deletion snapshots are appended atomically; dependent mutable rows are removed in FK-safe order; packaging links are rewired first; Product-wide active draft locks reject deletion; historical Sale, received Delivery, and Activity records remain readable with original IDs/snapshots.

**Focused tests:** Each deletion kind, multi-delete plan, self-FK hierarchy rewiring, event-required trigger, active draft lock, historical references surviving hard deletion, failure midway rolls back every deletion and event.

**Exit:** Existing delete workflows round-trip with expected live records absent and historical records unchanged.

### Stage 15.6.11 — Cross-workflow hydration and restart reconciliation

**Depends on:** 15.6.3–15.6.10.  
**Scope:** Validate the integrated write path against the startup hydration model and live `ApplicationState`; do not add new business behavior.

**Acceptance criteria:** After each successful write, in-memory domain state and persistence-aware sidecar represent the committed data; startup hydration reconstructs the same representable values, retains persistence-only rows/associations, and rejects inconsistent snapshots explicitly. Failed writes leave no optimistic UI update.

**Focused tests:** Isolated end-to-end round trips for each workflow, empty and populated hydration, persistence-only active Delivery lock, completed/received history after Product deletion, retry/idempotency, and commit-success/state-publication recovery.

**Exit:** A fresh hydration after the complete workflow set agrees with committed database records and the running state without data loss or success-shaped fallback.

## Cross-stage validation requirements

- Use parameterized DML only; never interpolate user/business values into SQL.
- Keep each multi-table business write in one transaction. In particular, test injected failure after every intermediate Sales/Delivery approval write.
- Assert affected-row counts for conditional updates/deletes and surface stale-plan failures.
- Exercise all guards against migrations 001–003 in isolated test databases; do not edit or apply migrations as part of this assessment.
- Verify ordering, NULL semantics, cent precision, safe integer bounds, IDs, operation keys, and snapshot-to-relational consistency using production readers/codecs.
- Verify database and `ApplicationState` remain unchanged on a rejected write, and both reflect a committed write after restart/hydration.
- Re-run only focused tests/build/lint for each implementation stage, expanding validation only when a targeted failure requires it.
- Never use the normal database or verified backup as a test fixture.

## Unresolved questions to settle before the affected workflow stage

1. Should Sale draft create/edit/cancel remain absent from Activity, as current domain actions/schema currently imply, or is new Activity behavior explicitly required later?
2. What is the intended behavior when one Sale/Delivery approval mutates stock while another active draft references that Product? The current schema lock may reject it while in-memory planning allows it.
3. How should product/item positions be maintained on reorder and after deletes, given unique positions and read repositories that do not return every original position?
4. What recovery behavior is desired if SQLite commits but the in-memory reducer publication cannot complete? The safe minimum is explicit error plus fresh hydration; never report success with divergent state.
5. Should terminal cancelled Sale drafts remain user-visible/history-queryable? The schema retains them, while the current active-draft reader and hydration omit them.

## Inspected files and prior reports

### Source and schema

- `src-tauri/src/migrations/migration_001.sql`
- `src-tauri/src/migrations/migration_002_delivery_inventory_association.sql`
- `src-tauri/src/migrations/migration_003_received_delivery_inventory_association_guards.sql`
- `src-tauri/src/migrations.rs`
- `src-tauri/src/persistence.rs`
- `src-tauri/src/lib.rs`
- `src/persistence/database.ts`, `transaction.ts`, `query.ts`
- `src/persistence/applicationDataLoader.ts`, `applicationStartup.ts`, `applicationStateHydration.ts`, `applicationStateProjection.ts`
- All seven `src/persistence/repositories/*Repository.ts` files and representative repository/transaction tests
- `src/applicationState.ts`, `src/App.tsx`
- `src/activity/activity.ts`, `src/persistence/historicalSerialization.ts`
- `src/products/productStructure.ts`, `productCreation.ts`, `productUpdate.ts`, `productDeletion.ts`, `productDraftLock.ts`
- `src/packaging/packagingHierarchy.ts`
- `src/inventory/inventoryStock.ts`, `inventoryBatch.ts`, `inventoryAdjustment.ts`
- `src/sales/salesDraft.ts`, `salesEngine.ts`
- `src/deliveries/deliveryDraft.ts`, `deliveryApproval.ts`

### Reports consulted

- `stage_15_5_8_persistence_integration_gap_resolution.md`
- `stage_15_5_11_historical_serialization_report.md`
- `stage_15_5_12_application_data_assembly_report.md`
- `stage_15_5_14_persistence_hydration_model_report.md`
- `stage_15_5_16_delivery_inventory_association_report.md`
- `stage_15_5_17_applicationstate_readiness_reassessment.md`
- `stage_15_5_19_persistence_aware_live_applicationstate_integration_report.md`
- `stage_15_5_19_1_normal_database_startup_verification_report.md`

## Readiness verdict

**Ready to begin a narrowly scoped Stage 15.6.2, with explicit gates.** The current schema, read/hydration model, historical serializers, and Rust transaction boundary provide a concrete foundation; no database write or migration is needed to start with the append-only Activity write contract and isolated rollback tests. The project is **not ready to claim workflow persistence** until each workflow stage implements and verifies its own atomic DML, row-count/stale-state handling, historical snapshots, and commit-before-dispatch synchronization. Resolve the active-draft approval interaction before implementing Sales or Delivery approval, and preserve the current schema/migration and normal-database restrictions.
