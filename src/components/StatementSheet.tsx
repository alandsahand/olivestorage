import logo from "@/assets/logo.png";
import { SheetFooter } from "@/components/SheetFooter";
import { useI18n } from "@/i18n";
import { formatDate, formatDateTime, formatNumber, toArabicDigits } from "@/lib/format";
import type { Statement } from "@/data/debts";

const cell = "border border-[#cfd4c0] px-3 py-2 text-center";

/** Debt statement: the client's unpaid sales and the total they owe. Same print path as the invoice. */
export function StatementSheet({ statement }: { statement: Statement }) {
  const { t } = useI18n();
  const cur = ` (${t("currency")})`;

  return (
    <div dir="rtl" className="invoice-sheet flex flex-col bg-white p-10 text-[15px] leading-relaxed text-[#1f2a1a]">
      <header className="flex items-center justify-between gap-6 border-b-4 border-olive pb-5">
        <div className="flex items-center gap-4">
          <img src={logo} alt="" className="size-20" />
          <div>
            <div className="text-3xl font-extrabold text-olive-d">{t("appName")}</div>
            <div className="text-lg text-[#6b7565]">{t("statement")}</div>
          </div>
        </div>
        <div className="text-end">
          <span className="text-[#6b7565]">{t("date")}: </span>
          <b>{formatDateTime(statement.created_at)}</b>
        </div>
      </header>

      <div className="my-5 text-lg">
        <span className="text-[#6b7565]">{t("client")}: </span>
        <b>{statement.client_name}</b>
        {statement.client_phone && (
          <span className="ms-6 text-[#6b7565]">
            {t("phone")}: <b dir="ltr" className="text-[#1f2a1a]">{statement.client_phone}</b>
          </span>
        )}
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-[#e8f0dc] text-[#385220]">
            <th className={cell} style={{ width: "12%" }}>
              {t("colNo")}
            </th>
            <th className={cell}>{t("date")}</th>
            <th className={cell}>
              {t("total")}
              {cur}
            </th>
            <th className={cell}>
              {t("paidAmount")}
              {cur}
            </th>
            <th className={cell}>
              {t("debt")}
              {cur}
            </th>
          </tr>
        </thead>
        <tbody>
          {statement.sales.map((s) => (
            <tr key={s.id}>
              <td className={cell}>{toArabicDigits(String(s.id))}</td>
              <td className={cell}>{formatDate(s.created_at)}</td>
              <td className={cell}>{formatNumber(s.total)}</td>
              <td className={cell}>{formatNumber(s.received)}</td>
              <td className={`${cell} font-bold`}>{formatNumber(s.debt)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-5 ms-auto w-96 break-inside-avoid">
        <div className="flex items-center justify-between rounded-lg bg-[#fbe9e9] px-4 py-3 text-2xl font-extrabold text-[#d23b3b]">
          <span>
            {t("statementTotal")}
            {cur}
          </span>
          <span>{formatNumber(statement.total_debt)}</span>
        </div>
        {statement.last_payment_at && (
          <div className="px-4 py-2 text-[#6b7565]">
            {t("lastPayment")}: <b className="text-[#1f2a1a]">{formatDate(statement.last_payment_at)}</b>
          </div>
        )}
      </div>
      <SheetFooter />
    </div>
  );
}
