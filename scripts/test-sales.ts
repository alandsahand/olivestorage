// Run: npm test — sales, stock deduction, debt, edit/cancel against real SQLite + real migrations.
import { eq, finish, freshDb, throws } from "./testkit.ts";
const sqlite = freshDb();
import * as stock from "../src/data/stock.ts";
import * as sales from "../src/data/sales.ts";

const kg = await stock.addUnit("kg");
const box = await stock.addUnit("box");
const olives = await stock.saveItem({ name: "Olives", category_id: null, unit_id: kg, default_sell_price: 7500 });
const oil = await stock.saveItem({ name: "Oil", category_id: null, unit_id: box, default_sell_price: 45000 });
const dOlives = await stock.receive(olives, 100000, 5800); // 100 kg @ 5,800
await stock.receive(oil, 10000, 36000); // 10 box @ 36,000

const hand = async (id: number) => (await stock.listItems()).find((i) => i.id === id)!.on_hand_milli;

// --- create a sale with two lines, partly paid
const s1 = await sales.createSale({
  client_name: "Aso",
  paid: 100000,
  lines: [
    { item_id: olives, qty_milli: 25000, unit_price: 7500 }, // 187,500
    { item_id: oil, qty_milli: 2000, unit_price: 45000 }, // 90,000
  ],
});
let sale = (await sales.getSale(s1))!;
eq("total = sum of lines", sale.total, 277500);
eq("debt = total - paid", sale.debt, 177500);
eq("lines stored with cost snapshot", sale.lines.map((l) => [l.qty_milli, l.buy_price, l.line_total]), [
  [25000, 5800, 187500],
  [2000, 36000, 90000],
]);
eq("stock decreased (olives)", await hand(olives), 75000);
eq("stock decreased (oil)", await hand(oil), 8000);
eq("client created once, name matched case-insensitively", await sales.addClient("ASO"), sale.client_id);

// --- validation
await throws("cannot sell more than in stock", () => sales.createSale({ client_name: "X", paid: 0, lines: [{ item_id: olives, qty_milli: 75001, unit_price: 7500 }] }), "insufficient");
await throws("two lines of same item are checked together", () => sales.createSale({ client_name: "X", paid: 0, lines: [
  { item_id: olives, qty_milli: 50000, unit_price: 7500 }, { item_id: olives, qty_milli: 30000, unit_price: 7500 }] }), "insufficient");
await throws("cannot overpay", () => sales.createSale({ client_name: "X", paid: 999999999, lines: [{ item_id: olives, qty_milli: 1000, unit_price: 7500 }] }), "overpaid");
await throws("client name required", () => sales.createSale({ client_name: "  ", paid: 0, lines: [{ item_id: olives, qty_milli: 1000, unit_price: 7500 }] }), "client required");
await throws("empty sale refused", () => sales.createSale({ client_name: "X", paid: 0, lines: [] }), "no lines");
await throws("zero price refused", () => sales.createSale({ client_name: "X", paid: 0, lines: [{ item_id: olives, qty_milli: 1000, unit_price: 0 }] }), "invalid amount");
eq("failed attempts left no stock change", [await hand(olives), await hand(oil)], [75000, 8000]);
eq("failed attempts left no half-saved sales", (await sales.listSales()).length, 1);

// --- fractional quantity rounds to whole dinar
const s2 = await sales.createSale({ client_name: "Shanaz", paid: 0, lines: [{ item_id: olives, qty_milli: 2500, unit_price: 7501 }] });
eq("2.5 x 7,501 rounded to whole IQD", (await sales.getSale(s2))!.total, 18753);

