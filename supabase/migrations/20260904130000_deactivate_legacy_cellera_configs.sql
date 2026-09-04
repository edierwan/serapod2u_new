-- ============================================================================
-- Legacy configuration cutover — Phase 4: deactivate the retired codes
-- ----------------------------------------------------------------------------
-- Runs only AFTER the cutover has zeroed the balances. It is deliberately a
-- guarded function rather than a bare UPDATE: applying this migration installs
-- the function but changes no configuration row, so the migration is safe to
-- ship ahead of the cutover window.
--
-- Preconditions, all enforced at call time:
--   * 50NB balance          = 0 in every organization
--   * UNCLASSIFIED balance  = 0 in every organization
--   * 50OB balance          = 0 in every organization
--   * no movement posted into any legacy configuration inside the writer window
--   * legacy_config_cutover_preflight() reports no blocker
--
-- Configuration ROWS ARE NEVER DELETED. status becomes 'inactive' so that
-- Movement Reports, historical Stock Count sessions and every audit drill-down
-- keep resolving the old labels forever.
--
-- 20NB remains the Cellera canonical operational configuration.
-- STD  remains the non-vape canonical operational configuration.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.deactivate_legacy_stock_configs(
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_codes      text[] := public.legacy_cutover_config_codes();
  v_residual   jsonb;
  v_writers    integer;
  v_preflight  jsonb;
  v_affected   integer := 0;
  v_rows       jsonb;
BEGIN
  -- --- Precondition 1: every legacy balance is zero ------------------------
  SELECT jsonb_object_agg(config_code, qty)
    INTO v_residual
    FROM (
      SELECT c.config_code, COALESCE(sum(pi.quantity_on_hand), 0)
             + COALESCE(sum(pi.quantity_allocated), 0) AS qty
        FROM public.inventory_stock_configurations c
        LEFT JOIN public.product_inventory pi ON pi.stock_config_id = c.id
       WHERE c.config_code = ANY (v_codes)
       GROUP BY c.config_code
       HAVING COALESCE(sum(pi.quantity_on_hand), 0)
            + COALESCE(sum(pi.quantity_allocated), 0) <> 0
    ) r;

  IF v_residual IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to deactivate: legacy configurations still carry stock (%). Run execute_legacy_config_cutover() first.',
      v_residual::text
      USING ERRCODE = 'raise_exception';
  END IF;

  -- --- Precondition 2: no live writer --------------------------------------
  -- Any movement into a legacy configuration since the cutover means something
  -- is still resolving there and the balance would re-grow behind an inactive
  -- status. Cutover retirement movements themselves are excluded.
  SELECT count(*)
    INTO v_writers
    FROM public.stock_movements sm
    JOIN public.inventory_stock_configurations c ON c.id = sm.stock_config_id
   WHERE c.config_code = ANY (v_codes)
     AND sm.reference_type <> 'legacy_config_cutover'
     AND sm.created_at > now() - interval '7 days';

  IF v_writers > 0 THEN
    RAISE EXCEPTION
      'Refusing to deactivate: % non-cutover movement(s) posted into a legacy configuration in the last 7 days. Eliminate the writer first.',
      v_writers
      USING ERRCODE = 'raise_exception';
  END IF;

  -- --- Precondition 3: preflight is clean ----------------------------------
  v_preflight := public.legacy_config_cutover_preflight();
  IF NOT (v_preflight->>'ok')::boolean THEN
    RAISE EXCEPTION
      'Refusing to deactivate: % blocking preflight condition(s) remain.',
      v_preflight->>'blocking_count'
      USING DETAIL = v_preflight->>'blockers';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'stock_config_id', c.id,
           'variant_id', c.variant_id,
           'config_code', c.config_code,
           'status_before', c.status,
           'status_after', 'inactive')
         ORDER BY c.config_code)
    INTO v_rows
    FROM public.inventory_stock_configurations c
   WHERE c.config_code = ANY (v_codes)
     AND c.status <> 'inactive';

  IF NOT p_dry_run THEN
    UPDATE public.inventory_stock_configurations
       SET status = 'inactive',
           updated_at = now()
     WHERE config_code = ANY (v_codes)
       AND status <> 'inactive';
    GET DIAGNOSTICS v_affected = ROW_COUNT;
  ELSE
    v_affected := COALESCE(jsonb_array_length(v_rows), 0);
  END IF;

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'config_codes', to_jsonb(v_codes),
    'deactivated', v_affected,
    'rows_deleted', 0,
    'canonical_untouched', jsonb_build_object(
      'cellera', '20NB', 'non_vape', 'STD'),
    'detail', COALESCE(v_rows, '[]'::jsonb),
    'executed_at', now()
  );
END;
$$;

COMMENT ON FUNCTION public.deactivate_legacy_stock_configs(boolean) IS
  'Phase 4 of LEGACY-CONFIG-CUTOVER-2026: sets 50NB / 50OB / UNCLASSIFIED to status inactive once every balance is zero, no writer remains and preflight is clean. Never deletes a configuration row — historical reports and movement audit resolve their labels through these rows permanently. Defaults to a dry run.';

REVOKE ALL ON FUNCTION public.deactivate_legacy_stock_configs(boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_legacy_stock_configs(boolean) TO service_role;

COMMIT;
