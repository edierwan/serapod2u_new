-- ============================================================================
-- Migration: Fix Points Distributed stats & Shop Points Summary view state
-- Date: 2026-04-07
-- 
-- Fixes:
-- 1. consumer_collect_points: also set points_value on qr_codes table
-- 2. fn_consumer_activity_stats: fallback to consumer_qr_scans for points
-- 3. v_shop_points_summary: ensure state shows state_name not UUID
-- ============================================================================

-- ============================================================================
-- FIX 1: Update consumer_collect_points to persist points_value on qr_codes
-- ============================================================================
CREATE OR REPLACE FUNCTION public.consumer_collect_points(
  p_raw_qr_code text,
  p_shop_id text,
  p_points_amount numeric DEFAULT NULL::numeric
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $_$
DECLARE
  v_qr_record RECORD;
  v_base_code TEXT;
  v_valid_statuses TEXT[] := ARRAY['received_warehouse', 'warehouse_packed', 'shipped_distributor', 'activated', 'verified'];
  v_points NUMERIC;
  v_shop_org_id UUID;
  v_user_full_name TEXT;
  v_user_phone TEXT;
  v_user_email TEXT;
BEGIN
  -- 1. Resolve QR Code and Lock Row
  SELECT * INTO v_qr_record
  FROM qr_codes
  WHERE code = p_raw_qr_code
  FOR UPDATE;

  IF v_qr_record IS NULL THEN
    v_base_code := regexp_replace(p_raw_qr_code, '-[^-]+$', '');
    IF v_base_code != p_raw_qr_code THEN
        SELECT * INTO v_qr_record
        FROM qr_codes
        WHERE code = v_base_code
        FOR UPDATE;
    END IF;
  END IF;

  IF v_qr_record IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'QR code not found', 'code', 'QR_NOT_FOUND', 'preview', true);
  END IF;

  -- 2. Validate Status
  IF NOT (v_qr_record.status = ANY(v_valid_statuses)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'QR code is not active', 'code', 'INVALID_STATUS');
  END IF;

  -- 3. Check if already collected
  IF v_qr_record.is_points_collected THEN
    RETURN jsonb_build_object(
      'success', false, 
      'already_collected', true, 
      'error', 'Points for this QR code have already been collected.',
      'points_earned', v_qr_record.points_value
    );
  END IF;

  -- 4. Determine Points Value
  v_points := COALESCE(p_points_amount, v_qr_record.points_value, 0);

  -- 5. Get user details for consumer info
  SELECT organization_id, full_name, phone, email 
  INTO v_shop_org_id, v_user_full_name, v_user_phone, v_user_email 
  FROM users 
  WHERE id = p_shop_id::uuid;

  -- 6. Update QR Code Flags, points_value, and consumer info
  IF v_shop_org_id IS NULL AND v_qr_record.consumer_name IS NULL THEN
    UPDATE qr_codes
    SET is_points_collected = TRUE,
        points_collected_at = NOW(),
        points_value = v_points,
        consumer_name = COALESCE(v_user_full_name, v_qr_record.consumer_name),
        consumer_phone = COALESCE(v_user_phone, v_qr_record.consumer_phone),
        consumer_email = COALESCE(v_user_email, v_qr_record.consumer_email)
    WHERE id = v_qr_record.id;
  ELSE
    UPDATE qr_codes
    SET is_points_collected = TRUE,
        points_collected_at = NOW(),
        points_value = v_points
    WHERE id = v_qr_record.id;
  END IF;

  -- 7. Record Transaction / Scan
  INSERT INTO consumer_qr_scans (
    qr_code_id,
    shop_id,
    consumer_id,
    collected_points,
    points_amount,
    points_collected_at,
    scanned_at,
    adjustment_type
  ) VALUES (
    v_qr_record.id,
    v_shop_org_id,
    p_shop_id::uuid,
    TRUE,
    v_points,
    NOW(),
    NOW(),
    'scan'
  );

  RETURN jsonb_build_object(
    'success', true,
    'points_earned', v_points,
    'message', 'Points collected successfully'
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'code', 'INTERNAL_ERROR');
END;
$_$;

COMMENT ON FUNCTION public.consumer_collect_points(text, text, numeric)
  IS 'Collects points for a QR code. Now also persists points_value on qr_codes for accurate stats.';

