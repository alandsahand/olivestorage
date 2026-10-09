// Run: npm test — edge cases found in the pre-release bug hunt: fixing wrong deliveries, receipts,
// debt statements, list paging and number parsing.
import { eq, finish, freshDb, throws } from "./testkit.ts";
const sqlite = freshDb();
import * as stock from "../src/data/stock.ts";
import * as sales from "../src/data/sales.ts";
import * as debts from "../src/data/debts.ts";
import { getDashboard } from "../src/data/dashboard.ts";
import { currentMonth } from "../src/lib/months.ts";
import { parseMoney, parseQty } from "../src/lib/format.ts";
import { matchPerson, onlyDecimal, onlyDigits, onlyPhone } from "../src/lib/format.ts";

const kg = await stock.addUnit("kg");
const olives = await stock.saveItem({ name: "Olives", category_id: null, unit_id: kg, default_sell_price: 1000 });
const onHand = async () => (await stock.listItems()).find((i) => i.id === olives)!.on_hand_milli;
const logs = (entity: string, id: number) =>
  (sqlite.prepare("SELECT action FROM history_log WHERE entity = ? AND entity_id = ?").all(entity, id) as { action: string }[]).map((r) => r.action);

/* ---------- fixing a wrong delivery ---------- */

await throws("delivery: fractional dinar price refused", () => stock.receive(olives, 1000, 10.5), "invalid amount");
await throws("delivery: fractional thousandth refused", () => stock.receive(olives, 1000.5, 100), "invalid amount");
await throws("delivery: zero refused", () => stock.receive(olives, 0, 100), "invalid amount");

const d1 = await stock.receive(olives, 100000, 500); // 100 kg at 500
const d2 = await stock.receive(olives, 50000, 600); // 50 kg at 600 (typo: should have been 5 kg)
eq("on hand after two deliveries", await onHand(), 150000);
await stock.editDelivery(d2, 5000, 600);
eq("typo fixed: 50 kg -> 5 kg", await onHand(), 105000);
await stock.editDelivery(d2, 5000, 650);
eq("wrong price fixed: last buy price follows", (await stock.listItems())[0].last_buy_price, 650);

const sale = await sales.createSale({ client_name: "Aso", paid: 0, lines: [{ item_id: olives, qty_milli: 104000, unit_price: 1000 }] });
eq("sold 104 of 105 kg", await onHand(), 1000);
await throws("cannot cancel a delivery whose goods were sold", () => stock.voidDelivery(d1), "sold");
await throws("cannot shrink a delivery below what was sold", () => stock.editDelivery(d2, 3999, 650), "sold");
await stock.editDelivery(d2, 4000, 650);
eq("shrinking down to exactly what was sold is allowed", await onHand(), 0);
await throws("then nothing more can be taken away", () => stock.editDelivery(d2, 3999, 650), "sold");
await stock.editDelivery(d2, 5000, 650); // back to 1 kg on hand

eq("sale keeps its cost snapshot when the delivery price changes", (await sales.getSale(sale))!.lines[0].buy_price, 650);
await stock.editDelivery(d2, 5000, 700);
eq("…and does not follow a later price fix", (await sales.getSale(sale))!.lines[0].buy_price, 650);

await sales.cancelSale(sale);
eq("cancelling the sale gives the goods back", await onHand(), 105000);
await stock.voidDelivery(d2);
eq("now the delivery can be cancelled", await onHand(), 100000);
eq("last buy price falls back to the remaining delivery", (await stock.listItems())[0].last_buy_price, 500);
await stock.voidDelivery(d2); // double click
eq("cancelling twice logs only once", logs("stock_in", d2).filter((a) => a === "cancel").length, 1);
await throws("a cancelled delivery cannot be edited", () => stock.editDelivery(d2, 1000, 500), "not editable");

/* ---------- receipts ---------- */

const s1 = await sales.createSale({ client_name: "Shanaz", paid: 0, lines: [{ item_id: olives, qty_milli: 10000, unit_price: 1000 }] }); // owes 10,000
const s2 = await sales.createSale({ client_name: "Shanaz", paid: 2000, lines: [{ item_id: olives, qty_milli: 5000, unit_price: 1000 }] }); // owes 3,000
const shanaz = await sales.addClient("Shanaz");

const r = await debts.recordPayment(shanaz, 12000);
eq("receipt: kind and client", [r.kind, r.client_name], ["payment", "Shanaz"]);
eq("receipt: amount", r.amount, 12000);
eq("receipt: covered the oldest sale first", r.sale_ids, [s1, s2]);
eq("receipt: remaining debt after paying", r.remaining, 1000);
const pays = await debts.listClientPayments(shanaz);
eq("one payment over two sales = two rows with ONE time", new Set(pays.map((p) => p.created_at)).size, 1);
const again = debts.receiptFromRows("Shanaz", pays[0], pays);
eq("reprint groups the rows back into one receipt", [again.no, again.amount, [...again.sale_ids].sort()], [r.no, 12000, [s1, s2].sort()]);
eq("reprint has no 'remaining' (it would be today's, not then)", again.remaining, null);

await debts.voidPayment(pays.find((p) => p.sale_id === s2)!.id);
const after = await debts.listClientPayments(shanaz);
eq("reprint leaves out a cancelled part", debts.receiptFromRows("Shanaz", after[0], after).amount, 10000);

/* ---------- debt statement ---------- */

