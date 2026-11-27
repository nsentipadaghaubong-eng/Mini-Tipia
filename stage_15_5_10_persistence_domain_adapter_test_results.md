# Stage 15.5.10 — Persistence Domain Adapter Test Results

## Final validation

| Check | Command | Result |
|---|---|---|
| New adapter tests, all seven repository tests, and related Sales/Delivery domain/workflow tests | `npm test -- --run src/persistence/domainAdapters.test.ts src/persistence/repositories/productRepository.test.ts src/persistence/repositories/inventoryRepository.test.ts src/persistence/repositories/activityRepository.test.ts src/persistence/repositories/salesRepository.test.ts src/persistence/repositories/receiveDeliveryRepository.test.ts src/persistence/repositories/salesDraftRepository.test.ts src/persistence/repositories/receiveDeliveryDraftRepository.test.ts src/sales/salesDraft.test.ts src/sales/salesEngine.test.ts src/deliveries/deliveryDraft.test.ts src/deliveries/deliveryApproval.test.ts` | Passed: 12 files, 152 tests. |
| TypeScript check and production build | `npm run build` | Passed: `tsc -b` and Vite production build. |
| Focused ESLint | `npx eslint src/persistence/domainAdapters.ts src/persistence/domainAdapters.test.ts src/persistence/repositories/activityRepository.test.ts` | Passed with no reported lint errors. |

The Vite build emitted its warning that the minified JavaScript bundle exceeds
500 kB, but completed successfully. `node:sqlite` emitted its experimental
warning during tests; tests passed.

## Coverage

- Checked money conversion and unsafe persisted integers.
- Preserved SQL NULL distinctions and IDs in the source DTO while projecting
  optional workflow fields.
- Ordered drafts and items by persisted positions without mutating inputs.
- Preserved Product/Variant/Inventory/Batch/packaging references without
  resolving or rebuilding them from live data.
- Retained opaque receipt JSON exactly, including malformed JSON text.
- Kept valid nullable Delivery headers persistence-only; no date or recipient
  was supplied by the adapter.
- Rejected duplicate item positions, invalid IDs, invalid quantities and
  domain-invalid Sale discounts.
- Verified a prepared `ActivityEvent` fixture serialized as a complete payload
  with matching indexed metadata and was returned unchanged by the Activity
  repository.

## Iteration notes

During test development, an assertion incorrectly treated `Number.MAX_SAFE_INTEGER`
as unsafe; the boundary case was corrected to `Number.MAX_SAFE_INTEGER + 1`.
An attempted invalid-delivery-date assertion also conflicted with the existing
`DeliveryDraft` contract, which leaves draft date validation to approval; the
test now checks invalid IDs instead. A TypeScript narrowing issue in the
Delivery projection was corrected before the final successful build.

## Scope of verification

Repository tests that access SQLite use isolated in-memory databases initialized
with actual Migration 001. No full Vitest suite was run. No normal application
database or production persistence writer was accessed.
