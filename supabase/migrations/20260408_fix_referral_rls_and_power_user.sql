-- ============================================================================
-- Migration: Fix Referral RLS Policies, Power User Permissions, Eligible Filter
-- Date: 2026-04-08
--
-- Changes:
-- 1. Fix RLS policies on referral tables to use correct role codes (SA, HQ, POWER_USER)
-- 2. Add edit_users permission to POWER_USER role
-- 3. Update v_referral_monitor to filter by can_be_reference = true
-- 4. Create get_reference_assigned_shops() function for shop dialog
-- ============================================================================

-- ============================================================================
-- 1. Fix RLS policies on reference_assignments
--    Old policies use SUPER_ADMIN, ADMIN, HQ_ADMIN (wrong codes)
--    Correct codes: SA, HQ, POWER_USER
-- ============================================================================

-- Drop old policies
DROP POLICY IF EXISTS "Admins can view reference assignments" ON public.reference_assignments;
DROP POLICY IF EXISTS "System and admins can manage reference assignments" ON public.reference_assignments;

-- Recreate with correct role codes
CREATE POLICY "Admins can view reference assignments"
  ON public.reference_assignments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role_code IN ('SA', 'HQ', 'POWER_USER', 'HQ_ADMIN', 'SUPER_ADMIN', 'ADMIN')
    )
  );

CREATE POLICY "System and admins can manage reference assignments"
  ON public.reference_assignments
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role_code IN ('SA', 'HQ', 'POWER_USER', 'HQ_ADMIN', 'SUPER_ADMIN', 'ADMIN')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role_code IN ('SA', 'HQ', 'POWER_USER', 'HQ_ADMIN', 'SUPER_ADMIN', 'ADMIN')
    )
  );

-- ============================================================================
-- Fix RLS policies on referral_accruals
-- ============================================================================
DO $$
BEGIN
  -- Drop old policies if they exist
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'referral_accruals' AND policyname = 'Admins can view referral accruals') THEN
    DROP POLICY "Admins can view referral accruals" ON public.referral_accruals;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'referral_accruals' AND policyname = 'System and admins can manage referral accruals') THEN
    DROP POLICY "System and admins can manage referral accruals" ON public.referral_accruals;
  END IF;
END $$;

CREATE POLICY "Admins can view referral accruals"
  ON public.referral_accruals FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role_code IN ('SA', 'HQ', 'POWER_USER', 'HQ_ADMIN', 'SUPER_ADMIN', 'ADMIN')
    )
  );

CREATE POLICY "System and admins can manage referral accruals"
  ON public.referral_accruals
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role_code IN ('SA', 'HQ', 'POWER_USER', 'HQ_ADMIN', 'SUPER_ADMIN', 'ADMIN')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role_code IN ('SA', 'HQ', 'POWER_USER', 'HQ_ADMIN', 'SUPER_ADMIN', 'ADMIN')
    )
  );

-- ============================================================================
-- Fix RLS policies on referral_claims
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'referral_claims' AND policyname = 'Admins can view referral claims') THEN
    DROP POLICY "Admins can view referral claims" ON public.referral_claims;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'referral_claims' AND policyname = 'System and admins can manage referral claims') THEN
    DROP POLICY "System and admins can manage referral claims" ON public.referral_claims;
  END IF;
END $$;

CREATE POLICY "Admins can view referral claims"
  ON public.referral_claims FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role_code IN ('SA', 'HQ', 'POWER_USER', 'HQ_ADMIN', 'SUPER_ADMIN', 'ADMIN')
    )
  );

CREATE POLICY "System and admins can manage referral claims"
  ON public.referral_claims
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role_code IN ('SA', 'HQ', 'POWER_USER', 'HQ_ADMIN', 'SUPER_ADMIN', 'ADMIN')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role_code IN ('SA', 'HQ', 'POWER_USER', 'HQ_ADMIN', 'SUPER_ADMIN', 'ADMIN')
    )
  );

