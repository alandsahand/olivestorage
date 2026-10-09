// Run: npm test — returns of sold goods (owner request 2026-10-10, docs/flow.md section 8).
import { eq, finish, freshDb, throws } from "./testkit.ts";
const sqlite = freshDb();
import * as stock from "../src/data/stock.ts";
import * as sales from "../src/data/sales.ts";
import * as debts from "../src/data/debts.ts";
import * as ret from "../src/data/returns.ts";
import { getDashboard } from "../src/data/dashboard.ts";
import { currentMonth, shiftMonth } from "../src/lib/months.ts";

const kg = await stock.addUnit("kg");
const jar = await stock.addUnit("jar");
const olives = await stock.saveItem({ name: "Olives", category_id: null, unit_id: kg, default_sell_price: 7500 });
const pickles = await stock.saveItem({ name: "Pickles", category_id: null, unit_id: jar, default_sell_price: 3000 });
await stock.receive(olives, 100000, 5000);
await stock.receive(pickles, 50000, 2000);
const hand = async (id: number) => (await stock.listItems()).find((i) => i.id === id)!.on_hand_milli;

/* ---------- a sale with a 10% discount, partly paid ---------- */

// 20 kg x 7,500 = 150,000 + 10 jar x 3,000 = 30,000 -> 180,000 - 10% = 162,000; paid 100,000 -> owes 62,000
const A = await sales.createSale({
  client_name: "Aso",
  paid: 100000,
  discount: { mode: "percent", value: 10000 },
  lines: [
    { item_id: olives, qty_milli: 20000, unit_price: 7500 },
    { item_id: pickles, qty_milli: 10000, unit_price: 3000 },
  ],
});
eq("value of a returned item = price minus its share of the discount", ret.returnValue(2000, 7500, { total: 162000, discount: 18000 }), 13500);

const r1 = await ret.createReturn({ sale_id: A, lines: [{ item_id: olives, qty_milli: 2000 }] });
eq("return 1: 2 kg olives worth 13,500", [r1.total, r1.lines[0].value, r1.refunded_now], [13500, 13500, 0]);
eq("olives back in stock", await hand(olives), 100000 - 20000 + 2000);
let s = (await sales.getSale(A))!;
eq("the sale itself never changes", [s.total, s.lines.map((l) => l.qty_milli)], [162000, [20000, 10000]]);
eq("what the client owes goes down", [s.returned, s.return_count, s.debt, s.refund_due], [13500, 1, 48500, 0]);
eq("the invoice carries the return", s.returns.map((x) => [x.total, x.lines.map((l) => [l.item_name, l.qty_milli, l.value])]), [[13500, [["Olives", 2000, 13500]]]]);

const able = await ret.getReturnable(A);
eq("what can still come back", able.map((a) => [a.item_name, a.sold_milli, a.returned_milli]), [["Olives", 20000, 2000], ["Pickles", 10000, 0]]);
await throws("cannot return more than sold minus returned", () => ret.createReturn({ sale_id: A, lines: [{ item_id: olives, qty_milli: 18001 }] }), "too much returned");
await throws("an item not on the sale cannot come back", () => ret.createReturn({ sale_id: A, lines: [{ item_id: 999, qty_milli: 1000 }] }), "too much returned");
await throws("nothing to return", () => ret.createReturn({ sale_id: A, lines: [{ item_id: olives, qty_milli: 0 }] }), "no lines");

/* ---------- returning goods the client already paid for ---------- */

// return 10 kg olives (67,500) + 10 jars (27,000) = 94,500; the sale is now worth 162,000 - 13,500 - 94,500 = 54,000,
// the client paid 100,000 -> 46,000 to give back; the owner gives it back now
const r2 = await ret.createReturn({
  sale_id: A,
  refund_now: true,
  lines: [{ item_id: olives, qty_milli: 10000 }, { item_id: pickles, qty_milli: 10000 }],
});
eq("return 2 value and money given back now", [r2.total, r2.refunded_now], [94500, 46000]);
s = (await sales.getSale(A))!;
eq("after giving it back: nothing owed either way", [s.debt, s.refund_due, s.refunded], [0, 0, 46000]);
eq("pickles all back in stock", await hand(pickles), 50000);

const B = await sales.createSale({ client_name: "Shanaz", paid: 30000, lines: [{ item_id: pickles, qty_milli: 10000, unit_price: 3000 }] });
const r3 = await ret.createReturn({ sale_id: B, lines: [{ item_id: pickles, qty_milli: 4000 }] }); // not given back now
eq("not given back now: money to give back shows in Debts", (await debts.listRefundsDue()).map((x) => [x.name, x.due]), [["Shanaz", 12000]]);
const shanaz = await sales.addClient("Shanaz");
const refund = await debts.recordRefund(shanaz, 12000);
eq("given back later from Debts", [refund.amount, (await debts.listRefundsDue()).length], [12000, 0]);
const pay = (await debts.listClientPayments(shanaz)).find((p) => p.kind === "refund")!;
eq("payments of a sale with returns: the refund is listed", pay.amount, 12000);

/* ---------- money-only edits still work, and stop at what came back ---------- */

