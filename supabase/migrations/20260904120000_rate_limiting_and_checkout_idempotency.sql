-- Shared database-backed rate limits and checkout idempotency.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS checkout_idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_checkout_idempotency
  ON orders(checkout_idempotency_key)
  WHERE checkout_idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS api_rate_limits (
  key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE api_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION consume_api_rate_limit(
  p_key text,
  p_max_requests integer,
  p_window_seconds integer
)
RETURNS TABLE(allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_window timestamptz;
  current_count integer;
  window_end timestamptz;
BEGIN
  IF p_key IS NULL OR p_key = '' OR p_max_requests < 1 OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'Invalid rate limit parameters';
  END IF;

  INSERT INTO api_rate_limits(key, window_started_at, request_count, updated_at)
  VALUES (p_key, now(), 1, now())
  ON CONFLICT (key) DO UPDATE SET
    window_started_at = CASE
      WHEN api_rate_limits.window_started_at + make_interval(secs => p_window_seconds) <= now()
      THEN now() ELSE api_rate_limits.window_started_at END,
    request_count = CASE
      WHEN api_rate_limits.window_started_at + make_interval(secs => p_window_seconds) <= now()
      THEN 1 ELSE api_rate_limits.request_count + 1 END,
    updated_at = now();

  SELECT window_started_at, request_count
  INTO current_window, current_count
  FROM api_rate_limits
  WHERE api_rate_limits.key = p_key;

  window_end := current_window + make_interval(secs => p_window_seconds);
  RETURN QUERY SELECT
    current_count <= p_max_requests,
    GREATEST(1, CEIL(EXTRACT(EPOCH FROM (window_end - now())))::integer);
END;
$$;

CREATE OR REPLACE FUNCTION purge_old_api_rate_limits()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed integer;
BEGIN
  DELETE FROM api_rate_limits
  WHERE updated_at < now() - interval '2 hours';
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION consume_api_rate_limit(text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION purge_old_api_rate_limits() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consume_api_rate_limit(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION purge_old_api_rate_limits() TO service_role;