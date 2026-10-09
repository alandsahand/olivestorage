-- Returns of sold goods (owner request 2026-10-10, docs/flow.md section 8). A saved sale keeps its items and
-- quantities; goods that come back are a return on that sale. A return counts only once active = 1 (set by the
-- final UPDATE after its lines are written) and while it is not cancelled AND its sale is live.
CREATE TABLE sale_returns (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id      INTEGER NOT NULL REFERENCES sales(id),
  total        INTEGER NOT NULL, -- what the returned goods are worth (prices minus their share of the sale's discount)
  active       INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  cancelled_at TEXT
);
CREATE INDEX idx_sale_returns_sale ON sale_returns(sale_id);
CREATE INDEX idx_sale_returns_created ON sale_returns(created_at DESC, id DESC);

CREATE TABLE sale_return_lines (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id  INTEGER NOT NULL REFERENCES sale_returns(id),
  item_id    INTEGER NOT NULL REFERENCES items(id),
  qty_milli  INTEGER NOT NULL,
  unit_price INTEGER NOT NULL, -- the price on the sale
  buy_price  INTEGER NOT NULL, -- the sale's cost snapshot, so profit goes back down by exactly what was counted
  value      INTEGER NOT NULL  -- what this line gives back
);
CREATE INDEX idx_sale_return_lines_return ON sale_return_lines(return_id);
CREATE INDEX idx_sale_return_lines_item ON sale_return_lines(item_id);

-- A refund given at the moment of a return remembers that return (printed on its return slip).
ALTER TABLE payments ADD COLUMN return_id INTEGER REFERENCES sale_returns(id);

-- What has really left the shop, per item: the current lines of live sales minus the lines of their live returns.
CREATE VIEW live_sold AS
  SELECT l.item_id, l.sale_id, l.qty_milli
    FROM sale_lines l JOIN sales s ON s.id = l.sale_id AND l.rev = s.rev
   WHERE s.rev >= 1 AND s.cancelled_at IS NULL
  UNION ALL
  SELECT rl.item_id, r.sale_id, -rl.qty_milli
    FROM sale_return_lines rl
    JOIN sale_returns r ON r.id = rl.return_id
    JOIN sales s ON s.id = r.sale_id
   WHERE r.active = 1 AND r.cancelled_at IS NULL AND s.rev >= 1 AND s.cancelled_at IS NULL;
