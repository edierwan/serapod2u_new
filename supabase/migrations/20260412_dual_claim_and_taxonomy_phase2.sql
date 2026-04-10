-- ============================================================
-- Phase 2: Dual-Claim index swap + View taxonomy enrichment
-- REQUIRES Phase 1 (20260412_dual_claim_and_taxonomy_phase1.sql)
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Swap unique index to lane-aware (THE critical change)
--    Old: one collected_points=true row per qr_code_id
--    New: one collected_points=true row per (qr_code_id, claim_lane)
-- ============================================================
DROP INDEX IF EXISTS public.uq_consumer_qr_scans_qr_collected_once;

CREATE UNIQUE INDEX uq_consumer_qr_scans_lane
  ON public.consumer_qr_scans (qr_code_id, claim_lane)
  WHERE (collected_points = true);

-- Make claim_lane NOT NULL now that everything is backfilled
ALTER TABLE public.consumer_qr_scans
  ALTER COLUMN claim_lane SET NOT NULL;


-- ============================================================
-- 2. Recreate shop_points_ledger with claim_lane + taxonomy
-- ============================================================
CREATE OR REPLACE VIEW public.shop_points_ledger AS
-- Half 1: scan-based (from consumer_qr_scans)
SELECT
  cqs.id,
  cqs.shop_id,
  cqs.consumer_id,
  cqs.journey_config_id,
  qc.order_id,
  qc.order_item_id,
  qc.product_id,
  qc.variant_id,
  cqs.points_collected_at AS occurred_at,
  COALESCE(cqs.points_amount, 0) AS points_change,
  CASE
    WHEN cqs.is_manual_adjustment THEN COALESCE(cqs.adjustment_type, 'manual')
    ELSE 'scan'
  END AS transaction_type,
  cqs.is_manual_adjustment,
  cqs.adjusted_by,
  cqs.adjustment_reason,
  NULL::uuid AS redeem_item_id,
  NULL::text AS consumer_phone,
  NULL::text AS consumer_email,
  NULL::text AS description,
  pv.variant_name,
  p.product_name,
  NULL::text AS reward_name,
  NULL::text AS reward_code,
  o.order_no,
  -- New columns (Phase 2)
  cqs.claim_lane,
  'scan'::text AS point_category,
  CASE
    WHEN cqs.is_manual_adjustment THEN 'manual_add'
    ELSE 'product_qr'
  END AS point_indicator,
  'consumer'::text AS point_owner_type,
  'earn'::text AS point_direction
FROM consumer_qr_scans cqs
  LEFT JOIN qr_codes qc ON qc.id = cqs.qr_code_id
  LEFT JOIN product_variants pv ON pv.id = qc.variant_id
  LEFT JOIN products p ON p.id = pv.product_id
  LEFT JOIN orders o ON o.id = qc.order_id
WHERE cqs.collected_points = true

UNION ALL

-- Half 2: transaction-based (from points_transactions)
SELECT
  pt.id,
  COALESCE(pt.company_id, (
    SELECT u.organization_id
    FROM users u
      JOIN organizations org ON org.id = u.organization_id
    WHERE (u.phone = pt.consumer_phone OR u.email = pt.consumer_email)
      AND (org.org_type_code = ANY (ARRAY['SHOP', 'INDEP']))
    LIMIT 1
  )) AS shop_id,
  pt.user_id AS consumer_id,
  NULL::uuid AS journey_config_id,
  NULL::uuid AS order_id,
  NULL::uuid AS order_item_id,
  NULL::uuid AS product_id,
  NULL::uuid AS variant_id,
  pt.transaction_date AS occurred_at,
  pt.points_amount AS points_change,
  pt.transaction_type,
  CASE WHEN pt.transaction_type = 'adjust' THEN true ELSE false END AS is_manual_adjustment,
  NULL::uuid AS adjusted_by,
  NULL::text AS adjustment_reason,
  pt.redeem_item_id,
  pt.consumer_phone,
  pt.consumer_email,
  pt.description,
  NULL::text AS variant_name,
  NULL::text AS product_name,
  ri.item_name AS reward_name,
  ri.item_code AS reward_code,
  NULL::text AS order_no,
  -- New columns (Phase 2)
  NULL::text AS claim_lane,
  pt.point_category,
  pt.point_indicator,
  pt.point_owner_type,
  pt.point_direction
FROM points_transactions pt
  LEFT JOIN redeem_items ri ON ri.id = pt.redeem_item_id
WHERE pt.consumer_phone IS NOT NULL
   OR pt.consumer_email IS NOT NULL
   OR pt.company_id IS NOT NULL;


