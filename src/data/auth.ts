import { getDb } from "../db";
import { toLatinDigits } from "../lib/format";

// The owner PIN protects the Dashboard on screen. We never store the PIN or the recovery code:
// only salted PBKDF2 hashes (SHA-256, 210,000 rounds) in the settings table.
// Honest limit: a 4-8 digit PIN keeps casual users out; it cannot stop someone who copies the database file.

const ITER = 210_000;
const FAILS_PER_LOCK = 5;
const enc = new TextEncoder();

type Hashed = { s: string; i: number; h: string };

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(secret: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

async function hashSecret(secret: string): Promise<Hashed> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { s: b64(salt), i: ITER, h: b64(await derive(secret, salt, ITER)) };
}

async function checkSecret(secret: string, hashed: Hashed): Promise<boolean> {
  const got = await derive(secret, unb64(hashed.s), hashed.i);
  const want = unb64(hashed.h);
  let diff = got.length ^ want.length;
  for (let k = 0; k < got.length; k++) diff |= got[k] ^ (want[k] ?? 0);
  return diff === 0;
}

/* ---------- settings storage ---------- */

async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>("SELECT value FROM settings WHERE key = $1", [key]);
  return rows.length ? rows[0].value : null;
}

/** Writes several settings in one statement (all or nothing). */
async function putSettings(entries: Record<string, string>) {
  const keys = Object.keys(entries);
  const db = await getDb();
  const marks = keys.map((_, k) => `($${k * 2 + 1}, $${k * 2 + 2})`).join(",");
  await db.execute(
    `INSERT INTO settings (key, value) VALUES ${marks} ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    keys.flatMap((k) => [k, entries[k]]),
  );
}

async function audit(action: string) {
  const db = await getDb();
  await db.execute(
    "INSERT INTO history_log (entity, entity_id, action, details, created_at) VALUES ('security', NULL, $1, '{}', $2)",
    [action, new Date().toISOString()],
  );
}

/* ---------- PIN and recovery code ---------- */

export const normalizePin = (raw: string) => toLatinDigits(raw).replace(/\s/g, "");
export const isValidPin = (raw: string) => /^\d{4,8}$/.test(normalizePin(raw));

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 symbols, no 0/O/1/I

/** 24 random symbols (120 bits) in groups of four: XXXX-XXXX-XXXX-XXXX-XXXX-XXXX */
export function generateRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const chars = [...bytes].map((b) => ALPHABET[b & 31]); // 256 / 32: no bias
  return chars.join("").match(/.{4}/g)!.join("-");
}

const normalizeRecovery = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function hasPin(): Promise<boolean> {
  return (await getSetting("pin_hash")) !== null;
}

/** First-time setup. Returns the recovery code: show it ONCE, it cannot be read again. */
export async function setupPin(pin: string): Promise<string> {
  if (!isValidPin(pin)) throw new Error("invalid pin");
  if (await hasPin()) throw new Error("exists");
  const recovery = generateRecoveryCode();
  await putSettings({
    pin_hash: JSON.stringify(await hashSecret(normalizePin(pin))),
    recovery_hash: JSON.stringify(await hashSecret(normalizeRecovery(recovery))),
    pin_fails: "0",
    pin_locked_until: "0",
  });
  await audit("pin_created");
  return recovery;
}

export type VerifyResult = { ok: true } | { ok: false; waitSeconds: number };

/** Checks the PIN. After every 5 wrong tries the PIN is locked for longer and longer (30 s ... 10 min). */
export async function verifyPin(pin: string): Promise<VerifyResult> {
  const stored = await getSetting("pin_hash");
  if (!stored) throw new Error("no pin");
  const lockedUntil = Number((await getSetting("pin_locked_until")) ?? 0);
  if (Date.now() < lockedUntil) return { ok: false, waitSeconds: Math.ceil((lockedUntil - Date.now()) / 1000) };

  if (isValidPin(pin) && (await checkSecret(normalizePin(pin), JSON.parse(stored) as Hashed))) {
    await putSettings({ pin_fails: "0", pin_locked_until: "0" });
    return { ok: true };
  }
  const fails = Number((await getSetting("pin_fails")) ?? 0) + 1;
  let wait = 0;
  let until = 0;
  if (fails % FAILS_PER_LOCK === 0) {
    wait = Math.min(30 * 2 ** (fails / FAILS_PER_LOCK - 1), 600);
    until = Date.now() + wait * 1000;
  }
  await putSettings({ pin_fails: String(fails), pin_locked_until: String(until) });
  return { ok: false, waitSeconds: wait };
}

async function storePin(pin: string, recovery: string | null) {
  const entries: Record<string, string> = {
    pin_hash: JSON.stringify(await hashSecret(normalizePin(pin))),
    pin_fails: "0",
    pin_locked_until: "0",
  };
  if (recovery) entries.recovery_hash = JSON.stringify(await hashSecret(normalizeRecovery(recovery)));
  await putSettings(entries);
}

/** Forgot the PIN: the long recovery code sets a new PIN. Returns a NEW recovery code (the old one is replaced). */
export async function resetPinWithRecovery(code: string, newPin: string): Promise<string | null> {
  if (!isValidPin(newPin)) throw new Error("invalid pin");
  const stored = await getSetting("recovery_hash");
  if (!stored) throw new Error("no pin");
  if (!(await checkSecret(normalizeRecovery(code), JSON.parse(stored) as Hashed))) return null;
  const fresh = generateRecoveryCode();
  await storePin(newPin, fresh);
  await audit("pin_reset_with_recovery");
  return fresh;
}

/** Change PIN while knowing the current one. */
export async function changePin(oldPin: string, newPin: string): Promise<VerifyResult> {
  if (!isValidPin(newPin)) throw new Error("invalid pin");
  const r = await verifyPin(oldPin);
  if (!r.ok) return r;
  await storePin(newPin, null);
  await audit("pin_changed");
  return r;
}

/** Make a fresh recovery code (needs the PIN). The previous code stops working. */
export async function newRecoveryCode(pin: string): Promise<{ ok: true; code: string } | { ok: false; waitSeconds: number }> {
  const r = await verifyPin(pin);
  if (!r.ok) return r;
  const code = generateRecoveryCode();
  await putSettings({ recovery_hash: JSON.stringify(await hashSecret(normalizeRecovery(code))) });
  await audit("recovery_code_renewed");
  return { ok: true, code };
}
