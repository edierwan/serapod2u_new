-- ============================================================
-- Phase 1: Additive schema — Dual-Claim QR Model + Point Taxonomy
-- ZERO DOWNTIME: Only adds columns, backfills, and updates functions
-- Does NOT change unique indexes or break existing behavior
-- ============================================================

BEGIN;

-- ============================================================
-- 1. consumer_qr_scans: Add claim_lane column
-- ============================================================
ALTER TABLE public.consumer_qr_scans
  ADD COLUMN IF NOT EXISTS claim_lane text DEFAULT 'consumer';

COMMENT ON COLUMN public.consumer_qr_scans.claim_lane IS
  'Which claim lane: consumer (self-scan) or shop (staff-scan). Phase 2 will enforce uniqueness per lane.';

-- Backfill existing rows (all current collects are consumer-lane)
UPDATE public.consumer_qr_scans
SET claim_lane = 'consumer'
WHERE claim_lane IS NULL;


-- ============================================================
-- 2. qr_codes: Add per-lane collection flags
-- ============================================================
ALTER TABLE public.qr_codes
  ADD COLUMN IF NOT EXISTS is_shop_points_collected boolean DEFAULT false;

ALTER TABLE public.qr_codes
  ADD COLUMN IF NOT EXISTS is_consumer_points_collected boolean DEFAULT false;

COMMENT ON COLUMN public.qr_codes.is_shop_points_collected IS
  'Whether shop staff has collected points for this QR. Phase 2 will replace is_points_collected.';
COMMENT ON COLUMN public.qr_codes.is_consumer_points_collected IS
  'Whether consumer has self-collected points for this QR. Phase 2 will replace is_points_collected.';

-- Backfill: existing collected QRs were all consumer claims
UPDATE public.qr_codes
SET is_consumer_points_collected = true
WHERE is_points_collected = true
  AND is_consumer_points_collected = false;

-- Partial indexes for fast lookup of uncollected per lane
CREATE INDEX IF NOT EXISTS idx_qr_codes_shop_not_collected
  ON public.qr_codes (id) WHERE is_shop_points_collected = false;
CREATE INDEX IF NOT EXISTS idx_qr_codes_consumer_not_collected
  ON public.qr_codes (id) WHERE is_consumer_points_collected = false;


-- ============================================================
-- 3. points_transactions: Add taxonomy columns
-- ============================================================
ALTER TABLE public.points_transactions
  ADD COLUMN IF NOT EXISTS point_category text;

ALTER TABLE public.points_transactions
  ADD COLUMN IF NOT EXISTS point_indicator text;

ALTER TABLE public.points_transactions
  ADD COLUMN IF NOT EXISTS point_owner_type text;

ALTER TABLE public.points_transactions
  ADD COLUMN IF NOT EXISTS point_direction text;

COMMENT ON COLUMN public.points_transactions.point_category IS
  'Business event type: scan, roadtour, survey, registration, game, referral, migration, adjustment, redemption, expiry';
COMMENT ON COLUMN public.points_transactions.point_indicator IS
  'Sub-classification within category, e.g. scratch_card, booth_scan, csv_import';
COMMENT ON COLUMN public.points_transactions.point_owner_type IS
  'Who owns the points: consumer, shop, hq';
COMMENT ON COLUMN public.points_transactions.point_direction IS
  'earn or spend';

-- Backfill taxonomy from existing transaction_type
UPDATE public.points_transactions
SET
  point_category = CASE transaction_type
    WHEN 'earn'             THEN 'bonus'
    WHEN 'redeem'           THEN 'redemption'
    WHEN 'expire'           THEN 'expiry'
    WHEN 'adjust'           THEN 'adjustment'
    WHEN 'game_win'         THEN 'game'
    WHEN 'MIGRATION'        THEN 'migration'
    WHEN 'registration'     THEN 'registration'
    WHEN 'roadtour'         THEN 'roadtour'
    WHEN 'roadtour_survey'  THEN 'survey'
    ELSE 'unknown'
  END,
  point_direction = CASE
    WHEN points_amount < 0 THEN 'spend'
    ELSE 'earn'
  END,
  point_owner_type = 'consumer'
WHERE point_category IS NULL;


