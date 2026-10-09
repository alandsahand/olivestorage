import { type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Printer } from "lucide-react";
import logo from "@/assets/logo.png";
import { useI18n } from "@/i18n";
import { Button, Modal } from "@/components/ui";
import { SheetFooter } from "@/components/SheetFooter";
import { formatDate, formatDateTime, formatNumber, toArabicDigits } from "@/lib/format";
import type { SupplierStatement, SupplierVoucher } from "@/data/purchases";

// Printed papers of the suppliers part of Debts: a voucher for money paid to (or given back by) a supplier,
// and a statement of what we still owe him. Same look, print path and footer as the client papers.

const label = "text-[#6b7565]";
const cell = "border border-[#cfd4c0] px-3 py-2 text-center";

function Head({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <header className="flex items-center justify-between gap-6 border-b-4 border-olive pb-5">
      <div className="flex items-center gap-4">
        <img src={logo} alt="" className="size-20" />
        <div>
          <div className="text-3xl font-extrabold text-olive-d">{t("appName")}</div>
          <div className="text-lg text-[#6b7565]">{title}</div>
        </div>
      </div>
      <div className="space-y-1 text-end">{children}</div>
    </header>
  );
}

function Supplier({ name, phone, caption }: { name: string; phone: string | null; caption: string }) {
  const { t } = useI18n();
  return (
    <div className="my-6 text-xl">
      <span className={label}>{caption}: </span>
      <b>{name}</b>
      {phone && (
        <span className="ms-6 text-lg text-[#6b7565]">
          {t("phone")}: <b dir="ltr" className="text-[#1f2a1a]">{phone}</b>
        </span>
      )}
    </div>
  );
}

export function SupplierVoucherSheet({ v }: { v: SupplierVoucher }) {
  const { t } = useI18n();
  const out = v.kind === "payment"; // we paid the supplier; else the supplier gave money back
  return (
    <div dir="rtl" className="invoice-sheet flex flex-col bg-white p-10 text-[15px] leading-relaxed text-[#1f2a1a]">
      <Head title={out ? t("voucherOut") : t("voucherIn")}>
        <div>
          <span className={label}>{t("receiptNo")}: </span>
          <b className="text-xl">{toArabicDigits(String(v.no))}</b>
        </div>
        <div>
          <span className={label}>{t("date")}: </span>
          <b>{formatDateTime(v.created_at)}</b>
        </div>
      </Head>
      <Supplier name={v.supplier_name} phone={v.supplier_phone} caption={out ? t("paidBackTo") : t("receivedFrom")} />
      <div className="flex items-center justify-between rounded-lg bg-[#e8f0dc] px-5 py-4 text-2xl font-extrabold text-[#385220]">
        <span>
          {t("amountLabel")} ({t("currency")})
        </span>
        <span>{formatNumber(v.amount)}</span>
      </div>
      <div className="mt-4 space-y-2 px-1">
        {v.purchase_ids.length > 0 && (
          <div>
            <span className={label}>{t("forPurchases")}: </span>
            <b>{v.purchase_ids.map((id) => toArabicDigits(String(id))).join("، ")}</b>
          </div>
        )}
        {v.remaining !== null && (
          <div className={v.remaining > 0 ? "text-[#d23b3b]" : ""}>
            <span className={v.remaining > 0 ? "" : label}>
              {t("weStillOwe")} ({t("currency")}):{" "}
            </span>
            <b>{formatNumber(v.remaining)}</b>
          </div>
        )}
      </div>
      <div className="mt-14 flex justify-between gap-10 break-inside-avoid">
        <div className="flex-1 border-t border-[#1f2a1a] pt-2 text-center">{t("signSupplier")}</div>
        <div className="flex-1 border-t border-[#1f2a1a] pt-2 text-center">{t("signShop")}</div>
      </div>
      <SheetFooter />
    </div>
  );
}

export function SupplierStatementSheet({ s }: { s: SupplierStatement }) {
  const { t } = useI18n();
  const cur = ` (${t("currency")})`;
  return (
    <div dir="rtl" className="invoice-sheet flex flex-col bg-white p-10 text-[15px] leading-relaxed text-[#1f2a1a]">
      <Head title={t("supplierStatement")}>
        <span className={label}>{t("date")}: </span>
        <b>{formatDateTime(s.created_at)}</b>
      </Head>
      <Supplier name={s.supplier_name} phone={s.supplier_phone} caption={t("supplier")} />
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-[#e8f0dc] text-[#385220]">
            <th className={cell} style={{ width: "14%" }}>
              {t("purchaseNo")}
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
          {s.purchases.map((p) => (
            <tr key={p.id}>
              <td className={cell}>{toArabicDigits(String(p.id))}</td>
              <td className={cell}>{formatDate(p.created_at)}</td>
              <td className={cell}>{formatNumber(p.total)}</td>
              <td className={cell}>{formatNumber(p.given)}</td>
              <td className={`${cell} font-bold`}>{formatNumber(p.debt)}</td>
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
          <span>{formatNumber(s.total_debt)}</span>
        </div>
        {s.last_payment_at && (
          <div className="px-4 py-2 text-[#6b7565]">
            {t("lastPayment")}: <b className="text-[#1f2a1a]">{formatDate(s.last_payment_at)}</b>
          </div>
        )}
      </div>
      <SheetFooter />
    </div>
  );
}

/** Preview + "Print / PDF" (Windows print dialog: paper or a PDF file), like the invoice. */
export function PaperModal({ title, fileName, onClose, children }: { title: string; fileName: string; onClose: () => void; children: ReactNode }) {
  const { t } = useI18n();
  function print() {
    const old = document.title;
    const restore = () => {
      document.title = old;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    document.title = fileName; // the PDF file name the print dialog proposes
    window.print();
  }
  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="mb-4 max-h-[58vh] overflow-auto rounded-2xl border-2 border-line bg-neutral-100 p-3">
        <div className="mx-auto w-full max-w-[794px] shadow-md">{children}</div>
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
      {createPortal(<div className="print-area">{children}</div>, document.body)}
    </Modal>
  );
}
