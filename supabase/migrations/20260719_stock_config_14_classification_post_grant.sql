-- ============================================================================
-- Inventory Stock Configurations — Phase 14 (forward-only)
-- Grant Initial Configuration Classification posting + distinct OTP errors
-- ----------------------------------------------------------------------------
-- Root cause fixed here:
--   Migration 08 created verify_and_post_stock_classification but never granted
--   EXECUTE to authenticated. prepare_stock_count_verification (granted in 02/09)
--   could issue and email a code, but Verify & Post failed with an opaque
--   permission/schema-cache error that the UI mapped to "couldn't request the
--   verification code".
--
-- Also:
--   * Distinguish already-used / expired / incorrect verification codes
--   * Reject classification sessions from the ordinary verify_and_post_stock_count
--     path (defense in depth; the API already selects the correct RPC)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Grant the classification posting RPC (parity with verify_and_post_stock_count)
-- ----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.verify_and_post_stock_classification(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_and_post_stock_classification(uuid, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. verify_and_post_stock_classification — distinct OTP failure codes
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.verify_and_post_stock_classification(p_request_id uuid, p_code_hash text)
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
  v_company_id uuid;
  v_counted integer;
  v_variances integer;
  v_net integer;
  v_value numeric(15,2);
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT * INTO v_request FROM public.stock_count_verification_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.requesting_user_id <> v_user_id THEN
    RAISE EXCEPTION 'invalid_verification_code';
  END IF;
  SELECT * INTO v_session FROM public.stock_count_sessions WHERE id = v_request.session_id FOR UPDATE;
  IF v_session.status = 'posted' THEN RAISE EXCEPTION 'stock_count_already_posted'; END IF;
  IF v_session.count_type <> 'initial_configuration_classification' THEN
    RAISE EXCEPTION 'stock_count_wrong_posting_function';
  END IF;

  -- Single-use: a previously consumed/posted code must never post again.
  IF v_request.status = 'posted' OR v_request.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'verification_code_already_used';
  END IF;
  IF v_request.status = 'expired' OR v_request.expires_at <= now() THEN
    UPDATE public.stock_count_verification_requests
      SET status = 'expired'
    WHERE id = p_request_id AND status <> 'expired';
    RETURN jsonb_build_object('error_code', 'verification_code_expired');
  END IF;
  IF v_request.status <> 'active' THEN
    RAISE EXCEPTION 'invalid_verification_code';
  END IF;
  IF NOT public.stock_count_user_can_post(v_user_id, v_session.warehouse_organization_id) THEN
    RAISE EXCEPTION 'permission_lost';
  END IF;

  -- Defense in depth: re-run the classification-completeness guard in case
  -- the underlying configuration catalog changed between prepare and verify
  -- (the snapshot-hash check below also catches balance drift).
  IF EXISTS (
    SELECT 1
    FROM public.stock_count_session_items i
    JOIN public.inventory_stock_configurations c
      ON c.id = i.stock_config_id AND c.variant_id = i.variant_id
    WHERE i.session_id = v_session.id
      AND c.config_code = 'UNCLASSIFIED'
      AND i.physical_quantity IS DISTINCT FROM 0
  ) THEN RAISE EXCEPTION 'stock_count_classification_legacy_not_cleared'; END IF;

  IF EXISTS (
    SELECT 1
    FROM public.stock_count_session_items i
    JOIN public.inventory_stock_configurations c
      ON c.id = i.stock_config_id AND c.variant_id = i.variant_id
    WHERE i.session_id = v_session.id
      AND c.config_code = 'UNCLASSIFIED'
      AND EXISTS (
        SELECT 1 FROM public.inventory_stock_configurations target
        WHERE target.variant_id = i.variant_id
          AND target.config_code IN ('20NB', '50NB', '50OB')
          AND NOT EXISTS (
            SELECT 1 FROM public.stock_count_session_items ti
            WHERE ti.session_id = v_session.id
              AND ti.variant_id = i.variant_id
              AND ti.stock_config_id = target.id
              AND ti.physical_quantity IS NOT NULL
          )
      )
  ) THEN RAISE EXCEPTION 'stock_count_classification_incomplete'; END IF;

  -- Use the ledger's advisory-lock order before taking row locks. This closes
  -- the gap between snapshot verification and posting without introducing a
  -- row-lock/advisory-lock inversion against record_stock_movement/repack.
  v_company_id := public.get_company_id(v_session.warehouse_organization_id);
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'organization_mismatch'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', v_company_id::text, v_session.warehouse_organization_id::text,
              i.variant_id::text, i.stock_config_id::text), 0
  ))
  FROM public.stock_count_session_items i
  WHERE i.session_id = v_session.id
    AND i.physical_quantity IS NOT NULL
  ORDER BY i.stock_config_id, i.variant_id;

  PERFORM 1
  FROM public.product_inventory pi
  JOIN public.stock_count_session_items i
    ON i.variant_id = pi.variant_id
   AND i.stock_config_id = pi.stock_config_id
  WHERE i.session_id = v_session.id
    AND pi.organization_id = v_session.warehouse_organization_id
    AND pi.is_active = true
    AND i.physical_quantity IS NOT NULL
  ORDER BY i.stock_config_id, i.variant_id
  FOR UPDATE OF pi;

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

  IF EXISTS (
    SELECT 1 FROM public.stock_count_session_items
    WHERE session_id = v_session.id
      AND physical_quantity IS NOT NULL
      AND stock_config_id IS NULL
  ) THEN RAISE EXCEPTION 'stock_count_config_identity_missing'; END IF;

  SELECT count(*) FILTER (WHERE physical_quantity IS NOT NULL),
         count(*) FILTER (WHERE coalesce(adjustment_quantity, 0) <> 0),
         coalesce(sum(adjustment_quantity) FILTER (WHERE physical_quantity IS NOT NULL), 0),
         coalesce(sum(adjustment_quantity * unit_cost) FILTER (WHERE physical_quantity IS NOT NULL), 0)
  INTO v_counted, v_variances, v_net, v_value
  FROM public.stock_count_session_items WHERE session_id = v_session.id;

  -- Post the exact lines (legacy clearance + target configurations) through the
  -- same ledger primitive every other write path uses. A failure on any single
  -- line raises and rolls back the whole function invocation.
  FOR v_item IN
    SELECT i.*, pi.warehouse_location
    FROM public.stock_count_session_items i
    LEFT JOIN public.product_inventory pi
      ON pi.variant_id = i.variant_id
     AND pi.organization_id = v_session.warehouse_organization_id
     AND pi.stock_config_id = i.stock_config_id
     AND pi.is_active = true
    WHERE i.session_id = v_session.id AND coalesce(i.adjustment_quantity, 0) <> 0
    ORDER BY i.stock_config_id, i.variant_id
  LOOP
    PERFORM public.record_stock_movement(
      p_movement_type => 'adjustment', p_variant_id => v_item.variant_id,
      p_organization_id => v_session.warehouse_organization_id,
      p_quantity_change => v_item.adjustment_quantity, p_unit_cost => v_item.unit_cost,
      p_manufacturer_id => NULL, p_warehouse_location => v_item.warehouse_location,
      p_reason => 'Initial Configuration Classification',
      p_notes => coalesce(v_item.note, 'Legacy/Unclassified balance reclassified'),
      p_reference_type => 'stock_classification',
      p_reference_id => v_session.id,
      p_reference_no => coalesce(v_session.reference_name, 'Stock Classification ' || v_session.count_date::text),
      p_company_id => v_request.organization_id, p_created_by => v_user_id,
      p_evidence_urls => NULL, p_stock_config_id => v_item.stock_config_id
    );
  END LOOP;

  SELECT id INTO v_reason_id FROM public.stock_adjustment_reasons
  WHERE is_active = true AND reason_name ILIKE '%count%' ORDER BY created_at LIMIT 1;
  INSERT INTO public.stock_adjustments (organization_id, reason_id, notes, status, created_by, manufacturer_status)
  VALUES (v_session.warehouse_organization_id, v_reason_id, v_session.notes, 'completed', v_user_id, 'draft')
  RETURNING id INTO v_adjustment_id;

  INSERT INTO public.stock_adjustment_items (
    adjustment_id, variant_id, stock_config_id, system_quantity,
    physical_quantity, adjustment_quantity, unit_cost
  )
  SELECT v_adjustment_id, variant_id, stock_config_id, system_quantity,
         physical_quantity, adjustment_quantity, unit_cost
  FROM public.stock_count_session_items
  WHERE session_id = v_session.id AND coalesce(adjustment_quantity, 0) <> 0;

  -- Draft-only update: concurrent posters cannot double-post the session.
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

