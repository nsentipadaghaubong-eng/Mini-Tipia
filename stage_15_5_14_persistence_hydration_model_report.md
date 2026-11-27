# Stage 15.5.14 — Persistence Hydration Model

## Outcome

Added a persistence-aware hydration boundary in [applicationStateHydration.ts](./src/persistence/applicationStateHydration.ts). It converts the read-only loader aggregate into a typed model without connecting it to `ApplicationState` or startup. Each hydrated record retains the loader's original source record and explicitly describes whether a domain projection is available or the record must remain persistence-only.

The model does not duplicate repository DTOs and does not infer historical information from current Product or Inventory data.

## Model and collection coverage

`ApplicationStateHydration` represents all eight loader collections:

| Collection | Source retained | Projection |
|---|---|---|
| Products | Product values returned by the loader | Same Product domain value |
| Inventory records | Inventory values returned by the loader | Same Inventory domain value |
| Inventory batches | Batch values returned by the loader | Same batch domain value |
| Activity events | Fully parsed `ActivityEvent` values returned by the loader | Same validated event |
| Completed Sales | Original `PersistedSale` record, including item snapshot JSON and relational metadata | `CompletedSale` when available and cross-checked against parsed historical item snapshots; otherwise explicitly persistence-only |
| Received Deliveries | Original `PersistedReceivedDelivery` record and item receipt snapshots | Received `DeliveryDraft`-shaped projection when available and cross-checked against each persisted item; otherwise explicitly persistence-only |
| Active Sales drafts | Original `PersistedSaleDraft` record, including stored positions, approval reference and nullable/source metadata | Validated `SaleDraft` projection |
| Active Receive Delivery drafts | Original `PersistedDeliveryDraft` record, including stored positions and receipt metadata | Validated `DeliveryDraft` projection when required header values exist; otherwise explicitly persistence-only |

Each record uses `HydratedRecord<TSourceRecord, TDomain>`, with a `domainProjection` discriminated union:

- `available` contains the typed domain value.
- `persistence-only` contains a reason and, where applicable, the incompatible field names.

`persistenceOnlyFields` identifies source fields that the domain projection cannot represent. The aggregate also carries forward the loader's `persistenceLimitations`.

The Product, Inventory, batch, and Activity collections use domain-shaped loader records as their source because those repositories/loader contracts do not expose raw SQL row DTOs. Their hydration layer therefore retains the complete loader value, but cannot recover SQL distinctions already collapsed by the repositories. Activity event payloads are complete parsed values under the current event contract; malformed JSON or inconsistent relational metadata is rejected by the existing production read/parser path before hydration.

## Projection checks and data preservation

- Completed Sale projections are compared with values reconstructed from the persisted Sale header and typed transaction-time item snapshots. Snapshot product/variant/packaging/batch IDs, quantities, prices, discounts, totals, and expiry flags are checked against duplicated persisted item columns. Optional header values remain absent when persisted as NULL. The original source record is retained even when a Sale cannot safely be projected.
- Received Delivery projections are checked against persisted item identity, packaging, quantity, received batch ID, batch number/expiry, and receipt prices using the receipt snapshot codec. Receipt snapshots remain distinct from Activity payloads. The original receipt metadata and snapshot JSON remain available in `sourceRecord`.
- Active Sale draft projections are checked against the existing adapter output. Their DTO retains fields not representable in `SaleDraft`, including persisted positions, approval ID, and the distinction between SQL NULL and optional-field absence.
- Active Delivery draft projections are checked against the existing adapter output. `deliveryDate` or `receivedBy` being NULL keeps the whole original draft available with a persistence-only status; no date, recipient, or supplier value is fabricated. Incompatible required header fields are listed.
- A received Delivery item's inventory-record relationship is represented as `status: "unresolved"` with `inventoryRecordId: null` and reason `not-recorded-for-received-delivery-items`. No relation is inferred from a batch or current inventory row.
- Duplicate Activity event IDs are rejected by the hydration boundary.

The model retains existing IDs, relationships, item arrays/order, nullable values, lifecycle distinctions, snapshots, and original persisted values as provided by the loader. Completed Sales and received Deliveries remain separate collections from active drafts.

## Limits and remaining integration blockers

1. The loader's repository reads are concurrent independent queries, not a shared SQLite read transaction. This stage intentionally does not alter that behavior; integration must address the Stage 15.5.13 read-consistency blocker.
2. The current ApplicationState and UI have not been adapted to consume hydration envelopes or persistence-only rows. This model is not connected to startup or live state.
3. Received Delivery items still have no recorded association to an Inventory record. The model preserves this as unresolved/null.
4. Product, Inventory, and Activity source records are the loader's already-projected values, not raw database DTOs. The hydration model cannot restore persistence distinctions absent from those contracts.
5. Active draft repositories return active drafts; this model does not add terminal/cancelled drafts or implement write persistence.
6. Historical projection depends on the existing typed snapshot parsers. Unsupported/malformed snapshot data must remain persistence-only or fail according to the loader's existing validation; it is never reconstructed from live records.

No domain or schema changes were required for this stage. No startup, UI, repository query behavior, business workflow, migration, schema, or database write behavior was changed.

## Validation

See [stage_15_5_14_persistence_hydration_model_test_results.md](./stage_15_5_14_persistence_hydration_model_test_results.md) for commands, results, initial failed attempts, and final reruns.
