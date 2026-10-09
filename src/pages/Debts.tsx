import { useCallback, useEffect, useState } from "react";
import { Ban, Phone, Printer, Undo2, Wallet } from "lucide-react";
import { useI18n } from "@/i18n";
import { Button, Chip, ConfirmModal, Modal, PAGE_SIZE, SearchBox, ShowMore } from "@/components/ui";
import { ReceiptModal } from "@/components/ReceiptModal";
import { StatementModal } from "@/components/StatementModal";
import { formatDate, formatDateTime, formatNumber, matchPerson } from "@/lib/format";
import { useErrorText } from "@/lib/errors";
import * as debts from "@/data/debts";
import type { ClientSale, Debtor, PaymentRow, Receipt, RefundDue } from "@/data/debts";
import SupplierDebts from "./SupplierDebts";
import { AmountModal, Stat } from "@/components/AmountModal";

type Who = { id: number; name: string; phone: string | null };

type Dialog =
  | { kind: "pay"; client: Who; max: number }
  | { kind: "refund"; client: Who; max: number }
  | { kind: "detail"; client: Who }
  | { kind: "statement"; client: Who }
  | null;


/** Two parts: what clients owe us, and what we owe suppliers. */
export default function Debts() {
  const { t } = useI18n();
  const [part, setPart] = useState<"clients" | "suppliers">("clients");
  return (
    <div>
      <h1 className="mb-1 text-3xl font-extrabold">{t("debts")}</h1>
      <p className="mb-5 text-muted">{t("debtsSub")}</p>
      <div className="mb-5 flex gap-2.5">
        <Chip active={part === "clients"} onClick={() => setPart("clients")}>
          {t("clientsTab")}
        </Chip>
        <Chip active={part === "suppliers"} onClick={() => setPart("suppliers")}>
          {t("suppliersTab")}
        </Chip>
      </div>
      {part === "clients" ? <ClientDebts /> : <SupplierDebts />}
    </div>
  );
}

