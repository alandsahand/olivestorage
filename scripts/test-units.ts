// Run: npm test — buying unit vs storing unit: 100 kg bought fill 200 jars (docs/flow.md section 7).
import { eq, finish, freshDb, throws } from "./testkit.ts";
freshDb();
import * as stock from "../src/data/stock.ts";
import * as pur from "../src/data/purchases.ts";
import * as sales from "../src/data/sales.ts";
import { reverseRatio, storePerBuy, storedFromBought } from "../src/lib/units.ts";

/* ---------- the math ---------- */

eq("1 kg = 2 jar: 100 kg -> 200 jar", storedFromBought(100000, 2000, "buy"), 200000);
eq("1 jar = 0.5 kg: 100 kg -> 200 jar (same thing written the other way)", storedFromBought(100000, 500, "store"), 200000);
eq("1 box = 12 jar: 3 boxes -> 36 jar", storedFromBought(3000, 12000, "buy"), 36000);
eq("1 sack = 50 kg: 2.5 sacks -> 125 kg", storedFromBought(2500, 50000, "buy"), 125000);
eq("1 jar = 0.3 kg: 10 kg -> 33.333 jar (rounded to a thousandth)", storedFromBought(10000, 300, "store"), 33333);
eq("decimal reference: 1 kg = 1.5 jar", storedFromBought(4000, 1500, "buy"), 6000);
eq("reverse of 1 kg = 2 jar is 1 jar = 0.5 kg", reverseRatio(2000), 500);
eq("reverse of 1 box = 12 jar is 1 jar = 0.083 box", reverseRatio(12000), 83);
eq("store units per buying unit, both ways", [storePerBuy(2000, "buy"), storePerBuy(500, "store")], [2, 2]);
eq("nothing bought / no reference -> nothing", [storedFromBought(0, 2000, "buy"), storedFromBought(1000, 0, "buy")], [0, 0]);

/* ---------- items remember the reference ---------- */

const jar = await stock.addUnit("jar");
const kg = await stock.addUnit("kg");
const box = await stock.addUnit("box");
const olives = await stock.saveItem({ name: "Olives", category_id: null, unit_id: jar, default_sell_price: 4000, buy: { unit_id: kg, ratio_milli: 2000, dir: "buy" } });
const pickles = await stock.saveItem({ name: "Pickles", category_id: null, unit_id: jar, default_sell_price: 3000, buy: { unit_id: box, ratio_milli: 12000, dir: "buy" } });
const oil = await stock.saveItem({ name: "Oil", category_id: null, unit_id: kg, default_sell_price: 9000 });
const item = async (id: number) => (await stock.listItems()).find((i) => i.id === id)!;
let o = await item(olives);
eq("item keeps its reference", [o.unit_name, o.buy_unit_name, o.buy_ratio_milli, o.buy_ratio_dir], ["jar", "kg", 2000, "buy"]);
eq("an item without a reference has none", (await item(oil)).buy_unit_id, null);
await throws("buying unit cannot be the store unit", () =>
  stock.saveItem({ name: "X", category_id: null, unit_id: jar, default_sell_price: 1, buy: { unit_id: jar, ratio_milli: 1000, dir: "buy" } }), "invalid amount");
await throws("reference must be above zero", () =>
  stock.saveItem({ name: "X", category_id: null, unit_id: jar, default_sell_price: 1, buy: { unit_id: kg, ratio_milli: 0, dir: "buy" } }), "invalid amount");
await stock.saveItem({ id: olives, name: "Olives", category_id: null, unit_id: jar, default_sell_price: 4000, buy: { unit_id: kg, ratio_milli: 500, dir: "store" } });
o = await item(olives);
eq("reference can be written the other way", [o.buy_ratio_milli, o.buy_ratio_dir], [500, "store"]);
await stock.saveItem({ id: oil, name: "Oil", category_id: null, unit_id: kg, default_sell_price: 9000, buy: null });
eq("switch off keeps the item without a reference", (await item(oil)).buy_unit_id, null);