COMMENT ON FUNCTION public.verify_and_post_stock_classification(uuid, text) IS
  'Atomically reclassifies a Legacy/Unclassified balance into 20NB/50NB/50OB. Only accepts initial_configuration_classification sessions; posts through record_stock_movement with reference_type=stock_classification. EXECUTE is granted to authenticated (migration 14).';

-- Re-assert grants after CREATE OR REPLACE (privileges are preserved, but keep
-- the contract explicit and searchable in this migration).
REVOKE ALL ON FUNCTION public.verify_and_post_stock_classification(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_and_post_stock_classification(uuid, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. Ordinary stock-count poster must never accept classification sessions
-- ----------------------------------------------------------------------------

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
  v_company_id uuid;
  v_counted integer;
  v_variances integer;
  v_net integer;
  v_value numeric(15,2);
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT * INTO v_request FROM public.stock_count_verification_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.requesting_user_id <> v_user_id THEN
    RAISE EXCEPTION 'invalid_verification_code';
  END IF;
  SELECT * INTO v_session FROM public.stock_count_sessions WHERE id = v_request.session_id FOR UPDATE;
  IF v_session.status = 'posted' THEN RAISE EXCEPTION 'stock_count_already_posted'; END IF;
  IF v_session.count_type = 'initial_configuration_classification' THEN
    RAISE EXCEPTION 'stock_count_wrong_posting_function';
  END IF;

  IF v_request.status = 'posted' OR v_request.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'verification_code_already_used';
  END IF;
  IF v_request.status = 'expired' OR v_request.expires_at <= now() THEN
    UPDATE public.stock_count_verification_requests
      SET status = 'expired'
    WHERE id = p_request_id AND status <> 'expired';
    RETURN jsonb_build_object('error_code', 'verification_code_expired');
  END IF;
  IF v_request.status <> 'active' THEN
    RAISE EXCEPTION 'invalid_verification_code';
  END IF;
  IF NOT public.stock_count_user_can_post(v_user_id, v_session.warehouse_organization_id) THEN
    RAISE EXCEPTION 'permission_lost';
  END IF;

  -- Use the ledger's advisory-lock order before taking row locks.
  v_company_id := public.get_company_id(v_session.warehouse_organization_id);
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'organization_mismatch'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', v_company_id::text, v_session.warehouse_organization_id::text,
              i.variant_id::text, i.stock_config_id::text), 0
  ))
  FROM public.stock_count_session_items i
  WHERE i.session_id = v_session.id
    AND i.physical_quantity IS NOT NULL
  ORDER BY i.stock_config_id, i.variant_id;

  PERFORM 1
  FROM public.product_inventory pi
  JOIN public.stock_count_session_items i
    ON i.variant_id = pi.variant_id
   AND i.stock_config_id = pi.stock_config_id
  WHERE i.session_id = v_session.id
    AND pi.organization_id = v_session.warehouse_organization_id
    AND pi.is_active = true
    AND i.physical_quantity IS NOT NULL
  ORDER BY i.stock_config_id, i.variant_id
  FOR UPDATE OF pi;

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

  IF EXISTS (
    SELECT 1 FROM public.stock_count_session_items
    WHERE session_id = v_session.id
      AND physical_quantity IS NOT NULL
      AND stock_config_id IS NULL
  ) THEN RAISE EXCEPTION 'stock_count_config_identity_missing'; END IF;

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
      ON pi.variant_id = i.variant_id
     AND pi.organization_id = v_session.warehouse_organization_id
     AND pi.stock_config_id = i.stock_config_id
     AND pi.is_active = true
    WHERE i.session_id = v_session.id AND coalesce(i.adjustment_quantity, 0) <> 0
    ORDER BY i.stock_config_id, i.variant_id
  LOOP
    PERFORM public.record_stock_movement(
      p_movement_type => 'adjustment', p_variant_id => v_item.variant_id,
      p_organization_id => v_session.warehouse_organization_id,
      p_quantity_change => v_item.adjustment_quantity, p_unit_cost => v_item.unit_cost,
      p_manufacturer_id => NULL, p_warehouse_location => v_item.warehouse_location,
      p_reason => 'Stock count ' || replace(v_session.count_type, '_', ' '),
      p_notes => coalesce(v_item.note, 'Stock count posting'), p_reference_type => 'adjustment',
      p_reference_id => v_session.id,
      p_reference_no => coalesce(v_session.reference_name, 'Stock Count ' || v_session.count_date::text),
      p_company_id => v_request.organization_id, p_created_by => v_user_id,
      p_evidence_urls => NULL, p_stock_config_id => v_item.stock_config_id
    );
  END LOOP;

  SELECT id INTO v_reason_id FROM public.stock_adjustment_reasons
  WHERE is_active = true AND reason_name ILIKE '%count%' ORDER BY created_at LIMIT 1;
  INSERT INTO public.stock_adjustments (organization_id, reason_id, notes, status, created_by, manufacturer_status)
  VALUES (v_session.warehouse_organization_id, v_reason_id, v_session.notes, 'completed', v_user_id, 'draft')
  RETURNING id INTO v_adjustment_id;

  INSERT INTO public.stock_adjustment_items (
    adjustment_id, variant_id, stock_config_id, system_quantity,
    physical_quantity, adjustment_quantity, unit_cost
  )
  SELECT v_adjustment_id, variant_id, stock_config_id, system_quantity,
         physical_quantity, adjustment_quantity, unit_cost
  FROM public.stock_count_session_items
  WHERE session_id = v_session.id AND coalesce(adjustment_quantity, 0) <> 0;

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

COMMENT ON FUNCTION public.verify_and_post_stock_count(uuid, text) IS
  'Atomically posts verified Stock Count variances to exact warehouse/variant/stock-configuration balances. Rejects initial_configuration_classification sessions (use verify_and_post_stock_classification).';

REVOKE ALL ON FUNCTION public.verify_and_post_stock_count(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_and_post_stock_count(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
