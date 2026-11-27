use futures_util::TryStreamExt;
use sha2::{Digest, Sha256};
use sqlx::{Connection, Row, Sqlite, SqliteConnection, SqlitePool};
use tauri_plugin_sql::{DbInstances, DbPool};

const DATABASE_KEY: &str = "sqlite:tipia.db";
const MIGRATION_001_VERSION: i64 = 1;
const MIGRATION_001_NAME: &str = "001_reconciled_initial_schema";
const MIGRATION_001_SQL: &str = include_str!("./migrations/migration_001.sql");
const MIGRATION_002_VERSION: i64 = 2;
const MIGRATION_002_NAME: &str = "002_delivery_inventory_association";
const MIGRATION_002_SQL: &str =
    include_str!("./migrations/migration_002_delivery_inventory_association.sql");
const MIGRATION_003_VERSION: i64 = 3;
const MIGRATION_003_NAME: &str = "003_received_delivery_inventory_association_guards";
const MIGRATION_003_SQL: &str =
    include_str!("./migrations/migration_003_received_delivery_inventory_association_guards.sql");

#[derive(Clone, Copy)]
struct MigrationDefinition<'a> {
    version: i64,
    name: &'a str,
    sql: &'a str,
}

const MIGRATIONS: [MigrationDefinition<'static>; 3] = [
    MigrationDefinition {
        version: MIGRATION_001_VERSION,
        name: MIGRATION_001_NAME,
        sql: MIGRATION_001_SQL,
    },
    MigrationDefinition {
        version: MIGRATION_002_VERSION,
        name: MIGRATION_002_NAME,
        sql: MIGRATION_002_SQL,
    },
    MigrationDefinition {
        version: MIGRATION_003_VERSION,
        name: MIGRATION_003_NAME,
        sql: MIGRATION_003_SQL,
    },
];

pub(crate) async fn initialize_sqlite_schema_for_instances(
    db_instances: &DbInstances,
) -> Result<String, String> {
    execute_all_migrations_for_instances(db_instances)
        .await
        .map(|result| {
            format!(
                "Migrations through version {} {}.",
                MIGRATION_003_VERSION, result
            )
        })
}

pub(crate) async fn initialize_sqlite_schema_for_pool(pool: SqlitePool) -> Result<String, String> {
    execute_all_migrations(pool).await.map(|result| {
        format!(
            "Migrations through version {} {}.",
            MIGRATION_003_VERSION, result
        )
    })
}

fn sha256(sql: &str) -> String {
    format!("{:x}", Sha256::digest(sql.as_bytes()))
}

async fn get_database_pool(instances: &DbInstances) -> Result<SqlitePool, String> {
    let pools = instances.0.read().await;
    match pools.get(DATABASE_KEY) {
        Some(DbPool::Sqlite(pool)) => Ok(pool.clone()),
        None => Err(
            "SQLite is not initialized. Initialize sqlite:tipia.db before running migrations."
                .to_owned(),
        ),
    }
}

async fn set_and_verify_foreign_keys(
    connection: &mut sqlx::pool::PoolConnection<Sqlite>,
) -> Result<(), String> {
    sqlx::query("PRAGMA foreign_keys = ON")
        .execute(&mut **connection)
        .await
        .map_err(|error| format!("Could not enable SQLite foreign keys: {error}"))?;
    let enabled: i64 = sqlx::query("PRAGMA foreign_keys")
        .fetch_one(&mut **connection)
        .await
        .map_err(|error| format!("Could not verify SQLite foreign keys: {error}"))?
        .try_get(0)
        .map_err(|_| "Could not read SQLite foreign-key status.".to_owned())?;
    if enabled != 1 {
        return Err("SQLite foreign-key enforcement is not enabled.".to_owned());
    }
    Ok(())
}

