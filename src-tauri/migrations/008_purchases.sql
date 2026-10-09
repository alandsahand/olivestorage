-- Purchases: goods come in as one order with several items plus extra costs (delivery, loading, ...).
-- Each item line is a stock_in row linked to its purchase. Like sales, a purchase is visible only when
-- purchases.rev >= 1, and its lines belong to a revision: editing inserts new lines with rev+1 and then
-- flips purchases.rev in ONE statement. Only lines with stock_in.purchase_rev = purchases.rev count.
-- buy_price of a purchase line = its REAL unit cost (what was paid + its share of the extra costs).
-- Deliveries entered before this change have purchase_id NULL and keep counting exactly as before.

CREATE TABLE suppliers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone      TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE purchases (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id  INTEGER REFERENCES suppliers(id),
  total        INTEGER NOT NULL, -- goods + extra costs
  paid         INTEGER NOT NULL, -- paid to the supplier when the purchase was made
  note         TEXT,
  rev          INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  cancelled_at TEXT
);
CREATE INDEX idx_purchases_created ON purchases(created_at DESC, id DESC);
CREATE INDEX idx_purchases_supplier ON purchases(supplier_id);

CREATE TABLE purchase_extras (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id),
  rev         INTEGER NOT NULL,
  name        TEXT NOT NULL,
  amount      INTEGER NOT NULL
);
CREATE INDEX idx_purchase_extras_purchase ON purchase_extras(purchase_id);

ALTER TABLE stock_in ADD COLUMN purchase_id INTEGER REFERENCES purchases(id);
ALTER TABLE stock_in ADD COLUMN purchase_rev INTEGER;
ALTER TABLE stock_in ADD COLUMN line_paid INTEGER;                    -- money paid for this item (before extra costs)
ALTER TABLE stock_in ADD COLUMN cost_total INTEGER;                   -- real cost of the line (paid + share of extras)
ALTER TABLE stock_in ADD COLUMN price_fixed INTEGER NOT NULL DEFAULT 0; -- 1 = the owner typed the real unit price
CREATE INDEX idx_stock_in_purchase ON stock_in(purchase_id);

-- Money paid to suppliers after the purchase ('payment'), or given back by a supplier for a cancelled purchase ('refund').
CREATE TABLE supplier_payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id  INTEGER NOT NULL REFERENCES purchases(id),
  kind         TEXT NOT NULL CHECK (kind IN ('payment', 'refund')),
  amount       INTEGER NOT NULL CHECK (amount > 0),
  created_at   TEXT NOT NULL,
  cancelled_at TEXT
);
CREATE INDEX idx_supplier_payments_purchase ON supplier_payments(purchase_id);

-- The stock rows that count: old deliveries that are not cancelled, and the current lines of live purchases.
CREATE VIEW live_stock_in AS
  SELECT si.*
    FROM stock_in si
    LEFT JOIN purchases p ON p.id = si.purchase_id
   WHERE si.cancelled_at IS NULL
     AND (si.purchase_id IS NULL OR (p.rev >= 1 AND si.purchase_rev = p.rev AND p.cancelled_at IS NULL));
