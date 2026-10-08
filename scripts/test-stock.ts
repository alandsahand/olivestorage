// Run: npm test   — exercises src/data/stock.ts against a real in-memory SQLite
// using the exact migration files the app ships.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { setDbForTests } from "../src/db.ts";
import * as s from "../src/data/stock.ts";
import { formatQty, parseMoney, parseQty, normalizeText } from "../src/lib/format.ts";

const sqlite = new DatabaseSync(":memory:");
sqlite.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);");
sqlite.exec(readFileSync(new URL("../src-tauri/migrations/002_stock.sql", import.meta.url), "utf8"));

// $1,$2 -> ?1,?2 (numbered positional params)
const conv = (q: string) => q.replace(/\$(\d+)/g, "?$1");
setDbForTests({
  async select(q, p = []) {
    return sqlite.prepare(conv(q)).all(...(p as never[])) as never;
  },
  async execute(q, p = []) {
    const r = sqlite.prepare(conv(q)).run(...(p as never[]));
    return { lastInsertId: Number(r.lastInsertRowid), rowsAffected: Number(r.changes) };
  },
});

let failed = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`);
}

// format helpers
eq("parseMoney Kurdish digits + commas", parseMoney("٧,٥٠٠"), 7500);
eq("parseQty decimal comma", parseQty("2,5"), 2500);
eq("parseQty arabic decimal", parseQty("٢٫٥"), 2500);
eq("parseQty rejects zero", parseQty("0"), null);
eq("formatQty whole", formatQty(25000), "٢٥");
eq("formatQty fraction", formatQty(2500), "٢٫٥");
eq("normalizeText unifies ي/ی and ك/ک", normalizeText("زيت"), normalizeText("زیت"));

// units & categories
const kg = await s.addUnit("کیلۆ");
eq("addUnit is idempotent (case/dup)", await s.addUnit("کیلۆ "), kg);
const olives = await s.addCategory("زەیتوون");
eq("categories listed", (await s.listCategories()).map((c) => c.name), ["زەیتوون"]);
await s.renameCategory(olives, "زەیتوونەکان");
eq("rename category", (await s.listCategories())[0].name, "زەیتوونەکان");
const oil = await s.addCategory("زەیت");
let dup = "";
try { await s.renameCategory(oil, "زەیتوونەکان"); } catch (e) { dup = (e as Error).message; }
eq("rename to existing name is refused", dup, "duplicate");
await s.archiveCategory(oil);
eq("archived category hidden", (await s.listCategories()).length, 1);
eq("re-adding archived category restores it", await s.addCategory("زەیت"), oil);

// items + deliveries
const item = await s.saveItem({ name: "زەیتوونی ڕەش", category_id: olives, unit_id: kg, default_sell_price: 7500 });
eq("new item has zero stock", (await s.listItems())[0].on_hand_milli, 0);
const d1 = await s.receive(item, 100000, 5800);
const d2 = await s.receive(item, 20500, 6000);
let items = await s.listItems();
eq("on hand = sum of deliveries", items[0].on_hand_milli, 120500);
eq("last buy price = newest delivery", items[0].last_buy_price, 6000);

await s.editDelivery(d2, 30000, 6100);
items = await s.listItems();
eq("edit delivery recalculates stock", items[0].on_hand_milli, 130000);
eq("edit delivery updates last price", items[0].last_buy_price, 6100);

await s.voidDelivery(d2);
items = await s.listItems();
eq("cancelled delivery leaves stock", items[0].on_hand_milli, 100000);
eq("last buy price falls back", items[0].last_buy_price, 5800);
eq("cancelled delivery kept in history list", (await s.listDeliveries(item)).length, 2);
let edited = "";
try { await s.editDelivery(d2, 1000, 1); } catch (e) { edited = (e as Error).message; }
eq("cancelled delivery cannot be edited", edited, "not editable");
let bad = "";
try { await s.receive(item, 0, 100); } catch (e) { bad = (e as Error).message; }
eq("zero quantity refused", bad, "invalid amount");

await s.saveItem({ id: item, name: "زەیتوونی ڕەش (گەورە)", category_id: olives, unit_id: kg, default_sell_price: 8000 });
eq("item edit saved", (await s.listItems())[0].default_sell_price, 8000);
await s.archiveItem(item);
eq("archived item hidden but data kept", [(await s.listItems()).length, (await s.listDeliveries(item)).length], [0, 2]);

const logRows = sqlite.prepare("SELECT COUNT(*) AS n FROM history_log").get() as { n: number };
eq("every change is in history_log", logRows.n >= 12, true);
void d1;

console.log(failed ? `\n${failed} FAILED` : "\nAll tests passed");
process.exit(failed ? 1 : 0);