let st = await debts.getStatement(shanaz);
eq("statement: fully paid sale is NOT listed", st.sales.map((s) => s.id), [s2]);
eq("statement: partly paid sale shows what is left", st.sales[0].debt, 3000);
eq("statement: total", st.total_debt, 3000);
eq("statement: last payment date", st.last_payment_at, after.find((p) => !p.cancelled_at)!.created_at);
await debts.recordPayment(shanaz, 3000);
st = await debts.getStatement(shanaz);
eq("statement after paying everything: empty", [st.sales.length, st.total_debt], [0, 0]);

const s3 = await sales.createSale({ client_name: "Halmat", paid: 0, lines: [{ item_id: olives, qty_milli: 1000, unit_price: 1000 }] });
const halmat = await sales.addClient("Halmat");
eq("statement with no payment yet: no 'last payment'", (await debts.getStatement(halmat)).last_payment_at, null);
await sales.cancelSale(s3);
eq("statement: cancelled sale is not a debt", (await debts.getStatement(halmat)).sales.length, 0);

/* ---------- refunds ---------- */

const s4 = await sales.createSale({ client_name: "Karwan", paid: 4000, lines: [{ item_id: olives, qty_milli: 4000, unit_price: 1000 }] });
const karwan = await sales.addClient("Karwan");
const p4 = await debts.recordPayment(karwan, 1000).catch((e: Error) => e.message);
eq("nothing owed: payment refused", p4, "overpaid");
await sales.cancelSale(s4);
const rr = await debts.recordRefund(karwan, 4000);
eq("refund receipt", [rr.kind, rr.amount, rr.sale_ids, rr.remaining], ["refund", 4000, [s4], null]);

/* ---------- paging the sales list ---------- */

for (let k = 0; k < 25; k++) {
  await sales.createSale({ client_name: `C${k}`, paid: 1000, lines: [{ item_id: olives, qty_milli: 1000, unit_price: 1000 }] });
}
const all = await sales.listSales();
const page1 = await sales.listSales(21); // the screen asks for 20 + 1
eq("first page is the newest 20 (+1 probe row)", page1.map((s) => s.id), all.slice(0, 21).map((s) => s.id));
eq("newest first", all[0].id > all[1].id, true);
eq("the probe row tells there is more", page1.length > 20, true);
const page2 = await sales.listSales(41);
eq("second page continues where the first stopped", page2.slice(20, 40).map((s) => s.id), all.slice(20, 40).map((s) => s.id));
eq("cancelled sales stay visible in the history", all.some((s) => s.id === s3 && s.cancelled_at !== null), true);

/* ---------- dashboard still balances after all of this ---------- */

const d = await getDashboard(currentMonth());
const liveSales = (sqlite.prepare("SELECT COALESCE(SUM(total),0) n FROM sales WHERE rev >= 1 AND cancelled_at IS NULL").get() as { n: number }).n;
eq("dashboard sales = sum of live sales", d.sales, liveSales);

/* ---------- typing numbers ---------- */

eq("money: Kurdish digits and separators", parseMoney("١٢٬٥٠٠"), 12500);
eq("money: absurdly long input is capped at 12 digits", parseMoney("9".repeat(30)), 999_999_999_999);
eq("money: empty", parseMoney(""), null);
eq("qty: Kurdish decimal", parseQty("٢٫٥"), 2500);
eq("qty: too small to count is refused", parseQty("0.0001"), null);
eq("qty: zero is refused", parseQty("0"), null);

/* ---------- searching debts ---------- */

eq("search: empty finds everyone", matchPerson("", "Aso", "3"), true);
eq("search: part of the name", matchPerson("as", "Aso Mohammed", ""), true);
eq("search: Arabic and Kurdish letter variants are the same", matchPerson("كريم", "کریم", ""), true);
eq("search: exact sale number", matchPerson("12", "Aso", "3,12"), true);
eq("search: Kurdish digits", matchPerson("١٢", "Aso", "3,12"), true);
eq("search: 1 does not find sales 10, 11, 12", matchPerson("1", "Aso", "10,11,12"), false);
eq("search: part of a phone number, spaces ignored", matchPerson("0750123", "Hawler", "", "0750 123 4567"), true);
eq("search: no match", matchPerson("xyz", "Aso", "3", "0750"), false);
const oweSale = await sales.createSale({ client_name: "Rawand", paid: 0, lines: [{ item_id: olives, qty_milli: 1000, unit_price: 1000 }] });
await sales.createSale({ client_name: "Rawand", paid: 1000, lines: [{ item_id: olives, qty_milli: 1000, unit_price: 1000 }] }); // paid in full
const debtorsNow = await debts.listDebtors();
eq("debtors list carries only the sale numbers that still owe", debtorsNow.find((x) => x.name === "Rawand")!.sale_ids, String(oweSale));

/* ---------- number boxes only take numbers ---------- */

eq("quantity box: letters and symbols are dropped", onlyDecimal("12a.5kg!"), "12.5");
eq("quantity box: Kurdish digits and the Kurdish decimal mark stay", onlyDecimal("٢٫٥"), "٢٫٥");
eq("quantity box: only ONE decimal mark", onlyDecimal("1.2.3"), "1.23");
eq("quantity box: a minus sign is dropped (no negative amounts)", onlyDecimal("-5"), "5");
eq("phone box: digits, spaces, + and - stay, letters go", onlyPhone("+964 750-123abc"), "+964 750-123");
eq("phone box: Kurdish digits stay", onlyPhone("٠٧٥٠ ١٢٣"), "٠٧٥٠ ١٢٣");
eq("PIN box: digits only", onlyDigits("12a4 ٥"), "124٥");

finish();
