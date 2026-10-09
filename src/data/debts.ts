import { getDb } from "../db";
import { PAY_SUM, RETURNED_SUM, moneyOf } from "./sales";

export type Debtor = {
  client_id: number;
  name: string;
  phone: string | null;
  debt: number;
  sale_count: number;
  last_sale_at: string;
  sale_ids: string; // the sales that still owe, "3,7,12" (for searching by sale number)
};
export type RefundDue = { client_id: number; name: string; phone: string | null; due: number };

export type ClientSale = {
  id: number;
  total: number;
  paid: number;
  later_paid: number;
  refunded: number;
  returned: number; // what the live returns of this sale are worth
  created_at: string;
  cancelled_at: string | null;
  debt: number;
  refund_due: number;
};

export type PaymentRow = {
  id: number;
  sale_id: number;
  kind: "payment" | "refund";
  amount: number;
  created_at: string;
  cancelled_at: string | null;
};

const now = () => new Date().toISOString();

/** What a printed receipt (وصل قبض / وصل صرف) shows. `remaining` = the client's debt after this payment; null when unknown (old records). */
export type Receipt = {
  no: number;
  kind: "payment" | "refund";
  client_name: string;
  client_phone: string | null;
  created_at: string;
  amount: number;
  sale_ids: number[];
  remaining: number | null;
};

async function log(entity_id: number | null, action: string, details: unknown) {
  const db = await getDb();
  await db.execute(
    "INSERT INTO history_log (entity, entity_id, action, details, created_at) VALUES ('payments',$1,$2,$3,$4)",
    [entity_id, action, JSON.stringify(details), now()],
  );
}

// "Owed" of an active sale = total - paid at sale - later payments.
// Same rules as moneyOf() in sales.ts. KEPT = what the client paid and kept; WORTH = the sale minus its returns.
const KEPT = `(s.paid + ${PAY_SUM("payment")} - ${PAY_SUM("refund")})`;
const WORTH = `(s.total - ${RETURNED_SUM})`;
// What an active sale still owes (never below zero: one sale's money to give back does not pay another's debt).
const OWED = `MAX(${WORTH} - ${KEPT}, 0)`;
// Money to give back: everything kept for a cancelled sale, what was paid beyond the worth for an active one.
const REFUND = `(CASE WHEN s.cancelled_at IS NULL THEN MAX(${KEPT} - ${WORTH}, 0) ELSE ${KEPT} END)`;

/** Clients who owe money, biggest debt first. */
export async function listDebtors(): Promise<Debtor[]> {
  const db = await getDb();
  return db.select<Debtor[]>(
    `SELECT c.id AS client_id, c.name, c.phone, SUM(${OWED}) AS debt,
            SUM(CASE WHEN ${OWED} > 0 THEN 1 ELSE 0 END) AS sale_count,
            MAX(s.created_at) AS last_sale_at,
            COALESCE(GROUP_CONCAT(CASE WHEN ${OWED} > 0 THEN s.id END), '') AS sale_ids
       FROM sales s JOIN clients c ON c.id = s.client_id
      WHERE s.rev >= 1 AND s.cancelled_at IS NULL
      GROUP BY c.id
     HAVING SUM(${OWED}) > 0
      ORDER BY debt DESC, c.name`,
  );
}

/** Clients we must give money back to (they paid for sales that were later cancelled). */
export async function listRefundsDue(): Promise<RefundDue[]> {
  const db = await getDb();
  return db.select<RefundDue[]>(
    `SELECT c.id AS client_id, c.name, c.phone, SUM(${REFUND}) AS due
       FROM sales s JOIN clients c ON c.id = s.client_id
      WHERE s.rev >= 1
      GROUP BY c.id
     HAVING SUM(${REFUND}) > 0
      ORDER BY due DESC, c.name`,
  );
}

/** All of a client's sales with their money position, oldest first. */
export async function listClientSales(client_id: number): Promise<ClientSale[]> {
  const db = await getDb();
  const rows = await db.select<Omit<ClientSale, "debt" | "refund_due">[]>(
    `SELECT s.id, s.total, s.paid, ${PAY_SUM("payment")} AS later_paid, ${PAY_SUM("refund")} AS refunded,
            ${RETURNED_SUM} AS returned, s.created_at, s.cancelled_at
       FROM sales s WHERE s.client_id = $1 AND s.rev >= 1 ORDER BY s.created_at, s.id`,
    [client_id],
  );
  return rows.map((r) => {
    return { ...r, ...moneyOf(r) };
  });
}

export async function listClientPayments(client_id: number): Promise<PaymentRow[]> {
  const db = await getDb();
  return db.select<PaymentRow[]>(
    `SELECT p.id, p.sale_id, p.kind, p.amount, p.created_at, p.cancelled_at
       FROM payments p JOIN sales s ON s.id = p.sale_id
      WHERE s.client_id = $1 ORDER BY p.created_at DESC, p.id DESC`,
    [client_id],
  );
}

