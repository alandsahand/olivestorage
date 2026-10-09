import { getDb } from "../db";
import { lastBuyPrice, onHand } from "./stock";

export type LineInput = { item_id: number; qty_milli: number; unit_price: number };
/** A discount on the whole sale: an amount in whole dinars, or a percent in thousandths (10% = 10000). */
export type DiscountInput = { mode: "amount" | "percent"; value: number };
export type SaleInput = {
  client_name: string;
  client_phone?: string;
  lines: LineInput[];
  paid: number;
  note?: string;
  discount?: DiscountInput | null;
};

/** Dinars taken off a subtotal (a percent is rounded to the nearest dinar). */
export function discountAmount(subtotal: number, d: DiscountInput | null | undefined): number {
  if (!d || !(d.value > 0)) return 0;
  return d.mode === "percent" ? Math.round((subtotal * d.value) / 100_000) : d.value;
}

export type Sale = {
  id: number;
  client_id: number;
  client_name: string;
  client_phone: string | null;
  total: number;
  paid: number; // paid at the moment of sale
  discount: number; // dinars taken off the whole sale (total is AFTER the discount; subtotal = total + discount)
  discount_pct_milli: number | null; // the percent as typed, null when typed as an amount
  note: string | null; // optional text printed on the invoice
  later_paid: number; // payments recorded afterwards (non-cancelled)
  refunded: number; // money given back (cancelled sale, or a return the client had already paid for)
  returned: number; // what the live returns of this sale are worth
  return_count: number;
  debt: number; // what the client still owes (0 for cancelled sales)
  refund_due: number; // money still to give back: a cancelled sale that was paid, or a return of goods already paid for
  rev: number;
  created_at: string;
  cancelled_at: string | null;
  line_count: number;
};

export type SaleLine = {
  id: number;
  item_id: number;
  item_name: string;
  unit_name: string;
  qty_milli: number;
  unit_price: number;
  buy_price: number;
  line_total: number;
};

/** A return as printed on the invoice. */
export type SaleReturnInfo = {
  id: number;
  created_at: string;
  total: number;
  lines: { item_name: string; unit_name: string; qty_milli: number; value: number }[];
};
export type SaleDetail = Sale & { lines: SaleLine[]; returns: SaleReturnInfo[] };

const now = () => new Date().toISOString();

/** Money for one line, rounded to a whole dinar. qty is in thousandths. */
export const lineTotal = (qty_milli: number, unit_price: number) => Math.round((qty_milli * unit_price) / 1000);

async function log(entity_id: number, action: string, details: unknown) {
  const db = await getDb();
  await db.execute(
    "INSERT INTO history_log (entity, entity_id, action, details, created_at) VALUES ('sales',$1,$2,$3,$4)",
    [entity_id, action, JSON.stringify(details), now()],
  );
}

/* ---------- clients ---------- */

export type Client = { id: number; name: string; phone: string | null };

export async function listClients(): Promise<Client[]> {
  const db = await getDb();
  return db.select<Client[]>("SELECT id, name, phone FROM clients ORDER BY name");
}

/** Finds the client by name (case-insensitive) or creates it. A phone number typed now replaces the stored one. */
export async function addClient(rawName: string, rawPhone?: string): Promise<number> {
  const name = rawName.trim();
  if (!name) throw new Error("name required");
  const phone = (rawPhone ?? "").trim().slice(0, 40) || null;
  const db = await getDb();
  const found = await db.select<{ id: number; phone: string | null }[]>("SELECT id, phone FROM clients WHERE name = $1 COLLATE NOCASE", [name]);
  if (found.length) {
    if (phone && phone !== found[0].phone) {
      await db.execute("UPDATE clients SET phone = $1 WHERE id = $2", [phone, found[0].id]);
      await db.execute(
        "INSERT INTO history_log (entity, entity_id, action, details, created_at) VALUES ('clients',$1,'phone',$2,$3)",
        [found[0].id, JSON.stringify({ from: found[0].phone, to: phone }), now()],
      );
    }
    return found[0].id;
  }
  const res = await db.execute("INSERT INTO clients (name, phone, created_at) VALUES ($1,$2,$3)", [name, phone, now()]);
  return res.lastInsertId as number;
}

/* ---------- validation shared by create and edit ---------- */

type Prepared = {
  lines: (LineInput & { buy_price: number; line_total: number })[];
  total: number; // after the discount
  discount: number;
  discount_pct_milli: number | null;
};

