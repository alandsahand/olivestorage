// Buying unit vs storing unit (docs/flow.md section 7). Quantities are thousandths (qty_milli), like everywhere.
import { formatQty } from "./format";
//   dir "buy"   : "1 kg = 2 jar"   -> ratio_milli = 2000 (store units per ONE buying unit)
//   dir "store" : "1 jar = 0.5 kg" -> ratio_milli = 500  (buying units per ONE store unit)

export type RatioDir = "buy" | "store";
export type BuyRef = { unit_id: number; ratio_milli: number; dir: RatioDir };

/** Store units per ONE buying unit, as a plain number (2 for "1 kg = 2 jar" and for "1 jar = 0.5 kg"). */
export const storePerBuy = (ratio_milli: number, dir: RatioDir) => (dir === "buy" ? ratio_milli / 1000 : 1000 / ratio_milli);

/** How much is stored (thousandths of the store unit) when `buy_qty_milli` of the buying unit is bought. */
export function storedFromBought(buy_qty_milli: number, ratio_milli: number, dir: RatioDir): number {
  if (!(ratio_milli > 0) || !(buy_qty_milli > 0)) return 0;
  return dir === "buy" ? Math.round((buy_qty_milli * ratio_milli) / 1000) : Math.round((buy_qty_milli * 1000) / ratio_milli);
}

/** The same reference written the other way round, in thousandths ("1 kg = 2 jar" -> "1 jar = 0.5 kg" -> 500). */
export const reverseRatio = (ratio_milli: number) => (ratio_milli > 0 ? Math.round(1_000_000 / ratio_milli) : 0);

/** The reference as the owner wrote it, e.g. "١ کیلۆ = ٢ دەبە" or "١ دەبە = ٠٫٥ کیلۆ". */
export function refText(storeUnit: string, buyUnit: string, ratio_milli: number, dir: RatioDir): string {
  const n = formatQty(ratio_milli);
  return dir === "buy" ? `١ ${buyUnit} = ${n} ${storeUnit}` : `١ ${storeUnit} = ${n} ${buyUnit}`;
}
