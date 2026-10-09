import { getDb } from "../db";
import { onHand } from "./stock";
import { splitCosts } from "../lib/purchaseMath";

// Purchases (see 008_purchases.sql): one order = several items + extra costs, from one supplier.
// Each item line is a stock_in row whose buy_price is the REAL unit cost (paid + equal share of the extra costs,
// or the price the owner typed). What is not paid to the supplier is our debt to the supplier.

/** qty_milli = what goes into stock (store unit). `buy` = what was really bought when the item is bought in another unit. */
export type PurchaseLineInput = {
  item_id: number;
  qty_milli: number;
  paid: number;
  fixed_unit: number | null;
  buy?: { unit_id: number; qty_milli: number } | null;
};
export type ExtraInput = { name: string; amount: number };
export type PurchaseInput = {
  supplier_name: string;
  supplier_phone?: string;
  lines: PurchaseLineInput[];
  extras: ExtraInput[];
  paid: number; // paid to the supplier now
  note?: string;
};

export type Supplier = { id: number; name: string; phone: string | null };

export type Purchase = {
  id: number;
  supplier_id: number | null;
  supplier_name: string | null;
  supplier_phone: string | null;
  total: number;
  paid: number; // paid when the purchase was made
  later_paid: number; // paid to the supplier afterwards (non-cancelled)
  refunded: number; // given back by the supplier after cancelling
  debt: number; // we still owe (0 when cancelled)
  refund_due: number; // the supplier must give back (only for cancelled purchases)
  note: string | null;
  rev: number;
  created_at: string;
  cancelled_at: string | null;
  line_count: number;
};

export type PurchaseLine = {
  id: number;
  item_id: number;
  item_name: string;
  unit_name: string;
  qty_milli: number;
  line_paid: number;
  cost_total: number;
  buy_price: number; // real unit cost (per store unit)
  price_fixed: number; // 1 = typed by the owner
  buy_unit_id: number | null; // bought in another unit: which one and how much
  buy_unit_name: string | null;
  buy_qty_milli: number | null;
};
export type PurchaseExtra = { id: number; name: string; amount: number };
export type PurchaseDetail = Purchase & { lines: PurchaseLine[]; extras: PurchaseExtra[] };

const now = () => new Date().toISOString();

async function log(entity: string, entity_id: number | null, action: string, details: unknown) {
  const db = await getDb();
  await db.execute("INSERT INTO history_log (entity, entity_id, action, details, created_at) VALUES ($1,$2,$3,$4,$5)", [
    entity,
    entity_id,
    action,
    JSON.stringify(details),
    now(),
  ]);
}

const clean = (raw: string | undefined, max: number): string | null => {
  const t = (raw ?? "").trim();
  return t ? t.slice(0, max) : null;
};

/* ---------- suppliers ---------- */

export async function listSuppliers(): Promise<Supplier[]> {
  const db = await getDb();
  return db.select<Supplier[]>("SELECT id, name, phone FROM suppliers ORDER BY name");
}

/** Finds the supplier by name (case-insensitive) or creates it. A phone number typed now replaces the stored one. */
export async function addSupplier(rawName: string, rawPhone?: string): Promise<number> {
  const name = rawName.trim();
  if (!name) throw new Error("name required");
  const phone = clean(rawPhone, 40);
  const db = await getDb();
  const found = await db.select<Supplier[]>("SELECT id, name, phone FROM suppliers WHERE name = $1 COLLATE NOCASE", [name]);
  if (found.length) {
    if (phone && phone !== found[0].phone) {
      await db.execute("UPDATE suppliers SET phone = $1 WHERE id = $2", [phone, found[0].id]);
      await log("suppliers", found[0].id, "phone", { from: found[0].phone, to: phone });
    }
    return found[0].id;
  }
  const res = await db.execute("INSERT INTO suppliers (name, phone, created_at) VALUES ($1,$2,$3)", [name, phone, now()]);
  const id = res.lastInsertId as number;
  await log("suppliers", id, "create", { name, phone });
  return id;
}

