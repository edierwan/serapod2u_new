-- Migration: 037_update_consumer_rpc_functions.sql
-- Description: Update RPC functions to store consumer details in qr_codes table

-- 1. Update consumer_lucky_draw_enter to save consumer details to qr_codes
CREATE OR REPLACE FUNCTION consumer_lucky_draw_enter(
  p_raw_qr_code TEXT,
  p_consumer_name TEXT,
  p_consumer_phone TEXT,
  p_consumer_email TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_qr_record RECORD;
  v_base_code TEXT;
  v_order_id UUID;
  v_company_id UUID;
  v_campaign RECORD;
  v_existing_entry RECORD;
  v_entry_number TEXT;
  v_new_entry_id UUID;
  v_entry_date TIMESTAMPTZ;
  v_valid_statuses TEXT[] := ARRAY['received_warehouse', 'warehouse_packed', 'shipped_distributor', 'activated', 'verified'];
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

  -- 3. Check if already entered
  IF v_qr_record.is_lucky_draw_entered THEN
    SELECT * INTO v_existing_entry FROM lucky_draw_entries WHERE qr_code_id = v_qr_record.id LIMIT 1;
    SELECT campaign_name INTO v_campaign FROM lucky_draw_campaigns WHERE id = v_existing_entry.campaign_id;
    
    RETURN jsonb_build_object(
      'success', true,
      'already_entered', true,
      'message', 'This QR code has already been used to enter this lucky draw',
      'entry', jsonb_build_object(
        'entry_number', v_existing_entry.entry_number,
        'campaign_name', v_campaign.campaign_name,
        'consumer_name', v_existing_entry.consumer_name,
        'entry_date', v_existing_entry.entry_date
      )
    );
  END IF;

  -- 4. Find Active Campaign
  SELECT * INTO v_campaign
  FROM lucky_draw_campaigns
  WHERE is_active = TRUE
    AND start_date <= NOW()
    AND end_date >= NOW()
  LIMIT 1;

  IF v_campaign IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No active lucky draw campaign found', 'code', 'NO_CAMPAIGN');
  END IF;

  -- 5. Get Order and Company Context
  v_order_id := v_qr_record.order_id;
  SELECT company_id INTO v_company_id FROM orders WHERE id = v_order_id;

  -- 6. Generate Entry Number
  v_entry_number := 'LD-' || upper(substring(md5(random()::text) from 1 for 8));
  v_entry_date := NOW();

  -- 7. Update QR Code Flags AND Consumer Details
  UPDATE qr_codes
  SET is_lucky_draw_entered = TRUE,
      consumer_name = COALESCE(p_consumer_name, consumer_name),
      consumer_phone = COALESCE(p_consumer_phone, consumer_phone),
      consumer_email = COALESCE(p_consumer_email, consumer_email)
  WHERE id = v_qr_record.id;

  -- 8. Insert Entry
  INSERT INTO lucky_draw_entries (
    qr_code_id,
    campaign_id,
    order_id,
    company_id,
    consumer_name,
    consumer_phone,
    consumer_email,
    entry_number,
    is_winner,
    entry_date
  ) VALUES (
    v_qr_record.id,
    v_campaign.id,
    v_order_id,
    v_company_id,
    p_consumer_name,
    p_consumer_phone,
    p_consumer_email,
    v_entry_number,
    FALSE,
    v_entry_date
  ) RETURNING id INTO v_new_entry_id;

  -- 9. Return Success
  RETURN jsonb_build_object(
    'success', true,
    'already_entered', false,
    'message', 'Successfully entered lucky draw!',
    'entry', jsonb_build_object(
      'id', v_new_entry_id,
      'entry_number', v_entry_number,
      'campaign_name', v_campaign.campaign_name,
      'entry_date', v_entry_date
    )
  );
END;
$$;

-- 2. Update consumer_claim_gift to accept and save consumer details
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

  -- 6. Update QR Code Flags AND Consumer Details
  UPDATE qr_codes
  SET is_redeemed = TRUE,
      redeemed_at = NOW(),
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
    'gift_name', v_gift.gift_name,
    'gift_description', v_gift.gift_description,
    'gift_image_url', v_gift.gift_image_url,
    'remaining', CASE WHEN v_gift.total_quantity > 0 THEN v_gift.total_quantity - (v_gift.claimed_quantity) ELSE NULL END
  );
END;
$$;