async fn verify_schema(connection: &mut SqliteConnection) -> Result<(), String> {
    if let Some(row) = sqlx::query("PRAGMA foreign_key_check")
        .fetch_optional(&mut *connection)
        .await
        .map_err(|error| format!("Migration foreign-key check failed: {error}"))?
    {
        let table: String = row.try_get(0).unwrap_or_else(|_| "unknown".to_owned());
        return Err(format!(
            "Migration foreign-key check found a violation in table {table}."
        ));
    }

    let integrity: String = sqlx::query("PRAGMA integrity_check")
        .fetch_one(&mut *connection)
        .await
        .map_err(|error| format!("Migration integrity check failed: {error}"))?
        .try_get(0)
        .map_err(|_| "Could not read SQLite integrity-check result.".to_owned())?;
    if integrity != "ok" {
        return Err(format!("Migration integrity check failed: {integrity}."));
    }
    Ok(())
}

async fn execute_migration_001_for_instances(
    instances: &DbInstances,
) -> Result<&'static str, String> {
    execute_migration_001_sql_for_instances(instances, MIGRATION_001_SQL, None).await
}

async fn execute_migration_001_sql_for_instances(
    instances: &DbInstances,
    migration_sql: &str,
    checksum_override: Option<&str>,
) -> Result<&'static str, String> {
    let pool = get_database_pool(instances).await?;
    execute_migration_001_sql(pool, migration_sql, checksum_override).await
}

async fn execute_migration_001_sql(
    pool: SqlitePool,
    migration_sql: &str,
    checksum_override: Option<&str>,
) -> Result<&'static str, String> {
    execute_migrations(
        pool,
        &[MigrationDefinition {
            version: MIGRATION_001_VERSION,
            name: MIGRATION_001_NAME,
            sql: migration_sql,
        }],
        checksum_override,
    )
    .await
}

async fn execute_all_migrations_for_instances(
    instances: &DbInstances,
) -> Result<&'static str, String> {
    let pool = get_database_pool(instances).await?;
    execute_all_migrations(pool).await
}

async fn execute_all_migrations(pool: SqlitePool) -> Result<&'static str, String> {
    execute_migrations(pool, &MIGRATIONS, None).await
}

async fn execute_migrations(
    pool: SqlitePool,
    migrations: &[MigrationDefinition<'_>],
    checksum_override_for_001: Option<&str>,
) -> Result<&'static str, String> {
    if migrations.is_empty()
        || migrations
            .iter()
            .enumerate()
            .any(|(index, migration)| migration.version != index as i64 + 1)
    {
        return Err("Embedded SQLite migrations are not contiguous from version 1.".to_owned());
    }

    let mut connection = pool
        .acquire()
        .await
        .map_err(|error| format!("Could not acquire SQLite migration connection: {error}"))?;
    set_and_verify_foreign_keys(&mut connection).await?;

    let mut transaction = (&mut *connection)
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(|error| format!("Could not begin migration transaction: {error}"))?;

    let result =
        run_migrations_in_transaction(&mut *transaction, migrations, checksum_override_for_001)
            .await;

    match result {
        Ok(result) => {
            transaction
                .commit()
                .await
                .map_err(|error| format!("SQLite migration commit failed: {error}"))?;
            Ok(result)
        }
        Err(error) => match transaction.rollback().await {
            Ok(()) => Err(error),
            Err(rollback_error) => Err(format!(
                "{error} Migration rollback also failed: {rollback_error}"
            )),
        },
    }
}

