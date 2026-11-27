# Stage 15.5.10 — Persistence-to-Domain Adapter Report

## Executive result

Added explicit Sale and Delivery draft projections. Each compatible projection
contains both a validated workflow-domain value and the untouched persistence
DTO, so the DTO remains available for fields and distinctions the current
domain cannot represent. A Delivery draft with a NULL required domain header
is returned as persistence-only with the exact incompatible fields identified;
no placeholder is invented.

The other repository results are either already mapped to Product/Inventory/
Activity domain shapes or remain persistence-facing read models because
historical snapshot contracts are not established. No ApplicationState loader
or startup integration was added.

## Files created or changed

- Added `src/persistence/domainAdapters.ts`.
- Added `src/persistence/domainAdapters.test.ts`.
- Updated `src/persistence/repositories/activityRepository.test.ts` with a
  prepared-event serialization-contract test using an isolated Migration 001
  database fixture.
- Added this report and `stage_15_5_10_persistence_domain_adapter_test_results.md`.

No Product, Inventory, Sales, Receive Delivery, Activity, or ApplicationState
workflow implementation was changed. No UI, startup, schema, migration, or
database write implementation was added.

## Complete compatibility matrix

| Repository result | Existing domain/state destination | Mapping and retained information |
|---|---|---|
| `getAllProducts()` → nested `productStructure[]` | `ApplicationState.products` | IDs, nesting/relationships, and relative ordering map directly. Minor-unit prices are checked before conversion to major-unit numbers. SQL NULL optional catalog text/registration fields and nullable threshold packaging references become absent optional properties; the domain does not distinguish NULL from absent. Numeric Product/Variant/packaging positions are represented by array order, not retained as position numbers. |
| `getAllInventory()` → `InventoryRepositoryData` | `ApplicationState.inventoryRecords` and `inventoryBatches` | IDs, Product/Variant/Batch links, stock quantities, batch identity, expiry and pricing map to domain types. Prices use checked minor-unit conversion; expiry dates become UTC `Date` values for the same calendar date. Nullable received dates become absent optional values. Stock/batch/pricing positions are represented by array order, not raw position numbers. The repository validates live Product/Variant/packaging relationships and inventory-to-batch associations. |
| `getAllActivityEvents()` → `ActivityEvent[]` | `ApplicationState.activityEvents` | The JSON object supplies the complete event payload, while event ID, operation key, type, timestamp and actor ID are checked against indexed columns. Event array ordering is preserved. NULL `actor_id` is represented as an absent optional `actorId`; exact serialized JSON text is not retained. Safe reconstruction depends on an unimplemented writer serializing the complete model. The current reader checks event-specific top-level keys, but nested array/object members are not exhaustively runtime-validated. |
| `getAllSales()` → `PersistedSale[]` with `PersistedSaleItem[]` | `ApplicationState.sales: CompletedSale[]` | Not losslessly adaptable to `CompletedSale`: persisted source-draft/event IDs and status metadata do not exist on the domain type; the Sale item domain requires typed Product/Variant/Batch/packaging snapshots, while `item_snapshot_json` has no established shape or writer. The repository preserves raw JSON plus parsed `unknown`, nullable metadata and identifiers; money is checked and converted. Sale/item relative ordering is retained in arrays. Keep this persistence model separate until the snapshot and envelope contract is decided. |
| `getAllReceivedDeliveries()` → `PersistedReceivedDelivery[]` | No completed-delivery collection exists in `ApplicationState`; `DeliveryDraft` is not a received-history model | No lossless domain mapping exists. The read model preserves received status, links, nullable supplier/invoice, item IDs/references/order, raw and parsed opaque receipt snapshots, and checked major-unit prices. It has no `DeliveryDraft` destination for `receivedEventId`, `receivedBatchId`, or snapshots. `receivedAt` is currently an alias of stored `updatedAt`, not a separate database timestamp. |
| `getAllActiveSaleDrafts()` → `PersistedSaleDraft[]` | `SaleDraft[]` | `adaptPersistedSaleDraft(s)` creates a validated domain projection with checked minor-to-major money conversion and item/draft ordering. The wrapper retains the exact source DTO, including nullable-versus-absent metadata, positions, and `approvedSaleId`. Live Product/Inventory reference validation is not done here; it requires the complete candidate state and belongs in the future loader. |
| `getAllActiveDeliveryDrafts()` → `PersistedDeliveryDraft[]` | `DeliveryDraft[]` | `adaptPersistedDeliveryDraft(s)` creates a validated domain projection only when both `deliveryDate` and `receivedBy` are non-NULL. Otherwise it returns `domain: null`, the source DTO, and `incompatibleFields`; it never fabricates either value. Compatible results retain the source DTO with positions, NULL distinctions, `receivedEventId`, `receivedBatchId`, and raw receipt JSON. Price conversions are checked. Cross-repository reference validation remains a loader responsibility. |

### Adapter behavior

`src/persistence/domainAdapters.ts` performs only the following conversions:

