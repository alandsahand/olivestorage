// Run: npm test — discount on a whole sale, typed as an amount or a percent (owner request 2026-10-10).
import { eq, finish, freshDb, throws } from "./testkit.ts";
freshDb();
import * as stock from "../src/data/stock.ts";
import * as sales from "../src/data/sales.ts";
import * as debts from "../src/data/debts.ts";
import { getDashboard } from "../src/data/dashboard.ts";
import { currentMonth } from "../src/lib/months.ts";

/* ---------- the math ---------- */

eq("amount: taken off as typed", sales.discountAmount(150000, { mode: "amount", value: 5000 }), 5000);
eq("percent: 10% of 150,000", sales.discountAmount(150000, { mode: "percent", value: 10000 }), 15000);
eq("percent with decimals: 2.5% of 99,999 rounds to a whole dinar", sales.discountAmount(99999, { mode: "percent", value: 2500 }), 2500);
eq("no discount", [sales.discountAmount(1000, null), sales.discountAmount(1000, { mode: "amount", value: 0 })], [0, 0]);

/* ---------- saving ---------- */

const kg = await stock.addUnit("kg");
const olives = await stock.saveItem({ name: "Olives", category_id: null, unit_id: kg, default_sell_price: 7500 });
await stock.receive(olives, 100000, 5000);
const line = (kgs: number, price = 7500) => [{ item_id: olives, qty_milli: kgs * 1000, unit_price: price }];

const a = await sales.createSale({ client_name: "Aso", paid: 0, lines: line(20), discount: { mode: "percent", value: 10000 } });
let s = (await sales.getSale(a))!;
eq("10% off 150,000: total 135,000, discount 15,000, percent kept", [s.total, s.discount, s.discount_pct_milli], [135000, 15000, 10000]);
eq("the debt is on the total after the discount", s.debt, 135000);

const b = await sales.createSale({ client_name: "Shanaz", paid: 70000, lines: line(10), discount: { mode: "amount", value: 5000 } });
s = (await sales.getSale(b))!;
eq("5,000 off 75,000 paid 70,000: fully paid", [s.total, s.discount, s.discount_pct_milli, s.debt], [70000, 5000, null, 0]);

await throws("discount bigger than the subtotal is refused", () =>
  sales.createSale({ client_name: "X", paid: 0, lines: line(1), discount: { mode: "amount", value: 7501 } }), "invalid discount");
await throws("more than 100% is refused", () =>
  sales.createSale({ client_name: "X", paid: 0, lines: line(1), discount: { mode: "percent", value: 100001 } }), "invalid discount");
await throws("paying more than the total after the discount is refused", () =>
  sales.createSale({ client_name: "X", paid: 7000, lines: line(1), discount: { mode: "amount", value: 1000 } }), "overpaid");
const free = await sales.createSale({ client_name: "Gift", paid: 0, lines: line(1), discount: { mode: "percent", value: 100000 } });
eq("100% is allowed: total 0", (await sales.getSale(free))!.total, 0);

/* ---------- editing ---------- */

await sales.updateSale(a, { client_name: "Aso", paid: 0, lines: line(20, 8000), discount: { mode: "percent", value: 10000 } });
s = (await sales.getSale(a))!;
eq("edit: the percent follows the new subtotal (20 kg at 8,000: 160,000 - 16,000)", [s.total, s.discount], [144000, 16000]);
await sales.updateSale(a, { client_name: "Aso", paid: 0, lines: line(20, 8000), discount: null });
s = (await sales.getSale(a))!;
eq("edit: the discount can be removed", [s.total, s.discount, s.discount_pct_milli], [160000, 0, null]);
await sales.updateSale(a, { client_name: "Aso", paid: 0, lines: line(20, 8000), discount: { mode: "amount", value: 25000 } });
const aso = await sales.addClient("Aso");
await debts.recordPayment(aso, 100000);
await throws("edit cannot discount below what was already received", () =>
  sales.updateSale(a, { client_name: "Aso", paid: 0, lines: line(20, 8000), discount: { mode: "amount", value: 100000 } }), "overpaid");

/* ---------- debts, statement, dashboard ---------- */

eq("debts list uses the total after the discount", (await debts.listDebtors()).find((d) => d.name === "Aso")!.debt, 135000 - 100000);
eq("statement too", (await debts.getStatement(aso)).total_debt, 35000);
const dash = await getDashboard(currentMonth());
eq("dashboard sales = what was really charged (135,000 + 70,000 + 0)", dash.sales, 205000);
eq("cost of goods does not change with a discount (31 kg x 5,000)", dash.cogs, 155000);
eq("gross profit = sales - cost", dash.gross, 50000);
eq("best sellers stay per item before the invoice discount", dash.best[0].total, 20 * 8000 + 10 * 7500 + 7500);

finish();
