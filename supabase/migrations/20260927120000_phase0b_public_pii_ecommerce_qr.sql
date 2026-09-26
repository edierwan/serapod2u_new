-- ============================================================================
-- Phase 0B / Commit C — public PII, e-commerce and QR/public access
-- ----------------------------------------------------------------------------
-- Before (verified 2026-09-27, read-only catalog queries, prod + staging)
--   * qr_codes / qr_master_codes / qr_batches: anon SELECT USING (true), so
--     anyone holding the public anon key could list every QR code value
--     (including the 2-digit security suffix) and collect points for codes
--     they never scanned; authenticated INSERT/UPDATE USING/WITH CHECK (true)
--     let any consumer/shop account flip QR state (redeemed, points
--     collected, shipped, ...).
--   * qr_prepared_codes: "System can manage prepared codes" FOR ALL TO public
--     USING (true); qr_reverse_jobs: public UPDATE (true); qr_reverse_job_logs:
--     public INSERT (true); consumer_qr_scans: public INSERT (true).
--   * storefront_orders / storefront_order_items: "Service role full access"
--     policies were FOR ALL TO public USING (true) WITH CHECK (true): anon had
--     full CRUD on customer orders (names, emails, addresses, amounts).
--   * payroll_journals: public ALL (true). Document numbering tables
--     (doc_sequences, doc_type_prefixes, order_doc_sequences,
--     doc_migration_jobs, recycled_doc_numbers) were writable by anon.
--   * product_variants: authenticated ALL (true) overrode the HQ-admin policy;
--     variant_media: authenticated INSERT/UPDATE/DELETE (true).
--   * stock_movements / stock_transfers: any authenticated account could read
--     every organization's movements and transfers.
--   * search_eligible_references returned name, phone, email and organization
--     for an empty search term (first 20 reference users).
--
-- After
--   * Public QR journeys keep working through server routes (admin client)
--     and one narrow SECURITY DEFINER RPC, get_qr_security_requirement, that
--     returns only a boolean for middleware.ts.
--   * QR tables: no anon access; authenticated access limited to active staff
--     (role_level <= 40) — consumer/shop (GUEST) accounts never touch QR rows
--     directly (their flows run server-side).
--   * storefront orders and payroll journals are service-role only.
--   * Stock movements/transfers are visible to staff of the organizations
--     involved (HQ admins keep company-wide visibility via can_access_org).
--
-- Rollback guidance (do not apply automatically)
--   Re-create the dropped policies with their previous definitions from
--   supabase/schemas/current_schema.sql and re-grant anon SELECT on the QR
--   tables. The application change in middleware.ts must be rolled back at
--   the same time (it calls get_qr_security_requirement).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Narrow public RPC for the QR security-code redirect (middleware.ts)
--    Same resolution as the previous anon queries: the order-linked ACTIVE
--    journey (newest link first), otherwise the company's default/newest
--    active journey. The company comes from qr_codes.company_id (anon could
--    never read orders, so the old orders fallback never applied).
--    Unknown codes return false: the result cannot be used to probe codes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_qr_security_requirement(p_code text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_order_id uuid;
  v_company_id uuid;
  v_require boolean := false;
BEGIN
  IF p_code IS NULL OR length(p_code) = 0 OR length(p_code) > 512 THEN
    RETURN false;
  END IF;

  SELECT q.order_id, q.company_id
    INTO v_order_id, v_company_id
    FROM public.qr_codes q
   WHERE q.code = p_code
   LIMIT 1;

  IF NOT FOUND OR v_company_id IS NULL THEN
    RETURN false;
  END IF;

  IF v_order_id IS NOT NULL THEN
    SELECT (j.require_security_code IS TRUE)
      INTO v_require
      FROM public.journey_order_links l
      JOIN public.journey_configurations j ON j.id = l.journey_config_id
     WHERE l.order_id = v_order_id
       AND j.is_active IS TRUE
     ORDER BY l.created_at DESC
     LIMIT 1;
    v_require := coalesce(v_require, false);
  END IF;

  IF NOT v_require THEN
    SELECT (j.require_security_code IS TRUE)
      INTO v_require
      FROM public.journey_configurations j
     WHERE j.org_id = v_company_id
       AND j.is_active IS TRUE
     ORDER BY j.is_default DESC NULLS LAST, j.created_at DESC
     LIMIT 1;
    v_require := coalesce(v_require, false);
  END IF;

  RETURN v_require;
END;
$$;

REVOKE ALL ON FUNCTION public.get_qr_security_requirement(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_qr_security_requirement(text) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.get_qr_security_requirement(text) IS
  'PUBLIC BY DESIGN (Phase 0B): boolean-only security-code requirement for a QR code; replaces anon reads of qr_codes/journey tables in middleware.ts.';

-- Journey tables no longer need the interim anon read added in commit B.
DROP POLICY IF EXISTS sa_public_active_read ON public.journey_configurations;
DROP POLICY IF EXISTS sa_public_active_read ON public.journey_order_links;
REVOKE ALL ON TABLE public.journey_configurations FROM anon;
REVOKE ALL ON TABLE public.journey_order_links FROM anon;

-- ---------------------------------------------------------------------------
-- 2. Reference search (public consumer sign-up): minimum data, no listing
--    Signature unchanged (callers and the SERVER tier grant from commit A are
--    preserved); email is never returned and only matched exactly.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_eligible_references(p_search_term text, p_limit integer DEFAULT 10)
RETURNS TABLE(user_id uuid, full_name text, phone text, email text, organization_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT
    u.id AS user_id,
    u.full_name,
    u.phone,
    NULL::text AS email,
    o.org_name AS organization_name
  FROM public.users u
  LEFT JOIN public.organizations o ON o.id = u.organization_id
  WHERE u.can_be_reference = true
    AND u.is_active = true
    AND length(btrim(coalesce(p_search_term, ''))) >= 3
    AND (
      u.full_name ILIKE '%' || btrim(p_search_term) || '%'
      OR u.phone ILIKE '%' || btrim(p_search_term) || '%'
      OR lower(u.email) = lower(btrim(p_search_term))
    )
  ORDER BY u.full_name ASC
  LIMIT LEAST(GREATEST(coalesce(p_limit, 10), 1), 10);
$$;

-- ---------------------------------------------------------------------------
-- 3. QR tables: staff only, no anonymous access
-- ---------------------------------------------------------------------------
DO $phase0b_qr_tables$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['qr_codes', 'qr_master_codes', 'qr_batches'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Allow public read access to ' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Allow read access to ' || t || ' for authenticated users', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Allow insert access to ' || t || ' for authenticated users', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Allow update access to ' || t || ' for authenticated users', t);

    EXECUTE format('DROP POLICY IF EXISTS sa_staff_read ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS sa_staff_insert ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS sa_staff_update ON public.%I', t);
    EXECUTE format('CREATE POLICY sa_staff_read ON public.%I FOR SELECT TO authenticated USING (public.sa_actor_is_staff(40))', t);
    EXECUTE format('CREATE POLICY sa_staff_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (public.sa_actor_is_staff(40))', t);
    EXECUTE format('CREATE POLICY sa_staff_update ON public.%I FOR UPDATE TO authenticated USING (public.sa_actor_is_staff(40)) WITH CHECK (public.sa_actor_is_staff(40))', t);

    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
  END LOOP;
END
$phase0b_qr_tables$;

-- qr_prepared_codes: drop the FOR ALL TO public USING (true) policy; the
-- existing org-scoped SELECT policy stays; updates by the job's manufacturer.
DROP POLICY IF EXISTS "System can manage prepared codes" ON public.qr_prepared_codes;
DROP POLICY IF EXISTS sa_job_manufacturer_update ON public.qr_prepared_codes;
CREATE POLICY sa_job_manufacturer_update ON public.qr_prepared_codes FOR UPDATE TO authenticated
  USING (public.is_hq_admin() OR job_id IN (SELECT j.id FROM public.qr_reverse_jobs j WHERE j.manufacturer_org_id = public.sa_actor_org_id()))
  WITH CHECK (public.is_hq_admin() OR job_id IN (SELECT j.id FROM public.qr_reverse_jobs j WHERE j.manufacturer_org_id = public.sa_actor_org_id()));
REVOKE ALL ON TABLE public.qr_prepared_codes FROM anon;

-- qr_reverse_jobs: updates only by the manufacturer that owns the job or HQ admins.
DROP POLICY IF EXISTS "System can update reverse jobs" ON public.qr_reverse_jobs;
DROP POLICY IF EXISTS sa_manufacturer_update ON public.qr_reverse_jobs;
CREATE POLICY sa_manufacturer_update ON public.qr_reverse_jobs FOR UPDATE TO authenticated
  USING (public.is_hq_admin() OR manufacturer_org_id = public.sa_actor_org_id())
  WITH CHECK (public.is_hq_admin() OR manufacturer_org_id = public.sa_actor_org_id());
REVOKE ALL ON TABLE public.qr_reverse_jobs FROM anon;

-- qr_reverse_job_logs: written by server workers only (service_role).
DROP POLICY IF EXISTS "System can insert job logs" ON public.qr_reverse_job_logs;
REVOKE ALL ON TABLE public.qr_reverse_job_logs FROM anon;

-- consumer_qr_scans: consumer scans are recorded server-side (admin client);
-- the only direct insert is the staff catalog adjustment screen.
DROP POLICY IF EXISTS "Anyone can record consumer scans" ON public.consumer_qr_scans;
DROP POLICY IF EXISTS sa_staff_insert ON public.consumer_qr_scans;
CREATE POLICY sa_staff_insert ON public.consumer_qr_scans FOR INSERT TO authenticated
  WITH CHECK (public.sa_actor_is_staff(40));
REVOKE ALL ON TABLE public.consumer_qr_scans FROM anon;

-- ---------------------------------------------------------------------------
-- 4. E-commerce storefront orders: service-role only
--    Every application reader/writer (checkout, payment webhooks/providers,
--    admin store routes, Ellbow import, landing-page metrics) uses the admin
--    client. The admin route re-applies the organization scope in code.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Service role full access on storefront_orders" ON public.storefront_orders;
DROP POLICY IF EXISTS "Service role full access on storefront_order_items" ON public.storefront_order_items;
CREATE POLICY "Service role full access on storefront_orders" ON public.storefront_orders
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on storefront_order_items" ON public.storefront_order_items
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.storefront_orders FROM anon, authenticated;
REVOKE ALL ON TABLE public.storefront_order_items FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Payroll journals and document numbering: no API role writes
--    Only SECURITY DEFINER functions (owner privileges) maintain them.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "System can manage payroll journals" ON public.payroll_journals;
REVOKE ALL ON TABLE public.payroll_journals FROM anon, authenticated;

DROP POLICY IF EXISTS doc_migration_jobs_insert ON public.doc_migration_jobs;
DROP POLICY IF EXISTS doc_sequences_insert ON public.doc_sequences;
DROP POLICY IF EXISTS doc_sequences_update ON public.doc_sequences;
DROP POLICY IF EXISTS doc_type_prefixes_manage ON public.doc_type_prefixes;
DROP POLICY IF EXISTS order_doc_sequences_insert ON public.order_doc_sequences;
DROP POLICY IF EXISTS order_doc_sequences_update ON public.order_doc_sequences;
DROP POLICY IF EXISTS recycled_doc_numbers_insert ON public.recycled_doc_numbers;
DROP POLICY IF EXISTS recycled_doc_numbers_update ON public.recycled_doc_numbers;
DO $phase0b_doc_tables$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['doc_migration_jobs', 'doc_sequences', 'doc_type_prefixes', 'order_doc_sequences', 'recycled_doc_numbers'] LOOP
    -- Read access stays for authenticated staff screens; writes are server-side.
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.%I FROM authenticated', t);
  END LOOP;
END
$phase0b_doc_tables$;
DROP POLICY IF EXISTS doc_migration_jobs_select ON public.doc_migration_jobs;
DROP POLICY IF EXISTS doc_sequences_select ON public.doc_sequences;
DROP POLICY IF EXISTS order_doc_sequences_select ON public.order_doc_sequences;
CREATE POLICY doc_migration_jobs_select ON public.doc_migration_jobs FOR SELECT TO authenticated USING (public.sa_actor_is_staff(40));
CREATE POLICY doc_sequences_select ON public.doc_sequences FOR SELECT TO authenticated USING (public.sa_actor_is_staff(40));
CREATE POLICY order_doc_sequences_select ON public.order_doc_sequences FOR SELECT TO authenticated USING (public.sa_actor_is_staff(40));

-- ---------------------------------------------------------------------------
-- 6. Product catalog writes: staff only
--    "Authenticated variants access" (ALL, true) overrode variants_admin_all.
--    Staff keep full read (reports include inactive products); writes need
--    role_level <= 20 (product administrators).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated variants access" ON public.product_variants;
DROP POLICY IF EXISTS sa_staff_read ON public.product_variants;
DROP POLICY IF EXISTS sa_product_admin_write ON public.product_variants;
CREATE POLICY sa_staff_read ON public.product_variants FOR SELECT TO authenticated
  USING (public.sa_actor_is_staff(40));
CREATE POLICY sa_product_admin_write ON public.product_variants FOR ALL TO authenticated
  USING (public.sa_actor_is_staff(20)) WITH CHECK (public.sa_actor_is_staff(20));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.product_variants FROM anon;

DROP POLICY IF EXISTS variant_media_auth_delete ON public.variant_media;
DROP POLICY IF EXISTS variant_media_auth_insert ON public.variant_media;
DROP POLICY IF EXISTS variant_media_auth_update ON public.variant_media;
CREATE POLICY variant_media_auth_delete ON public.variant_media FOR DELETE TO authenticated
  USING (public.sa_actor_is_staff(20));
CREATE POLICY variant_media_auth_insert ON public.variant_media FOR INSERT TO authenticated
  WITH CHECK (public.sa_actor_is_staff(20));
CREATE POLICY variant_media_auth_update ON public.variant_media FOR UPDATE TO authenticated
  USING (public.sa_actor_is_staff(20)) WITH CHECK (public.sa_actor_is_staff(20));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.variant_media FROM anon;

-- ---------------------------------------------------------------------------
-- 7. Stock movements / transfers: organization-scoped reads
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS stock_movements_view_all ON public.stock_movements;
CREATE POLICY stock_movements_view_all ON public.stock_movements FOR SELECT TO authenticated
  USING (
    public.sa_actor_is_staff(40)
    AND (public.can_access_org(from_organization_id) OR public.can_access_org(to_organization_id))
  );
DROP POLICY IF EXISTS stock_transfers_view_all ON public.stock_transfers;
CREATE POLICY stock_transfers_view_all ON public.stock_transfers FOR SELECT TO authenticated
  USING (
    public.sa_actor_is_staff(40)
    AND (public.can_access_org(from_organization_id) OR public.can_access_org(to_organization_id))
  );
REVOKE ALL ON TABLE public.stock_movements FROM anon;
REVOKE ALL ON TABLE public.stock_transfers FROM anon;

-- ---------------------------------------------------------------------------
-- 8. Post-conditions
-- ---------------------------------------------------------------------------
DO $phase0b_c_assert$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(tablename || '.' || policyname, ', ')
    INTO v_bad
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('qr_codes', 'qr_master_codes', 'qr_batches', 'qr_prepared_codes', 'qr_reverse_jobs',
                       'qr_reverse_job_logs', 'consumer_qr_scans', 'storefront_orders', 'storefront_order_items',
                       'payroll_journals', 'product_variants', 'variant_media', 'stock_movements', 'stock_transfers')
     AND roles && ARRAY['public', 'anon', 'authenticated']::name[]
     AND cmd <> 'SELECT'
     AND coalesce(qual, 'true') ~* '^\(?true\)?$'
     AND coalesce(with_check, 'true') ~* '^\(?true\)?$';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 0B: unconditional write policies remain: %', v_bad;
  END IF;

  IF has_table_privilege('anon', 'public.qr_codes', 'SELECT')
     OR has_table_privilege('anon', 'public.storefront_orders', 'SELECT')
     OR has_table_privilege('authenticated', 'public.storefront_orders', 'SELECT') THEN
    RAISE EXCEPTION 'Phase 0B: public QR / storefront table access remains';
  END IF;
END
$phase0b_c_assert$;
