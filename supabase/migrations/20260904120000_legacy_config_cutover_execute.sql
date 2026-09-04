-- ============================================================================
-- Legacy configuration cutover — snapshot + execution
-- ----------------------------------------------------------------------------
-- Final business decision:
--
--   For Cellera cartridge products all CURRENT physical operational stock is
--   20 mg. The 50NB and UNCLASSIFIED system balances are legacy and are
--   RETIRED TO ZERO. They are NOT repacked, reclassified or added into 20NB.
--
--   OLD 20NB + OLD 50NB + OLD UNCLASSIFIED must never be summed.
--
-- This is why repack_stock_v2() is NOT used here. That function moves quantity
-- from one configuration into another 1:1, which is exactly the outcome the
-- business has ruled out: 50NB is a different nicotine strength and must not
-- become 20NB.
--
-- The true 20NB quantity is established afterwards by the normal physical
-- Stock Count / Stock Adjustment process. This migration manufactures no 20NB
-- quantity whatsoever.
--
--   Before                       After cutover                Later count
--   20NB          5,520          20NB          5,520          20NB  → 8,800
--   50NB          1,300          50NB              0          variance +3,280
--   UNCLASSIFIED     27          UNCLASSIFIED      0
--
-- ----------------------------------------------------------------------------
-- AUDIT MODEL
-- ----------------------------------------------------------------------------
-- Balances are never UPDATEd directly. Every retirement posts one negative
-- movement through public.record_stock_movement() with an explicit
-- p_stock_config_id, and the existing ledger triggers drive product_inventory
-- to zero. That means every retired unit is explained by a row in
-- stock_movements carrying quantity_before / quantity_after, exactly like any
-- other operational posting.
--
--   movement_type   adjustment
--   reference_type  legacy_config_cutover
--   reference_no    LEGACY-CONFIG-CUTOVER-2026
--   reference_id    the caller's request UUID (idempotency key)
--
-- Historical stock_movements rows are never modified or deleted.
--
-- Distributor balances are retired on the same terms. After cutover a
-- distributor's inventory starts from legitimate future movements, orders and
-- transfers. The pre-cutover state is preserved permanently in
-- public.legacy_config_cutover_snapshot.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Reference family
-- ---------------------------------------------------------------------------
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
      'stock_classification'::text,
      'opening_balance_cutoff'::text,
      'legacy_config_cutover'::text
    ])
  );

-- ---------------------------------------------------------------------------
-- 2. Permanent pre-cutover snapshot
-- ---------------------------------------------------------------------------
-- Written before a single balance changes, and never deleted. This is the
-- audit record of what every organization held under every configuration at
-- the moment of cutover — including STD and 20NB, which are untouched, so the
-- snapshot reconstructs the complete picture rather than only the retired half.

CREATE TABLE IF NOT EXISTS public.legacy_config_cutover_snapshot (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id          uuid        NOT NULL,
  cutover_reference   text        NOT NULL,
  captured_at         timestamptz NOT NULL DEFAULT now(),
  captured_by         uuid,
  organization_id     uuid        NOT NULL,
  org_code            text,
  org_name            text,
  product_id          uuid,
  product_name        text,
  variant_id          uuid        NOT NULL,
  variant_name        text,
  variant_product_code text,
  stock_config_id     uuid,
  config_code         text,
  config_label        text,
  stock_sku           text,
  quantity_on_hand    integer     NOT NULL,
  quantity_allocated  integer     NOT NULL,
  quantity_available  integer     NOT NULL,
  average_cost        numeric,
  is_active           boolean,
  is_retirement_target boolean    NOT NULL DEFAULT false
);

COMMENT ON TABLE public.legacy_config_cutover_snapshot IS
  'Permanent pre-cutover inventory snapshot for LEGACY-CONFIG-CUTOVER-2026. One row per product_inventory row across ALL configurations (20NB, 50NB, 50OB, STD, UNCLASSIFIED) at the moment of execution. Never deleted, never rewritten: this is the audit baseline the retired distributor and warehouse balances are reconciled against.';
