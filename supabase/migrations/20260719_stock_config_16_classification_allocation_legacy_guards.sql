-- ============================================================================
-- Inventory Stock Configurations — Phase 16 (forward-only)
-- Initial Classification: live legacy revalidation + allocation guard
-- ----------------------------------------------------------------------------
-- Confirmed failure SC-MRR56NMA-1TDQ (after migration 15 timeouts):
--   SQLSTATE 23514 — product_inventory.valid_quantities
--   Clearing ZER-396287-UNC (on_hand=100) to 0 while quantity_allocated=1
--   (held by open order ORD-DH-0626-02) would leave allocated > on_hand.
--
-- Business rules enforced here (Initial Configuration Classification only):
--   1. Re-read the live Legacy/Unclassified on_hand — never trust a stale
--      Excel/draft system_quantity alone for classification decisions.
--   2. If live UNC on_hand = 0 → already fully classified (block with
--      product/flavour name; tell user to download a new template or use
--      Full Count).
--   3. If live UNC quantity_allocated > 0 → block full classification.
--      Do NOT auto-clear, delete, or move the allocation.
--   4. If sum(target physical counts) > live UNC on_hand → exceeds remaining
--      legacy (block with product, requested qty, remaining qty).
--
-- Called from:
--   - prepare_stock_count_verification (after inventory row locks)
--   - verify_and_post_stock_classification (after inventory row locks,
--     before the OTP is consumed / movements are written)
--
-- Atomicity unchanged: any RAISE rolls the whole transaction back, the
-- verification code is not consumed, and inventory is not changed.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.stock_count_assert_classification_postable(
  p_session_id uuid,
  p_warehouse_id uuid
)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_row record;
  v_flavour text;
  v_unit_label text;
BEGIN
  FOR v_row IN
    SELECT
      i.variant_id,
      coalesce(nullif(btrim(c.stock_sku), ''), 'UNC') AS stock_sku,
      coalesce(nullif(btrim(p.product_name), ''), 'Unknown product') AS product_name,
      coalesce(nullif(btrim(pv.variant_name), ''), 'Unknown flavour') AS variant_name,
      coalesce(pi.quantity_on_hand, 0) AS live_on_hand,
      coalesce(pi.quantity_allocated, 0) AS live_allocated,
      coalesce((
        SELECT sum(ti.physical_quantity)::integer
        FROM public.stock_count_session_items ti
        JOIN public.inventory_stock_configurations tc
          ON tc.id = ti.stock_config_id AND tc.variant_id = ti.variant_id
        WHERE ti.session_id = p_session_id
          AND ti.variant_id = i.variant_id
          AND tc.config_code IN ('20NB', '50NB', '50OB')
          AND ti.physical_quantity IS NOT NULL
      ), 0) AS requested_total
    FROM public.stock_count_session_items i
    JOIN public.inventory_stock_configurations c
      ON c.id = i.stock_config_id AND c.variant_id = i.variant_id
    JOIN public.product_variants pv ON pv.id = i.variant_id
    JOIN public.products p ON p.id = pv.product_id
    LEFT JOIN public.product_inventory pi
      ON pi.variant_id = i.variant_id
     AND pi.stock_config_id = i.stock_config_id
     AND pi.organization_id = p_warehouse_id
     AND pi.is_active = true
    WHERE i.session_id = p_session_id
      AND c.config_code = 'UNCLASSIFIED'
      AND i.physical_quantity IS NOT NULL
    ORDER BY p.product_name, pv.variant_name
  LOOP
    v_flavour := format('%s [%s]', v_row.product_name, v_row.variant_name);

    -- Live UNC already gone (classified after template/draft was captured).
    IF v_row.live_on_hand <= 0 THEN
      RAISE EXCEPTION 'stock_count_already_fully_classified: %',
        format(
          'This product has already been fully classified (%s). Download a new Initial Classification template or use Full Count to update its quantity.',
          v_flavour
        );
    END IF;

    -- Active allocation on Legacy/Unclassified — never auto-clear/move it.
    IF v_row.live_allocated > 0 THEN
      v_unit_label := CASE WHEN v_row.live_allocated = 1 THEN 'unit' ELSE 'units' END;
      RAISE EXCEPTION 'stock_count_allocated_blocks_post: %',
        format(
          'This Legacy inventory for %s still has %s allocated %s and cannot be fully classified. Release or resolve the allocation before posting.',
          v_flavour,
          v_row.live_allocated,
          v_unit_label
        );
    END IF;

    -- Requested target total may not exceed the live remaining Legacy balance.
    IF v_row.requested_total > v_row.live_on_hand THEN
      RAISE EXCEPTION 'stock_count_classification_exceeds_legacy: %',
        format(
          'Classification for %s requests %s units but only %s remain in Legacy/Unclassified. Reduce the target counts or refresh the template.',
          v_flavour,
          v_row.requested_total,
          v_row.live_on_hand
        );
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.stock_count_assert_classification_postable(uuid, uuid) IS
  'Initial Configuration Classification safety: revalidates live UNC on_hand, blocks allocated>0 (no auto-clear), and blocks target totals that exceed remaining Legacy. Raises stock_count_already_fully_classified / stock_count_allocated_blocks_post / stock_count_classification_exceeds_legacy with product/flavour detail.';

