-- ============================================================================
-- User ↔ Shop Migration SQL Scripts
-- Run on STAGING first, then PRODUCTION after verification
-- ============================================================================

-- ============================================================================
-- STEP 1: Create view for shop points reporting
-- This view aggregates consumer points by their linked shop (organization)
-- ============================================================================
CREATE OR REPLACE VIEW public.v_shop_points_summary AS
WITH consumer_balances AS (
  SELECT
    user_id,
    consumer_name,
    consumer_phone,
    consumer_shop_name,
    current_balance,
    total_collected_system,
    total_collected_manual,
    total_migration,
    total_redeemed,
    transaction_count,
    last_transaction_date
  FROM v_consumer_points_balance
)
SELECT
  o.id AS shop_id,
  o.org_name AS shop_name,
  o.branch AS branch_name,
  o.contact_name,
  o.contact_phone,
  o.state_id AS state,
  COUNT(cb.user_id) AS total_consumers,
  COALESCE(SUM(cb.current_balance), 0) AS total_points_balance,
  COALESCE(SUM(cb.total_collected_system), 0) AS total_collected_system,
  COALESCE(SUM(cb.total_collected_manual), 0) AS total_collected_manual,
  COALESCE(SUM(cb.total_migration), 0) AS total_migration_points,
  COALESCE(SUM(cb.total_redeemed), 0) AS total_redeemed,
  COALESCE(SUM(cb.transaction_count), 0) AS total_transactions,
  MAX(cb.last_transaction_date) AS last_activity
FROM organizations o
LEFT JOIN users u ON u.organization_id = o.id
  AND u.role_code IN ('CONSUMER', 'GUEST')
  AND u.is_active = true
LEFT JOIN consumer_balances cb ON cb.user_id = u.id
WHERE o.org_type_code = 'SHOP'
GROUP BY o.id, o.org_name, o.branch, o.contact_name, o.contact_phone, o.state_id
ORDER BY total_points_balance DESC;

-- Grant access
GRANT SELECT ON v_shop_points_summary TO authenticated;
GRANT SELECT ON v_shop_points_summary TO anon;

-- ============================================================================
-- STEP 2: Create view for user-shop migration assessment
-- Shows all consumers with match status against organizations
-- ============================================================================
CREATE OR REPLACE VIEW public.v_user_shop_migration AS
SELECT
  u.id AS user_id,
  u.full_name,
  u.phone,
  u.email,
  u.shop_name AS current_shop_name,
  u.organization_id AS current_org_id,
  o_current.org_name AS current_org_name,
  -- Try to find matching org by shop_name (case-insensitive)
  o_match.id AS matched_org_id,
  o_match.org_name AS matched_org_name,
  o_match.branch AS matched_org_branch,
  -- Classification
  CASE
    WHEN u.organization_id IS NOT NULL THEN 'linked'
    WHEN u.shop_name IS NOT NULL AND u.shop_name != '' AND o_match.id IS NOT NULL THEN 'auto_matchable'
    WHEN u.shop_name IS NOT NULL AND u.shop_name != '' AND o_match.id IS NULL THEN 'unmatched'
    ELSE 'no_shop'
  END AS match_status,
  u.created_at,
  u.is_active
FROM users u
LEFT JOIN organizations o_current ON u.organization_id = o_current.id
LEFT JOIN organizations o_match ON LOWER(TRIM(u.shop_name)) = LOWER(TRIM(o_match.org_name))
  AND o_match.org_type_code = 'SHOP'
WHERE u.role_code IN ('CONSUMER', 'GUEST');

-- Grant access
GRANT SELECT ON v_user_shop_migration TO authenticated;

-- ============================================================================
-- STEP 3: RLS policy for the new views (already inherits from base tables)
-- The views use base table data so RLS on users/organizations applies.
-- No additional RLS needed for views themselves.
-- ============================================================================

