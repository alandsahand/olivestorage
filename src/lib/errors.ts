import { useI18n } from "@/i18n";

/** Turns a data-layer error into a message the owner can understand. */
export function useErrorText() {
  const { t } = useI18n();
  return (e: unknown) => {
    const m = e instanceof Error ? e.message : "";
    if (m === "duplicate") return t("duplicate");
    if (m === "insufficient") return t("notEnoughStock");
    if (m === "sold") return t("deliverySold");
    if (m === "refunded") return t("alreadyRefunded");
    if (m === "supplier required") return t("supplierRequired");
    if (m === "invalid discount") return t("discountTooBig");
    if (m === "too much returned") return t("tooMuchReturned");
    if (m === "below returned") return t("belowReturned");
    if (m === "lines locked") return t("linesLocked");
    if (m === "split too low") return t("splitTooLow");
    if (m === "split mismatch") return t("splitMismatch");
    if (m === "overpaid") return t("paidTooMuch");
    if (m === "conflict") return t("conflict");
    return t("error");
  };
}
