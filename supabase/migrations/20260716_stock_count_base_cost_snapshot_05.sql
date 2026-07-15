-- Stock Count cost authority: snapshot product_variants.base_cost for posting.
-- Requires the Stock Count verification migrations 01-03.

CREATE OR REPLACE FUNCTION public.stock_count_snapshot_hash(p_session_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT encode(extensions.digest(convert_to(jsonb_build_object(
    'session', jsonb_build_object(
      'warehouse', s.warehouse_organization_id,
      'count_date', s.count_date,
      'count_type', s.count_type,
      'reference', coalesce(s.reference_name, ''),
      'posting_note', coalesce(s.notes, ''),
      'status', s.status
    ),
    'items', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'variant_id', i.variant_id,
        'sku', coalesce(i.sku, ''),
        'system_quantity', i.system_quantity,
        'current_system_quantity', coalesce(pi.quantity_on_hand, 0),
        'physical_quantity', i.physical_quantity,
        'adjustment_quantity', i.adjustment_quantity,
        'unit_cost_snapshot', i.unit_cost,
        'current_variant_base_cost', pv.base_cost,
        'note', coalesce(i.note, '')
      ) ORDER BY i.variant_id)
      FROM public.stock_count_session_items i
      JOIN public.product_variants pv ON pv.id = i.variant_id
      LEFT JOIN public.product_inventory pi
        ON pi.variant_id = i.variant_id
       AND pi.organization_id = s.warehouse_organization_id
       AND pi.is_active = true
      WHERE i.session_id = s.id
    ), '[]'::jsonb)
  )::text, 'UTF8'), 'sha256'), 'hex')
  FROM public.stock_count_sessions s
  WHERE s.id = p_session_id
$$;

CREATE OR REPLACE FUNCTION public.prepare_stock_count_verification(
  p_session_id uuid,
  p_organization_id uuid,
  p_code_hash text,
  p_recipient_summary jsonb,
  p_request_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session public.stock_count_sessions%ROWTYPE;
  v_snapshot text;
  v_request_id uuid;
  v_resend_count integer := 0;
  v_recent_count integer;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_code_hash IS NULL OR length(p_code_hash) < 32 THEN RAISE EXCEPTION 'invalid_code_hash'; END IF;

  SELECT * INTO v_session
  FROM public.stock_count_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'stock_count_not_found'; END IF;
  IF v_session.status <> 'draft' THEN RAISE EXCEPTION 'stock_count_already_posted'; END IF;
  IF NOT public.stock_count_user_can_post(v_user_id, v_session.warehouse_organization_id) THEN RAISE EXCEPTION 'permission_lost'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_user_id AND organization_id = p_organization_id) THEN
    RAISE EXCEPTION 'organization_mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.stock_count_session_items
    WHERE session_id = p_session_id AND physical_quantity IS NOT NULL
  ) THEN RAISE EXCEPTION 'no_counted_variants'; END IF;
  IF EXISTS (
    SELECT 1
    FROM public.stock_count_session_items i
    LEFT JOIN public.product_inventory pi
      ON pi.variant_id = i.variant_id
     AND pi.organization_id = v_session.warehouse_organization_id
     AND pi.is_active = true
    WHERE i.session_id = p_session_id
      AND i.physical_quantity IS NOT NULL
      AND coalesce(pi.quantity_on_hand, 0) IS DISTINCT FROM i.system_quantity
  ) THEN RAISE EXCEPTION 'stock_count_snapshot_changed'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.stock_count_session_items
    WHERE session_id = p_session_id AND coalesce(adjustment_quantity, 0) <> 0
  ) AND nullif(btrim(coalesce(v_session.notes, '')), '') IS NULL THEN
    RAISE EXCEPTION 'posting_note_required';
  END IF;

  -- A variance can only post when master data has an explicit Base Cost.
  -- No alternate or fallback cost source is allowed.
  IF EXISTS (
    SELECT 1
    FROM public.stock_count_session_items i
    LEFT JOIN public.product_variants pv ON pv.id = i.variant_id
    WHERE i.session_id = p_session_id
      AND coalesce(i.adjustment_quantity, 0) <> 0
      AND pv.base_cost IS NULL
  ) THEN RAISE EXCEPTION 'stock_count_base_cost_missing'; END IF;

  -- Authoritative posting snapshot. verify_and_post_stock_count passes this
  -- exact NUMERIC(12,2) value to record_stock_movement, whose generated
  -- total_cost remains an immutable NUMERIC(15,2) movement snapshot.
  UPDATE public.stock_count_session_items i
  SET unit_cost = pv.base_cost,
      updated_at = now()
  FROM public.product_variants pv
  WHERE i.session_id = p_session_id
    AND i.variant_id = pv.id
    AND i.physical_quantity IS NOT NULL;

  SELECT count(*) INTO v_recent_count
  FROM public.stock_count_verification_requests
  WHERE requesting_user_id = v_user_id AND requested_at > now() - interval '15 minutes';
  IF v_recent_count >= 5 THEN RAISE EXCEPTION 'request_rate_limited'; END IF;

  SELECT coalesce(max(resend_count), -1) + 1 INTO v_resend_count
  FROM public.stock_count_verification_requests WHERE session_id = p_session_id;
  IF EXISTS (
    SELECT 1 FROM public.stock_count_verification_requests
    WHERE session_id = p_session_id AND requested_at > now() - interval '60 seconds'
      AND status IN ('pending_delivery','active')
  ) THEN RAISE EXCEPTION 'resend_cooldown'; END IF;

  UPDATE public.stock_count_verification_requests
  SET status = 'invalidated', invalidated_at = now(),
      code_hash = encode(extensions.digest(extensions.gen_random_bytes(32), 'sha256'), 'hex')
  WHERE session_id = p_session_id AND status IN ('pending_delivery','active');

  v_snapshot := public.stock_count_snapshot_hash(p_session_id);
  INSERT INTO public.stock_count_verification_requests (
    organization_id, session_id, requesting_user_id, code_hash, snapshot_hash,
    recipient_summary, expires_at, resend_count, request_metadata
  ) VALUES (
    p_organization_id, p_session_id, v_user_id, p_code_hash, v_snapshot,
    coalesce(p_recipient_summary, '[]'::jsonb), now() + interval '15 minutes', v_resend_count,
    coalesce(p_request_metadata, '{}'::jsonb)
  ) RETURNING id INTO v_request_id;

  RETURN jsonb_build_object(
    'request_id', v_request_id,
    'snapshot_hash', v_snapshot,
    'expires_at', now() + interval '15 minutes',
    'resend_count', v_resend_count
  );
END;
$$;

COMMENT ON FUNCTION public.prepare_stock_count_verification(uuid, uuid, text, jsonb, jsonb) IS
  'Captures Variant Base Cost into Stock Count items immediately before approval; posting copies that immutable snapshot into stock movements.';
