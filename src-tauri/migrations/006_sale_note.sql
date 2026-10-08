-- Optional free-text note on a sale (printed on the invoice). Old sales simply have no note.
ALTER TABLE sales ADD COLUMN note TEXT;
