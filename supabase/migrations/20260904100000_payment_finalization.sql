-- Finalize payment, inventory, and coupon usage in one transaction.
-- An exception rolls back every change so a paid order cannot partially
-- consume inventory or coupon usage.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS razorpay_webhook_signature text;

CREATE OR REPLACE FUNCTION finalize_payment_for_order(
  p_order_id uuid,
  p_payment_id text,
  p_payment_signature text,
  p_webhook_signature text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_status text;
BEGIN
  SELECT payment_status INTO current_status
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF current_status IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF current_status = 'paid' THEN
    RETURN;
  END IF;

  IF current_status <> 'processing' THEN
    RAISE EXCEPTION 'Order is not ready for payment finalization';
  END IF;

  PERFORM consume_stock_reservation(p_order_id);
  PERFORM consume_coupon_for_order(p_order_id);

  UPDATE orders
  SET payment_status = 'paid',
      status = 'Confirmed',
      razorpay_payment_id = p_payment_id,
      razorpay_signature = COALESCE(p_payment_signature, razorpay_signature),
      razorpay_webhook_signature = COALESCE(p_webhook_signature, razorpay_webhook_signature),
      stock_decremented = true
  WHERE id = p_order_id;
END;
$$;

REVOKE ALL ON FUNCTION finalize_payment_for_order(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finalize_payment_for_order(uuid, text, text, text) TO service_role;