-- ============================================================================
-- Atomic Product Variant archive
-- ----------------------------------------------------------------------------
-- Install manually before deploying the matching Master Data UI.
-- This migration does not alter Stock Count snapshots, inventory balances,
-- movements, sessions, order history, or any other historical rows.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.archive_product_variant(p_variant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_was_active boolean;
  v_variant_rows integer := 0;
  v_configurations_archived integer := 0;
  v_remaining_operational integer := 0;
  v_variant_is_active boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- This RPC bypasses table RLS in order to make both writes atomic, so enforce
  -- the same HQ-admin boundary used by the stock-configuration management RLS.
  IF NOT public.is_hq_admin() THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  IF p_variant_id IS NULL THEN
    RAISE EXCEPTION 'variant_not_found';
  END IF;

  SELECT pv.is_active
  INTO v_was_active
  FROM public.product_variants AS pv
  WHERE pv.id = p_variant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'variant_not_found';
  END IF;

  UPDATE public.product_variants
  SET is_active = false,
      updated_at = now()
  WHERE id = p_variant_id
    AND is_active IS DISTINCT FROM false;

  GET DIAGNOSTICS v_variant_rows = ROW_COUNT;

  -- If the row was active, exactly one variant row must have changed. This
  -- catches trigger/policy behavior that silently suppresses a mutation.
  IF v_was_active IS DISTINCT FROM false AND v_variant_rows <> 1 THEN
    RAISE EXCEPTION 'variant_archive_failed';
  END IF;

  UPDATE public.inventory_stock_configurations
  SET status = 'inactive',
      updated_at = now()
  WHERE variant_id = p_variant_id
    AND status IN ('active', 'phase_out');

  GET DIAGNOSTICS v_configurations_archived = ROW_COUNT;

  SELECT pv.is_active
  INTO v_variant_is_active
  FROM public.product_variants AS pv
  WHERE pv.id = p_variant_id;

  SELECT count(*)::integer
  INTO v_remaining_operational
  FROM public.inventory_stock_configurations AS isc
  WHERE isc.variant_id = p_variant_id
    AND isc.status IN ('active', 'phase_out');

  -- Raising from the function rolls back both UPDATE statements. A caller can
  -- therefore never receive success for a partial archive.
  IF v_variant_is_active IS DISTINCT FROM false
     OR v_remaining_operational <> 0 THEN
    RAISE EXCEPTION 'variant_archive_incomplete';
  END IF;

  RETURN jsonb_build_object(
    'status', 'archived',
    'variant_id', p_variant_id,
    'variant_is_active', v_variant_is_active,
    'configurations_archived', v_configurations_archived,
    'remaining_operational_configurations', v_remaining_operational,
    'already_archived', v_was_active IS NOT DISTINCT FROM false
  );
END;
$$;

COMMENT ON FUNCTION public.archive_product_variant(uuid) IS
  'Atomically soft-archives one Product Variant and changes only its active/phase_out stock configurations to inactive. Preserves every historical and snapshot row.';

REVOKE ALL ON FUNCTION public.archive_product_variant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_product_variant(uuid) TO authenticated;

COMMIT;
