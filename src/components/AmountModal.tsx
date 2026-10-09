import { useState } from "react";
import { useI18n } from "@/i18n";
import { Button, Field, Modal, MoneyInput } from "@/components/ui";
import { formatNumber } from "@/lib/format";
import { useErrorText } from "@/lib/errors";

export function Stat({ label, value, tone }: { label: string; value: string; tone?: "bad" | "warn" }) {
  return (
    <div className="rounded-3xl bg-white p-5 shadow-sm">
      <div className="text-muted">{label}</div>
      <div className={`mt-1 text-3xl font-extrabold ${tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : ""}`}>{value}</div>
    </div>
  );
}

/** "How much is paid now?" — used for client payments/refunds and for supplier payments/refunds. */
export function AmountModal<T>({
  title,
  dueLabel,
  amountLabel,
  hint,
  max,
  submit: run,
  onDone,
  onClose,
}: {
  title: string;
  dueLabel: string;
  amountLabel: string;
  hint: string; // where the money goes (oldest sale / oldest purchase first)
  max: number;
  submit: (amount: number) => Promise<T>;
  onDone: (result: T) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [amount, setAmount] = useState<number | null>(max);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = !!amount && amount > 0 && amount <= max;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    try {
      onDone(await run(amount as number));
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="mb-4 rounded-2xl bg-olive-l p-4 text-olive-d">
          {dueLabel}: <b>{formatNumber(max)} {t("currency")}</b>
        </div>
        <Field label={`${amountLabel} (${t("currency")})`} error={amount !== null && amount > max ? t("moreThanDue") : error}>
          <MoneyInput value={amount} onChange={setAmount} autoFocus />
        </Field>
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-base text-muted">{hint}</p>
          <Button type="button" small variant="ghost" onClick={() => setAmount(max)}>
            {t("payAllBtn")}
          </Button>
        </div>
        <Button type="submit" disabled={!valid || busy} className="w-full">
          {t("save")}
        </Button>
      </form>
    </Modal>
  );
}
