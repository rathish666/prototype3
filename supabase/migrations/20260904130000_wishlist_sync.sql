-- Make wishlist ownership and uniqueness enforceable in the database.

UPDATE wishlist
SET customer_email = lower(trim(customer_email));

DELETE FROM wishlist duplicate_rows
USING wishlist kept_row
WHERE lower(trim(duplicate_rows.customer_email)) = lower(trim(kept_row.customer_email))
  AND duplicate_rows.product_id = kept_row.product_id
  AND duplicate_rows.id > kept_row.id;

DELETE FROM wishlist WHERE product_id IS NULL;

ALTER TABLE wishlist
  ALTER COLUMN customer_email SET NOT NULL,
  ALTER COLUMN product_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_wishlist_customer_product
  ON wishlist(customer_email, product_id);

DROP POLICY IF EXISTS "customer_read_own_wishlist" ON wishlist;
CREATE POLICY "customer_read_own_wishlist" ON wishlist FOR SELECT TO authenticated
  USING (lower(customer_email) = lower(auth.jwt() ->> 'email') OR is_admin());

DROP POLICY IF EXISTS "customer_insert_own_wishlist" ON wishlist;
CREATE POLICY "customer_insert_own_wishlist" ON wishlist FOR INSERT TO authenticated
  WITH CHECK (lower(customer_email) = lower(auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS "customer_delete_own_wishlist" ON wishlist;
CREATE POLICY "customer_delete_own_wishlist" ON wishlist FOR DELETE TO authenticated
  USING (lower(customer_email) = lower(auth.jwt() ->> 'email') OR is_admin());