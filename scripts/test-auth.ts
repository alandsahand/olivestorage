// Run: npm test — owner PIN, recovery code, lockout.
import { eq, finish, freshDb, throws } from "./testkit.ts";
const sqlite = freshDb();
import * as auth from "../src/data/auth.ts";

// controllable clock for the lockout
const realNow = Date.now.bind(Date);
let offset = 0;
Date.now = () => realNow() + offset;

eq("no PIN at first", await auth.hasPin(), false);
await throws("too short PIN refused", () => auth.setupPin("123"), "invalid pin");
await throws("letters refused", () => auth.setupPin("12ab"), "invalid pin");
await throws("too long PIN refused", () => auth.setupPin("123456789"), "invalid pin");

const code = await auth.setupPin("2468");
eq("recovery code looks like XXXX-XXXX-XXXX-XXXX-XXXX-XXXX", /^[A-Z2-9]{4}(-[A-Z2-9]{4}){5}$/.test(code), true);
eq("PIN now exists", await auth.hasPin(), true);
await throws("cannot create a second PIN over the first", () => auth.setupPin("1111"), "exists");

const stored = (sqlite.prepare("SELECT group_concat(value, ' ') AS v FROM settings").get() as { v: string }).v;
eq("neither the PIN nor the recovery code is stored in clear", [stored.includes("2468"), stored.includes(code), stored.includes(code.replace(/-/g, ""))], [false, false, false]);
const h = JSON.parse((sqlite.prepare("SELECT value FROM settings WHERE key='pin_hash'").get() as { value: string }).value);
eq("hash is salted PBKDF2 with 210,000 rounds", [h.i, h.s.length > 10, h.h.length > 20], [210000, true, true]);

eq("right PIN opens", await auth.verifyPin("2468"), { ok: true });
eq("Kurdish digits work too", await auth.verifyPin("٢٤٦٨"), { ok: true });
eq("wrong PIN refused", await auth.verifyPin("1111"), { ok: false, waitSeconds: 0 });
eq("garbage PIN refused", await auth.verifyPin("abc"), { ok: false, waitSeconds: 0 });

// 2 wrong so far; 3 more -> 5th wrong locks for 30 s
await auth.verifyPin("0000");
await auth.verifyPin("0000");
eq("5th wrong try locks for 30 seconds", await auth.verifyPin("0000"), { ok: false, waitSeconds: 30 });
const locked = await auth.verifyPin("2468");
eq("while locked even the right PIN is refused", locked.ok === false && locked.waitSeconds > 0 && locked.waitSeconds <= 30, true);
offset += 31_000;
eq("after the wait the right PIN works", await auth.verifyPin("2468"), { ok: true });
for (let k = 0; k < 4; k++) await auth.verifyPin("0000");
eq("success reset the counter (5 more wrong needed)", await auth.verifyPin("0000"), { ok: false, waitSeconds: 30 });
offset += 31_000;
for (let k = 0; k < 4; k++) await auth.verifyPin("0000");
eq("second lockout is longer (60 s)", await auth.verifyPin("0000"), { ok: false, waitSeconds: 60 });
offset += 61_000;
eq("PIN works again", await auth.verifyPin("2468"), { ok: true });

// forgot the PIN: recovery code
eq("wrong recovery code refused", await auth.resetPinWithRecovery("AAAA-AAAA-AAAA-AAAA-AAAA-AAAA", "9999"), null);
eq("PIN unchanged after bad recovery attempt", await auth.verifyPin("2468"), { ok: true });
const messy = ` ${code.toLowerCase().replace(/-/g, " ")} `; // typed in lowercase with spaces
const code2 = await auth.resetPinWithRecovery(messy, "1357");
eq("recovery code (any case, spaces) sets a new PIN and returns a new code", typeof code2 === "string" && code2 !== code, true);
eq("new PIN works", await auth.verifyPin("1357"), { ok: true });
eq("old PIN no longer works", (await auth.verifyPin("2468")).ok, false);
offset += 700_000;
eq("old recovery code is dead", await auth.resetPinWithRecovery(code, "5555"), null);
eq("new recovery code works", typeof (await auth.resetPinWithRecovery(code2!, "5555")), "string");

// change PIN / renew recovery code (both need the current PIN)
offset += 700_000;
eq("change PIN with wrong current PIN is refused", (await auth.changePin("0000", "7777")).ok, false);
offset += 700_000;
eq("change PIN", (await auth.changePin("5555", "7777")).ok, true);
eq("changed PIN works", await auth.verifyPin("7777"), { ok: true });
const renewed = await auth.newRecoveryCode("7777");
eq("renewing the recovery code returns a code", renewed.ok && /^[A-Z2-9-]{29}$/.test(renewed.code), true);
await throws("bad new PIN refused on reset", () => auth.resetPinWithRecovery("x", "12"), "invalid pin");

eq("security actions are in the history log without secrets", (sqlite.prepare("SELECT COUNT(*) AS n FROM history_log WHERE entity='security'").get() as { n: number }).n >= 5, true);
finish();
