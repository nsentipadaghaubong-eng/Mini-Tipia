# Stage 15.5.12 — Read-Only Application Data Assembly Report

## Result

Implemented `loadApplicationData` in `src/persistence/applicationDataLoader.ts`. It assembles the existing SQLite read-repository results without connecting the loader to `ApplicationState`, application startup, or UI code. The loader is read-only and returns only after all seven repository reads and post-read validations succeed.

## Repositories and read strategy

`loadApplicationData` calls these existing repository functions concurrently using `Promise.all`:

1. `getAllProducts`
2. `getAllInventory` (returns inventory records and inventory batches)
3. `getAllActiveSaleDrafts`
4. `getAllActiveDeliveryDrafts`
5. `getAllSales` (completed Sales)
6. `getAllReceivedDeliveries`
7. `getAllActivityEvents`

Each rejection is rethrown with the corresponding repository label and original error as its cause. No aggregate is returned when any read fails. Because these are separate concurrent repository queries, this result is **not guaranteed to represent one atomic SQLite snapshot**; records may change between reads.

## Aggregate shape and preservation

`ApplicationDataAssembly` exposes eight collections:

- `products`
- `inventoryRecords`
- `inventoryBatches`
- `activityEvents`
- `completedSales`
- `receivedDeliveries`
- `activeSaleDrafts`
- `activeDeliveryDrafts`

It also exposes `persistenceLimitations`, describing information that the existing repository APIs have already omitted.

Product and Inventory results remain their existing domain projections. Activity rows pass through the production Activity repository parser, which validates persisted event JSON and relational metadata. Completed Sales and received Deliveries each retain their original repository DTO in `persistence`, as well as a domain projection when the existing model can represent one. Active draft results retain the source persistence DTO alongside their domain projection; a Delivery draft that cannot be represented because required domain fields are nullable has a `null` projection and explicit `incompatibleFields`.

Completed Sales and received Deliveries retain repository order, original identifiers and nullable header values in their source DTOs. Their typed historical item snapshots are parsed using the production snapshot codecs and checked against duplicated item columns before a domain projection is made. Historical Product, Variant, packaging, batch, and Inventory identifiers and values are not rebuilt from current catalog or stock. If a historical snapshot is malformed or cannot be projected, the record and snapshot text remain available through the source DTO and the projection is `null` with a `projectionIssue`. Inconsistent duplicated snapshot/relational values reject the assembly rather than being reconciled silently.

## Lifecycle and relationship checks

- Completed Sales and received Deliveries are separate from active draft collections. The active-draft repositories exclude cancelled/completed drafts; the loader does not reinterpret historical records as drafts.
- Active Sale draft Product/Variant, packaging, Inventory record, and batch associations are checked against the concurrently loaded live collections.
- Active Delivery draft Product/Variant and packaging references are checked against current Products. Incoming draft batch values are not treated as existing inventory.
- Inventory records and batches are checked for unique IDs and valid Product/Variant, packaging, and recorded batch associations.
- Completed Sale and received Delivery Activity IDs must identify an event of the expected type and entity ID. Duplicate Activity event IDs reject the result.
- Historical references are not required to exist in current Product or Inventory collections.
- The received-Delivery schema/repository records a received batch association but does not record an associated received Inventory-record ID. The loader does not invent that missing association.

## Persistence-only fields and known limitations

The source DTOs for completed Sales and received Deliveries are retained because their current domain types do not represent all persisted lifecycle/relationship information. Loader metadata calls out lifecycle markers, source-draft/event IDs, received batch ID, original snapshot JSON, item positions, and distinctions between SQL `NULL` and absent optional domain properties.

The repository projections already lose information before assembly:

- Product and Inventory repositories return domain values only; original SQL `NULL` distinctions and numeric position values cannot be recovered by this loader.
- Completed Sales and received-Delivery DTOs preserve relative record/item order but do not expose numeric header positions.
- The existing schema does not record a received Inventory-record association for Delivery items.

These are not repaired by looking up current data. An invalid/malformed historical snapshot remains persistence-only where the repository DTO still carries the original JSON; a relational mismatch is a validation error. No unknown fields are fabricated or discarded by this loader.

## Tests

Added `src/persistence/applicationDataLoader.test.ts`, using isolated in-memory SQLite initialized from Migration 001. Coverage includes:

- successful assembly of all eight collections and preservation of historical Sale/Delivery values that differ from current Product and Inventory values;
- empty collections without demo/default records;
- completed-versus-active/cancelled lifecycle separation;
- preservation of source DTOs for a Delivery draft whose nullable header prevents a domain projection;
- persisted IDs, event relationships, nullable fields, historical snapshots, and the lack of an invented received Inventory association;
- Activity parsing through the production Activity repository parser;
- explicit failure for each of the seven individual repository-read failures.

The fixture does not access the normal `sqlite:tipia.db`. It exercises reads and validations only; no database writer or atomic-snapshot behavior is claimed.

## Compatibility, integration status, and remaining blockers

No schema or migration changes are made. The loader consumes the current repository DTOs and typed snapshot codecs. It retains source DTOs for records whose domain projection is incomplete, but cannot preserve SQL distinctions or position values that existing Product/Inventory repositories have already discarded. Integrating the result into `ApplicationState` would require a separate stage to decide how to handle these projection-only limitations and the non-atomic read boundary.

No domain model change is required to provide the aggregate and preserve the available persistence DTOs. No change was made to startup, UI, schema, migrations, write workflows, approval/business rules, or the normal application database. The worktree contained unrelated pre-existing modifications, including an `App.tsx` modification; those were not edited as part of this stage.
