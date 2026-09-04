-- Reserve inventory before a payment starts so two checkouts cannot both
-- purchase the same available units.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS reservation_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS reservation_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS reservation_released_at timestamptz,
  ADD COLUMN IF NOT EXISTS coupon_consumed boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS coupon_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  coupon_id uuid NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'consumed', 'released')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id),
  UNIQUE (order_id, coupon_id)
);

ALTER TABLE coupon_reservations ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_coupon_reservations_coupon
  ON coupon_reservations(coupon_id, status, expires_at);

CREATE TABLE IF NOT EXISTS stock_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  variant_id uuid REFERENCES product_variants(id) ON DELETE SET NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'consumed', 'released')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  UNIQUE (order_id, product_id, variant_id)
);

ALTER TABLE stock_reservations ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_stock_reservations_expiry
  ON stock_reservations(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_stock_reservations_order
  ON stock_reservations(order_id);

CREATE OR REPLACE FUNCTION reserve_stock_for_order(
  p_order_id uuid,
  p_expires_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  line RECORD;
  updated_product_id uuid;
BEGIN
  IF p_expires_at <= now() THEN
    RAISE EXCEPTION 'Reservation expiry must be in the future';
  END IF;

  IF EXISTS (SELECT 1 FROM stock_reservations WHERE order_id = p_order_id) THEN
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
      UPDATE product_variants
      SET stock = stock - line.qty
      WHERE id = line.variant_id AND stock >= line.qty
      RETURNING product_id INTO updated_product_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Insufficient stock for variant %', line.variant_id;
      END IF;

      INSERT INTO stock_reservations(order_id, product_id, variant_id, quantity, expires_at)
      VALUES (p_order_id, updated_product_id, line.variant_id, line.qty, p_expires_at);
      PERFORM refresh_product_inventory_summary(updated_product_id);
    ELSE
      UPDATE products
      SET stock = stock - line.qty
      WHERE id = line.product_id AND stock >= line.qty
      RETURNING id INTO updated_product_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Insufficient stock for product %', line.product_id;
      END IF;

      INSERT INTO stock_reservations(order_id, product_id, quantity, expires_at)
      VALUES (p_order_id, updated_product_id, line.qty, p_expires_at);
    END IF;
  END LOOP;

  UPDATE orders
  SET reservation_status = 'reserved', reservation_expires_at = p_expires_at
  WHERE id = p_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION reserve_coupon_for_order(
  p_order_id uuid,
  p_coupon_code text,
  p_expires_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  coupon_row coupons%ROWTYPE;
  active_reservations integer;
BEGIN
  IF p_coupon_code IS NULL OR btrim(p_coupon_code) = '' THEN
    RETURN false;
  END IF;

  SELECT * INTO coupon_row
  FROM coupons
  WHERE code = upper(btrim(p_coupon_code)) AND enabled = true
  FOR UPDATE;

  IF NOT FOUND OR (coupon_row.expires_at IS NOT NULL AND coupon_row.expires_at < current_date) THEN
    RETURN false;
  END IF;

  DELETE FROM coupon_reservations
  WHERE coupon_id = coupon_row.id AND status = 'reserved' AND expires_at <= now();

  SELECT count(*)::integer INTO active_reservations
  FROM coupon_reservations
  WHERE coupon_id = coupon_row.id AND status = 'reserved';

  IF coupon_row.usage_limit IS NOT NULL
     AND coupon_row.used_count + active_reservations >= coupon_row.usage_limit THEN
    RETURN false;
  END IF;

  INSERT INTO coupon_reservations(order_id, coupon_id, expires_at)
  VALUES (p_order_id, coupon_row.id, p_expires_at)
  ON CONFLICT (order_id) DO NOTHING;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION consume_coupon_for_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  reservation coupon_reservations%ROWTYPE;
BEGIN
  SELECT * INTO reservation
  FROM coupon_reservations
  WHERE order_id = p_order_id AND status = 'reserved'
  FOR UPDATE;

  IF FOUND THEN
    UPDATE coupons
    SET used_count = used_count + 1
    WHERE id = reservation.coupon_id;
    UPDATE coupon_reservations SET status = 'consumed' WHERE id = reservation.id;
    UPDATE orders SET coupon_consumed = true WHERE id = p_order_id;
  ELSIF NOT EXISTS (
    SELECT 1 FROM coupon_reservations WHERE order_id = p_order_id AND status = 'consumed'
  ) AND EXISTS (
    SELECT 1 FROM orders WHERE id = p_order_id AND coupon_code IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'No active coupon reservation for order %', p_order_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION consume_stock_reservation(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE stock_reservations
  SET status = 'consumed'
  WHERE order_id = p_order_id AND status = 'reserved';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM stock_reservations WHERE order_id = p_order_id AND status = 'consumed'
  ) THEN
    RAISE EXCEPTION 'No active stock reservation for order %', p_order_id;
  END IF;

  UPDATE orders
  SET reservation_status = 'consumed'
  WHERE id = p_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION release_stock_reservation(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  reservation RECORD;
BEGIN
  FOR reservation IN
    SELECT product_id, variant_id, quantity
    FROM stock_reservations
    WHERE order_id = p_order_id AND status = 'reserved'
    ORDER BY variant_id NULLS LAST, product_id
  LOOP
    IF reservation.variant_id IS NOT NULL THEN
      UPDATE product_variants
      SET stock = stock + reservation.quantity
      WHERE id = reservation.variant_id;
      PERFORM refresh_product_inventory_summary(reservation.product_id);
    ELSE
      UPDATE products
      SET stock = stock + reservation.quantity
      WHERE id = reservation.product_id;
    END IF;
  END LOOP;

  UPDATE stock_reservations
  SET status = 'released', released_at = now()
  WHERE order_id = p_order_id AND status = 'reserved';

  UPDATE orders
  SET reservation_status = 'released', reservation_released_at = now()
  WHERE id = p_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION release_coupon_reservation(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE coupon_reservations
  SET status = 'released'
  WHERE order_id = p_order_id AND status = 'reserved';
END;
$$;

CREATE OR REPLACE FUNCTION release_expired_stock_reservations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  reservation_order RECORD;
  released_count integer := 0;
BEGIN
  FOR reservation_order IN
    SELECT DISTINCT order_id
    FROM stock_reservations
    WHERE status = 'reserved' AND expires_at <= now()
  LOOP
    PERFORM release_stock_reservation(reservation_order.order_id);
    PERFORM release_coupon_reservation(reservation_order.order_id);
    released_count := released_count + 1;
  END LOOP;
  RETURN released_count;
END;
$$;

REVOKE ALL ON FUNCTION reserve_stock_for_order(uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION consume_stock_reservation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION release_stock_reservation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION release_expired_stock_reservations() FROM PUBLIC;
REVOKE ALL ON FUNCTION reserve_coupon_for_order(uuid, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION consume_coupon_for_order(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION release_coupon_reservation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reserve_stock_for_order(uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION consume_stock_reservation(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION release_stock_reservation(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION release_expired_stock_reservations() TO service_role;
GRANT EXECUTE ON FUNCTION reserve_coupon_for_order(uuid, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION consume_coupon_for_order(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION release_coupon_reservation(uuid) TO service_role;