COMMENT ON COLUMN public.legacy_config_cutover_snapshot.is_retirement_target IS
  'True when this row''s configuration was in scope for retirement and carried a non-zero balance.';

CREATE INDEX IF NOT EXISTS idx_legacy_cutover_snapshot_request
  ON public.legacy_config_cutover_snapshot (request_id);
CREATE INDEX IF NOT EXISTS idx_legacy_cutover_snapshot_org_config
  ON public.legacy_config_cutover_snapshot (organization_id, config_code);

ALTER TABLE public.legacy_config_cutover_snapshot ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS legacy_cutover_snapshot_hq_read ON public.legacy_config_cutover_snapshot;
CREATE POLICY legacy_cutover_snapshot_hq_read
  ON public.legacy_config_cutover_snapshot
  FOR SELECT TO authenticated
  USING (public.is_hq_admin());

GRANT SELECT ON public.legacy_config_cutover_snapshot TO authenticated;
GRANT SELECT, INSERT ON public.legacy_config_cutover_snapshot TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Execution
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.execute_legacy_config_cutover(
  p_request_id   uuid,
  p_dry_run      boolean DEFAULT true,
  p_performed_by uuid    DEFAULT NULL,
  p_config_codes text[]  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_reference   CONSTANT text := 'LEGACY-CONFIG-CUTOVER-2026';
  v_codes       text[];
  v_preflight   jsonb;
  v_row         record;
  v_movement_id uuid;
  v_retired     integer := 0;
  v_units       bigint  := 0;
  v_snapshot    integer := 0;
  v_existing    integer;
  v_lines       jsonb   := '[]'::jsonb;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A cutover request id is required (it is the idempotency key)';
  END IF;

  -- stock_movements.created_by is NOT NULL and references users(id), so a
  -- retirement posted without an identity cannot be written at all. Refuse up
  -- front rather than failing 400 rows into the loop, and because the runbook
  -- requires every retired unit to name who retired it.
  IF NOT p_dry_run THEN
    IF p_performed_by IS NULL THEN
      RAISE EXCEPTION 'A performed_by user id is required: every retirement movement records who executed the cutover';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_performed_by) THEN
      RAISE EXCEPTION 'performed_by % is not a known user', p_performed_by;
    END IF;
  END IF;

  v_codes := COALESCE(p_config_codes, public.legacy_cutover_config_codes());

  -- STD is the canonical operational configuration for every non-vape product
  -- and 20NB for every Cellera cartridge. Neither is ever retirable, whatever
  -- a caller passes in.
  IF v_codes && ARRAY['STD', '20NB']::text[] THEN
    RAISE EXCEPTION 'STD and 20NB are canonical operational configurations and cannot be retired';
  END IF;

  -- --- Preflight gate ------------------------------------------------------
  v_preflight := public.legacy_config_cutover_preflight();
  IF NOT (v_preflight->>'ok')::boolean THEN
    RAISE EXCEPTION
      'Legacy configuration cutover refused: % blocking preflight condition(s). Run public.legacy_config_cutover_preflight() for the detail. Blockers are for management action; this function does not cancel documents.',
      v_preflight->>'blocking_count'
      USING ERRCODE = 'raise_exception',
            DETAIL  = v_preflight->>'blockers';
  END IF;

  -- --- Idempotency ---------------------------------------------------------
  PERFORM pg_advisory_xact_lock(
    hashtextextended('legacy-config-cutover:' || p_request_id::text, 0));

  SELECT count(*) INTO v_existing
    FROM public.stock_movements sm
   WHERE sm.reference_type = 'legacy_config_cutover'
     AND sm.reference_id = p_request_id;

  IF v_existing > 0 THEN
    RETURN jsonb_build_object(
      'request_id', p_request_id,
      'cutover_reference', c_reference,
      'dry_run', false,
      'idempotent_replay', true,
      'retired_rows', v_existing,
      'message', format('Request %s already executed: %s retirement movements exist.',
                        p_request_id, v_existing)
    );
  END IF;

  -- --- Permanent snapshot, before anything moves ---------------------------
  -- Taken for EVERY configuration, not only the retired ones, so the snapshot
  -- stands alone as the complete pre-cutover position.
  IF NOT p_dry_run THEN
    INSERT INTO public.legacy_config_cutover_snapshot (
      request_id, cutover_reference, captured_by,
      organization_id, org_code, org_name,
      product_id, product_name,
      variant_id, variant_name, variant_product_code,
      stock_config_id, config_code, config_label, stock_sku,
      quantity_on_hand, quantity_allocated, quantity_available,
      average_cost, is_active, is_retirement_target
    )
    SELECT
      p_request_id, c_reference, p_performed_by,
      pi.organization_id, o.org_code, o.org_name,
      p.id, p.product_name,
      v.id, v.variant_name, v.product_code,
      pi.stock_config_id, c.config_code, c.config_label, c.stock_sku,
      COALESCE(pi.quantity_on_hand, 0),
      COALESCE(pi.quantity_allocated, 0),
      COALESCE(pi.quantity_available, 0),
      pi.average_cost, pi.is_active,
      (c.config_code = ANY (v_codes) AND COALESCE(pi.quantity_on_hand, 0) <> 0)
    FROM public.product_inventory pi
    JOIN public.product_variants v ON v.id = pi.variant_id
    JOIN public.products p ON p.id = v.product_id
    JOIN public.organizations o ON o.id = pi.organization_id
    LEFT JOIN public.inventory_stock_configurations c ON c.id = pi.stock_config_id;

    GET DIAGNOSTICS v_snapshot = ROW_COUNT;
  END IF;

  -- --- Retire each non-zero legacy balance to zero --------------------------
  FOR v_row IN
    SELECT pi.id AS inventory_id,
           pi.organization_id,
           pi.variant_id,
           pi.stock_config_id,
           c.config_code,
           c.config_label,
           o.org_code,
           COALESCE(pi.quantity_on_hand, 0)   AS qty_on_hand,
           COALESCE(pi.quantity_allocated, 0) AS qty_allocated,
           COALESCE(pi.average_cost, 0)       AS unit_cost
      FROM public.product_inventory pi
      JOIN public.inventory_stock_configurations c ON c.id = pi.stock_config_id
      JOIN public.organizations o ON o.id = pi.organization_id
     WHERE c.config_code = ANY (v_codes)
       AND COALESCE(pi.quantity_on_hand, 0) <> 0
       -- record_stock_movement only locates active inventory rows, so an
       -- inactive one cannot be posted against. The preflight blocks on those
       -- (INACTIVE_LEGACY_INVENTORY_ROWS) rather than letting them be skipped
       -- silently here.
       AND pi.is_active
     ORDER BY o.org_code, c.config_code, pi.variant_id
     FOR UPDATE OF pi
  LOOP
    -- Belt and braces: the preflight already blocks on allocated legacy stock,
    -- but never retire a balance an order is holding.
    IF v_row.qty_allocated <> 0 THEN
      RAISE EXCEPTION
        'Refusing to retire % at %: % units are allocated to an order',
        v_row.config_code, v_row.org_code, v_row.qty_allocated;
    END IF;

    v_retired := v_retired + 1;
    v_units   := v_units + abs(v_row.qty_on_hand);

    v_lines := v_lines || jsonb_build_object(
      'org_code', v_row.org_code,
      'organization_id', v_row.organization_id,
      'variant_id', v_row.variant_id,
      'stock_config_id', v_row.stock_config_id,
      'config_code', v_row.config_code,
      'quantity_before', v_row.qty_on_hand,
      'quantity_retired', -v_row.qty_on_hand,
      'quantity_after', 0
    );

    CONTINUE WHEN p_dry_run;

    -- One negative movement per balance, on the LEGACY configuration itself.
    -- No 20NB row is touched, credited or created anywhere in this loop.
    v_movement_id := public.record_stock_movement(
      p_movement_type   => 'adjustment',
      p_variant_id      => v_row.variant_id,
      p_organization_id => v_row.organization_id,
      p_quantity_change => -v_row.qty_on_hand,
      p_unit_cost       => v_row.unit_cost,
      p_reason          => format(
        'Legacy configuration retired to zero (%s). Not converted into 20NB; true quantity to be established by physical stock count.',
        v_row.config_code),
      p_notes           => format(
        '%s; request=%s; config=%s; quantity_before=%s; quantity_after=0',
        c_reference, p_request_id, v_row.config_code, v_row.qty_on_hand),
      p_reference_type  => 'legacy_config_cutover',
      p_reference_id    => p_request_id,
      p_reference_no    => c_reference,
      p_created_by      => p_performed_by,
      p_stock_config_id => v_row.stock_config_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'request_id', p_request_id,
    'cutover_reference', c_reference,
    'dry_run', p_dry_run,
    'idempotent_replay', false,
    'config_codes', to_jsonb(v_codes),
    'snapshot_rows', v_snapshot,
    'retired_rows', v_retired,
    'retired_units', v_units,
    'performed_by', p_performed_by,
    'executed_at', now(),
    'lines', v_lines
  );
