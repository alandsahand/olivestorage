// Shared test helpers: an in-memory SQLite that has every real migration applied.
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { setDbForTests } from "../src/db.ts";

export function freshDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);"); // migration 1 (inline in lib.rs)
  const dir = new URL("../src-tauri/migrations/", import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(new URL(f, dir), "utf8"));
  }
  const conv = (q: string) => q.replace(/\$(\d+)/g, "?$1"); // $1 -> ?1 (numbered positional params)
  setDbForTests({
    async select(q, p = []) {
      return sqlite.prepare(conv(q)).all(...(p as never[])) as never;
    },
    async execute(q, p = []) {
      const r = sqlite.prepare(conv(q)).run(...(p as never[]));
      return { lastInsertId: Number(r.lastInsertRowid), rowsAffected: Number(r.changes) };
    },
  });
  return sqlite;
}

let failed = 0;
export function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`);
}

export async function throws(name: string, fn: () => Promise<unknown>, message: string) {
  let got = "(no error)";
  try {
    await fn();
  } catch (e) {
    got = (e as Error).message;
  }
  eq(name, got, message);
}

export function finish() {
  console.log(failed ? `\n${failed} FAILED` : "\nAll tests passed");
  process.exit(failed ? 1 : 0);
}
