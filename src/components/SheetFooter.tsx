import { Phone } from "lucide-react";
import { useI18n } from "@/i18n";
import { useShop } from "@/shop";

/** Bottom of every printed sheet (invoice, receipt, statement): the "errors and omissions" line on the right,
 *  the shop's phone numbers on the left. The sheet is a flex column, so this sits at the bottom of the page. */
export function SheetFooter() {
  const { t } = useI18n();
  const { phones } = useShop();
  return (
    <>
      <div className="min-h-10 flex-1" />
      <footer className="flex items-end justify-between gap-6 border-t-2 border-[#cfd4c0] pt-3 text-[13px] text-[#4a5544] break-inside-avoid">
        <span>{t("errorsLine")}</span>
        {phones.length > 0 && (
          <span dir="ltr" className="flex flex-wrap items-center gap-x-4 gap-y-1 font-bold">
            {phones.map((p) => (
              <span key={p} className="flex items-center gap-1">
                <Phone className="size-3.5" /> {p}
              </span>
            ))}
          </span>
        )}
      </footer>
    </>
  );
}
