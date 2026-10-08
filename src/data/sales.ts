import { getDb } from "../db";
import { lastBuyPrice, onHand } from "./stock";

export type LineInput = { item_id: number; qty_milli: number; unit_price: number };
export type SaleInput = { client_name: string; lines: LineInput[]; paid: number };

export type Sale = {
  id: number;
  client_id: number;
  client_name: string;
  total: number;
  paid: number; // paid at the moment of sale
  later_paid: number; // payments recorded afterwards (non-cancelled)
  refunded: number; // money given back after cancellation
  debt: number; // 0 for cancelled sales
  refund_due: number; // > 0 only for cancelled sales that were (partly) paid
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

export type SaleDetail = Sale & { lines: SaleLine[] };

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

export type Client = { id: number; name: string };

export async function listClients(): Promise<Client[]> {
  const db = await getDb();
  return db.select<Client[]>("SELECT id, name FROM clients ORDER BY name");
}

/** Finds the client by name (case-insensitive) or creates it. */
export async function addClient(rawName: string): Promise<number> {
  const name = rawName.trim();
  if (!name) throw new Error("name required");
  const db = await getDb();
  const found = await db.select<{ id: number }[]>("SELECT id FROM clients WHERE name = $1 COLLATE NOCASE", [name]);
  if (found.length) return found[0].id;
  const res = await db.execute("INSERT INTO clients (name, created_at) VALUES ($1,$2)", [name, now()]);
  return res.lastInsertId as number;
}

/* ---------- validation shared by create and edit ---------- */

type Prepared = { lines: (LineInput & { buy_price: number; line_total: number })[]; total: number };

async function prepare(
  input: SaleInput,
  excludeSaleId: number,
  keepBuyPrice: Map<number, number>,
  laterPaid = 0,
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
  for (const [item_id, qty] of perItem) {
    if (qty > (await onHand(item_id, excludeSaleId))) throw new Error("insufficient");
  }

  const lines: Prepared["lines"] = [];
  for (const l of input.lines) {
    // A line keeps its original cost when edited; a new item gets today's last buy price.
    const buy = keepBuyPrice.get(l.item_id) ?? (await lastBuyPrice(l.item_id));
    if (buy === null) throw new Error("insufficient");
    lines.push({ ...l, buy_price: buy, line_total: lineTotal(l.qty_milli, l.unit_price) });
  }
  const total = lines.reduce((s, l) => s + l.line_total, 0);
  if (input.paid + laterPaid > total) throw new Error("overpaid");
  return { lines, total };
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

export async function createSale(input: SaleInput): Promise<number> {
  const { lines, total } = await prepare(input, 0, new Map());
  const client_id = await addClient(input.client_name);
  const db = await getDb();
  // rev 0 = not visible yet. The sale only counts once the final UPDATE flips it to rev 1.
  const res = await db.execute(
    "INSERT INTO sales (client_id, total, paid, rev, created_at) VALUES ($1,$2,$3,0,$4)",
    [client_id, total, input.paid, now()],
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
  await log(id, "create", { client: input.client_name.trim(), total, paid: input.paid, lines });
  return id;
}

export async function updateSale(id: number, input: SaleInput): Promise<void> {
  const db = await getDb();
  const cur = await getSale(id);
  if (!cur || cur.cancelled_at) throw new Error("not editable");
  const keep = new Map<number, number>();
  for (const l of cur.lines) if (!keep.has(l.item_id)) keep.set(l.item_id, l.buy_price);

  const { lines, total } = await prepare(input, id, keep, cur.later_paid);
  const client_id = await addClient(input.client_name);
  const newRev = cur.rev + 1;
  await db.execute("DELETE FROM sale_lines WHERE sale_id = $1 AND rev > $2", [id, cur.rev]); // leftovers of a failed edit
  try {
    await insertLines(id, newRev, lines);
    const done = await db.execute(
      "UPDATE sales SET rev = $1, client_id = $2, total = $3, paid = $4 WHERE id = $5 AND rev = $6 AND cancelled_at IS NULL",
      [newRev, client_id, total, input.paid, id, cur.rev],
    );
    if (!done.rowsAffected) throw new Error("conflict");
  } catch (e) {
    await db.execute("DELETE FROM sale_lines WHERE sale_id = $1 AND rev > $2", [id, cur.rev]);
    throw e;
  }
  await log(id, "update", {
    from: { client: cur.client_name, total: cur.total, paid: cur.paid, lines: cur.lines },
    to: { client: input.client_name.trim(), total, paid: input.paid, lines },
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

type SaleRow = Omit<Sale, "debt" | "refund_due">;

/** Money position of one sale: debt while active, refund due once cancelled. */
export function shape(r: SaleRow): Sale {
  const received = r.paid + r.later_paid;
  return {
    ...r,
    debt: r.cancelled_at ? 0 : r.total - received,
    refund_due: r.cancelled_at ? received - r.refunded : 0,
  };
}

const SALE_COLS = `s.id, s.client_id, c.name AS client_name, s.total, s.paid,
       ${PAY_SUM("payment")} AS later_paid, ${PAY_SUM("refund")} AS refunded,
       s.rev, s.created_at, s.cancelled_at,
       (SELECT COUNT(*) FROM sale_lines l WHERE l.sale_id = s.id AND l.rev = s.rev) AS line_count`;

export async function listSales(limit = 200): Promise<Sale[]> {
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
  return { ...shape(rows[0]), lines };
}
