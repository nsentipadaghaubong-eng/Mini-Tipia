use futures_util::future::BoxFuture;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::sqlite::SqliteRow;
use sqlx::{Column, Connection, Executor, Row, Sqlite, SqlitePool, TypeInfo, ValueRef};
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

const DATABASE_KEY: &str = "sqlite:tipia.db";
const MAX_READ_SNAPSHOT_QUERIES: usize = 16;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SqliteStatement {
    query: String,
    parameters: Vec<Value>,
}

#[derive(Debug)]
enum SqliteParameter {
    Null,
    Boolean(bool),
    Integer(i64),
    Real(f64),
    Text(String),
}

struct ValidatedStatement {
    query: String,
    parameters: Vec<SqliteParameter>,
}

struct ValidatedReadQuery {
    query: String,
    parameters: Vec<SqliteParameter>,
}

#[derive(Debug, Serialize)]
pub(crate) struct SqliteQueryResult {
    columns: Vec<String>,
    rows: Vec<Vec<Value>>,
}

#[tauri::command]
pub(crate) async fn verify_sqlite_connection(
    db_instances: State<'_, DbInstances>,
) -> Result<(), String> {
    let pool = get_database_pool(&db_instances).await?;
    let mut connection = pool
        .acquire()
        .await
        .map_err(|error| connection_error("acquire", &error))?;
    set_and_verify_foreign_keys(&mut connection).await
}

#[tauri::command]
pub(crate) async fn initialize_sqlite_schema(
    db_instances: State<'_, DbInstances>,
) -> Result<String, String> {
    let pool = get_database_pool(&db_instances).await?;
    crate::migrations::initialize_sqlite_schema_for_pool(pool).await
}

#[tauri::command]
pub(crate) async fn execute_sqlite_transaction(
    db_instances: State<'_, DbInstances>,
    statements: Vec<SqliteStatement>,
    expected_rows_affected: Option<Vec<u64>>,
) -> Result<Vec<u64>, String> {
    execute_transaction_for_instances_with_expectations(
        &db_instances,
        statements,
        expected_rows_affected,
    )
    .await
}

#[tauri::command]
pub(crate) async fn query_sqlite_readonly(
    db_instances: State<'_, DbInstances>,
    query: String,
    parameters: Vec<Value>,
) -> Result<SqliteQueryResult, String> {
    query_sqlite_for_instances(&db_instances, query, parameters).await
}

#[tauri::command]
pub(crate) async fn query_sqlite_readonly_snapshot(
    db_instances: State<'_, DbInstances>,
    queries: Vec<SqliteStatement>,
) -> Result<Vec<SqliteQueryResult>, String> {
    query_sqlite_snapshot_for_instances(&db_instances, queries).await
}

async fn get_database_pool(instances: &DbInstances) -> Result<SqlitePool, String> {
    let pools = instances.0.read().await;
    match pools.get(DATABASE_KEY) {
        Some(DbPool::Sqlite(pool)) => Ok(pool.clone()),
        None => Err(
            "SQLite is not initialized. Initialize sqlite:tipia.db before using persistence."
                .to_owned(),
        ),
    }
}

async fn execute_transaction_for_instances(
    instances: &DbInstances,
    statements: Vec<SqliteStatement>,
) -> Result<Vec<u64>, String> {
    execute_transaction_for_instances_with_expectations(instances, statements, None).await
}

async fn execute_transaction_for_instances_with_expectations(
    instances: &DbInstances,
    statements: Vec<SqliteStatement>,
    expected_rows_affected: Option<Vec<u64>>,
) -> Result<Vec<u64>, String> {
    let statements = validate_statements(statements)?;
    if let Some(expected) = &expected_rows_affected {
        if expected.len() != statements.len() {
            return Err(
                "SQLite transaction expected row counts must match the statement count.".to_owned(),
            );
        }
    }
    let pool = get_database_pool(instances).await?;
    execute_batch(&pool, &statements, expected_rows_affected.as_deref()).await
}

async fn query_sqlite_for_instances(
    instances: &DbInstances,
    query: String,
    parameters: Vec<Value>,
) -> Result<SqliteQueryResult, String> {
    let query = validate_read_query(query, parameters)?;
    let pool = get_database_pool(instances).await?;
    execute_read_query(&pool, &query).await
}

async fn query_sqlite_snapshot_for_instances(
    instances: &DbInstances,
    queries: Vec<SqliteStatement>,
) -> Result<Vec<SqliteQueryResult>, String> {
    let queries = validate_read_snapshot_queries(queries)?;
    let pool = get_database_pool(instances).await?;
    execute_read_query_snapshot(&pool, &queries).await
}

fn validate_read_snapshot_queries(
    queries: Vec<SqliteStatement>,
) -> Result<Vec<ValidatedReadQuery>, String> {
    if queries.is_empty() {
        return Err("A SQLite read snapshot must contain at least one query.".to_owned());
    }
    if queries.len() > MAX_READ_SNAPSHOT_QUERIES {
        return Err(format!(
            "A SQLite read snapshot cannot contain more than {MAX_READ_SNAPSHOT_QUERIES} queries."
        ));
    }

    queries
        .into_iter()
        .enumerate()
        .map(|(index, statement)| {
            validate_read_query(statement.query, statement.parameters)
                .map_err(|error| format!("SQLite read snapshot query {}: {error}", index + 1))
        })
        .collect()
}

async fn set_and_verify_foreign_keys(
    connection: &mut sqlx::pool::PoolConnection<Sqlite>,
) -> Result<(), String> {
    sqlx::query("PRAGMA foreign_keys = ON")
        .execute(&mut **connection)
        .await
        .map_err(|error| connection_error("enable foreign keys", &error))?;

    let enabled: i64 = sqlx::query("PRAGMA foreign_keys")
        .fetch_one(&mut **connection)
        .await
        .map_err(|error| connection_error("verify foreign keys", &error))?
        .try_get(0)
        .map_err(|error| connection_error("read foreign-key status", &error))?;

    if enabled != 1 {
        return Err("SQLite foreign-key enforcement is not enabled.".to_owned());
    }

    Ok(())
}

fn validate_statements(
    statements: Vec<SqliteStatement>,
) -> Result<Vec<ValidatedStatement>, String> {
    if statements.is_empty() {
        return Err("A SQLite transaction must contain at least one statement.".to_owned());
    }

    statements
        .into_iter()
        .enumerate()
        .map(|(index, statement)| validate_statement(index + 1, statement))
        .collect()
}