-- ============================================================================
-- STEP 4: Update v_consumer_points_balance to include organization_id
-- We add organization_id and org_name so the User Points Monitor can
-- group/filter by shop organization
-- ============================================================================
CREATE OR REPLACE VIEW public.v_consumer_points_balance AS
WITH scan_points AS (
  SELECT
    cqs.consumer_id,
    SUM(CASE WHEN COALESCE(cqs.is_manual_adjustment, false) THEN 0 ELSE cqs.points_amount END) AS total_earned_scans,
    SUM(CASE WHEN COALESCE(cqs.is_manual_adjustment, false) THEN cqs.points_amount ELSE 0 END) AS total_manual_scans,
    COUNT(*) AS scan_count,
    MAX(cqs.scanned_at) AS last_scan_at
  FROM consumer_qr_scans cqs
  WHERE cqs.collected_points = true AND cqs.consumer_id IS NOT NULL
  GROUP BY cqs.consumer_id
), transaction_points AS (
  SELECT
    pt.user_id,
    SUM(CASE WHEN pt.transaction_type = 'adjust' THEN 0 ELSE pt.points_amount END) AS total_transaction_points,
    COUNT(*) AS transaction_count,
    MAX(pt.transaction_date) AS last_transaction_at,
    SUM(CASE WHEN pt.transaction_type = 'redeem' THEN ABS(pt.points_amount) ELSE 0 END) AS total_redeemed,
    SUM(CASE WHEN pt.transaction_type = 'adjust' THEN pt.points_amount ELSE 0 END) AS total_adjusted,
    SUM(CASE WHEN pt.transaction_type = 'MIGRATION' THEN pt.points_amount ELSE 0 END) AS total_migration,
    SUM(CASE WHEN pt.transaction_type NOT IN ('redeem','adjust','MIGRATION') THEN pt.points_amount ELSE 0 END) AS total_other,
    STRING_AGG(DISTINCT CASE WHEN pt.transaction_type NOT IN ('redeem','adjust','MIGRATION') THEN pt.transaction_type ELSE NULL END, ', ') AS other_types,
    (SELECT pt2.created_by FROM points_transactions pt2
     WHERE pt2.user_id = pt.user_id AND pt2.transaction_type = 'MIGRATION'
     ORDER BY pt2.transaction_date DESC LIMIT 1) AS last_migration_by_id
  FROM points_transactions pt
  WHERE pt.user_id IS NOT NULL
  GROUP BY pt.user_id
)
SELECT
  u.id AS user_id,
  COALESCE(u.full_name, 'Unknown Consumer') AS consumer_name,
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
  COALESCE(sp.total_earned_scans, 0)
    + CASE WHEN COALESCE(sp.total_manual_scans, 0) > 0 THEN COALESCE(sp.total_manual_scans, 0) ELSE COALESCE(tp.total_adjusted, 0) END
    + COALESCE(tp.total_transaction_points, 0) AS current_balance,
  COALESCE(sp.total_earned_scans, 0) AS total_collected_system,
  CASE WHEN COALESCE(sp.total_manual_scans, 0) > 0 THEN COALESCE(sp.total_manual_scans, 0) ELSE COALESCE(tp.total_adjusted, 0) END AS total_collected_manual,
  COALESCE(tp.total_migration, 0) AS total_migration,
  COALESCE(tp.total_redeemed, 0) AS total_redeemed,
  COALESCE(tp.total_other, 0) AS total_other,
  tp.other_types,
  COALESCE(sp.scan_count, 0) + COALESCE(tp.transaction_count, 0) AS transaction_count,
  GREATEST(sp.last_scan_at, tp.last_transaction_at) AS last_transaction_date,
  mu.full_name AS last_migration_by_name
FROM users u
LEFT JOIN scan_points sp ON u.id = sp.consumer_id
LEFT JOIN transaction_points tp ON u.id = tp.user_id
LEFT JOIN users mu ON tp.last_migration_by_id = mu.id
LEFT JOIN users ref_user ON ref_user.phone =
  CASE
    WHEN u.referral_phone IS NULL OR TRIM(u.referral_phone) = '' THEN NULL
    WHEN u.referral_phone LIKE '+6%' THEN regexp_replace(u.referral_phone, '[^0-9+]', '', 'g')
    WHEN regexp_replace(u.referral_phone, '[^0-9]', '', 'g') LIKE '0%' THEN '+6' || regexp_replace(u.referral_phone, '[^0-9]', '', 'g')
    ELSE '+60' || regexp_replace(u.referral_phone, '[^0-9]', '', 'g')
  END
LEFT JOIN organizations org ON u.organization_id = org.id
WHERE u.role_code IN ('CONSUMER', 'GUEST')
   OR sp.consumer_id IS NOT NULL
   OR tp.user_id IS NOT NULL;

-- Re-grant access after view recreation
GRANT SELECT ON v_consumer_points_balance TO authenticated;
GRANT SELECT ON v_consumer_points_balance TO anon;
