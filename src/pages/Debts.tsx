import { useCallback, useEffect, useState } from "react";
import { Ban, Undo2, Wallet } from "lucide-react";
import { useI18n } from "@/i18n";
import { Button, ConfirmModal, Field, Modal, MoneyInput } from "@/components/ui";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { useErrorText } from "@/lib/errors";
import * as debts from "@/data/debts";
import type { ClientSale, Debtor, PaymentRow, RefundDue } from "@/data/debts";

type Dialog =
  | { kind: "pay"; client: { id: number; name: string }; max: number }
  | { kind: "refund"; client: { id: number; name: string }; max: number }
  | { kind: "detail"; client: { id: number; name: string } }
  | null;

function Stat({ label, value, tone }: { label: string; value: string; tone?: "bad" | "warn" }) {
  return (
    <div className="rounded-3xl bg-white p-5 shadow-sm">
      <div className="text-muted">{label}</div>
      <div className={`mt-1 text-3xl font-extrabold ${tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : ""}`}>{value}</div>
    </div>
  );
}

export default function Debts() {
  const { t } = useI18n();
  const [debtors, setDebtors] = useState<Debtor[]>([]);
  const [refunds, setRefunds] = useState<RefundDue[]>([]);
  const [dialog, setDialog] = useState<Dialog>(null);
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
  const totalRefund = refunds.reduce((s, r) => s + r.due, 0);
  const close = () => setDialog(null);
  const done = () => {
    close();
    void reload();
  };

  return (
    <div>
      <h1 className="mb-1 text-3xl font-extrabold">{t("debts")}</h1>
      <p className="mb-6 text-muted">{t("debtsSub")}</p>

      <div className={`mb-6 grid gap-4 ${refunds.length ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        <Stat label={t("totalDebt")} value={`${formatNumber(totalDebt)} ${t("currency")}`} tone={totalDebt > 0 ? "bad" : undefined} />
        <Stat label={t("debtorsCount")} value={formatNumber(debtors.length)} />
        {refunds.length > 0 && <Stat label={t("refundsTotal")} value={`${formatNumber(totalRefund)} ${t("currency")}`} tone="warn" />}
      </div>

      {loadError && <p className="mb-4 rounded-2xl bg-bad-l p-4 text-bad">{t("error")}</p>}

      <div className="overflow-x-auto rounded-3xl bg-white p-2 shadow-sm">
        {loaded && debtors.length === 0 ? (
          <p className="p-10 text-center text-lg text-muted">{t("noDebts")}</p>
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
              {debtors.map((d) => (
                <tr key={d.client_id} className="border-t border-line hover:bg-bg/60">
                  <td className="p-3">
                    <button className="font-bold hover:underline" onClick={() => setDialog({ kind: "detail", client: { id: d.client_id, name: d.name } })}>
                      {d.name}
                    </button>
                  </td>
                  <td className="p-3 text-muted">{formatDate(d.last_sale_at)}</td>
                  <td className="p-3 text-lg font-extrabold text-bad">
                    {formatNumber(d.debt)} {t("currency")}
                  </td>
                  <td className="whitespace-nowrap p-3 text-end">
                    <Button small onClick={() => setDialog({ kind: "pay", client: { id: d.client_id, name: d.name }, max: d.debt })}>
                      <Wallet className="size-4" /> {t("payDebt")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {refunds.length > 0 && (
        <section className="mt-8">
          <h2 className="text-2xl font-extrabold">{t("refundSection")}</h2>
          <p className="mb-3 text-muted">{t("refundHint")}</p>
          <div className="overflow-x-auto rounded-3xl bg-white p-2 shadow-sm">
            <table className="w-full">
              <tbody>
                {refunds.map((r) => (
                  <tr key={r.client_id} className="border-t border-line first:border-0">
                    <td className="p-3">
                      <button className="font-bold hover:underline" onClick={() => setDialog({ kind: "detail", client: { id: r.client_id, name: r.name } })}>
                        {r.name}
                      </button>
                    </td>
                    <td className="p-3 text-lg font-extrabold text-warn">
                      {formatNumber(r.due)} {t("currency")}
                    </td>
                    <td className="whitespace-nowrap p-3 text-end">
                      <Button small variant="secondary" onClick={() => setDialog({ kind: "refund", client: { id: r.client_id, name: r.name }, max: r.due })}>
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

      {dialog?.kind === "pay" && <AmountModal mode="payment" {...dialog} onDone={done} onClose={close} />}
      {dialog?.kind === "refund" && <AmountModal mode="refund" {...dialog} onDone={done} onClose={close} />}
      {dialog?.kind === "detail" && <DetailModal client={dialog.client} onChanged={() => void reload()} onClose={close} />}
    </div>
  );
}

function AmountModal({
  mode,
  client,
  max,
  onDone,
  onClose,
}: {
  mode: "payment" | "refund";
  client: { id: number; name: string };
  max: number;
  onDone: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [amount, setAmount] = useState<number | null>(max);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = !!amount && amount > 0 && amount <= max;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    try {
      await (mode === "payment" ? debts.recordPayment(client.id, amount as number) : debts.recordRefund(client.id, amount as number));
      onDone();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Modal title={`${mode === "payment" ? t("payDebt") : t("refund")}: ${client.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="mb-4 rounded-2xl bg-olive-l p-4 text-olive-d">
          {mode === "payment" ? t("debt") : t("refundDueTag")}: <b>{formatNumber(max)} {t("currency")}</b>
        </div>
        <Field label={`${mode === "payment" ? t("payAmount") : t("refundAmount")} (${t("currency")})`} error={amount !== null && amount > max ? t("paidTooMuch") : error}>
          <MoneyInput value={amount} onChange={setAmount} autoFocus />
        </Field>
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-base text-muted">{t("payHint")}</p>
          <Button type="button" small variant="ghost" onClick={() => setAmount(max)}>
            {t("payAllBtn")}
          </Button>
        </div>
        <Button type="submit" disabled={!valid || busy} className="w-full">
          {t("save")}
        </Button>
      </form>
    </Modal>
  );
}

function DetailModal({
  client,
  onChanged,
  onClose,
}: {
  client: { id: number; name: string };
  onChanged: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [sales, setSales] = useState<ClientSale[]>([]);
  const [pays, setPays] = useState<PaymentRow[]>([]);
  const [voiding, setVoiding] = useState<number | null>(null);
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
                  {t("total")}: {formatNumber(s.total)} · {t("paid")} {formatNumber(s.paid + s.later_paid)}
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
                      <Button small variant="danger" onClick={() => setVoiding(p.id)}>
                        <Ban className="size-4" /> {t("cancel")}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {voiding !== null && (
        <ConfirmModal message={t("confirmVoidPayment")} confirmLabel={t("voidRecord")} onConfirm={doVoid} onClose={() => setVoiding(null)} />
      )}
    </Modal>
  );
}
