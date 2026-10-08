// Months are 'YYYY-MM' in the owner's LOCAL time.

export const pad = (n: number) => String(n).padStart(2, "0");

export const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};

export const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};

/** Local calendar month of an ISO timestamp (timestamps in the database are UTC). */
export const monthOf = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};

/** [start, end) of a local month as UTC ISO strings, for `created_at >= start AND created_at < end`. */
export function monthRange(month: string): [string, string] {
  const [y, m] = month.split("-").map(Number);
  return [new Date(y, m - 1, 1).toISOString(), new Date(y, m, 1).toISOString()];
}
