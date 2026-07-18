-- ============================================================================
-- Inventory Stock Configurations — Phase 7: Initial Configuration
-- Classification for Stock Count (08)
-- ----------------------------------------------------------------------------
-- Migrations 01-07 are already applied and remain immutable. This migration
-- is strictly additive/forward-only.
--
-- Problem: enable_variant_stock_configurations (01) creates the 20NB/50NB/
-- 50OB catalog rows for a variant, but any pre-existing balance stays on the
-- UNCLASSIFIED bucket until someone actually counts and moves it. Until now
-- there was no safe, atomic way to do that reclassification — Stock Count
-- only ever adjusts one configuration at a time, and nothing ever creates a
-- zero-balance product_inventory row for a target configuration ahead of a
-- real movement.
--
-- This migration adds:
--   1. 'stock_classification' to the stock_movements reference_type
--      allowlist (movement_type stays 'adjustment', which already allows any
--      nonzero sign — no new movement_type is introduced).
--   2. 'initial_configuration_classification' to
--      stock_count_sessions.count_type, and 'archived' to
--      stock_count_sessions.status (with the posted_at CHECK updated to
--      allow the new status).
--   3. An additive guard in prepare_stock_count_verification: a
--      classification session must count the UNCLASSIFIED row at exactly 0
--      (never a typed value) and must have an explicit (non-null) physical
--      count for every one of the variant's 20NB/50NB/50OB configurations
--      before a verification code can be requested. Blank is never guessed.
--   4. verify_and_post_stock_classification(p_request_id, p_code_hash): a
--      dedicated posting RPC, structurally identical to
--      verify_and_post_stock_count's lock/snapshot/OTP skeleton, that only
--      accepts 'initial_configuration_classification' sessions and tags
--      every movement it posts with reference_type = 'stock_classification'.
--      Posting goes through record_stock_movement exactly like the general
--      Stock Count RPC does — no new locking or balance-mutation code.
--   5. A shared internal helper extracted from enable_variant_stock_
--      configurations (behaviour/signature of that function is unchanged —
--      it becomes a thin wrapper), plus:
--        - enable_variant_stock_configurations_with_profile(variant_id,
--          profile) — 'transition' (default) creates all three configs as
--          today; 'new_standard' creates only 20NB. A distinct function name
--          is used instead of an overload to avoid any PostgREST RPC
--          dispatch ambiguity.
--        - bulk_enable_variant_stock_configurations(variant_ids[]) — same
--          idempotent creation, one SAVEPOINT per variant so one failure
--          does not abort the batch.
--   6. archive_stock_count_draft(session_id) for retiring stale pre-
--      configuration drafts that can never post against the new model.
--
-- This migration changes constraints and function bodies only. It does not
-- update, classify, or move any inventory balance or historical movement.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. stock_movements.reference_type allowlist
-- ----------------------------------------------------------------------------

ALTER TABLE public.stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_reference_type_check;

ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_reference_type_check CHECK (
    reference_type = ANY (ARRAY[
      'manual'::text,
      'order'::text,
      'transfer'::text,
      'adjustment'::text,
      'purchase_order'::text,
      'return'::text,
      'campaign'::text,
      'repack'::text,
      'order_config_change'::text,
      'order_cancel_reversal'::text,
      'stock_classification'::text
    ])
  );

COMMENT ON CONSTRAINT stock_movements_reference_type_check ON public.stock_movements IS
  'Closed reference allowlist. Includes stock_classification, used only by verify_and_post_stock_classification to reclassify a Legacy/Unclassified balance into 20NB/50NB/50OB.';

-- ----------------------------------------------------------------------------
-- 2. stock_count_sessions.count_type / status allowlists
-- ----------------------------------------------------------------------------

ALTER TABLE public.stock_count_sessions
  DROP CONSTRAINT IF EXISTS stock_count_sessions_count_type_check;
ALTER TABLE public.stock_count_sessions
  ADD CONSTRAINT stock_count_sessions_count_type_check CHECK (
    count_type IN ('full_count', 'cycle_count', 'spot_check', 'initial_configuration_classification')
  );