async fn run_migrations_in_transaction(
    connection: &mut SqliteConnection,
    migrations: &[MigrationDefinition<'_>],
    checksum_override_for_001: Option<&str>,
) -> Result<&'static str, String> {
    let ledger_exists = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM sqlite_master
         WHERE type = 'table' AND name = 'schema_migrations'",
    )
    .fetch_one(&mut *connection)
    .await
    .map_err(|error| format!("Could not inspect migration ledger: {error}"))?;

    let mut applied_version = 0_i64;
    if ledger_exists == 1 {
        let rows = sqlx::query(
            "SELECT version, name, checksum_sha256
             FROM schema_migrations
             ORDER BY version ASC",
        )
        .fetch_all(&mut *connection)
        .await
        .map_err(|error| format!("Could not read migration ledger: {error}"))?;

        if rows.is_empty() {
            return Err("Migration ledger exists but contains no applied migration.".to_owned());
        }

        for row in &rows {
            let version: i64 = row
                .try_get("version")
                .map_err(|_| "Migration ledger contains an invalid version.".to_owned())?;
            if version != applied_version + 1 {
                return Err(format!(
                    "Migration ledger versions are not contiguous at version {version:03}."
                ));
            }
            let migration = migrations.iter().find(|candidate| candidate.version == version)
                .ok_or_else(|| format!("Database requires migration version {version:03}, which this binary does not know."))?;

            let stored_name: String = row
                .try_get("name")
                .map_err(|_| "Migration ledger contains an invalid name.".to_owned())?;
            if stored_name != migration.name {
                return Err(format!(
                    "Migration {version:03} name mismatch: ledger has {stored_name}, embedded migration is {}.",
                    migration.name
                ));
            }

            let stored_checksum: String = row
                .try_get("checksum_sha256")
                .map_err(|_| "Migration ledger contains an invalid checksum.".to_owned())?;
            let expected_checksum = if version == MIGRATION_001_VERSION {
                checksum_override_for_001
                    .map(str::to_owned)
                    .unwrap_or_else(|| sha256(migration.sql))
            } else {
                sha256(migration.sql)
            };
            if stored_checksum != expected_checksum {
                return Err(format!(
                    "Migration {version:03} checksum mismatch: ledger expects {stored_checksum}, embedded migration is {expected_checksum}."
                ));
            }
            applied_version = version;
        }
    } else {
        let known_object_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM sqlite_master
             WHERE name NOT LIKE 'sqlite_%'
               AND (type = 'table' OR type = 'view' OR type = 'trigger' OR type = 'index')",
        )
        .fetch_one(&mut *connection)
        .await
        .map_err(|error| format!("Could not inspect existing SQLite objects: {error}"))?;
        if known_object_count > 0 {
            return Err(
                "SQLite migrations cannot initialize a database with existing objects and no migration ledger."
                    .to_owned(),
            );
        }
    }

    let mut applied_any = false;
    for migration in migrations
        .iter()
        .filter(|item| item.version > applied_version)
    {
        let mut statements = sqlx::raw_sql(migration.sql).execute_many(&mut *connection);
        while statements
            .try_next()
            .await
            .map_err(|error| format!("Migration {:03} failed: {error}", migration.version))?
            .is_some()
        {}
        drop(statements);

        let applied_at: String = sqlx::query_scalar("SELECT strftime('%Y-%m-%dT%H:%M:%SZ', 'now')")
            .fetch_one(&mut *connection)
            .await
            .map_err(|error| format!("Could not create migration timestamp: {error}"))?;

        let checksum = if migration.version == MIGRATION_001_VERSION {
            checksum_override_for_001
                .map(str::to_owned)
                .unwrap_or_else(|| sha256(migration.sql))
        } else {
            sha256(migration.sql)
        };

        sqlx::query(
            "INSERT INTO schema_migrations(version, name, checksum_sha256, applied_at)
             VALUES ($1, $2, $3, $4)",
        )
        .bind(migration.version)
        .bind(migration.name)
        .bind(checksum)
        .bind(applied_at)
        .execute(&mut *connection)
        .await
        .map_err(|error| {
            format!(
                "Migration {:03} ledger update failed: {error}",
                migration.version
            )
        })?;
        applied_any = true;
    }

    verify_schema(connection).await?;
    if applied_any {
        Ok("was applied successfully")
    } else {
        Ok("is already applied; no migration SQL was rerun")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use std::{
        fs,
        path::{Path, PathBuf},
        sync::atomic::{AtomicU64, Ordering},
        time::Duration,
    };

    static NEXT_TEST_DATABASE: AtomicU64 = AtomicU64::new(0);

    async fn create_test_database() -> (PathBuf, SqlitePool, DbInstances) {
        let path = std::env::temp_dir().join(format!(
            "mini-tipia-migration-{}-{}.sqlite",
            std::process::id(),
            NEXT_TEST_DATABASE.fetch_add(1, Ordering::Relaxed)
        ));
        let pool = SqlitePoolOptions::new()
            .max_connections(4)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(&path)
                    .create_if_missing(true)
                    .foreign_keys(true),
            )
            .await
            .expect("test migration database should open");
        let instances = DbInstances::default();
        instances
            .0
            .write()
            .await
            .insert(DATABASE_KEY.to_owned(), DbPool::Sqlite(pool.clone()));
        (path, pool, instances)
    }

    fn run<F: std::future::Future>(future: F) -> F::Output {
        tauri::async_runtime::block_on(future)
    }

    fn remove_test_database(path: &Path) -> std::io::Result<()> {
        for attempt in 0..20 {
            match fs::remove_file(path) {
                Ok(()) => return Ok(()),
                Err(error) if error.raw_os_error() == Some(32) && attempt < 19 => {
                    std::thread::sleep(Duration::from_millis(25));
                }
                Err(error) => return Err(error),
            }
        }
        unreachable!()
    }

    #[test]
    fn fresh_database_applies_migration_once_and_records_ledger() {
        run(async {
            let (path, pool, instances) = create_test_database().await;
            let first = execute_migration_001_for_instances(&instances)
                .await
                .expect("fresh migration should apply");
            assert!(first.contains("applied successfully"));

            let second = execute_migration_001_for_instances(&instances)
                .await
                .expect("repeat migration should be a no-op");
            assert!(second.contains("already applied"));

            let ledger_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM schema_migrations")
                .fetch_one(&pool)
                .await
                .expect("ledger should query");
            assert_eq!(ledger_count, 1);

            let table_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'table' AND name IN (
                   'products','variants','packaging_levels','batches',
                   'inventory_records','inventory_stock','sale_drafts',
                   'sales','deliveries','activity_events','schema_migrations'
                 )",
            )
            .fetch_one(&pool)
            .await
            .expect("schema objects should query");
            assert_eq!(table_count, 11);

            drop(instances);
            pool.close().await;
            drop(pool);
            remove_test_database(&path).expect("test database should be removed");
        });
    }

    #[test]
    fn migrations_upgrade_existing_schema_and_are_idempotent() {
        run(async {
            let (path, pool, instances) = create_test_database().await;
            execute_migration_001_for_instances(&instances)
                .await
                .expect("Migration 001 should apply");

            let upgrade = execute_all_migrations_for_instances(&instances)
                .await
                .expect("Migration 002 should apply to an existing database");
            assert!(upgrade.contains("applied successfully"));
            let repeat = execute_all_migrations_for_instances(&instances)
                .await
                .expect("repeated migration initialization should succeed");
            assert!(repeat.contains("already applied"));

            let versions: Vec<i64> =
                sqlx::query_scalar("SELECT version FROM schema_migrations ORDER BY version")
                    .fetch_all(&pool)
                    .await
                    .expect("migration versions should query");
            assert_eq!(versions, vec![1, 2, 3]);
            assert_eq!(
                sha256(MIGRATION_002_SQL),
                "dd0887ef67b4589ea7164ef82667aa8be1fc5a3c7bf7145aea7eae3f00b9c898"
            );

            let has_inventory_association: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM pragma_table_info('delivery_items')
                 WHERE name = 'received_inventory_id'",
            )
            .fetch_one(&pool)
            .await
            .expect("Migration 002 column should query");
            assert_eq!(has_inventory_association, 1);

            drop(instances);
            pool.close().await;
            drop(pool);
            remove_test_database(&path).expect("test database should be removed");
        });
    }

    #[test]
    fn fresh_database_applies_all_migrations_with_original_checksum() {
        run(async {
            let (path, pool, instances) = create_test_database().await;
            let first = execute_all_migrations_for_instances(&instances)
                .await
                .expect("all migrations should apply to a fresh database");
            assert!(first.contains("applied successfully"));

            let rows = sqlx::query(
                "SELECT version, name, checksum_sha256
                 FROM schema_migrations
                 ORDER BY version",
            )
            .fetch_all(&pool)
            .await
            .expect("migration ledger should query");
            let versions: Vec<i64> = rows
                .iter()
                .map(|row| row.try_get("version").expect("version should decode"))
                .collect();
            assert_eq!(versions, vec![1, 2, 3]);
            assert_eq!(
                rows[1]
                    .try_get::<String, _>("checksum_sha256")
                    .expect("Migration 002 checksum should decode"),
                "dd0887ef67b4589ea7164ef82667aa8be1fc5a3c7bf7145aea7eae3f00b9c898"
            );
            assert_eq!(
                rows[2]
                    .try_get::<String, _>("checksum_sha256")
                    .expect("Migration 003 checksum should decode"),
                sha256(MIGRATION_003_SQL)
            );
            assert_eq!(
                rows[2]
                    .try_get::<String, _>("name")
                    .expect("Migration 003 name should decode"),
                MIGRATION_003_NAME
            );

            let repeat = execute_all_migrations_for_instances(&instances)
                .await
                .expect("repeated initialization should succeed");
            assert!(repeat.contains("already applied"));

            let foreign_key_violations: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM pragma_foreign_key_check")
                    .fetch_one(&pool)
                    .await
                    .expect("foreign-key check should query");
            assert_eq!(foreign_key_violations, 0);
            let integrity: String = sqlx::query_scalar("PRAGMA integrity_check")
                .fetch_one(&pool)
                .await
                .expect("integrity check should query");
            assert_eq!(integrity, "ok");

            drop(instances);
            pool.close().await;
            drop(pool);
            remove_test_database(&path).expect("test database should be removed");
        });
    }

    #[test]
    fn migration_003_upgrades_original_v2_fixture_and_preserves_delivery_guards() {
        run(async {
            let (path, pool, instances) = create_test_database().await;
            execute_migrations(pool.clone(), &MIGRATIONS[..2], None)
                .await
                .expect("original Migration 002 fixture should apply");

            sqlx::query(
                "INSERT INTO products(product_id, product_position, name)
                 VALUES ('product-1', 0, 'Test product')",
            )
            .execute(&pool)
            .await
            .expect("test product should insert");
            sqlx::query(
                "INSERT INTO variants(variant_id, product_id, variant_position, variant_name)
                 VALUES ('variant-1', 'product-1', 0, 'Test variant')",
            )
            .execute(&pool)
            .await
            .expect("test variant should insert");
            sqlx::query(
                "INSERT INTO packaging_levels(
                   packaging_level_id, product_id, variant_id, packaging_position, name
                 ) VALUES ('pack-1', 'product-1', 'variant-1', 0, 'Unit')",
            )
            .execute(&pool)
            .await
            .expect("test packaging should insert");
            for (batch_id, position, batch_number) in [
                ("batch-1", 0_i64, "B1"),
                ("batch-2", 1_i64, "B2"),
                ("batch-3", 2_i64, "B3"),
            ] {
                sqlx::query(
                    "INSERT INTO batches(
                       batch_id, product_id, variant_id, batch_position, batch_number
                     ) VALUES (?, 'product-1', 'variant-1', ?, ?)",
                )
                .bind(batch_id)
                .bind(position)
                .bind(batch_number)
                .execute(&pool)
                .await
                .expect("test batch should insert");
            }
            sqlx::query(
                "INSERT INTO inventory_records(
                   inventory_id, product_id, variant_id, inventory_position, batch_id
                 ) VALUES ('inventory-1', 'product-1', 'variant-1', 0, 'batch-1')",
            )
            .execute(&pool)
            .await
            .expect("existing Inventory record should insert before the draft");

            insert_received_delivery(
                &pool,
                "delivery-legacy",
                "item-legacy",
                "inventory-1",
                "batch-1",
                "event-legacy",
            )
            .await;

            let upgrade = execute_all_migrations_for_instances(&instances)
                .await
                .expect("Migration 003 should upgrade an original v2 database");
            assert!(upgrade.contains("applied successfully"));
            assert_eq!(
                sha256(MIGRATION_002_SQL),
                "dd0887ef67b4589ea7164ef82667aa8be1fc5a3c7bf7145aea7eae3f00b9c898"
            );
            let retained_delivery = sqlx::query(
                "SELECT delivery.status, item.received_inventory_id
                 FROM deliveries AS delivery
                 JOIN delivery_items AS item ON item.delivery_id = delivery.delivery_id
                 WHERE delivery.delivery_id = 'delivery-legacy'",
            )
            .fetch_one(&pool)
            .await
            .expect("pre-migration Delivery association should remain");
            assert_eq!(
                retained_delivery
                    .try_get::<String, _>("status")
                    .expect("Delivery status should decode"),
                "received"
            );
            assert_eq!(
                retained_delivery
                    .try_get::<String, _>("received_inventory_id")
                    .expect("Inventory association should decode"),
                "inventory-1"
            );

            let identity_update = sqlx::query(
                "UPDATE inventory_records SET batch_id = 'batch-3'
                 WHERE inventory_id = 'inventory-1'",
            )
            .execute(&pool)
            .await
            .expect_err("received Inventory identity must be retained");
            assert!(
                identity_update
                    .to_string()
                    .contains("Inventory record identity is retained")
            );

            sqlx::query(
                "INSERT INTO inventory_stock(
                   inventory_id, product_id, variant_id, packaging_level_id,
                   stock_position, quantity
                 ) VALUES ('inventory-1', 'product-1', 'variant-1', 'pack-1', 0, 1)",
            )
            .execute(&pool)
            .await
            .expect("stock row should insert");
            sqlx::query(
                "UPDATE inventory_stock SET quantity = 2 WHERE inventory_id = 'inventory-1'",
            )
            .execute(&pool)
            .await
            .expect("stock quantity updates should remain allowed");

            sqlx::query("DELETE FROM inventory_records WHERE inventory_id = 'inventory-1'")
                .execute(&pool)
                .await
                .expect("deleting an Inventory row should retain the Delivery text association");
            let mismatched_reinsert = sqlx::query(
                "INSERT INTO inventory_records(
                   inventory_id, product_id, variant_id, inventory_position, batch_id
                 ) VALUES ('inventory-1', 'product-1', 'variant-1', 0, 'batch-3')",
            )
            .execute(&pool)
            .await
            .expect_err("reused Inventory ID must match retained Delivery identity");
            assert!(
                mismatched_reinsert
                    .to_string()
                    .contains("does not match its received Delivery association")
            );
            sqlx::query(
                "INSERT INTO inventory_records(
                   inventory_id, product_id, variant_id, inventory_position, batch_id
                 ) VALUES ('inventory-1', 'product-1', 'variant-1', 0, 'batch-1')",
            )
            .execute(&pool)
            .await
            .expect("matching Inventory identity should be reusable");

            insert_draft_delivery(
                &pool,
                "delivery-planned",
                "item-planned",
                "inventory-2",
                "batch-2",
                "event-planned",
            )
            .await;
            let active_draft_lock = sqlx::query(
                "INSERT INTO inventory_records(
                   inventory_id, product_id, variant_id, inventory_position, batch_id
                 ) VALUES ('inventory-2', 'product-1', 'variant-1', 1, 'batch-2')",
            )
            .execute(&pool)
            .await
            .expect_err("active Delivery draft should retain its inventory lock");
            assert!(
                active_draft_lock
                    .to_string()
                    .contains("active draft locks product inventory")
            );

            receive_delivery(&pool, "delivery-planned", "event-planned").await;
            let mismatched_planned_insert = sqlx::query(
                "INSERT INTO inventory_records(
                   inventory_id, product_id, variant_id, inventory_position, batch_id
                 ) VALUES ('inventory-2', 'product-1', 'variant-1', 1, 'batch-3')",
            )
            .execute(&pool)
            .await
            .expect_err("planned Inventory record must match the received Delivery");
            assert!(
                mismatched_planned_insert
                    .to_string()
                    .contains("does not match its received Delivery association")
            );
            sqlx::query(
                "INSERT INTO inventory_records(
                   inventory_id, product_id, variant_id, inventory_position, batch_id
                 ) VALUES ('inventory-2', 'product-1', 'variant-1', 1, 'batch-2')",
            )
            .execute(&pool)
            .await
            .expect("matching planned Inventory record should insert after receipt");

            let repeat = execute_all_migrations_for_instances(&instances)
                .await
                .expect("repeated initialization after upgrade should succeed");
            assert!(repeat.contains("already applied"));
            let versions: Vec<i64> =
                sqlx::query_scalar("SELECT version FROM schema_migrations ORDER BY version")
                    .fetch_all(&pool)
                    .await
                    .expect("migration ledger should query");
            assert_eq!(versions, vec![1, 2, 3]);

            drop(instances);
            pool.close().await;
            drop(pool);
            remove_test_database(&path).expect("test database should be removed");
        });
    }

    async fn insert_received_delivery(
        pool: &SqlitePool,
        delivery_id: &str,
        item_id: &str,
        inventory_id: &str,
        batch_id: &str,
        event_id: &str,
    ) {
        insert_draft_delivery(pool, delivery_id, item_id, inventory_id, batch_id, event_id).await;
        receive_delivery(pool, delivery_id, event_id).await;
    }

    async fn insert_draft_delivery(
        pool: &SqlitePool,
        delivery_id: &str,
        item_id: &str,
        inventory_id: &str,
        batch_id: &str,
        event_id: &str,
    ) {
        sqlx::query(
            "INSERT INTO deliveries(delivery_id, status, created_at, updated_at)
             VALUES (?, 'draft', '2026-11-26T00:00:00Z', '2026-11-26T00:00:00Z')",
        )
        .bind(delivery_id)
        .execute(pool)
        .await
        .expect("test Delivery draft should insert");
        sqlx::query(
            "INSERT INTO delivery_items(
               delivery_id, delivery_item_id, item_position, product_id, variant_id,
               packaging_level_id, quantity, received_batch_id, receipt_snapshot_json,
               received_inventory_id
             ) VALUES (?, ?, 0, 'product-1', 'variant-1', 'pack-1', 1, ?, '{}', ?)",
        )
        .bind(delivery_id)
        .bind(item_id)
        .bind(batch_id)
        .bind(inventory_id)
        .execute(pool)
        .await
        .expect("test Delivery item should insert");
        sqlx::query(
            "INSERT INTO activity_events(
               event_id, operation_key, event_type, occurred_at, event_json
             ) VALUES (?, ?, 'delivery.received', '2026-11-26T00:00:00Z', '{}')",
        )
        .bind(event_id)
        .bind(format!("delivery.received:{delivery_id}"))
        .execute(pool)
        .await
        .expect("test Activity event should insert");
    }

    async fn receive_delivery(pool: &SqlitePool, delivery_id: &str, event_id: &str) {
        sqlx::query(
            "UPDATE deliveries
             SET status = 'received',
                 delivery_date = '2026-11-26',
                 received_by = 'test user',
                 received_event_id = ?,
                 updated_at = '2026-11-26T00:01:00Z'
             WHERE delivery_id = ?",
        )
        .bind(event_id)
        .bind(delivery_id)
        .execute(pool)
        .await
        .expect("test Delivery should be received");
    }

    #[test]
    fn concurrent_fresh_requests_apply_once() {
        run(async {
            let (path, pool, instances) = create_test_database().await;
            let (first, second) = tokio::join!(
                execute_migration_001_sql(pool.clone(), MIGRATION_001_SQL, None),
                execute_migration_001_sql(pool.clone(), MIGRATION_001_SQL, None),
            );
            let first = first.expect("first concurrent migration should succeed");
            let second = second.expect("second concurrent migration should succeed");

            let outcomes = [first, second];
            assert_eq!(
                outcomes
                    .iter()
                    .filter(|outcome| outcome.contains("applied successfully"))
                    .count(),
                1,
                "exactly one concurrent request should apply Migration 001",
            );
            assert_eq!(
                outcomes
                    .iter()
                    .filter(|outcome| outcome.contains("already applied"))
                    .count(),
                1,
                "the other concurrent request should observe the committed ledger",
            );

            let ledger_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM schema_migrations")
                .fetch_one(&pool)
                .await
                .expect("ledger should query");
            assert_eq!(ledger_count, 1);

            let duplicate_tables: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'table' AND name IN (
                   'products','variants','packaging_levels','batches',
                   'inventory_records','inventory_stock','sale_drafts',
                   'sales','deliveries','activity_events','schema_migrations'
                 )",
            )
            .fetch_one(&pool)
            .await
            .expect("schema objects should query");
            assert_eq!(duplicate_tables, 11);

            drop(instances);
            pool.close().await;
            drop(pool);
            remove_test_database(&path).expect("test database should be removed");
        });
    }

    #[test]
    fn checksum_mismatch_is_rejected() {
        run(async {
            let (path, pool, instances) = create_test_database().await;
            execute_migration_001_for_instances(&instances)
                .await
                .expect("first application should succeed");

            let error = execute_migration_001_sql_for_instances(
                &instances,
                MIGRATION_001_SQL,
                Some("0123456789abcdef"),
            )
            .await
            .expect_err("changed migration checksum should fail");
            assert!(error.contains("checksum mismatch"));

            drop(instances);
            pool.close().await;
            drop(pool);
            remove_test_database(&path).expect("test database should be removed");
        });
    }

    #[test]
    fn ledger_history_is_protected_and_foreign_keys_remain_enabled() {
        run(async {
            let (path, pool, instances) = create_test_database().await;
            execute_migration_001_for_instances(&instances)
                .await
                .expect("first application should succeed");

            let update_error =
                sqlx::query("UPDATE schema_migrations SET checksum_sha256 = 'changed'")
                    .execute(&pool)
                    .await
                    .expect_err("ledger update must be blocked");
            assert!(
                update_error
                    .to_string()
                    .contains("migration history is immutable")
            );

            let delete_error = sqlx::query("DELETE FROM schema_migrations")
                .execute(&pool)
                .await
                .expect_err("ledger delete must be blocked");
            assert!(
                delete_error
                    .to_string()
                    .contains("migration history is retained")
            );

            let foreign_keys: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
                .fetch_one(&pool)
                .await
                .expect("foreign-key status should query");
            assert_eq!(foreign_keys, 1);

            drop(instances);
            pool.close().await;
            drop(pool);
            remove_test_database(&path).expect("test database should be removed");
        });
    }

    #[test]
    fn failed_migration_rolls_back_schema_and_ledger() {
        run(async {
            let (path, pool, instances) = create_test_database().await;
            let failed_sql = r#"
                CREATE TABLE rollback_probe (id INTEGER PRIMARY KEY);
                CREATE TABLE intentionally_broken (;
            "#;

            let error = execute_migration_001_sql_for_instances(
                &instances,
                failed_sql,
                Some("1111111111111111111111111111111111111111111111111111111111111111"),
            )
            .await
            .expect_err("deliberately invalid migration should fail");
            assert!(error.contains("Migration 001 failed"));

            let ledger_exists: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type='table' AND name='schema_migrations'",
            )
            .fetch_one(&pool)
            .await
            .expect("ledger check should query");
            assert_eq!(ledger_exists, 0);

            let probe_exists: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type='table' AND name='rollback_probe'",
            )
            .fetch_one(&pool)
            .await
            .expect("rollback probe should query");
            assert_eq!(probe_exists, 0);

            drop(instances);
            pool.close().await;
            drop(pool);
            remove_test_database(&path).expect("test database should be removed");
        });
    }
}
