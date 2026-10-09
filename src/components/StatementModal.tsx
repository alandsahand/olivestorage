import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Printer } from "lucide-react";
import { useI18n } from "@/i18n";
import { Button, Modal } from "@/components/ui";
import { StatementSheet } from "@/components/StatementSheet";
import { getStatement, type Statement } from "@/data/debts";

/** Preview of a client's debt statement; "Print / PDF" opens the Windows print dialog (paper or save as PDF). */
export function StatementModal({ clientId, onClose }: { clientId: number; onClose: () => void }) {
  const { t } = useI18n();
  const [statement, setStatement] = useState<Statement | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    getStatement(clientId)
      .then(setStatement)
      .catch(() => setError(true));
  }, [clientId]);

  function print() {
    if (!statement) return;
    // The PDF file name proposed by the print dialog comes from the page title.
    const old = document.title;
    const restore = () => {
      document.title = old;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    document.title = `${t("statement")} - ${statement.client_name}`;
    window.print();
  }

  return (
    <Modal title={t("statement")} onClose={onClose} wide>
      {error && <p className="rounded-xl bg-bad-l p-3 text-bad">{t("error")}</p>}
      {statement && (
        <>
          <div className="mb-4 max-h-[58vh] overflow-auto rounded-2xl border-2 border-line bg-neutral-100 p-3">
            <div className="mx-auto w-full max-w-[794px] shadow-md">
              <StatementSheet statement={statement} />
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
              <StatementSheet statement={statement} />
            </div>,
            document.body,
          )}
        </>
      )}
    </Modal>
  );
}