fn validate_statement(
    index: usize,
    statement: SqliteStatement,
) -> Result<ValidatedStatement, String> {
    let query = statement.query.trim();
    let query = query.strip_suffix(';').unwrap_or(query);

    if query.is_empty()
        || query.contains(';')
        || query.contains("--")
        || query.contains("/*")
        || query.contains("*/")
    {
        return Err(format!(
            "SQLite transaction statement {index} must be a single uncommented DML statement."
        ));
    }

    let keyword = query
        .split_ascii_whitespace()
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    if !matches!(keyword.as_str(), "INSERT" | "UPDATE" | "DELETE") {
        return Err(format!(
            "SQLite transaction statement {index} must be INSERT, UPDATE, or DELETE."
        ));
    }

    let parameters = statement
        .parameters
        .into_iter()
        .enumerate()
        .map(|(parameter_index, value)| validate_parameter(index, parameter_index + 1, value))
        .collect::<Result<Vec<_>, _>>()?;

    Ok(ValidatedStatement {
        query: query.to_owned(),
        parameters,
    })
}

fn validate_parameter(
    statement_index: usize,
    parameter_index: usize,
    value: Value,
) -> Result<SqliteParameter, String> {
    match value {
        Value::Null => Ok(SqliteParameter::Null),
        Value::Bool(value) => Ok(SqliteParameter::Boolean(value)),
        Value::String(value) => Ok(SqliteParameter::Text(value)),
        Value::Number(value) => {
            if let Some(value) = value.as_i64() {
                return Ok(SqliteParameter::Integer(value));
            }
            if let Some(value) = value.as_u64() {
                return i64::try_from(value)
                    .map(SqliteParameter::Integer)
                    .map_err(|_| {
                        format!(
                            "SQLite transaction statement {statement_index} parameter {parameter_index} exceeds SQLite's integer range."
                        )
                    });
            }
            value.as_f64()
                .filter(|value| value.is_finite())
                .map(SqliteParameter::Real)
                .ok_or_else(|| {
                    format!(
                        "SQLite transaction statement {statement_index} parameter {parameter_index} is not a finite number."
                    )
                })
        }
        Value::Array(_) | Value::Object(_) => Err(format!(
            "SQLite transaction statement {statement_index} parameter {parameter_index} must be a scalar value."
        )),
    }
}

fn validate_read_query(
    query: String,
    parameters: Vec<Value>,
) -> Result<ValidatedReadQuery, String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("A SQLite read query must not be empty.".to_owned());
    }
    if contains_multiple_statements(query) {
        return Err("A SQLite read query must contain exactly one statement.".to_owned());
    }

    let keyword = first_sql_keyword(query).unwrap_or_default();
    if !matches!(keyword.as_str(), "SELECT" | "WITH") {
        return Err("A SQLite read query must be a SELECT or WITH query.".to_owned());
    }

    let parameters = parameters
        .into_iter()
        .enumerate()
        .map(|(index, value)| validate_read_parameter(index + 1, value))
        .collect::<Result<Vec<_>, _>>()?;

    Ok(ValidatedReadQuery {
        query: query.to_owned(),
        parameters,
    })
}

fn contains_multiple_statements(query: &str) -> bool {
    #[derive(Clone, Copy)]
    enum State {
        Normal,
        SingleQuoted,
        DoubleQuoted,
        BacktickQuoted,
        BracketQuoted,
        LineComment,
        BlockComment,
    }

    let characters: Vec<char> = query.chars().collect();
    let mut state = State::Normal;
    let mut statement_terminated = false;
    let mut index = 0;

    while index < characters.len() {
        let character = characters[index];
        let next = characters.get(index + 1).copied();

        match state {
            State::Normal => {
                if character == '-' && next == Some('-') {
                    state = State::LineComment;
                    index += 2;
                    continue;
                }
                if character == '/' && next == Some('*') {
                    state = State::BlockComment;
                    index += 2;
                    continue;
                }
                if statement_terminated && !character.is_whitespace() {
                    return true;
                }

                match character {
                    '\'' => state = State::SingleQuoted,
                    '"' => state = State::DoubleQuoted,
                    '`' => state = State::BacktickQuoted,
                    '[' => state = State::BracketQuoted,
                    ';' => statement_terminated = true,
                    _ => {}
                }
            }
            State::SingleQuoted if character == '\'' => {
                if next == Some('\'') {
                    index += 2;
                    continue;
                }
                state = State::Normal;
            }
            State::DoubleQuoted if character == '"' => {
                if next == Some('"') {
                    index += 2;
                    continue;
                }
                state = State::Normal;
            }
            State::BacktickQuoted if character == '`' => {
                if next == Some('`') {
                    index += 2;
                    continue;
                }
                state = State::Normal;
            }
            State::BracketQuoted if character == ']' => state = State::Normal,
            State::LineComment if character == '\n' || character == '\r' => state = State::Normal,
            State::BlockComment if character == '*' && next == Some('/') => {
                state = State::Normal;
                index += 2;
                continue;
            }
            _ => {}
        }

        index += 1;
    }

    false
}

fn first_sql_keyword(query: &str) -> Option<String> {
    let bytes = query.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index].is_ascii_whitespace() {
            index += 1;
        } else if bytes[index] == b'-' && bytes.get(index + 1) == Some(&b'-') {
            index += 2;
            while index < bytes.len() && bytes[index] != b'\n' && bytes[index] != b'\r' {
                index += 1;
            }
        } else if bytes[index] == b'/' && bytes.get(index + 1) == Some(&b'*') {
            index += 2;
            while index + 1 < bytes.len() && !(bytes[index] == b'*' && bytes[index + 1] == b'/') {
                index += 1;
            }
            if index + 1 >= bytes.len() {
                return None;
            }
            index += 2;
        } else {
            break;
        }
    }

    let start = index;
    while index < bytes.len() && (bytes[index].is_ascii_alphanumeric() || bytes[index] == b'_') {
        index += 1;
    }
    if start == index {
        return None;
    }

    Some(query[start..index].to_ascii_uppercase())
}

