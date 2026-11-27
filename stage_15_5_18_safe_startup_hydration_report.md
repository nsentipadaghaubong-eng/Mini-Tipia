# Stage 15.5.18 — Safe Application Startup and Read-Only Hydration Integration

## Result

**SQLite hydration now runs during the actual application startup and is retained in React startup state.** Startup performs database initialization, the existing snapshot-backed `loadApplicationData()`, then `createApplicationStateHydration()`. The application shows no operational/demo workflows while loading or after an error. On success it shows only read-only counts from the retained hydration model.

The hydration model remains separate from `ApplicationState`; no persistence-only row is converted into an invalid domain value or dropped to populate workflow state. ApplicationState reducers, repositories, query/snapshot boundaries, migration files, and business rules were not changed by this stage.

This is not a business-workflow cutover. Product, Inventory, Sales, Receive Delivery, Activity, editing, and approval workflows remain unavailable from the application UI in this read-only stage, and none of their changes are persisted to SQLite.

## Files changed for Stage 15.5.18

- [src/App.tsx](./src/App.tsx) — the default `App` entry now gates startup and displays loading, failure/retry, and successful read-only readiness states. The previous interactive component is retained as named `WorkflowApp`; the default export used by [src/main.tsx](./src/main.tsx) does not mount it.
- [src/App.test.tsx](./src/App.test.tsx) — existing interactive workflow tests now import the preserved `WorkflowApp` component; business workflow assertions remain in place.
- [src/App.startup.test.tsx](./src/App.startup.test.tsx) — verifies the default App gate, success summary, persistence-only count, and retry behavior.
- [src/persistence/applicationStartup.ts](./src/persistence/applicationStartup.ts) — new coordinator for ordered initialization, load, hydration, contextual error propagation, in-flight deduplication, and retry after failure.
- [src/persistence/applicationStartup.test.ts](./src/persistence/applicationStartup.test.ts) — focused coordinator ordering, failure, deduplication, and retry tests.
- [stage_15_5_18_safe_startup_hydration_report.md](./stage_15_5_18_safe_startup_hydration_report.md) — this report.

The worktree already contained numerous staged/unstaged/untracked persistence, migration, business-rule, and report changes. No files outside the list above were intentionally changed for Stage 15.5.18; no prior migrations or other persistence files were edited. The existing operational App component and workflow tests remain available, but the default App entry does not mount those workflows during this read-only stage.

## Startup behavior

### Before

- `App` initialized an interactive demo-backed `ApplicationState`.
- Its effect initialized SQLite but did not call the application-data loader or hydration builder.
- Normal interactive pages remained rendered while SQLite initialized and after initialization failure. A status message warned that changes were not saved, but workflows could still run against in-memory demo state.

### After

1. `App` begins in a dedicated loading state and renders no operational page or navigation.
2. `loadApplicationStateHydration()` calls `initializeDatabase()` first.
3. Only after initialization succeeds does it call the existing `loadApplicationData()`. The loader continues to use the established single read-snapshot executor.
4. Only after all reads and loader validation succeed does it call `createApplicationStateHydration()`.
5. The complete result is retained in the default `App` as the ready startup state. It is not copied into or merged with demo-backed `ApplicationState`.
6. The success view reports the counts for all eight loader collections plus persistence-only and unresolved/invalid Inventory association counts. It exposes no workflow controls or business data details.
7. Any initialization, loader, or hydration error is surfaced with its stage and cause in the failure view. The user can retry; a failed in-flight cache is cleared so a retry starts a fresh attempt.
8. While the failure view is shown, operational workflows remain unavailable. Empty SQLite data is a successful hydration and reports zero counts.

The coordinator shares one pending promise across concurrent startup requests (including React StrictMode effect remounts), retains a successful result for the process lifetime, and clears a rejected result to allow retry. The component ignores results after unmount.

## Read-only and data-preservation boundaries

- The app invokes no `executeTransaction`, INSERT, UPDATE, DELETE, or write repository. It uses the existing database initializer and the existing read-only loader/hydrator only.
- No migration or schema file was changed. The existing database initializer may apply migrations already embedded in the application; this stage added none and did not open or migrate `sqlite:tipia.db`.
- The existing hydration model retains source DTOs and domain projection status. The app counts persistence-only records without replacing them with domain values.
- Existing legacy Delivery association states remain represented by hydration: unresolved rows stay unresolved, and rows whose current target is absent retain their recorded identifier.
- Business reducer/domain logic was not altered. Interactive application workflows are deliberately not exposed by this read-only readiness UI and must not be interpreted as SQLite-persistent.

## Validation

Commands run during this stage:

| Command | Result |
|---|---|
| `npm test -- --run src/App.test.tsx src/App.startup.test.tsx src/persistence/applicationStartup.test.ts src/persistence/applicationStateHydration.test.ts src/persistence/applicationDataLoader.test.ts src/persistence/query.test.ts` | 5 files passed and 1 file had 1 failure (42 passed, 1 failed). All new startup tests, hydration tests, loader tests, query tests, and 4 of 5 preserved App workflow tests passed. The existing App cancellation test expects deletion immediately after clicking “Delete”; the current UI asks for confirmation, so the draft remains. This unrelated workflow assertion was not changed or suppressed. |
| `npm test -- --run src/applicationState.test.ts src/deliveries/deliveryApproval.test.ts` | Passed: 2 files, 161 tests. Existing reducer and Delivery approval behavior remains passing. |
| `npm run build` | Passed against final source: TypeScript project checks and Vite production build. |
| `npx eslint src\\App.tsx src\\App.test.tsx src\\App.startup.test.tsx src\\persistence\\applicationStartup.ts src\\persistence\\applicationStartup.test.ts` | Passed against the final App/workflow test structure. |
| `git diff --check` | Passed. Git emitted line-ending notices for existing modified files. |

Loader tests use isolated/in-memory fixtures. No normal user database was opened, and no migration was run by this stage.

## Remaining limitations

- Hydrated data is retained in the running App and summarized, but the existing operational pages do not yet consume it. This is intentional: the `ApplicationState` domain model cannot retain every persistence-only record or nullable Delivery draft safely.
- The UI is read-only and currently provides only readiness counts, not a browsing experience for persisted data.
- Existing workflows remain unavailable until a separate stage defines safe domain projections, persistence-only draft visibility/locks, and page behavior.
- Workflow changes are not persisted. Product/catalogue changes, Inventory and batch adjustments, Sale draft operations and approvals, Receive Delivery draft operations and approvals, stock changes from approvals, and resulting Activity events still require separately designed write repositories and atomic workflow persistence.
- The active Sale draft loader scope remains active-only; this stage does not add terminal Sale-draft history.

## Completion

**Startup now initializes SQLite, loads the eight collections through the consistent read snapshot, creates the persistence-aware hydration model, and retains it at runtime.** No hydration/startup blocker remains for this read-only integration.

The application is **not ready for operational SQLite-backed workflows**: the ready UI intentionally exposes only summary counts, and workflow mutations are neither enabled here nor persisted. Future stages must address read-only data presentation and, separately, transactional workflow write persistence.
