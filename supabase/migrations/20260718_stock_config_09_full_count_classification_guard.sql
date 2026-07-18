-- ============================================================================
-- Inventory Stock Configurations — Phase 7 follow-up (09):
-- Block ordinary counts from reclassifying a Legacy/Unclassified balance
-- ----------------------------------------------------------------------------
-- Migrations 01-08 are already applied to staging and remain immutable. This
-- migration is strictly additive / forward-only and changes one function body
-- only. It does not update, classify, or move any inventory balance or
-- historical movement.
--
-- Incident context: a Full Count was used to enter physical counts directly
-- into a variant's 20NB/50NB/50OB target configurations while that variant
-- still held its entire balance on the Legacy/Unclassified (UNCLASSIFIED)
-- configuration. Because an ordinary count does not draw the legacy balance
-- down, the targets' counts posted as brand-new phantom stock ON TOP OF the
-- untouched legacy balance (e.g. 50+50+50 = +150 units created from nothing,
-- with 100 legacy units still on the books).
--
-- The correct path for moving a legacy balance into 20NB/50NB/50OB is the
-- dedicated initial_configuration_classification count type
-- (verify_and_post_stock_classification, migration 08), which clears the
-- legacy row to zero in the same atomic posting.
--
-- This migration re-creates prepare_stock_count_verification with the exact
-- body from migration 08 plus one additional guard: a non-classification
-- session may not request a verification code if it counts any 20NB/50NB/50OB
-- target for a variant that still holds a nonzero UNCLASSIFIED balance at the
-- session warehouse. verify_and_post_stock_count is unchanged — a code can
-- never be obtained for such a session, and the snapshot hash still binds the
-- eventual posting to exactly what was frozen here.
-- ============================================================================

BEGIN;

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

  -- ── NEW in migration 09 ────────────────────────────────────────────────
  -- Ordinary counts (full_count/cycle_count/spot_check) may not be used to
  -- classify a Legacy/Unclassified balance. If such a session counts any
  -- 20NB/50NB/50OB target for a variant that still holds a nonzero UNCLASSIFIED
  -- balance at this warehouse, posting it would add phantom stock on top of the
  -- untouched legacy balance. That reclassification must go through
  -- initial_configuration_classification instead.
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
  -- ───────────────────────────────────────────────────────────────────────

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
  'Hashes and freezes a Stock Count session before a verification code is issued. Classification sessions must clear the Legacy/Unclassified row to 0 and count every 20NB/50NB/50OB. Ordinary counts (migration 09) may NOT count a 20NB/50NB/50OB target for a variant that still holds a nonzero UNCLASSIFIED balance — that must be reclassified via initial_configuration_classification.';

REVOKE ALL ON FUNCTION public.prepare_stock_count_verification(uuid, uuid, text, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prepare_stock_count_verification(uuid, uuid, text, jsonb, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
