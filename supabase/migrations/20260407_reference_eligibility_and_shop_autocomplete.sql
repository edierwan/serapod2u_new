-- ============================================================================
-- Migration: Reference Eligibility & Shop Autocomplete System
-- Date: 2026-04-07
-- 
-- Changes:
-- 1. Add can_be_reference boolean to users table
-- 2. Backfill existing reference users (idempotent)
-- 3. Create search_eligible_references() function for autocomplete
-- 4. Create search_shops() function for shop name autocomplete
-- 5. Update v_consumer_points_balance to use _normalize_phone_my consistently
-- 6. Add validate_reference_assignment() function for server-side validation
-- 7. Add RLS policy for can_be_reference admin management
-- ============================================================================

-- ============================================================================
-- 1. Add can_be_reference column to users table
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'can_be_reference'
  ) THEN
    ALTER TABLE public.users ADD COLUMN can_be_reference boolean NOT NULL DEFAULT false;
    COMMENT ON COLUMN public.users.can_be_reference IS 'Whether this user is eligible to appear in Reference/Account Manager autocomplete';
  END IF;
END $$;

-- Index for fast filtered autocomplete queries
CREATE INDEX IF NOT EXISTS idx_users_can_be_reference
  ON public.users (can_be_reference)
  WHERE can_be_reference = true AND is_active = true;

-- Composite index for reference search (name, phone, email)
CREATE INDEX IF NOT EXISTS idx_users_reference_search
  ON public.users (can_be_reference, is_active)
  INCLUDE (full_name, phone, email)
  WHERE can_be_reference = true AND is_active = true;

-- ============================================================================
-- 2. Backfill: mark all existing reference users as can_be_reference = true
--    Sources: reference_assignments, referral_accruals, reference_change_log,
--             and users whose phone matches any consumer's referral_phone
--    IDEMPOTENT: safe to run multiple times
-- ============================================================================
WITH existing_refs AS (
  -- From reference_assignments (active or historical)
  SELECT DISTINCT reference_user_id AS user_id
  FROM public.reference_assignments
  WHERE reference_user_id IS NOT NULL

  UNION

  -- From referral_accruals
  SELECT DISTINCT reference_user_id
  FROM public.referral_accruals
  WHERE reference_user_id IS NOT NULL

  UNION

  -- From reference_change_log (new and old references)
  SELECT DISTINCT new_reference_id
  FROM public.reference_change_log
  WHERE new_reference_id IS NOT NULL

  UNION

  SELECT DISTINCT old_reference_id
  FROM public.reference_change_log
  WHERE old_reference_id IS NOT NULL

  UNION

  -- From consumers' referral_phone matching a user's phone
  SELECT DISTINCT u2.id
  FROM public.users u2
  INNER JOIN public.users cu
    ON public._normalize_phone_my(cu.referral_phone) = public._normalize_phone_my(u2.phone)
  WHERE cu.referral_phone IS NOT NULL
    AND TRIM(cu.referral_phone) <> ''
)
UPDATE public.users
SET can_be_reference = true
WHERE id IN (SELECT user_id FROM existing_refs)
  AND can_be_reference = false;