function ClientDebts() {
  const { t } = useI18n();
  const [debtors, setDebtors] = useState<Debtor[]>([]);
  const [refunds, setRefunds] = useState<RefundDue[]>([]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [shown, setShown] = useState(PAGE_SIZE); // debtors drawn so far (the totals above always use all of them)
  const [query, setQuery] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [d, r] = await Promise.all([debts.listDebtors(), debts.listRefundsDue()]);
      setDebtors(d);
      setRefunds(r);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const totalDebt = debtors.reduce((s, d) => s + d.debt, 0);
  const found = debtors.filter((d) => matchPerson(query, d.name, d.sale_ids, d.phone));
  const totalRefund = refunds.reduce((s, r) => s + r.due, 0);
  const close = () => setDialog(null);
  // after a payment/refund: refresh the lists and show its receipt right away
  const done = (r: Receipt) => {
    close();
    setReceipt(r);
    void reload();
  };

  return (
    <div>
      <div className={`mb-6 grid gap-4 ${refunds.length ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        <Stat label={t("totalDebt")} value={`${formatNumber(totalDebt)} ${t("currency")}`} tone={totalDebt > 0 ? "bad" : undefined} />
        <Stat label={t("debtorsCount")} value={formatNumber(debtors.length)} />
        {refunds.length > 0 && <Stat label={t("refundsTotal")} value={`${formatNumber(totalRefund)} ${t("currency")}`} tone="warn" />}
      </div>

      {loadError && <p className="mb-4 rounded-2xl bg-bad-l p-4 text-bad">{t("error")}</p>}

      {debtors.length > 0 && <SearchBox value={query} onChange={setQuery} placeholder={t("searchClients")} />}

      <div className="overflow-x-auto rounded-3xl bg-white p-2 shadow-sm">
        {loaded && found.length === 0 ? (
          <p className="p-10 text-center text-lg text-muted">{debtors.length === 0 ? t("noDebts") : t("noMatch")}</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-muted">
                <th className="p-3 text-start text-base font-medium">{t("client")}</th>
                <th className="p-3 text-start text-base font-medium">{t("lastPurchase")}</th>
                <th className="p-3 text-start text-base font-medium">{t("debt")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {found.slice(0, shown).map((d) => (
                <tr key={d.client_id} className="border-t border-line hover:bg-bg/60">
                  <td className="p-3">
                    <button className="font-bold hover:underline" onClick={() => setDialog({ kind: "detail", client: { id: d.client_id, name: d.name, phone: d.phone } })}>
                      {d.name}
                    </button>
                    {d.phone && (
                      <span dir="ltr" className="mt-0.5 flex items-center justify-end gap-1 text-sm text-muted">
                        {d.phone} <Phone className="size-3.5" />
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-muted">{formatDate(d.last_sale_at)}</td>
                  <td className="p-3 text-lg font-extrabold text-bad">
                    {formatNumber(d.debt)} {t("currency")}
                  </td>
                  <td className="whitespace-nowrap p-3 text-end">
                    <Button
                      small
                      variant="ghost"
                      title={t("statementBtn")}
                      aria-label={t("statementBtn")}
                      onClick={() => setDialog({ kind: "statement", client: { id: d.client_id, name: d.name, phone: d.phone } })}
                    >
                      <Printer className="size-5" />
                    </Button>{" "}
                    <Button small onClick={() => setDialog({ kind: "pay", client: { id: d.client_id, name: d.name, phone: d.phone }, max: d.debt })}>
                      <Wallet className="size-4" /> {t("payDebt")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {found.length > shown && <ShowMore onClick={() => setShown((n) => n + PAGE_SIZE)} />}
      </div>

      {refunds.length > 0 && (
        <section className="mt-8">
          <h2 className="text-2xl font-extrabold">{t("refundSection")}</h2>
          <p className="mb-3 text-muted">{t("refundHint")}</p>
          <div className="overflow-x-auto rounded-3xl bg-white p-2 shadow-sm">
            <table className="w-full">
              <tbody>
                {refunds.filter((r) => matchPerson(query, r.name, "", r.phone)).map((r) => (
                  <tr key={r.client_id} className="border-t border-line first:border-0">
                    <td className="p-3">
                      <button className="font-bold hover:underline" onClick={() => setDialog({ kind: "detail", client: { id: r.client_id, name: r.name, phone: r.phone } })}>
                        {r.name}
                      </button>
                    </td>
                    <td className="p-3 text-lg font-extrabold text-warn">
                      {formatNumber(r.due)} {t("currency")}
                    </td>
                    <td className="whitespace-nowrap p-3 text-end">
                      <Button small variant="secondary" onClick={() => setDialog({ kind: "refund", client: { id: r.client_id, name: r.name, phone: r.phone }, max: r.due })}>
                        <Undo2 className="size-4" /> {t("refund")}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {dialog?.kind === "pay" && (
        <AmountModal
          title={`${t("payDebt")}: ${dialog.client.name}`}
          dueLabel={t("debt")}
          amountLabel={t("payAmount")}
          hint={t("payHint")}
          max={dialog.max}
          submit={(amount) => debts.recordPayment(dialog.client.id, amount)}
          onDone={done}
          onClose={close}
        />
      )}
      {dialog?.kind === "refund" && (
        <AmountModal
          title={`${t("refund")}: ${dialog.client.name}`}
          dueLabel={t("refundDueTag")}
          amountLabel={t("refundAmount")}
          hint={t("payHint")}
          max={dialog.max}
          submit={(amount) => debts.recordRefund(dialog.client.id, amount)}
          onDone={done}
          onClose={close}
        />
      )}
      {dialog?.kind === "detail" && <DetailModal client={dialog.client} onChanged={() => void reload()} onClose={close} />}
      {dialog?.kind === "statement" && <StatementModal clientId={dialog.client.id} onClose={close} />}
      {receipt && <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}


function DetailModal({
  client,
  onChanged,
  onClose,
}: {
  client: Who;
  onChanged: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [sales, setSales] = useState<ClientSale[]>([]);
  const [pays, setPays] = useState<PaymentRow[]>([]);
  const [voiding, setVoiding] = useState<number | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [s, p] = await Promise.all([debts.listClientSales(client.id), debts.listClientPayments(client.id)]);
    setSales(s);
    setPays(p);
  }, [client.id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function doVoid() {
    if (voiding === null) return;
    try {
      await debts.voidPayment(voiding);
      setVoiding(null);
      await load();
      onChanged();
    } catch (e) {
      setVoiding(null);
      setError(errorText(e));
    }
  }

  const open = sales.filter((s) => s.debt > 0 || s.refund_due > 0);

  return (
    <Modal title={client.name} onClose={onClose} wide>
      {error && <p className="mb-3 rounded-xl bg-bad-l p-3 text-bad">{error}</p>}
      <h3 className="mb-2 text-xl font-extrabold">{t("details")}</h3>
      {open.length === 0 ? (
        <p className="mb-4 text-muted">{t("noRecords")}</p>
      ) : (
        <ul className="mb-5 divide-y divide-line rounded-2xl border-2 border-line">
          {open.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 p-3">
              <span>
                {t("saleNo")} {formatNumber(s.id)} · {formatDate(s.created_at)}
                <span className="block text-base text-muted">
                  {t("total")}: {formatNumber(s.total)} · {t("paidAmount")}: {formatNumber(s.paid + s.later_paid)}
                </span>
              </span>
              {s.debt > 0 ? (
                <b className="text-bad">{formatNumber(s.debt)}</b>
              ) : (
                <span className="rounded-full bg-warn-l px-3 py-0.5 font-bold text-warn">
                  {t("refundDueTag")}: {formatNumber(s.refund_due)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3 className="mb-2 text-xl font-extrabold">{t("paymentsHistory")}</h3>
      {pays.length === 0 ? (
        <p className="text-muted">{t("noRecords")}</p>
      ) : (
        <table className="w-full">
          <tbody>
            {pays.map((p) => {
              const dead = p.cancelled_at !== null;
              return (
                <tr key={p.id} className={`border-t border-line ${dead ? "text-muted line-through" : ""}`}>
                  <td className="p-2">{formatDateTime(p.created_at)}</td>
                  <td className="p-2">
                    {p.kind === "payment" ? t("kindPayment") : t("kindRefund")} · {t("saleNo")} {formatNumber(p.sale_id)}
                  </td>
                  <td className={`p-2 font-bold ${p.kind === "refund" ? "text-warn" : "text-good"}`}>{formatNumber(p.amount)}</td>
                  <td className="whitespace-nowrap p-2 text-end no-underline">
                    {dead ? (
                      <span className="rounded-full bg-bad-l px-3 py-0.5 text-sm font-bold text-bad">{t("cancelled")}</span>
                    ) : (
                      <>
                        <Button small variant="ghost" onClick={() => setReceipt(debts.receiptFromRows(client, p, pays))}>
                          <Printer className="size-4" />
                        </Button>{" "}
                        <Button small variant="danger" onClick={() => setVoiding(p.id)}>
                          <Ban className="size-4" /> {t("cancel")}
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {receipt && <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />}
      {voiding !== null && (
        <ConfirmModal message={t("confirmVoidPayment")} confirmLabel={t("voidRecord")} onConfirm={doVoid} onClose={() => setVoiding(null)} />
      )}
    </Modal>
  );
}
