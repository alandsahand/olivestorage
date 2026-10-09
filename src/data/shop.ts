import { getDb } from "../db";

// The shop's own details, kept in the settings table: up to three phone numbers (printed in the footer of every
// invoice, receipt and statement) and whether the first-start screen was done. The app name itself is fixed.

export const MAX_SHOP_PHONES = 3;
const MAX_PHONE_LENGTH = 40;

export type ShopInfo = { phones: string[]; setupDone: boolean };

/** Trimmed, empty ones dropped, at most three, each at most 40 characters. */
export const cleanPhones = (raw: string[]) =>
  raw
    .map((p) => p.trim().slice(0, MAX_PHONE_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_SHOP_PHONES);

export async function getShop(): Promise<ShopInfo> {
  const db = await getDb();
  const rows = await db.select<{ key: string; value: string }[]>(
    "SELECT key, value FROM settings WHERE key IN ('shop_phones', 'setup_done')",
  );
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  let phones: string[] = [];
  try {
    phones = cleanPhones(JSON.parse(get("shop_phones") ?? "[]"));
  } catch {
    /* a broken value counts as no phones */
  }
  return { phones, setupDone: get("setup_done") === "1" };
}

/** Saves the phone numbers and marks the first-start screen as done, in ONE statement. */
export async function saveShop(rawPhones: string[]): Promise<string[]> {
  const phones = cleanPhones(rawPhones);
  const db = await getDb();
  await db.execute(
    `INSERT INTO settings (key, value) VALUES ('shop_phones', $1), ('setup_done', '1')
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [JSON.stringify(phones)],
  );
  await db.execute(
    "INSERT INTO history_log (entity, entity_id, action, details, created_at) VALUES ('shop', NULL, 'phones', $1, $2)",
    [JSON.stringify({ phones }), new Date().toISOString()],
  );
  return phones;
}
