// Money = whole IQD integers. Quantities = integer thousandths ("milli"), so 2.5 kg = 2500.

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN = "۰۱۲۳۴۵۶۷۸۹";

export const toLatinDigits = (s: string) =>
  s
    .replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(PERSIAN.indexOf(d)));

export const toArabicDigits = (s: string) => s.replace(/[0-9]/g, (d) => ARABIC_INDIC[Number(d)]);

export const formatNumber = (n: number) => toArabicDigits(Math.round(n).toLocaleString("en-US"));

export function parseMoney(s: string): number | null {
  const digits = toLatinDigits(s).replace(/[^0-9]/g, "");
  return digits ? parseInt(digits, 10) : null;
}

/** "2.5" / "2,5" / "٢٫٥" -> 2500. Returns null if empty, zero or invalid. */
export function parseQty(s: string): number | null {
  const clean = toLatinDigits(s).replace(/[٫,،]/g, ".").replace(/[^0-9.]/g, "");
  const f = parseFloat(clean);
  if (!Number.isFinite(f) || f <= 0) return null;
  return Math.round(f * 1000);
}

export function formatQty(milli: number): string {
  const v = milli / 1000;
  const s = Number.isInteger(v)
    ? v.toLocaleString("en-US")
    : v.toLocaleString("en-US", { maximumFractionDigits: 3 });
  return toArabicDigits(s).replace(".", "٫");
}

export function formatDate(iso: string): string {
  return toArabicDigits(new Date(iso).toLocaleDateString("en-GB"));
}

/** Search-friendly form: lowercase, no diacritics, Arabic/Kurdish letter variants unified. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[يیى]/g, "ی")
    .replace(/[كک]/g, "ک")
    .replace(/[ةە]/g, "ە")
    .replace(/[أإآ]/g, "ا")
    .replace(/[هھ]/g, "ه")
    .trim();
}
