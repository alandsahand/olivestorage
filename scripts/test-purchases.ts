// Run: npm test — purchases: several items + extra costs split per item, the real unit price,
// editing/cancelling with the "already sold" guard, suppliers and what we owe them.
import { eq, finish, freshDb, throws } from "./testkit.ts";
const sqlite = freshDb();
import * as stock from "../src/data/stock.ts";
import * as sales from "../src/data/sales.ts";
import * as pur from "../src/data/purchases.ts";
import { getDashboard } from "../src/data/dashboard.ts";
import { currentMonth } from "../src/lib/months.ts";
import { splitCosts } from "../src/lib/purchaseMath.ts";

/* ---------- the math ---------- */

const owner = [
  { qty_milli: 100000, paid: 500000, fixed_unit: null }, // olives 100 kg
  { qty_milli: 20000, paid: 760000, fixed_unit: null }, // oil 20 L
  { qty_milli: 30000, paid: 90000, fixed_unit: null }, // pickles 30 boxes
];
let r = splitCosts(owner, 60000);
eq("owner's example: equal share of 20,000 each", r.lines.map((l) => l.cost_total), [520000, 780000, 110000]);
eq("owner's example: real unit prices", r.lines.map((l) => l.unit_price), [5200, 39000, 3667]);
eq("owner's example: totals", [r.goods, r.extras, r.total, r.problem], [1350000, 60000, 1410000, null]);

r = splitCosts([{ ...owner[0] }, { ...owner[1], fixed_unit: 38500 }, { ...owner[2] }], 60000);
eq("fixing oil at 38,500 frees 10,000 for the others", r.lines.map((l) => l.cost_total), [525000, 770000, 115000]);
eq("…and their unit prices go up", r.lines.map((l) => l.unit_price), [5250, 38500, 3833]);
eq("…the order total never changes", r.lines.reduce((s, l) => s + l.cost_total, 0), 1410000);

r = splitCosts(owner, 50000);
eq("odd dinars go to the first lines, nothing is lost", [r.lines.map((l) => l.cost_total), r.lines.reduce((s, l) => s + l.cost_total, 0)], [[516667, 776667, 106666], 1400000]);

r = splitCosts([{ ...owner[0] }, { ...owner[1], fixed_unit: 30000 }, { ...owner[2] }], 60000);
eq("fixing a price BELOW what was paid moves cost to the others", r.lines.map((l) => l.cost_total), [610000, 600000, 200000]);

r = splitCosts([{ ...owner[0], fixed_unit: 14000 }, { ...owner[1] }], 0);
eq("a price that leaves the others at nothing is refused", r.problem, "too_low");
r = splitCosts([{ ...owner[0], fixed_unit: 5000 }, { ...owner[1], fixed_unit: 38000 }], 60000);
eq("every price fixed but not adding up: mismatch", [r.problem, r.diff], ["mismatch", 60000]);
r = splitCosts([{ ...owner[0], fixed_unit: 5000 }, { ...owner[1], fixed_unit: 38000 }], 0);
eq("every price fixed and adding up: fine", r.problem, null);
eq("no extra costs: real price = what was paid", splitCosts([{ qty_milli: 2500, paid: 10000, fixed_unit: null }], 0).lines[0].unit_price, 4000);

/* ---------- saving a purchase ---------- */

const kg = await stock.addUnit("kg");
const litre = await stock.addUnit("L");
const box = await stock.addUnit("box");
const olives = await stock.saveItem({ name: "Olives", category_id: null, unit_id: kg, default_sell_price: 7000 });
const oil = await stock.saveItem({ name: "Oil", category_id: null, unit_id: litre, default_sell_price: 45000 });
const pickles = await stock.saveItem({ name: "Pickles", category_id: null, unit_id: box, default_sell_price: 5000 });
const item = async (id: number) => (await stock.listItems()).find((i) => i.id === id)!;

