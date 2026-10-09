// Run: npm test — dashboard numbers must match a hand calculation.
import { eq, finish, freshDb } from "./testkit.ts";
const sqlite = freshDb();
import * as stock from "../src/data/stock.ts";
import * as sales from "../src/data/sales.ts";
import * as costs from "../src/data/costs.ts";
import { getDashboard } from "../src/data/dashboard.ts";
import { currentMonth, shiftMonth } from "../src/lib/months.ts";

const kg = await stock.addUnit("kg");
const olives = await stock.saveItem({ name: "Olives", category_id: null, unit_id: kg, default_sell_price: 7500 });
const oil = await stock.saveItem({ name: "Oil", category_id: null, unit_id: kg, default_sell_price: 1000 });
await stock.receive(olives, 100000, 5800); // 100 kg @ 5,800
await stock.receive(oil, 10000, 100); // 10 kg @ 100 (small seller)

const sell = (client: string, item: number, kgAmount: number, price: number, paid: number) =>
  sales.createSale({ client_name: client, paid, lines: [{ item_id: item, qty_milli: kgAmount * 1000, unit_price: price }] });

const A = await sell("Aso", olives, 20, 7500, 50000); // 150,000, cost 116,000, owes 100,000
await sell("Aso", oil, 4, 1000, 4000); // 4,000, cost 400, paid
const B = await sell("Shanaz", olives, 10, 7500, 5000); // will be cancelled, 5,000 to give back
const C = await sell("Halmat", olives, 5, 7500, 0); // moved to last month: 37,500, cost 29,000, owes 37,500
await sales.cancelSale(B);

const now = new Date();
const lastMonthMid = new Date(now.getFullYear(), now.getMonth() - 1, 15, 12).toISOString();
sqlite.prepare("UPDATE sales SET created_at = ?1 WHERE id = ?2").run(lastMonthMid, C);

const cur = currentMonth();
await costs.saveMonthCosts(cur, { electricity: 10000, workers: 20000, place: 30000 }); // 60,000

const d = await getDashboard(cur);
eq("sales this month = 150,000 + 4,000 (cancelled and last month excluded)", d.sales, 154000);
eq("cost of goods sold = 116,000 + 400", d.cogs, 116400);
eq("gross profit", d.gross, 37600);
eq("monthly costs", d.costs, 60000);
eq("net profit can be negative", d.net, -22400);
eq("stock value = 75 kg olives x 5,800 + 6 kg oil x 100", d.stockValue, 75000 * 5.8 + 6 * 100);
eq("debts: Aso 100,000 + Halmat 37,500", [d.debt, d.debtors], [137500, 2]);
eq("refunds due: the cancelled sale was paid 5,000", d.refundsDue, 5000);
eq("best sellers by money", d.best.map((x) => [x.name, x.total]), [["Olives", 150000], ["Oil", 4000]]);
eq("trend has six months ending now", [d.trend.length, d.trend[5].month, d.trend[0].month], [6, cur, shiftMonth(cur, -5)]);
eq("trend: this month and last month", [d.trend[5].total, d.trend[4].total, d.trend[0].total], [154000, 37500, 0]);

const prev = await getDashboard(shiftMonth(cur, -1));
eq("last month: only the moved sale", [prev.sales, prev.cogs, prev.gross, prev.costs, prev.net], [37500, 29000, 8500, 0, 8500]);
eq("last month trend still shows this month's bar", prev.trend.length, 6);
eq("stock/debts are 'now' figures (same in any month)", [prev.stockValue, prev.debt], [d.stockValue, d.debt]);

// editing a sale updates the numbers; the cost snapshot is kept even after new deliveries at a new price
await stock.receive(olives, 50000, 9000);
await sales.updateSale(A, { client_name: "Aso", paid: 50000, lines: [{ item_id: olives, qty_milli: 20000, unit_price: 8000 }] }); // 160,000 (money-only edit)
const d2 = await getDashboard(cur);
eq("after edit: sales", d2.sales, 164000);
eq("after edit: cost of the 20 kg keeps the 5,800 snapshot", d2.cogs, 20 * 5800 + 400);
eq("after edit: gross profit", d2.gross, 164000 - 20 * 5800 - 400);

const empty = await getDashboard("2020-01");
eq("a month with no activity is all zero", [empty.sales, empty.gross, empty.net, empty.best.length], [0, 0, 0, 0]);
finish();
