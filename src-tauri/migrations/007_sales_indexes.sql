-- Speed for long lists: the Sell history (newest first) and the per-client debt queries.
-- Indexes only: no data changes.
CREATE INDEX idx_sales_created ON sales(created_at DESC, id DESC);
CREATE INDEX idx_sales_client ON sales(client_id);
