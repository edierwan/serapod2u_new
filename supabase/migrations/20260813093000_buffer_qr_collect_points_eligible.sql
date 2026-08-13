-- Allow buffer spare/replacement QR codes to award Collect Points.
-- Product decision (2026-08): simplify field scanning — buffer stickers are valid.
-- Normal (non-buffer) product QRs still require warehouse/shipped lifecycle statuses.

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
AS $$
DECLARE
  v_qr_record RECORD;
  v_base_code text;
  v_valid_statuses text[] := ARRAY[
    'received_warehouse',
    'warehouse_packed',
    'shipped_distributor',
    'activated',
    'verified'
  ];
  v_buffer_statuses text[] := ARRAY[
    'buffer_available',
    'buffer_used',
    'available',
    'created',
    'generated',
    'printed',
    'packed'
  ];
  v_blocked_statuses text[] := ARRAY[
    'spoiled',
    'revoked',
    'cancelled',
    'destroyed',
    'void',
    'invalid'
  ];
  v_points numeric;
  v_shop_org_id uuid;
  v_user_full_name text;
  v_user_phone text;
  v_user_email text;
  v_lane_collected boolean;
  v_scan_id uuid;
  v_scanned_at timestamptz := now();
  v_status_ok boolean := false;
BEGIN
  SELECT * INTO v_qr_record
  FROM public.qr_codes
  WHERE code = p_raw_qr_code
  FOR UPDATE;

  IF v_qr_record IS NULL THEN
    v_base_code := regexp_replace(p_raw_qr_code, '-[^-]+$', '');
    IF v_base_code != p_raw_qr_code THEN
      SELECT * INTO v_qr_record
      FROM public.qr_codes
      WHERE code = v_base_code
      FOR UPDATE;
    END IF;
  END IF;

  IF v_qr_record IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'QR code not found', 'code', 'QR_NOT_FOUND', 'preview', true);
  END IF;

  IF v_qr_record.status = ANY (v_blocked_statuses) THEN
    RETURN jsonb_build_object('success', false, 'error', 'This QR code is no longer valid and cannot be used to collect points.', 'code', 'INVALID_STATUS');
  END IF;

  IF v_qr_record.status = ANY (v_valid_statuses) THEN
    v_status_ok := true;
  ELSIF COALESCE(v_qr_record.is_buffer, false) = true
        AND v_qr_record.status = ANY (v_buffer_statuses) THEN
    -- Manager decision: buffer stickers award points without warehouse activation.
    v_status_ok := true;
  ELSIF v_qr_record.status = ANY (ARRAY['redeemed', 'scanned']) THEN
    -- Keep API/RPC parity for already-scanned codes that still need points collection.
    v_status_ok := true;
  END IF;

  IF NOT v_status_ok THEN
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
      v_lane_collected := COALESCE(v_qr_record.is_shop_points_collected, false);
    ELSE
      v_lane_collected := COALESCE(v_qr_record.is_consumer_points_collected, false);
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
  FROM public.users
  WHERE id = p_shop_id::uuid;

  IF p_claim_lane = 'shop' THEN
    UPDATE public.qr_codes
    SET is_points_collected = true,
        is_shop_points_collected = true,
        points_collected_at = v_scanned_at,
        points_value = v_points
    WHERE id = v_qr_record.id;
  ELSE
    IF v_shop_org_id IS NULL AND v_qr_record.consumer_name IS NULL THEN
      UPDATE public.qr_codes
      SET is_points_collected = true,
          is_consumer_points_collected = true,
          points_collected_at = v_scanned_at,
          points_value = v_points,
          consumer_name = COALESCE(v_user_full_name, v_qr_record.consumer_name),
          consumer_phone = COALESCE(v_user_phone, v_qr_record.consumer_phone),
          consumer_email = COALESCE(v_user_email, v_qr_record.consumer_email)
      WHERE id = v_qr_record.id;
    ELSE
      UPDATE public.qr_codes
      SET is_points_collected = true,
          is_consumer_points_collected = true,
          points_collected_at = v_scanned_at,
          points_value = v_points
      WHERE id = v_qr_record.id;
    END IF;
  END IF;

  INSERT INTO public.consumer_qr_scans (
    qr_code_id,
    shop_id,
    consumer_id,
    collected_points,
    points_amount,
    points_collected_at,
    scanned_at,
    adjustment_type,
    claim_lane,
    consumer_name,
    consumer_phone,
    consumer_email
  ) VALUES (
    v_qr_record.id,
    v_shop_org_id,
    p_shop_id::uuid,
    true,
    v_points,
    v_scanned_at,
    v_scanned_at,
    'scan',
    p_claim_lane,
    v_user_full_name,
    v_user_phone,
    v_user_email
  )
  RETURNING id INTO v_scan_id;

  RETURN jsonb_build_object(
    'success', true,
    'points_earned', v_points,
    'message', 'Points collected successfully',
    'scan_id', v_scan_id,
    'qr_code_id', v_qr_record.id,
    'scanned_at', v_scanned_at
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'code', 'INTERNAL_ERROR');
END;
$$;

CREATE OR REPLACE FUNCTION public.consumer_collect_points(
  p_raw_qr_code text,
  p_shop_id text,
  p_points_amount numeric DEFAULT NULL::numeric,
  p_claim_lane text DEFAULT 'consumer'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN public.consumer_collect_points(p_raw_qr_code, p_shop_id, p_points_amount, p_claim_lane, true);
END;
$$;