await sales.updateSale(A, {
  client_name: "Aso", paid: 100000, discount: { mode: "percent", value: 10000 },
  lines: [{ item_id: olives, qty_milli: 20000, unit_price: 7500 }, { item_id: pickles, qty_milli: 10000, unit_price: 3000 }],
  note: "edited after returns",
});
eq("money edit after returns keeps the returns", (await sales.getSale(A))!.returned, 108000);
await throws("edit cannot change quantities (that is a return)", () => sales.updateSale(A, {
  client_name: "Aso", paid: 100000,
  lines: [{ item_id: olives, qty_milli: 8000, unit_price: 7500 }, { item_id: pickles, qty_milli: 10000, unit_price: 3000 }],
}), "lines locked");
await throws("edit cannot make the sale worth less than what came back", () => sales.updateSale(A, {
  client_name: "Aso", paid: 0, discount: { mode: "percent", value: 60000 },
  lines: [{ item_id: olives, qty_milli: 20000, unit_price: 7500 }, { item_id: pickles, qty_milli: 10000, unit_price: 3000 }],
}), "below returned");

// returned goods sold again to someone else: a money edit of the first sale must still work
const D = await sales.createSale({ client_name: "Rawand", paid: 0, lines: [{ item_id: olives, qty_milli: 5000, unit_price: 7500 }] });
const rD = await ret.createReturn({ sale_id: D, lines: [{ item_id: olives, qty_milli: 2000 }] });
const rest = await hand(olives);
await sales.createSale({ client_name: "Other", paid: rest * 7, lines: [{ item_id: olives, qty_milli: rest, unit_price: 7000 }] }); // everything, incl. the 2 kg
await sales.updateSale(D, { client_name: "Rawand", paid: 1000, lines: [{ item_id: olives, qty_milli: 5000, unit_price: 7000 }] });
eq("money edit works although its returned goods were sold again", (await sales.getSale(D))!.total, 35000);
await stock.receive(olives, 50000, 5000); // stock for the tests below

/* ---------- cancelling ---------- */

const olivesBefore = await hand(olives);
await ret.cancelReturn(r1.id);
eq("cancelled return: the 2 kg count as sold again", await hand(olives), olivesBefore - 2000);
eq("cancelled return: the client owes for them again", (await sales.getSale(A))!.debt, 13500);
await ret.cancelReturn(r1.id); // twice is harmless
eq("cancelling twice logs once", (sqlite.prepare("SELECT COUNT(*) n FROM history_log WHERE entity='sale_returns' AND action='cancel'").get() as { n: number }).n, 1);
eq("returns list keeps it, marked", (await ret.listReturns()).map((x) => [x.id, x.cancelled_at !== null]), [[rD.id, false], [r3.id, false], [r2.id, false], [r1.id, true]]);
eq("the sale's own returns list shows only live ones", (await ret.listSaleReturns(A)).map((x) => x.id), [r2.id]);

// a return whose goods were sold again to someone else cannot be cancelled
const left = await hand(pickles);
await sales.createSale({ client_name: "Halmat", paid: left * 3, lines: [{ item_id: pickles, qty_milli: left, unit_price: 3000 }] });
await throws("cannot cancel a return whose goods were sold again", () => ret.cancelReturn(r3.id), "insufficient");

// cancelling the whole sale: its returns no longer count anywhere
const before = await hand(olives);
await sales.cancelSale(A);
eq("cancelled sale: stock = as if nothing was sold (the 10 kg return does not count twice)", await hand(olives), before + 10000);
await throws("no return on a cancelled sale", () => ret.createReturn({ sale_id: A, lines: [{ item_id: olives, qty_milli: 1000 }] }), "not editable");

/* ---------- dashboard: a return lowers sales and profit in its own month ---------- */

const C = await sales.createSale({ client_name: "Karwan", paid: 0, lines: [{ item_id: olives, qty_milli: 10000, unit_price: 8000 }] }); // 80,000, cost 50,000
const prevMid = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15, 12).toISOString();
sqlite.prepare("UPDATE sales SET created_at = ?1 WHERE id = ?2").run(prevMid, C); // the sale was last month
const r4 = await ret.createReturn({ sale_id: C, lines: [{ item_id: olives, qty_milli: 2500 }] }); // 20,000 back this month
const cur = await getDashboard(currentMonth());
const prev = await getDashboard(shiftMonth(currentMonth(), -1));
eq("last month keeps its sale", [prev.sales, prev.cogs], [80000, 50000]);
const liveThisMonth = (sqlite.prepare(
  "SELECT COALESCE(SUM(total),0) n FROM sales WHERE rev >= 1 AND cancelled_at IS NULL AND created_at >= ?1",
).get(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()) as { n: number }).n;
// returns made this month on live sales: r3 (Shanaz, 12,000), rD (Rawand, 15,000) and r4 (Karwan, 20,000); r2 belongs to the cancelled sale A
eq("this month: its sales minus the returns made this month", cur.sales, liveThisMonth - r3.total - rD.total - r4.total);
eq("trend: the returns show in this month's bar", cur.trend[5].total, liveThisMonth - r3.total - rD.total - r4.total);
const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
const costSold = (sqlite.prepare(
  `SELECT COALESCE(SUM(ROUND(l.qty_milli * l.buy_price / 1000.0)),0) n FROM sale_lines l JOIN sales s ON s.id = l.sale_id AND l.rev = s.rev
    WHERE s.rev >= 1 AND s.cancelled_at IS NULL AND s.created_at >= ?1`,
).get(monthStart) as { n: number }).n;
eq("cost of goods: this month's sales minus the cost of what came back (4 jars x 2,000 + 2 kg + 2.5 kg x 5,000)", cur.cogs, costSold - 8000 - 10000 - 12500);

finish();