/* ---------- validation shared by create and edit ---------- */

type Prepared = {
  lines: (PurchaseLineInput & { cost_total: number; unit_price: number })[];
  extras: ExtraInput[];
  total: number;
};

function prepare(input: PurchaseInput, laterPaid: number): Prepared {
  if (!input.lines.length) throw new Error("no lines");
  for (const l of input.lines) {
    if (!Number.isInteger(l.qty_milli) || l.qty_milli <= 0) throw new Error("invalid amount");
    if (!Number.isInteger(l.paid) || l.paid <= 0) throw new Error("invalid amount");
    if (l.fixed_unit !== null && (!Number.isInteger(l.fixed_unit) || l.fixed_unit <= 0)) throw new Error("invalid amount");
    if (l.buy && (!Number.isInteger(l.buy.unit_id) || !Number.isInteger(l.buy.qty_milli) || l.buy.qty_milli <= 0)) throw new Error("invalid amount");
  }
  const extras: ExtraInput[] = [];
  for (const x of input.extras) {
    if (!Number.isInteger(x.amount) || x.amount < 0) throw new Error("invalid amount");
    if (x.amount > 0) extras.push({ name: x.name.trim().slice(0, 60) || "-", amount: x.amount });
  }
  // a single line carries everything: its price can't be fixed to something else
  const lines = input.lines.length === 1 ? [{ ...input.lines[0], fixed_unit: null }] : input.lines;
  const split = splitCosts(lines, extras.reduce((s, x) => s + x.amount, 0));
  if (split.problem) throw new Error(split.problem === "mismatch" ? "split mismatch" : "split too low");

  if (!Number.isInteger(input.paid) || input.paid < 0) throw new Error("invalid amount");
  if (input.paid + laterPaid > split.total) throw new Error("overpaid");
  if (input.paid + laterPaid < split.total && !input.supplier_name.trim()) throw new Error("supplier required");
  return { lines: lines.map((l, k) => ({ ...l, ...split.lines[k] })), extras, total: split.total };
}

