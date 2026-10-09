import { createPortal } from "react-dom";
import { Printer } from "lucide-react";
import { useI18n } from "@/i18n";
import { Button, Modal } from "@/components/ui";
import { ReceiptSheet } from "@/components/ReceiptSheet";
import type { Receipt } from "@/data/debts";

/** Preview of a receipt; "Print / PDF" opens the Windows print dialog (paper or save as PDF), like the invoice. */
export function ReceiptModal({ receipt, onClose }: { receipt: Receipt; onClose: () => void }) {
  const { t } = useI18n();

  function print() {
    // The PDF file name proposed by the print dialog comes from the page title.
    const old = document.title;
    const restore = () => {
      document.title = old;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    const name = receipt.kind === "payment" ? t("receiptIn") : t("receiptOut");
    document.title = `${name} ${receipt.no} - ${receipt.client_name}`;
    window.print();
  }

  return (
    <Modal title={t("invoicePreview")} onClose={onClose} wide>
      <div className="mb-4 max-h-[58vh] overflow-auto rounded-2xl border-2 border-line bg-neutral-100 p-3">
        <div className="mx-auto w-full max-w-[794px] shadow-md">
          <ReceiptSheet receipt={receipt} />
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
          <ReceiptSheet receipt={receipt} />
        </div>,
        document.body,
      )}
    </Modal>
  );
}