async function prepare(
  input: SaleInput,
  excludeSaleId: number,
  keepBuyPrice: Map<number, number>,
  laterPaid = 0,
  checkStock = true, // an edit never changes quantities, so it has nothing to check
): Promise<Prepared> {
  if (!input.client_name.trim()) throw new Error("client required");
  if (!input.lines.length) throw new Error("no lines");
  if (!Number.isInteger(input.paid) || input.paid < 0) throw new Error("invalid amount");

  const perItem = new Map<number, number>();
  for (const l of input.lines) {
    if (!Number.isInteger(l.qty_milli) || l.qty_milli <= 0) throw new Error("invalid amount");
    if (!Number.isInteger(l.unit_price) || l.unit_price <= 0) throw new Error("invalid amount");
    perItem.set(l.item_id, (perItem.get(l.item_id) ?? 0) + l.qty_milli);
  }
  for (const [item_id, qty] of checkStock ? perItem : []) {
    if (qty > (await onHand(item_id, excludeSaleId))) throw new Error("insufficient");
  }

  const lines: Prepared["lines"] = [];
  for (const l of input.lines) {
    // A line keeps its original cost when edited; a new item gets today's last buy price.
    const buy = keepBuyPrice.get(l.item_id) ?? (await lastBuyPrice(l.item_id));
    if (buy === null) throw new Error("insufficient");
    lines.push({ ...l, buy_price: buy, line_total: lineTotal(l.qty_milli, l.unit_price) });
  }
  const subtotal = lines.reduce((s, l) => s + l.line_total, 0);
  const d = input.discount ?? null;
  if (d && (!Number.isInteger(d.value) || d.value < 0 || (d.mode === "percent" && d.value > 100_000))) throw new Error("invalid discount");
  const discount = discountAmount(subtotal, d);
  if (discount > subtotal) throw new Error("invalid discount");
  const total = subtotal - discount;
  if (input.paid + laterPaid > total) throw new Error("overpaid");
  return { lines, total, discount, discount_pct_milli: d?.mode === "percent" && discount > 0 ? d.value : null };
}

async function insertLines(sale_id: number, rev: number, lines: Prepared["lines"]) {
  const db = await getDb();
  for (const l of lines) {
    await db.execute(
      "INSERT INTO sale_lines (sale_id, rev, item_id, qty_milli, unit_price, buy_price, line_total) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [sale_id, rev, l.item_id, l.qty_milli, l.unit_price, l.buy_price, l.line_total],
    );
  }
}

/* ---------- create / edit / cancel ---------- */

/** Empty or whitespace-only notes are stored as "no note"; very long ones are cut to 500 characters. */
export const cleanNote = (raw?: string): string | null => {
  const t = (raw ?? "").trim();
  return t ? t.slice(0, 500) : null;
};

export async function createSale(input: SaleInput): Promise<number> {
  const { lines, total, discount, discount_pct_milli } = await prepare(input, 0, new Map());
  const client_id = await addClient(input.client_name, input.client_phone);
  const db = await getDb();
  // rev 0 = not visible yet. The sale only counts once the final UPDATE flips it to rev 1.
  const res = await db.execute(
    "INSERT INTO sales (client_id, total, paid, note, discount, discount_pct_milli, rev, created_at) VALUES ($1,$2,$3,$4,$5,$6,0,$7)",
    [client_id, total, input.paid, cleanNote(input.note), discount, discount_pct_milli, now()],
  );
  const id = res.lastInsertId as number;
  try {
    await insertLines(id, 1, lines);
    const done = await db.execute("UPDATE sales SET rev = 1 WHERE id = $1 AND rev = 0", [id]);
    if (!done.rowsAffected) throw new Error("conflict");
  } catch (e) {
    await db.execute("DELETE FROM sale_lines WHERE sale_id = $1", [id]);
    await db.execute("DELETE FROM sales WHERE id = $1 AND rev = 0", [id]);
    throw e;
  }
  await log(id, "create", { client: input.client_name.trim(), total, discount, paid: input.paid, lines });
  return id;
}

export async function updateSale(id: number, input: SaleInput): Promise<void> {
  const db = await getDb();
  const cur = await getSale(id);
  if (!cur || cur.cancelled_at) throw new Error("not editable");
  const keep = new Map<number, number>();
  for (const l of cur.lines) if (!keep.has(l.item_id)) keep.set(l.item_id, l.buy_price);

  // Money only (owner, 2026-10-10): items and quantities of a saved sale never change; goods coming back are a return.
  const qtyOf = (ls: { item_id: number; qty_milli: number }[]) => {
    const m = new Map<number, number>();
    for (const l of ls) m.set(l.item_id, (m.get(l.item_id) ?? 0) + l.qty_milli);
    return m;
  };
  const before = qtyOf(cur.lines);
  const after = qtyOf(input.lines);
  if (before.size !== after.size || [...before].some(([item, q]) => after.get(item) !== q)) throw new Error("lines locked");

  const { lines, total, discount, discount_pct_milli } = await prepare(input, id, keep, cur.later_paid - cur.refunded, false);
  if (total < cur.returned) throw new Error("below returned");
  const client_id = await addClient(input.client_name, input.client_phone);
  const newRev = cur.rev + 1;
  await db.execute("DELETE FROM sale_lines WHERE sale_id = $1 AND rev > $2", [id, cur.rev]); // leftovers of a failed edit
  try {
    await insertLines(id, newRev, lines);
    const done = await db.execute(
      "UPDATE sales SET rev = $1, client_id = $2, total = $3, paid = $4, note = $5, discount = $6, discount_pct_milli = $7 WHERE id = $8 AND rev = $9 AND cancelled_at IS NULL",
      [newRev, client_id, total, input.paid, cleanNote(input.note), discount, discount_pct_milli, id, cur.rev],
    );
    if (!done.rowsAffected) throw new Error("conflict");
  } catch (e) {
    await db.execute("DELETE FROM sale_lines WHERE sale_id = $1 AND rev > $2", [id, cur.rev]);
    throw e;
  }
  await log(id, "update", {
    from: { client: cur.client_name, total: cur.total, discount: cur.discount, paid: cur.paid, note: cur.note, lines: cur.lines },
    to: { client: input.client_name.trim(), total, discount, paid: input.paid, note: cleanNote(input.note), lines },
  });
}

