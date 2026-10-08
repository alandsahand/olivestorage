import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/i18n";
import { formatNumber, parseMoney } from "@/lib/format";

export const inputCls =
  "w-full rounded-2xl border-2 border-line bg-white px-4 py-3 text-lg outline-none transition focus:border-olive";

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const { t } = useI18n();
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`max-h-[90vh] w-full overflow-auto rounded-3xl bg-white p-6 shadow-2xl ${
          wide ? "max-w-3xl" : "max-w-lg"
        }`}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-2xl font-extrabold">{title}</h2>
          <button onClick={onClose} aria-label={t("close")} className="rounded-xl p-2 hover:bg-bg">
            <X className="size-6" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

type Variant = "primary" | "secondary" | "danger" | "ghost";
const variants: Record<Variant, string> = {
  primary: "bg-olive text-white shadow-md shadow-olive/30 hover:bg-olive-d",
  secondary: "border-2 border-olive bg-white text-olive-d hover:bg-olive-l",
  danger: "border-2 border-bad bg-white text-bad hover:bg-bad-l",
  ghost: "text-olive-d hover:bg-olive-l",
};

export function Button({
  variant = "primary",
  small,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; small?: boolean }) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-2xl font-bold transition disabled:opacity-50 ${
        small ? "px-4 py-2 text-base" : "px-6 py-3.5 text-lg"
      } ${variants[variant]} ${className}`}
    />
  );
}

export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="mb-4 block">
      <span className="mb-1.5 block font-bold">{label}</span>
      {children}
      {error && <span className="mt-1 block text-base text-bad">{error}</span>}
    </label>
  );
}

/** Whole-number IQD input. Shows Kurdish digits with thousands separators while typing. */
export function MoneyInput({
  value,
  onChange,
  autoFocus,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  autoFocus?: boolean;
}) {
  return (
    <input
      className={inputCls}
      inputMode="numeric"
      autoFocus={autoFocus}
      value={value === null ? "" : formatNumber(value)}
      onChange={(e) => onChange(parseMoney(e.target.value))}
    />
  );
}

export function Chip({
  active,
  dashed,
  children,
  onClick,
}: {
  active?: boolean;
  dashed?: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border-2 px-5 py-2.5 font-medium transition ${
        active
          ? "border-olive bg-olive font-bold text-white"
          : `border-line bg-white hover:border-olive ${dashed ? "border-dashed" : ""}`
      }`}
    >
      {children}
    </button>
  );
}

export function ConfirmModal({
  message,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <Modal title={confirmLabel} onClose={onClose}>
      <p className="mb-6 text-lg">{message}</p>
      <div className="flex gap-3">
        <Button variant="danger" onClick={onConfirm} className="flex-1">
          {confirmLabel}
        </Button>
        <Button variant="secondary" onClick={onClose} className="flex-1">
          {t("cancel")}
        </Button>
      </div>
    </Modal>
  );
}
