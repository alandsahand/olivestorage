use tauri_plugin_sql::{Migration, MigrationKind};

// Database migrations. Never edit an existing migration once released:
// add a new one with the next version number so old data is always upgraded safely.
// Money is stored as whole IQD integers (no decimals).
fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "create settings",
        sql: "CREATE TABLE settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
              );",
        kind: MigrationKind::Up,
    }]
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
