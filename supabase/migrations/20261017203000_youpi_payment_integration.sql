-- YOUPI PG payment identifiers and webhook audit data.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS youpi_payment_id text,
  ADD COLUMN IF NOT EXISTS youpi_webhook_signature text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_youpi_payment_id
  ON orders(youpi_payment_id)
  WHERE youpi_payment_id IS NOT NULL;
