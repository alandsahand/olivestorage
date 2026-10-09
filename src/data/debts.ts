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

/** What a printed receipt (وصل قبض / وصل صرف) shows. `remaining` = the client's debt after this payment; null when unknown (old records). */
export type Receipt = {
  no: number;
  kind: "payment" | "refund";
  client_name: string;
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
async function allocate(
  kind: "payment" | "refund",
  client_id: number,
  amount: number,
  sales: { id: number; room: number }[],
): Promise<Omit<Receipt, "client_name" | "remaining">> {
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

async function clientName(client_id: number): Promise<string> {
  const db = await getDb();
  const rows = await db.select<{ name: string }[]>("SELECT name FROM clients WHERE id = $1", [client_id]);
  return rows[0]?.name ?? "";
}

/** The client pays off debt: goes to their oldest unpaid sales first. */
export async function recordPayment(client_id: number, amount: number): Promise<Receipt> {
  const all = await listClientSales(client_id);
  const sales = all.filter((s) => s.debt > 0).map((s) => ({ id: s.id, room: s.debt }));
  const r = await allocate("payment", client_id, amount, sales);
  const remaining = all.reduce((sum, s) => sum + s.debt, 0) - amount;
  return { ...r, client_name: await clientName(client_id), remaining };
}

/** We give money back for cancelled sales, oldest first. */
export async function recordRefund(client_id: number, amount: number): Promise<Receipt> {
  const sales = (await listClientSales(client_id))
    .filter((s) => s.refund_due > 0)
    .map((s) => ({ id: s.id, room: s.refund_due }));
  const r = await allocate("refund", client_id, amount, sales);
  return { ...r, client_name: await clientName(client_id), remaining: null };
}

/** A client's debt statement: their unpaid sales, the total owed and when they last paid. */
export type Statement = {
  client_name: string;
  created_at: string;
  sales: { id: number; created_at: string; total: number; received: number; debt: number }[];
  total_debt: number;
  last_payment_at: string | null;
};

export async function getStatement(client_id: number): Promise<Statement> {
  const [sales, pays, name] = await Promise.all([listClientSales(client_id), listClientPayments(client_id), clientName(client_id)]);
  const open = sales.filter((s) => s.debt > 0);
  return {
    client_name: name,
    created_at: now(),
    sales: open.map((s) => ({ id: s.id, created_at: s.created_at, total: s.total, received: s.paid + s.later_paid, debt: s.debt })),
    total_debt: open.reduce((sum, s) => sum + s.debt, 0),
    // listClientPayments is newest first
    last_payment_at: pays.find((p) => p.kind === "payment" && !p.cancelled_at)?.created_at ?? null,
  };
}

/** Receipt for an earlier payment/refund: all of its rows (same kind and time), reprinted from the history list. */
export function receiptFromRows(client_name: string, row: PaymentRow, rows: PaymentRow[]): Receipt {
  const group = rows.filter((p) => !p.cancelled_at && p.kind === row.kind && p.created_at === row.created_at);
  return {
    no: Math.min(...group.map((p) => p.id)),
    kind: row.kind,
    client_name,
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
  // Taking back a payment on a cancelled sale must not leave us having refunded more than we received.
  if (p.kind === "payment" && p.sale_cancelled_at && p.paid + p.received - p.amount < p.refunded) {
    throw new Error("refunded");
  }
  await db.execute("UPDATE payments SET cancelled_at = $1 WHERE id = $2 AND cancelled_at IS NULL", [now(), id]);
  await log(id, "cancel", { kind: p.kind, amount: p.amount, sale_id: p.sale_id });
}
