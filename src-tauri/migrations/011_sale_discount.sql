-- Discount on a whole sale (owner request 2026-10-10). sales.total stays what the client owes, i.e. the amount
-- AFTER the discount, so debts, payments and statements keep working unchanged. Subtotal = total + discount.
ALTER TABLE sales ADD COLUMN discount INTEGER NOT NULL DEFAULT 0; -- whole dinars taken off
ALTER TABLE sales ADD COLUMN discount_pct_milli INTEGER;          -- the percent as typed (10% = 10000); NULL = typed as an amount
