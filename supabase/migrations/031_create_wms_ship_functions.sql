-- Migration: Create WMS shipping functions for confirm-shipment API
-- This migration creates all necessary functions for the warehouse management system
-- to handle unique QR code shipments with proper inventory tracking.

-- ============================================================================
-- 1. wms_deduct_and_summarize: Deducts inventory and returns summary
-- ============================================================================
CREATE OR REPLACE FUNCTION public.wms_deduct_and_summarize(
  p_variant_id uuid, 
  p_from_org_id uuid, 
  p_to_org_id uuid, 
  p_units integer, 
  p_order_id uuid, 
  p_shipped_at timestamp with time zone DEFAULT now()
) 
RETURNS jsonb
LANGUAGE plpgsql 
SECURITY DEFINER
AS $$
DECLARE
  v_before int;
  v_after  int;
BEGIN
  IF p_units IS NULL OR p_units <= 0 THEN
    RAISE EXCEPTION 'p_units must be > 0 (got %)', p_units;
  END IF;

  -- Read BEFORE qty (warehouse side)
  SELECT pi.quantity_on_hand
  INTO v_before
  FROM public.product_inventory pi
  WHERE pi.variant_id = p_variant_id
    AND pi.organization_id = p_from_org_id
  FOR UPDATE;

  v_before := COALESCE(v_before, 0);

  -- Deduct inventory using existing adjustment function
  PERFORM public.apply_inventory_ship_adjustment(
    p_variant_id,
    p_from_org_id,
    p_units,
    0,                -- cases optional; units drive the truth
    p_shipped_at
  );

  -- Read AFTER qty
  SELECT pi.quantity_on_hand
  INTO v_after
  FROM public.product_inventory pi
  WHERE pi.variant_id = p_variant_id
    AND pi.organization_id = p_from_org_id;

  v_after := COALESCE(v_after, 0);

  RETURN jsonb_build_object(
    'variant_id',  p_variant_id,
    'from_org',    p_from_org_id,
    'to_org',      p_to_org_id,
    'order_id',    p_order_id,
    'units',       p_units,
    'before',      v_before,
    'after',       v_after,
    'shipped_at',  p_shipped_at
  );
END;
$$;

-- ============================================================================
-- 2. wms_from_unique_codes: Aggregates variant data from QR codes
-- ============================================================================
CREATE OR REPLACE FUNCTION public.wms_from_unique_codes(
  p_qr_code_ids uuid[], 
  p_from_org_id uuid, 
  p_to_org_id uuid, 
  p_order_id uuid, 
  p_shipped_at timestamp with time zone DEFAULT now()
) 
RETURNS jsonb
LANGUAGE plpgsql 
SECURITY DEFINER
AS $$
DECLARE
  r           record;
  v_items     jsonb := '[]'::jsonb;
  v_result    jsonb;
