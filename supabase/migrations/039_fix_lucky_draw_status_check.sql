-- Migration: 039_fix_lucky_draw_status_check.sql
-- Description: Fix consumer_lucky_draw_enter to use status='active' instead of is_active=true

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
  -- FIX: Use status = 'active' instead of is_active = TRUE
  SELECT * INTO v_campaign
  FROM lucky_draw_campaigns
  WHERE status = 'active'
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
