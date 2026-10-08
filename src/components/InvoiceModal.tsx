import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Printer } from "lucide-react";
import { useI18n } from "@/i18n";
import { Button, Modal } from "@/components/ui";
import { InvoiceSheet } from "@/components/InvoiceSheet";
import { getSale } from "@/data/sales";
import type { SaleDetail } from "@/data/sales";

/** Opens a preview of a sale's invoice. "Print / PDF" opens the Windows print dialog, which can print on paper or save a PDF file. */
export function InvoiceModal({ saleId, onClose }: { saleId: number; onClose: () => void }) {
  const { t } = useI18n();
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    getSale(saleId)
      .then((s) => (s ? setSale(s) : setError(true)))
      .catch(() => setError(true));
  }, [saleId]);

  function print() {
    if (!sale) return;
    // The PDF file name proposed by the print dialog comes from the page title.
    const old = document.title;
    const restore = () => {
      document.title = old;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    document.title = `${t("invoice")} ${sale.id} - ${sale.client_name}`;
    window.print();
  }

  return (
    <Modal title={t("invoicePreview")} onClose={onClose} wide>
      {error && <p className="rounded-xl bg-bad-l p-3 text-bad">{t("error")}</p>}
      {sale && (
        <>
          <div className="mb-4 max-h-[58vh] overflow-auto rounded-2xl border-2 border-line bg-neutral-100 p-3">
            <div className="mx-auto w-full max-w-[794px] shadow-md">
              <InvoiceSheet sale={sale} />
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
          {/* the copy that is actually printed: invisible on screen, the only thing shown when printing */}
          {createPortal(
            <div className="print-area">
              <InvoiceSheet sale={sale} />
            </div>,
            document.body,
          )}
        </>
      )}
    </Modal>
  );
}
