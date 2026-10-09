import logo from "@/assets/logo.png";
import { useI18n } from "@/i18n";
import { formatDateTime, formatNumber, toArabicDigits } from "@/lib/format";
import type { Receipt } from "@/data/debts";

/** Receipt for money received from a client (وصل قبض) or given back to them (وصل صرف). Uses the same print path as the invoice. */
export function ReceiptSheet({ receipt }: { receipt: Receipt }) {
  const { t } = useI18n();
  const isIn = receipt.kind === "payment";
  const label = "text-[#6b7565]";

  return (
    <div dir="rtl" className="invoice-sheet bg-white p-10 text-[15px] leading-relaxed text-[#1f2a1a]">
      <header className="flex items-center justify-between gap-6 border-b-4 border-olive pb-5">
        <div className="flex items-center gap-4">
          <img src={logo} alt="" className="size-20" />
          <div>
            <div className="text-3xl font-extrabold text-olive-d">{t("appName")}</div>
            <div className="text-lg text-[#6b7565]">{isIn ? t("receiptIn") : t("receiptOut")}</div>
          </div>
        </div>
        <div className="space-y-1 text-end">
          <div>
            <span className={label}>{t("receiptNo")}: </span>
            <b className="text-xl">{toArabicDigits(String(receipt.no))}</b>
          </div>
          <div>
            <span className={label}>{t("date")}: </span>
            <b>{formatDateTime(receipt.created_at)}</b>
          </div>
        </div>
      </header>

      <div className="my-6 text-xl">
        <span className={label}>{isIn ? t("receivedFrom") : t("paidBackTo")}: </span>
        <b>{receipt.client_name}</b>
      </div>

      <div className="flex items-center justify-between rounded-lg bg-[#e8f0dc] px-5 py-4 text-2xl font-extrabold text-[#385220]">
        <span>
          {t("amountLabel")} ({t("currency")})
        </span>
        <span>{formatNumber(receipt.amount)}</span>
      </div>

      <div className="mt-4 space-y-2 px-1">
        {receipt.sale_ids.length > 0 && (
          <div>
            <span className={label}>{t("forSales")}: </span>
            <b>{receipt.sale_ids.map((id) => toArabicDigits(String(id))).join("، ")}</b>
          </div>
        )}
        {receipt.remaining !== null && (
          <div className={receipt.remaining > 0 ? "text-[#d23b3b]" : ""}>
            <span className={receipt.remaining > 0 ? "" : label}>
              {t("remainingDebt")} ({t("currency")}):{" "}
            </span>
            <b>{formatNumber(receipt.remaining)}</b>
          </div>
        )}
      </div>

      <div className="mt-14 flex justify-between gap-10 break-inside-avoid">
        <div className="flex-1 border-t border-[#1f2a1a] pt-2 text-center">{t("signReceiver")}</div>
        <div className="flex-1 border-t border-[#1f2a1a] pt-2 text-center">{t("signClient")}</div>
      </div>
    </div>
  );
}