REVOKE ALL ON FUNCTION public.stock_count_assert_classification_postable(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stock_count_assert_classification_postable(uuid, uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- Patch prepare_stock_count_verification: call assert after inventory locks
-- ----------------------------------------------------------------------------

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
  v_company_id uuid;
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
    SELECT 1 FROM public.stock_count_session_items
    WHERE session_id = p_session_id
      AND physical_quantity IS NOT NULL
      AND stock_config_id IS NULL
  ) THEN RAISE EXCEPTION 'stock_count_config_identity_missing'; END IF;

  IF v_session.count_type = 'initial_configuration_classification' THEN
    IF EXISTS (
      SELECT 1
      FROM public.stock_count_session_items i
      JOIN public.inventory_stock_configurations c
        ON c.id = i.stock_config_id AND c.variant_id = i.variant_id
      WHERE i.session_id = p_session_id
        AND c.config_code = 'UNCLASSIFIED'
        AND i.physical_quantity IS DISTINCT FROM 0
    ) THEN RAISE EXCEPTION 'stock_count_classification_legacy_not_cleared'; END IF;

    IF EXISTS (
      SELECT 1
      FROM public.stock_count_session_items i
      JOIN public.inventory_stock_configurations c
        ON c.id = i.stock_config_id AND c.variant_id = i.variant_id
      WHERE i.session_id = p_session_id
        AND c.config_code = 'UNCLASSIFIED'
        AND EXISTS (
          SELECT 1 FROM public.inventory_stock_configurations target
          WHERE target.variant_id = i.variant_id
            AND target.config_code IN ('20NB', '50NB', '50OB')
            AND NOT EXISTS (
              SELECT 1 FROM public.stock_count_session_items ti
              WHERE ti.session_id = p_session_id
                AND ti.variant_id = i.variant_id
                AND ti.stock_config_id = target.id
                AND ti.physical_quantity IS NOT NULL
            )
        )
    ) THEN RAISE EXCEPTION 'stock_count_classification_incomplete'; END IF;
  END IF;

  IF v_session.count_type <> 'initial_configuration_classification' THEN
    IF EXISTS (
      SELECT 1
      FROM public.stock_count_session_items i
      JOIN public.inventory_stock_configurations c
        ON c.id = i.stock_config_id AND c.variant_id = i.variant_id
      WHERE i.session_id = p_session_id
        AND i.physical_quantity IS NOT NULL
        AND c.config_code IN ('20NB', '50NB', '50OB')
        AND EXISTS (
          SELECT 1
          FROM public.inventory_stock_configurations lc
          JOIN public.product_inventory lpi
            ON lpi.stock_config_id = lc.id
           AND lpi.variant_id = lc.variant_id
           AND lpi.organization_id = v_session.warehouse_organization_id
           AND lpi.is_active = true
          WHERE lc.variant_id = i.variant_id
            AND lc.config_code = 'UNCLASSIFIED'
            AND coalesce(lpi.quantity_on_hand, 0) > 0
        )
    ) THEN RAISE EXCEPTION 'stock_count_full_count_on_unclassified'; END IF;
  END IF;

  v_company_id := public.get_company_id(v_session.warehouse_organization_id);
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'organization_mismatch'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', v_company_id::text, v_session.warehouse_organization_id::text,
              i.variant_id::text, i.stock_config_id::text), 0
  ))
  FROM public.stock_count_session_items i
  WHERE i.session_id = p_session_id
    AND i.physical_quantity IS NOT NULL
  ORDER BY i.stock_config_id, i.variant_id;

  PERFORM 1
  FROM public.product_inventory pi
  JOIN public.stock_count_session_items i
    ON i.variant_id = pi.variant_id
   AND i.stock_config_id = pi.stock_config_id
  WHERE i.session_id = p_session_id
    AND pi.organization_id = v_session.warehouse_organization_id
    AND pi.is_active = true
    AND i.physical_quantity IS NOT NULL
  ORDER BY i.stock_config_id, i.variant_id
  FOR UPDATE OF pi;

  -- Migration 16: live UNC revalidation + allocation / exceed guards (locked).
  IF v_session.count_type = 'initial_configuration_classification' THEN
    PERFORM public.stock_count_assert_classification_postable(
      p_session_id, v_session.warehouse_organization_id
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.stock_count_session_items i
    LEFT JOIN public.inventory_stock_configurations c
      ON c.id = i.stock_config_id AND c.variant_id = i.variant_id
    WHERE i.session_id = p_session_id
      AND i.physical_quantity IS NOT NULL
      AND c.id IS NULL
  ) THEN RAISE EXCEPTION 'stock_count_config_identity_missing'; END IF;

  IF EXISTS (
    SELECT 1
    FROM public.stock_count_session_items i
    LEFT JOIN public.product_inventory pi
      ON pi.variant_id = i.variant_id
     AND pi.organization_id = v_session.warehouse_organization_id
     AND pi.stock_config_id = i.stock_config_id
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

  IF EXISTS (
    SELECT 1
    FROM public.stock_count_session_items i
    LEFT JOIN public.product_variants pv ON pv.id = i.variant_id
    WHERE i.session_id = p_session_id
      AND coalesce(i.adjustment_quantity, 0) <> 0
      AND pv.base_cost IS NULL
  ) THEN RAISE EXCEPTION 'stock_count_base_cost_missing'; END IF;

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
  'Hashes and freezes a Stock Count session before a verification code is issued. Classification sessions must clear Legacy/Unclassified to 0, count every 20NB/50NB/50OB, revalidate live UNC (migration 16), and refuse allocated>0 or target totals that exceed remaining Legacy. Ordinary counts may not count targets while UNC on_hand > 0.';

REVOKE ALL ON FUNCTION public.prepare_stock_count_verification(uuid, uuid, text, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prepare_stock_count_verification(uuid, uuid, text, jsonb, jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- Patch verify_and_post_stock_classification: assert after locks, before OTP consume
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.verify_and_post_stock_classification(p_request_id uuid, p_code_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET statement_timeout TO '300s'
SET lock_timeout TO '30s'
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

  -- Migration 16: revalidate live Legacy under row locks before consuming the code.
  PERFORM public.stock_count_assert_classification_postable(
    v_session.id, v_session.warehouse_organization_id
  );

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
  'Atomically reclassifies Legacy/Unclassified into 20NB/50NB/50OB. Migration 15 timeouts; migration 16 revalidates live UNC under lock, blocks allocated>0 (no auto-clear), and blocks target totals that exceed remaining Legacy. Single-use code + draft-only session update keep it idempotent.';

REVOKE ALL ON FUNCTION public.verify_and_post_stock_classification(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_and_post_stock_classification(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
