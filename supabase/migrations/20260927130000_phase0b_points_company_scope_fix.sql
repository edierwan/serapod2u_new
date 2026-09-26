-- ============================================================================
-- Phase 0B follow-up — points_transactions company scope (staging UAT fix)
-- ----------------------------------------------------------------------------
-- Problem found in staging UAT after 20260927110000:
--   points_transactions.company_id is not always the HQ company id.
--   Production data (2026-09-27): 6,020 rows NULL (legacy), 405 rows hold a
--   SHOP organization id (ShopCatalogPage records redemptions with
--   company_id = the shop's own org id), 363 rows hold the HQ id.
--   The commit B policies compared company_id = sa_actor_company_id(), so
--     * shop redemptions (company_id = shop org) were rejected, and
--     * staff dashboards lost every NULL / shop-scoped row.
--
-- Fix: compare the RESOLVED company of the row
--   (get_company_id(company_id) walks shop -> distributor -> HQ) with the
--   actor's company, and treat legacy NULL rows as belonging to the single
--   platform company for staff (same explicit exception as storefront orders).
--   Non-staff accounts still only see their own rows and may still only
--   record redemption DEBITS, never credits.
--
-- Rollback guidance: re-run the points_transactions section of
-- 20260927110000_phase0b_sensitive_tables_hr_rls.sql.
-- ============================================================================

DROP POLICY IF EXISTS sa_owner_or_company_staff_read ON public.points_transactions;
CREATE POLICY sa_owner_or_company_staff_read ON public.points_transactions FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR wallet_owner_user_id = auth.uid()
    OR (wallet_owner_org_id IS NOT NULL AND wallet_owner_org_id = public.sa_actor_org_id())
    OR (
      public.sa_actor_is_staff(40)
      AND (company_id IS NULL OR public.get_company_id(company_id) = public.sa_actor_company_id())
    )
  );

DROP POLICY IF EXISTS sa_company_staff_insert ON public.points_transactions;
CREATE POLICY sa_company_staff_insert ON public.points_transactions FOR INSERT TO authenticated
  WITH CHECK (
    public.sa_actor_is_staff(40)
    AND (company_id IS NULL OR public.get_company_id(company_id) = public.sa_actor_company_id())
  );

DROP POLICY IF EXISTS sa_member_redemption_debit_insert ON public.points_transactions;
CREATE POLICY sa_member_redemption_debit_insert ON public.points_transactions FOR INSERT TO authenticated
  WITH CHECK (
    public.get_company_id(company_id) = public.sa_actor_company_id()
    AND transaction_type = 'redeem'
    AND points_amount < 0
  );

DROP POLICY IF EXISTS sa_company_staff_update ON public.points_transactions;
CREATE POLICY sa_company_staff_update ON public.points_transactions FOR UPDATE TO authenticated
  USING (
    public.sa_actor_is_staff(40)
    AND (company_id IS NULL OR public.get_company_id(company_id) = public.sa_actor_company_id())
  )
  WITH CHECK (
    public.sa_actor_is_staff(40)
    AND (company_id IS NULL OR public.get_company_id(company_id) = public.sa_actor_company_id())
  );

DROP POLICY IF EXISTS sa_company_admin_delete ON public.points_transactions;
CREATE POLICY sa_company_admin_delete ON public.points_transactions FOR DELETE TO authenticated
  USING (
    public.sa_actor_is_staff(20)
    AND (company_id IS NULL OR public.get_company_id(company_id) = public.sa_actor_company_id())
  );
