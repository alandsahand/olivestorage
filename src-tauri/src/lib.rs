mod backup;

use tauri_plugin_sql::{Migration, MigrationKind};

// Database migrations live in src-tauri/migrations/*.sql.
// Never edit a migration once released: add a new file with the next version number,
// so old data is always upgraded safely.
fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create settings",
            // Kept inline and byte-for-byte as first released: the database verifies checksums.
            sql: "CREATE TABLE settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
              );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "stock: units, categories, items, deliveries, history",
            sql: include_str!("../migrations/002_stock.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "sales: clients, sales, sale lines",
            sql: include_str!("../migrations/003_sales.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "payments and refunds",
            sql: include_str!("../migrations/004_payments.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "monthly costs",
            sql: include_str!("../migrations/005_monthly_costs.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "optional note on a sale",
            sql: include_str!("../migrations/006_sale_note.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Copy the database BEFORE the window opens it (and before any migration runs).
            backup::startup_backup(app.handle());
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:olivestorage.db", migrations())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            backup::list_backups,
            backup::backup_target,
            backup::prune_backups
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
