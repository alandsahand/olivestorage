// Run:  npx tsx scripts/dev/seed-dummy.ts          add dummy sales/debtors to the REAL dev database (to see paging)
//       npx tsx scripts/dev/seed-dummy.ts --remove  take them out again
// CLOSE THE APP FIRST. Everything added is marked: clients named "TEST n", item "TEST item", unit "TEST unit".
import { DatabaseSync } from "node:sqlite";
import { copyFileSync } from "node:fs";

const dir = `${process.env.APPDATA}\\com.olivestorage.app`;
const file = `${dir}\\olivestorage.db`;
const db = new DatabaseSync(file);
db.exec("PRAGMA busy_timeout = 3000");

if (process.argv.includes("--remove")) {
  db.exec("BEGIN");
  const ids = "(SELECT id FROM sales WHERE client_id IN (SELECT id FROM clients WHERE name LIKE 'TEST %'))";
  db.exec(`DELETE FROM payments WHERE sale_id IN ${ids}`);
  db.exec(`DELETE FROM sale_lines WHERE sale_id IN ${ids}`);
  db.exec("DELETE FROM sales WHERE client_id IN (SELECT id FROM clients WHERE name LIKE 'TEST %')");
  db.exec("DELETE FROM clients WHERE name LIKE 'TEST %'");
  db.exec("DELETE FROM stock_in WHERE item_id IN (SELECT id FROM items WHERE name = 'TEST item')");
  db.exec("DELETE FROM items WHERE name = 'TEST item'");
  db.exec("DELETE FROM units WHERE name = 'TEST unit'");
  db.exec("COMMIT");
  console.log("dummy data removed");
  process.exit(0);
}

db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); // fold the write-ahead log into the main file so the copy is complete
copyFileSync(file, `${dir}\\olivestorage-before-dummy.db`); // safety copy
db.exec("BEGIN");
const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
const unit = Number(db.prepare("INSERT INTO units (name) VALUES ('TEST unit')").run().lastInsertRowid);
const item = Number(
  db.prepare("INSERT INTO items (name, unit_id, default_sell_price, created_at) VALUES ('TEST item',?,1000,?)").run(unit, iso(0)).lastInsertRowid,
);
db.prepare("INSERT INTO stock_in (item_id, qty_milli, buy_price, created_at) VALUES (?,?,700,?)").run(item, 100_000_000, iso(60 * 864e5));
const cl = db.prepare("INSERT INTO clients (name, created_at) VALUES (?,?)");
const clients = Array.from({ length: 30 }, (_, i) => Number(cl.run(`TEST ${i + 1}`, iso(0)).lastInsertRowid));
const sa = db.prepare("INSERT INTO sales (client_id, total, paid, rev, created_at) VALUES (?,?,?,1,?)");
const li = db.prepare("INSERT INTO sale_lines (sale_id, rev, item_id, qty_milli, unit_price, buy_price, line_total) VALUES (?,1,?,?,1000,700,?)");
for (let i = 1; i <= 45; i++) {
  const kg = 5 + (i % 7) * 5;
  const total = kg * 1000;
  const paid = i % 3 === 0 ? total : i % 3 === 1 ? 0 : Math.round(total / 2); // paid / unpaid / half paid
  const id = Number(sa.run(clients[(i - 1) % 30], total, paid, iso((46 - i) * 3 * 36e5)).lastInsertRowid);
  li.run(id, item, kg * 1000, total);
}
db.exec("COMMIT");
console.log("added 45 sales, 30 clients (most owe money). Remove with:  npx tsx scripts/dev/seed-dummy.ts --remove");
