# Stage 15.5.11 — Historical Serialization Test Results

## Final validation

| Check | Command | Result |
|---|---|---|
| Serialization codecs, Activity repository/domain, Sales and Delivery repositories/domain | `npm test -- --run src/persistence/historicalSerialization.test.ts src/persistence/repositories/activityRepository.test.ts src/activity/activity.test.ts src/activity/activityPresentation.test.ts src/persistence/repositories/salesRepository.test.ts src/persistence/repositories/salesDraftRepository.test.ts src/persistence/repositories/receiveDeliveryRepository.test.ts src/persistence/repositories/receiveDeliveryDraftRepository.test.ts src/sales/salesDraft.test.ts src/sales/salesEngine.test.ts src/deliveries/deliveryDraft.test.ts src/deliveries/deliveryApproval.test.ts` | Passed: 12 files, 166 tests. |
| TypeScript application check and production frontend build | `npm run build` | Passed: `tsc -b` and Vite production build. |
| Focused ESLint | `npx eslint src/persistence/historicalSerialization.ts src/persistence/historicalSerialization.test.ts src/persistence/repositories/activityRepository.ts` | Passed with no reported lint errors. |

The Vite build emitted the existing >500 kB minified chunk warning. The
SQLite-backed repository tests emitted Node's `node:sqlite` experimental
warning; all tests passed.

## Coverage

- Completed Sale item snapshot round trip with original IDs/relationships,
  nullable batch/default price, historical names/packaging, and exact
  cent-precision financial values.
- Received Delivery item snapshot round trip with distinct Activity/item
  shapes, nullable pricing/batch metadata, item ID, captured packaging and
  quantity.
- Rejection of malformed JSON, missing required snapshot fields and
  out-of-contract financial precision.
- Preservation of unknown additional snapshot/event JSON fields without
  dropping them.
- Complete ActivityEvent serialization and deserialization for all 16
  currently defined variants, including nullable/optional fields and nested
  snapshots.
- Rejection of invalid nested event values and mismatches for each duplicated
  Activity relational metadata field.
- Existing Activity repository tests cover Migration 001-backed event reads,
  full payload round trips, ordering, malformed JSON and metadata mismatch.
- Sales and Delivery repository fixtures use Migration 001 in isolated
  in-memory SQLite and verify historical snapshot data is retained despite
  different current catalog names. No live Product/Inventory joins are used
  to reconstruct the historical values.

## Scope and persistence limits

All repository database tests use isolated in-memory databases initialized
with the checked-in Migration 001 SQL. No normal application database was
opened. No schema change or database write implementation was made or tested.
The Activity serializer output test verifies the serialization contract only;
it does not claim that a production writer exists.

No full Vitest suite was run.
