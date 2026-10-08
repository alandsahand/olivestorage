import { getDb } from "../db";
import { listItems } from "./stock";
import { listDebtors, listRefundsDue } from "./debts";
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
  trend: { month: string; total: number }[]; // last 6 months ending at `month`
  best: { item_id: number; name: string; total: number }[];
};

const LIVE = `s.rev >= 1 AND s.cancelled_at IS NULL`;

export async function getDashboard(month: string): Promise<Dashboard> {
  const db = await getDb();
  const [start, end] = monthRange(month);

  const [money] = await db.select<{ sales: number; cogs: number }[]>(
    `SELECT COALESCE(SUM(l.line_total), 0) AS sales,
            COALESCE(SUM(ROUND(l.qty_milli * l.buy_price / 1000.0)), 0) AS cogs
       FROM sale_lines l JOIN sales s ON s.id = l.sale_id AND l.rev = s.rev
      WHERE ${LIVE} AND s.created_at >= $1 AND s.created_at < $2`,
    [start, end],
  );

  const best = await db.select<Dashboard["best"]>(
    `SELECT i.id AS item_id, i.name, SUM(l.line_total) AS total
       FROM sale_lines l JOIN sales s ON s.id = l.sale_id AND l.rev = s.rev JOIN items i ON i.id = l.item_id
      WHERE ${LIVE} AND s.created_at >= $1 AND s.created_at < $2
      GROUP BY i.id ORDER BY total DESC, i.name LIMIT 5`,
    [start, end],
  );

  // Last six months (local calendar months), grouped in JS because the database stores UTC timestamps.
  const first = shiftMonth(month, -5);
  const rows = await db.select<{ created_at: string; total: number }[]>(
    `SELECT s.created_at, s.total FROM sales s WHERE ${LIVE} AND s.created_at >= $1 AND s.created_at < $2`,
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
  const [debtors, refunds, costs] = await Promise.all([listDebtors(), listRefundsDue(), getMonthCosts(month)]);

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
    trend,
    best,
  };
}
