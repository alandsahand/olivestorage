-- Money that moves after a sale was made.
--   kind = 'payment': the client pays off debt later (money in).
--   kind = 'refund' : money given back to the client after a sale was cancelled (money out).
-- The amount paid at the moment of sale stays in sales.paid. Rows are cancelled, never deleted.

CREATE TABLE payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id      INTEGER NOT NULL REFERENCES sales(id),
  kind         TEXT NOT NULL CHECK (kind IN ('payment', 'refund')),
  amount       INTEGER NOT NULL CHECK (amount > 0),
  created_at   TEXT NOT NULL,
  cancelled_at TEXT
);
CREATE INDEX idx_payments_sale ON payments(sale_id);
