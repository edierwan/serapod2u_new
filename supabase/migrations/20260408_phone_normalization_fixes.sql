-- Migration: Phone normalization fixes
-- Date: 2026-04-08
-- Fixes: _normalize_phone_my() double-prefix bug, backfills reference_user_id,
--         cleans malformed referral_phone, normalizes all phones to E.164,
--         fixes v_referral_monitor view one-sided normalize bug

-- FIX 1: Fix _normalize_phone_my() - was producing +60601128442974 for 601128442974
CREATE OR REPLACE FUNCTION public._normalize_phone_my(p_phone text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_phone IS NULL OR trim(p_phone) = '' THEN NULL
    WHEN p_phone LIKE '+6%' THEN regexp_replace(p_phone, '[^0-9+]', '', 'g')
    WHEN regexp_replace(p_phone, '[^0-9]', '', 'g') LIKE '0%'
      THEN '+60' || substring(regexp_replace(p_phone, '[^0-9]', '', 'g') from 2)
    WHEN regexp_replace(p_phone, '[^0-9]', '', 'g') LIKE '60%'
      THEN '+' || regexp_replace(p_phone, '[^0-9]', '', 'g')
    ELSE '+60' || regexp_replace(p_phone, '[^0-9]', '', 'g')
  END
$function$;

-- FIX 2: Backfill reference_user_id in reference_assignments
UPDATE reference_assignments ra
SET reference_user_id = u.id
FROM public.users u
WHERE ra.reference_user_id IS NULL
  AND ra.reference_phone IS NOT NULL
  AND _normalize_phone_my(u.phone) = _normalize_phone_my(ra.reference_phone)
  AND (ra.effective_to IS NULL OR ra.effective_to > now());

-- FIX 4: Clean malformed referral_phone (name+phone, email, junk)
UPDATE users
SET referral_phone = CASE
  WHEN referral_phone ~ '(\+?0[0-9]{9,12})'
    THEN (regexp_match(referral_phone, '(\+?0[0-9]{9,12})'))[1]
  ELSE NULL
END,
updated_at = now()
WHERE referral_phone IS NOT NULL
  AND referral_phone !~ '^[0-9+ ()-]+$';

-- FIX 5a: Normalize users.phone to E.164
UPDATE users
SET phone = _normalize_phone_my(phone)
WHERE phone IS NOT NULL 
  AND phone NOT LIKE '+%'
  AND _normalize_phone_my(phone) IS NOT NULL;

-- FIX 5b: Normalize users.referral_phone to E.164
UPDATE users
SET referral_phone = _normalize_phone_my(referral_phone)
WHERE referral_phone IS NOT NULL
  AND referral_phone NOT LIKE '+%'
  AND _normalize_phone_my(referral_phone) IS NOT NULL;

-- FIX 5c: Normalize reference_assignments.reference_phone to E.164
UPDATE reference_assignments
SET reference_phone = _normalize_phone_my(reference_phone)
WHERE reference_phone IS NOT NULL
  AND reference_phone NOT LIKE '+%'
  AND _normalize_phone_my(reference_phone) IS NOT NULL;

-- FIX 6: Fix v_referral_monitor - normalize BOTH sides in phone join
CREATE OR REPLACE VIEW v_referral_monitor AS
WITH active_assignments AS (
    SELECT ra.reference_user_id,
        ra.org_id,
        count(*) AS assigned_shops_count
    FROM reference_assignments ra
    WHERE ra.effective_to IS NULL AND ra.reference_user_id IS NOT NULL
    GROUP BY ra.reference_user_id, ra.org_id
), phone_only_assignments AS (
    SELECT ra.reference_phone,
        ra.org_id,
        count(*) AS assigned_shops_count
    FROM reference_assignments ra
    WHERE ra.effective_to IS NULL AND ra.reference_user_id IS NULL AND ra.reference_phone IS NOT NULL
    GROUP BY ra.reference_phone, ra.org_id
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
), all_reference_ids AS (
    SELECT DISTINCT active_assignments.reference_user_id AS user_id
    FROM active_assignments
    WHERE active_assignments.reference_user_id IS NOT NULL
  UNION
    SELECT DISTINCT accrual_totals.reference_user_id
    FROM accrual_totals
  UNION
    SELECT DISTINCT reference_change_log.new_reference_id
    FROM reference_change_log
    WHERE reference_change_log.new_reference_id IS NOT NULL
  UNION
    SELECT DISTINCT reference_change_log.old_reference_id
    FROM reference_change_log
    WHERE reference_change_log.old_reference_id IS NOT NULL
  UNION
    SELECT DISTINCT u2.id
    FROM users u2
      JOIN users cu ON _normalize_phone_my(cu.referral_phone) = _normalize_phone_my(u2.phone)
    WHERE cu.referral_phone IS NOT NULL AND TRIM(BOTH FROM cu.referral_phone) <> ''::text
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
  JOIN all_reference_ids ari ON ari.user_id = u.id
  LEFT JOIN active_assignments aa ON aa.reference_user_id = u.id
  LEFT JOIN accrual_totals at2 ON at2.reference_user_id = u.id
  LEFT JOIN claim_totals ct ON ct.reference_user_id = u.id
  LEFT JOIN adjustment_totals adj ON adj.reference_user_id = u.id;
