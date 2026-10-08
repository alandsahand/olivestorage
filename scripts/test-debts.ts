// Run: npm test — debts, later payments, cancelled sales and refunds. Every dinar must balance.
import { eq, finish, freshDb, throws } from "./testkit.ts";
const sqlite = freshDb();
import * as stock from "../src/data/stock.ts";
import * as sales from "../src/data/sales.ts";
import * as debts from "../src/data/debts.ts";

const kg = await stock.addUnit("kg");
const item = await stock.saveItem({ name: "Olives", category_id: null, unit_id: kg, default_sell_price: 1000 });
await stock.receive(item, 1000000, 500); // plenty of stock

const sell = (client: string, kgAmount: number, paid: number) =>
  sales.createSale({ client_name: client, paid, lines: [{ item_id: item, qty_milli: kgAmount * 1000, unit_price: 1000 }] });

const A = await sell("Aso", 100, 20000); // total 100,000, owes 80,000
const B = await sell("Aso", 50, 0); // total 50,000, owes 50,000
await sell("Shanaz", 30, 30000); // paid in full
const aso = (await sales.addClient("Aso")) as number;

let d = await debts.listDebtors();
eq("only clients with debt are listed", d.map((x) => [x.name, x.debt, x.sale_count]), [["Aso", 130000, 2]]);

// pay 90,000: oldest sale first (A 80,000, then B 10,000)
await debts.recordPayment(aso, 90000);
eq("payment goes to the oldest sale first", (await debts.listClientPayments(aso)).reverse().map((p) => [p.sale_id, p.amount]), [[A, 80000], [B, 10000]]);
eq("debt after payment", (await debts.listDebtors())[0].debt, 40000);
eq("sale A fully paid", (await sales.getSale(A))!.debt, 0);
eq("sale B still owes", (await sales.getSale(B))!.debt, 40000);
await throws("cannot pay more than owed", () => debts.recordPayment(aso, 40001), "overpaid");
await throws("zero payment refused", () => debts.recordPayment(aso, 0), "invalid amount");
await throws("fractional payment refused", () => debts.recordPayment(aso, 10.5), "invalid amount");

// take back the 10,000 on B
const lastB = (await debts.listClientPayments(aso)).find((p) => p.sale_id === B)!;
await debts.voidPayment(lastB.id);
eq("cancelled payment brings the debt back", (await debts.listDebtors())[0].debt, 50000);
await debts.voidPayment(lastB.id); // twice is harmless
eq("cancelling twice changes nothing", (await debts.listDebtors())[0].debt, 50000);

// editing a sale cannot make it cheaper than what was already received
await throws("edit below received money is refused", () => sales.updateSale(A, { client_name: "Aso", paid: 20000, lines: [{ item_id: item, qty_milli: 60000, unit_price: 1000 }] }), "overpaid");
await sales.updateSale(A, { client_name: "Aso", paid: 20000, lines: [{ item_id: item, qty_milli: 100000, unit_price: 1000 }] });
eq("edit with later payments keeps them", (await sales.getSale(A))!.later_paid, 80000);

// cancel A: client already paid 100,000 -> we owe him that back
await sales.cancelSale(A);
eq("cancelled sale no longer counts as debt", (await debts.listDebtors())[0].debt, 50000);
eq("refund due appears", (await debts.listRefundsDue()).map((x) => [x.name, x.due]), [["Aso", 100000]]);
eq("sale list shows refund due", (await sales.getSale(A))!.refund_due, 100000);

await debts.recordRefund(aso, 40000);
eq("partial refund", (await debts.listRefundsDue())[0].due, 60000);
await throws("cannot refund more than due", () => debts.recordRefund(aso, 60001), "overpaid");
await throws("no refund on a client with nothing due", async () => debts.recordRefund(await sales.addClient("Shanaz"), 1), "overpaid");

// cannot take back a payment if that would mean refunding more than we received
const payA = (await debts.listClientPayments(aso)).find((p) => p.sale_id === A && p.kind === "payment")!;
await throws("cannot cancel payment already refunded", () => debts.voidPayment(payA.id), "insufficient");
const refundRow = (await debts.listClientPayments(aso)).find((p) => p.kind === "refund")!;
await debts.voidPayment(refundRow.id);
eq("cancelled refund restores refund due", (await debts.listRefundsDue())[0].due, 100000);
await debts.recordRefund(aso, 100000);
eq("fully refunded: nothing due", (await debts.listRefundsDue()).length, 0);

// ---- balance: money in - money out == (active totals) - (active debts) + (nothing owed back)
const row = sqlite.prepare(`
  SELECT
    (SELECT COALESCE(SUM(paid),0) FROM sales WHERE rev>=1)
  + (SELECT COALESCE(SUM(amount),0) FROM payments WHERE kind='payment' AND cancelled_at IS NULL)
  - (SELECT COALESCE(SUM(amount),0) FROM payments WHERE kind='refund' AND cancelled_at IS NULL) AS cash,
    (SELECT COALESCE(SUM(total),0) FROM sales WHERE rev>=1 AND cancelled_at IS NULL) AS sold
`).get() as { cash: number; sold: number };
const debtNow = (await debts.listDebtors()).reduce((s, x) => s + x.debt, 0);
eq("cash in hand = money sold - money still owed to us", row.cash, row.sold - debtNow);

finish();
