// How a purchase's extra costs (delivery, loading, ...) end up in each item's real unit price.
// Used by the purchase screen (live numbers) AND by the data layer (what is saved), so both always agree.
//
// Rules (owner, 2026-10-09):
//  * real cost of a line = what was paid for it + its share of the extra costs
//  * the extra costs are split EQUALLY per line
//  * the owner may type the real unit price of a line: that line is "fixed" at it, and the other lines
//    share what is left equally, so goods + extra costs always add up to the order total
// Money = whole dinars; quantities = thousandths (qty_milli).

export type SplitLine = { qty_milli: number; paid: number; fixed_unit: number | null };

export type SplitResult = {
  lines: { cost_total: number; unit_price: number }[];
  goods: number; // sum of what was paid for the items
  extras: number; // sum of the extra costs
  total: number; // goods + extras = the order total
  // "too_low": a line would cost nothing or less; "mismatch": every line is fixed and they don't add up to the total
  problem: null | "too_low" | "mismatch";
  diff: number; // for "mismatch": total - sum of the fixed lines
};

const unitOf = (cost: number, qty_milli: number) => (qty_milli > 0 ? Math.round((cost * 1000) / qty_milli) : 0);

export function splitCosts(lines: SplitLine[], extras: number): SplitResult {
  const goods = lines.reduce((s, l) => s + l.paid, 0);
  const total = goods + extras;
  const cost = new Array<number>(lines.length).fill(0);

  const free: number[] = [];
  let fixedSum = 0;
  lines.forEach((l, k) => {
    if (l.fixed_unit !== null) {
      cost[k] = Math.round((l.fixed_unit * l.qty_milli) / 1000);
      fixedSum += cost[k];
    } else free.push(k);
  });

  let problem: SplitResult["problem"] = null;
  let diff = 0;
  if (free.length) {
    // what the free lines carry beyond what was paid for them, split equally (the first lines take the odd dinars)
    const share = total - fixedSum - free.reduce((s, k) => s + lines[k].paid, 0);
    const base = Math.floor(share / free.length);
    let odd = share - base * free.length;
    for (const k of free) {
      cost[k] = lines[k].paid + base + (odd > 0 ? 1 : 0);
      if (odd > 0) odd--;
    }
  } else if (lines.length && fixedSum !== total) {
    problem = "mismatch";
    diff = total - fixedSum;
  }

  const out = lines.map((l, k) => ({
    cost_total: cost[k],
    unit_price: l.fixed_unit !== null ? l.fixed_unit : unitOf(cost[k], l.qty_milli),
  }));
  if (!problem && out.some((o) => o.cost_total <= 0 || o.unit_price <= 0)) problem = "too_low";
  return { lines: out, goods, extras, total, problem, diff };
}
