-- ============================================================================
-- Inventory Stock Configurations — Phase 3: configuration-aware Stock Count
-- ----------------------------------------------------------------------------
-- Requires stock configuration Phases 0-2 and the Stock Count verification
-- migrations through 20260716_stock_count_base_cost_snapshot_05.sql.
--
-- Historical stock-count and adjustment rows remain untouched. Legacy draft
-- items with NULL stock_config_id are retained for audit but are rejected by
-- preflight: there is no safe way to infer 20NB, 50NB, or 50OB from a Variant
-- ID. New drafts are unique by (session, stock configuration), and posting
-- locks/adjusts the exact configuration balance.
-- ============================================================================

BEGIN;

ALTER TABLE public.stock_count_session_items
  ADD COLUMN IF NOT EXISTS stock_config_id uuid;
ALTER TABLE public.stock_adjustment_items
  ADD COLUMN IF NOT EXISTS stock_config_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_count_session_items_stock_config_fk') THEN
    ALTER TABLE public.stock_count_session_items
      ADD CONSTRAINT stock_count_session_items_stock_config_fk
      FOREIGN KEY (stock_config_id, variant_id)
      REFERENCES public.inventory_stock_configurations (id, variant_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_adjustment_items_stock_config_fk') THEN
    ALTER TABLE public.stock_adjustment_items
      ADD CONSTRAINT stock_adjustment_items_stock_config_fk
      FOREIGN KEY (stock_config_id, variant_id)
      REFERENCES public.inventory_stock_configurations (id, variant_id);
  END IF;
END
$$;

ALTER TABLE public.stock_count_session_items
  DROP CONSTRAINT IF EXISTS stock_count_session_items_unique_variant;

CREATE UNIQUE INDEX IF NOT EXISTS stock_count_session_items_unique_config
  ON public.stock_count_session_items (session_id, stock_config_id)
  WHERE stock_config_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stock_count_session_items_config
  ON public.stock_count_session_items (stock_config_id)
  WHERE stock_config_id IS NOT NULL;

COMMENT ON COLUMN public.stock_count_session_items.stock_config_id IS
  'Exact configuration counted by this row. NULL is retained only on legacy historical/draft rows; configuration-aware preflight rejects NULL rather than guessing.';
COMMENT ON COLUMN public.stock_adjustment_items.stock_config_id IS
  'Exact stock configuration affected by the adjustment. NULL on legacy historical rows; never backfilled by inference.';

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
        'stock_config_id', i.stock_config_id,
        'variant_id', i.variant_id,
        'stock_sku_snapshot', coalesce(i.sku, ''),
        'current_stock_sku', coalesce(c.stock_sku, ''),
        'current_volume_ml', c.volume_ml,
        'current_packaging', c.packaging,
        'system_quantity', i.system_quantity,
        'current_system_quantity', coalesce(pi.quantity_on_hand, 0),
        'physical_quantity', i.physical_quantity,
        'adjustment_quantity', i.adjustment_quantity,
        'unit_cost_snapshot', i.unit_cost,
        'current_variant_base_cost', pv.base_cost,
        'note', coalesce(i.note, '')
      ) ORDER BY i.stock_config_id, i.variant_id)
      FROM public.stock_count_session_items i
      JOIN public.product_variants pv ON pv.id = i.variant_id
      LEFT JOIN public.inventory_stock_configurations c
        ON c.id = i.stock_config_id
       AND c.variant_id = i.variant_id
      LEFT JOIN public.product_inventory pi
        ON pi.variant_id = i.variant_id
       AND pi.organization_id = s.warehouse_organization_id
       AND pi.stock_config_id = i.stock_config_id
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

  -- Never interpret a legacy Variant ID as a physical stock configuration.
  IF EXISTS (
    SELECT 1 FROM public.stock_count_session_items
    WHERE session_id = p_session_id
      AND physical_quantity IS NOT NULL
      AND stock_config_id IS NULL
  ) THEN RAISE EXCEPTION 'stock_count_config_identity_missing'; END IF;

  -- Freeze every counted configuration while validating and hashing the
  -- approval snapshot. A movement after this transaction commits changes the
  -- verify-time hash and invalidates the code.
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
  IF NOT FOUND OR v_request.requesting_user_id <> v_user_id THEN RAISE EXCEPTION 'invalid_verification_code'; END IF;
  SELECT * INTO v_session FROM public.stock_count_sessions WHERE id = v_request.session_id FOR UPDATE;
  IF v_session.status = 'posted' THEN RAISE EXCEPTION 'stock_count_already_posted'; END IF;
  IF v_request.status <> 'active' THEN RAISE EXCEPTION 'invalid_verification_code'; END IF;
  IF v_request.expires_at <= now() THEN
    UPDATE public.stock_count_verification_requests SET status = 'expired' WHERE id = p_request_id;
    RETURN jsonb_build_object('error_code', 'verification_code_expired');
  END IF;
  IF NOT public.stock_count_user_can_post(v_user_id, v_session.warehouse_organization_id) THEN RAISE EXCEPTION 'permission_lost'; END IF;

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

COMMENT ON FUNCTION public.stock_count_snapshot_hash(uuid) IS
  'Hashes Stock Count session data and exact configuration balances; legacy NULL configuration identities remain visible in the hash and cannot post.';
COMMENT ON FUNCTION public.verify_and_post_stock_count(uuid, text) IS
  'Atomically posts verified Stock Count variances to exact warehouse/variant/stock-configuration balances and preserves configuration identity in audit rows.';

COMMIT;
