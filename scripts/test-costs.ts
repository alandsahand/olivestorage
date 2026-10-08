// Run: npm test — monthly costs.
import { eq, finish, freshDb, throws } from "./testkit.ts";
const sqlite = freshDb();
import * as costs from "../src/data/costs.ts";

const empty = { electricity: 0, workers: 0, place: 0 };
eq("a never-saved month is all zero", await costs.getMonthCosts("2026-10"), empty);

eq("first save reports a change", await costs.saveMonthCosts("2026-10", { electricity: 180000, workers: 1500000, place: 800000 }), true);
const m = await costs.getMonthCosts("2026-10");
eq("saved amounts read back", m, { electricity: 180000, workers: 1500000, place: 800000 });
eq("total is the sum", costs.monthTotal(m), 2480000);

eq("saving the same values changes nothing", await costs.saveMonthCosts("2026-10", m), false);
eq("no history entry for a no-op", (sqlite.prepare("SELECT COUNT(*) AS n FROM history_log WHERE entity='monthly_costs'").get() as { n: number }).n, 1);

eq("edit one amount", await costs.saveMonthCosts("2026-10", { ...m, electricity: 200000 }), true);
eq("edit replaced the amount (no duplicate rows)", (sqlite.prepare("SELECT COUNT(*) AS n FROM monthly_costs WHERE month='2026-10'").get() as { n: number }).n, 3);
eq("edit applied", (await costs.getMonthCosts("2026-10")).electricity, 200000);
const last = sqlite.prepare("SELECT details FROM history_log WHERE entity='monthly_costs' ORDER BY id DESC LIMIT 1").get() as { details: string };
const det = JSON.parse(last.details);
eq("history keeps old and new values", [det.from.electricity, det.to.electricity, det.changed], [180000, 200000, ["electricity"]]);

eq("amounts can be set back to zero", await costs.saveMonthCosts("2026-10", empty), true);
eq("zeroed month reads zero", costs.monthTotal(await costs.getMonthCosts("2026-10")), 0);

await costs.saveMonthCosts("2026-01", { electricity: 1, workers: 2, place: 3 });
await costs.saveMonthCosts("2025-12", { electricity: 9, workers: 9, place: 9 });
const year = await costs.getYearCosts(2026);
eq("year view: saved month", year[1], { electricity: 1, workers: 2, place: 3 });
eq("year view: other months zero", [year[2], year[10]], [empty, empty]);
eq("year view ignores other years", Object.keys(year).length, 12);

await throws("negative refused", () => costs.saveMonthCosts("2026-10", { ...empty, place: -5 }), "invalid amount");
await throws("fraction refused", () => costs.saveMonthCosts("2026-10", { ...empty, place: 1.5 }), "invalid amount");
await throws("bad month refused", () => costs.saveMonthCosts("2026-13", empty), "invalid month");
await throws("bad month text refused", () => costs.getMonthCosts("October"), "invalid month");
finish();