END;
$$;

COMMENT ON FUNCTION public.execute_legacy_config_cutover(uuid, boolean, uuid, text[]) IS
  'Retires 50NB / 50OB / UNCLASSIFIED balances to zero under reference LEGACY-CONFIG-CUTOVER-2026. Quantity is NOT moved into 20NB or any other configuration. Refuses to run while legacy_config_cutover_preflight() reports a blocker; idempotent on p_request_id; writes a permanent pre-cutover snapshot; posts one auditable negative movement per balance instead of updating product_inventory directly. Defaults to a dry run.';

REVOKE ALL ON FUNCTION public.execute_legacy_config_cutover(uuid, boolean, uuid, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_legacy_config_cutover(uuid, boolean, uuid, text[])
  TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Verification helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.legacy_config_cutover_verification(p_request_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'request_id', p_request_id,
    'snapshot_rows', (SELECT count(*) FROM public.legacy_config_cutover_snapshot s
                       WHERE s.request_id = p_request_id),
    'snapshot_retirement_targets', (SELECT count(*) FROM public.legacy_config_cutover_snapshot s
                                     WHERE s.request_id = p_request_id AND s.is_retirement_target),
    'snapshot_units_to_retire', (SELECT COALESCE(sum(s.quantity_on_hand), 0)
                                   FROM public.legacy_config_cutover_snapshot s
                                  WHERE s.request_id = p_request_id AND s.is_retirement_target),
    'movements_posted', (SELECT count(*) FROM public.stock_movements sm
                          WHERE sm.reference_type = 'legacy_config_cutover'
                            AND sm.reference_id = p_request_id),
    'units_retired', (SELECT COALESCE(-sum(sm.quantity_change), 0) FROM public.stock_movements sm
                       WHERE sm.reference_type = 'legacy_config_cutover'
                         AND sm.reference_id = p_request_id),
    'residual_legacy_on_hand', (
      SELECT COALESCE(jsonb_object_agg(config_code, qty), '{}'::jsonb) FROM (
        SELECT c.config_code, COALESCE(sum(pi.quantity_on_hand), 0) AS qty
          FROM public.inventory_stock_configurations c
          LEFT JOIN public.product_inventory pi ON pi.stock_config_id = c.id
         WHERE c.config_code = ANY (public.legacy_cutover_config_codes())
         GROUP BY c.config_code) r),
    'canonical_untouched', (
      SELECT COALESCE(jsonb_object_agg(config_code, qty), '{}'::jsonb) FROM (
        SELECT c.config_code, COALESCE(sum(pi.quantity_on_hand), 0) AS qty
          FROM public.inventory_stock_configurations c
          LEFT JOIN public.product_inventory pi ON pi.stock_config_id = c.id
         WHERE c.config_code IN ('20NB', 'STD')
         GROUP BY c.config_code) k)
  )
$$;

COMMENT ON FUNCTION public.legacy_config_cutover_verification(uuid) IS
  'Post-cutover reconciliation: snapshot rows vs movements posted vs units retired, residual legacy balance (must be zero) and the untouched 20NB / STD totals (must equal their pre-cutover values).';

REVOKE ALL ON FUNCTION public.legacy_config_cutover_verification(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legacy_config_cutover_verification(uuid) TO authenticated, service_role;

COMMIT;