ALTER TABLE public.stock_count_sessions
  DROP CONSTRAINT IF EXISTS stock_count_sessions_posted_once;
ALTER TABLE public.stock_count_sessions
  DROP CONSTRAINT IF EXISTS stock_count_sessions_status_check;
ALTER TABLE public.stock_count_sessions
  ADD CONSTRAINT stock_count_sessions_status_check CHECK (status IN ('draft', 'posted', 'archived'));
ALTER TABLE public.stock_count_sessions
  ADD CONSTRAINT stock_count_sessions_posted_once CHECK (
    (status = 'draft' AND posted_at IS NULL) OR
    (status = 'archived' AND posted_at IS NULL) OR
    (status = 'posted' AND posted_at IS NOT NULL)
  );

COMMENT ON COLUMN public.stock_count_sessions.count_type IS
  'full_count/cycle_count/spot_check are ordinary counts. initial_configuration_classification is used once per flavour to move an existing Legacy/Unclassified balance into 20NB/50NB/50OB and is posted only by verify_and_post_stock_classification.';
COMMENT ON COLUMN public.stock_count_sessions.status IS
  'draft -> posted is the normal flow. archived retires a stale draft (e.g. pre-configuration format) that can never post against the current model; it is a dead end, never reactivated.';

-- ----------------------------------------------------------------------------
-- 3. prepare_stock_count_verification — additive classification guard
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

  -- Never interpret a legacy Variant ID as a physical stock configuration.
  IF EXISTS (
    SELECT 1 FROM public.stock_count_session_items
    WHERE session_id = p_session_id
      AND physical_quantity IS NOT NULL
      AND stock_config_id IS NULL
  ) THEN RAISE EXCEPTION 'stock_count_config_identity_missing'; END IF;

  -- Initial Configuration Classification: the Legacy/Unclassified row must
  -- always be counted at exactly 0 (the UI never allows typing it), and
  -- every one of the variant's 20NB/50NB/50OB rows must have an explicit
  -- physical count before a code can be requested. A blank target is never
  -- treated as zero.
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

COMMENT ON FUNCTION public.prepare_stock_count_verification(uuid, uuid, text, jsonb, jsonb) IS
  'Hashes and freezes a Stock Count session before a verification code is issued. For initial_configuration_classification sessions, additionally requires the Legacy/Unclassified row to be exactly 0 and every 20NB/50NB/50OB row to have an explicit physical count.';

-- ----------------------------------------------------------------------------
-- 4. verify_and_post_stock_classification — dedicated classification posting
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
  IF NOT FOUND OR v_request.requesting_user_id <> v_user_id THEN RAISE EXCEPTION 'invalid_verification_code'; END IF;
  SELECT * INTO v_session FROM public.stock_count_sessions WHERE id = v_request.session_id FOR UPDATE;
  IF v_session.status = 'posted' THEN RAISE EXCEPTION 'stock_count_already_posted'; END IF;
  IF v_session.count_type <> 'initial_configuration_classification' THEN
    RAISE EXCEPTION 'stock_count_wrong_posting_function';
  END IF;
  IF v_request.status <> 'active' THEN RAISE EXCEPTION 'invalid_verification_code'; END IF;
  IF v_request.expires_at <= now() THEN
    UPDATE public.stock_count_verification_requests SET status = 'expired' WHERE id = p_request_id;
    RETURN jsonb_build_object('error_code', 'verification_code_expired');
  END IF;
  IF NOT public.stock_count_user_can_post(v_user_id, v_session.warehouse_organization_id) THEN RAISE EXCEPTION 'permission_lost'; END IF;

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

  -- Post the exact four lines (legacy clearance + up to three target
  -- configurations) through the same ledger primitive every other write path
  -- uses. A failure on any single line raises and rolls back the whole
  -- function invocation, including lines already posted in this loop.
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
      p_notes => coalesce(v_item.note, 'Legacy/Unclassified balance reclassified'), p_reference_type => 'stock_classification',
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
  'Atomically reclassifies a Legacy/Unclassified balance into 20NB/50NB/50OB. Only accepts initial_configuration_classification sessions; posts through record_stock_movement with reference_type=stock_classification and a shared session reference so the reclassification and any genuine physical variance are both auditable.';