-- ============================================================================
-- Fix RLS policies on referral_adjustments
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'referral_adjustments' AND policyname = 'Admins can view referral adjustments') THEN
    DROP POLICY "Admins can view referral adjustments" ON public.referral_adjustments;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'referral_adjustments' AND policyname = 'System and admins can manage referral adjustments') THEN
    DROP POLICY "System and admins can manage referral adjustments" ON public.referral_adjustments;
  END IF;
END $$;

CREATE POLICY "Admins can view referral adjustments"
  ON public.referral_adjustments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role_code IN ('SA', 'HQ', 'POWER_USER', 'HQ_ADMIN', 'SUPER_ADMIN', 'ADMIN')
    )
  );

CREATE POLICY "System and admins can manage referral adjustments"
  ON public.referral_adjustments
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role_code IN ('SA', 'HQ', 'POWER_USER', 'HQ_ADMIN', 'SUPER_ADMIN', 'ADMIN')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role_code IN ('SA', 'HQ', 'POWER_USER', 'HQ_ADMIN', 'SUPER_ADMIN', 'ADMIN')
    )
  );

-- ============================================================================
-- 2. Add edit_users permission to POWER_USER role
-- ============================================================================
UPDATE public.roles
SET permissions = COALESCE(permissions, '{}'::jsonb) || '{"edit_users": true, "view_users": true}'::jsonb
WHERE role_code = 'POWER_USER'
  AND NOT COALESCE(permissions->>'edit_users', 'false')::boolean;

