// Run: npx tsx scripts/dev/bench-lists.ts [salesCount]
// Fills an in-memory database with dummy data (never touches the real one) and times the Sell-history and Debts queries.
import { freshDb } from "../testkit.ts";
const sqlite = freshDb();
import * as sales from "../../src/data/sales.ts";
import * as debts from "../../src/data/debts.ts";

const N = Number(process.argv[2] ?? 100000);
const CLIENTS = Math.max(50, Math.round(N / 30));

sqlite.exec("BEGIN");
sqlite.exec("INSERT INTO units (name) VALUES ('kg')");
sqlite.exec("INSERT INTO items (name, unit_id, default_sell_price, created_at) VALUES ('Olives',1,1000,'2024-01-01')");
const cl = sqlite.prepare("INSERT INTO clients (name, created_at) VALUES (?, '2024-01-01')");
for (let i = 1; i <= CLIENTS; i++) cl.run(`client ${i}`);
const sa = sqlite.prepare("INSERT INTO sales (client_id, total, paid, rev, created_at) VALUES (?,?,?,1,?)");
const li = sqlite.prepare("INSERT INTO sale_lines (sale_id, rev, item_id, qty_milli, unit_price, buy_price, line_total) VALUES (?,1,1,?,?,?,?)");
const pa = sqlite.prepare("INSERT INTO payments (sale_id, kind, amount, created_at) VALUES (?, 'payment', ?, ?)");
for (let i = 1; i <= N; i++) {
  const total = 10000 * (1 + (i % 20));
  const unpaid = i % 5 === 0; // 20% of sales leave debt
  const paid = unpaid ? Math.round(total / 4) : total;
  const when = new Date(Date.UTC(2023, 0, 1) + i * 25000).toISOString();
  const id = Number(sa.run(1 + (i % CLIENTS), total, paid, when).lastInsertRowid);
  for (let k = 0; k < 3; k++) li.run(id, 1000, total / 3, 700, total / 3);
  if (unpaid && i % 10 === 0) pa.run(id, 1000, when);
}
sqlite.exec("COMMIT");

async function time(name: string, fn: () => Promise<unknown>) {
  const t = performance.now();
  const r = (await fn()) as unknown[];
  console.log(`${name.padEnd(42)} ${(performance.now() - t).toFixed(0).padStart(6)} ms   rows: ${r.length}`);
}

console.log(`dummy data: ${N} sales, ${CLIENTS} clients\n`);
await time("sales list, newest 200 (today's query)", () => sales.listSales(200));
await time("sales list, ALL rows (no limit)", () => sales.listSales(1e9));
await time("debtors list (all debtors)", () => debts.listDebtors());
await time("one client's sales (detail dialog)", () => debts.listClientSales(1));