-- ----------------------------------------------------------------------------
-- 5. Bulk / profile-aware enablement
-- ----------------------------------------------------------------------------
-- enable_variant_stock_configurations(uuid) keeps its exact original
-- signature and default (transition/all-three) behaviour — existing callers
-- and the contract test pinning it are unaffected. It is now a thin wrapper
-- around a shared internal helper.

CREATE OR REPLACE FUNCTION public._enable_variant_stock_configurations_core(
  p_variant_id uuid,
  p_profile text DEFAULT 'transition'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_default public.inventory_stock_configurations%ROWTYPE;
  v_created integer := 0;
  v_batch_created integer := 0;
BEGIN
  IF p_profile NOT IN ('transition', 'new_standard') THEN
    RAISE EXCEPTION 'Unknown stock configuration profile %', p_profile;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.product_variants WHERE id = p_variant_id) THEN
    RAISE EXCEPTION 'Variant % not found', p_variant_id;
  END IF;

  SELECT * INTO v_default
  FROM public.inventory_stock_configurations
  WHERE variant_id = p_variant_id AND is_variant_default
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Variant % has no default stock configuration', p_variant_id;
  END IF;

  IF v_default.config_code = 'STD' THEN
    UPDATE public.inventory_stock_configurations
    SET config_code   = 'UNCLASSIFIED',
        config_label  = 'Unclassified (pending stock take)',
        stock_sku     = public.generate_stock_sku(p_variant_id, 'UNC'),
        allow_ord     = false,
        default_for_ord = false,
        status        = 'phase_out',
        sort_order    = 99,
        updated_at    = now()
    WHERE id = v_default.id;
  END IF;

  INSERT INTO public.inventory_stock_configurations (
    variant_id, config_code, config_label, stock_sku, volume_ml, packaging,
    is_variant_default, allow_ord, allow_so, default_for_ord,
    requires_repacking_before_sale, status, sort_order
  )
  VALUES
    (p_variant_id, '20NB', '20ml · New Box', public.generate_stock_sku(p_variant_id, '20NB'),
     20, 'new_box', false, true,  true,  true,  false, 'active',    1)
  ON CONFLICT (variant_id, config_code) DO NOTHING;
  GET DIAGNOSTICS v_created = ROW_COUNT;

  IF p_profile = 'transition' THEN
    INSERT INTO public.inventory_stock_configurations (
      variant_id, config_code, config_label, stock_sku, volume_ml, packaging,
      is_variant_default, allow_ord, allow_so, default_for_ord,
      requires_repacking_before_sale, status, sort_order
    )
    VALUES
      (p_variant_id, '50NB', '50ml · New Box', public.generate_stock_sku(p_variant_id, '50NB'),
       50, 'new_box', false, false, true,  false, false, 'active',    2),
      (p_variant_id, '50OB', '50ml · Old Box', public.generate_stock_sku(p_variant_id, '50OB'),
       50, 'old_box', false, false, false, false, true,  'phase_out', 3)
    ON CONFLICT (variant_id, config_code) DO NOTHING;
    GET DIAGNOSTICS v_batch_created = ROW_COUNT;
    v_created := v_created + v_batch_created;
  END IF;

  RETURN jsonb_build_object(
    'variant_id', p_variant_id,
    'default_config_id', v_default.id,
    'profile', p_profile,
    'vape_configs_created', v_created
  );
END;
$$;

