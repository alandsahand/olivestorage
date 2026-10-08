import { useCallback, useEffect, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Home, Users, Zap, type LucideIcon } from "lucide-react";
import { useI18n, type Key } from "@/i18n";
import { Button, ConfirmModal, MoneyInput } from "@/components/ui";
import { formatNumber, toArabicDigits } from "@/lib/format";
import { useErrorText } from "@/lib/errors";
import { COST_KINDS, getMonthCosts, getYearCosts, monthTotal, saveMonthCosts } from "@/data/costs";
import type { CostKind, MonthCosts } from "@/data/costs";

const ICONS: Record<CostKind, LucideIcon> = { electricity: Zap, workers: Users, place: Home };
const EMPTY: MonthCosts = { electricity: 0, workers: 0, place: 0 };

const pad = (n: number) => String(n).padStart(2, "0");
const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
const shift = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};

export default function Costs() {
  const { t } = useI18n();
  const errorText = useErrorText();
  const months = t("months").split(",");
  const label = (month: string) => `${months[Number(month.slice(5)) - 1]} ${toArabicDigits(month.slice(0, 4))}`;

  const [month, setMonth] = useState(currentMonth);
  const [saved, setSaved] = useState<MonthCosts>(EMPTY); // what is in the database
  const [draft, setDraft] = useState<MonthCosts>(EMPTY); // what is on screen
  const [year, setYear] = useState<Record<number, MonthCosts>>({});
  const [pendingMonth, setPendingMonth] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [justSaved, setJustSaved] = useState(false);

  const dirty = COST_KINDS.some((k) => draft[k] !== saved[k]);

  const load = useCallback(async (m: string) => {
    try {
      const [c, y] = await Promise.all([getMonthCosts(m), getYearCosts(Number(m.slice(0, 4)))]);
      setSaved(c);
      setDraft(c);
      setYear(y);
      setError("");
    } catch (e) {
      setError(errorText(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load(month);
  }, [month, load]);

  function goTo(next: string) {
    if (next === month) return;
    if (dirty) setPendingMonth(next);
    else {
      setJustSaved(false);
      setMonth(next);
    }
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      await saveMonthCosts(month, draft);
      await load(month);
      setJustSaved(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const yearNo = Number(month.slice(0, 4));
  const yearSum = Object.values(year).reduce((s, c) => s + monthTotal(c), 0);

  return (
    <div>
      <h1 className="mb-1 text-3xl font-extrabold">{t("costs")}</h1>
      <p className="mb-5 text-muted">{t("costsSub")}</p>

      <div className="mb-5 flex items-center gap-3">
        <Button variant="secondary" onClick={() => goTo(shift(month, -1))} aria-label={t("prevMonth")} title={t("prevMonth")}>
          <ChevronRight className="size-5" />
        </Button>
        <div className="min-w-56 rounded-2xl bg-white px-6 py-3 text-center text-xl font-extrabold shadow-sm">{label(month)}</div>
        <Button variant="secondary" onClick={() => goTo(shift(month, 1))} aria-label={t("nextMonth")} title={t("nextMonth")}>
          <ChevronLeft className="size-5" />
        </Button>
        {month !== currentMonth() && (
          <Button variant="ghost" onClick={() => goTo(currentMonth())}>
            {label(currentMonth())}
          </Button>
        )}
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,26rem)_1fr]">
        <form
          className="rounded-3xl bg-white p-6 shadow-sm"
          onSubmit={(e) => {
            e.preventDefault();
            if (dirty && !busy) void save();
          }}
        >
          {COST_KINDS.map((k) => {
            const Icon = ICONS[k];
            return (
              <label key={k} className="mb-4 block">
                <span className="mb-1.5 flex items-center gap-2 font-bold">
                  <Icon className="size-5 text-olive" /> {t(k as Key)} ({t("currency")})
                </span>
                <MoneyInput
                  value={draft[k]}
                  onChange={(v) => {
                    setJustSaved(false);
                    setDraft((d) => ({ ...d, [k]: v ?? 0 }));
                  }}
                />
              </label>
            );
          })}
          <div className="my-5 rounded-2xl bg-olive-l p-4">
            <div className="text-muted">{t("monthTotal")}</div>
            <div className="text-4xl font-extrabold text-olive-d">
              {formatNumber(monthTotal(draft))} <span className="text-xl">{t("currency")}</span>
            </div>
          </div>
          {error && <p className="mb-3 rounded-xl bg-bad-l p-3 text-bad">{error}</p>}
          {justSaved && !dirty && (
            <p className="mb-3 flex items-center gap-2 rounded-xl bg-good-l p-3 font-bold text-good">
              <Check className="size-5" /> {t("savedOk")}
            </p>
          )}
          <Button type="submit" disabled={!dirty || busy} className="w-full !py-4 text-xl">
            {t("save")}
          </Button>
        </form>

        <div className="rounded-3xl bg-white p-2 shadow-sm">
          <h2 className="p-4 pb-2 text-xl font-extrabold">
            {t("yearOverview")} · {toArabicDigits(String(yearNo))}
          </h2>
          <table className="w-full">
            <thead>
              <tr className="text-muted">
                <th className="p-2 text-start text-base font-medium">{t("month")}</th>
                {COST_KINDS.map((k) => (
                  <th key={k} className="p-2 text-start text-base font-medium">
                    {t(k as Key).replace(/\s*\(.*\)/, "")}
                  </th>
                ))}
                <th className="p-2 text-start text-base font-medium">{t("total")}</th>
              </tr>
            </thead>
            <tbody>
              {months.map((name, i) => {
                const key = `${yearNo}-${pad(i + 1)}`;
                const c = year[i + 1] ?? EMPTY;
                const active = key === month;
                return (
                  <tr
                    key={key}
                    onClick={() => goTo(key)}
                    className={`cursor-pointer border-t border-line hover:bg-bg/60 ${active ? "bg-olive-l font-bold" : ""}`}
                  >
                    <td className="whitespace-nowrap p-2">{name}</td>
                    {COST_KINDS.map((k) => (
                      <td key={k} className="p-2 text-muted">
                        {c[k] ? formatNumber(c[k]) : "—"}
                      </td>
                    ))}
                    <td className="p-2 font-bold">{monthTotal(c) ? formatNumber(monthTotal(c)) : "—"}</td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-line font-extrabold">
                <td className="p-3" colSpan={4}>
                  {t("yearTotal")}
                </td>
                <td className="p-3">
                  {formatNumber(yearSum)} {t("currency")}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {pendingMonth && (
        <ConfirmModal
          message={t("unsavedChanges")}
          confirmLabel={t("discard")}
          onConfirm={() => {
            setMonth(pendingMonth);
            setPendingMonth(null);
            setJustSaved(false);
          }}
          onClose={() => setPendingMonth(null)}
        />
      )}
    </div>
  );
}
