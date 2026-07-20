-- ============================================================================
-- HQ Warehouse Inventory Flow — Return Product inventory posting
-- ----------------------------------------------------------------------------
-- Posts Stock IN to the selected return warehouse exactly once when a return
-- reaches return_received. Draft/Submitted never post inventory.
-- Idempotent against retries / double-clicks.
-- ----------------------------------------------------------------------------

BEGIN;

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
    'skipped_lines', v_skipped
  );
END;
$$;

COMMENT ON FUNCTION public.post_return_case_inventory(uuid) IS
  'Posts Stock IN to the selected return warehouse once at Return Received. Idempotent; does not post during Draft/Submitted.';

CREATE OR REPLACE FUNCTION public.return_cases_lock_warehouse_after_receipt()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.return_warehouse_id IS DISTINCT FROM NEW.return_warehouse_id
     AND OLD.status IS DISTINCT FROM 'return_draft'
     AND OLD.status IS DISTINCT FROM 'return_submitted' THEN
    RAISE EXCEPTION 'Return warehouse cannot be changed after inventory receipt/posting has started';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_return_cases_lock_warehouse_after_receipt ON public.return_cases;
CREATE TRIGGER trg_return_cases_lock_warehouse_after_receipt
  BEFORE UPDATE OF return_warehouse_id, status
  ON public.return_cases
  FOR EACH ROW
  EXECUTE FUNCTION public.return_cases_lock_warehouse_after_receipt();

REVOKE ALL ON FUNCTION public.post_return_case_inventory(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_return_case_inventory(uuid) TO authenticated, service_role;

COMMIT;