-- ============================================================================
-- FIX 2: Update fn_consumer_activity_stats to use consumer_qr_scans fallback
-- This ensures historical data (where points_value was not set) still shows
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_consumer_activity_stats(
  p_company_id uuid,
  p_order_id uuid DEFAULT NULL::uuid,
  p_activity_type text DEFAULT NULL::text
) RETURNS TABLE(total_scans bigint, unique_consumers bigint, total_points bigint, today_scans bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date;
BEGIN
  RETURN QUERY
  SELECT
    count(*)::bigint AS total_scans,
    count(DISTINCT q.consumer_phone)::bigint AS unique_consumers,
    coalesce(sum(
      CASE WHEN q.is_points_collected THEN
        COALESCE(
          q.points_value,
          (SELECT cqs.points_amount FROM consumer_qr_scans cqs WHERE cqs.qr_code_id = q.id AND cqs.collected_points = true ORDER BY cqs.scanned_at DESC LIMIT 1),
          0
        )
      ELSE 0 END
    ), 0)::bigint AS total_points,
    count(*) FILTER (WHERE (
      COALESCE(q.first_consumer_scan_at, q.points_collected_at, q.redeemed_at, q.lucky_draw_entered_at, q.activated_at)
      AT TIME ZONE 'Asia/Kuala_Lumpur'
    )::date = v_today)::bigint AS today_scans
  FROM qr_codes q
  WHERE q.company_id = p_company_id
    AND (q.is_redeemed = true OR q.is_lucky_draw_entered = true OR q.is_points_collected = true)
    AND (p_order_id IS NULL OR q.order_id = p_order_id)
    AND (
      p_activity_type IS NULL
      OR p_activity_type = 'all'
      OR (p_activity_type = 'lucky_draw'  AND q.is_lucky_draw_entered = true)
      OR (p_activity_type = 'points'      AND q.is_points_collected = true)
      OR (p_activity_type = 'gift'        AND q.is_redeemed = true)
    );
END;
$$;

-- ============================================================================
-- FIX 3: Also backfill points_value on existing qr_codes from consumer_qr_scans
-- for historical data where points were collected but points_value was not set
-- ============================================================================
UPDATE qr_codes q
SET points_value = cqs.points_amount
FROM (
  SELECT DISTINCT ON (qr_code_id) qr_code_id, points_amount
  FROM consumer_qr_scans
  WHERE collected_points = true AND points_amount > 0
  ORDER BY qr_code_id, scanned_at DESC
) cqs
WHERE q.id = cqs.qr_code_id
  AND q.is_points_collected = true
  AND (q.points_value IS NULL OR q.points_value = 0);

-- ============================================================================
-- FIX 4: Recreate v_shop_points_summary view to ensure state shows state_name
-- ============================================================================
DROP VIEW IF EXISTS public.v_shop_points_summary CASCADE;

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
  COALESCE(s.state_name, '') AS state,
  COUNT(cb.user_id) AS total_consumers,
  COALESCE(SUM(cb.current_balance), 0) AS total_points_balance,
  COALESCE(SUM(cb.total_collected_system), 0) AS total_collected_system,
  COALESCE(SUM(cb.total_collected_manual), 0) AS total_collected_manual,
  COALESCE(SUM(cb.total_migration), 0) AS total_migration_points,
  COALESCE(SUM(cb.total_redeemed), 0) AS total_redeemed,
  COALESCE(SUM(cb.transaction_count), 0) AS total_transactions,
  MAX(cb.last_transaction_date) AS last_activity
FROM organizations o
LEFT JOIN states s ON o.state_id = s.id
LEFT JOIN users u ON u.organization_id = o.id
  AND u.role_code IN ('CONSUMER', 'GUEST')
  AND u.is_active = true
LEFT JOIN consumer_balances cb ON cb.user_id = u.id
WHERE o.org_type_code = 'SHOP'
GROUP BY o.id, o.org_name, o.branch, o.contact_name, o.contact_phone, s.state_name
ORDER BY total_points_balance DESC;

GRANT SELECT ON v_shop_points_summary TO authenticated;
GRANT SELECT ON v_shop_points_summary TO anon;
