import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "ckb" | "ar";

const dict = {
  ckb: {
    appName: "کۆگای زەیتوون",
    sell: "فرۆشتن",
    stock: "کۆگا",
    debts: "قەرزەکان",
    costs: "خەرجی مانگانە",
    dashboard: "داشبۆرد",
    soon: "بەمزووانە دروست دەکرێت",
    dbOk: "داتابەیس ئامادەیە",
    dbError: "هەڵە لە داتابەیس",
  },
  ar: {
    appName: "مخزن الزيتون",
    sell: "البيع",
    stock: "المخزن",
    debts: "الديون",
    costs: "المصاريف الشهرية",
    dashboard: "لوحة التحكم",
    soon: "قيد الإنشاء",
    dbOk: "قاعدة البيانات جاهزة",
    dbError: "خطأ في قاعدة البيانات",
  },
} as const;

export type Key = keyof (typeof dict)["ckb"];

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (k: Key) => string };
const I18n = createContext<Ctx | null>(null);

const STORAGE_KEY = "olive.lang";

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "ar" ? "ar" : "ckb";
    } catch {
      return "ckb";
    }
  });

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = "rtl";
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* ignore */
    }
  }, [lang]);

  return (
    <I18n.Provider value={{ lang, setLang, t: (k) => dict[lang][k] }}>{children}</I18n.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18n);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