-- ============================================================================
-- 3. Update v_referral_monitor to only show users with can_be_reference = true
-- ============================================================================
CREATE OR REPLACE VIEW public.v_referral_monitor AS
WITH active_assignments AS (
    SELECT ra.reference_user_id,
        ra.org_id,
        count(*) AS assigned_shops_count
    FROM reference_assignments ra
    WHERE ra.effective_to IS NULL AND ra.reference_user_id IS NOT NULL
    GROUP BY ra.reference_user_id, ra.org_id
), accrual_totals AS (
    SELECT rac.reference_user_id,
        rac.org_id,
        COALESCE(sum(rac.points_amount), 0::bigint) AS total_accrued_points,
        COALESCE(sum(rac.rm_amount), 0::numeric) AS total_accrued_rm
    FROM referral_accruals rac
    GROUP BY rac.reference_user_id, rac.org_id
), claim_totals AS (
    SELECT rc.reference_user_id,
        rc.org_id,
        COALESCE(sum(
            CASE
                WHEN rc.status = ANY (ARRAY['approved'::referral_claim_status, 'paid'::referral_claim_status]) THEN rc.claim_points
                ELSE 0
            END), 0::bigint) AS total_claimed_points,
        COALESCE(sum(
            CASE
                WHEN rc.status = ANY (ARRAY['approved'::referral_claim_status, 'paid'::referral_claim_status]) THEN rc.claim_rm
                ELSE 0::numeric
            END), 0::numeric) AS total_claimed_rm,
        count(
            CASE
                WHEN rc.status = 'pending'::referral_claim_status THEN 1
                ELSE NULL::integer
            END) AS pending_claims_count
    FROM referral_claims rc
    GROUP BY rc.reference_user_id, rc.org_id
), adjustment_totals AS (
    SELECT radj.reference_user_id,
        radj.org_id,
        COALESCE(sum(
            CASE
                WHEN radj.adjustment_type = ANY (ARRAY['credit'::referral_adjustment_type, 'transfer_in'::referral_adjustment_type]) THEN radj.points_amount
                ELSE 0
            END), 0::bigint) AS total_adj_credit_points,
        COALESCE(sum(
            CASE
                WHEN radj.adjustment_type = ANY (ARRAY['debit'::referral_adjustment_type, 'transfer_out'::referral_adjustment_type]) THEN radj.points_amount
                ELSE 0
            END), 0::bigint) AS total_adj_debit_points,
        COALESCE(sum(
            CASE
                WHEN radj.adjustment_type = ANY (ARRAY['credit'::referral_adjustment_type, 'transfer_in'::referral_adjustment_type]) THEN radj.rm_amount
                ELSE 0::numeric
            END), 0::numeric) AS total_adj_credit_rm,
        COALESCE(sum(
            CASE
                WHEN radj.adjustment_type = ANY (ARRAY['debit'::referral_adjustment_type, 'transfer_out'::referral_adjustment_type]) THEN radj.rm_amount
                ELSE 0::numeric
            END), 0::numeric) AS total_adj_debit_rm
    FROM referral_adjustments radj
    GROUP BY radj.reference_user_id, radj.org_id
)
SELECT u.id AS reference_user_id,
    u.full_name AS reference_name,
    u.phone AS reference_phone,
    u.email AS reference_email,
    COALESCE(u.employment_status, u.role_code) AS employment_status,
    u.organization_id AS reference_org_id,
    COALESCE(aa.org_id, at2.org_id, ct.org_id, adj.org_id, u.organization_id) AS org_id,
    COALESCE(aa.assigned_shops_count, 0::bigint) AS assigned_shops_count,
    COALESCE(at2.total_accrued_points, 0::bigint) AS total_accrued_points,
    COALESCE(at2.total_accrued_rm, 0::numeric)::numeric(12,2) AS total_accrued_rm,
    COALESCE(ct.total_claimed_points, 0::bigint) AS total_claimed_points,
    COALESCE(ct.total_claimed_rm, 0::numeric)::numeric(12,2) AS total_claimed_rm,
    COALESCE(ct.pending_claims_count, 0::bigint) AS pending_claims_count,
    COALESCE(at2.total_accrued_points, 0::bigint) + COALESCE(adj.total_adj_credit_points, 0::bigint) - COALESCE(adj.total_adj_debit_points, 0::bigint) - COALESCE(ct.total_claimed_points, 0::bigint) AS claimable_points,
    (COALESCE(at2.total_accrued_rm, 0::numeric) + COALESCE(adj.total_adj_credit_rm, 0::numeric) - COALESCE(adj.total_adj_debit_rm, 0::numeric) - COALESCE(ct.total_claimed_rm, 0::numeric))::numeric(12,2) AS claimable_rm
FROM users u
  LEFT JOIN active_assignments aa ON aa.reference_user_id = u.id
  LEFT JOIN accrual_totals at2 ON at2.reference_user_id = u.id
  LEFT JOIN claim_totals ct ON ct.reference_user_id = u.id
  LEFT JOIN adjustment_totals adj ON adj.reference_user_id = u.id
WHERE u.can_be_reference = true
  AND u.is_active = true;

-- ============================================================================
-- 4. Create SECURITY DEFINER function for fetching assigned shops
--    This bypasses RLS so the shop dialog works reliably
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_reference_assigned_shops(
  p_reference_user_id uuid
)
RETURNS TABLE (
  assignment_id uuid,
  shop_user_id uuid,
  effective_from timestamptz,
  shop_name text,
  shop_phone text
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    ra.id AS assignment_id,
    ra.shop_user_id,
    ra.effective_from,
    COALESCE(su.full_name, 'Unknown') AS shop_name,
    COALESCE(su.phone, '') AS shop_phone
  FROM public.reference_assignments ra
  LEFT JOIN public.users su ON su.id = ra.shop_user_id
  WHERE ra.reference_user_id = p_reference_user_id
    AND ra.effective_to IS NULL
  ORDER BY ra.effective_from DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_reference_assigned_shops TO authenticated;
COMMENT ON FUNCTION public.get_reference_assigned_shops IS 'Fetch active shop assignments for a reference user. Bypasses RLS for reliable dialog display.';
