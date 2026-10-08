import logo from "@/assets/logo.png";
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
  const received = sale.paid + sale.later_paid;

  return (
    <div dir="rtl" className="invoice-sheet bg-white p-10 text-[15px] leading-relaxed text-[#1f2a1a]">
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

      {/* totals: numbers only, the currency is in the label */}
      <div className="mt-5 ms-auto w-80 break-inside-avoid">
        <div className="flex items-center justify-between rounded-lg bg-[#e8f0dc] px-4 py-3 text-xl font-extrabold text-[#385220]">
          <span>
            {t("total")} ({t("currency")})
          </span>
          <span>{formatNumber(sale.total)}</span>
        </div>
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
      </div>

      {sale.note && (
        <div className="mt-6 break-inside-avoid rounded-lg border border-[#cfd4c0] p-4">
          <div className="mb-1 font-bold text-[#385220]">{t("notes")}</div>
          <div className="whitespace-pre-wrap break-words">{sale.note}</div>
        </div>
      )}
    </div>
  );
}
