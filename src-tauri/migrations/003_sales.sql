-- Sales. A sale is "visible" only when rev >= 1.
-- Lines belong to a revision: editing a sale inserts the new lines with rev+1 first and then flips
-- sales.rev in ONE statement, so a crash mid-edit can never leave a half-changed sale, and old
-- revisions stay in the table as history. Only lines with sale_lines.rev = sales.rev are "current".
-- buy_price is the cost per unit at the time of sale (profit stays correct when prices change later).

CREATE TABLE clients (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL
);

CREATE TABLE sales (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id    INTEGER NOT NULL REFERENCES clients(id),
  total        INTEGER NOT NULL,
  paid         INTEGER NOT NULL,
  rev          INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  cancelled_at TEXT
);

CREATE TABLE sale_lines (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id    INTEGER NOT NULL REFERENCES sales(id),
  rev        INTEGER NOT NULL,
  item_id    INTEGER NOT NULL REFERENCES items(id),
  qty_milli  INTEGER NOT NULL,
  unit_price INTEGER NOT NULL,
  buy_price  INTEGER NOT NULL,
  line_total INTEGER NOT NULL
);
CREATE INDEX idx_sale_lines_sale ON sale_lines(sale_id);
CREATE INDEX idx_sale_lines_item ON sale_lines(item_id);
