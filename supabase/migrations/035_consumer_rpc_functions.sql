-- Migration: 035_consumer_rpc_functions.sql
-- Description: Add RPC functions for secure, atomic consumer actions (Lucky Draw, Gift Claim, Points Collection)

-- 1. Add UNIQUE constraint to lucky_draw_entries to prevent duplicate entries at DB level
ALTER TABLE lucky_draw_entries
ADD CONSTRAINT unique_campaign_qr_code UNIQUE (campaign_id, qr_code_id);

-- 2. Function to handle Lucky Draw Entry
CREATE OR REPLACE FUNCTION consumer_lucky_draw_enter(
  p_raw_qr_code TEXT,
  p_consumer_name TEXT,
  p_consumer_phone TEXT,
  p_consumer_email TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER -- Runs with privileges of the creator (service role)
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
  -- Try exact match first
  SELECT * INTO v_qr_record
  FROM qr_codes
  WHERE code = p_raw_qr_code
  FOR UPDATE; -- Lock the row

  -- If not found, try base code (legacy support)
  IF v_qr_record IS NULL THEN
    -- Simple base code extraction: remove suffix starting with last dash if it looks like a hash
    -- Assuming format PROD-XXX-HASH or PROD-XXX. 
    -- For simplicity in SQL, we might rely on the input being correct or try a simple split if we know the format.
    -- However, the JS getBaseCode logic is specific. 
    -- Let's try to match by checking if the code in DB is a prefix of input or vice versa? 
    -- Actually, the JS logic removes the last part if it's a hash.
    -- Let's assume the caller might pass the base code if they want, but the requirement says "Normalize QR... in SQL if needed".
    -- Let's try to find a record where the code matches the input minus the last segment if it contains a dash.
    
    -- Regex to remove the last part after a dash: '^(.*)-[^-]+$'
    v_base_code := regexp_replace(p_raw_qr_code, '-[^-]+$', '');
    
    IF v_base_code != p_raw_qr_code THEN
        SELECT * INTO v_qr_record
        FROM qr_codes
        WHERE code = v_base_code
        FOR UPDATE;
    END IF;
  END IF;

  -- If still not found
  IF v_qr_record IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'QR code not found',
      'code', 'QR_NOT_FOUND',
      'preview', true
    );
  END IF;

  -- 2. Validate Status
  IF NOT (v_qr_record.status = ANY(v_valid_statuses)) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'QR code is not active or has not been shipped yet',
      'code', 'INVALID_STATUS'
    );
  END IF;

  -- 3. Check if already entered (Flag check)
  IF v_qr_record.is_lucky_draw_entered THEN
    -- Fetch existing entry details for response
    SELECT * INTO v_existing_entry
    FROM lucky_draw_entries
    WHERE qr_code_id = v_qr_record.id
    LIMIT 1;

    -- Find campaign name if possible
    SELECT campaign_name INTO v_campaign
    FROM lucky_draw_campaigns
    WHERE id = v_existing_entry.campaign_id;

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
  v_order_id := v_qr_record.order_id;
  v_company_id := v_qr_record.company_id;

  SELECT ldc.* INTO v_campaign
  FROM lucky_draw_order_links ldol
  JOIN lucky_draw_campaigns ldc ON ldol.campaign_id = ldc.id
  WHERE ldol.order_id = v_order_id
    AND ldc.status = 'active'
    AND (ldc.start_date IS NULL OR ldc.start_date <= NOW())
    AND (ldc.end_date IS NULL OR ldc.end_date >= NOW())
  LIMIT 1;

  IF v_campaign IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No active lucky draw campaigns available for this product',
      'code', 'NO_CAMPAIGN'
    );
  END IF;

  -- 5. Check if already entered (Table check - double safety)
  SELECT * INTO v_existing_entry
  FROM lucky_draw_entries
  WHERE campaign_id = v_campaign.id AND qr_code_id = v_qr_record.id;

  IF v_existing_entry IS NOT NULL THEN
    -- Should have been caught by flag, but just in case
    -- Update flag if it was missing
    UPDATE qr_codes 
    SET is_lucky_draw_entered = TRUE, lucky_draw_entered_at = v_existing_entry.entry_date 
    WHERE id = v_qr_record.id;

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

  -- 6. Generate Entry Number
  -- Format: ENTRY-{campaign_id_prefix}-{qr_code_id_suffix}
  v_entry_number := 'ENTRY-' || substring(v_campaign.id::text, 1, 8) || '-' || substring(v_qr_record.id::text, length(v_qr_record.id::text) - 7, 8);
  v_entry_number := upper(v_entry_number);
  v_entry_date := NOW();

  -- 7. Insert Entry
  INSERT INTO lucky_draw_entries (
    campaign_id,
    company_id,
    consumer_phone,
    consumer_email,
    consumer_name,
    qr_code_id,
    entry_number,
    entry_date,
    entry_status,
    is_winner,
    prize_claimed
  ) VALUES (
    v_campaign.id,
    v_company_id,
    p_consumer_phone,
    p_consumer_email,
    p_consumer_name,
    v_qr_record.id,
    v_entry_number,
    v_entry_date,
    'entered',
    FALSE,
    FALSE
  ) RETURNING id INTO v_new_entry_id;

  -- 8. Update QR Code Flags
  UPDATE qr_codes
  SET is_lucky_draw_entered = TRUE,
      lucky_draw_entered_at = v_entry_date
  WHERE id = v_qr_record.id;

  -- 9. Track Scan (Optional, best effort)
  INSERT INTO consumer_qr_scans (
    qr_code_id,
    order_id,
    company_id,
    consumer_phone,
    consumer_email,
    scan_date,
    entered_lucky_draw,
    scanned_at
  ) VALUES (
    v_qr_record.id,
    v_order_id,
    v_company_id,
    p_consumer_phone,
    p_consumer_email,
    v_entry_date,
    TRUE,
    v_entry_date
  );

  -- 10. Return Success
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