// --- a later delivery at a new price must not change the cost of an already-sold line
await stock.receive(olives, 10000, 9000); // last buy price is now 9,000
// --- edit: 32 kg olives (was 25), drop the oil, paid 237,500; own old lines are freed first
await sales.updateSale(s1, { client_name: "Aso", paid: 237500, lines: [{ item_id: olives, qty_milli: 32000, unit_price: 7500 }] });
sale = (await sales.getSale(s1))!;
eq("edit recalculates total", sale.total, 240000);
eq("edit recalculates paid and debt", [sale.paid, sale.debt], [237500, 2500]);
eq("edit keeps the original cost snapshot", sale.lines[0].buy_price, 5800);
eq("edit gave the dropped oil back to stock", await hand(oil), 10000);
eq("edit took the extra olives out of stock", await hand(olives), 100000 + 10000 - 32000 - 2500);
eq("old revision kept as history", (sqlite.prepare("SELECT COUNT(*) AS n FROM sale_lines WHERE sale_id = ?1").get(s1) as { n: number }).n, 3);
await throws("edit cannot exceed stock (own lines freed, nothing more)", () => sales.updateSale(s1, { client_name: "Aso", paid: 0, lines: [{ item_id: olives, qty_milli: 200000, unit_price: 7500 }] }), "insufficient");
eq("failed edit changed nothing", (await sales.getSale(s1))!.total, 240000);
eq("failed edit left no orphan lines", (sqlite.prepare("SELECT COUNT(*) AS n FROM sale_lines WHERE sale_id = ?1").get(s1) as { n: number }).n, 3);

// --- the old stock guard: cannot cancel/shrink a delivery that sales already used
await throws("cannot cancel a delivery that sold stock depends on", () => stock.voidDelivery(dOlives), "insufficient");
await throws("cannot shrink a delivery below what was sold", () => stock.editDelivery(dOlives, 10000, 5800), "insufficient");
await stock.editDelivery(dOlives, 95000, 5800);
eq("shrinking within sold limits is allowed", await hand(olives), 95000 + 10000 - 32000 - 2500);

// --- cancel a sale: stock returns, debt disappears from lists, history kept
await sales.cancelSale(s2);
eq("cancelled sale returns its stock", await hand(olives), 95000 + 10000 - 32000);
const list = await sales.listSales();
eq("cancelled sale stays listed, marked cancelled", list.map((x) => [x.id, x.cancelled_at !== null]), [[s2, true], [s1, false]]);
await throws("cancelled sale cannot be edited", () => sales.updateSale(s2, { client_name: "Shanaz", paid: 0, lines: [{ item_id: olives, qty_milli: 1000, unit_price: 7500 }] }), "not editable");
await sales.cancelSale(s2); // twice is harmless
eq("cancelling twice logs once", (sqlite.prepare("SELECT COUNT(*) AS n FROM history_log WHERE entity='sales' AND entity_id=?1 AND action='cancel'").get(s2) as { n: number }).n, 1);

// --- sold-out item can be sold down to exactly zero
const left = await hand(oil);
await sales.createSale({ client_name: "Halmat", paid: 0, lines: [{ item_id: oil, qty_milli: left, unit_price: 45000 }] });
eq("selling everything leaves exactly zero", await hand(oil), 0);
await throws("nothing left to sell", () => sales.createSale({ client_name: "Halmat", paid: 0, lines: [{ item_id: oil, qty_milli: 1, unit_price: 45000 }] }), "insufficient");

eq("history has create/update/cancel entries", (sqlite.prepare("SELECT COUNT(DISTINCT action) AS n FROM history_log WHERE entity='sales'").get() as { n: number }).n, 3);
// --- optional note printed on the invoice (kept at the end: it adds a sale to the list)
const line = (qty: number) => [{ item_id: olives, qty_milli: qty, unit_price: 7500 }];
const olivesBefore = await hand(olives);
eq("a sale without a note has none", (await sales.getSale(s1))!.note, null);
const withNote = await sales.createSale({ client_name: "Noor", paid: 0, note: "  deliver tomorrow  ", lines: line(1000) });
eq("note is saved and trimmed", (await sales.getSale(withNote))!.note, "deliver tomorrow");
await sales.updateSale(withNote, { client_name: "Noor", paid: 0, note: "   ", lines: line(1000) });
eq("an empty note on edit removes it", (await sales.getSale(withNote))!.note, null);
await sales.updateSale(withNote, { client_name: "Noor", paid: 0, note: "x".repeat(900), lines: line(1000) });
eq("a very long note is cut to 500 characters", (await sales.getSale(withNote))!.note!.length, 500);
await sales.cancelSale(withNote);
eq("stock is back after cancelling the note sale", await hand(olives), olivesBefore);
finish();
