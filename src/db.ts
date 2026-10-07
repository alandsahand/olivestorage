import Database from "@tauri-apps/plugin-sql";

// Single shared connection. Migrations run on the Rust side (src-tauri/src/lib.rs).
let conn: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!conn) conn = Database.load("sqlite:olivestorage.db");
  return conn;
}

export async function checkDb(): Promise<boolean> {
  const db = await getDb();
  await db.select("SELECT 1 FROM settings LIMIT 1");
  return true;
}
