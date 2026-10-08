-- Money: whole IQD integers. Quantities: integer thousandths (qty_milli), so 2.5 kg = 2500.
-- Nothing is hard-deleted: rows are archived or cancelled, and every change is written to history_log.

CREATE TABLE units (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name     TEXT NOT NULL UNIQUE COLLATE NOCASE,
  archived INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE categories (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name     TEXT NOT NULL UNIQUE COLLATE NOCASE,
  archived INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE items (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT NOT NULL,
  category_id        INTEGER REFERENCES categories(id),
  unit_id            INTEGER NOT NULL REFERENCES units(id),
  default_sell_price INTEGER NOT NULL DEFAULT 0,
  archived           INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL
);

CREATE TABLE stock_in (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id      INTEGER NOT NULL REFERENCES items(id),
  qty_milli    INTEGER NOT NULL,
  buy_price    INTEGER NOT NULL,
  created_at   TEXT NOT NULL,
  cancelled_at TEXT
);
CREATE INDEX idx_stock_in_item ON stock_in(item_id);

CREATE TABLE history_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  entity     TEXT NOT NULL,
  entity_id  INTEGER,
  action     TEXT NOT NULL,
  details    TEXT,
  created_at TEXT NOT NULL
);
