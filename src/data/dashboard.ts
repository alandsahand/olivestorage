import { getDb } from "../db";
import { listItems } from "./stock";
import { listDebtors, listRefundsDue } from "./debts";
import { listSupplierDebts } from "./purchases";
import { getMonthCosts, monthTotal } from "./costs";
import { monthOf, monthRange, shiftMonth } from "../lib/months";

export type Dashboard = {
  month: string;
  sales: number; // sales made in the month (cancelled sales excluded)
  cogs: number; // what the sold goods cost us (buy price at the time of each sale)
  gross: number; // sales - cogs
  costs: number; // electricity + workers + place of the month
  net: number; // gross - costs
  // "now" figures, not tied to the month:
  stockValue: number; // goods on hand x last buy price
  debt: number;
  debtors: number;
  refundsDue: number;
  supplierDebt: number; // what we still owe suppliers
  suppliersOwed: number;
  trend: { month: string; total: number }[]; // last 6 months ending at `month`
  best: { item_id: number; name: string; total: number }[];
};

const LIVE = `s.rev >= 1 AND s.cancelled_at IS NULL`;
// live returns of live sales (a return lowers sales and profit in the month the goods came back)
const LIVE_RETURN = `r.active = 1 AND r.cancelled_at IS NULL AND ${LIVE}`;

export async function getDashboard(month: string): Promise<Dashboard> {
  const db = await getDb();
  const [start, end] = monthRange(month);

  const [money] = await db.select<{ sales: number; cogs: number }[]>(
    // line totals are before the invoice discount: the discounts of those sales are taken off below
    `SELECT COALESCE(SUM(l.line_total), 0) AS sales,
            COALESCE(SUM(ROUND(l.qty_milli * l.buy_price / 1000.0)), 0) AS cogs
       FROM sale_lines l JOIN sales s ON s.id = l.sale_id AND l.rev = s.rev
      WHERE ${LIVE} AND s.created_at >= $1 AND s.created_at < $2`,
    [start, end],
  );

  const [disc] = await db.select<{ d: number }[]>(
    `SELECT COALESCE(SUM(s.discount), 0) AS d FROM sales s WHERE ${LIVE} AND s.created_at >= $1 AND s.created_at < $2`,
    [start, end],
  );
  money.sales -= disc.d;

  const [back] = await db.select<{ value: number; cost: number }[]>(
    `SELECT COALESCE((SELECT SUM(r.total) FROM sale_returns r JOIN sales s ON s.id = r.sale_id
                        WHERE ${LIVE_RETURN} AND r.created_at >= $1 AND r.created_at < $2), 0) AS value,
            COALESCE((SELECT SUM(ROUND(rl.qty_milli * rl.buy_price / 1000.0)) FROM sale_return_lines rl
                        JOIN sale_returns r ON r.id = rl.return_id JOIN sales s ON s.id = r.sale_id
                        WHERE ${LIVE_RETURN} AND r.created_at >= $1 AND r.created_at < $2), 0) AS cost`,
    [start, end],
  );
  money.sales -= back.value;
  money.cogs -= back.cost;

  // per item, before the invoice discount; goods that came back this month are taken off at their price
  const best = await db.select<Dashboard["best"]>(
    `SELECT i.id AS item_id, i.name, SUM(x.v) AS total FROM (
        SELECT l.item_id, l.line_total AS v
          FROM sale_lines l JOIN sales s ON s.id = l.sale_id AND l.rev = s.rev
         WHERE ${LIVE} AND s.created_at >= $1 AND s.created_at < $2
        UNION ALL
        SELECT rl.item_id, -ROUND(rl.qty_milli * rl.unit_price / 1000.0)
          FROM sale_return_lines rl JOIN sale_returns r ON r.id = rl.return_id JOIN sales s ON s.id = r.sale_id
         WHERE ${LIVE_RETURN} AND r.created_at >= $1 AND r.created_at < $2
      ) x JOIN items i ON i.id = x.item_id
      GROUP BY i.id HAVING SUM(x.v) > 0 ORDER BY total DESC, i.name LIMIT 5`,
    [start, end],
  );

  // Last six months (local calendar months), grouped in JS because the database stores UTC timestamps.
  const first = shiftMonth(month, -5);
  const rows = await db.select<{ created_at: string; total: number }[]>(
    `SELECT s.created_at, s.total FROM sales s WHERE ${LIVE} AND s.created_at >= $1 AND s.created_at < $2
     UNION ALL
     SELECT r.created_at, -r.total FROM sale_returns r JOIN sales s ON s.id = r.sale_id
      WHERE ${LIVE_RETURN} AND r.created_at >= $1 AND r.created_at < $2`,
    [monthRange(first)[0], end],
  );
  const byMonth = new Map<string, number>();
  for (const r of rows) byMonth.set(monthOf(r.created_at), (byMonth.get(monthOf(r.created_at)) ?? 0) + r.total);
  const trend = Array.from({ length: 6 }, (_, k) => {
    const m = shiftMonth(first, k);
    return { month: m, total: byMonth.get(m) ?? 0 };
  });

  const items = await listItems();
  const stockValue = items.reduce(
    (s, i) => (i.on_hand_milli > 0 && i.last_buy_price ? s + Math.round((i.on_hand_milli * i.last_buy_price) / 1000) : s),
    0,
  );
  const [debtors, refunds, costs, suppliers] = await Promise.all([listDebtors(), listRefundsDue(), getMonthCosts(month), listSupplierDebts()]);

  const costTotal = monthTotal(costs);
  const gross = money.sales - money.cogs;
  return {
    month,
    sales: money.sales,
    cogs: money.cogs,
    gross,
    costs: costTotal,
    net: gross - costTotal,
    stockValue,
    debt: debtors.reduce((s, d) => s + d.debt, 0),
    debtors: debtors.length,
    refundsDue: refunds.reduce((s, r) => s + r.due, 0),
    supplierDebt: suppliers.reduce((s, x) => s + x.debt, 0),
    suppliersOwed: suppliers.length,
    trend,
    best,
  };
}