BEGIN
  IF p_qr_code_ids IS NULL OR array_length(p_qr_code_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'p_qr_code_ids must not be empty';
  END IF;

  -- For unique scans, each code = 1 unit.
  -- Group by variant so we deduct once per variant.
  FOR r IN
    SELECT qc.variant_id, COUNT(*)::int AS units
    FROM public.qr_codes qc
    WHERE qc.id = ANY(p_qr_code_ids)
    GROUP BY qc.variant_id
  LOOP
    IF r.variant_id IS NULL OR r.units <= 0 THEN
      CONTINUE;
    END IF;

    v_result := public.wms_deduct_and_summarize(
      r.variant_id,
      p_from_org_id,
      p_to_org_id,
      r.units,
      p_order_id,
      p_shipped_at
    );

    v_items := v_items || jsonb_build_array(v_result);
  END LOOP;

  RETURN jsonb_build_object('items', v_items);
END;
$$;

-- ============================================================================
-- 3. wms_record_movement_from_summary: Creates stock movement record
-- ============================================================================
CREATE OR REPLACE FUNCTION public.wms_record_movement_from_summary(p_summary jsonb) 
RETURNS uuid
LANGUAGE plpgsql 
SECURITY DEFINER
AS $$
DECLARE
  v_variant_id   uuid := (p_summary->>'variant_id')::uuid;
  v_from_org     uuid := (p_summary->>'from_org')::uuid;
  v_to_org       uuid := (p_summary->>'to_org')::uuid;
  v_order_id     uuid := (p_summary->>'order_id')::uuid;
  v_units        int  := (p_summary->>'units')::int;
  v_before       int  := COALESCE((p_summary->>'before')::int, 0);
  v_after        int  := COALESCE((p_summary->>'after')::int, 0);
  v_when         timestamptz := COALESCE((p_summary->>'shipped_at')::timestamptz, now());
  v_company_id   uuid;
  v_created_by   uuid := auth.uid();  -- may be NULL in SQL editor context
  v_movement_id  uuid;
  v_dedup_key    text;
BEGIN
  IF v_variant_id IS NULL OR v_from_org IS NULL OR v_units IS NULL OR v_units <= 0 THEN
    RAISE EXCEPTION 'Invalid input summary: variant/from_org/units required (%).', p_summary;
  END IF;

  -- fallback creator if running without JWT (SQL editor, cron, etc.)
  IF v_created_by IS NULL THEN
    SELECT u.id
    INTO v_created_by
    FROM public.users u
    WHERE u.organization_id = v_from_org
      AND COALESCE(u.is_active, true) = true
    ORDER BY (u.role_code = 'HQ_ADMIN') DESC, u.created_at ASC
    LIMIT 1;

    IF v_created_by IS NULL THEN
      RAISE EXCEPTION 'No active user found in org % to use as created_by', v_from_org;
    END IF;
  END IF;

  -- tenant/guard
  v_company_id := public.get_company_id(v_from_org);

  -- stable dedup key
  v_dedup_key := encode(digest(
      COALESCE(v_variant_id::text,'') || '|' ||
      COALESCE(v_from_org::text,'')   || '|' ||
      COALESCE(v_to_org::text,'')     || '|' ||
      COALESCE(v_order_id::text,'')   || '|' ||
      v_units::text                   || '|' ||
      to_char(v_when::date, 'YYYY-MM-DD'),
      'sha256'), 'hex');

  -- idempotency check
  PERFORM 1 FROM public.wms_movement_dedup d WHERE d.dedup_key = v_dedup_key;
  IF FOUND THEN
    SELECT d.movement_id INTO v_movement_id FROM public.wms_movement_dedup d WHERE d.dedup_key = v_dedup_key;
    RETURN v_movement_id;
  END IF;

  -- insert movement
  INSERT INTO public.stock_movements (
    id,
    variant_id,
    from_organization_id,
    to_organization_id,
    movement_type,
    quantity_change,
    quantity_before,
    quantity_after,
    reference_type,
    reference_id,
    reference_no,
    company_id,
    created_by,
    created_at
  )
  VALUES (
    gen_random_uuid(),
    v_variant_id,
    v_from_org,
    NULLIF(v_to_org, v_from_org),
    'order_fulfillment',
    -v_units,
    v_before,
    v_after,
    'order',
    v_order_id,
    NULL,               -- no doc number column in your orders
    v_company_id,
    v_created_by,
    v_when
  )
  RETURNING id INTO v_movement_id;

  INSERT INTO public.wms_movement_dedup (dedup_key, movement_id)
  VALUES (v_dedup_key, v_movement_id)
  ON CONFLICT (dedup_key) DO NOTHING;

  RETURN v_movement_id;
END;
$$;

-- ============================================================================
-- 4. wms_record_movements_from_items: Batch creates stock movements
-- ============================================================================
CREATE OR REPLACE FUNCTION public.wms_record_movements_from_items(p_items jsonb) 
RETURNS jsonb
LANGUAGE plpgsql 
SECURITY DEFINER
AS $$
DECLARE
  elem   jsonb;
  v_id   uuid;
  v_ids  jsonb := '[]'::jsonb;
BEGIN
  -- Case 1: { "items": [ {...}, {...} ] }
  IF jsonb_typeof(p_items->'items') = 'array' THEN
    FOR elem IN
      SELECT value FROM jsonb_array_elements(p_items->'items')
    LOOP
      v_id := public.wms_record_movement_from_summary(elem);
      v_ids := v_ids || jsonb_build_array(v_id);
    END LOOP;

  -- Case 2: plain array: [ {...}, {...} ]
  ELSIF jsonb_typeof(p_items) = 'array' THEN
    FOR elem IN
      SELECT value FROM jsonb_array_elements(p_items)
    LOOP
      v_id := public.wms_record_movement_from_summary(elem);
      v_ids := v_ids || jsonb_build_array(v_id);
    END LOOP;

  -- Case 3: single object
  ELSE
    v_id := public.wms_record_movement_from_summary(p_items);
    v_ids := v_ids || jsonb_build_array(v_id);
  END IF;

  RETURN jsonb_build_object('movement_ids', v_ids);
END;
$$;

-- ============================================================================
-- 5. wms_ship_unique_auto: Main entry point for unique QR shipments
-- ============================================================================
CREATE OR REPLACE FUNCTION public.wms_ship_unique_auto(
  p_qr_code_ids uuid[], 
  p_from_org_id uuid, 
  p_to_org_id uuid, 
  p_order_id uuid, 
  p_shipped_at timestamp with time zone DEFAULT now()
) 
RETURNS jsonb
LANGUAGE plpgsql 
SECURITY DEFINER
AS $$
DECLARE
  v_payload jsonb;
  v_ids     jsonb;
BEGIN
  -- Step 1: Aggregate variant data from QR codes
  v_payload := public.wms_from_unique_codes(
    p_qr_code_ids, 
    p_from_org_id, 
    p_to_org_id, 
    p_order_id, 
    p_shipped_at
  );
  
  -- Step 2: Record consolidated stock movements and update inventory
  v_ids := public.wms_record_movements_from_items(v_payload);
  
  -- Step 3: Return combined result
  RETURN (v_payload || v_ids);
END;
$$;

COMMENT ON FUNCTION public.wms_ship_unique_auto IS 
'Handles warehouse shipment of unique QR codes by:
1. Aggregating variant quantities from QR code IDs
2. Deducting from warehouse inventory
3. Creating consolidated stock movements
4. Returns summary with movement IDs';

-- ============================================================================
-- Grant permissions
-- ============================================================================
GRANT EXECUTE ON FUNCTION public.wms_deduct_and_summarize TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wms_from_unique_codes TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wms_record_movement_from_summary TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wms_record_movements_from_items TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wms_ship_unique_auto TO authenticated, service_role;
