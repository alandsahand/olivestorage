import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "ckb" | "ar";

const ckb = {
  appName: "کۆگای زەیتوون",
  sell: "فرۆشتن",
  stock: "کۆگا",
  debts: "قەرزەکان",
  costs: "خەرجی مانگانە",
  dashboard: "داشبۆرد",
  soon: "بەمزووانە دروست دەکرێت",
  dbOk: "داتابەیس ئامادەیە",
  dbError: "هەڵە لە داتابەیس",
  // stock
  stockSub: "هەموو ئەوەی هەتە، ڕیزبەندکراو بە پۆل.",
  newItem: "کاڵای نوێ",
  editItem: "دەستکاری کاڵا",
  search: "بگەڕێ بۆ کاڵا...",
  all: "هەموو",
  newCategory: "پۆلی نوێ",
  manage: "ڕێکخستنی پۆل و یەکە",
  categories: "پۆلەکان",
  units: "یەکەکان",
  item: "کاڵا",
  category: "پۆل",
  noCategory: "بێ پۆل",
  onHand: "ماوە",
  buyPrice: "نرخی کڕین",
  sellPrice: "نرخی فرۆشتن",
  defaultSellPrice: "نرخی فرۆشتنی ئاسایی",
  receive: "وەرگرتنی کاڵا",
  deliveries: "وەرگیراوەکان",
  qty: "بڕ",
  date: "بەروار",
  name: "ناو",
  unit: "یەکە",
  newUnit: "یەکەی نوێ",
  addNew: "＋ زیادکردنی نوێ",
  add: "زیادکردن",
  pick: "هەڵبژێرە...",
  save: "پاشەکەوت",
  cancel: "پاشگەزبوونەوە",
  close: "داخستن",
  edit: "دەستکاری",
  rename: "ناوگۆڕین",
  archive: "شاردنەوە",
  voidDelivery: "هەڵوەشاندنەوە",
  cancelled: "هەڵوەشێنراوەتەوە",
  outOfStock: "تەواو بووە",
  empty: "هیچ کاڵایەک نییە. یەکەم کاڵا زیاد بکە.",
  emptyFilter: "هیچ کاڵایەک نەدۆزرایەوە.",
  required: "ئەمە پێویستە",
  invalidNumber: "ژمارەیەکی دروست بنووسە",
  duplicate: "ئەم ناوە پێشتر هەیە",
  error: "کێشەیەک ڕوویدا. دووبارە هەوڵبدەرەوە.",
  confirmVoid: "دڵنیایت لە هەڵوەشاندنەوەی ئەم وەرگرتنە؟ بڕی کاڵا لە کۆگا کەم دەبێتەوە.",
  confirmArchive: "دڵنیایت لە شاردنەوەی ئەم کاڵایە؟ مێژووی کڕین و فرۆشتن دەمێنێتەوە.",
  confirmArchiveNamed: "دڵنیایت لە شاردنەوە؟ ئەو کاڵایانەی بەکاریان دەهێنن دەمێننەوە.",
  newOnHand: "دوای وەرگرتن لە کۆگا دەبێت",
  currency: "د.ع",
  yes: "بەڵێ",
  // sell
  sellSub: "کڕیار هەڵبژێرە، کاڵا زیاد بکە، تەواو.",
  newSale: "فرۆشتنی نوێ",
  salesHistory: "فرۆشتنەکان",
  client: "کڕیار",
  clientPlaceholder: "ناوی کڕیار بنووسە",
  invoiceItems: "کاڵاکان",
  pickItemHint: "کاڵایەک هەڵبژێرە بۆ زیادکردن",
  price: "نرخ",
  lineTotal: "کۆ",
  total: "کۆی گشتی",
  paid: "چەندی دا؟",
  payAll: "هەمووی دا",
  debtLeft: "قەرز دەمێنێتەوە",
  saveSale: "فرۆشتن تۆمار بکە",
  printSoon: "چاپکردن (بەمزووانە)",
  saleSaved: "فرۆشتن تۆمار کرا",
  emptyInvoice: "هیچ کاڵایەک زیاد نەکراوە",
  clientRequired: "ناوی کڕیار پێویستە",
  paidTooMuch: "ناتوانرێت لە کۆی گشتی زیاتر بێت",
  notEnoughStock: "لە کۆگا ئەوەندە نییە",
  availableQty: "ماوە",
  conflict: "ئەم فرۆشتنە گۆڕدرا. دووبارە بیکەرەوە.",
  editingSale: "دەستکاری فرۆشتن",
  stopEditing: "وازهێنان لە دەستکاری",
  cancelSale: "هەڵوەشاندنەوەی فرۆشتن",
  confirmCancelSale: "دڵنیایت لە هەڵوەشاندنەوەی ئەم فرۆشتنە؟ کاڵاکان دەگەڕێنەوە بۆ کۆگا و قەرزەکەی لادەچێت.",
  debt: "قەرز",
  noSales: "هێشتا هیچ فرۆشتنێک نییە.",
  remove: "لابردن",
  fullyPaid: "تەواو",
} as const;

