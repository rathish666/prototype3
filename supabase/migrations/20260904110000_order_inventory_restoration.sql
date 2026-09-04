-- Restore inventory exactly once when an admin cancels or marks a paid order
-- as returned. Every adjustment is recorded in an append-only ledger.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS stock_restored boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  variant_id uuid REFERENCES product_variants(id) ON DELETE SET NULL,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  movement_type text NOT NULL CHECK (movement_type IN ('reservation', 'sale', 'restoration')),
  quantity integer NOT NULL CHECK (quantity <> 0),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_read_inventory_movements"
  ON inventory_movements FOR SELECT TO authenticated USING (is_admin());
CREATE INDEX IF NOT EXISTS idx_inventory_movements_order
  ON inventory_movements(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_variant
  ON inventory_movements(variant_id, created_at DESC);

CREATE OR REPLACE FUNCTION restore_order_inventory(p_order_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  order_row orders%ROWTYPE;
  line RECORD;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT * INTO order_row FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF order_row.stock_restored THEN RETURN; END IF;
  IF NOT order_row.stock_decremented THEN
    UPDATE orders SET stock_restored = true WHERE id = p_order_id;
    RETURN;
  END IF;

  FOR line IN
    SELECT variant_id, product_id, SUM(quantity)::integer AS qty
    FROM order_items
    WHERE order_id = p_order_id
    GROUP BY variant_id, product_id
    ORDER BY variant_id NULLS LAST, product_id
  LOOP
    IF line.variant_id IS NOT NULL THEN
      UPDATE product_variants SET stock = stock + line.qty WHERE id = line.variant_id;
      PERFORM refresh_product_inventory_summary(line.product_id);
      INSERT INTO inventory_movements(product_id, variant_id, order_id, movement_type, quantity, reason)
      VALUES (line.product_id, line.variant_id, p_order_id, 'restoration', line.qty, p_reason);
    ELSE
      UPDATE products SET stock = stock + line.qty WHERE id = line.product_id;
      INSERT INTO inventory_movements(product_id, order_id, movement_type, quantity, reason)
      VALUES (line.product_id, p_order_id, 'restoration', line.qty, p_reason);
    END IF;
  END LOOP;

  UPDATE orders SET stock_restored = true WHERE id = p_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION admin_update_order_status(p_order_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_order orders%ROWTYPE;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT * INTO current_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF p_status NOT IN ('Pending', 'Confirmed', 'Processing', 'Shipped', 'Delivered', 'Cancelled', 'Returned') THEN
    RAISE EXCEPTION 'Invalid order status';
  END IF;

  IF p_status IN ('Cancelled', 'Returned') AND current_order.status NOT IN ('Cancelled', 'Returned') THEN
    IF current_order.payment_status = 'paid' THEN
      PERFORM restore_order_inventory(p_order_id, lower(p_status));
      PERFORM consume_coupon_for_order(p_order_id);
    ELSIF current_order.reservation_status = 'reserved' THEN
      PERFORM release_stock_reservation(p_order_id);
      PERFORM release_coupon_reservation(p_order_id);
    END IF;
  END IF;

  UPDATE orders SET status = p_status WHERE id = p_order_id;
END;
$$;

REVOKE ALL ON FUNCTION restore_order_inventory(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_update_order_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION restore_order_inventory(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_update_order_status(uuid, text) TO authenticated;