# Stage 15.5.14 — Hydration Model Test Results

## Final validation

All requested focused checks passed after correcting the hydration test fixture:

| Check | Command | Result |
|---|---|---|
| Hydration, loader, adapter, and historical codec tests | `npm test -- --run src/persistence/applicationStateHydration.test.ts src/persistence/applicationDataLoader.test.ts src/persistence/domainAdapters.test.ts src/persistence/historicalSerialization.test.ts` | Passed: 4 test files, 36 tests |
| TypeScript application check and production build | `npm run build` | Passed (`tsc -b` and Vite production build). Vite emitted the existing >500 kB chunk-size advisory. |
| Focused ESLint | `npx eslint src/persistence/applicationStateHydration.ts src/persistence/applicationStateHydration.test.ts` | Passed |
| Whitespace/error check | `git diff --check` | Passed. Git printed line-ending conversion warnings for pre-existing modified `src-tauri` files; no whitespace errors. |

Focused tests cover all eight collections, source DTO retention, available projections, nullable Delivery draft headers, persistence-only/inconsistent projection behavior, unresolved received Inventory association, empty collections, IDs, ordering, snapshots, nullable fields, and separation of completed records from active drafts.

## Failed initial attempts and correction

The first focused run before the fixture correction failed: 1 test file failed and 3 passed; 5 tests failed and 31 passed. The received Delivery fixture declared a persisted `receivedBatchId` while its serialized receipt snapshot had `batch: null`. The existing loader contract correctly rejects that inconsistent duplicate data. The test fixture was corrected to contain a matching batch snapshot with the same ID; production validation was not weakened.

The first build also failed on a nullable invoice number assigned to a domain field that accepts an optional string, and the first focused ESLint run flagged an unused type import. The test now omits a NULL invoice number from the domain projection and removes the unused import. The final reruns above passed.

## Scope confirmation

Tests use isolated in-memory test fixtures and do not access the normal `sqlite:tipia.db`. The hydration model was not connected to application startup or the live UI. No schema, migration, repository query, write workflow, `ApplicationState`, or `App.tsx` changes were made as part of Stage 15.5.14. Existing unrelated worktree changes were preserved.
