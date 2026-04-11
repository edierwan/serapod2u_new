-- STAGING ONLY
-- Legacy dual-claim cleanup before production rollout.
-- Purpose:
-- 1. Reclassify historical SHOP-attached collected scans from consumer lane to shop lane.
-- 2. Remove SHOP users from consumer balance reporting.
-- 3. Rebuild shop summary reporting from shop balances instead of consumer balances.

BEGIN;

WITH affected AS (
  SELECT cqs.id, cqs.qr_code_id
  FROM public.consumer_qr_scans cqs
  JOIN public.users u ON u.id = cqs.consumer_id
  JOIN public.organizations o ON o.id = u.organization_id
  WHERE cqs.collected_points = true
    AND cqs.claim_lane = 'consumer'
    AND o.org_type_code = 'SHOP'
),
updated_scans AS (
  UPDATE public.consumer_qr_scans cqs
  SET claim_lane = 'shop',
      consumer_id = NULL
  FROM affected a
  WHERE cqs.id = a.id
  RETURNING cqs.qr_code_id
)
UPDATE public.qr_codes qr
SET is_shop_points_collected = true,
    is_consumer_points_collected = false,
    is_points_collected = true,
    consumer_name = NULL,
    consumer_phone = NULL,
    consumer_email = NULL
WHERE qr.id IN (SELECT DISTINCT qr_code_id FROM updated_scans);

CREATE OR REPLACE VIEW public.v_consumer_points_balance AS
WITH scan_points AS (
    SELECT cqs.consumer_id,
        sum(CASE WHEN COALESCE(cqs.is_manual_adjustment, false) THEN 0 ELSE cqs.points_amount END) AS total_earned_scans,
        sum(CASE WHEN COALESCE(cqs.is_manual_adjustment, false) THEN cqs.points_amount ELSE 0 END) AS total_manual_scans,
        count(*) AS scan_count,
        max(cqs.scanned_at) AS last_scan_at
    FROM consumer_qr_scans cqs
    WHERE cqs.collected_points = true
      AND cqs.consumer_id IS NOT NULL
    GROUP BY cqs.consumer_id
),
transaction_points AS (
    SELECT pt.user_id,
        sum(CASE WHEN pt.transaction_type = 'adjust'::text THEN 0 ELSE pt.points_amount END) AS total_transaction_points,
        count(*) AS transaction_count,
        max(pt.transaction_date) AS last_transaction_at,
        sum(CASE WHEN pt.transaction_type = 'redeem'::text THEN abs(pt.points_amount) ELSE 0 END) AS total_redeemed,
        sum(CASE WHEN pt.transaction_type = 'adjust'::text THEN pt.points_amount ELSE 0 END) AS total_adjusted,
        sum(CASE WHEN pt.transaction_type = 'MIGRATION'::text THEN pt.points_amount ELSE 0 END) AS total_migration,
        sum(CASE WHEN pt.transaction_type <> ALL (ARRAY['redeem'::text, 'adjust'::text, 'MIGRATION'::text]) THEN pt.points_amount ELSE 0 END) AS total_other,
        string_agg(
            DISTINCT CASE
                WHEN pt.transaction_type <> ALL (ARRAY['redeem'::text, 'adjust'::text, 'MIGRATION'::text]) THEN pt.transaction_type
                ELSE NULL::text
            END,
            ', '::text
        ) AS other_types,
        (
            SELECT pt2.created_by
            FROM points_transactions pt2
            WHERE pt2.user_id = pt.user_id
              AND pt2.transaction_type = 'MIGRATION'::text
            ORDER BY pt2.transaction_date DESC
            LIMIT 1
        ) AS last_migration_by_id
    FROM points_transactions pt
    WHERE pt.user_id IS NOT NULL
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
    COALESCE(sp.total_earned_scans, 0::bigint) +
        CASE
            WHEN COALESCE(sp.total_manual_scans, 0::bigint) > 0 THEN COALESCE(sp.total_manual_scans, 0::bigint)
            ELSE COALESCE(tp.total_adjusted, 0::bigint)
        END + COALESCE(tp.total_transaction_points, 0::bigint) AS current_balance,
    COALESCE(sp.total_earned_scans, 0::bigint) AS total_collected_system,
        CASE
            WHEN COALESCE(sp.total_manual_scans, 0::bigint) > 0 THEN COALESCE(sp.total_manual_scans, 0::bigint)
            ELSE COALESCE(tp.total_adjusted, 0::bigint)
        END AS total_collected_manual,
    COALESCE(tp.total_migration, 0::bigint) AS total_migration,
    COALESCE(tp.total_redeemed, 0::bigint) AS total_redeemed,
    COALESCE(tp.total_other, 0::bigint) AS total_other,
    tp.other_types,
    COALESCE(sp.scan_count, 0::bigint) + COALESCE(tp.transaction_count, 0::bigint) AS transaction_count,
    GREATEST(sp.last_scan_at, tp.last_transaction_at) AS last_transaction_date,
    mu.full_name AS last_migration_by_name
FROM users u
LEFT JOIN scan_points sp ON u.id = sp.consumer_id
LEFT JOIN transaction_points tp ON u.id = tp.user_id
LEFT JOIN users mu ON tp.last_migration_by_id = mu.id
LEFT JOIN users ref_user ON _normalize_phone_my(ref_user.phone) = _normalize_phone_my(u.referral_phone)
LEFT JOIN organizations org ON u.organization_id = org.id
WHERE (((u.role_code = ANY (ARRAY['CONSUMER'::text, 'GUEST'::text]))
    OR sp.consumer_id IS NOT NULL
    OR tp.user_id IS NOT NULL)
   AND COALESCE(org.org_type_code, 'NO_ORG'::text) <> 'SHOP'::text);

CREATE OR REPLACE VIEW public.v_shop_points_summary AS
WITH user_counts AS (
    SELECT o.id AS shop_id,
           count(u.id) AS total_consumers
    FROM organizations o
    LEFT JOIN users u
      ON u.organization_id = o.id
     AND (u.role_code = ANY (ARRAY['CONSUMER'::text, 'GUEST'::text]))
     AND u.is_active = true
    WHERE o.org_type_code = 'SHOP'::text
    GROUP BY o.id
)
SELECT o.id AS shop_id,
    o.org_name AS shop_name,
    o.branch AS branch_name,
    o.contact_name,
    o.contact_phone,
    COALESCE(s.state_name, ''::text) AS state,
    COALESCE(uc.total_consumers, 0::bigint) AS total_consumers,
    COALESCE(vsp.current_balance, 0::numeric) AS total_points_balance,
    COALESCE(vsp.total_earned_scans, 0::numeric) AS total_collected_system,
    COALESCE(vsp.total_manual_adjustments, 0::numeric) AS total_collected_manual,
    0::numeric AS total_migration_points,
    COALESCE(vsp.total_redeemed, 0::numeric) AS total_redeemed,
    COALESCE(vsp.transaction_count, 0::numeric) AS total_transactions,
    vsp.last_transaction_at AS last_activity
FROM organizations o
LEFT JOIN states s ON o.state_id = s.id
LEFT JOIN user_counts uc ON uc.shop_id = o.id
LEFT JOIN v_shop_points_balance vsp ON vsp.shop_id = o.id
WHERE o.org_type_code = 'SHOP'::text
ORDER BY COALESCE(vsp.current_balance, 0::numeric) DESC;


COMMIT;