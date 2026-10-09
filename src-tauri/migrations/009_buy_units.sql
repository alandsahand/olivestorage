-- Buying unit vs storing unit (docs/flow.md section 7). An item may be bought in another unit than the one it is
-- stored and sold in: 1 kg = 2 jar, or written the other way, 1 jar = 0.5 kg. The number is kept exactly as typed.
--   buy_ratio_dir = 'buy'   : 1 buying unit = buy_ratio_milli/1000 store units
--   buy_ratio_dir = 'store' : 1 store unit  = buy_ratio_milli/1000 buying units
-- NULL buy_unit_id = bought and stored in the same unit (every item made before this change).
ALTER TABLE items ADD COLUMN buy_unit_id INTEGER REFERENCES units(id);
ALTER TABLE items ADD COLUMN buy_ratio_milli INTEGER;
ALTER TABLE items ADD COLUMN buy_ratio_dir TEXT;

-- A purchase line remembers what was really bought (100 kg) next to what was stored (qty_milli, e.g. 196 jar),
-- so changing an item's reference later never changes a saved purchase.
ALTER TABLE stock_in ADD COLUMN buy_unit_id INTEGER REFERENCES units(id);
ALTER TABLE stock_in ADD COLUMN buy_qty_milli INTEGER;
