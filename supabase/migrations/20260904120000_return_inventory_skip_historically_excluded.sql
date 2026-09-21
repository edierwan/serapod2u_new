BEGIN;

-- ============================================================================
-- Fix: historically excluded Return Product cases must still advance workflow
-- without posting inventory through the ordinary return path.
-- ----------------------------------------------------------------------------
-- Runtime failure (main / Balakong, RRVS Shop, RET26-000004):
--   inventory_cutoff_transaction_historically_excluded: transaction
--   d8b9ae72-7eaa-4d91-abc9-fdcdddc3caa0 was excluded by a posted Opening
--   Balance and cannot post inventory through its original path.
--
-- Cause:
--   Opening Balance Transactions policy marked the return as Historical
--   Excluded and stamped inventory_cutoff_excluded_transactions. Advancing
--   Submitted → Received still calls post_return_case_inventory, which inserts
--   stock_movements and is blocked by inventory_cutoff_excluded_transaction_guard.
--   Status then rolls back, leaving the return stuck (often Overdue).
--
-- Intended contract (unchanged):
--   Excluded returns must NEVER change the post-cutoff inventory baseline.
--
-- Fix:
--   post_return_case_inventory detects a posted historical exclusion and returns
--   success with historically_excluded=true / posted_lines=0 — no stock_movements.
--   Status advance can complete; warehouse workflow continues without double stock.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.post_return_case_inventory(p_return_case_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_case public.return_cases%ROWTYPE;
  v_item public.return_case_items%ROWTYPE;
  v_qty integer;
  v_cfg uuid;
  v_movement_id uuid;
  v_posted integer := 0;
  v_skipped integer := 0;
  v_item_count integer := 0;
BEGIN
  SELECT * INTO v_case
  FROM public.return_cases
  WHERE id = p_return_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Return case % not found', p_return_case_id;
  END IF;

  IF v_case.status NOT IN ('return_received', 'return_processing', 'return_completed') THEN
    RAISE EXCEPTION 'Return inventory can only be posted at/after Return Received';
  END IF;

  IF v_case.return_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Return warehouse is required before inventory can be posted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organizations wh
    JOIN public.organizations hq ON hq.id = wh.parent_org_id
    WHERE wh.id = v_case.return_warehouse_id
      AND wh.org_type_code = 'WH'
      AND wh.is_active = true
      AND hq.org_type_code = 'HQ'
      AND hq.is_active = true
  ) THEN
    RAISE EXCEPTION 'Return warehouse must be an active HQ-managed warehouse';
  END IF;

  IF auth.role() = 'authenticated' THEN
    IF NOT (
      public.is_hq_admin()
      OR public.can_access_org(v_case.return_warehouse_id)
    ) THEN
      RAISE EXCEPTION 'Not authorized to post return inventory for this warehouse';
    END IF;
  END IF;

  -- Historical exclusion from a POSTED Opening Balance: keep audit workflow,
  -- never post inventory through the original return path.
  IF EXISTS (
    SELECT 1
    FROM public.inventory_cutoff_excluded_transactions x
    JOIN public.inventory_opening_cutoffs c ON c.id = x.cutoff_id
    WHERE x.transaction_type = 'return'
      AND x.transaction_id = p_return_case_id
      AND c.status = 'posted'
  ) THEN
    SELECT COUNT(*)::integer INTO v_item_count
    FROM public.return_case_items
    WHERE return_case_id = p_return_case_id;

    RETURN jsonb_build_object(
      'return_case_id', p_return_case_id,
      'return_no', v_case.return_no,
      'warehouse_id', v_case.return_warehouse_id,
      'posted_lines', 0,
      'skipped_lines', COALESCE(v_item_count, 0),
      'historically_excluded', true,
      'notice',
        'This return was excluded by a posted Opening Balance. Status can continue, but inventory was not changed through the original return path.'
    );
  END IF;

  FOR v_item IN
    SELECT * FROM public.return_case_items
    WHERE return_case_id = p_return_case_id
    ORDER BY id
    FOR UPDATE
  LOOP
    v_qty := GREATEST(
      0,
      COALESCE(NULLIF(v_item.total_units, 0), v_item.quantity, 0)::integer
    );
    IF v_qty <= 0 OR v_item.variant_id IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Idempotency: one Stock IN movement per return item / variant / config.
    IF EXISTS (
      SELECT 1 FROM public.stock_movements sm
      WHERE sm.reference_type = 'return'
        AND sm.reference_id = p_return_case_id
        AND sm.variant_id = v_item.variant_id
        AND sm.movement_type IN ('manual_in', 'return_in', 'transfer_in')
        AND sm.to_organization_id = v_case.return_warehouse_id
        AND sm.notes LIKE '%' || v_item.id::text || '%'
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Also treat any prior same-variant return posting without item note as posted
    -- for historical rows that may not include the item id marker.
    IF EXISTS (
      SELECT 1 FROM public.stock_movements sm
      WHERE sm.reference_type = 'return'
        AND sm.reference_id = p_return_case_id
        AND sm.variant_id = v_item.variant_id
        AND sm.to_organization_id = v_case.return_warehouse_id
        AND sm.quantity_change > 0
        AND sm.notes NOT LIKE 'return-item:%'
    ) AND NOT EXISTS (
      SELECT 1 FROM public.return_case_items other
      WHERE other.return_case_id = p_return_case_id
        AND other.variant_id = v_item.variant_id
        AND other.id <> v_item.id
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_cfg := public.resolve_default_stock_config(v_item.variant_id);
    IF v_cfg IS NULL THEN
      RAISE EXCEPTION 'No stock configuration available for returned variant %', v_item.variant_id;
    END IF;

    v_movement_id := public.record_stock_movement(
      p_movement_type := 'manual_in',
      p_variant_id := v_item.variant_id,
      p_organization_id := v_case.return_warehouse_id,
      p_quantity_change := v_qty,
      p_unit_cost := COALESCE(v_item.unit_cost, 0),
      p_reason := COALESCE(v_item.reason, 'Return Product received'),
      p_notes := format(
        'return-item:%s; Return %s received into warehouse',
        v_item.id::text,
        COALESCE(v_case.return_no, p_return_case_id::text)
      ),
      p_reference_type := 'return',
      p_reference_id := p_return_case_id,
      p_reference_no := v_case.return_no,
      p_created_by := COALESCE(auth.uid(), v_case.created_by),
      p_stock_config_id := v_cfg
    );

    v_posted := v_posted + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'return_case_id', p_return_case_id,
    'return_no', v_case.return_no,
    'warehouse_id', v_case.return_warehouse_id,
    'posted_lines', v_posted,
    'skipped_lines', v_skipped,
    'historically_excluded', false
  );
END;
$$;

COMMENT ON FUNCTION public.post_return_case_inventory(uuid) IS
  'Posts Stock IN to the selected return warehouse once at Return Received. Idempotent; skips inventory (no stock movement) when the return was historically excluded by a posted Opening Balance; does not post during Draft/Submitted.';

NOTIFY pgrst, 'reload schema';

COMMIT;
