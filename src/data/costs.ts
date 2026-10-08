import { getDb } from "../db";

export const COST_KINDS = ["electricity", "workers", "place"] as const;
export type CostKind = (typeof COST_KINDS)[number];
export type MonthCosts = Record<CostKind, number>;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const zero = (): MonthCosts => ({ electricity: 0, workers: 0, place: 0 });

function checkMonth(month: string) {
  if (!MONTH_RE.test(month)) throw new Error("invalid month");
}

export async function getMonthCosts(month: string): Promise<MonthCosts> {
  checkMonth(month);
  const db = await getDb();
  const rows = await db.select<{ kind: CostKind; amount: number }[]>(
    "SELECT kind, amount FROM monthly_costs WHERE month = $1",
    [month],
  );
  const out = zero();
  for (const r of rows) out[r.kind] = r.amount;
  return out;
}

/** All twelve months of a year ("YYYY"), keyed by month number 1..12. Months never saved are all zero. */
export async function getYearCosts(year: number): Promise<Record<number, MonthCosts>> {
  const db = await getDb();
  const rows = await db.select<{ month: string; kind: CostKind; amount: number }[]>(
    "SELECT month, kind, amount FROM monthly_costs WHERE month LIKE $1",
    [`${year}-%`],
  );
  const out: Record<number, MonthCosts> = {};
  for (let m = 1; m <= 12; m++) out[m] = zero();
  for (const r of rows) out[Number(r.month.slice(5))][r.kind] = r.amount;
  return out;
}

export const monthTotal = (c: MonthCosts) => c.electricity + c.workers + c.place;

/** Saves all three amounts of a month in ONE statement (all or nothing) and logs what changed. */
export async function saveMonthCosts(month: string, next: MonthCosts): Promise<boolean> {
  checkMonth(month);
  for (const k of COST_KINDS) {
    if (!Number.isInteger(next[k]) || next[k] < 0) throw new Error("invalid amount");
  }
  const before = await getMonthCosts(month);
  const changed = COST_KINDS.filter((k) => before[k] !== next[k]);
  if (changed.length === 0) return false;

  const db = await getDb();
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO monthly_costs (month, kind, amount, updated_at)
     VALUES ($1,'electricity',$2,$5), ($1,'workers',$3,$5), ($1,'place',$4,$5)
     ON CONFLICT (month, kind) DO UPDATE SET amount = excluded.amount, updated_at = excluded.updated_at`,
    [month, next.electricity, next.workers, next.place, now],
  );
  await db.execute(
    "INSERT INTO history_log (entity, entity_id, action, details, created_at) VALUES ('monthly_costs', NULL, 'update', $1, $2)",
    [JSON.stringify({ month, from: before, to: next, changed }), now],
  );
  return true;
}
