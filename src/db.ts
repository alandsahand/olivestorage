import Database from "@tauri-apps/plugin-sql";

// Minimal surface we use, so tests can plug in a different SQLite.
export interface Db {
  select<T>(sql: string, params?: unknown[]): Promise<T>;
  execute(sql: string, params?: unknown[]): Promise<{ lastInsertId?: number; rowsAffected: number }>;
}

// Single shared connection. Migrations run on the Rust side (src-tauri/src/lib.rs).
let conn: Promise<Db> | null = null;

export function getDb(): Promise<Db> {
  if (!conn) conn = Database.load("sqlite:olivestorage.db") as Promise<Db>;
  return conn;
}

/** Tests only: replace the database. */
export function setDbForTests(db: Db) {
  conn = Promise.resolve(db);
}

export async function checkDb(): Promise<boolean> {
  const db = await getDb();
  await db.select("SELECT 1 FROM settings LIMIT 1");
  return true;
}