async function insertRows(purchase_id: number, rev: number, created_at: string, p: Prepared) {
  const db = await getDb();
  for (const l of p.lines) {
    // created_at = the purchase's date (also after an edit), so "last buy price" keeps the real order of purchases
    await db.execute(
      `INSERT INTO stock_in (item_id, qty_milli, buy_price, created_at, purchase_id, purchase_rev, line_paid, cost_total, price_fixed, buy_unit_id, buy_qty_milli)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        l.item_id, l.qty_milli, l.unit_price, created_at, purchase_id, rev, l.paid, l.cost_total, l.fixed_unit !== null ? 1 : 0,
        l.buy?.unit_id ?? null, l.buy?.qty_milli ?? null,
      ],
    );
  }
  for (const x of p.extras) {
    await db.execute("INSERT INTO purchase_extras (purchase_id, rev, name, amount) VALUES ($1,$2,$3,$4)", [purchase_id, rev, x.name, x.amount]);
  }
}

async function dropRowsAbove(purchase_id: number, rev: number) {
  const db = await getDb();
  await db.execute("DELETE FROM stock_in WHERE purchase_id = $1 AND purchase_rev > $2", [purchase_id, rev]);
  await db.execute("DELETE FROM purchase_extras WHERE purchase_id = $1 AND rev > $2", [purchase_id, rev]);
}

/* ---------- create / edit / cancel ---------- */

export async function createPurchase(input: PurchaseInput): Promise<number> {
  const p = prepare(input, 0);
  const supplier_id = input.supplier_name.trim() ? await addSupplier(input.supplier_name, input.supplier_phone) : null;
  const db = await getDb();
  const at = now();
  // rev 0 = not visible yet; the purchase (and its stock) only counts once the final UPDATE flips it to rev 1
  const res = await db.execute("INSERT INTO purchases (supplier_id, total, paid, note, rev, created_at) VALUES ($1,$2,$3,$4,0,$5)", [
    supplier_id,
    p.total,
    input.paid,
    clean(input.note, 500),
    at,
  ]);
  const id = res.lastInsertId as number;
  try {
    await insertRows(id, 1, at, p);
    const done = await db.execute("UPDATE purchases SET rev = 1 WHERE id = $1 AND rev = 0", [id]);
    if (!done.rowsAffected) throw new Error("conflict");
  } catch (e) {
    await dropRowsAbove(id, 0);
    await db.execute("DELETE FROM purchases WHERE id = $1 AND rev = 0", [id]);
    throw e;
  }
  await log("purchases", id, "create", { supplier: input.supplier_name.trim(), total: p.total, paid: input.paid, lines: p.lines, extras: p.extras });
  return id;
}

/** Quantity per item of a purchase's current lines. */
const qtyByItem = (lines: { item_id: number; qty_milli: number }[]) => {
  const m = new Map<number, number>();
  for (const l of lines) m.set(l.item_id, (m.get(l.item_id) ?? 0) + l.qty_milli);
  return m;
};

export async function updatePurchase(id: number, input: PurchaseInput): Promise<void> {
  const cur = await getPurchase(id);
  if (!cur || cur.cancelled_at) throw new Error("not editable");
  const p = prepare(input, cur.later_paid);
  // Stock must never go below what was already sold: on hand - this purchase's old lines + its new lines >= 0.
  const before = qtyByItem(cur.lines);
  const after = qtyByItem(p.lines);
  for (const item_id of new Set([...before.keys(), ...after.keys()])) {
    if ((await onHand(item_id)) - (before.get(item_id) ?? 0) + (after.get(item_id) ?? 0) < 0) throw new Error("sold");
  }
  const supplier_id = input.supplier_name.trim() ? await addSupplier(input.supplier_name, input.supplier_phone) : null;
  const db = await getDb();
  const newRev = cur.rev + 1;
  await dropRowsAbove(id, cur.rev); // leftovers of a failed edit
  try {
    await insertRows(id, newRev, cur.created_at, p);
    const done = await db.execute(
      "UPDATE purchases SET rev = $1, supplier_id = $2, total = $3, paid = $4, note = $5 WHERE id = $6 AND rev = $7 AND cancelled_at IS NULL",
      [newRev, supplier_id, p.total, input.paid, clean(input.note, 500), id, cur.rev],
    );
    if (!done.rowsAffected) throw new Error("conflict");
  } catch (e) {
    await dropRowsAbove(id, cur.rev);
    throw e;
  }
  await log("purchases", id, "update", {
    from: { supplier: cur.supplier_name, total: cur.total, paid: cur.paid, lines: cur.lines, extras: cur.extras },
    to: { supplier: input.supplier_name.trim(), total: p.total, paid: input.paid, lines: p.lines, extras: p.extras },
  });
}

/** Cancels a purchase: its goods leave the stock, so it is refused once some of them were sold. */
export async function cancelPurchase(id: number): Promise<void> {
  const cur = await getPurchase(id);
  if (!cur || cur.cancelled_at) return;
  for (const [item_id, qty] of qtyByItem(cur.lines)) {
    if ((await onHand(item_id)) - qty < 0) throw new Error("sold");
  }
  const db = await getDb();
  const res = await db.execute("UPDATE purchases SET cancelled_at = $1 WHERE id = $2 AND cancelled_at IS NULL AND rev >= 1", [now(), id]);
  if (res.rowsAffected) await log("purchases", id, "cancel", {});
}

/* ---------- reading ---------- */

const SPAY_SUM = (kind: "payment" | "refund") =>
  `COALESCE((SELECT SUM(sp.amount) FROM supplier_payments sp WHERE sp.purchase_id = pu.id AND sp.kind = '${kind}' AND sp.cancelled_at IS NULL), 0)`;

const PURCHASE_COLS = `pu.id, pu.supplier_id, su.name AS supplier_name, su.phone AS supplier_phone, pu.total, pu.paid, pu.note,
       ${SPAY_SUM("payment")} AS later_paid, ${SPAY_SUM("refund")} AS refunded, pu.rev, pu.created_at, pu.cancelled_at,
       (SELECT COUNT(*) FROM stock_in l WHERE l.purchase_id = pu.id AND l.purchase_rev = pu.rev) AS line_count`;

type PurchaseRow = Omit<Purchase, "debt" | "refund_due">;
const shape = (r: PurchaseRow): Purchase => {
  const given = r.paid + r.later_paid;
  return { ...r, debt: r.cancelled_at ? 0 : r.total - given, refund_due: r.cancelled_at ? given - r.refunded : 0 };
};

/** Newest first. The screen pages through it by asking for one row more than it shows. */
export async function listPurchases(limit = 1_000_000): Promise<Purchase[]> {
  const db = await getDb();
  const rows = await db.select<PurchaseRow[]>(
    `SELECT ${PURCHASE_COLS} FROM purchases pu LEFT JOIN suppliers su ON su.id = pu.supplier_id
      WHERE pu.rev >= 1 ORDER BY pu.created_at DESC, pu.id DESC LIMIT $1`,
    [limit],
  );
  return rows.map(shape);
}

export async function getPurchase(id: number): Promise<PurchaseDetail | null> {
  const db = await getDb();
  const rows = await db.select<PurchaseRow[]>(
    `SELECT ${PURCHASE_COLS} FROM purchases pu LEFT JOIN suppliers su ON su.id = pu.supplier_id WHERE pu.id = $1 AND pu.rev >= 1`,
    [id],
  );
  if (!rows.length) return null;
  const head = shape(rows[0]);
  const lines = await db.select<PurchaseLine[]>(
    `SELECT l.id, l.item_id, i.name AS item_name, u.name AS unit_name, l.qty_milli, l.line_paid, l.cost_total, l.buy_price, l.price_fixed,
            l.buy_unit_id, bu.name AS buy_unit_name, l.buy_qty_milli
       FROM stock_in l JOIN items i ON i.id = l.item_id JOIN units u ON u.id = i.unit_id LEFT JOIN units bu ON bu.id = l.buy_unit_id
      WHERE l.purchase_id = $1 AND l.purchase_rev = $2 ORDER BY l.id`,
    [id, head.rev],
  );
  const extras = await db.select<PurchaseExtra[]>(
    "SELECT id, name, amount FROM purchase_extras WHERE purchase_id = $1 AND rev = $2 ORDER BY id",
    [id, head.rev],
  );
  return { ...head, lines, extras };
}

/* ---------- what we owe suppliers ---------- */

export type SupplierDebt = {
  supplier_id: number;
  name: string;
  phone: string | null;
  debt: number;
  last_purchase_at: string;
  purchase_ids: string; // the purchases we still owe on, "2,5" (for searching by purchase number)
};
export type SupplierRefundDue = { supplier_id: number; name: string; phone: string | null; due: number };
export type SupplierPaymentRow = {
  id: number;
  purchase_id: number;
  kind: "payment" | "refund";
  amount: number;
  created_at: string;
  cancelled_at: string | null;
};

const OWED = `(pu.total - pu.paid - ${SPAY_SUM("payment")})`;
const BACK = `(pu.paid + ${SPAY_SUM("payment")} - ${SPAY_SUM("refund")})`;

/** Suppliers we owe money to, biggest debt first. */
export async function listSupplierDebts(): Promise<SupplierDebt[]> {
  const db = await getDb();
  return db.select<SupplierDebt[]>(
    `SELECT su.id AS supplier_id, su.name, su.phone, SUM(${OWED}) AS debt, MAX(pu.created_at) AS last_purchase_at,
            COALESCE(GROUP_CONCAT(CASE WHEN ${OWED} > 0 THEN pu.id END), '') AS purchase_ids
       FROM purchases pu JOIN suppliers su ON su.id = pu.supplier_id
      WHERE pu.rev >= 1 AND pu.cancelled_at IS NULL
      GROUP BY su.id
     HAVING SUM(${OWED}) > 0
      ORDER BY debt DESC, su.name`,
  );
}

/** Suppliers who must give money back (we paid for purchases that were later cancelled). */
export async function listSupplierRefundsDue(): Promise<SupplierRefundDue[]> {
  const db = await getDb();
  return db.select<SupplierRefundDue[]>(
    `SELECT su.id AS supplier_id, su.name, su.phone, SUM(${BACK}) AS due
       FROM purchases pu JOIN suppliers su ON su.id = pu.supplier_id
      WHERE pu.rev >= 1 AND pu.cancelled_at IS NOT NULL
      GROUP BY su.id
     HAVING SUM(${BACK}) > 0
      ORDER BY due DESC, su.name`,
  );
}

/** A supplier's purchases with their money position, oldest first. */
export async function listSupplierPurchases(supplier_id: number): Promise<Purchase[]> {
  const db = await getDb();
  const rows = await db.select<PurchaseRow[]>(
    `SELECT ${PURCHASE_COLS} FROM purchases pu LEFT JOIN suppliers su ON su.id = pu.supplier_id
      WHERE pu.supplier_id = $1 AND pu.rev >= 1 ORDER BY pu.created_at, pu.id`,
    [supplier_id],
  );
  return rows.map(shape);
}

export async function listSupplierPayments(supplier_id: number): Promise<SupplierPaymentRow[]> {
  const db = await getDb();
  return db.select<SupplierPaymentRow[]>(
    `SELECT sp.id, sp.purchase_id, sp.kind, sp.amount, sp.created_at, sp.cancelled_at
       FROM supplier_payments sp JOIN purchases pu ON pu.id = sp.purchase_id
      WHERE pu.supplier_id = $1 ORDER BY sp.created_at DESC, sp.id DESC`,
    [supplier_id],
  );
}

/** Spreads `amount` over the given purchases, oldest first, one row per purchase (all rows share one time). */
/** What a printed supplier voucher shows: money we paid a supplier ("payment") or money he gave back ("refund").
 *  `remaining` = what we still owe him after a payment; null when unknown (refunds, reprints of old ones). */
export type SupplierVoucher = {
  no: number;
  kind: "payment" | "refund";
  supplier_name: string;
  supplier_phone: string | null;
  created_at: string;
  amount: number;
  purchase_ids: number[];
  remaining: number | null;
};

async function supplierOf(supplier_id: number): Promise<{ supplier_name: string; supplier_phone: string | null }> {
  const db = await getDb();
  const rows = await db.select<{ name: string; phone: string | null }[]>("SELECT name, phone FROM suppliers WHERE id = $1", [supplier_id]);
  return { supplier_name: rows[0]?.name ?? "", supplier_phone: rows[0]?.phone ?? null };
}

async function allocate(
  kind: "payment" | "refund",
  supplier_id: number,
  amount: number,
  rows: { id: number; room: number }[],
): Promise<{ no: number; created_at: string; purchase_ids: number[] }> {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("invalid amount");
  if (amount > rows.reduce((s, x) => s + x.room, 0)) throw new Error("overpaid");
  const db = await getDb();
  const at = now();
  let left = amount;
  let first = 0;
  const parts: { purchase_id: number; amount: number }[] = [];
  for (const r of rows) {
    if (left <= 0) break;
    const part = Math.min(left, r.room);
    if (part <= 0) continue;
    const res = await db.execute("INSERT INTO supplier_payments (purchase_id, kind, amount, created_at) VALUES ($1,$2,$3,$4)", [r.id, kind, part, at]);
    if (!first) first = res.lastInsertId as number;
    parts.push({ purchase_id: r.id, amount: part });
    left -= part;
  }
  await log("supplier_payments", supplier_id, kind, { supplier_id, amount, parts });
  return { no: first, created_at: at, purchase_ids: parts.map((x) => x.purchase_id) };
}

/** We pay a supplier: goes to the oldest unpaid purchase first. */
export async function recordSupplierPayment(supplier_id: number, amount: number): Promise<SupplierVoucher> {
  const all = await listSupplierPurchases(supplier_id);
  const rows = all.filter((p) => p.debt > 0).map((p) => ({ id: p.id, room: p.debt }));
  const v = await allocate("payment", supplier_id, amount, rows);
  const remaining = all.reduce((s, p) => s + p.debt, 0) - amount;
  return { ...v, kind: "payment", amount, ...(await supplierOf(supplier_id)), remaining };
}

/** A supplier gives money back for cancelled purchases, oldest first. */
export async function recordSupplierRefund(supplier_id: number, amount: number): Promise<SupplierVoucher> {
  const rows = (await listSupplierPurchases(supplier_id))
    .filter((p) => p.refund_due > 0)
    .map((p) => ({ id: p.id, room: p.refund_due }));
  const v = await allocate("refund", supplier_id, amount, rows);
  return { ...v, kind: "refund", amount, ...(await supplierOf(supplier_id)), remaining: null } satisfies SupplierVoucher;
}

/** Voucher for an earlier payment/refund: all of its rows (same kind and time), reprinted from the supplier's history. */
export function voucherFromRows(
  supplier: { name: string; phone: string | null },
  row: SupplierPaymentRow,
  rows: SupplierPaymentRow[],
): SupplierVoucher {
  const group = rows.filter((p) => !p.cancelled_at && p.kind === row.kind && p.created_at === row.created_at);
  return {
    no: Math.min(...group.map((p) => p.id)),
    kind: row.kind,
    supplier_name: supplier.name,
    supplier_phone: supplier.phone,
    created_at: row.created_at,
    amount: group.reduce((s, p) => s + p.amount, 0),
    purchase_ids: group.map((p) => p.purchase_id),
    remaining: null,
  };
}

/** What we owe one supplier: the purchases still open, the total and when we last paid him. */
export type SupplierStatement = {
  supplier_name: string;
  supplier_phone: string | null;
  created_at: string;
  purchases: { id: number; created_at: string; total: number; given: number; debt: number }[];
  total_debt: number;
  last_payment_at: string | null;
};

export async function getSupplierStatement(supplier_id: number): Promise<SupplierStatement> {
  const [all, pays, who] = await Promise.all([listSupplierPurchases(supplier_id), listSupplierPayments(supplier_id), supplierOf(supplier_id)]);
  const open = all.filter((p) => p.debt > 0);
  return {
    ...who,
    created_at: now(),
    purchases: open.map((p) => ({ id: p.id, created_at: p.created_at, total: p.total, given: p.paid + p.later_paid, debt: p.debt })),
    total_debt: open.reduce((s, p) => s + p.debt, 0),
    // listSupplierPayments is newest first
    last_payment_at: pays.find((p) => p.kind === "payment" && !p.cancelled_at)?.created_at ?? null,
  };
}

/** Cancels a supplier payment or refund (the row stays, marked cancelled). */
export async function voidSupplierPayment(id: number) {
  const db = await getDb();
  const rows = await db.select<(SupplierPaymentRow & { purchase_cancelled_at: string | null; paid: number; given: number; back: number })[]>(
    `SELECT sp.*, pu.cancelled_at AS purchase_cancelled_at, pu.paid,
            ${SPAY_SUM("payment")} AS given, ${SPAY_SUM("refund")} AS back
       FROM supplier_payments sp JOIN purchases pu ON pu.id = sp.purchase_id WHERE sp.id = $1`,
    [id],
  );
  const p = rows[0];
  if (!p) throw new Error("not found");
  if (p.cancelled_at) return;
  // Taking back a payment on a cancelled purchase must not leave the supplier having returned more than we paid.
  if (p.kind === "payment" && p.purchase_cancelled_at && p.paid + p.given - p.amount < p.back) throw new Error("refunded");
  await db.execute("UPDATE supplier_payments SET cancelled_at = $1 WHERE id = $2 AND cancelled_at IS NULL", [now(), id]);
  await log("supplier_payments", id, "cancel", { kind: p.kind, amount: p.amount, purchase_id: p.purchase_id });
}