const old = await stock.receive(olives, 10000, 4000); // an old delivery from before purchases existed
const p1 = await pur.createPurchase({
  supplier_name: "Hawler Olive Co",
  supplier_phone: "0750 123 4567",
  lines: [
    { item_id: olives, qty_milli: 100000, paid: 500000, fixed_unit: null },
    { item_id: oil, qty_milli: 20000, paid: 760000, fixed_unit: null },
    { item_id: pickles, qty_milli: 30000, paid: 90000, fixed_unit: null },
  ],
  extras: [{ name: "Delivery", amount: 40000 }, { name: "Loading", amount: 20000 }, { name: "empty", amount: 0 }],
  paid: 1000000,
});
eq("stock goes up (old delivery still counts)", [(await item(olives)).on_hand_milli, (await item(oil)).on_hand_milli], [110000, 20000]);
eq("item cost = the real unit price", [(await item(olives)).last_buy_price, (await item(oil)).last_buy_price, (await item(pickles)).last_buy_price], [5200, 39000, 3667]);
let d1 = (await pur.getPurchase(p1))!;
eq("purchase: total = goods + extras, paid, owed", [d1.total, d1.paid, d1.debt], [1410000, 1000000, 410000]);
eq("purchase: zero-amount extra lines are dropped", d1.extras.map((x) => [x.name, x.amount]), [["Delivery", 40000], ["Loading", 20000]]);
eq("purchase: supplier and phone saved", [d1.supplier_name, d1.supplier_phone], ["Hawler Olive Co", "0750 123 4567"]);

const sale = await sales.createSale({ client_name: "Aso", paid: 0, lines: [{ item_id: oil, qty_milli: 5000, unit_price: 45000 }] });
eq("a sale takes the real unit price as its cost", (await sales.getSale(sale))!.lines[0].buy_price, 39000);

await throws("not paying all needs a supplier name", () =>
  pur.createPurchase({ supplier_name: " ", lines: [{ item_id: olives, qty_milli: 1000, paid: 5000, fixed_unit: null }], extras: [], paid: 0 }), "supplier required");
const anon = await pur.createPurchase({ supplier_name: "", lines: [{ item_id: olives, qty_milli: 1000, paid: 5000, fixed_unit: null }], extras: [], paid: 5000 });
eq("paid in full: the supplier name may stay empty", (await pur.getPurchase(anon))!.supplier_name, null);
await throws("cannot pay the supplier more than the total", () =>
  pur.createPurchase({ supplier_name: "X", lines: [{ item_id: olives, qty_milli: 1000, paid: 5000, fixed_unit: null }], extras: [], paid: 5001 }), "overpaid");
await throws("a fixed price that leaves the others at nothing is refused", () =>
  pur.createPurchase({ supplier_name: "X", paid: 0, extras: [], lines: [
    { item_id: olives, qty_milli: 1000, paid: 5000, fixed_unit: 9000 }, { item_id: oil, qty_milli: 1000, paid: 4000, fixed_unit: null }] }), "split too low");
const single = await pur.createPurchase({ supplier_name: "", extras: [{ name: "Car", amount: 1000 }], paid: 6000,
  lines: [{ item_id: pickles, qty_milli: 1000, paid: 5000, fixed_unit: 1 }] });
eq("one item carries all the extra costs (a typed price is ignored)", (await pur.getPurchase(single))!.lines[0].buy_price, 6000);
await throws("no items", () => pur.createPurchase({ supplier_name: "X", lines: [], extras: [], paid: 0 }), "no lines");
await throws("fractional money refused", () =>
  pur.createPurchase({ supplier_name: "X", lines: [{ item_id: olives, qty_milli: 1000, paid: 10.5, fixed_unit: null }], extras: [], paid: 0 }), "invalid amount");

/* ---------- editing and cancelling ---------- */

await throws("edit cannot take away oil that was sold (5 of 20 L sold)", () =>
  pur.updatePurchase(p1, { supplier_name: "Hawler Olive Co", paid: 600000, extras: [{ name: "Delivery", amount: 60000 }], lines: [
    { item_id: olives, qty_milli: 100000, paid: 500000, fixed_unit: null }, { item_id: oil, qty_milli: 4000, paid: 152000, fixed_unit: null }] }), "sold");
