-- Migration: 040_fix_collect_points_constraint.sql
-- Description: Fix consumer_collect_points to satisfy check constraint on consumer_qr_scans

CREATE OR REPLACE FUNCTION consumer_collect_points(
  p_raw_qr_code TEXT,
  p_shop_id TEXT, -- This is the user ID (UUID) of the shop owner
  p_points_amount NUMERIC DEFAULT NULL -- Optional override, otherwise use QR value
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_qr_record RECORD;
  v_base_code TEXT;
  v_valid_statuses TEXT[] := ARRAY['received_warehouse', 'warehouse_packed', 'shipped_distributor', 'activated', 'verified'];
  v_points NUMERIC;
  v_shop_org_id UUID;
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

  -- 5. Update QR Code Flags
  UPDATE qr_codes
  SET is_points_collected = TRUE,
      points_collected_at = NOW()
  WHERE id = v_qr_record.id;

  -- 6. Record Transaction / Scan
  -- Get the shop's organization ID from the user ID
  SELECT organization_id INTO v_shop_org_id FROM users WHERE id = p_shop_id::uuid;

  INSERT INTO consumer_qr_scans (
    qr_code_id,
    shop_id,
    collected_points,
    points_amount,
    points_collected_at,
    scanned_at,
    adjustment_type -- FIX: Added adjustment_type to satisfy constraint
  ) VALUES (
    v_qr_record.id,
    v_shop_org_id,
    TRUE,
    v_points,
    NOW(),
    NOW(),
    'scan' -- FIX: Set adjustment_type
  );

  RETURN jsonb_build_object(
    'success', true,
    'points_earned', v_points,
    'message', 'Points collected successfully'
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'code', 'INTERNAL_ERROR');
END;
$$;
