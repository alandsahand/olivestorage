-- Monthly running costs: one amount per month and kind. Editing replaces the amount;
-- every change is recorded in history_log (entity 'monthly_costs'), so nothing is lost.
-- month is 'YYYY-MM'. Whole IQD integers.

CREATE TABLE monthly_costs (
  month      TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  kind       TEXT NOT NULL CHECK (kind IN ('electricity', 'workers', 'place')),
  amount     INTEGER NOT NULL CHECK (amount >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (month, kind)
);
