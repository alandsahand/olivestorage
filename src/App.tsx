import { useEffect, useState } from "react";
import { HashRouter, NavLink, Route, Routes } from "react-router-dom";
import { BarChart3, Lock, Package, Receipt, ShoppingCart, Zap, type LucideIcon } from "lucide-react";
import { useI18n, type Key } from "@/i18n";
import { checkDb } from "@/db";
import Stock from "@/pages/Stock";
import Sell from "@/pages/Sell";
import Debts from "@/pages/Debts";

type Page = { path: string; key: Key; icon: LucideIcon; locked?: boolean };

const pages: Page[] = [
  { path: "/", key: "sell", icon: ShoppingCart },
  { path: "/stock", key: "stock", icon: Package },
  { path: "/debts", key: "debts", icon: Receipt },
  { path: "/costs", key: "costs", icon: Zap },
  { path: "/dashboard", key: "dashboard", icon: BarChart3, locked: true },
];

function Placeholder({ title }: { title: Key }) {
  const { t } = useI18n();
  const [db, setDb] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    checkDb()
      .then(() => setDb("ok"))
      .catch(() => setDb("error"));
  }, []);

  return (
    <div>
      <h1 className="mb-1 text-3xl font-extrabold">{t(title)}</h1>
      <p className="mb-6 text-muted">{t("soon")}</p>
      {db !== "loading" && (
        <span
          className={`inline-block rounded-full px-4 py-1 text-sm font-bold ${
            db === "ok" ? "bg-good-l text-good" : "bg-bad-l text-bad"
          }`}
        >
          {db === "ok" ? t("dbOk") : t("dbError")}
        </span>
      )}
    </div>
  );
}

function Sidebar() {
  const { t, lang, setLang } = useI18n();
  return (
    <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col gap-2 bg-olive-d p-4 text-white">
      <div className="flex items-center gap-3 px-3 pb-6 pt-1 text-2xl font-extrabold">
        <div className="grid size-11 place-items-center rounded-2xl bg-white/15 text-2xl">🫒</div>
        {t("appName")}
      </div>
      {pages.map(({ path, key, icon: Icon, locked }) => (
        <NavLink
          key={path}
          to={path}
          end={path === "/"}
          className={({ isActive }) =>
            `flex items-center gap-3.5 rounded-2xl px-4 py-3.5 font-medium transition ${
              isActive ? "bg-white font-bold text-olive-d" : "text-olive-l hover:bg-white/10"
            }`
          }
        >
          <Icon className="size-6" />
          <span className="flex-1">{t(key)}</span>
          {locked && <Lock className="size-4 opacity-70" />}
        </NavLink>
      ))}
      <div className="flex-1" />
      <div className="flex gap-1.5 rounded-xl bg-black/20 p-1 text-sm">
        {(["ckb", "ar"] as const).map((l) => (
          <button
            key={l}
            onClick={() => setLang(l)}
            className={`flex-1 rounded-lg py-2 ${lang === l ? "bg-white font-bold text-olive-d" : ""}`}
          >
            {l === "ckb" ? "کوردی" : "العربية"}
          </button>
        ))}
      </div>
    </aside>
  );
}

export default function App() {
  return (
    <HashRouter>
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="w-full max-w-[1100px] flex-1 px-10 py-8">
          <Routes>
            {pages.map((p) => (
              <Route
                key={p.path}
                path={p.path}
                element={
                  p.path === "/stock" ? (
                    <Stock />
                  ) : p.path === "/" ? (
                    <Sell />
                  ) : p.path === "/debts" ? (
                    <Debts />
                  ) : (
                    <Placeholder title={p.key} />
                  )
                }
              />
            ))}
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}
