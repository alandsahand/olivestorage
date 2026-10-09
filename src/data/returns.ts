import { getDb } from "../db";
import { getSale, moneyOf } from "./sales";
import { onHand } from "./stock";

// Returns of sold goods (docs/flow.md section 8, migration 012_sale_returns.sql). A return takes goods back
// from one sale: stock goes up, what the client owes goes down by what the goods were worth (their price minus
// their share of the sale's discount). Money he already paid beyond that becomes money to give back, which can be
// given back at once (a refund row linked to the return).

/** One item of a sale and how much of it can still come back. */
export type Returnable = {
  item_id: number;
  item_name: string;
  unit_name: string;
  sold_milli: number;
  returned_milli: number; // by earlier live returns
  unit_price: number;
  buy_price: number;
};

export type ReturnInput = { sale_id: number; lines: { item_id: number; qty_milli: number }[]; refund_now?: boolean };

export type ReturnLine = { item_id: number; item_name: string; unit_name: string; qty_milli: number; unit_price: number; value: number };
export type SaleReturn = {
  id: number;
  sale_id: number;
  client_name: string;
  client_phone: string | null;
  total: number;
  refunded_now: number; // money given back at the moment of the return (not cancelled)
  created_at: string;
  cancelled_at: string | null;
  lines: ReturnLine[];
};

const now = () => new Date().toISOString();

async function log(entity_id: number, action: string, details: unknown) {
  const db = await getDb();
  await db.execute("INSERT INTO history_log (entity, entity_id, action, details, created_at) VALUES ('sale_returns',$1,$2,$3,$4)", [
    entity_id,
    action,
    JSON.stringify(details),
    now(),
  ]);
}

/** Share of the price the client really pays after the sale's discount (1 = no discount). */
const keepRatio = (s: { total: number; discount: number }) => (s.total + s.discount > 0 ? s.total / (s.total + s.discount) : 1);

/** What `qty_milli` of a line priced `unit_price` is worth on this sale (its share of the discount taken off). */
export const returnValue = (qty_milli: number, unit_price: number, s: { total: number; discount: number }) =>
  Math.round(((qty_milli * unit_price) / 1000) * keepRatio(s));

/** The items of a live sale with what was sold and what already came back. */
export async function getReturnable(sale_id: number): Promise<Returnable[]> {
  const sale = await getSale(sale_id);
  if (!sale || sale.cancelled_at) return [];
  const db = await getDb();
  const back = await db.select<{ item_id: number; q: number }[]>(
    `SELECT rl.item_id, SUM(rl.qty_milli) AS q FROM sale_return_lines rl JOIN sale_returns r ON r.id = rl.return_id
      WHERE r.sale_id = $1 AND r.active = 1 AND r.cancelled_at IS NULL GROUP BY rl.item_id`,
    [sale_id],
  );
  const byItem = new Map<number, Returnable>();
  for (const l of sale.lines) {
    const cur = byItem.get(l.item_id);
    if (cur) {
      // the same item twice on one sale: one row, priced at the average of the two lines
      const sold = cur.sold_milli + l.qty_milli;
      cur.unit_price = Math.round((cur.unit_price * cur.sold_milli + l.unit_price * l.qty_milli) / sold);
      cur.sold_milli = sold;
    } else {
      byItem.set(l.item_id, {
        item_id: l.item_id,
        item_name: l.item_name,
        unit_name: l.unit_name,
        sold_milli: l.qty_milli,
        returned_milli: 0,
        unit_price: l.unit_price,
        buy_price: l.buy_price,
      });
    }
  }
  for (const b of back) {
    const r = byItem.get(b.item_id);
    if (r) r.returned_milli = b.q;
  }
  return [...byItem.values()];
}

