-- Migration: 043_update_consumer_claim_gift_rpc.sql
-- Description: Update consumer_claim_gift to store redeem_gift_id in qr_codes

CREATE OR REPLACE FUNCTION consumer_claim_gift(
  p_raw_qr_code TEXT,
  p_gift_id UUID,
  p_consumer_name TEXT DEFAULT NULL,
  p_consumer_phone TEXT DEFAULT NULL,
  p_consumer_email TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_qr_record RECORD;
  v_base_code TEXT;
  v_gift RECORD;
  v_redemption_code TEXT;
  v_valid_statuses TEXT[] := ARRAY['received_warehouse', 'warehouse_packed', 'shipped_distributor', 'activated', 'verified'];
  v_scan_id UUID;
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
    RETURN jsonb_build_object('success', false, 'error', 'QR code not found', 'code', 'QR_NOT_FOUND');
  END IF;

  -- 2. Validate Status
  IF NOT (v_qr_record.status = ANY(v_valid_statuses)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'QR code is not active', 'code', 'INVALID_STATUS');
  END IF;

  -- 3. Check if already redeemed
  IF v_qr_record.is_redeemed THEN
    RETURN jsonb_build_object('success', false, 'error', 'This QR code has already been used to redeem a gift', 'code', 'ALREADY_REDEEMED');
  END IF;

  -- 4. Check Gift Validity and Quantity
  SELECT * INTO v_gift
  FROM redeem_gifts
  WHERE id = p_gift_id AND is_active = TRUE
  FOR UPDATE;

  IF v_gift IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Gift not found or inactive', 'code', 'GIFT_NOT_FOUND');
  END IF;

  IF v_gift.total_quantity > 0 AND v_gift.claimed_quantity >= v_gift.total_quantity THEN
    RETURN jsonb_build_object('success', false, 'error', 'This gift has been fully claimed', 'code', 'GIFT_FULLY_CLAIMED');
  END IF;

  -- 5. Update Gift Quantity
  UPDATE redeem_gifts
  SET claimed_quantity = claimed_quantity + 1,
      updated_at = NOW()
  WHERE id = v_gift.id;

  -- 6. Update QR Code Flags AND Consumer Details AND Gift ID
  UPDATE qr_codes
  SET is_redeemed = TRUE,
      redeemed_at = NOW(),
      redeem_gift_id = v_gift.id,
      consumer_name = COALESCE(p_consumer_name, consumer_name),
      consumer_phone = COALESCE(p_consumer_phone, consumer_phone),
      consumer_email = COALESCE(p_consumer_email, consumer_email)
  WHERE id = v_qr_record.id;

  -- 7. Generate Redemption Code
  v_redemption_code := 'GFT-' || upper(substring(md5(random()::text) from 1 for 6));

  -- 8. Record Scan / Redemption (Legacy support for consumer_qr_scans table if used)
  -- We try to update or insert into consumer_qr_scans for backward compatibility or analytics
  SELECT id INTO v_scan_id
  FROM consumer_qr_scans
  WHERE qr_code_id = v_qr_record.id AND consumer_phone = p_consumer_phone
  LIMIT 1;

  IF v_scan_id IS NOT NULL THEN
    UPDATE consumer_qr_scans
    SET redeemed_gift = TRUE, updated_at = NOW()
    WHERE id = v_scan_id;
  ELSE
    -- Only insert if we have a phone number, as it's often required for this table
    IF p_consumer_phone IS NOT NULL THEN
        INSERT INTO consumer_qr_scans (
        qr_code_id,
        consumer_phone,
        redeemed_gift,
        scanned_at
        ) VALUES (
        v_qr_record.id,
        p_consumer_phone,
        TRUE,
        NOW()
        );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'redemption_code', v_redemption_code,
    'gift_name', v_gift.gift_name
  );
END;
$$;
