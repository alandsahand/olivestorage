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
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:olivestorage.db", migrations())
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