REVOKE ALL ON FUNCTION public._enable_variant_stock_configurations_core(uuid, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.enable_variant_stock_configurations(p_variant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() = 'authenticated' AND NOT public.is_hq_admin() THEN
    RAISE EXCEPTION 'Only HQ admins can enable stock configurations';
  END IF;

  RETURN public._enable_variant_stock_configurations_core(p_variant_id, 'transition');
END;
$$;

COMMENT ON FUNCTION public.enable_variant_stock_configurations(uuid) IS
  'Idempotently enables the three valid vape stock configurations (20NB/50NB/50OB) for one variant and converts its generic default into UNCLASSIFIED (pending stock take). Run per confirmed Cellera variant; never auto-applied. Unchanged signature/behaviour — now a thin wrapper over _enable_variant_stock_configurations_core.';

CREATE OR REPLACE FUNCTION public.enable_variant_stock_configurations_with_profile(
  p_variant_id uuid,
  p_profile text DEFAULT 'transition'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() = 'authenticated' AND NOT public.is_hq_admin() THEN
    RAISE EXCEPTION 'Only HQ admins can enable stock configurations';
  END IF;
  RETURN public._enable_variant_stock_configurations_core(p_variant_id, p_profile);
END;
$$;

COMMENT ON FUNCTION public.enable_variant_stock_configurations_with_profile(uuid, text) IS
  'Same as enable_variant_stock_configurations but lets the caller choose the setup profile: transition (20NB+50NB+50OB, default) for existing flavours being migrated, new_standard (20NB only) for brand-new Cellera variants. A distinct name is used instead of an overload to avoid PostgREST RPC dispatch ambiguity.';

CREATE OR REPLACE FUNCTION public.bulk_enable_variant_stock_configurations(p_variant_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_variant_id uuid;
  v_results jsonb := '[]'::jsonb;
  v_enabled_count integer := 0;
  v_already_enabled_count integer := 0;
  v_error_count integer := 0;
  v_already_had boolean;
BEGIN
  IF auth.role() = 'authenticated' AND NOT public.is_hq_admin() THEN
    RAISE EXCEPTION 'Only HQ admins can bulk-enable stock configurations';
  END IF;

  FOREACH v_variant_id IN ARRAY coalesce(p_variant_ids, ARRAY[]::uuid[])
  LOOP
    BEGIN
      SELECT EXISTS (
        SELECT 1 FROM public.inventory_stock_configurations
        WHERE variant_id = v_variant_id AND config_code = '20NB'
      ) INTO v_already_had;

      PERFORM public._enable_variant_stock_configurations_core(v_variant_id, 'transition');

      IF v_already_had THEN
        v_already_enabled_count := v_already_enabled_count + 1;
        v_results := v_results || jsonb_build_object('variant_id', v_variant_id, 'status', 'already_enabled');
      ELSE
        v_enabled_count := v_enabled_count + 1;
        v_results := v_results || jsonb_build_object('variant_id', v_variant_id, 'status', 'enabled');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_error_count := v_error_count + 1;
      v_results := v_results || jsonb_build_object('variant_id', v_variant_id, 'status', 'error', 'message', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'results', v_results,
    'enabled_count', v_enabled_count,
    'already_enabled_count', v_already_enabled_count,
    'error_count', v_error_count
  );
END;
$$;

COMMENT ON FUNCTION public.bulk_enable_variant_stock_configurations(uuid[]) IS
  'HQ-admin-only bulk version of enable_variant_stock_configurations for migrating existing Cellera flavours. Idempotent per variant; one failure (caught via a per-iteration exception block, equivalent to a SAVEPOINT/ROLLBACK TO SAVEPOINT) never aborts the rest of the batch. Never moves or classifies balances.';

-- ----------------------------------------------------------------------------
-- 6. Archiving stale pre-configuration drafts
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.archive_stock_count_draft(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session public.stock_count_sessions%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  SELECT * INTO v_session FROM public.stock_count_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'stock_count_not_found'; END IF;
  IF NOT public.stock_count_user_can_post(v_user_id, v_session.warehouse_organization_id) THEN
    RAISE EXCEPTION 'permission_lost';
  END IF;
  IF v_session.status <> 'draft' THEN RAISE EXCEPTION 'stock_count_already_posted'; END IF;

  UPDATE public.stock_count_sessions
  SET status = 'archived', updated_by = v_user_id, updated_at = now()
  WHERE id = p_session_id AND status = 'draft';

  RETURN jsonb_build_object('status', 'archived', 'session_id', p_session_id);
END;
$$;

COMMENT ON FUNCTION public.archive_stock_count_draft(uuid) IS
  'Retires a stale Stock Count draft (e.g. pre-configuration format) that can never post against the current model. Terminal: archived sessions are never reactivated or posted.';

NOTIFY pgrst, 'reload schema';

COMMIT;
