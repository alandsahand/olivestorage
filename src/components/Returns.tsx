import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Printer, Undo2 } from "lucide-react";
import logo from "@/assets/logo.png";
import { useI18n } from "@/i18n";
import { Button, Modal, inputCls } from "@/components/ui";
import { SheetFooter } from "@/components/SheetFooter";
import { formatDateTime, formatNumber, formatQty, parseQty, toArabicDigits } from "@/lib/format";
import { useErrorText } from "@/lib/errors";
import { getSale, moneyOf, type SaleDetail } from "@/data/sales";
import { createReturn, getReturnable, returnValue, type Returnable, type SaleReturn } from "@/data/returns";

/* ---------- the return window: pick what comes back ---------- */

export function ReturnModal({ saleId, onDone, onClose }: { saleId: number; onDone: (r: SaleReturn) => void; onClose: () => void }) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [items, setItems] = useState<Returnable[]>([]);
  const [qty, setQty] = useState<Record<number, string>>({});
  const [refundNow, setRefundNow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void Promise.all([getSale(saleId), getReturnable(saleId)]).then(([s, r]) => {
      setSale(s);
      setItems(r);
    });
  }, [saleId]);

  if (!sale) return null;

  const rows = items.map((it) => {
    const q = parseQty(qty[it.item_id] ?? "") ?? 0;
    const left = it.sold_milli - it.returned_milli;
    return { ...it, q, left, tooMuch: q > left, value: q ? returnValue(q, it.unit_price, sale) : 0 };
  });
  const bad = rows.some((r) => r.tooMuch);
  // never more than the sale is still worth (same cap as the data layer)
  const total = Math.min(
    rows.reduce((s, r) => s + r.value, 0),
    sale.total - sale.returned,
  );
  const after = moneyOf({ ...sale, returned: sale.returned + total });
  const canSave = total > 0 && !bad && !busy;

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setError("");
    try {
      onDone(
        await createReturn({
          sale_id: saleId,
          refund_now: refundNow && after.refund_due > 0,
          lines: rows.filter((r) => r.q > 0).map((r) => ({ item_id: r.item_id, qty_milli: r.q })),
        }),
      );
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <Modal title={`${t("returnTitle")}: ${t("saleNo")} ${formatNumber(sale.id)} · ${sale.client_name}`} onClose={onClose} wide>
      {sale.discount > 0 && (
        <p className="mb-3 text-base text-muted">
          {t("discount")}
          {sale.discount_pct_milli ? ` ${formatQty(sale.discount_pct_milli)}٪` : `: ${formatNumber(sale.discount)} ${t("currency")}`}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-muted">
              <th className="p-2 text-start text-base font-medium">{t("item")}</th>
              <th className="p-2 text-start text-base font-medium">{t("soldQty")}</th>
              <th className="p-2 text-start text-base font-medium">{t("returnedBefore")}</th>
              <th className="p-2 text-start text-base font-medium">{t("returnNow")}</th>
              <th className="p-2 text-start text-base font-medium">
                {t("amountLabel")} ({t("currency")})
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.item_id} className="border-t border-line">
                <td className="p-2 font-bold">{r.item_name}</td>
                <td className="p-2">
                  {formatQty(r.sold_milli)} {r.unit_name}
                </td>
                <td className="p-2 text-muted">{r.returned_milli ? formatQty(r.returned_milli) : "—"}</td>
                <td className="p-2">
                  <input
                    className={`${inputCls} !w-28 !px-2 text-center font-extrabold ${r.tooMuch ? "!border-bad" : ""}`}
                    inputMode="decimal"
                    disabled={r.left <= 0}
                    aria-label={`${t("returnNow")} ${r.item_name}`}
                    value={qty[r.item_id] ?? ""}
                    onChange={(e) => setQty((m) => ({ ...m, [r.item_id]: e.target.value }))}
                  />
                  <span className={`mt-0.5 block text-sm ${r.tooMuch ? "font-bold text-bad" : "text-muted"}`}>
                    {r.tooMuch ? t("tooMuchReturned") : `${t("leftToReturn")}: ${formatQty(r.left)}`}
                  </span>
                </td>
                <td className="p-2 font-bold">{r.value ? formatNumber(r.value) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="my-4 flex items-center justify-between rounded-2xl bg-warn-l p-4 text-xl font-extrabold text-warn">
        <span>{t("returnTotal")}</span>
        <span>
          {formatNumber(total)} {t("currency")}
        </span>
      </div>
      {total > 0 &&
        (after.refund_due > 0 ? (
          <div className="mb-4 rounded-2xl border-2 border-warn p-4">
            <p className="mb-2 font-bold text-warn">
              {t("giveBackAmount")}: {formatNumber(after.refund_due)} {t("currency")}
            </p>
            <label className="flex cursor-pointer items-center gap-3 text-lg">
              <input type="checkbox" className="size-6 accent-olive" checked={refundNow} onChange={(e) => setRefundNow(e.target.checked)} />
              {t("refundNow")}
            </label>
          </div>
        ) : (
          <p className="mb-4 text-lg">
            {t("clientOwesAfter")}: <b>{formatNumber(after.debt)}</b> {t("currency")}
          </p>
        ))}
      {error && <p className="mb-3 rounded-xl bg-bad-l p-3 text-bad">{error}</p>}
      <Button onClick={save} disabled={!canSave} className="w-full">
        <Undo2 className="size-5" /> {t("saveReturn")}
      </Button>
    </Modal>
  );
}

/* ---------- the return slip (printed paper) ---------- */

const cell = "border border-[#cfd4c0] px-3 py-2";

export function ReturnSlipSheet({ r }: { r: SaleReturn }) {
  const { t } = useI18n();
  const label = "text-[#6b7565]";
  return (
    <div dir="rtl" className="invoice-sheet flex flex-col bg-white p-10 text-[15px] leading-relaxed text-[#1f2a1a]">
      <header className="flex items-center justify-between gap-6 border-b-4 border-[#c98a0a] pb-5">
        <div className="flex items-center gap-4">
          <img src={logo} alt="" className="size-20" />
          <div>
            <div className="text-3xl font-extrabold text-olive-d">{t("appName")}</div>
            <div className="text-lg text-[#8a5a00]">{t("returnSlip")}</div>
          </div>
        </div>
        <div className="space-y-1 text-end">
          <div>
            <span className={label}>{t("returnNo")}: </span>
            <b className="text-xl">{toArabicDigits(String(r.id))}</b>
          </div>
          <div>
            <span className={label}>{t("date")}: </span>
            <b>{formatDateTime(r.created_at)}</b>
          </div>
          <div>
            <span className={label}>{t("invoiceNo")}: </span>
            <b>{toArabicDigits(String(r.sale_id))}</b>
          </div>
        </div>
      </header>

      <div className="my-5 text-lg">
        <span className={label}>{t("client")}: </span>
        <b>{r.client_name}</b>
        {r.client_phone && (
          <span className="ms-6 text-[#6b7565]">
            {t("phone")}: <b dir="ltr" className="text-[#1f2a1a]">{r.client_phone}</b>
          </span>
        )}
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-[#fdf3dc] text-[#8a5a00]">
            <th className={`${cell} text-center`} style={{ width: "8%" }}>
              {t("colId")}
            </th>
            <th className={`${cell} text-start`}>{t("item")}</th>
            <th className={`${cell} text-center`} style={{ width: "18%" }}>
              {t("qty")}
            </th>
            <th className={`${cell} text-center`} style={{ width: "18%" }}>
              {t("colUnitPrice")} ({t("currency")})
            </th>
            <th className={`${cell} text-center`} style={{ width: "18%" }}>
              {t("amountLabel")} ({t("currency")})
            </th>
          </tr>
        </thead>
        <tbody>
          {r.lines.map((l, k) => (
            <tr key={k}>
              <td className={`${cell} text-center`}>{formatNumber(k + 1)}</td>
              <td className={`${cell} text-start font-bold`}>{l.item_name}</td>
              <td className={`${cell} text-center`}>
                {formatQty(l.qty_milli)} {l.unit_name}
              </td>
              <td className={`${cell} text-center`}>{formatNumber(l.unit_price)}</td>
              <td className={`${cell} text-center`}>{formatNumber(l.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-5 ms-auto w-80 break-inside-avoid">
        <div className="flex items-center justify-between rounded-lg bg-[#fdf3dc] px-4 py-3 text-xl font-extrabold text-[#8a5a00]">
          <span>
            {t("returnTotal")} ({t("currency")})
          </span>
          <span>{formatNumber(r.total)}</span>
        </div>
        {r.refunded_now > 0 && (
          <div className="flex justify-between px-4 py-2">
            <span className={label}>
              {t("givenBackNow")} ({t("currency")})
            </span>
            <b>{formatNumber(r.refunded_now)}</b>
          </div>
        )}
      </div>

      <div className="mt-14 flex justify-between gap-10 break-inside-avoid">
        <div className="flex-1 border-t border-[#1f2a1a] pt-2 text-center">{t("signReceiver")}</div>
        <div className="flex-1 border-t border-[#1f2a1a] pt-2 text-center">{t("signClient")}</div>
      </div>
      <SheetFooter />
    </div>
  );
}

/** Preview of a return slip; "Print / PDF" opens the Windows print dialog, like the invoice. */
export function ReturnSlipModal({ r, onClose }: { r: SaleReturn; onClose: () => void }) {
  const { t } = useI18n();
  function print() {
    const old = document.title;
    const restore = () => {
      document.title = old;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    document.title = `${t("returnSlip")} ${r.id} - ${r.client_name}`;
    window.print();
  }
  return (
    <Modal title={t("returnSlip")} onClose={onClose} wide>
      <div className="mb-4 max-h-[58vh] overflow-auto rounded-2xl border-2 border-line bg-neutral-100 p-3">
        <div className="mx-auto w-full max-w-[794px] shadow-md">
          <ReturnSlipSheet r={r} />
        </div>
      </div>
      <p className="mb-4 text-base text-muted">{t("pdfHint")}</p>
      <div className="flex gap-3">
        <Button onClick={print} className="flex-1">
          <Printer className="size-5" /> {t("printPdf")}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          {t("close")}
        </Button>
      </div>
      {createPortal(
        <div className="print-area">
          <ReturnSlipSheet r={r} />
        </div>,
        document.body,
      )}
    </Modal>
  );
}
