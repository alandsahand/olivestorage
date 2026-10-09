import logo from "@/assets/logo.png";
import { SheetFooter } from "@/components/SheetFooter";
import { useI18n, type Key } from "@/i18n";
import { formatDateTime, formatNumber, formatQty, toArabicDigits } from "@/lib/format";
import type { SaleDetail, SaleLine } from "@/data/sales";

/**
 * The invoice table, as data. To add, remove or reorder a column, edit this list.
 * `label` is a text key from i18n; `value` returns what is printed in that cell (numbers only, no currency text).
 */
export type InvoiceColumn = {
  key: string;
  label: Key;
  width?: string;
  align: "start" | "center";
  currency?: boolean; // adds "(د.ع)" to the header; the cells stay plain numbers
  value: (line: SaleLine, rowNumber: number) => string;
};

export const INVOICE_COLUMNS: InvoiceColumn[] = [
  { key: "id", label: "colId", width: "7%", align: "center", value: (_l, n) => formatNumber(n) },
  { key: "material", label: "item", align: "start", value: (l) => l.item_name },
  { key: "unit", label: "unit", width: "12%", align: "center", value: (l) => l.unit_name },
  { key: "weight", label: "colWeight", width: "15%", align: "center", value: (l) => formatQty(l.qty_milli) },
  { key: "unitPrice", label: "colUnitPrice", width: "17%", align: "center", currency: true, value: (l) => formatNumber(l.unit_price) },
  { key: "price", label: "colAmount", width: "17%", align: "center", currency: true, value: (l) => formatNumber(l.line_total) },
];

const cell = "border border-[#cfd4c0] px-3 py-2";