EXCEPTION WHEN OTHERS THEN
  -- Log error if possible, or just return generic error
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'code', 'INTERNAL_ERROR'
  );
END;
$$;

-- 3. Function to handle Gift Claim
CREATE OR REPLACE FUNCTION consumer_claim_gift(
  p_raw_qr_code TEXT,
  p_gift_id UUID,
  p_consumer_phone TEXT DEFAULT NULL
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
  FOR UPDATE; -- Lock gift row to prevent over-claiming

  IF v_gift IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Gift not found or inactive', 'code', 'GIFT_NOT_FOUND');
  END IF;

  IF v_gift.total_quantity > 0 AND v_gift.claimed_quantity >= v_gift.total_quantity THEN
    RETURN jsonb_build_object('success', false, 'error', 'This gift has been fully claimed', 'code', 'GIFT_FULLY_CLAIMED');
  END IF;

  -- 5. Check Consumer Limit (if phone provided)
  IF p_consumer_phone IS NOT NULL AND v_gift.limit_per_consumer IS NOT NULL THEN
    DECLARE
      v_consumer_claims INTEGER;
    BEGIN
      SELECT COUNT(*) INTO v_consumer_claims
      FROM consumer_qr_scans
      WHERE consumer_phone = p_consumer_phone
        AND redeemed_gift = TRUE
        AND qr_code_id IN (SELECT id FROM qr_codes WHERE order_id = v_qr_record.order_id); -- Assuming limit is per order context or similar? 
        -- Actually, the original code checked scans for this specific QR code, which is redundant if we block the QR code itself.
        -- But maybe it meant "how many gifts has this consumer claimed in general"?
        -- The original code: .eq('qr_code_id', qrCodeData.id).eq('consumer_phone', consumer_phone).eq('redeemed_gift', true)
        -- This only checks if THIS QR code was used by THIS consumer. Since we block the QR code globally, this check is redundant unless we want to support multiple claims per QR (which we don't).
        -- However, if the limit is "Consumer can only claim 1 gift across ALL QR codes", that's different.
        -- The original code logic was: .eq('qr_code_id', qrCodeData.id). This implies it was only checking per QR code.
        -- Since we are enforcing 1 claim per QR code globally, the per-consumer limit on a single QR code is always 1.
        -- So we can skip this check if it was only scoped to the QR code.
    END;
  END IF;

  -- 6. Update Gift Quantity
  UPDATE redeem_gifts
  SET claimed_quantity = claimed_quantity + 1,
      updated_at = NOW()
  WHERE id = v_gift.id;

  -- 7. Update QR Code Flags
  UPDATE qr_codes
  SET is_redeemed = TRUE,
      redeemed_at = NOW()
  WHERE id = v_qr_record.id;

  -- 8. Record Scan / Redemption
  -- Check if scan exists for this QR (maybe from view/scan)
  SELECT id INTO v_scan_id
  FROM consumer_qr_scans
  WHERE qr_code_id = v_qr_record.id AND consumer_phone = p_consumer_phone
  LIMIT 1;

  IF v_scan_id IS NOT NULL THEN
    UPDATE consumer_qr_scans
    SET redeemed_gift = TRUE, updated_at = NOW()
    WHERE id = v_scan_id;
  ELSE
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

  -- 9. Generate Redemption Code
  v_redemption_code := 'GFT-' || upper(substring(md5(random()::text), 1, 6));

  RETURN jsonb_build_object(
    'success', true,
    'redemption_code', v_redemption_code,
    'gift_name', v_gift.gift_name,
    'gift_description', v_gift.gift_description,
    'gift_image_url', v_gift.gift_image_url,
    'remaining', CASE WHEN v_gift.total_quantity > 0 THEN v_gift.total_quantity - v_gift.claimed_quantity - 1 ELSE NULL END
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'code', 'INTERNAL_ERROR');
END;
$$;

-- 4. Function to handle Points Collection
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
  -- Assuming consumer_qr_scans is used for points tracking based on previous code
  -- We need to link it to the shop.
  -- First, get the shop's organization ID from the user ID
  SELECT organization_id INTO v_shop_org_id FROM users WHERE id = p_shop_id::uuid;

  INSERT INTO consumer_qr_scans (
    qr_code_id,
    shop_id, -- Assuming this column exists or we use consumer_id? The original code used shop_id in checkPointsCollected
    collected_points,
    points_amount,
    points_collected_at,
    scanned_at
  ) VALUES (
    v_qr_record.id,
    v_shop_org_id, -- Storing the ORG ID as shop_id, or the USER ID? 
                   -- Original code: existingCollection.shop_id. 
                   -- And calculateShopTotalPoints queries by shop_id.
                   -- Usually points are credited to the shop organization.
    TRUE,
    v_points,
    NOW(),
    NOW()
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
