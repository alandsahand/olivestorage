// Money = whole IQD integers. Quantities = integer thousandths ("milli"), so 2.5 kg = 2500.

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN = "۰۱۲۳۴۵۶۷۸۹";

export const toLatinDigits = (s: string) =>
  s
    .replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(PERSIAN.indexOf(d)));

export const toArabicDigits = (s: string) => s.replace(/[0-9]/g, (d) => ARABIC_INDIC[Number(d)]);

export const formatNumber = (n: number) => toArabicDigits(Math.round(n).toLocaleString("en-US"));

/** At most 12 digits (999 billion IQD): keeps every amount an exact whole number. */
const MAX_MONEY_DIGITS = 12;

export function parseMoney(s: string): number | null {
  const digits = toLatinDigits(s).replace(/[^0-9]/g, "").slice(0, MAX_MONEY_DIGITS);
  return digits ? parseInt(digits, 10) : null;
}

/** "2.5" / "2,5" / "٢٫٥" -> 2500. Returns null if empty, zero or invalid. */
export function parseQty(s: string): number | null {
  const clean = toLatinDigits(s).replace(/[٫,،]/g, ".").replace(/[^0-9.]/g, "");
  const f = parseFloat(clean);
  if (!Number.isFinite(f) || f <= 0) return null;
  const milli = Math.round(f * 1000);
  return milli > 0 ? milli : null; // e.g. "0.0001" rounds to nothing
}

export function formatQty(milli: number): string {
  const v = milli / 1000;
  const s = Number.isInteger(v)
    ? v.toLocaleString("en-US")
    : v.toLocaleString("en-US", { maximumFractionDigits: 3 });
  return toArabicDigits(s).replace(".", "٫");
}

/** Quantity as editable text: Kurdish digits, "٫" decimal, NO thousands separators (so it parses back exactly). */
export function qtyText(milli: number): string {
  return toArabicDigits(String(milli / 1000)).replace(".", "٫");
}

export function formatDate(iso: string): string {
  return toArabicDigits(new Date(iso).toLocaleDateString("en-GB"));
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return toArabicDigits(`${d.toLocaleDateString("en-GB")} ${time}`);
}

/**
 * Debts search: matches the name (letter variants unified), part of a phone number, or EXACTLY one of the
 * sale/purchase numbers in `ids` ("3,7,12"), so typing 1 does not also find 10, 11, 12 ...
 */
export function matchPerson(query: string, name: string, ids: string, phone?: string | null): boolean {
  const q = normalizeText(query);
  if (!q) return true;
  if (normalizeText(name).includes(q)) return true;
  const digits = toLatinDigits(query).replace(/[^0-9]/g, "");
  if (!digits) return false;
  if (phone && toLatinDigits(phone).replace(/[^0-9]/g, "").includes(digits)) return true;
  return ids.split(",").includes(digits);
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
