-- Atomic Stock Count verification and posting RPCs.
-- Requires 20260715_stock_count_verification_01.sql.

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
        'unit_cost', i.unit_cost,
        'note', coalesce(i.note, '')
      ) ORDER BY i.variant_id)
      FROM public.stock_count_session_items i
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

CREATE OR REPLACE FUNCTION public.stock_count_user_can_post(p_user_id uuid, p_warehouse_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role_level integer;
  v_role_permissions jsonb;
  v_overrides jsonb;
BEGIN
  SELECT r.role_level, coalesce(r.permissions::jsonb, '{}'::jsonb), coalesce(d.permission_overrides::jsonb, '{}'::jsonb)
    INTO v_role_level, v_role_permissions, v_overrides
  FROM public.users u
  LEFT JOIN public.roles r ON r.role_code = u.role_code
  LEFT JOIN public.departments d ON d.id = u.department_id
  WHERE u.id = p_user_id AND coalesce(u.is_active, true) = true;

  IF NOT FOUND OR NOT (public.can_access_org(p_warehouse_id) OR public.is_hq_admin()) THEN RETURN false; END IF;
  IF coalesce(v_overrides->'deny', '[]'::jsonb) ? 'adjust_stock' THEN RETURN false; END IF;
  RETURN v_role_level = 1
    OR coalesce(v_overrides->'allow', '[]'::jsonb) ? 'adjust_stock'
    OR coalesce(v_role_permissions->>'adjust_stock', 'false')::boolean
    OR coalesce(v_role_permissions, '[]'::jsonb) ? 'adjust_stock';
END;
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
  SELECT * INTO v_session FROM public.stock_count_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'stock_count_not_found'; END IF;
  IF v_session.status <> 'draft' THEN RAISE EXCEPTION 'stock_count_already_posted'; END IF;
  IF NOT public.stock_count_user_can_post(v_user_id, v_session.warehouse_organization_id) THEN RAISE EXCEPTION 'permission_lost'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_user_id AND organization_id = p_organization_id) THEN
    RAISE EXCEPTION 'organization_mismatch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stock_count_session_items WHERE session_id = p_session_id AND physical_quantity IS NOT NULL) THEN
    RAISE EXCEPTION 'no_counted_variants';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.stock_count_session_items i
    LEFT JOIN public.product_inventory pi
      ON pi.variant_id = i.variant_id AND pi.organization_id = v_session.warehouse_organization_id AND pi.is_active = true
    WHERE i.session_id = p_session_id AND i.physical_quantity IS NOT NULL
      AND coalesce(pi.quantity_on_hand, 0) IS DISTINCT FROM i.system_quantity
  ) THEN RAISE EXCEPTION 'stock_count_snapshot_changed'; END IF;
  IF EXISTS (SELECT 1 FROM public.stock_count_session_items WHERE session_id = p_session_id AND coalesce(adjustment_quantity, 0) <> 0)
     AND nullif(btrim(coalesce(v_session.notes, '')), '') IS NULL THEN
    RAISE EXCEPTION 'posting_note_required';
  END IF;

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
  SET status = 'invalidated', invalidated_at = now(), code_hash = encode(extensions.digest(extensions.gen_random_bytes(32), 'sha256'), 'hex')
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
    'request_id', v_request_id, 'snapshot_hash', v_snapshot,
    'expires_at', now() + interval '15 minutes', 'resend_count', v_resend_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_stock_count_verification_delivery(p_request_id uuid, p_success boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.stock_count_verification_requests
  SET status = CASE WHEN p_success THEN 'active' ELSE 'delivery_failed' END,
      delivered_at = CASE WHEN p_success THEN now() ELSE NULL END,
      invalidated_at = CASE WHEN p_success THEN NULL ELSE now() END,
      code_hash = CASE WHEN p_success THEN code_hash ELSE encode(extensions.digest(extensions.gen_random_bytes(32), 'sha256'), 'hex') END
  WHERE id = p_request_id AND requesting_user_id = auth.uid() AND status = 'pending_delivery';
  IF NOT FOUND THEN RAISE EXCEPTION 'verification_request_unavailable'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_and_post_stock_count(p_request_id uuid, p_code_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_request public.stock_count_verification_requests%ROWTYPE;
  v_session public.stock_count_sessions%ROWTYPE;
  v_item record;
  v_current_snapshot text;
  v_adjustment_id uuid;
  v_reason_id uuid;
  v_counted integer;
  v_variances integer;
  v_net integer;
  v_value numeric(15,2);
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT * INTO v_request FROM public.stock_count_verification_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.requesting_user_id <> v_user_id THEN RAISE EXCEPTION 'invalid_verification_code'; END IF;
  SELECT * INTO v_session FROM public.stock_count_sessions WHERE id = v_request.session_id FOR UPDATE;
  IF v_session.status = 'posted' THEN RAISE EXCEPTION 'stock_count_already_posted'; END IF;
  IF v_request.status <> 'active' THEN RAISE EXCEPTION 'invalid_verification_code'; END IF;
  IF v_request.expires_at <= now() THEN
    UPDATE public.stock_count_verification_requests SET status = 'expired' WHERE id = p_request_id;
    RETURN jsonb_build_object('error_code', 'verification_code_expired');
  END IF;
  IF NOT public.stock_count_user_can_post(v_user_id, v_session.warehouse_organization_id) THEN RAISE EXCEPTION 'permission_lost'; END IF;
  v_current_snapshot := public.stock_count_snapshot_hash(v_session.id);
  IF v_current_snapshot IS DISTINCT FROM v_request.snapshot_hash THEN
    UPDATE public.stock_count_verification_requests
      SET status = 'invalidated', invalidated_at = now(), snapshot_mismatch = true
    WHERE id = p_request_id;
    RETURN jsonb_build_object('error_code', 'stock_count_snapshot_changed');
  END IF;
  IF p_code_hash IS DISTINCT FROM v_request.code_hash THEN
    UPDATE public.stock_count_verification_requests
    SET failed_attempt_count = least(failed_attempt_count + 1, 5),
        status = CASE WHEN failed_attempt_count + 1 >= 5 THEN 'too_many_attempts' ELSE status END,
        invalidated_at = CASE WHEN failed_attempt_count + 1 >= 5 THEN now() ELSE invalidated_at END
    WHERE id = p_request_id;
    RETURN jsonb_build_object('error_code', 'invalid_verification_code');
  END IF;

  SELECT count(*) FILTER (WHERE physical_quantity IS NOT NULL),
         count(*) FILTER (WHERE coalesce(adjustment_quantity, 0) <> 0),
         coalesce(sum(adjustment_quantity) FILTER (WHERE physical_quantity IS NOT NULL), 0),
         coalesce(sum(adjustment_quantity * unit_cost) FILTER (WHERE physical_quantity IS NOT NULL), 0)
  INTO v_counted, v_variances, v_net, v_value
  FROM public.stock_count_session_items WHERE session_id = v_session.id;

  FOR v_item IN
    SELECT i.*, pi.warehouse_location
    FROM public.stock_count_session_items i
    JOIN public.product_inventory pi
      ON pi.variant_id = i.variant_id AND pi.organization_id = v_session.warehouse_organization_id AND pi.is_active = true
    WHERE i.session_id = v_session.id AND coalesce(i.adjustment_quantity, 0) <> 0
    ORDER BY i.variant_id FOR UPDATE OF pi
  LOOP
    PERFORM public.record_stock_movement(
      p_movement_type => 'adjustment', p_variant_id => v_item.variant_id,
      p_organization_id => v_session.warehouse_organization_id,
      p_quantity_change => v_item.adjustment_quantity, p_unit_cost => v_item.unit_cost,
      p_manufacturer_id => NULL, p_warehouse_location => v_item.warehouse_location,
      p_reason => 'Stock count ' || replace(v_session.count_type, '_', ' '),
      p_notes => coalesce(v_item.note, 'Stock count posting'), p_reference_type => 'adjustment',
      p_reference_id => v_session.id, p_reference_no => coalesce(v_session.reference_name, 'Stock Count ' || v_session.count_date::text),
      p_company_id => v_request.organization_id, p_created_by => v_user_id, p_evidence_urls => NULL
    );
  END LOOP;

  SELECT id INTO v_reason_id FROM public.stock_adjustment_reasons
  WHERE is_active = true AND reason_name ILIKE '%count%' ORDER BY created_at LIMIT 1;
  INSERT INTO public.stock_adjustments (organization_id, reason_id, notes, status, created_by, manufacturer_status)
  VALUES (v_session.warehouse_organization_id, v_reason_id, v_session.notes, 'completed', v_user_id, 'draft')
  RETURNING id INTO v_adjustment_id;
  INSERT INTO public.stock_adjustment_items (adjustment_id, variant_id, system_quantity, physical_quantity, adjustment_quantity, unit_cost)
  SELECT v_adjustment_id, variant_id, system_quantity, physical_quantity, adjustment_quantity, unit_cost
  FROM public.stock_count_session_items WHERE session_id = v_session.id AND coalesce(adjustment_quantity, 0) <> 0;

  UPDATE public.stock_count_sessions SET
    status = 'posted', posted_by = v_user_id, posted_at = now(), total_variants_counted = v_counted,
    variance_items = v_variances, net_quantity_adjustment = v_net, estimated_adjustment_value = v_value,
    updated_by = v_user_id, updated_at = now()
  WHERE id = v_session.id AND status = 'draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'stock_count_already_posted'; END IF;

  UPDATE public.stock_count_verification_requests SET
    status = 'posted', verified_by = v_user_id, verified_at = now(), consumed_at = now(),
    code_hash = encode(extensions.digest(extensions.gen_random_bytes(32), 'sha256'), 'hex'),
    posting_result = jsonb_build_object('status','posted','movement_count',v_variances,'adjustment_id',v_adjustment_id)
  WHERE id = p_request_id;
  UPDATE public.stock_count_verification_requests SET status = 'invalidated', invalidated_at = now()
  WHERE session_id = v_session.id AND id <> p_request_id AND status IN ('pending_delivery','active');

  RETURN jsonb_build_object('status','posted','session_id',v_session.id,'movement_count',v_variances);
END;
$$;

REVOKE ALL ON FUNCTION public.stock_count_snapshot_hash(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.stock_count_user_can_post(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prepare_stock_count_verification(uuid, uuid, text, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_stock_count_verification_delivery(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_and_post_stock_count(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prepare_stock_count_verification(uuid, uuid, text, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_stock_count_verification_delivery(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_and_post_stock_count(uuid, text) TO authenticated;