/* ---------- buying: kilos in, jars into stock ---------- */

const p = await pur.createPurchase({
  supplier_name: "Hawler",
  paid: 532000,
  extras: [{ name: "Jars", amount: 20000 }, { name: "Delivery", amount: 12000 }],
  // 100 kg bought; the reference says 200 jars, but only 196 were filled
  lines: [{ item_id: olives, qty_milli: 196000, paid: 500000, fixed_unit: null, buy: { unit_id: kg, qty_milli: 100000 } }],
});
let d = (await pur.getPurchase(p))!;
eq("stock goes up in jars (what was really filled)", (await item(olives)).on_hand_milli, 196000);
eq("the purchase keeps what was bought", [d.lines[0].qty_milli, d.lines[0].buy_qty_milli, d.lines[0].buy_unit_name], [196000, 100000, "kg"]);
eq("real price per JAR includes the jars and delivery: 532,000 / 196", d.lines[0].buy_price, Math.round(532000 / 196));
eq("…and per kg it is 5,320", Math.round((d.lines[0].cost_total * 1000) / (d.lines[0].buy_qty_milli as number)), 5320);

await stock.saveItem({ id: olives, name: "Olives", category_id: null, unit_id: jar, default_sell_price: 4000, buy: { unit_id: kg, ratio_milli: 3000, dir: "buy" } });
d = (await pur.getPurchase(p))!;
eq("changing the item's reference later does not change the saved purchase", [d.lines[0].qty_milli, d.lines[0].buy_qty_milli], [196000, 100000]);

const two = await pur.createPurchase({
  supplier_name: "",
  paid: 72000,
  extras: [],
  lines: [
    { item_id: pickles, qty_milli: 36000, paid: 60000, fixed_unit: null, buy: { unit_id: box, qty_milli: 3000 } },
    { item_id: oil, qty_milli: 2000, paid: 12000, fixed_unit: null }, // same unit: no buy info
  ],
});
d = (await pur.getPurchase(two))!;
eq("mixed purchase: boxes -> jars and kg -> kg", d.lines.map((l) => [l.qty_milli, l.buy_qty_milli, l.buy_unit_name]), [[36000, 3000, "box"], [2000, null, null]]);
eq("price per jar of pickles: 60,000 / 36", d.lines[0].buy_price, Math.round(60000 / 36));

await pur.updatePurchase(two, {
  supplier_name: "",
  paid: 72000,
  extras: [],
  lines: [
    { item_id: pickles, qty_milli: 35000, paid: 60000, fixed_unit: null, buy: { unit_id: box, qty_milli: 3000 } }, // one jar broke
    { item_id: oil, qty_milli: 2000, paid: 12000, fixed_unit: null },
  ],
});
d = (await pur.getPurchase(two))!;
eq("editing keeps the bought amount and the corrected stored amount", [d.lines[0].qty_milli, d.lines[0].buy_qty_milli], [35000, 3000]);
eq("stock follows the edit", (await item(pickles)).on_hand_milli, 35000);
await throws("bought amount must be above zero", () =>
  pur.createPurchase({ supplier_name: "", paid: 1000, extras: [], lines: [{ item_id: pickles, qty_milli: 1000, paid: 1000, fixed_unit: null, buy: { unit_id: box, qty_milli: 0 } }] }), "invalid amount");

/* ---------- selling stays in jars ---------- */

const s = await sales.createSale({ client_name: "Aso", paid: 0, lines: [{ item_id: olives, qty_milli: 10000, unit_price: 4000 }] });
eq("selling 10 jars uses the per-jar cost", (await sales.getSale(s))!.lines[0].buy_price, Math.round(532000 / 196));
eq("jars left", (await item(olives)).on_hand_milli, 186000);

finish();