await pur.updatePurchase(p1, {
  supplier_name: "Hawler Olive Co",
  paid: 1000000,
  extras: [{ name: "Delivery", amount: 60000 }],
  lines: [
    { item_id: olives, qty_milli: 90000, paid: 450000, fixed_unit: null }, // typo fixed: 90 kg, not 100
    { item_id: oil, qty_milli: 20000, paid: 760000, fixed_unit: 38500 }, // owner typed the oil price
    { item_id: pickles, qty_milli: 30000, paid: 90000, fixed_unit: null },
  ],
});
d1 = (await pur.getPurchase(p1))!;
eq("after edit: new revision, totals recalculated", [d1.rev, d1.total, d1.debt], [2, 1360000, 360000]);
eq("after edit: typed oil price kept and marked", d1.lines.map((l) => [l.buy_price, l.price_fixed]), [[5278, 0], [38500, 1], [3833, 0]]);
eq("after edit: stock follows (old lines no longer count)", (await item(olives)).on_hand_milli, 101000);
eq("after edit: the sale keeps the cost it had", (await sales.getSale(sale))!.lines[0].buy_price, 39000);
eq("item history: old delivery + current purchase line only", (await stock.listDeliveries(olives)).map((x) => [x.qty_milli, x.purchase_id]).sort((a, b) => Number(a[0]) - Number(b[0])),
  [[1000, anon], [10000, null], [90000, p1]]);
const p1Line = (await stock.listDeliveries(olives)).find((x) => x.purchase_id === p1)!;
await throws("a purchase line cannot be edited as a delivery", () => stock.editDelivery(p1Line.id, 1000, 1), "not editable");
await throws("…nor cancelled as one", () => stock.voidDelivery(p1Line.id), "not editable");
await stock.editDelivery(old, 9000, 4000);
eq("old deliveries can still be fixed", (await item(olives)).on_hand_milli, 100000);

await throws("cannot cancel a purchase whose goods were sold", () => pur.cancelPurchase(p1), "sold");

/* ---------- what we owe suppliers ---------- */

const hawler = await pur.addSupplier("hawler olive co"); // same supplier, any letter case
eq("supplier found again by name", hawler, d1.supplier_id);
const p2 = await pur.createPurchase({ supplier_name: "Hawler Olive Co", paid: 0, extras: [],
  lines: [{ item_id: pickles, qty_milli: 10000, paid: 40000, fixed_unit: null }] });
eq("supplier phone kept when not typed again", (await pur.getPurchase(p2))!.supplier_phone, "0750 123 4567");
let owe = await pur.listSupplierDebts();
eq("we owe Hawler 360,000 + 40,000", owe.map((s) => [s.name, s.debt]), [["Hawler Olive Co", 400000]]);

await pur.recordSupplierPayment(hawler, 370000);
eq("payment goes to the oldest purchase first", [(await pur.getPurchase(p1))!.debt, (await pur.getPurchase(p2))!.debt], [0, 30000]);
const pays = await pur.listSupplierPayments(hawler);
eq("one payment over two purchases = rows with one time", new Set(pays.map((p) => p.created_at)).size, 1);
await throws("cannot pay more than we owe", () => pur.recordSupplierPayment(hawler, 30001), "overpaid");
await pur.voidSupplierPayment(pays.find((p) => p.purchase_id === p2)!.id);
eq("cancelled payment brings the debt back", (await pur.listSupplierDebts())[0].debt, 40000);
await throws("edit cannot make the total smaller than what was paid", () =>
  pur.updatePurchase(p1, { supplier_name: "Hawler Olive Co", paid: 1000000, extras: [], lines: [
    { item_id: olives, qty_milli: 90000, paid: 300000, fixed_unit: null }, { item_id: oil, qty_milli: 20000, paid: 300000, fixed_unit: null },
    { item_id: pickles, qty_milli: 30000, paid: 90000, fixed_unit: null }] }), "overpaid");