fn validate_read_parameter(
    parameter_index: usize,
    value: Value,
) -> Result<SqliteParameter, String> {
    match value {
        Value::Null => Ok(SqliteParameter::Null),
        Value::Bool(value) => Ok(SqliteParameter::Boolean(value)),
        Value::String(value) => Ok(SqliteParameter::Text(value)),
        Value::Number(value) => {
            if let Some(value) = value.as_i64() {
                return Ok(SqliteParameter::Integer(value));
            }
            if let Some(value) = value.as_u64() {
                return i64::try_from(value)
                    .map(SqliteParameter::Integer)
                    .map_err(|_| {
                        format!(
                            "SQLite read query parameter {parameter_index} exceeds SQLite's integer range."
                        )
                    });
            }
            value
                .as_f64()
                .filter(|value| value.is_finite())
                .map(SqliteParameter::Real)
                .ok_or_else(|| {
                    format!("SQLite read query parameter {parameter_index} is not a finite number.")
                })
        }
        Value::Array(_) | Value::Object(_) => Err(format!(
            "SQLite read query parameter {parameter_index} must be a scalar value."
        )),
    }
}

fn connection_error(action: &str, error: &sqlx::Error) -> String {
    log::error!(
        "SQLite connection could not {action}: {}",
        safe_error(error)
    );
    format!("SQLite connection could not {action}.")
}

fn safe_error(error: &sqlx::Error) -> String {
    error
        .as_database_error()
        .map(|database_error| database_error.message().to_owned())
        .unwrap_or_else(|| "database operation failed".to_owned())
}

fn read_query_error(action: &str, error: &sqlx::Error) -> String {
    log::error!(
        "SQLite read query could not {action}: {}",
        safe_error(error)
    );
    "SQLite read query failed.".to_owned()
}

async fn execute_read_query(
    pool: &SqlitePool,
    query: &ValidatedReadQuery,
) -> Result<SqliteQueryResult, String> {
    let mut connection = pool
        .acquire()
        .await
        .map_err(|error| connection_error("acquire", &error))?;
    set_and_verify_foreign_keys(&mut connection).await?;

    let previous_query_only: i64 = sqlx::query_scalar("PRAGMA query_only")
        .fetch_one(&mut *connection)
        .await
        .map_err(|error| read_query_error("inspect connection mode", &error))?;

    let result = async {
        sqlx::query("PRAGMA query_only = ON")
            .execute(&mut *connection)
            .await
            .map_err(|error| read_query_error("enable read-only mode", &error))?;

        run_read_query(&mut *connection, query).await
    }
    .await;

    let restore_query = if previous_query_only == 0 {
        "PRAGMA query_only = OFF"
    } else {
        "PRAGMA query_only = ON"
    };
    if let Err(error) = sqlx::query(restore_query).execute(&mut *connection).await {
        log::error!(
            "SQLite read query could not restore connection mode: {}",
            safe_error(&error)
        );
        if let Err(close_error) = connection.close().await {
            log::error!(
                "SQLite read query could not discard the affected connection: {}",
                safe_error(&close_error)
            );
        }
        return Err(
            "SQLite read query could not restore connection state; the connection was discarded."
                .to_owned(),
        );
    }

    result
}

async fn execute_read_query_snapshot(
    pool: &SqlitePool,
    queries: &[ValidatedReadQuery],
) -> Result<Vec<SqliteQueryResult>, String> {
    execute_read_query_snapshot_with_hook(pool, queries, |_| -> BoxFuture<'static, ()> {
        Box::pin(async {})
    })
    .await
}

async fn execute_read_query_snapshot_with_hook<F>(
    pool: &SqlitePool,
    queries: &[ValidatedReadQuery],
    mut after_query: F,
) -> Result<Vec<SqliteQueryResult>, String>
where
    F: FnMut(usize) -> BoxFuture<'static, ()> + Send,
{
    let mut connection = pool
        .acquire()
        .await
        .map_err(|error| connection_error("acquire", &error))?;
    set_and_verify_foreign_keys(&mut connection).await?;

    let previous_query_only: i64 = sqlx::query_scalar("PRAGMA query_only")
        .fetch_one(&mut *connection)
        .await
        .map_err(|error| read_query_error("inspect connection mode", &error))?;
    let result = sqlx::query("PRAGMA query_only = ON")
        .execute(&mut *connection)
        .await
        .map_err(|error| read_query_error("enable read-only mode", &error));
    let result = match result {
        Ok(_) => {
            execute_read_snapshot_transaction(&mut connection, queries, &mut after_query).await
        }
        Err(error) => Err(error),
    };

    let restore_query = if previous_query_only == 0 {
        "PRAGMA query_only = OFF"
    } else {
        "PRAGMA query_only = ON"
    };
    if let Err(error) = sqlx::query(restore_query).execute(&mut *connection).await {
        log::error!(
            "SQLite read snapshot could not restore connection mode: {}",
            safe_error(&error)
        );
        if let Err(close_error) = connection.close().await {
            log::error!(
                "SQLite read snapshot could not discard the affected connection: {}",
                safe_error(&close_error)
            );
        }
        return Err(
            "SQLite read snapshot could not restore connection state; the connection was discarded."
                .to_owned(),
        );
    }

    result
}

async fn execute_read_snapshot_transaction<F>(
    connection: &mut sqlx::pool::PoolConnection<Sqlite>,
    queries: &[ValidatedReadQuery],
    after_query: &mut F,
) -> Result<Vec<SqliteQueryResult>, String>
where
    F: FnMut(usize) -> BoxFuture<'static, ()> + Send,
{
    let mut transaction = (&mut **connection)
        .begin()
        .await
        .map_err(|error| connection_error("begin a read snapshot", &error))?;
    let mut results = Vec::with_capacity(queries.len());

    for (index, query) in queries.iter().enumerate() {
        match run_read_query(&mut transaction, query).await {
            Ok(result) => {
                results.push(result);
                after_query(index + 1).await;
            }
            Err(error) => {
                return match transaction.rollback().await {
                    Ok(()) => Err(error),
                    Err(rollback_error) => {
                        log::error!(
                            "SQLite read snapshot rollback failed: {}",
                            safe_error(&rollback_error)
                        );
                        Err(
                            "SQLite read snapshot failed and rollback could not be confirmed."
                                .to_owned(),
                        )
                    }
                };
            }
        }
    }

    transaction.commit().await.map_err(|error| {
        log::error!("SQLite read snapshot commit failed: {}", safe_error(&error));
        "SQLite read snapshot commit failed.".to_owned()
    })?;
    Ok(results)
}

