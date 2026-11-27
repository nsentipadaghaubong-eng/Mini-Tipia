# Stage 15.5.9 — Draft Read Repositories Test Results

## Environment

Tests initialized isolated in-memory `node:sqlite` databases using the actual
Migration 001 SQL. No test used the normal application database.

## Final validation

| Check | Command | Result |
|---|---|---|
| Draft and existing historical repository tests | `npm test -- --run src/persistence/repositories/salesDraftRepository.test.ts src/persistence/repositories/receiveDeliveryDraftRepository.test.ts src/persistence/repositories/salesRepository.test.ts src/persistence/repositories/receiveDeliveryRepository.test.ts` | Passed: 4 test files, 18 tests. |
| TypeScript check and frontend production build | `npm run build` | Passed: `tsc -b` and Vite production build. |
| Focused ESLint | `npx eslint src/persistence/repositories/salesDraftRepository.ts src/persistence/repositories/salesDraftRepository.test.ts src/persistence/repositories/receiveDeliveryDraftRepository.ts src/persistence/repositories/receiveDeliveryDraftRepository.test.ts` | Passed with no reported lint errors. |

The production build reported a Vite warning that the minified JavaScript
bundle exceeds 500 kB. The build completed successfully.

Node emitted its existing experimental warning for `node:sqlite` during tests.
The tests still passed.

## Covered behaviors

- Active Sales and Receive Delivery draft reads return empty arrays when there
  are no active records.
- Multiple drafts and items retain stable stored ordering.
- Nullable header/item columns remain `null`; persisted non-null text is not
  trimmed or normalized.
- Empty drafts remain represented.
- Cancelled/approved Sales drafts and received/cancelled deliveries are excluded
  according to Migration 001's lifecycle rules.
- Delivery snapshot JSON is returned unchanged as opaque text, even when it is
  malformed JSON.
- Persisted identifiers, minor-unit amounts, quantities, expiry, batch and
  packaging fields are retained.
- Repository reads leave draft, Activity, and inventory-stock state unchanged.
- Unsafe numeric row data is rejected instead of coerced.

## Iteration notes

An initial focused test run exposed a fixture error: Migration 001 prevents
adding Sales items after a draft has already been marked cancelled. The fixture
was corrected to add items while active and then perform the valid cancellation
transition. The focused tests then passed.

The first build attempt exposed TypeScript narrowing errors in the new test
SQLite parameter binding. The test mocks were narrowed to the expected string
status parameter; the subsequent build and lint passed.

## Unrun checks

No full Vitest suite was run. No normal-database, migration-runtime, or Tauri IPC
operation was run as part of this stage.
