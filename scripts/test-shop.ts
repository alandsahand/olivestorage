// Run: npm test — the shop's phone numbers (first start / shop info) and the client's phone on printed papers.
import { eq, finish, freshDb } from "./testkit.ts";
freshDb();
import * as shop from "../src/data/shop.ts";
import * as stock from "../src/data/stock.ts";
import * as sales from "../src/data/sales.ts";
import * as debts from "../src/data/debts.ts";
import { matchPerson } from "../src/lib/format.ts";

/* ---------- the shop's phone numbers ---------- */

let s = await shop.getShop();
eq("new database: first-start screen not done, no phones", [s.setupDone, s.phones], [false, []]);
eq("phones are trimmed, empty ones dropped, at most three", shop.cleanPhones([" 0750 1 ", "", "0770 2", "0780 3", "0790 4"]), ["0750 1", "0770 2", "0780 3"]);
eq("a phone longer than 40 characters is cut", shop.cleanPhones(["1".repeat(50)])[0].length, 40);
await shop.saveShop(["0750 123 4567", "  "]);
s = await shop.getShop();
eq("saving marks the first start as done and keeps the phones", [s.setupDone, s.phones], [true, ["0750 123 4567"]]);
await shop.saveShop([]);
s = await shop.getShop();
eq("no phone at all is allowed (can be added later)", [s.setupDone, s.phones], [true, []]);
await shop.saveShop(["0750 111", "0770 222", "0780 333"]);
eq("three phones", (await shop.getShop()).phones.length, 3);

/* ---------- the client's phone ---------- */

const kg = await stock.addUnit("kg");
const olives = await stock.saveItem({ name: "Olives", category_id: null, unit_id: kg, default_sell_price: 1000 });
await stock.receive(olives, 100000, 500);
const sale = await sales.createSale({ client_name: "Aso", client_phone: " 0750 444 5555 ", paid: 0, lines: [{ item_id: olives, qty_milli: 10000, unit_price: 1000 }] });
eq("the sale (invoice) carries the client phone", (await sales.getSale(sale))!.client_phone, "0750 444 5555");
eq("client list carries the phone (for filling it in next time)", (await sales.listClients()).map((c) => [c.name, c.phone]), [["Aso", "0750 444 5555"]]);
await sales.createSale({ client_name: "aso", paid: 1000, lines: [{ item_id: olives, qty_milli: 1000, unit_price: 1000 }] });
eq("no phone typed: the stored phone stays", (await sales.listClients())[0].phone, "0750 444 5555");
await sales.updateSale(sale, { client_name: "Aso", client_phone: "0770 999", paid: 0, lines: [{ item_id: olives, qty_milli: 10000, unit_price: 1000 }] });
eq("a new phone replaces the old one", (await sales.getSale(sale))!.client_phone, "0770 999");

const aso = await sales.addClient("Aso");
const debtor = (await debts.listDebtors())[0];
eq("debts list shows the phone", debtor.phone, "0770 999");
eq("…and search finds the client by part of it", matchPerson("999", debtor.name, debtor.sale_ids, debtor.phone), true);
eq("the debt statement carries the phone", (await debts.getStatement(aso)).client_phone, "0770 999");
const receipt = await debts.recordPayment(aso, 4000);
eq("the payment receipt carries the phone", receipt.client_phone, "0770 999");
const pays = await debts.listClientPayments(aso);
eq("a reprinted receipt carries the phone", debts.receiptFromRows({ name: "Aso", phone: debtor.phone }, pays[0], pays).client_phone, "0770 999");
const noPhone = await sales.createSale({ client_name: "Shanaz", paid: 0, lines: [{ item_id: olives, qty_milli: 1000, unit_price: 1000 }] });
eq("a client without a phone prints none", (await sales.getSale(noPhone))!.client_phone, null);

finish();
