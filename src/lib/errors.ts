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
    if (m === "overpaid") return t("paidTooMuch");
    if (m === "conflict") return t("conflict");
    return t("error");
  };
}
