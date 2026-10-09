import { useCallback, useEffect, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Copy, KeyRound, Lock, ShieldCheck } from "lucide-react";
import { useI18n } from "@/i18n";
import { Button, Field, Modal, inputCls } from "@/components/ui";
import { formatNumber, toArabicDigits } from "@/lib/format";
import { currentMonth, shiftMonth } from "@/lib/months";
import * as auth from "@/data/auth";
import { getDashboard } from "@/data/dashboard";
import type { Dashboard as DashData } from "@/data/dashboard";

const IDLE_LOCK_MS = 5 * 60 * 1000;

function PinInput({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <input
      type="password"
      inputMode="numeric"
      autoComplete="off"
      autoFocus={autoFocus}
      maxLength={8}
      dir="ltr"
      className={`${inputCls} text-center text-3xl tracking-[0.5em]`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/* ---------- the gate: create PIN / enter PIN / forgot PIN / show recovery code ---------- */

type Phase = "loading" | "setup" | "locked" | "forgot" | "code" | "open";

export default function Dashboard() {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>("loading");
  const [code, setCode] = useState("");
  const [fatal, setFatal] = useState(false);

  useEffect(() => {
    auth
      .hasPin()
      .then((has) => setPhase(has ? "locked" : "setup"))
      .catch(() => setFatal(true));
  }, []);

  if (fatal) return <p className="rounded-2xl bg-bad-l p-4 text-bad">{t("error")}</p>;
  if (phase === "loading") return null;
  if (phase === "open") return <DashboardView onLock={() => setPhase("locked")} />;

  return (
    <div className="mx-auto mt-6 max-w-md rounded-3xl bg-white p-8 shadow-sm">
      <div className="mb-5 grid size-16 place-items-center rounded-2xl bg-olive-l text-olive-d">
        <Lock className="size-8" />
      </div>
      {phase === "setup" && (
        <SetupForm
          onDone={(c) => {
            setCode(c);
            setPhase("code");
          }}
        />
      )}
      {phase === "locked" && <UnlockForm onOpen={() => setPhase("open")} onForgot={() => setPhase("forgot")} />}
      {phase === "forgot" && (
        <ForgotForm
          onBack={() => setPhase("locked")}
          onDone={(c) => {
            setCode(c);
            setPhase("code");
          }}
        />
      )}
      {phase === "code" && <ShowCode code={code} onContinue={() => setPhase("open")} />}
    </div>
  );
}

function SetupForm({ onDone }: { onDone: (code: string) => void }) {
  const { t } = useI18n();
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!auth.isValidPin(pin)) return setError(t("pinInvalid"));
    if (auth.normalizePin(pin) !== auth.normalizePin(again)) return setError(t("pinMismatch"));
    setBusy(true);
    try {
      onDone(await auth.setupPin(pin));
    } catch {
      setError(t("error"));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <h1 className="mb-1 text-2xl font-extrabold">{t("createPin")}</h1>
      <p className="mb-5 text-muted">{t("pinHelp")}</p>
      <Field label={t("pin")}>
        <PinInput value={pin} onChange={setPin} autoFocus />
      </Field>
      <Field label={t("pinRepeat")} error={error}>
        <PinInput value={again} onChange={setAgain} />
      </Field>
      <Button type="submit" disabled={busy} className="w-full">
        {t("save")}
      </Button>
    </form>
  );
}

function useCountdown() {
  const [wait, setWait] = useState(0);
  useEffect(() => {
    if (wait <= 0) return;
    const id = setInterval(() => setWait((w) => Math.max(0, w - 1)), 1000);
    return () => clearInterval(id);
  }, [wait > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  return [wait, setWait] as const;
}

function UnlockForm({ onOpen, onForgot }: { onOpen: () => void; onForgot: () => void }) {
  const { t } = useI18n();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useCountdown();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || wait > 0 || !pin) return;
    setBusy(true);
    try {
      const r = await auth.verifyPin(pin);
      if (r.ok) return onOpen();
      setPin("");
      setWait(r.waitSeconds);
      setError(t("wrongPin"));
    } catch {
      setError(t("error"));
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit}>
      <h1 className="mb-1 text-2xl font-extrabold">{t("dashboard")}</h1>
      <p className="mb-5 text-muted">{t("dashSub")}</p>
      <Field label={t("pin")} error={wait > 0 ? `${t("tooManyTries")}: ${toArabicDigits(String(wait))} ${t("seconds")}` : error}>
        <PinInput value={pin} onChange={setPin} autoFocus />
      </Field>
      <Button type="submit" disabled={busy || wait > 0 || !pin} className="w-full">
        {t("unlock")}
      </Button>
      <button type="button" onClick={onForgot} className="mt-4 w-full text-center text-olive-d underline">
        {t("forgotPin")}
      </button>
    </form>
  );
}

function ForgotForm({ onBack, onDone }: { onBack: () => void; onDone: (code: string) => void }) {
  const { t } = useI18n();
  const [recovery, setRecovery] = useState("");
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!auth.isValidPin(pin)) return setError(t("pinInvalid"));
    if (auth.normalizePin(pin) !== auth.normalizePin(again)) return setError(t("pinMismatch"));
    setBusy(true);
    try {
      const fresh = await auth.resetPinWithRecovery(recovery, pin);
      if (!fresh) {
        setError(t("recoveryWrong"));
        setBusy(false);
        return;
      }
      onDone(fresh);
    } catch {
      setError(t("error"));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <h1 className="mb-1 text-2xl font-extrabold">{t("forgotPin")}</h1>
      <p className="mb-5 text-muted">{t("recoveryHelp")}</p>
      <Field label={t("recoveryCode")}>
        <input
          className={`${inputCls} text-center font-mono uppercase tracking-wider`}
          dir="ltr"
          autoFocus
          autoComplete="off"
          value={recovery}
          onChange={(e) => setRecovery(e.target.value)}
        />
      </Field>
      <Field label={t("newPin")}>
        <PinInput value={pin} onChange={setPin} />
      </Field>
      <Field label={t("pinRepeat")} error={error}>
        <PinInput value={again} onChange={setAgain} />
      </Field>
      <Button type="submit" disabled={busy || !recovery.trim()} className="w-full">
        {t("resetPin")}
      </Button>
      <button type="button" onClick={onBack} className="mt-4 w-full text-center text-olive-d underline">
        {t("back")}
      </button>
    </form>
  );
}

function ShowCode({ code, onContinue }: { code: string; onContinue: () => void }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      /* the owner can still write it down */
    }
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-extrabold">{t("recoveryTitle")}</h1>
      <p className="mb-4 rounded-2xl bg-warn-l p-3 text-warn">{t("recoveryWarn")}</p>
      <div dir="ltr" className="mb-3 select-all break-words rounded-2xl bg-olive-l p-4 text-center font-mono text-2xl font-bold tracking-wider text-olive-d">
        {code}
      </div>
      <Button type="button" variant="secondary" onClick={copy} className="mb-4 w-full">
        {copied ? <Check className="size-5" /> : <Copy className="size-5" />} {copied ? t("copied") : t("copy")}
      </Button>
      <label className="mb-4 flex cursor-pointer items-center gap-3 text-lg">
        <input type="checkbox" className="size-6 accent-olive" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        {t("savedIt")}
      </label>
      <Button onClick={onContinue} disabled={!confirmed} className="w-full">
        {t("done")}
      </Button>
    </div>
  );
}

