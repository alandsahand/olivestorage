import { getDb } from "../db";
import { PAY_SUM } from "./sales";

export type Debtor = { client_id: number; name: string; debt: number; sale_count: number; last_sale_at: string };
export type RefundDue = { client_id: number; name: string; due: number };

export type ClientSale = {
  id: number;
  total: number;
  paid: number;
  later_paid: number;
  refunded: number;
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

async function log(entity_id: number | null, action: string, details: unknown) {
  const db = await getDb();
  await db.execute(
    "INSERT INTO history_log (entity, entity_id, action, details, created_at) VALUES ('payments',$1,$2,$3,$4)",
    [entity_id, action, JSON.stringify(details), now()],
  );
}

// "Owed" of an active sale = total - paid at sale - later payments.
const OWED = `(s.total - s.paid - ${PAY_SUM("payment")})`;
// "Refund due" of a cancelled sale = money received - money already given back.
const REFUND = `(s.paid + ${PAY_SUM("payment")} - ${PAY_SUM("refund")})`;

/** Clients who owe money, biggest debt first. */
export async function listDebtors(): Promise<Debtor[]> {
  const db = await getDb();
  return db.select<Debtor[]>(
    `SELECT c.id AS client_id, c.name, SUM(${OWED}) AS debt,
            SUM(CASE WHEN ${OWED} > 0 THEN 1 ELSE 0 END) AS sale_count,
            MAX(s.created_at) AS last_sale_at
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
    `SELECT c.id AS client_id, c.name, SUM(${REFUND}) AS due
       FROM sales s JOIN clients c ON c.id = s.client_id
      WHERE s.rev >= 1 AND s.cancelled_at IS NOT NULL
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
            s.created_at, s.cancelled_at
       FROM sales s WHERE s.client_id = $1 AND s.rev >= 1 ORDER BY s.created_at, s.id`,
    [client_id],
  );
  return rows.map((r) => {
    const received = r.paid + r.later_paid;
    return {
      ...r,
      debt: r.cancelled_at ? 0 : r.total - received,
      refund_due: r.cancelled_at ? received - r.refunded : 0,
    };
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
async function allocate(kind: "payment" | "refund", client_id: number, amount: number, sales: { id: number; room: number }[]) {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("invalid amount");
  if (amount > sales.reduce((s, x) => s + x.room, 0)) throw new Error("overpaid");
  const db = await getDb();
  let left = amount;
  const parts: { sale_id: number; amount: number }[] = [];
  for (const s of sales) {
    if (left <= 0) break;
    const part = Math.min(left, s.room);
    if (part <= 0) continue;
    await db.execute("INSERT INTO payments (sale_id, kind, amount, created_at) VALUES ($1,$2,$3,$4)", [
      s.id,
      kind,
      part,
      now(),
    ]);
    parts.push({ sale_id: s.id, amount: part });
    left -= part;
  }
  await log(client_id, kind, { client_id, amount, parts });
}

/** The client pays off debt: goes to their oldest unpaid sales first. */
export async function recordPayment(client_id: number, amount: number) {
  const sales = (await listClientSales(client_id)).filter((s) => s.debt > 0).map((s) => ({ id: s.id, room: s.debt }));
  await allocate("payment", client_id, amount, sales);
}

/** We give money back for cancelled sales, oldest first. */
export async function recordRefund(client_id: number, amount: number) {
  const sales = (await listClientSales(client_id))
    .filter((s) => s.refund_due > 0)
    .map((s) => ({ id: s.id, room: s.refund_due }));
  await allocate("refund", client_id, amount, sales);
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
  // Taking back a payment on a cancelled sale must not leave us having refunded more than we received.
  if (p.kind === "payment" && p.sale_cancelled_at && p.paid + p.received - p.amount < p.refunded) {
    throw new Error("insufficient");
  }
  await db.execute("UPDATE payments SET cancelled_at = $1 WHERE id = $2 AND cancelled_at IS NULL", [now(), id]);
  await log(id, "cancel", { kind: p.kind, amount: p.amount, sale_id: p.sale_id });
}