export async function cancelSale(id: number): Promise<void> {
  const db = await getDb();
  const res = await db.execute(
    "UPDATE sales SET cancelled_at = $1 WHERE id = $2 AND cancelled_at IS NULL AND rev >= 1",
    [now(), id],
  );
  if (res.rowsAffected) await log(id, "cancel", {});
}

/* ---------- reading ---------- */

export const PAY_SUM = (kind: "payment" | "refund") =>
  `COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.sale_id = s.id AND p.kind = '${kind}' AND p.cancelled_at IS NULL), 0)`;

/** What the live returns of sale `s` are worth. */
export const RETURNED_SUM = `COALESCE((SELECT SUM(r.total) FROM sale_returns r WHERE r.sale_id = s.id AND r.active = 1 AND r.cancelled_at IS NULL), 0)`;

type SaleRow = Omit<Sale, "debt" | "refund_due">;

/**
 * Money position of one sale. kept = what the client has paid and kept (paid now + later payments - refunds);
 * worth = what the goods he kept are worth (total - returns).
 * Active sale: owes worth - kept, or is owed kept - worth (he paid for goods he brought back).
 * Cancelled sale: owes nothing, is owed everything he kept.
 */
export function moneyOf(r: { total: number; paid: number; later_paid: number; refunded: number; returned: number; cancelled_at: string | null }) {
  const kept = r.paid + r.later_paid - r.refunded;
  if (r.cancelled_at) return { debt: 0, refund_due: kept };
  const worth = r.total - r.returned;
  return { debt: Math.max(0, worth - kept), refund_due: Math.max(0, kept - worth) };
}

export function shape(r: SaleRow): Sale {
  return { ...r, ...moneyOf(r) };
}

const SALE_COLS = `s.id, s.client_id, c.name AS client_name, c.phone AS client_phone, s.total, s.paid, s.note, s.discount, s.discount_pct_milli,
       ${PAY_SUM("payment")} AS later_paid, ${PAY_SUM("refund")} AS refunded, ${RETURNED_SUM} AS returned,
       (SELECT COUNT(*) FROM sale_returns r WHERE r.sale_id = s.id AND r.active = 1 AND r.cancelled_at IS NULL) AS return_count,
       s.rev, s.created_at, s.cancelled_at,
       (SELECT COUNT(*) FROM sale_lines l WHERE l.sale_id = s.id AND l.rev = s.rev) AS line_count`;

/** Newest sales first. Callers page through the list by raising `limit` (ask for one extra row to know if more exist). */
export async function listSales(limit = 1_000_000): Promise<Sale[]> {
  const db = await getDb();
  const rows = await db.select<SaleRow[]>(
    `SELECT ${SALE_COLS} FROM sales s JOIN clients c ON c.id = s.client_id
      WHERE s.rev >= 1 ORDER BY s.created_at DESC, s.id DESC LIMIT $1`,
    [limit],
  );
  return rows.map(shape);
}

export async function getSale(id: number): Promise<SaleDetail | null> {
  const db = await getDb();
  const rows = await db.select<SaleRow[]>(
    `SELECT ${SALE_COLS} FROM sales s JOIN clients c ON c.id = s.client_id WHERE s.id = $1 AND s.rev >= 1`,
    [id],
  );
  if (!rows.length) return null;
  const lines = await db.select<SaleLine[]>(
    `SELECT l.id, l.item_id, i.name AS item_name, u.name AS unit_name, l.qty_milli, l.unit_price, l.buy_price, l.line_total
       FROM sale_lines l
       JOIN sales s ON s.id = l.sale_id AND l.rev = s.rev
       JOIN items i ON i.id = l.item_id
       JOIN units u ON u.id = i.unit_id
      WHERE l.sale_id = $1 ORDER BY l.id`,
    [id],
  );
  const heads = await db.select<Omit<SaleReturnInfo, "lines">[]>(
    "SELECT id, created_at, total FROM sale_returns WHERE sale_id = $1 AND active = 1 AND cancelled_at IS NULL ORDER BY created_at, id",
    [id],
  );
  const returns: SaleReturnInfo[] = [];
  for (const h of heads) {
    const rl = await db.select<SaleReturnInfo["lines"]>(
      `SELECT i.name AS item_name, u.name AS unit_name, rl.qty_milli, rl.value
         FROM sale_return_lines rl JOIN items i ON i.id = rl.item_id JOIN units u ON u.id = i.unit_id
        WHERE rl.return_id = $1 ORDER BY rl.id`,
      [h.id],
    );
    returns.push({ ...h, lines: rl });
  }
  return { ...shape(rows[0]), lines, returns };
}
