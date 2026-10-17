-- Keep wishlist mutations limited to insert/delete; wishlist rows are never updated.

DROP POLICY IF EXISTS "customer_update_own_wishlist" ON wishlist;

DROP POLICY IF EXISTS "customer_read_own_wishlist" ON wishlist;
CREATE POLICY "customer_read_own_wishlist" ON wishlist FOR SELECT TO authenticated
  USING (lower(customer_email) = lower(auth.jwt() ->> 'email') OR is_admin());

DROP POLICY IF EXISTS "customer_insert_own_wishlist" ON wishlist;
CREATE POLICY "customer_insert_own_wishlist" ON wishlist FOR INSERT TO authenticated
  WITH CHECK (lower(customer_email) = lower(auth.jwt() ->> 'email') OR is_admin());

DROP POLICY IF EXISTS "customer_delete_own_wishlist" ON wishlist;
CREATE POLICY "customer_delete_own_wishlist" ON wishlist FOR DELETE TO authenticated
  USING (lower(customer_email) = lower(auth.jwt() ->> 'email') OR is_admin());