async fn run_read_query(
    connection: &mut sqlx::SqliteConnection,
    query: &ValidatedReadQuery,
) -> Result<SqliteQueryResult, String> {
    let description = (&mut *connection)
        .describe(&query.query)
        .await
        .map_err(|error| read_query_error("inspect its result columns", &error))?;
    let columns = description
        .columns()
        .iter()
        .map(|column| column.name().to_owned())
        .collect();

    let mut statement = sqlx::query(&query.query);
    for parameter in &query.parameters {
        statement = match parameter {
            SqliteParameter::Null => statement.bind(Option::<String>::None),
            SqliteParameter::Boolean(value) => statement.bind(i64::from(*value)),
            SqliteParameter::Integer(value) => statement.bind(*value),
            SqliteParameter::Real(value) => statement.bind(*value),
            SqliteParameter::Text(value) => statement.bind(value.clone()),
        };
    }
    let rows = statement
        .fetch_all(&mut *connection)
        .await
        .map_err(|error| read_query_error("execute the statement", &error))?;
    let rows = rows
        .iter()
        .map(sqlite_row_to_json)
        .collect::<Result<Vec<_>, _>>()?;

    Ok(SqliteQueryResult { columns, rows })
}

fn sqlite_row_to_json(row: &SqliteRow) -> Result<Vec<Value>, String> {
    row.columns()
        .iter()
        .enumerate()
        .map(|(index, _)| {
            let raw = row
                .try_get_raw(index)
                .map_err(|error| read_query_error("read a result value", &error))?;
            if raw.is_null() {
                return Ok(Value::Null);
            }

            match raw.type_info().name() {
                "INTEGER" => {
                    let value: i64 = row
                        .try_get(index)
                        .map_err(|error| read_query_error("decode an integer result", &error))?;
                    const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
                    if value.unsigned_abs() > MAX_SAFE_INTEGER {
                        Ok(Value::String(value.to_string()))
                    } else {
                        Ok(Value::from(value))
                    }
                }
                "REAL" => {
                    let value: f64 = row
                        .try_get(index)
                        .map_err(|error| read_query_error("decode a real result", &error))?;
                    serde_json::Number::from_f64(value)
                        .map(Value::Number)
                        .ok_or_else(|| {
                            "SQLite read query returned a non-finite real value.".to_owned()
                        })
                }
                "TEXT" => row
                    .try_get::<String, _>(index)
                    .map(Value::String)
                    .map_err(|error| read_query_error("decode a text result", &error)),
                "BLOB" => row
                    .try_get::<Vec<u8>, _>(index)
                    .map(|bytes| Value::Array(bytes.into_iter().map(Value::from).collect()))
                    .map_err(|error| read_query_error("decode a blob result", &error)),
                _ => Err("SQLite read query returned an unsupported value type.".to_owned()),
            }
        })
        .collect()
}