- Sort draft collections/items by persisted positions without mutating their
  inputs; reject duplicate IDs/positions and unsafe positions.
- Convert minor-unit amounts to workflow major-unit numbers only for
  non-negative safe integers whose conversion round-trips under the existing
  cent-precision rule. Nullable prices remain NULL.
- Pass persisted IDs and associations directly to workflow values. The adapter
  does not resolve them against current Product or Inventory state.
- Run the existing `validateSaleDraft` / `validateDeliveryDraft` contracts on
  supported projections; invalid domain data fails explicitly.
- Return the original persistence DTO in every successful projection and in
  the incompatible Delivery result. This retains fields the domain type
  cannot represent and SQL NULL distinctions the domain expresses as optional
  properties.

The wrapper is intentionally not an `ApplicationState` integration API. A
future loader must keep the persistence envelope alongside any domain value;
extracting only `.domain` would discard the explicitly listed persistence-only
fields.

## Deliberately persistence-only data and unresolved incompatibilities

- Completed Sale `item_snapshot_json` and received Delivery
  `receipt_snapshot_json` have no authoritative writer/serializer shape.
  Their repository DTOs remain the historical boundary; no adapter casts
  `unknown` to `CompletedSaleItem` or a typed receipt snapshot.
- Completed Sales retain `sourceDraftId` and `completedEventId`; received
  Deliveries retain `receivedEventId` and per-item `receivedBatchId`. Existing
  workflow/domain types do not represent all these links.
- Active Sale draft positions, approved-sale association and SQL NULL versus
  optional-field absence stay in the source DTO.
- Delivery `deliveryDate` and `receivedBy` are validly nullable in Migration
  001 drafts, but required strings in `DeliveryDraft`. Those rows remain
  persistence-only until a domain change or a separately approved invariant
  resolves the mismatch.
- Delivery supplier/invoice names differ from the domain's supplier property;
  source DTOs preserve exact strings and NULLs even when the domain validator
  normalizes optional text.
- Current domain values use array ordering rather than raw numeric Product,
  Inventory, Sale-history or Delivery-history positions. Relative order is
  retained; exact historical position numbers are not a domain contract.
- Draft references cannot be validated against live Product/Inventory
  collections by these local adapters. The eventual coordinated loader must
  validate live active-draft references and reject inconsistencies without
  rebuilding or silently dropping them.

## ActivityEvent serialization contract

Inspection found `prepareActivityEvents()` creates complete typed events and
`appendActivityEvents()` updates in-memory history. No production persistence
writer or authoritative `event_json` serializer was found. Existing repository
tests serialize events in fixtures only.

The required future writer contract is therefore specified, but not
implemented or claimed as an existing writer guarantee:

1. `event_json` contains the complete `ActivityEvent` object, including its
   event-specific historical payload and generated `eventId`, `operationKey`,
   `type`, `occurredAt`, and optional `actorId`.
2. `event_id`, `operation_key`, `event_type`, and `occurred_at` are copied
   exactly from that same event. `actor_id` is the event's `actorId`, or SQL
   NULL when `actorId` is absent.
3. Reads compare those indexed values to the payload and reject malformed or
   mismatched events. A future schema/version compatibility policy must be
   decided before claiming forward compatibility.
4. The current runtime validator must be deepened before untrusted nested JSON
   is treated as fully validated `ActivityEvent`; its existing guards validate
   required top-level shape but only check nested structures as records/arrays.

An Activity repository test now constructs an event through
`prepareActivityEvents`, stores the full payload and indexed metadata in its
isolated test database, then checks the exact repository round trip. This
defines the required fixture contract only; it does not prove a production
writer exists or is compatible. No database write path was introduced.

## Validation and tests

The adapter tests cover IDs and references, source DTO retention, NULL fields,
ordering, cent conversion, safe-integer rejection, domain-invalid discounts,
duplicate positions, opaque/malformed receipt snapshot preservation, and
Delivery drafts that cannot be represented because required domain headers
are NULL. The Activity test covers full-event payload plus indexed metadata.

See `stage_15_5_10_persistence_domain_adapter_test_results.md` for exact
commands and outcomes. The focused run passed 152 tests across 12 files.
TypeScript, production build and focused ESLint passed. The build emitted a
Vite bundle-size warning; Node emitted its `node:sqlite` experimental warning.

All database-backed tests used isolated in-memory SQLite initialized with
Migration 001. The normal application database was not accessed or modified.

## Recommendation for the next stage

Before ApplicationState integration:

1. Define and implement the Activity writer/serializer contract, plus complete
   runtime validation for nested Activity payloads.
2. Decide how the future state represents Delivery drafts with nullable
   date/recipient and how Sale/Delivery persistence envelopes survive alongside
   workflow domain values.
3. Approve explicit, version-compatible Sale and Delivery historical snapshot
   contracts, or keep those histories persistence-only.
4. Then build and test an all-or-nothing candidate-state loader; do not make
   completed Sales or received Deliveries appear as domain records until those
   contracts exist.

This stage did not connect any repository to App.tsx or ApplicationState and
did not begin startup integration.