-- ============================================================
-- 4. Update consumer_collect_points — dual-write new lane flags
--    Keeps is_points_collected = TRUE (backward compat)
--    Also sets is_consumer_points_collected = TRUE
--    claim_lane gets DEFAULT 'consumer' from column definition
-- ============================================================
CREATE OR REPLACE FUNCTION public.consumer_collect_points(
  p_raw_qr_code text,
  p_shop_id text,
  p_points_amount numeric DEFAULT NULL::numeric
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

  -- 6. Update QR Code Flags — dual-write: old flag + new lane flag
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

  -- 7. Record Transaction / Scan — claim_lane defaults to 'consumer'
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
    'consumer'
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


-- ============================================================
-- 5. Update record_roadtour_reward — dual-write taxonomy columns
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_roadtour_reward(
  p_org_id uuid,
  p_campaign_id uuid,
  p_qr_code_id uuid,
  p_account_manager_user_id uuid,
  p_scanned_by_user_id uuid,
  p_shop_id uuid,
  p_points integer,
  p_scan_event_id uuid DEFAULT NULL::uuid,
  p_survey_response_id uuid DEFAULT NULL::uuid,
  p_duplicate_rule text DEFAULT 'one_per_user_per_campaign'::text,
  p_transaction_type text DEFAULT 'roadtour'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_existing_count integer;
  v_balance integer := 0;
  v_txn_id uuid;
  v_phone text;
  v_email text;
  v_description text;
BEGIN
  -- Check duplicate based on rule
  IF p_duplicate_rule = 'one_per_user_per_campaign' THEN
    SELECT COUNT(*) INTO v_existing_count
    FROM public.roadtour_scan_events
    WHERE campaign_id = p_campaign_id
      AND scanned_by_user_id = p_scanned_by_user_id
      AND scan_status = 'success'
      AND points_awarded > 0;
  ELSIF p_duplicate_rule = 'one_per_user_per_day' THEN
    SELECT COUNT(*) INTO v_existing_count
    FROM public.roadtour_scan_events
    WHERE campaign_id = p_campaign_id
      AND scanned_by_user_id = p_scanned_by_user_id
      AND scan_status = 'success'
      AND points_awarded > 0
      AND scan_time::date = CURRENT_DATE;
  ELSIF p_duplicate_rule = 'one_per_shop_per_am_per_day' THEN
    SELECT COUNT(*) INTO v_existing_count
    FROM public.roadtour_scan_events
    WHERE campaign_id = p_campaign_id
      AND account_manager_user_id = p_account_manager_user_id
      AND shop_id = p_shop_id
      AND scan_status = 'success'
      AND points_awarded > 0
      AND scan_time::date = CURRENT_DATE;
  ELSE
    v_existing_count := 0;
  END IF;

  IF v_existing_count > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'duplicate', 'message', 'Reward already claimed based on the duplicate prevention rule.');
  END IF;

  -- Get current balance
  SELECT COALESCE(v.current_balance, 0) INTO v_balance
  FROM public.v_consumer_points_balance v
  WHERE v.user_id = p_scanned_by_user_id;

  -- Get phone/email
  SELECT u.phone, u.email INTO v_phone, v_email
  FROM public.users u WHERE u.id = p_scanned_by_user_id;

  v_description := format('RoadTour bonus — campaign scan reward (%s points)', p_points);

  -- Insert points transaction — now with taxonomy columns
  INSERT INTO public.points_transactions (
    company_id, consumer_phone, consumer_email,
    transaction_type, points_amount, balance_after,
    description, transaction_date, user_id, created_by,
    point_category, point_indicator, point_owner_type, point_direction
  ) VALUES (
    p_org_id, COALESCE(v_phone, ''), v_email,
    p_transaction_type, p_points, v_balance + p_points,
    v_description, now(), p_scanned_by_user_id, p_scanned_by_user_id,
    CASE WHEN p_transaction_type = 'roadtour_survey' THEN 'survey' ELSE 'roadtour' END,
    CASE WHEN p_transaction_type = 'roadtour_survey' THEN 'survey_completion' ELSE 'booth_scan' END,
    'consumer',
    'earn'
  )
  RETURNING id INTO v_txn_id;

  -- Update scan event with reward
  IF p_scan_event_id IS NOT NULL THEN
    UPDATE public.roadtour_scan_events
    SET points_awarded = p_points, scan_status = 'success', reward_transaction_id = v_txn_id
    WHERE id = p_scan_event_id;
  END IF;

  -- Update survey response with reward
  IF p_survey_response_id IS NOT NULL THEN
    UPDATE public.roadtour_survey_responses
    SET points_awarded = p_points, reward_transaction_id = v_txn_id
    WHERE id = p_survey_response_id;
  END IF;

  -- Try to create official visit (ignore if duplicate constraint fires)
  BEGIN
    INSERT INTO public.roadtour_official_visits (
      campaign_id, account_manager_user_id, shop_id,
      official_scan_event_id, official_survey_response_id, visit_date
    ) VALUES (
      p_campaign_id, p_account_manager_user_id, p_shop_id,
      p_scan_event_id, p_survey_response_id, CURRENT_DATE
    );
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_txn_id,
    'points_awarded', p_points,
    'balance_after', v_balance + p_points,
    'message', 'RoadTour reward credited successfully.'
  );
END;
$function$;

COMMIT;