async fn execute_batch(
    pool: &SqlitePool,
    statements: &[ValidatedStatement],
    expected_rows_affected: Option<&[u64]>,
) -> Result<Vec<u64>, String> {
    let mut connection = pool
        .acquire()
        .await
        .map_err(|error| connection_error("acquire", &error))?;
    set_and_verify_foreign_keys(&mut connection).await?;

    let mut transaction = (&mut *connection)
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(|error| connection_error("begin a transaction", &error))?;

    let mut rows_affected = Vec::with_capacity(statements.len());
    for (index, statement) in statements.iter().enumerate() {
        let mut query = sqlx::query(&statement.query);
        for parameter in &statement.parameters {
            query = match parameter {
                SqliteParameter::Null => query.bind(Option::<String>::None),
                SqliteParameter::Boolean(value) => query.bind(i64::from(*value)),
                SqliteParameter::Integer(value) => query.bind(*value),
                SqliteParameter::Real(value) => query.bind(*value),
                SqliteParameter::Text(value) => query.bind(value.clone()),
            };
        }

        match query.execute(&mut *transaction).await {
            Ok(result) => {
                let actual = result.rows_affected();
                if let Some(expected) = expected_rows_affected.and_then(|counts| counts.get(index))
                {
                    if actual != *expected {
                        let message = format!(
                            "SQLite transaction statement {} expected {expected} affected row(s), received {actual}.",
                            index + 1
                        );
                        log::error!("{message}");
                        return match transaction.rollback().await {
                            Ok(()) => Err(message),
                            Err(rollback_error) => {
                                log::error!(
                                    "SQLite transaction rollback failed: {}",
                                    safe_error(&rollback_error)
                                );
                                Err(format!("{message} Rollback could not be confirmed."))
                            }
                        };
                    }
                }
                rows_affected.push(actual);
            }
            Err(error) => {
                let message = safe_error(&error);
                log::error!(
                    "SQLite transaction failed at statement {}: {message}",
                    index + 1
                );
                return match transaction.rollback().await {
                    Ok(()) => Err(format!(
                        "SQLite transaction failed at statement {}: {message}",
                        index + 1
                    )),
                    Err(rollback_error) => {
                        log::error!(
                            "SQLite transaction rollback failed: {}",
                            safe_error(&rollback_error)
                        );
                        Err(format!(
                            "SQLite transaction failed at statement {} and rollback could not be confirmed.",
                            index + 1
                        ))
                    }
                };
            }
        }
    }

    transaction.commit().await.map_err(|error| {
        log::error!("SQLite transaction commit failed: {}", safe_error(&error));
        format!("SQLite transaction commit failed: {}", safe_error(&error))
    })?;

    Ok(rows_affected)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use std::{
        fs,
        path::{Path, PathBuf},
        sync::{
            Arc,
            atomic::{AtomicU64, Ordering},
        },
    };
    use tauri_plugin_sql::DbInstances;

    static NEXT_TEST_DATABASE: AtomicU64 = AtomicU64::new(0);

    async fn create_test_database() -> (PathBuf, SqlitePool, DbInstances) {
        create_test_database_with_max_connections(4).await
    }

    async fn create_test_database_with_max_connections(
        max_connections: u32,
    ) -> (PathBuf, SqlitePool, DbInstances) {
        let path = std::env::temp_dir().join(format!(
            "mini-tipia-transaction-{}-{}.sqlite",
            std::process::id(),
            NEXT_TEST_DATABASE.fetch_add(1, Ordering::Relaxed)
        ));
        let options = SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true)
            .foreign_keys(false);
        let pool = SqlitePoolOptions::new()
            .max_connections(max_connections)
            .connect_with(options)
            .await
            .expect("test database pool should open");
        sqlx::query("CREATE TABLE parents (id INTEGER PRIMARY KEY, label TEXT NOT NULL)")
            .execute(&pool)
            .await
            .expect("test parent table should be created");
        sqlx::query(
            "CREATE TABLE children (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parents(id))",
        )
        .execute(&pool)
        .await
        .expect("test child table should be created");

        let instances = DbInstances::default();
        instances
            .0
            .write()
            .await
            .insert(DATABASE_KEY.to_owned(), DbPool::Sqlite(pool.clone()));
        (path, pool, instances)
    }

    fn statement(query: &str, parameters: Vec<Value>) -> SqliteStatement {
        SqliteStatement {
            query: query.to_owned(),
            parameters,
        }
    }

    fn run<F: std::future::Future>(future: F) -> F::Output {
        tauri::async_runtime::block_on(future)
    }

    fn remove_test_database(path: &Path) -> std::io::Result<()> {
        for attempt in 0..20 {
            match fs::remove_file(path) {
                Ok(()) => return Ok(()),
                Err(error) if error.raw_os_error() == Some(32) && attempt < 19 => {
                    std::thread::sleep(std::time::Duration::from_millis(25));
                }
                Err(error) => return Err(error),
            }
        }
        unreachable!()
    }

    #[test]
    fn read_query_binds_parameters_and_returns_columns_and_multiple_rows() {
        run(async {
            let (path, pool, instances) = create_test_database().await;
            for (id, label) in [(1, "first"), (2, "second"), (3, "third")] {
                sqlx::query("INSERT INTO parents(id, label) VALUES ($1, $2)")
                    .bind(id)
                    .bind(label)
                    .execute(&pool)
                    .await
                    .expect("test row should be inserted");
            }

            let bound_text = "x; DELETE FROM parents; --";
            let result = query_sqlite_for_instances(
                &instances,
                "SELECT $1 AS marker, id, label FROM parents WHERE id >= $2 ORDER BY id".to_owned(),
                vec![Value::from(bound_text), Value::from(2)],
            )
            .await
            .expect("parameterized SELECT should succeed");

            assert_eq!(result.columns, vec!["marker", "id", "label"]);
            assert_eq!(
                result.rows,
                vec![
                    vec![
                        Value::from(bound_text),
                        Value::from(2),
                        Value::from("second")
                    ],
                    vec![
                        Value::from(bound_text),
                        Value::from(3),
                        Value::from("third")
                    ],
                ]
            );

            let parent_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM parents")
                .fetch_one(&pool)
                .await
                .expect("parent count should query");
            assert_eq!(parent_count, 3);

            drop(instances);
            pool.close().await;
            remove_test_database(&path).expect("test database should be removed");
        });
    }

    #[test]
    fn read_query_returns_column_names_when_there_are_no_rows() {
        run(async {
            let (path, pool, instances) = create_test_database().await;
            let result = query_sqlite_for_instances(
                &instances,
                "SELECT id, label FROM parents WHERE id = $1".to_owned(),
                vec![Value::from(404)],
            )
            .await
            .expect("empty SELECT should succeed");

            assert_eq!(result.columns, vec!["id", "label"]);
            assert!(result.rows.is_empty());

            drop(instances);
            pool.close().await;
            remove_test_database(&path).expect("test database should be removed");
        });
    }

    #[test]
    fn read_query_allows_leading_whitespace_and_comments() {
        run(async {
            let (path, pool, instances) = create_test_database().await;
            let result = query_sqlite_for_instances(
                &instances,
                " \n /* leading block comment */ -- leading line comment\n sElEcT $1 AS value"
                    .to_owned(),
                vec![Value::from("readable")],
            )
            .await
            .expect("a SELECT with leading comments should succeed");

            assert_eq!(result.columns, vec!["value"]);
            assert_eq!(result.rows, vec![vec![Value::from("readable")]]);

            drop(instances);
            pool.close().await;
            remove_test_database(&path).expect("test database should be removed");
        });
    }

    #[test]
    fn read_query_rejects_mutation_statements_and_blocks_writes_in_ctes() {
        run(async {
            let (path, pool, instances) = create_test_database().await;
            for query in [
                "INSERT INTO parents(id, label) VALUES (1, 'inserted')",
                "UPDATE parents SET label = 'updated' WHERE id = 1",
                "DELETE FROM parents WHERE id = 1",
                "REPLACE INTO parents(id, label) VALUES (1, 'replaced')",
                "CREATE TABLE injected (id INTEGER)",
                "ALTER TABLE parents ADD COLUMN extra TEXT",
                "DROP TABLE parents",
                "VACUUM",
                "PRAGMA query_only = OFF",
                "ATTACH DATABASE ':memory:' AS injected",
                "DETACH DATABASE injected",
                "ANALYZE",
                "REINDEX",
            ] {
                let error = query_sqlite_for_instances(&instances, query.to_owned(), vec![])
                    .await
                    .expect_err("mutation statements must be rejected by the read boundary");
                assert!(error.contains("must be a SELECT or WITH query"));
            }

            let query_only: i64 = sqlx::query_scalar("PRAGMA query_only")
                .fetch_one(&pool)
                .await
                .expect("query-only status should query");
            assert_eq!(query_only, 0);

            let cte_error = query_sqlite_for_instances(
                &instances,
                "WITH candidate(id, label) AS (SELECT $1, $2) \
                 INSERT INTO parents(id, label) SELECT id, label FROM candidate"
                    .to_owned(),
                vec![Value::from(1), Value::from("inserted")],
            )
            .await
            .expect_err("query-only mode must block writes hidden in a CTE");
            assert_eq!(cte_error, "SQLite read query failed.");

            let parent_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM parents")
                .fetch_one(&pool)
                .await
                .expect("parent count should query");
            assert_eq!(parent_count, 0);

            drop(instances);
            pool.close().await;
            remove_test_database(&path).expect("test database should be removed");
        });
    }

    #[test]
    fn read_query_rejects_multiple_statements_but_allows_quoted_semicolons() {
        run(async {
            let (path, pool, instances) = create_test_database().await;
            for (query, rejected_by_statement_scanner) in [
                ("SELECT 1; SELECT 2", true),
                ("SELECT 1; /* separator comment */ SELECT 2", true),
                ("SELECT 1; -- separator comment\n SELECT 2", true),
                ("SELECT 1 SELECT 2", false),
                ("SELECT 1 /* separator comment */ SELECT 2", false),
            ] {
                let error = query_sqlite_for_instances(&instances, query.to_owned(), vec![])
                    .await
                    .expect_err("multiple statements or invalid concatenation must fail");
                if rejected_by_statement_scanner {
                    assert!(error.contains("exactly one statement"));
                } else {
                    assert_eq!(error, "SQLite read query failed.");
                }
            }

            let result = query_sqlite_for_instances(
                &instances,
                "SELECT 'left;right' AS value; -- trailing comment".to_owned(),
                vec![],
            )
            .await
            .expect("semicolon inside a string must not split a statement");
            assert_eq!(result.columns, vec!["value"]);
            assert_eq!(result.rows, vec![vec![Value::from("left;right")]]);

            drop(instances);
            pool.close().await;
            remove_test_database(&path).expect("test database should be removed");
        });
    }

    #[test]
    fn read_query_returns_safe_errors_and_preserves_connection_mode() {
        run(async {
            let (path, pool, instances) = create_test_database_with_max_connections(1).await;
            let error = query_sqlite_for_instances(
                &instances,
                "SELECT * FROM private_missing_table".to_owned(),
                vec![],
            )
            .await
            .expect_err("unknown table should fail");
            assert_eq!(error, "SQLite read query failed.");
            assert!(!error.contains("private_missing_table"));

            let query_only: i64 = sqlx::query_scalar("PRAGMA query_only")
                .fetch_one(&pool)
                .await
                .expect("query-only state should query");
            assert_eq!(query_only, 0);

            let writes = execute_transaction_for_instances(
                &instances,
                vec![statement(
                    "INSERT INTO parents(id, label) VALUES ($1, $2)",
                    vec![Value::from(1), Value::from("writable")],
                )],
            )
            .await
            .expect("the existing write boundary should remain writable");
            assert_eq!(writes, vec![1]);

            let result = query_sqlite_for_instances(
                &instances,
                "SELECT NULL AS empty_value, X'0102' AS bytes, \
                 9007199254740992 AS large_integer"
                    .to_owned(),
                vec![],
            )
            .await
            .expect("SQLite scalar values should serialize");
            assert_eq!(
                result.rows,
                vec![vec![
                    Value::Null,
                    Value::Array(vec![Value::from(1), Value::from(2)]),
                    Value::from("9007199254740992")
                ]]
            );
            let query_only: i64 = sqlx::query_scalar("PRAGMA query_only")
                .fetch_one(&pool)
                .await
                .expect("query-only status should query after a successful read");
            assert_eq!(query_only, 0);

            drop(instances);
            pool.close().await;
            remove_test_database(&path).expect("test database should be removed");
        });
    }

    #[test]
    fn snapshot_queries_use_one_read_transaction_and_preserve_parameter_order() {
        run(async {
            let (path, pool, instances) = create_test_database().await;
            for (id, label) in [(1, "first"), (2, "second")] {
                sqlx::query("INSERT INTO parents(id, label) VALUES ($1, $2)")
                    .bind(id)
                    .bind(label)
                    .execute(&pool)
                    .await
                    .expect("snapshot fixture should be inserted");
            }
            let queries = vec![
                statement(
                    "SELECT id, label FROM parents WHERE id >= $1 ORDER BY id",
                    vec![Value::from(1)],
                ),
                statement(
                    "SELECT label FROM parents WHERE id = $1",
                    vec![Value::from(2)],
                ),
            ];
            let results = query_sqlite_snapshot_for_instances(&instances, queries)
                .await
                .expect("read snapshot should succeed");

            assert_eq!(results.len(), 2);
            assert_eq!(results[0].columns, vec!["id", "label"]);
            assert_eq!(
                results[0].rows,
                vec![
                    vec![Value::from(1), Value::from("first")],
                    vec![Value::from(2), Value::from("second")]
                ]
            );
            assert_eq!(results[1].columns, vec!["label"]);
            assert_eq!(results[1].rows, vec![vec![Value::from("second")]]);

            drop(instances);
            pool.close().await;
            drop(pool);
            remove_test_database(&path).expect("snapshot fixture should be removed");
        });
    }

    #[test]
    fn snapshot_keeps_a_consistent_view_during_a_concurrent_committed_write() {
        run(async {
            let (path, pool, instances) = create_test_database().await;
            sqlx::query("PRAGMA journal_mode = WAL")
                .fetch_one(&pool)
                .await
                .expect("WAL mode should enable concurrent writer commits");
            sqlx::query("INSERT INTO parents(id, label) VALUES (1, 'before')")
                .execute(&pool)
                .await
                .expect("initial row should be inserted");

            let queries = validate_read_snapshot_queries(vec![
                statement("SELECT COUNT(*) AS row_count FROM parents", vec![]),
                statement("SELECT COUNT(*) AS row_count FROM parents", vec![]),
            ])
            .expect("snapshot queries should validate");
            let snapshot_pool = pool.clone();
            let (first_read_tx, first_read_rx) = tokio::sync::oneshot::channel();
            let (continue_tx, continue_rx) = tokio::sync::oneshot::channel();
            let task = tauri::async_runtime::spawn(async move {
                let mut first_read_tx = Some(first_read_tx);
                let mut continue_rx = Some(continue_rx);
                execute_read_query_snapshot_with_hook(
                    &snapshot_pool,
                    &queries,
                    move |completed_queries| {
                        if completed_queries == 1 {
                            let first_read_tx = first_read_tx.take().unwrap();
                            let continue_rx = continue_rx.take().unwrap();
                            Box::pin(async move {
                                let _ = first_read_tx.send(());
                                let _ = continue_rx.await;
                            })
                        } else {
                            Box::pin(async {})
                        }
                    },
                )
                .await
            });

            first_read_rx
                .await
                .expect("snapshot should pause after its first read");
            sqlx::query("INSERT INTO parents(id, label) VALUES (2, 'after')")
                .execute(&pool)
                .await
                .expect("concurrent writer should commit during the read snapshot");
            continue_tx
                .send(())
                .expect("snapshot should resume after the writer commits");

            let results = task
                .await
                .expect("snapshot task should finish")
                .expect("snapshot should complete successfully");
            assert_eq!(
                results
                    .iter()
                    .map(|result| result.rows[0][0].clone())
                    .collect::<Vec<_>>(),
                vec![Value::from(1), Value::from(1)]
            );
            let current_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM parents")
                .fetch_one(&pool)
                .await
                .expect("latest database view should query");
            assert_eq!(current_count, 2);

            drop(instances);
            pool.close().await;
            remove_test_database(&path).expect("snapshot fixture should be removed");
        });
    }

    #[test]
    fn failed_snapshot_rolls_back_and_restores_the_pooled_connection() {
        run(async {
            let (path, pool, instances) = create_test_database_with_max_connections(1).await;
            let error = query_sqlite_snapshot_for_instances(
                &instances,
                vec![
                    statement("SELECT 1", vec![]),
                    statement("SELECT * FROM missing_snapshot_table", vec![]),
                ],
            )
            .await
            .expect_err("missing table should fail the whole snapshot");
            assert_eq!(error, "SQLite read query failed.");

            let query_only: i64 = sqlx::query_scalar("PRAGMA query_only")
                .fetch_one(&pool)
                .await
                .expect("connection should be returned to the pool");
            assert_eq!(query_only, 0);
            let result = query_sqlite_snapshot_for_instances(
                &instances,
                vec![statement("SELECT 2 AS value", vec![])],
            )
            .await
            .expect("connection should support a later read snapshot");
            assert_eq!(result[0].rows, vec![vec![Value::from(2)]]);
            execute_transaction_for_instances(
                &instances,
                vec![statement(
                    "INSERT INTO parents(id, label) VALUES (1, 'writable')",
                    vec![],
                )],
            )
            .await
            .expect("writes should still use the separate write boundary");

            drop(instances);
            pool.close().await;
            drop(pool);
            remove_test_database(&path).expect("snapshot fixture should be removed");
        });
    }

    #[test]
    fn snapshot_validation_rejects_writes_multiple_statements_and_oversized_batches() {
        run(async {
            let (path, pool, instances) = create_test_database().await;
            for query in [
                "INSERT INTO parents(id, label) VALUES (1, 'forbidden')",
                "CREATE TABLE forbidden (id INTEGER)",
                "SELECT 1; SELECT 2",
            ] {
                let error =
                    query_sqlite_snapshot_for_instances(&instances, vec![statement(query, vec![])])
                        .await
                        .expect_err("invalid snapshot query should be rejected");
                assert!(
                    error.contains("must be a SELECT or WITH query")
                        || error.contains("exactly one statement")
                );
            }

            let cte_write = query_sqlite_snapshot_for_instances(
                &instances,
                vec![statement(
                    "WITH candidate(id, label) AS (SELECT 1, 'hidden') \
                     INSERT INTO parents(id, label) SELECT id, label FROM candidate",
                    vec![],
                )],
            )
            .await
            .expect_err("query-only mode should reject writes hidden in a CTE");
            assert_eq!(cte_write, "SQLite read query failed.");

            let too_many = (0..=MAX_READ_SNAPSHOT_QUERIES)
                .map(|_| statement("SELECT 1", vec![]))
                .collect();
            let error = query_sqlite_snapshot_for_instances(&instances, too_many)
                .await
                .expect_err("oversized snapshot should be rejected before execution");
            assert!(error.contains("cannot contain more than"));

            let row_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM parents")
                .fetch_one(&pool)
                .await
                .expect("forbidden statements should leave the database unchanged");
            assert_eq!(row_count, 0);

            drop(instances);
            pool.close().await;
            remove_test_database(&path).expect("snapshot fixture should be removed");
        });
    }

    #[test]
    fn commits_multiple_statements_and_reuses_the_plugin_pool() {
        run(async {
            let (path, pool, instances) = create_test_database().await;
            let results = execute_transaction_for_instances(
                &instances,
                vec![
                    statement(
                        "INSERT INTO parents(id, label) VALUES ($1, $2)",
                        vec![Value::from(1), Value::from("first")],
                    ),
                    statement(
                        "INSERT INTO children(id, parent_id) VALUES ($1, $2)",
                        vec![Value::from(10), Value::from(1)],
                    ),
                ],
            )
            .await
            .expect("the whole transaction should commit");
            assert_eq!(results, vec![1, 1]);

            execute_transaction_for_instances(
                &instances,
                vec![statement(
                    "UPDATE parents SET label = $1 WHERE id = $2",
                    vec![Value::from("updated"), Value::from(1)],
                )],
            )
            .await
            .expect("a repeated transaction should work");

            let label: String = sqlx::query("SELECT label FROM parents WHERE id = 1")
                .fetch_one(&pool)
                .await
                .expect("the committed row should exist")
                .try_get(0)
                .expect("label should decode");
            assert_eq!(label, "updated");

            drop(instances);
            pool.close().await;
            let reopened = SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(
                    SqliteConnectOptions::new()
                        .filename(&path)
                        .foreign_keys(true),
                )
                .await
                .expect("the same file should reopen");
            let child_count: i64 = sqlx::query("SELECT COUNT(*) FROM children")
                .fetch_one(&reopened)
                .await
                .expect("committed child should remain")
                .try_get(0)
                .expect("count should decode");
            assert_eq!(child_count, 1);
            reopened.close().await;
            remove_test_database(&path).expect("test database should be removed");
        });
    }

    #[test]
    fn rolls_back_earlier_writes_after_a_later_statement_fails() {
        run(async {
            let (path, pool, instances) = create_test_database().await;
            execute_transaction_for_instances(
                &instances,
                vec![statement(
                    "INSERT INTO parents(id, label) VALUES ($1, $2)",
                    vec![Value::from(1), Value::from("original")],
                )],
            )
            .await
            .expect("seed transaction should commit");

            let error = execute_transaction_for_instances(
                &instances,
                vec![
                    statement(
                        "INSERT INTO parents(id, label) VALUES ($1, $2)",
                        vec![Value::from(2), Value::from("temporary")],
                    ),
                    statement(
                        "INSERT INTO parents(id, label) VALUES ($1, $2)",
                        vec![Value::from(1), Value::from("duplicate")],
                    ),
                ],
            )
            .await
            .expect_err("duplicate key should fail the batch");
            assert!(error.contains("statement 2"));

            let parent_count: i64 = sqlx::query("SELECT COUNT(*) FROM parents")
                .fetch_one(&pool)
                .await
                .expect("parent count should query")
                .try_get(0)
                .expect("count should decode");
            assert_eq!(parent_count, 1);
            let original: String = sqlx::query("SELECT label FROM parents WHERE id = 1")
                .fetch_one(&pool)
                .await
                .expect("original row should remain")
                .try_get(0)
                .expect("label should decode");
            assert_eq!(original, "original");

            drop(instances);
            pool.close().await;
            remove_test_database(&path).expect("test database should be removed");
        });
    }

    #[test]
    fn rolls_back_the_batch_when_an_affected_row_count_is_unexpected() {
        run(async {
            let (path, pool, instances) = create_test_database().await;
            execute_transaction_for_instances(
                &instances,
                vec![statement(
                    "INSERT INTO parents(id, label) VALUES ($1, $2)",
                    vec![Value::from(1), Value::from("original")],
                )],
            )
            .await
            .expect("seed transaction should commit");

            let error = execute_transaction_for_instances_with_expectations(
                &instances,
                vec![
                    statement(
                        "INSERT INTO parents(id, label) VALUES ($1, $2)",
                        vec![Value::from(2), Value::from("temporary")],
                    ),
                    statement(
                        "UPDATE parents SET label = $1 WHERE id = $2",
                        vec![Value::from("stale"), Value::from(999)],
                    ),
                ],
                Some(vec![1, 1]),
            )
            .await
            .expect_err("an unexpected row count should reject the batch");
            assert!(error.contains("statement 2"));
            assert!(error.contains("expected 1"));
            assert!(error.contains("received 0"));

            let parent_count: i64 = sqlx::query("SELECT COUNT(*) FROM parents")
                .fetch_one(&pool)
                .await
                .expect("parent count should query")
                .try_get(0)
                .expect("count should decode");
            assert_eq!(parent_count, 1);
            let temporary_count: i64 = sqlx::query("SELECT COUNT(*) FROM parents WHERE id = 2")
                .fetch_one(&pool)
                .await
                .expect("temporary row count should query")
                .try_get(0)
                .expect("count should decode");
            assert_eq!(temporary_count, 0);

            drop(instances);
            pool.close().await;
            remove_test_database(&path).expect("test database should be removed");
        });
    }

    #[test]
    fn foreign_key_failure_rolls_back_prior_statements() {
        run(async {
            let (path, pool, instances) = create_test_database().await;
            execute_transaction_for_instances(
                &instances,
                vec![statement(
                    "INSERT INTO parents(id, label) VALUES ($1, $2)",
                    vec![Value::from(1), Value::from("original")],
                )],
            )
            .await
            .expect("seed transaction should commit");

            let error = execute_transaction_for_instances(
                &instances,
                vec![
                    statement(
                        "INSERT INTO parents(id, label) VALUES ($1, $2)",
                        vec![Value::from(2), Value::from("temporary")],
                    ),
                    statement(
                        "INSERT INTO children(id, parent_id) VALUES ($1, $2)",
                        vec![Value::from(20), Value::from(999)],
                    ),
                ],
            )
            .await
            .expect_err("foreign-key violation should fail the batch");
            assert!(error.contains("statement 2"));

            let parent_count: i64 = sqlx::query("SELECT COUNT(*) FROM parents")
                .fetch_one(&pool)
                .await
                .expect("parent count should query")
                .try_get(0)
                .expect("count should decode");
            let child_count: i64 = sqlx::query("SELECT COUNT(*) FROM children")
                .fetch_one(&pool)
                .await
                .expect("child count should query")
                .try_get(0)
                .expect("count should decode");
            assert_eq!(parent_count, 1);
            assert_eq!(child_count, 0);

            drop(instances);
            pool.close().await;
            remove_test_database(&path).expect("test database should be removed");
        });
    }

    #[test]
    fn parameter_values_are_bound_and_non_dml_is_rejected() {
        run(async {
            let (path, pool, instances) = create_test_database().await;
            let value = "text'); DELETE FROM parents; --";
            execute_transaction_for_instances(
                &instances,
                vec![statement(
                    "INSERT INTO parents(id, label) VALUES ($1, $2)",
                    vec![Value::from(1), Value::from(value)],
                )],
            )
            .await
            .expect("parameterized insert should succeed");

            let stored: String = sqlx::query("SELECT label FROM parents WHERE id = 1")
                .fetch_one(&pool)
                .await
                .expect("inserted row should exist")
                .try_get(0)
                .expect("label should decode");
            assert_eq!(stored, value);

            let error =
                execute_transaction_for_instances(&instances, vec![statement("SELECT 1", vec![])])
                    .await
                    .expect_err("read SQL should not be accepted by the write boundary");
            assert!(error.contains("INSERT, UPDATE, or DELETE"));

            drop(instances);
            pool.close().await;
            remove_test_database(&path).expect("test database should be removed");
        });
    }

    #[test]
    fn concurrent_batches_commit_without_mixing_or_losing_writes() {
        run(async {
            let (path, pool, instances) = create_test_database().await;
            let instances = Arc::new(instances);
            let first_instances = Arc::clone(&instances);
            let second_instances = Arc::clone(&instances);
            let first = tauri::async_runtime::spawn(async move {
                execute_transaction_for_instances(
                    &first_instances,
                    vec![
                        statement(
                            "INSERT INTO parents(id, label) VALUES ($1, $2)",
                            vec![Value::from(1), Value::from("first")],
                        ),
                        statement(
                            "INSERT INTO children(id, parent_id) VALUES ($1, $2)",
                            vec![Value::from(10), Value::from(1)],
                        ),
                    ],
                )
                .await
            });
            let second = tauri::async_runtime::spawn(async move {
                execute_transaction_for_instances(
                    &second_instances,
                    vec![
                        statement(
                            "INSERT INTO parents(id, label) VALUES ($1, $2)",
                            vec![Value::from(2), Value::from("second")],
                        ),
                        statement(
                            "INSERT INTO children(id, parent_id) VALUES ($1, $2)",
                            vec![Value::from(20), Value::from(2)],
                        ),
                    ],
                )
                .await
            });

            let first_result = first.await.expect("first task should finish");
            let second_result = second.await.expect("second task should finish");
            assert_eq!(
                first_result.expect("first transaction should commit"),
                vec![1, 1]
            );
            assert_eq!(
                second_result.expect("second transaction should commit"),
                vec![1, 1]
            );

            let parent_count: i64 = sqlx::query("SELECT COUNT(*) FROM parents")
                .fetch_one(&pool)
                .await
                .expect("parent count should query")
                .try_get(0)
                .expect("count should decode");
            let child_count: i64 = sqlx::query("SELECT COUNT(*) FROM children")
                .fetch_one(&pool)
                .await
                .expect("child count should query")
                .try_get(0)
                .expect("count should decode");
            assert_eq!(parent_count, 2);
            assert_eq!(child_count, 2);

            drop(instances);
            pool.close().await;
            remove_test_database(&path).expect("test database should be removed");
        });
    }
}