// p2 (pickles, nothing sold) paid 0 so far; pay 10,000 then cancel it -> the supplier must give it back
await pur.recordSupplierPayment(hawler, 10000);
await pur.cancelPurchase(p2);
eq("cancelled purchase: its goods leave the stock", (await item(pickles)).on_hand_milli, 31000);
eq("cancelled purchase: no debt, refund due", [(await pur.getPurchase(p2))!.debt, (await pur.getPurchase(p2))!.refund_due], [0, 10000]);
eq("refunds due list", (await pur.listSupplierRefundsDue()).map((s) => [s.name, s.due]), [["Hawler Olive Co", 10000]]);
await pur.recordSupplierRefund(hawler, 10000);
eq("refund recorded", (await pur.listSupplierRefundsDue()).length, 0);
const refundPay = (await pur.listSupplierPayments(hawler)).find((p) => p.purchase_id === p2 && p.kind === "payment" && !p.cancelled_at)!;
await throws("cannot cancel a payment the supplier already gave back", () => pur.voidSupplierPayment(refundPay.id), "refunded");
eq("cancelled purchase still listed (marked)", (await pur.listPurchases()).find((p) => p.id === p2)!.cancelled_at !== null, true);
await throws("a cancelled purchase cannot be edited", () =>
  pur.updatePurchase(p2, { supplier_name: "", paid: 1, extras: [], lines: [{ item_id: olives, qty_milli: 1, paid: 1, fixed_unit: null }] }), "not editable");

/* ---------- lists and the dashboard ---------- */

const list = await pur.listPurchases(3);
eq("purchases list: newest first, limited", list.map((p) => p.id), [p2, single, anon]);
const dash = await getDashboard(currentMonth());
eq("dashboard: we owe suppliers", [dash.supplierDebt, dash.suppliersOwed], [0, 0]);
const stockValue = (await stock.listItems()).reduce((s, i) => s + (i.on_hand_milli > 0 && i.last_buy_price ? Math.round((i.on_hand_milli * i.last_buy_price) / 1000) : 0), 0);
eq("dashboard stock value uses the real unit prices", dash.stockValue, stockValue);
eq("history log has the purchase actions", (sqlite.prepare("SELECT COUNT(*) n FROM history_log WHERE entity = 'purchases'").get() as { n: number }).n >= 6, true);

/* ---------- searching supplier debts ---------- */

const p3 = await pur.createPurchase({ supplier_name: "Hawler Olive Co", paid: 0, extras: [], lines: [{ item_id: oil, qty_milli: 1000, paid: 30000, fixed_unit: null }] });
const owing = (await pur.listSupplierDebts())[0];
eq("supplier debts carry the purchase numbers still owed", [owing.purchase_ids, owing.phone], [String(p3), "0750 123 4567"]);

/* ---------- supplier papers: payment voucher and statement ---------- */

const kurd = await pur.createPurchase({ supplier_name: "Kurd Foods", supplier_phone: "0770 111", paid: 0, extras: [],
  lines: [{ item_id: pickles, qty_milli: 2000, paid: 20000, fixed_unit: null }] });
const kurd2 = await pur.createPurchase({ supplier_name: "Kurd Foods", paid: 5000, extras: [],
  lines: [{ item_id: pickles, qty_milli: 1000, paid: 15000, fixed_unit: null }] });
const kurdId = (await pur.listSuppliers()).find((x) => x.name === "Kurd Foods")!.id;
let st = await pur.getSupplierStatement(kurdId);
eq("statement: the open purchases, oldest first", st.purchases.map((x) => [x.id, x.total, x.given, x.debt]), [[kurd, 20000, 0, 20000], [kurd2, 15000, 5000, 10000]]);
eq("statement: total, phone, no payment yet", [st.total_debt, st.supplier_phone, st.last_payment_at], [30000, "0770 111", null]);
const v = await pur.recordSupplierPayment(kurdId, 25000);
eq("voucher: we paid 25,000, oldest purchase first, 5,000 still owed", [v.kind, v.amount, v.purchase_ids, v.remaining, v.supplier_name], ["payment", 25000, [kurd, kurd2], 5000, "Kurd Foods"]);
const kp = await pur.listSupplierPayments(kurdId);
const again = pur.voucherFromRows({ name: "Kurd Foods", phone: "0770 111" }, kp[0], kp);
eq("reprint groups the rows back into one voucher", [again.no, again.amount, again.remaining], [v.no, 25000, null]);
st = await pur.getSupplierStatement(kurdId);
eq("statement after paying: only what is still open", [st.purchases.map((x) => [x.id, x.debt]), st.total_debt, st.last_payment_at !== null], [[[kurd2, 5000]], 5000, true]);

finish();