export type Key = keyof typeof ckb;

const ar: Record<Key, string> = {
  appName: "مخزن الزيتون",
  sell: "البيع",
  stock: "المخزن",
  debts: "الديون",
  costs: "المصاريف الشهرية",
  dashboard: "لوحة التحكم",
  soon: "قيد الإنشاء",
  dbOk: "قاعدة البيانات جاهزة",
  dbError: "خطأ في قاعدة البيانات",
  stockSub: "كل ما لديك، مرتب حسب الفئة.",
  newItem: "صنف جديد",
  editItem: "تعديل الصنف",
  search: "ابحث عن صنف...",
  all: "الكل",
  newCategory: "فئة جديدة",
  manage: "إدارة الفئات والوحدات",
  categories: "الفئات",
  units: "الوحدات",
  item: "الصنف",
  category: "الفئة",
  noCategory: "بدون فئة",
  onHand: "المتوفر",
  buyPrice: "سعر الشراء",
  sellPrice: "سعر البيع",
  defaultSellPrice: "سعر البيع الافتراضي",
  receive: "استلام بضاعة",
  deliveries: "الاستلامات",
  qty: "الكمية",
  date: "التاريخ",
  name: "الاسم",
  unit: "الوحدة",
  newUnit: "وحدة جديدة",
  addNew: "＋ إضافة جديد",
  add: "إضافة",
  pick: "اختر...",
  save: "حفظ",
  cancel: "إلغاء",
  close: "إغلاق",
  edit: "تعديل",
  rename: "إعادة تسمية",
  archive: "إخفاء",
  voidDelivery: "إلغاء الاستلام",
  cancelled: "ملغى",
  outOfStock: "نفد",
  empty: "لا توجد أصناف. أضف أول صنف.",
  emptyFilter: "لم يتم العثور على أصناف.",
  required: "هذا الحقل مطلوب",
  invalidNumber: "أدخل رقماً صحيحاً",
  duplicate: "هذا الاسم موجود مسبقاً",
  error: "حدث خطأ. حاول مرة أخرى.",
  confirmVoid: "هل أنت متأكد من إلغاء هذا الاستلام؟ ستنقص الكمية من المخزن.",
  confirmArchive: "هل أنت متأكد من إخفاء هذا الصنف؟ يبقى سجل الشراء والبيع.",
  confirmArchiveNamed: "هل أنت متأكد من الإخفاء؟ الأصناف التي تستخدمه تبقى كما هي.",
  newOnHand: "سيصبح المتوفر بعد الاستلام",
  currency: "د.ع",
  yes: "نعم",
  sellSub: "اختر الزبون، أضف الأصناف، وانتهى.",
  newSale: "بيع جديد",
  salesHistory: "المبيعات",
  client: "الزبون",
  clientPlaceholder: "اكتب اسم الزبون",
  invoiceItems: "الأصناف",
  pickItemHint: "اختر صنفاً لإضافته",
  price: "السعر",
  lineTotal: "المجموع",
  total: "الإجمالي",
  paid: "كم دفع؟",
  payAll: "دفع الكل",
  debtLeft: "المتبقي دين",
  saveSale: "تسجيل البيع",
  printSoon: "طباعة (قريباً)",
  saleSaved: "تم تسجيل البيع",
  emptyInvoice: "لم تتم إضافة أي صنف",
  clientRequired: "اسم الزبون مطلوب",
  paidTooMuch: "لا يمكن أن يكون أكبر من الإجمالي",
  notEnoughStock: "الكمية غير متوفرة في المخزن",
  availableQty: "المتوفر",
  conflict: "تم تغيير هذا البيع. افتحه من جديد.",
  editingSale: "تعديل البيع",
  stopEditing: "إلغاء التعديل",
  cancelSale: "إلغاء البيع",
  confirmCancelSale: "هل أنت متأكد من إلغاء هذا البيع؟ سترجع الأصناف إلى المخزن ويُلغى الدين.",
  debt: "الدين",
  noSales: "لا توجد مبيعات بعد.",
  remove: "حذف",
  fullyPaid: "مدفوع",
};

const dict = { ckb, ar } as const;

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