/** Spreads `amount` over the given sales, oldest first, one payment row per sale. */
async function allocate(
  kind: "payment" | "refund",
  client_id: number,
  amount: number,
  sales: { id: number; room: number }[],
): Promise<Omit<Receipt, "client_name" | "client_phone" | "remaining">> {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("invalid amount");
  if (amount > sales.reduce((s, x) => s + x.room, 0)) throw new Error("overpaid");
  const db = await getDb();
  let left = amount;
  const parts: { sale_id: number; amount: number }[] = [];
  const at = now(); // one time for the whole payment, so its rows can be grouped into one receipt
  let first = 0;
  for (const s of sales) {
    if (left <= 0) break;
    const part = Math.min(left, s.room);
    if (part <= 0) continue;
    const res = await db.execute("INSERT INTO payments (sale_id, kind, amount, created_at) VALUES ($1,$2,$3,$4)", [
      s.id,
      kind,
      part,
      at,
    ]);
    if (!first) first = res.lastInsertId as number;
    parts.push({ sale_id: s.id, amount: part });
    left -= part;
  }
  await log(client_id, kind, { client_id, amount, parts });
  return { no: first, kind, created_at: at, amount, sale_ids: parts.map((x) => x.sale_id) };
}

async function clientOf(client_id: number): Promise<{ client_name: string; client_phone: string | null }> {
  const db = await getDb();
  const rows = await db.select<{ name: string; phone: string | null }[]>("SELECT name, phone FROM clients WHERE id = $1", [client_id]);
  return { client_name: rows[0]?.name ?? "", client_phone: rows[0]?.phone ?? null };
}

/** The client pays off debt: goes to their oldest unpaid sales first. */
export async function recordPayment(client_id: number, amount: number): Promise<Receipt> {
  const all = await listClientSales(client_id);
  const sales = all.filter((s) => s.debt > 0).map((s) => ({ id: s.id, room: s.debt }));
  const r = await allocate("payment", client_id, amount, sales);
  const remaining = all.reduce((sum, s) => sum + s.debt, 0) - amount;
  return { ...r, ...(await clientOf(client_id)), remaining };
}

/** We give money back for cancelled sales, oldest first. */
export async function recordRefund(client_id: number, amount: number): Promise<Receipt> {
  const sales = (await listClientSales(client_id))
    .filter((s) => s.refund_due > 0)
    .map((s) => ({ id: s.id, room: s.refund_due }));
  const r = await allocate("refund", client_id, amount, sales);
  return { ...r, ...(await clientOf(client_id)), remaining: null };
}

/** A client's debt statement: their unpaid sales, the total owed and when they last paid. */
export type Statement = {
  client_name: string;
  client_phone: string | null;
  created_at: string;
  sales: { id: number; created_at: string; total: number; received: number; debt: number }[];
  total_debt: number;
  last_payment_at: string | null;
};

export async function getStatement(client_id: number): Promise<Statement> {
  const [sales, pays, who] = await Promise.all([listClientSales(client_id), listClientPayments(client_id), clientOf(client_id)]);
  const open = sales.filter((s) => s.debt > 0);
  return {
    ...who,
    created_at: now(),
    // total = what the sale is worth after its returns; received = what the client paid and kept
    sales: open.map((s) => ({ id: s.id, created_at: s.created_at, total: s.total - s.returned, received: s.paid + s.later_paid - s.refunded, debt: s.debt })),
    total_debt: open.reduce((sum, s) => sum + s.debt, 0),
    // listClientPayments is newest first
    last_payment_at: pays.find((p) => p.kind === "payment" && !p.cancelled_at)?.created_at ?? null,
  };
}

/** Receipt for an earlier payment/refund: all of its rows (same kind and time), reprinted from the history list. */
export function receiptFromRows(client: { name: string; phone: string | null }, row: PaymentRow, rows: PaymentRow[]): Receipt {
  const group = rows.filter((p) => !p.cancelled_at && p.kind === row.kind && p.created_at === row.created_at);
  return {
    no: Math.min(...group.map((p) => p.id)),
    kind: row.kind,
    client_name: client.name,
    client_phone: client.phone,
    created_at: row.created_at,
    amount: group.reduce((sum, p) => sum + p.amount, 0),
    sale_ids: group.map((p) => p.sale_id),
    remaining: null,
  };
}

/** Cancels a payment or refund record (the row stays, marked cancelled). */
export async function voidPayment(id: number) {
  const db = await getDb();
  const rows = await db.select<(PaymentRow & { sale_cancelled_at: string | null; received: number; refunded: number; paid: number })[]>(
    `SELECT p.*, s.cancelled_at AS sale_cancelled_at, s.paid,
            ${PAY_SUM("payment")} AS received, ${PAY_SUM("refund")} AS refunded
       FROM payments p JOIN sales s ON s.id = p.sale_id WHERE p.id = $1`,
    [id],
  );
  const p = rows[0];
  if (!p) throw new Error("not found");
  if (p.cancelled_at) return;
  // Taking back a payment must not leave us having given back more than we received (cancelled sale or a return).
  if (p.kind === "payment" && p.paid + p.received - p.amount < p.refunded) {
    throw new Error("refunded");
  }
  await db.execute("UPDATE payments SET cancelled_at = $1 WHERE id = $2 AND cancelled_at IS NULL", [now(), id]);
  await log(id, "cancel", { kind: p.kind, amount: p.amount, sale_id: p.sale_id });
}
