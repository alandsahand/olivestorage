import { Component, useEffect, useState, type ReactNode } from "react";
import { TriangleAlert, X } from "lucide-react";
import { useI18n } from "@/i18n";

/** Shows a red banner when any background task fails (a database call nobody caught), instead of failing silently. */
export function ErrorBanner() {
  const { t } = useI18n();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const onReject = (e: PromiseRejectionEvent) => {
      console.error("Unhandled error:", e.reason);
      setShown(true);
    };
    window.addEventListener("unhandledrejection", onReject);
    return () => window.removeEventListener("unhandledrejection", onReject);
  }, []);

  if (!shown) return null;
  return (
    <div role="alert" className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-3 bg-bad px-4 py-3 text-white shadow-lg">
      <TriangleAlert className="size-5" />
      <span className="font-bold">{t("error")}</span>
      <button onClick={() => setShown(false)} aria-label={t("close")} className="rounded-lg p-1 hover:bg-white/20">
        <X className="size-5" />
      </button>
    </div>
  );
}

/** Last line of defence: if a screen crashes while drawing, show a calm message and a reload button, never a blank window. */
function CrashScreen() {
  const { t } = useI18n();
  return (
    <div className="grid min-h-screen place-items-center p-6">
      <div className="max-w-md rounded-3xl bg-white p-8 text-center shadow-sm">
        <TriangleAlert className="mx-auto mb-3 size-12 text-bad" />
        <h1 className="mb-2 text-2xl font-extrabold">{t("crashed")}</h1>
        <p className="mb-5 text-muted">{t("crashedHint")}</p>
        <button onClick={() => location.reload()} className="rounded-2xl bg-olive px-6 py-3.5 text-lg font-bold text-white hover:bg-olive-d">
          {t("reload")}
        </button>
      </div>
    </div>
  );
}

export class CrashGuard extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false };
  static getDerivedStateFromError() {
    return { crashed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("Screen crashed:", error);
  }
  render() {
    return this.state.crashed ? <CrashScreen /> : this.props.children;
  }
}