export function InvoiceSheet({ sale }: { sale: SaleDetail }) {
  const { t } = useI18n();
  const received = sale.paid + sale.later_paid - sale.refunded; // what the client paid and kept

  return (
    <div dir="rtl" className="invoice-sheet flex flex-col bg-white p-10 text-[15px] leading-relaxed text-[#1f2a1a]">
      {/* header: logo + shop name on one side, invoice number and date on the other */}
      <header className="flex items-center justify-between gap-6 border-b-4 border-olive pb-5">
        <div className="flex items-center gap-4">
          <img src={logo} alt="" className="size-20" />
          <div>
            <div className="text-3xl font-extrabold text-olive-d">{t("appName")}</div>
            <div className="text-lg text-[#6b7565]">{t("invoice")}</div>
          </div>
        </div>
        <div className="space-y-1 text-end">
          <div>
            <span className="text-[#6b7565]">{t("invoiceNo")}: </span>
            <b className="text-xl">{toArabicDigits(String(sale.id))}</b>
          </div>
          <div>
            <span className="text-[#6b7565]">{t("date")}: </span>
            <b>{formatDateTime(sale.created_at)}</b>
          </div>
        </div>
      </header>

      <div className="my-5 text-lg">
        <span className="text-[#6b7565]">{t("client")}: </span>
        <b>{sale.client_name}</b>
        {sale.client_phone && (
          <span className="ms-6 text-[#6b7565]">
            {t("phone")}: <b dir="ltr" className="text-[#1f2a1a]">{sale.client_phone}</b>
          </span>
        )}
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-[#e8f0dc] text-[#385220]">
            {INVOICE_COLUMNS.map((c) => (
              <th key={c.key} style={{ width: c.width }} className={`${cell} ${c.align === "center" ? "text-center" : "text-start"} font-bold`}>
                {t(c.label)}
                {c.currency && ` (${t("currency")})`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sale.lines.map((line, i) => (
            <tr key={line.id}>
              {INVOICE_COLUMNS.map((c) => (
                <td key={c.key} className={`${cell} ${c.align === "center" ? "text-center" : "text-start"} ${c.key === "material" ? "font-bold" : ""}`}>
                  {c.value(line, i + 1)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* returns: the items above never change; what came back is listed here (amber) */}
      {sale.returns.length > 0 && (
        <div className="mt-5 break-inside-avoid">
          <div className="mb-1.5 font-bold text-[#8a5a00]">{t("returnedItems")}</div>
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[#fdf3dc] text-[#8a5a00]">
                <th className={`${cell} text-center`} style={{ width: "22%" }}>{t("date")}</th>
                <th className={`${cell} text-start`}>{t("item")}</th>
                <th className={`${cell} text-center`} style={{ width: "18%" }}>{t("qty")}</th>
                <th className={`${cell} text-center`} style={{ width: "20%" }}>
                  {t("amountLabel")} ({t("currency")})
                </th>
              </tr>
            </thead>
            <tbody>
              {sale.returns.flatMap((r) =>
                r.lines.map((l, k) => (
                  <tr key={`${r.id}-${k}`}>
                    <td className={`${cell} text-center`}>{formatDateTime(r.created_at)}</td>
                    <td className={`${cell} text-start font-bold`}>{l.item_name}</td>
                    <td className={`${cell} text-center`}>
                      {formatQty(l.qty_milli)} {l.unit_name}
                    </td>
                    <td className={`${cell} text-center`}>
                      <bdi dir="ltr">−{formatNumber(l.value)}</bdi>
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* totals: numbers only, the currency is in the label */}
      <div className="mt-5 ms-auto w-80 break-inside-avoid">
        {sale.discount > 0 && (
          <>
            <div className="flex justify-between px-4 py-1.5">
              <span className="text-[#6b7565]">
                {t("subtotal")} ({t("currency")})
              </span>
              <b>{formatNumber(sale.total + sale.discount)}</b>
            </div>
            <div className="mb-2 flex justify-between px-4 py-1.5">
              <span className="text-[#6b7565]">
                {t("discount")}
                {sale.discount_pct_milli ? ` ${formatQty(sale.discount_pct_milli)}٪` : ""} ({t("currency")})
              </span>
              <b>
                <bdi dir="ltr">−{formatNumber(sale.discount)}</bdi>
              </b>
            </div>
          </>
        )}
        <div className="flex items-center justify-between rounded-lg bg-[#e8f0dc] px-4 py-3 text-xl font-extrabold text-[#385220]">
          <span>
            {t("total")} ({t("currency")})
          </span>
          <span>{formatNumber(sale.total)}</span>
        </div>
        {sale.returned > 0 && (
          <>
            <div className="flex justify-between px-4 py-1.5 text-[#8a5a00]">
              <span>
                {t("returnedTag")} ({t("currency")})
              </span>
              <b>
                <bdi dir="ltr">−{formatNumber(sale.returned)}</bdi>
              </b>
            </div>
            <div className="flex justify-between px-4 py-1.5 font-extrabold">
              <span>
                {t("netTotal")} ({t("currency")})
              </span>
              <span>{formatNumber(sale.total - sale.returned)}</span>
            </div>
          </>
        )}
        <div className="flex justify-between px-4 py-2">
          <span className="text-[#6b7565]">
            {t("paidAmount")} ({t("currency")})
          </span>
          <b>{formatNumber(received)}</b>
        </div>
        <div className={`flex justify-between border-t border-[#cfd4c0] px-4 py-2 ${sale.debt > 0 ? "text-[#d23b3b]" : ""}`}>
          <span>
            {t("debt")} ({t("currency")})
          </span>
          <b>{formatNumber(sale.debt)}</b>
        </div>
        {sale.refund_due > 0 && (
          <div className="flex justify-between px-4 py-2 font-bold text-[#8a5a00]">
            <span>
              {t("giveBackAmount")} ({t("currency")})
            </span>
            <b>{formatNumber(sale.refund_due)}</b>
          </div>
        )}
      </div>

      {sale.note && (
        <div className="mt-6 break-inside-avoid rounded-lg border border-[#cfd4c0] p-4">
          <div className="mb-1 font-bold text-[#385220]">{t("notes")}</div>
          <div className="whitespace-pre-wrap break-words">{sale.note}</div>
        </div>
      )}
      <SheetFooter />
    </div>
  );
}
