import { getDb } from "../db";

export type Named = { id: number; name: string };

export type Item = {
  id: number;
  name: string;
  category_id: number | null;
  unit_id: number;
  category_name: string | null;
  unit_name: string;
  default_sell_price: number;
  on_hand_milli: number;
  last_buy_price: number | null;
};

export type Delivery = {
  id: number;
  item_id: number;
  qty_milli: number;
  buy_price: number;
  created_at: string;
  cancelled_at: string | null;
};

const now = () => new Date().toISOString();

async function log(entity: string, entityId: number | null, action: string, details: unknown) {
  const db = await getDb();
  await db.execute(
    "INSERT INTO history_log (entity, entity_id, action, details, created_at) VALUES ($1,$2,$3,$4,$5)",
    [entity, entityId, action, JSON.stringify(details), now()],
  );
}

/* ---------- units & categories (same shape, two tables) ---------- */

type NamedTable = "units" | "categories";

async function listNamed(table: NamedTable): Promise<Named[]> {
  const db = await getDb();
  return db.select<Named[]>(`SELECT id, name FROM ${table} WHERE archived = 0 ORDER BY name`);
}

/** Creates the entry, or brings back an archived one with the same name. Returns its id. */
async function addNamed(table: NamedTable, rawName: string): Promise<number> {
  const name = rawName.trim();
  if (!name) throw new Error("name required");
  const db = await getDb();
  const found = await db.select<{ id: number; archived: number }[]>(
    `SELECT id, archived FROM ${table} WHERE name = $1 COLLATE NOCASE`,
    [name],
  );
  if (found.length) {
    if (found[0].archived) await db.execute(`UPDATE ${table} SET archived = 0 WHERE id = $1`, [found[0].id]);
    return found[0].id;
  }
  const res = await db.execute(`INSERT INTO ${table} (name) VALUES ($1)`, [name]);
  const id = res.lastInsertId as number;
  await log(table, id, "create", { name });
  return id;
}

async function renameNamed(table: NamedTable, id: number, rawName: string) {
  const name = rawName.trim();
  if (!name) throw new Error("name required");
  const db = await getDb();
  const clash = await db.select<{ id: number }[]>(
    `SELECT id FROM ${table} WHERE name = $1 COLLATE NOCASE AND id <> $2`,
    [name, id],
  );
  if (clash.length) throw new Error("duplicate");
  const old = await db.select<{ name: string }[]>(`SELECT name FROM ${table} WHERE id = $1`, [id]);
  await db.execute(`UPDATE ${table} SET name = $1 WHERE id = $2`, [name, id]);
  await log(table, id, "rename", { from: old[0]?.name, to: name });
}

async function archiveNamed(table: NamedTable, id: number) {
  const db = await getDb();
  await db.execute(`UPDATE ${table} SET archived = 1 WHERE id = $1`, [id]);
  await log(table, id, "archive", {});
}

export const listUnits = () => listNamed("units");
export const listCategories = () => listNamed("categories");
export const addUnit = (n: string) => addNamed("units", n);
export const addCategory = (n: string) => addNamed("categories", n);
export const renameUnit = (id: number, n: string) => renameNamed("units", id, n);
export const renameCategory = (id: number, n: string) => renameNamed("categories", id, n);
export const archiveUnit = (id: number) => archiveNamed("units", id);
export const archiveCategory = (id: number) => archiveNamed("categories", id);

/* ---------- items ---------- */

// On hand is always calculated from deliveries (later also minus sales), never typed in.
export async function listItems(): Promise<Item[]> {
  const db = await getDb();
  return db.select<Item[]>(
    `SELECT i.id, i.name, i.category_id, i.unit_id,
            c.name AS category_name, u.name AS unit_name, i.default_sell_price,
            COALESCE((SELECT SUM(s.qty_milli) FROM stock_in s
                       WHERE s.item_id = i.id AND s.cancelled_at IS NULL), 0) AS on_hand_milli,
            (SELECT s.buy_price FROM stock_in s
              WHERE s.item_id = i.id AND s.cancelled_at IS NULL
              ORDER BY s.created_at DESC, s.id DESC LIMIT 1) AS last_buy_price
       FROM items i
       LEFT JOIN categories c ON c.id = i.category_id
       JOIN units u ON u.id = i.unit_id
      WHERE i.archived = 0
      ORDER BY i.name`,
  );
}

export type ItemInput = {
  id?: number;
  name: string;
  category_id: number | null;
  unit_id: number;
  default_sell_price: number;
};

export async function saveItem(input: ItemInput): Promise<number> {
  const name = input.name.trim();
  if (!name) throw new Error("name required");
  const db = await getDb();
  if (input.id) {
    await db.execute(
      "UPDATE items SET name=$1, category_id=$2, unit_id=$3, default_sell_price=$4 WHERE id=$5",
      [name, input.category_id, input.unit_id, input.default_sell_price, input.id],
    );
    await log("items", input.id, "update", { ...input, name });
    return input.id;
  }
  const res = await db.execute(
    "INSERT INTO items (name, category_id, unit_id, default_sell_price, created_at) VALUES ($1,$2,$3,$4,$5)",
    [name, input.category_id, input.unit_id, input.default_sell_price, now()],
  );
  const id = res.lastInsertId as number;
  await log("items", id, "create", { ...input, name });
  return id;
}

export async function archiveItem(id: number) {
  const db = await getDb();
  await db.execute("UPDATE items SET archived = 1 WHERE id = $1", [id]);
  await log("items", id, "archive", {});
}

/* ---------- deliveries (stock in) ---------- */

export async function receive(item_id: number, qty_milli: number, buy_price: number): Promise<number> {
  if (!(qty_milli > 0) || !(buy_price > 0)) throw new Error("invalid amount");
  const db = await getDb();
  const res = await db.execute(
    "INSERT INTO stock_in (item_id, qty_milli, buy_price, created_at) VALUES ($1,$2,$3,$4)",
    [item_id, qty_milli, buy_price, now()],
  );
  const id = res.lastInsertId as number;
  await log("stock_in", id, "create", { item_id, qty_milli, buy_price });
  return id;
}

export async function listDeliveries(item_id: number): Promise<Delivery[]> {
  const db = await getDb();
  return db.select<Delivery[]>(
    "SELECT id, item_id, qty_milli, buy_price, created_at, cancelled_at FROM stock_in WHERE item_id = $1 ORDER BY created_at DESC, id DESC",
    [item_id],
  );
}

export async function editDelivery(id: number, qty_milli: number, buy_price: number) {
  if (!(qty_milli > 0) || !(buy_price > 0)) throw new Error("invalid amount");
  const db = await getDb();
  const old = await db.select<Delivery[]>("SELECT * FROM stock_in WHERE id = $1", [id]);
  if (!old.length || old[0].cancelled_at) throw new Error("not editable");
  await db.execute("UPDATE stock_in SET qty_milli=$1, buy_price=$2 WHERE id=$3", [qty_milli, buy_price, id]);
  await log("stock_in", id, "update", {
    from: { qty_milli: old[0].qty_milli, buy_price: old[0].buy_price },
    to: { qty_milli, buy_price },
  });
}

export async function voidDelivery(id: number) {
  const db = await getDb();
  await db.execute("UPDATE stock_in SET cancelled_at = $1 WHERE id = $2 AND cancelled_at IS NULL", [now(), id]);
  await log("stock_in", id, "cancel", {});
}
