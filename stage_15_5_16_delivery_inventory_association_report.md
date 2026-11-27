# Stage 15.5.16 — Received Delivery to Inventory Association

## Result

Received Delivery items now retain the identity of the Inventory record affected at approval, alongside the existing received-batch ID. The association is exposed by the received-Delivery repository and persistence-aware hydration model. Migration 001 remains unchanged; a forward-only Migration 002 adds the missing record ID and guards the relationship.

The association remains historical data: deleting a current Inventory record, batch, or Product does not delete the received Delivery item, its receipt snapshot, or its recorded IDs.

## Workflow evidence and cardinality

`prepareDeliveryApproval()` resolves one batch for each Delivery item, then `addItemStock()` resolves or creates one Inventory record for that batch and adds the line quantity to it. Multiple matches are rejected. The approval plan previously returned the resulting Inventory and batch arrays, but did not retain the item-to-record mapping.

The approval plan now returns `receivedItemAssociations`, one `{ deliveryItemId, inventoryRecordId, batchId }` entry for each item. It is built from the exact batch and updated Inventory record selected by the existing workflow; it does not look these values up later from mutable stock. Multiple Delivery items can point to the same batch and Inventory record. A single item does not fan out across multiple records or batches in the current workflow.

`applicationReducer` validates the submitted association entries against the deterministic approval plan, including the IDs assigned to newly created records. This adds integrity validation for the new metadata and does not change stock, batch-matching, pricing, or approval rules.

## Persistence model

Migration 001 already stored `delivery_items.received_batch_id`, but that column had no Inventory-record counterpart or foreign key. Its receipt trigger required a snapshot and non-null batch ID but did not verify an Inventory record relationship. The Activity payload is not used as a substitute: its receipt item shape differs from the persisted receipt-item snapshot and does not carry this row association.

Migration 002 adds nullable `delivery_items.received_inventory_id`. It intentionally does not add a foreign key to mutable Inventory or Product rows:

- The text ID remains after the target Inventory row or Product is deleted.
- A received Delivery item's batch ID and receipt snapshot remain independently available.
- The value cannot cascade-delete or erase historical Delivery evidence.

The migration adds checks at the available write boundaries:

- A new transition from draft to received requires a non-empty Inventory ID. If the target record already exists, its Product, Variant, and batch must match the Delivery item.
- If a new Inventory record is inserted after the Delivery is marked received, an insert trigger checks that it matches the recorded item association.
- Updating an Inventory record's identity so that it contradicts a received Delivery association is rejected. Stock-quantity changes remain allowed.

This order releases the Delivery's own active-draft inventory lock before a newly created batch/record is materialized. A separate active Sale draft can still lock that Product's inventory; coordinating that pre-existing constraint is left to the future write workflow. The database writer and that transaction are not implemented in this stage.

## Read and hydration representation

`PersistedReceivedDeliveryItem.receivedInventoryId` is a nullable identifier. The received-Delivery query remains independent of current Product/Inventory joins and preserves the ID and receipt snapshot verbatim. It does not derive an association from a current batch or stock record.

The hydration model now represents both item-level IDs and the state of the Inventory association:

- `recorded` with `currentTargetStatus: "present"` when the ID exists and its stable Product/Variant/batch identity matches.
- `recorded` with `currentTargetStatus: "not-currently-present"` when the recorded target is absent from the current Inventory collection. The ID is retained; absence is not treated as proof of corruption because the target may have been deleted.
- `invalid` when a current record with that ID contradicts the persisted Product, Variant, or batch.
- `unresolved` with a null ID when no association was recorded, as is expected for existing received rows migrated from Migration 001.

Received Delivery domain projections remain based on their receipt snapshots. The Inventory association is a separate persistence/hydration relation and is not added to the Activity payload or reconstructed into the historical snapshot.

## Migration compatibility and data limits

Migration 001 is unchanged. Migration 002 is applied through the existing immutable migration ledger and executor. Existing received rows receive a NULL `received_inventory_id`; there is no safe way to infer the approval-time Inventory-record ID from current stock, so no backfill is attempted. Such records remain available with an explicitly unresolved association.

The ID is not a live foreign key by design. Consequently, if a non-null target is absent now, the schema cannot distinguish a legitimately deleted Inventory record from an incomplete or externally corrupted write. Hydration reports that the target is not currently present and preserves the original ID rather than guessing. A future Delivery writer must write the Delivery metadata and resulting Inventory changes atomically and must ensure that newly planned IDs are actually materialized in that transaction.

This closes the historical association gap recorded in the Stage 15.5.13–15.5.15 reports. It does not connect the loader or hydration model to `ApplicationState`, add a Delivery write repository, or alter the Stage 15.5.15 read-snapshot boundary.

## Validation

Exact commands, results, initial failures, and corrections are recorded in [stage_15_5_16_delivery_inventory_association_test_results.md](./stage_15_5_16_delivery_inventory_association_test_results.md).