-- ============================================================================
-- 3. search_eligible_references(): autocomplete for Reference picker
--    Returns eligible references matching a search term (phone/name/email)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.search_eligible_references(
  p_search_term text,
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  user_id uuid,
  full_name text,
  phone text,
  email text,
  organization_name text
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    u.id AS user_id,
    u.full_name,
    u.phone,
    u.email,
    o.org_name AS organization_name
  FROM public.users u
  LEFT JOIN public.organizations o ON o.id = u.organization_id
  WHERE u.can_be_reference = true
    AND u.is_active = true
    AND (
      p_search_term IS NULL
      OR TRIM(p_search_term) = ''
      OR u.full_name ILIKE '%' || TRIM(p_search_term) || '%'
      OR u.phone ILIKE '%' || TRIM(p_search_term) || '%'
      OR u.email ILIKE '%' || TRIM(p_search_term) || '%'
    )
  ORDER BY u.full_name ASC
  LIMIT LEAST(p_limit, 20);
$$;

COMMENT ON FUNCTION public.search_eligible_references IS 'Autocomplete search for eligible reference users. Searches by name, phone, or email.';

-- ============================================================================
-- 4. search_shops(): autocomplete for Shop Name picker
--    Returns shops (org_type_code = SHOP) matching a search term
-- ============================================================================
CREATE OR REPLACE FUNCTION public.search_shops(
  p_search_term text,
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  org_id uuid,
  org_name text,
  branch text,
  contact_name text,
  contact_phone text,
  state_name text,
  display_label text
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    o.id AS org_id,
    o.org_name,
    o.branch,
    o.contact_name,
    o.contact_phone,
    s.state_name AS state_name,
    CASE
      WHEN o.branch IS NOT NULL AND TRIM(o.branch) <> ''
        THEN o.org_name || ' (' || o.branch || ')'
      ELSE o.org_name
    END AS display_label
  FROM public.organizations o
  LEFT JOIN public.states s ON s.id = o.state_id
  WHERE o.org_type_code = 'SHOP'
    AND o.is_active = true
    AND (
      p_search_term IS NULL
      OR TRIM(p_search_term) = ''
      OR o.org_name ILIKE '%' || TRIM(p_search_term) || '%'
      OR o.branch ILIKE '%' || TRIM(p_search_term) || '%'
      OR o.contact_name ILIKE '%' || TRIM(p_search_term) || '%'
      OR o.contact_phone ILIKE '%' || TRIM(p_search_term) || '%'
    )
  ORDER BY o.org_name ASC, o.branch ASC NULLS LAST
  LIMIT LEAST(p_limit, 30);
$$;

COMMENT ON FUNCTION public.search_shops IS 'Autocomplete search for active shops. Searches by shop name, branch, contact name, or contact phone.';

-- ============================================================================
-- 5. Fix v_consumer_points_balance reference resolution
--    Use _normalize_phone_my consistently for the reference JOIN
--    instead of inline CASE that may not match stored phone formats
-- ============================================================================
CREATE OR REPLACE VIEW public.v_consumer_points_balance AS
 WITH scan_points AS (
         SELECT cqs.consumer_id,
            sum(
                CASE
                    WHEN COALESCE(cqs.is_manual_adjustment, false) THEN 0
                    ELSE cqs.points_amount
                END) AS total_earned_scans,
            sum(
                CASE
                    WHEN COALESCE(cqs.is_manual_adjustment, false) THEN cqs.points_amount
                    ELSE 0
                END) AS total_manual_scans,
            count(*) AS scan_count,
            max(cqs.scanned_at) AS last_scan_at
           FROM public.consumer_qr_scans cqs
          WHERE ((cqs.collected_points = true) AND (cqs.consumer_id IS NOT NULL))
          GROUP BY cqs.consumer_id
        ), transaction_points AS (
         SELECT pt.user_id,
            sum(
                CASE
                    WHEN (pt.transaction_type = 'adjust'::text) THEN 0
                    ELSE pt.points_amount
                END) AS total_transaction_points,
            count(*) AS transaction_count,
            max(pt.transaction_date) AS last_transaction_at,
            sum(
                CASE
                    WHEN (pt.transaction_type = 'redeem'::text) THEN abs(pt.points_amount)
                    ELSE 0
                END) AS total_redeemed,
            sum(
                CASE
                    WHEN (pt.transaction_type = 'adjust'::text) THEN pt.points_amount
                    ELSE 0
                END) AS total_adjusted,
            sum(
                CASE
                    WHEN (pt.transaction_type = 'MIGRATION'::text) THEN pt.points_amount
                    ELSE 0
                END) AS total_migration,
            sum(
                CASE
                    WHEN (pt.transaction_type <> ALL (ARRAY['redeem'::text, 'adjust'::text, 'MIGRATION'::text])) THEN pt.points_amount
                    ELSE 0
                END) AS total_other,
            string_agg(DISTINCT
                CASE
                    WHEN (pt.transaction_type <> ALL (ARRAY['redeem'::text, 'adjust'::text, 'MIGRATION'::text])) THEN pt.transaction_type
                    ELSE NULL::text
                END, ', '::text) AS other_types,
            ( SELECT pt2.created_by
                   FROM public.points_transactions pt2
                  WHERE ((pt2.user_id = pt.user_id) AND (pt2.transaction_type = 'MIGRATION'::text))
                  ORDER BY pt2.transaction_date DESC
                 LIMIT 1) AS last_migration_by_id
           FROM public.points_transactions pt
          WHERE (pt.user_id IS NOT NULL)
          GROUP BY pt.user_id
        )
 SELECT u.id AS user_id,
    COALESCE(u.full_name, 'Unknown Consumer'::text) AS consumer_name,
    u.phone AS consumer_phone,
    u.email AS consumer_email,
    u.location AS consumer_location,
    u.referral_phone AS consumer_reference,
    ref_user.full_name AS referral_name,
    ref_user.email AS referral_email,
    ref_user.phone AS referral_phone_full,
    u.shop_name AS consumer_shop_name,
    u.organization_id AS consumer_org_id,
    org.org_name AS consumer_org_name,
    u.role_code,
    ((COALESCE(sp.total_earned_scans, (0)::bigint) +
        CASE
            WHEN (COALESCE(sp.total_manual_scans, (0)::bigint) > 0) THEN COALESCE(sp.total_manual_scans, (0)::bigint)
            ELSE COALESCE(tp.total_adjusted, (0)::bigint)
        END) + COALESCE(tp.total_transaction_points, (0)::bigint)) AS current_balance,
    COALESCE(sp.total_earned_scans, (0)::bigint) AS total_collected_system,
        CASE
            WHEN (COALESCE(sp.total_manual_scans, (0)::bigint) > 0) THEN COALESCE(sp.total_manual_scans, (0)::bigint)
            ELSE COALESCE(tp.total_adjusted, (0)::bigint)
        END AS total_collected_manual,
    COALESCE(tp.total_migration, (0)::bigint) AS total_migration,
    COALESCE(tp.total_redeemed, (0)::bigint) AS total_redeemed,
    COALESCE(tp.total_other, (0)::bigint) AS total_other,
    tp.other_types,
    (COALESCE(sp.scan_count, (0)::bigint) + COALESCE(tp.transaction_count, (0)::bigint)) AS transaction_count,
    GREATEST(sp.last_scan_at, tp.last_transaction_at) AS last_transaction_date,
    mu.full_name AS last_migration_by_name
   FROM (((((public.users u
     LEFT JOIN scan_points sp ON ((u.id = sp.consumer_id)))
     LEFT JOIN transaction_points tp ON ((u.id = tp.user_id)))
     LEFT JOIN public.users mu ON ((tp.last_migration_by_id = mu.id)))
     LEFT JOIN public.users ref_user ON ((public._normalize_phone_my(ref_user.phone) = public._normalize_phone_my(u.referral_phone))))
     LEFT JOIN public.organizations org ON ((u.organization_id = org.id)))
  WHERE ((u.role_code = ANY (ARRAY['CONSUMER'::text, 'GUEST'::text])) OR (sp.consumer_id IS NOT NULL) OR (tp.user_id IS NOT NULL));

-- ============================================================================
-- 6. validate_reference_eligibility(): server-side validation
--    Called before assigning a reference to validate eligibility
-- ============================================================================
CREATE OR REPLACE FUNCTION public.validate_reference_eligibility(
  p_reference_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
DECLARE
  v_user RECORD;
BEGIN
  IF p_reference_user_id IS NULL THEN
    RETURN jsonb_build_object('valid', true, 'message', 'No reference assigned');
  END IF;

  SELECT id, full_name, phone, email, can_be_reference, is_active
  INTO v_user
  FROM public.users
  WHERE id = p_reference_user_id;

  IF v_user IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'message', 'Reference user not found');
  END IF;

  IF NOT v_user.is_active THEN
    RETURN jsonb_build_object('valid', false, 'message', 'Reference user is inactive');
  END IF;

  IF NOT v_user.can_be_reference THEN
    RETURN jsonb_build_object('valid', false, 'message', 'User is not eligible to be a reference');
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'message', 'Eligible',
    'reference_name', v_user.full_name,
    'reference_phone', v_user.phone,
    'reference_email', v_user.email
  );
END;
$$;

COMMENT ON FUNCTION public.validate_reference_eligibility IS 'Server-side validation that a user is eligible to be assigned as a reference';

-- ============================================================================
-- 7. Grant execute permissions
-- ============================================================================
GRANT EXECUTE ON FUNCTION public.search_eligible_references TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_shops TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_reference_eligibility TO authenticated;
