import { useCallback, useEffect, useState } from "react";
import { Ban, Phone, Printer, Undo2, Wallet } from "lucide-react";
import { useI18n } from "@/i18n";
import { Button, ConfirmModal, Modal, PAGE_SIZE, SearchBox, ShowMore } from "@/components/ui";
import { formatDate, formatDateTime, formatNumber, matchPerson } from "@/lib/format";
import { useErrorText } from "@/lib/errors";
import * as pur from "@/data/purchases";
import type { Purchase, SupplierDebt, SupplierPaymentRow, SupplierRefundDue, SupplierStatement, SupplierVoucher } from "@/data/purchases";
import { PaperModal, SupplierStatementSheet, SupplierVoucherSheet } from "@/components/SupplierPapers";
import { AmountModal, Stat } from "@/components/AmountModal";

type Who = { id: number; name: string; phone: string | null };
type Dialog =
  | { kind: "pay"; who: Who; max: number }
  | { kind: "back"; who: Who; max: number }
  | { kind: "detail"; who: Who }
  | { kind: "statement"; who: Who }
  | null;

/** Voucher for money paid to / given back by a supplier, ready to print. */
function VoucherModal({ v, onClose }: { v: SupplierVoucher; onClose: () => void }) {
  const { t } = useI18n();
  const title = v.kind === "payment" ? t("voucherOut") : t("voucherIn");
  return (
    <PaperModal title={title} fileName={`${title} ${v.no} - ${v.supplier_name}`} onClose={onClose}>
      <SupplierVoucherSheet v={v} />
    </PaperModal>
  );
}

/** What we still owe one supplier, ready to print. */
function StatementModal({ who, onClose }: { who: Who; onClose: () => void }) {
  const { t } = useI18n();
  const [s, setS] = useState<SupplierStatement | null>(null);
  useEffect(() => {
    void pur.getSupplierStatement(who.id).then(setS);
  }, [who.id]);
  if (!s) return null;
  return (
    <PaperModal title={t("supplierStatement")} fileName={`${t("supplierStatement")} - ${s.supplier_name}`} onClose={onClose}>
      <SupplierStatementSheet s={s} />
    </PaperModal>
  );
}