/** Saves a return. Returns it (for the return slip). */
export async function createReturn(input: ReturnInput): Promise<SaleReturn> {
  const sale = await getSale(input.sale_id);
  if (!sale || sale.cancelled_at) throw new Error("not editable");
  const items = await getReturnable(input.sale_id);
  const lines: (Returnable & { qty_milli: number; value: number })[] = [];
  for (const l of input.lines) {
    if (!Number.isInteger(l.qty_milli) || l.qty_milli < 0) throw new Error("invalid amount");
    if (l.qty_milli === 0) continue;
    const it = items.find((i) => i.item_id === l.item_id);
    if (!it || l.qty_milli > it.sold_milli - it.returned_milli) throw new Error("too much returned");
    lines.push({ ...it, qty_milli: l.qty_milli, value: returnValue(l.qty_milli, it.unit_price, sale) });
  }
  if (!lines.length) throw new Error("no lines");
  // never give back more than the sale is still worth (rounding of the discount share)
  const total = Math.min(
    lines.reduce((s, l) => s + l.value, 0),
    sale.total - sale.returned,
  );

  const db = await getDb();
  const at = now();
  const res = await db.execute("INSERT INTO sale_returns (sale_id, total, active, created_at) VALUES ($1,$2,0,$3)", [input.sale_id, total, at]);
  const id = res.lastInsertId as number;
  try {
    for (const l of lines) {
      await db.execute(
        "INSERT INTO sale_return_lines (return_id, item_id, qty_milli, unit_price, buy_price, value) VALUES ($1,$2,$3,$4,$5,$6)",
        [id, l.item_id, l.qty_milli, l.unit_price, l.buy_price, l.value],
      );
    }
    // the return counts from here on (lines first, then this single flip)
    const done = await db.execute("UPDATE sale_returns SET active = 1 WHERE id = $1 AND active = 0", [id]);
    if (!done.rowsAffected) throw new Error("conflict");
  } catch (e) {
    await db.execute("DELETE FROM sale_return_lines WHERE return_id = $1", [id]);
    await db.execute("DELETE FROM sale_returns WHERE id = $1 AND active = 0", [id]);
    throw e;
  }

  // Money the client paid beyond what the sale is now worth: give it back now if the owner says so.
  let refunded_now = 0;
  if (input.refund_now) {
    const after = moneyOf({ ...sale, returned: sale.returned + total });
    refunded_now = Math.min(after.refund_due, total);
    if (refunded_now > 0) {
      await db.execute("INSERT INTO payments (sale_id, kind, amount, created_at, return_id) VALUES ($1,'refund',$2,$3,$4)", [
        input.sale_id,
        refunded_now,
        at,
        id,
      ]);
    }
  }
  await log(id, "create", { sale_id: input.sale_id, total, refunded_now, lines: lines.map((l) => ({ item_id: l.item_id, qty_milli: l.qty_milli, value: l.value })) });
  return (await getReturn(id)) as SaleReturn;
}

const RETURN_COLS = `r.id, r.sale_id, c.name AS client_name, c.phone AS client_phone, r.total, r.created_at, r.cancelled_at,
       COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.return_id = r.id AND p.kind = 'refund' AND p.cancelled_at IS NULL), 0) AS refunded_now`;

async function withLines(rows: Omit<SaleReturn, "lines">[]): Promise<SaleReturn[]> {
  const db = await getDb();
  const out: SaleReturn[] = [];
  for (const r of rows) {
    const lines = await db.select<ReturnLine[]>(
      `SELECT rl.item_id, i.name AS item_name, u.name AS unit_name, rl.qty_milli, rl.unit_price, rl.value
         FROM sale_return_lines rl JOIN items i ON i.id = rl.item_id JOIN units u ON u.id = i.unit_id
        WHERE rl.return_id = $1 ORDER BY rl.id`,
      [r.id],
    );
    out.push({ ...r, lines });
  }
  return out;
}

export async function getReturn(id: number): Promise<SaleReturn | null> {
  const db = await getDb();
  const rows = await db.select<Omit<SaleReturn, "lines">[]>(
    `SELECT ${RETURN_COLS} FROM sale_returns r JOIN sales s ON s.id = r.sale_id JOIN clients c ON c.id = s.client_id
      WHERE r.id = $1 AND r.active = 1`,
    [id],
  );
  return rows.length ? (await withLines(rows))[0] : null;
}

/** All returns, newest first (cancelled ones too, marked). The screen asks for one more row than it shows. */
export async function listReturns(limit = 1_000_000): Promise<SaleReturn[]> {
  const db = await getDb();
  const rows = await db.select<Omit<SaleReturn, "lines">[]>(
    `SELECT ${RETURN_COLS} FROM sale_returns r JOIN sales s ON s.id = r.sale_id JOIN clients c ON c.id = s.client_id
      WHERE r.active = 1 ORDER BY r.created_at DESC, r.id DESC LIMIT $1`,
    [limit],
  );
  return withLines(rows);
}

/** The live returns of one sale, oldest first (shown under its row in the sales list). */
export async function listSaleReturns(sale_id: number): Promise<SaleReturn[]> {
  const db = await getDb();
  const rows = await db.select<Omit<SaleReturn, "lines">[]>(
    `SELECT ${RETURN_COLS} FROM sale_returns r JOIN sales s ON s.id = r.sale_id JOIN clients c ON c.id = s.client_id
      WHERE r.sale_id = $1 AND r.active = 1 AND r.cancelled_at IS NULL ORDER BY r.created_at, r.id`,
    [sale_id],
  );
  return withLines(rows);
}

/** Cancels a return: the goods count as sold again, so it is refused if that stock was sold to someone else. */
export async function cancelReturn(id: number): Promise<void> {
  const r = await getReturn(id);
  if (!r || r.cancelled_at) return;
  const qty = new Map<number, number>();
  for (const l of r.lines) qty.set(l.item_id, (qty.get(l.item_id) ?? 0) + l.qty_milli);
  for (const [item_id, q] of qty) {
    if ((await onHand(item_id)) - q < 0) throw new Error("insufficient");
  }
  const db = await getDb();
  const res = await db.execute("UPDATE sale_returns SET cancelled_at = $1 WHERE id = $2 AND cancelled_at IS NULL", [now(), id]);
  if (res.rowsAffected) await log(id, "cancel", { sale_id: r.sale_id, total: r.total });
}
