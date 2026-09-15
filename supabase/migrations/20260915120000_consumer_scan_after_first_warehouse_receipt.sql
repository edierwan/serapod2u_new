-- Consumer scan eligibility after the first successful H2M warehouse receipt.
--
-- Warehouse receiving records a quantity, not QR identities. Once an order has
-- its first posted warehouse receipt (> 0), every generated QR of that order —
-- unique and warranty/buffer — must be accepted by consumer scanning.
--
-- QR lifecycle statuses are intentionally NOT changed: manufacturer packing,
-- Master QR linking and Mode C depend on generated/printed/packed/
-- buffer_available. Instead the existing status gates of these two existing
-- functions also accept a pre-warehouse status when the order is received.
--
-- Gate = existing receipt state only:
--   * warehouse_receipt_items.received_now > 0 for the order (posted by the
--     atomic post_warehouse_receipt RPC), or
--   * qr_batches.receiving_status = 'completed' for the order (Receive All/legacy).
--
-- No new table, column, index, constraint or QR status. Function signatures,
-- return shapes and all other logic are unchanged (bodies copied from
-- 20260813093000_buffer_qr_collect_points_eligible.sql and the current
-- consumer_claim_gift definition). Mirrors app/src/lib/consumer/qr-scan-eligibility.ts.

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
  -- Pre-warehouse lifecycle statuses accepted once the order has its first
  -- successful warehouse receipt (statuses themselves are left unchanged).
  v_pre_warehouse_statuses text[] := ARRAY[
    'generated',
    'printed',
    'packed',
    'ready_to_ship',
    'buffer_available',
    'buffer_used',
    'available',
    'created'
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
  ELSIF v_qr_record.status = ANY (v_pre_warehouse_statuses)
        AND (
          EXISTS (
            SELECT 1 FROM public.warehouse_receipt_items wri
            WHERE wri.order_id = v_qr_record.order_id AND wri.received_now > 0
          )
          OR EXISTS (
            SELECT 1 FROM public.qr_batches qb
            WHERE qb.order_id = v_qr_record.order_id AND qb.receiving_status = 'completed'
          )
        ) THEN
    -- Order received (first posted receipt > 0): every generated QR of the
    -- order is treated as received_warehouse for consumer scanning.
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

CREATE OR REPLACE FUNCTION public.consumer_claim_gift(p_raw_qr_code text, p_gift_id uuid, p_consumer_name text DEFAULT NULL::text, p_consumer_phone text DEFAULT NULL::text, p_consumer_email text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $_$
DECLARE
  v_qr_record RECORD;
  v_base_code TEXT;
  v_gift RECORD;
  v_redemption_code TEXT;
  v_valid_statuses TEXT[] := ARRAY['received_warehouse', 'warehouse_packed', 'shipped_distributor', 'activated', 'verified'];
  -- Pre-warehouse lifecycle statuses accepted once the order has its first
  -- successful warehouse receipt (statuses themselves are left unchanged).
  v_pre_warehouse_statuses TEXT[] := ARRAY['generated', 'printed', 'packed', 'ready_to_ship', 'buffer_available', 'buffer_used', 'available', 'created'];
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
  IF NOT (
    v_qr_record.status = ANY(v_valid_statuses)
    OR (
      v_qr_record.status = ANY(v_pre_warehouse_statuses)
      AND (
        EXISTS (
          SELECT 1 FROM public.warehouse_receipt_items wri
          WHERE wri.order_id = v_qr_record.order_id AND wri.received_now > 0
        )
        OR EXISTS (
          SELECT 1 FROM public.qr_batches qb
          WHERE qb.order_id = v_qr_record.order_id AND qb.receiving_status = 'completed'
        )
      )
    )
  ) THEN
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
  SELECT id INTO v_scan_id
  FROM consumer_qr_scans
  WHERE qr_code_id = v_qr_record.id AND consumer_phone = p_consumer_phone
  LIMIT 1;

  IF v_scan_id IS NOT NULL THEN
    UPDATE consumer_qr_scans
    SET redeemed_gift = TRUE, updated_at = NOW()
    WHERE id = v_scan_id;
  ELSE
    -- Only insert if we have a phone number
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
    'gift_image_url', v_gift.gift_image_url,
    'gift_description', v_gift.gift_description
  );
END;
$_$;