-- ============================================================
-- 3. Recreate v_shop_points_balance — use taxonomy for aggregation
-- ============================================================
CREATE OR REPLACE VIEW public.v_shop_points_balance AS
SELECT
  shop_id,
  sum(points_change) AS current_balance,
  count(*) AS transaction_count,
  min(occurred_at) AS first_transaction_at,
  max(occurred_at) AS last_transaction_at,
  sum(CASE WHEN transaction_type = 'scan' THEN points_change ELSE 0 END) AS total_earned_scans,
  sum(CASE WHEN transaction_type = ANY(ARRAY['manual', 'adjust']) THEN points_change ELSE 0 END) AS total_manual_adjustments,
  sum(CASE WHEN transaction_type = 'redeem' THEN abs(points_change) ELSE 0 END) AS total_redeemed,
  count(CASE WHEN transaction_type = 'scan' THEN 1 ELSE NULL END) AS scan_count,
  count(CASE WHEN transaction_type = 'redeem' THEN 1 ELSE NULL END) AS redemption_count
FROM shop_points_ledger
WHERE shop_id IS NOT NULL
GROUP BY shop_id;


-- ============================================================
-- 4. Recreate v_consumer_points_balance (same logic, no changes needed)
--    The view reads from consumer_qr_scans and points_transactions directly
--    claim_lane and taxonomy columns don't affect it
--    Keeping as-is since it already works correctly
-- ============================================================
-- No change needed — v_consumer_points_balance does not reference
-- transaction_type in any way that conflicts with the new columns.
-- It reads from consumer_qr_scans (collected_points=true) and
-- points_transactions (by transaction_type CASE), both still correct.


-- ============================================================
-- 5. v_shop_points_summary depends on v_consumer_points_balance
--    No changes needed — it wraps v_consumer_points_balance
-- ============================================================
-- No change needed.


-- ============================================================
-- 6. Update consumer_collect_points with full lane awareness
--    Now accepts p_claim_lane parameter for Phase 2
-- ============================================================
CREATE OR REPLACE FUNCTION public.consumer_collect_points(
  p_raw_qr_code text,
  p_shop_id text,
  p_points_amount numeric DEFAULT NULL::numeric,
  p_claim_lane text DEFAULT 'consumer'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_qr_record RECORD;
  v_base_code TEXT;
  v_valid_statuses TEXT[] := ARRAY['received_warehouse', 'warehouse_packed', 'shipped_distributor', 'activated', 'verified'];
  v_points NUMERIC;
  v_shop_org_id UUID;
  v_user_full_name TEXT;
  v_user_phone TEXT;
  v_user_email TEXT;
  v_lane_collected BOOLEAN;
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

  -- 3. Check if already collected FOR THIS LANE
  IF p_claim_lane = 'shop' THEN
    v_lane_collected := v_qr_record.is_shop_points_collected;
  ELSE
    v_lane_collected := v_qr_record.is_consumer_points_collected;
  END IF;

  IF v_lane_collected THEN
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

  -- 6. Update QR Code Flags — set both old flag + lane-specific flag
  IF p_claim_lane = 'shop' THEN
    UPDATE qr_codes
    SET is_points_collected = TRUE,
        is_shop_points_collected = TRUE,
        points_collected_at = NOW(),
        points_value = v_points
    WHERE id = v_qr_record.id;
  ELSE
    IF v_shop_org_id IS NULL AND v_qr_record.consumer_name IS NULL THEN
      UPDATE qr_codes
      SET is_points_collected = TRUE,
          is_consumer_points_collected = TRUE,
          points_collected_at = NOW(),
          points_value = v_points,
          consumer_name = COALESCE(v_user_full_name, v_qr_record.consumer_name),
          consumer_phone = COALESCE(v_user_phone, v_qr_record.consumer_phone),
          consumer_email = COALESCE(v_user_email, v_qr_record.consumer_email)
      WHERE id = v_qr_record.id;
    ELSE
      UPDATE qr_codes
      SET is_points_collected = TRUE,
          is_consumer_points_collected = TRUE,
          points_collected_at = NOW(),
          points_value = v_points
      WHERE id = v_qr_record.id;
    END IF;
  END IF;

  -- 7. Record Transaction / Scan — with claim_lane
  INSERT INTO consumer_qr_scans (
    qr_code_id,
    shop_id,
    consumer_id,
    collected_points,
    points_amount,
    points_collected_at,
    scanned_at,
    adjustment_type,
    claim_lane
  ) VALUES (
    v_qr_record.id,
    v_shop_org_id,
    p_shop_id::uuid,
    TRUE,
    v_points,
    NOW(),
    NOW(),
    'scan',
    p_claim_lane
  );

  RETURN jsonb_build_object(
    'success', true,
    'points_earned', v_points,
    'message', 'Points collected successfully'
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'code', 'INTERNAL_ERROR');
END;
$function$;


COMMIT;
