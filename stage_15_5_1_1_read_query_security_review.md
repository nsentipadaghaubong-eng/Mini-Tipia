# Stage 15.5.1.1 — Read-only Query Boundary Security Review

## Conclusion

No confirmed vulnerability was found in the reviewed read-query boundary. The query boundary is **safe enough to proceed to repository integration for code-defined SQL with bound parameters**. It should not be treated as a general-purpose endpoint for arbitrary SQL supplied by untrusted callers.

The security-review pass reported no vulnerabilities. Focused regression tests were added to exercise the requested SQLite statement forms. No production query-boundary logic, transaction logic, migration logic, capability, or UI workflow needed changing.

## Enforcement mechanism

The registered Rust command `query_sqlite_readonly` obtains the existing `sqlite:tipia.db` pool from the SQL plugin's `DbInstances`. SQL text and scalar parameters are separate; each value is bound through SQLx. The command does not create another pool. The default capability grants SQL plugin `load` and `close`, not its unrestricted `execute` or `select` operations.

The boundary uses two layers:

1. A lexical gate allows only statements whose first SQL keyword is `SELECT` or `WITH`, after whitespace and leading line/block comments. It scans SQL quote/comment forms to reject a second statement after a semicolon. Case is normalized for the keyword check. Other leading statements—including DML, DDL, PRAGMA, ATTACH, DETACH, VACUUM and transaction-control statements—are rejected before SQL execution.
2. SQLite `PRAGMA query_only = ON` is enabled on the acquired connection before describing/executing the query. SQLite enforces read-only database access, including for a write-form `WITH ... INSERT` statement that passes the leading-keyword gate. The connection is exclusively checked out from the pool for this operation, so no concurrent request can use that same connection while its mode is changed. The previous mode is restored before the checked-out connection can return to the pool. Restoration is attempted after both successful and failed query execution; if restoration fails, the connection is closed/discarded and an error is returned.

The command also verifies foreign-key enforcement on the acquired connection. SQL errors are logged internally while a generic failure is returned to the frontend.

## Attack cases exercised

Focused temporary-database Rust tests now verify:

- Bound values remain separate from SQL text; valid parameterized reads return multiple rows and expected columns, and zero-row reads retain column metadata.
- A valid mixed-case `SELECT` with leading whitespace, block comments, and line comments succeeds.
- `INSERT`, `UPDATE`, `DELETE`, `REPLACE`, `CREATE`, `ALTER`, `DROP`, `VACUUM`, `ANALYZE`, `REINDEX`, `PRAGMA query_only = OFF`, `ATTACH`, and `DETACH` are rejected.
- A SQLite write-form CTE is rejected by query-only mode and does not insert data.
- Multiple statements separated by semicolons are rejected, including when comments follow the first statement. Adjacent statement-like text separated only by whitespace or comments fails SQL parsing. Semicolons inside quoted text and a trailing comment remain accepted.
- A failed read and a successful read both leave the pool connection's query-only state restored. The existing DML transaction command remains writable afterward.

The SQLx version configured for this application is 0.8.6; these tests exercise the production SQLx/SQLite code against isolated temporary SQLite files, not mocks.

## Findings summary

| # | Severity | File | Lines | Vulnerability | Confidence |
|---|----------|------|-------|---------------|------------|
| — | — | — | — | No confirmed vulnerabilities found in the reviewed boundary. | — |

## Remaining limitations and recommendation

- The lexical scanner is not a full SQL parser. Read-only enforcement does not rely on that scanner alone: SQLite query-only mode is the database-enforced backstop for writes.
- This interface allows reads from any table available to the connected database, and it has no result-size or execution-time limit. Repository integration should use fixed, code-defined SQL and parameter binding, not forward user-supplied SQL. A generic read boundary is not a confidentiality filter.
- No real Tauri IPC test was run for this stage. Rust tests exercised the same pool-backed command implementation using temporary databases; frontend wrapper tests remain mocked.

Subject to the usage constraints above, proceed with repository integration. Keep `query_only` restoration/discard behavior intact and do not add unrestricted SQL plugin permissions.
