BEGIN;

CREATE OR REPLACE FUNCTION public.consumer_collect_points(
  p_raw_qr_code text,
  p_shop_id text,
  p_points_amount numeric DEFAULT NULL::numeric,
  p_claim_lane text DEFAULT 'consumer'::text,
  p_allow_dual_claim boolean DEFAULT true
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

  IF NOT (v_qr_record.status = ANY(v_valid_statuses)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'QR code is not active', 'code', 'INVALID_STATUS');
  END IF;

  IF NOT p_allow_dual_claim THEN
    IF COALESCE(v_qr_record.is_shop_points_collected, false)
      OR COALESCE(v_qr_record.is_consumer_points_collected, false)
      OR COALESCE(v_qr_record.is_points_collected, false) THEN
      RETURN jsonb_build_object(
        'success', false,
        'already_collected', true,
        'error', 'Points for this QR code have already been collected.',
        'points_earned', v_qr_record.points_value
      );
    END IF;
  ELSE
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
  END IF;

  v_points := COALESCE(p_points_amount, v_qr_record.points_value, 0);

  SELECT organization_id, full_name, phone, email
  INTO v_shop_org_id, v_user_full_name, v_user_phone, v_user_email
  FROM users
  WHERE id = p_shop_id::uuid;

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