/* ---------- the dashboard itself ---------- */

function Stat({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone?: "good" | "bad" | "warn" }) {
  const { t } = useI18n();
  const color = tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "";
  return (
    <div className="rounded-3xl bg-white p-5 shadow-sm">
      <div className="text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-extrabold ${color}`}>
        <bdi dir="ltr">
          {value < 0 && "−"}
          {formatNumber(Math.abs(value))}
        </bdi>{" "}
        <span className="text-base font-bold">{t("currency")}</span>
      </div>
      {hint && <div className="mt-0.5 text-sm text-muted">{hint}</div>}
    </div>
  );
}

function DashboardView({ onLock }: { onLock: () => void }) {
  const { t } = useI18n();
  const months = t("months").split(",");
  const label = (m: string) => `${months[Number(m.slice(5)) - 1]} ${toArabicDigits(m.slice(0, 4))}`;
  const [month, setMonth] = useState(currentMonth);
  const [data, setData] = useState<DashData | null>(null);
  const [error, setError] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);

  const load = useCallback(async (m: string) => {
    try {
      setData(await getDashboard(m));
      setError(false);
    } catch {
      setError(true);
    }
  }, []);
  useEffect(() => {
    void load(month);
  }, [month, load]);

  // Lock again after 5 minutes without any activity.
  useEffect(() => {
    let timer = setTimeout(onLock, IDLE_LOCK_MS);
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(onLock, IDLE_LOCK_MS);
    };
    const events = ["mousemove", "keydown", "click", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, reset));
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [onLock]);

  const maxBar = Math.max(1, ...(data?.trend.map((x) => x.total) ?? [0]));
  const bestMax = Math.max(1, ...(data?.best.map((x) => x.total) ?? [0]));

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="mb-1 text-3xl font-extrabold">{t("dashboard")}</h1>
          <p className="text-muted">{t("dashSub")}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setSecurityOpen(true)}>
            <ShieldCheck className="size-5" /> {t("security")}
          </Button>
          <Button variant="secondary" onClick={onLock}>
            <Lock className="size-5" /> {t("lock")}
          </Button>
        </div>
      </div>

      <div className="mb-5 flex items-center gap-3">
        <Button variant="secondary" onClick={() => setMonth(shiftMonth(month, -1))} aria-label={t("prevMonth")} title={t("prevMonth")}>
          <ChevronRight className="size-5" />
        </Button>
        <div className="min-w-56 rounded-2xl bg-white px-6 py-3 text-center text-xl font-extrabold shadow-sm">{label(month)}</div>
        <Button variant="secondary" onClick={() => setMonth(shiftMonth(month, 1))} aria-label={t("nextMonth")} title={t("nextMonth")}>
          <ChevronLeft className="size-5" />
        </Button>
        {month !== currentMonth() && (
          <Button variant="ghost" onClick={() => setMonth(currentMonth())}>
            {label(currentMonth())}
          </Button>
        )}
      </div>

      {error && <p className="mb-4 rounded-2xl bg-bad-l p-4 text-bad">{t("error")}</p>}

      {data && (
        <>
          <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label={t("statSales")} value={data.sales} />
            <Stat label={t("statGross")} value={data.gross} hint={t("salesMinusCost")} />
            <Stat label={t("statCosts")} value={data.costs} />
            <Stat label={t("statNet")} value={data.net} hint={t("afterCosts")} tone={data.net >= 0 ? "good" : "bad"} />
          </div>
          <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label={t("statStock")} value={data.stockValue} hint={`${t("byBuyCost")} · ${t("nowLabel")}`} />
            <Stat
              label={t("statDebt")}
              value={data.debt}
              hint={`${formatNumber(data.debtors)} ${t("debtorsCount")} · ${t("nowLabel")}`}
              tone={data.debt > 0 ? "bad" : undefined}
            />
            <Stat label={t("refundsTotal")} value={data.refundsDue} hint={t("nowLabel")} tone={data.refundsDue > 0 ? "warn" : undefined} />
            <Stat
              label={t("statSupplierDebt")}
              value={data.supplierDebt}
              hint={`${formatNumber(data.suppliersOwed)} ${t("suppliersOwedCount")} · ${t("nowLabel")}`}
              tone={data.supplierDebt > 0 ? "bad" : undefined}
            />
          </div>

          <div className="grid items-start gap-5 lg:grid-cols-[1.5fr_1fr]">
            <div className="rounded-3xl bg-white p-6 shadow-sm">
              <b className="text-lg">{t("last6")}</b>
              <div className="mt-4 flex h-52 items-end gap-3">
                {data.trend.map((x) => (
                  <div key={x.month} className="flex h-full flex-1 flex-col items-center justify-end gap-2" title={`${label(x.month)}: ${formatNumber(x.total)}`}>
                    <span className="text-xs text-muted">{x.total ? formatNumber(x.total) : ""}</span>
                    <div
                      className={`w-full rounded-t-xl ${x.month === month ? "bg-olive" : "bg-olive/45"}`}
                      style={{ height: `${Math.max(x.total ? 4 : 1, (x.total / maxBar) * 75)}%` }}
                    />
                    <span className="text-center text-sm text-muted">{months[Number(x.month.slice(5)) - 1]}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-3xl bg-white p-6 shadow-sm">
              <b className="text-lg">{t("bestSellers")}</b>
              {data.best.length === 0 ? (
                <p className="mt-4 text-muted">{t("noData")}</p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {data.best.map((b) => (
                    <li key={b.item_id}>
                      <div className="flex justify-between gap-2">
                        <span className="font-medium">{b.name}</span>
                        <b>{formatNumber(b.total)}</b>
                      </div>
                      <div className="mt-1 h-2 rounded-full bg-olive-l">
                        <div className="h-2 rounded-full bg-olive" style={{ width: `${(b.total / bestMax) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}

      {securityOpen && <SecurityModal onClose={() => setSecurityOpen(false)} />}
    </div>
  );
}

/* ---------- change PIN / new recovery code (both ask for the current PIN) ---------- */

function SecurityModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"menu" | "change" | "recovery" | "code">("menu");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [wait, setWait] = useCountdown();

  const reset = () => {
    setCurrent("");
    setNext("");
    setAgain("");
    setError("");
  };

  async function changePin(e: React.FormEvent) {
    e.preventDefault();
    if (!auth.isValidPin(next)) return setError(t("pinInvalid"));
    if (auth.normalizePin(next) !== auth.normalizePin(again)) return setError(t("pinMismatch"));
    setBusy(true);
    try {
      const r = await auth.changePin(current, next);
      if (r.ok) {
        reset();
        setOkMsg(t("pinChanged"));
        setMode("menu");
      } else {
        setWait(r.waitSeconds);
        setError(t("wrongPin"));
      }
    } catch {
      setError(t("error"));
    }
    setBusy(false);
  }

  async function renew(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await auth.newRecoveryCode(current);
      if (r.ok) {
        reset();
        setCode(r.code);
        setMode("code");
      } else {
        setWait(r.waitSeconds);
        setError(t("wrongPin"));
      }
    } catch {
      setError(t("error"));
    }
    setBusy(false);
  }

  const waitMsg = wait > 0 ? `${t("tooManyTries")}: ${toArabicDigits(String(wait))} ${t("seconds")}` : error;

  return (
    // While a new recovery code is on screen the dialog only closes with "done", so the code cannot be lost by a stray click.
    <Modal title={t("security")} onClose={mode === "code" ? () => {} : onClose}>
      {mode === "menu" && (
        <div className="space-y-3">
          {okMsg && <p className="flex items-center gap-2 rounded-xl bg-good-l p-3 font-bold text-good"><Check className="size-5" /> {okMsg}</p>}
          <Button variant="secondary" className="w-full" onClick={() => { reset(); setOkMsg(""); setMode("change"); }}>
            <KeyRound className="size-5" /> {t("changePin")}
          </Button>
          <Button variant="secondary" className="w-full" onClick={() => { reset(); setOkMsg(""); setMode("recovery"); }}>
            <ShieldCheck className="size-5" /> {t("newRecovery")}
          </Button>
        </div>
      )}
      {mode === "change" && (
        <form onSubmit={changePin}>
          <Field label={t("currentPin")}>
            <PinInput value={current} onChange={setCurrent} autoFocus />
          </Field>
          <Field label={t("newPin")}>
            <PinInput value={next} onChange={setNext} />
          </Field>
          <Field label={t("pinRepeat")} error={waitMsg}>
            <PinInput value={again} onChange={setAgain} />
          </Field>
          <Button type="submit" disabled={busy || wait > 0 || !current} className="w-full">
            {t("save")}
          </Button>
        </form>
      )}
      {mode === "recovery" && (
        <form onSubmit={renew}>
          <p className="mb-4 text-muted">{t("newRecoveryHelp")}</p>
          <Field label={t("currentPin")} error={waitMsg}>
            <PinInput value={current} onChange={setCurrent} autoFocus />
          </Field>
          <Button type="submit" disabled={busy || wait > 0 || !current} className="w-full">
            {t("newRecovery")}
          </Button>
        </form>
      )}
      {mode === "code" && <ShowCode code={code} onContinue={() => { setCode(""); setMode("menu"); }} />}
    </Modal>
  );
}