/** Debts page, part 2: what we owe suppliers (and money a supplier must give back for a cancelled purchase). */
export default function SupplierDebts() {
  const { t } = useI18n();
  const [owed, setOwed] = useState<SupplierDebt[]>([]);
  const [back, setBack] = useState<SupplierRefundDue[]>([]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [query, setQuery] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [o, b] = await Promise.all([pur.listSupplierDebts(), pur.listSupplierRefundsDue()]);
      setOwed(o);
      setBack(b);
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

  const total = owed.reduce((s, x) => s + x.debt, 0);
  const found = owed.filter((s) => matchPerson(query, s.name, s.purchase_ids, s.phone));
  const totalBack = back.reduce((s, x) => s + x.due, 0);
  const close = () => setDialog(null);
  const [voucher, setVoucher] = useState<SupplierVoucher | null>(null);
  // after paying a supplier (or money coming back): refresh and show the voucher right away
  const done = (v: SupplierVoucher) => {
    close();
    setVoucher(v);
    void reload();
  };

  return (
    <div>
      <div className={`mb-6 grid gap-4 ${back.length ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        <Stat label={t("supplierDebtTotal")} value={`${formatNumber(total)} ${t("currency")}`} tone={total > 0 ? "bad" : undefined} />
        <Stat label={t("suppliersOwedCount")} value={formatNumber(owed.length)} />
        {back.length > 0 && <Stat label={t("supplierRefundSection")} value={`${formatNumber(totalBack)} ${t("currency")}`} tone="warn" />}
      </div>

      {loadError && <p className="mb-4 rounded-2xl bg-bad-l p-4 text-bad">{t("error")}</p>}

      {owed.length > 0 && <SearchBox value={query} onChange={setQuery} placeholder={t("searchSuppliers")} />}

      <div className="overflow-x-auto rounded-3xl bg-white p-2 shadow-sm">
        {loaded && found.length === 0 ? (
          <p className="p-10 text-center text-lg text-muted">{owed.length === 0 ? t("noSupplierDebts") : t("noMatch")}</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-muted">
                <th className="p-3 text-start text-base font-medium">{t("supplier")}</th>
                <th className="p-3 text-start text-base font-medium">{t("lastPurchaseAt")}</th>
                <th className="p-3 text-start text-base font-medium">{t("debt")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {found.slice(0, shown).map((s) => (
                <tr key={s.supplier_id} className="border-t border-line hover:bg-bg/60">
                  <td className="p-3">
                    <button className="font-bold hover:underline" onClick={() => setDialog({ kind: "detail", who: { id: s.supplier_id, name: s.name, phone: s.phone } })}>
                      {s.name}
                    </button>
                    {s.phone && (
                      <span dir="ltr" className="mt-0.5 flex items-center justify-end gap-1 text-sm text-muted">
                        {s.phone} <Phone className="size-3.5" />
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-muted">{formatDate(s.last_purchase_at)}</td>
                  <td className="p-3 text-lg font-extrabold text-bad">
                    {formatNumber(s.debt)} {t("currency")}
                  </td>
                  <td className="whitespace-nowrap p-3 text-end">
                    <Button
                      small
                      variant="ghost"
                      title={t("supplierStatementBtn")}
                      aria-label={t("supplierStatementBtn")}
                      onClick={() => setDialog({ kind: "statement", who: { id: s.supplier_id, name: s.name, phone: s.phone } })}
                    >
                      <Printer className="size-5" />
                    </Button>{" "}
                    <Button small onClick={() => setDialog({ kind: "pay", who: { id: s.supplier_id, name: s.name, phone: s.phone }, max: s.debt })}>
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

      {back.length > 0 && (
        <section className="mt-8">
          <h2 className="text-2xl font-extrabold">{t("supplierRefundSection")}</h2>
          <p className="mb-3 text-muted">{t("supplierRefundHint")}</p>
          <div className="overflow-x-auto rounded-3xl bg-white p-2 shadow-sm">
            <table className="w-full">
              <tbody>
                {back.filter((b) => matchPerson(query, b.name, "")).map((b) => (
                  <tr key={b.supplier_id} className="border-t border-line first:border-0">
                    <td className="p-3">
                      <button className="font-bold hover:underline" onClick={() => setDialog({ kind: "detail", who: { id: b.supplier_id, name: b.name, phone: b.phone } })}>
                        {b.name}
                      </button>
                    </td>
                    <td className="p-3 text-lg font-extrabold text-warn">
                      {formatNumber(b.due)} {t("currency")}
                    </td>
                    <td className="whitespace-nowrap p-3 text-end">
                      <Button small variant="secondary" onClick={() => setDialog({ kind: "back", who: { id: b.supplier_id, name: b.name, phone: b.phone }, max: b.due })}>
                        <Undo2 className="size-4" /> {t("takeBack")}
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
          title={`${t("payDebt")}: ${dialog.who.name}`}
          dueLabel={t("debt")}
          amountLabel={t("payAmount")}
          hint={t("supplierPayHint")}
          max={dialog.max}
          submit={(amount) => pur.recordSupplierPayment(dialog.who.id, amount)}
          onDone={done}
          onClose={close}
        />
      )}
      {dialog?.kind === "back" && (
        <AmountModal
          title={`${t("takeBack")}: ${dialog.who.name}`}
          dueLabel={t("refundDueTag")}
          amountLabel={t("takeBackAmount")}
          hint={t("supplierPayHint")}
          max={dialog.max}
          submit={(amount) => pur.recordSupplierRefund(dialog.who.id, amount)}
          onDone={done}
          onClose={close}
        />
      )}
      {dialog?.kind === "detail" && <SupplierDetail who={dialog.who} onChanged={() => void reload()} onClose={close} />}
      {dialog?.kind === "statement" && <StatementModal who={dialog.who} onClose={close} />}
      {voucher && <VoucherModal v={voucher} onClose={() => setVoucher(null)} />}
    </div>
  );
}

function SupplierDetail({ who, onChanged, onClose }: { who: Who; onChanged: () => void; onClose: () => void }) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [pays, setPays] = useState<SupplierPaymentRow[]>([]);
  const [voiding, setVoiding] = useState<number | null>(null);
  const [voucher, setVoucher] = useState<SupplierVoucher | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [p, s] = await Promise.all([pur.listSupplierPurchases(who.id), pur.listSupplierPayments(who.id)]);
    setPurchases(p);
    setPays(s);
  }, [who.id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function doVoid() {
    if (voiding === null) return;
    try {
      await pur.voidSupplierPayment(voiding);
      setVoiding(null);
      await load();
      onChanged();
    } catch (e) {
      setVoiding(null);
      setError(errorText(e));
    }
  }

  const open = purchases.filter((p) => p.debt > 0 || p.refund_due > 0);

  return (
    <Modal title={who.name} onClose={onClose} wide>
      {error && <p className="mb-3 rounded-xl bg-bad-l p-3 text-bad">{error}</p>}
      <h3 className="mb-2 text-xl font-extrabold">{t("details")}</h3>
      {open.length === 0 ? (
        <p className="mb-4 text-muted">{t("noRecords")}</p>
      ) : (
        <ul className="mb-5 divide-y divide-line rounded-2xl border-2 border-line">
          {open.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 p-3">
              <span>
                {t("purchaseNo")} {formatNumber(p.id)} · {formatDate(p.created_at)}
                <span className="block text-base text-muted">
                  {t("total")}: {formatNumber(p.total)} · {t("paidAmount")}: {formatNumber(p.paid + p.later_paid)}
                </span>
              </span>
              {p.debt > 0 ? (
                <b className="text-bad">{formatNumber(p.debt)}</b>
              ) : (
                <span className="rounded-full bg-warn-l px-3 py-0.5 font-bold text-warn">
                  {t("refundDueTag")}: {formatNumber(p.refund_due)}
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
                    {p.kind === "payment" ? t("kindPayment") : t("takeBack")} · {t("purchaseNo")} {formatNumber(p.purchase_id)}
                  </td>
                  <td className={`p-2 font-bold ${p.kind === "refund" ? "text-good" : "text-warn"}`}>{formatNumber(p.amount)}</td>
                  <td className="whitespace-nowrap p-2 text-end no-underline">
                    {dead ? (
                      <span className="rounded-full bg-bad-l px-3 py-0.5 text-sm font-bold text-bad">{t("cancelled")}</span>
                    ) : (
                      <>
                        <Button small variant="ghost" onClick={() => setVoucher(pur.voucherFromRows(who, p, pays))} title={t("printPdf")} aria-label={t("printPdf")}>
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
      {voucher && <VoucherModal v={voucher} onClose={() => setVoucher(null)} />}
      {voiding !== null && (
        <ConfirmModal message={t("confirmVoidPayment")} confirmLabel={t("voidRecord")} onConfirm={doVoid} onClose={() => setVoiding(null)} />
      )}
    </Modal>
  );
}
