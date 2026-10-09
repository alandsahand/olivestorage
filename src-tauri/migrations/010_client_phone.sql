-- Optional phone number of a client (owner request 2026-10-09): typed on the Sell screen, printed on the
-- invoice, receipt and debt statement. The shop's own phone numbers live in the settings table (key shop_phones).
ALTER TABLE clients ADD COLUMN phone TEXT;
