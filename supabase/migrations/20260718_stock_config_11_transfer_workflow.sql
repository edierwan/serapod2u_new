-- ============================================================================
-- Inventory Stock Configurations — Phase 8 follow-up (11):
-- Controlled Stock Transfer workflow
-- ----------------------------------------------------------------------------
-- Migrations 01-10 are immutable. This forward-only migration:
--   * Extends stock_transfers status for Draft → Pending Approval →
--     Ready to Dispatch (in_transit) → Received, plus reject/cancel.
--   * Adds required_date / submit / approve / reject audit columns.
--   * Introduces SECURITY DEFINER RPCs for draft, submit (reserve),
--     approve (source transfer_out once), receive (destination transfer_in
--     once), and cancel/reject with safe reservation / deduction release.
--   * Does not rewrite historical transfers or movement rows.
--   * Leaves post_stock_transfer_configured unchanged for compatibility.
--
-- Stock timing (authoritative):
--   draft            : editable; no reservation; no ledger movement
--   pending_approval : source quantity_allocated reserved; no on_hand change
--   in_transit       : reservation released; transfer_out posted once (Ready
--                      to Dispatch). Destination On Hand unchanged until receive.
--   received         : transfer_in posted once at destination
--   cancelled/rejected: reservations released; in_transit cancel restores
--                      source via transfer_in to source when dest not posted
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Schema: columns + status check
-- ---------------------------------------------------------------------------
ALTER TABLE public.stock_transfers
  ADD COLUMN IF NOT EXISTS required_date date,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS rejection_reason text;

ALTER TABLE public.stock_transfers
  DROP CONSTRAINT IF EXISTS stock_transfers_status_check;

ALTER TABLE public.stock_transfers
  ADD CONSTRAINT stock_transfers_status_check CHECK (
    status = ANY (ARRAY[
      'draft'::text,
      'pending'::text,
      'pending_approval'::text,
      'in_transit'::text,
      'received'::text,
      'cancelled'::text,
      'rejected'::text
    ])
  );

COMMENT ON COLUMN public.stock_transfers.required_date IS
  'Optional expected / required transfer date (UI Required Date).';
COMMENT ON COLUMN public.stock_transfers.status IS
  'Lifecycle: draft → pending_approval → in_transit (Ready to Dispatch) → received. Terminal: cancelled, rejected. Legacy pending retained for historical rows.';

-- ---------------------------------------------------------------------------
-- 2. Item validation / normalisation helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._stock_transfer_normalize_items(p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item jsonb;
  v_variant uuid;
  v_cfg uuid;
  v_qty numeric;
  v_qty_int integer;
  v_cost numeric;
  v_map jsonb := '{}'::jsonb;
  v_key text;
  v_existing jsonb;
  v_cfg_row public.inventory_stock_configurations%ROWTYPE;
  v_out jsonb := '[]'::jsonb;
  v_merged jsonb;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Transfer items are required';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    BEGIN
      v_variant := (v_item->>'variant_id')::uuid;
      v_cfg := (v_item->>'stock_config_id')::uuid;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'Invalid variant/configuration transfer line';
    END;

    IF v_variant IS NULL OR v_cfg IS NULL THEN
      RAISE EXCEPTION 'Every transfer line requires variant_id and stock_config_id';
    END IF;

    v_qty := NULLIF(v_item->>'quantity', '')::numeric;
    IF v_qty IS NULL OR v_qty <> trunc(v_qty) OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Transfer quantities must be positive whole numbers';
    END IF;
    v_qty_int := v_qty::integer;

    SELECT * INTO v_cfg_row
      FROM public.inventory_stock_configurations c
     WHERE c.id = v_cfg
       AND c.variant_id = v_variant;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid variant/configuration transfer line';
    END IF;
    IF v_cfg_row.status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'Only active stock configurations can be transferred';
    END IF;
    IF v_cfg_row.config_code = 'UNCLASSIFIED' OR v_cfg_row.config_code ILIKE '%LEGACY%' THEN
      RAISE EXCEPTION 'Legacy/Unclassified stock cannot be transferred through the normal flow';
    END IF;

    v_cost := NULLIF(v_item->>'cost', '')::numeric;
    v_key := v_variant::text || ':' || v_cfg::text;
    v_existing := v_map -> v_key;

    IF v_existing IS NULL THEN
      v_map := v_map || jsonb_build_object(
        v_key,
        jsonb_build_object(
          'variant_id', v_variant,
          'stock_config_id', v_cfg,
          'quantity', v_qty_int,
          'cost', v_cost,
          'variant_name', COALESCE(v_item->>'variant_name', ''),
          'product_name', COALESCE(v_item->>'product_name', ''),
          'product_code', COALESCE(v_item->>'product_code', ''),
          'stock_sku', COALESCE(NULLIF(v_item->>'stock_sku', ''), v_cfg_row.stock_sku),
          'config_label', COALESCE(NULLIF(v_item->>'config_label', ''), v_cfg_row.config_label),
          'volume_ml', v_cfg_row.volume_ml,
          'packaging', v_cfg_row.packaging
        )
      );
    ELSE
      v_map := v_map || jsonb_build_object(
        v_key,
        v_existing || jsonb_build_object(
          'quantity', (v_existing->>'quantity')::integer + v_qty_int,
          'cost', COALESCE(v_cost, NULLIF(v_existing->>'cost', '')::numeric)
        )
      );
    END IF;
  END LOOP;

  FOR v_merged IN SELECT value FROM jsonb_each(v_map) LOOP
    v_out := v_out || jsonb_build_array(v_merged);
  END LOOP;

  IF jsonb_array_length(v_out) = 0 THEN
    RAISE EXCEPTION 'Transfer items are required';
  END IF;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public._stock_transfer_normalize_items(jsonb) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Shared auth + totals helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._stock_transfer_assert_route_access(
  p_from uuid,
  p_to uuid
) RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from = p_to THEN
    RAISE EXCEPTION 'Distinct source and destination warehouses are required';
  END IF;
  IF NOT (
    public.is_hq_admin()
    OR (public.can_access_org(p_from) AND public.can_access_org(p_to))
  ) THEN
    RAISE EXCEPTION 'Not authorized for transfer organizations';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._stock_transfer_assert_route_access(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._stock_transfer_totals(p_items jsonb)
RETURNS TABLE(total_items integer, total_value numeric)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(SUM((item->>'quantity')::integer), 0)::integer,
         COALESCE(SUM((item->>'quantity')::integer * COALESCE(NULLIF(item->>'cost', '')::numeric, 0)), 0)
    FROM jsonb_array_elements(p_items) item;
$$;

REVOKE ALL ON FUNCTION public._stock_transfer_totals(jsonb) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Reservation helpers (quantity_allocated + allocation/deallocation ledger)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._stock_transfer_reserve_items(
  p_transfer public.stock_transfers
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item jsonb;
  v_variant uuid;
  v_cfg uuid;
  v_qty integer;
  v_cost numeric;
  v_on integer;
  v_alloc integer;
BEGIN
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_transfer.items) LOOP
    v_variant := (v_item->>'variant_id')::uuid;
    v_cfg := (v_item->>'stock_config_id')::uuid;
    v_qty := (v_item->>'quantity')::integer;
    v_cost := COALESCE(NULLIF(v_item->>'cost', '')::numeric, 0);

    IF EXISTS (
      SELECT 1 FROM public.stock_movements sm
       WHERE sm.reference_type = 'transfer'
         AND sm.reference_id = p_transfer.id
         AND sm.movement_type = 'allocation'
         AND sm.variant_id = v_variant
         AND sm.stock_config_id = v_cfg
    ) THEN
      CONTINUE;
    END IF;

    SELECT quantity_on_hand, quantity_allocated
      INTO v_on, v_alloc
      FROM public.product_inventory
     WHERE organization_id = p_transfer.from_organization_id
       AND variant_id = v_variant
       AND stock_config_id = v_cfg
       AND is_active = true
     FOR UPDATE;

    IF NOT FOUND OR COALESCE(v_on, 0) - COALESCE(v_alloc, 0) < v_qty THEN
      RAISE EXCEPTION 'Insufficient available stock for configuration % (need %, available %)',
        v_cfg, v_qty, GREATEST(COALESCE(v_on, 0) - COALESCE(v_alloc, 0), 0);
    END IF;

    UPDATE public.product_inventory
       SET quantity_allocated = quantity_allocated + v_qty,
           updated_at = now()
     WHERE organization_id = p_transfer.from_organization_id
       AND variant_id = v_variant
       AND stock_config_id = v_cfg;

    INSERT INTO public.stock_movements (
      movement_type, reference_type, reference_id, reference_no, variant_id, stock_config_id,
      from_organization_id, to_organization_id, quantity_change, quantity_before, quantity_after,
      unit_cost, company_id, created_by, notes
    ) VALUES (
      'allocation', 'transfer', p_transfer.id, p_transfer.transfer_no, v_variant, v_cfg,
      p_transfer.from_organization_id, p_transfer.to_organization_id, v_qty, 0, v_qty,
      v_cost, p_transfer.company_id, COALESCE(auth.uid(), p_transfer.created_by),
      'Transfer reservation pending approval'
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public._stock_transfer_reserve_items(public.stock_transfers) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._stock_transfer_release_reservations(
  p_transfer public.stock_transfers
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item jsonb;
  v_variant uuid;
  v_cfg uuid;
  v_qty integer;
  v_cost numeric;
  v_alloc integer;
BEGIN
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_transfer.items) LOOP
    v_variant := (v_item->>'variant_id')::uuid;
    v_cfg := (v_item->>'stock_config_id')::uuid;
    v_qty := (v_item->>'quantity')::integer;
    v_cost := COALESCE(NULLIF(v_item->>'cost', '')::numeric, 0);

    IF NOT EXISTS (
      SELECT 1 FROM public.stock_movements sm
       WHERE sm.reference_type = 'transfer'
         AND sm.reference_id = p_transfer.id
         AND sm.movement_type = 'allocation'
         AND sm.variant_id = v_variant
         AND sm.stock_config_id = v_cfg
    ) THEN
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.stock_movements sm
       WHERE sm.reference_type = 'transfer'
         AND sm.reference_id = p_transfer.id
         AND sm.movement_type = 'deallocation'
         AND sm.variant_id = v_variant
         AND sm.stock_config_id = v_cfg
    ) THEN
      CONTINUE;
    END IF;

    SELECT quantity_allocated INTO v_alloc
      FROM public.product_inventory
     WHERE organization_id = p_transfer.from_organization_id
       AND variant_id = v_variant
       AND stock_config_id = v_cfg
     FOR UPDATE;

    IF NOT FOUND OR COALESCE(v_alloc, 0) < v_qty THEN
      RAISE EXCEPTION 'Cannot safely release transfer reservation for configuration %', v_cfg;
    END IF;

    UPDATE public.product_inventory
       SET quantity_allocated = quantity_allocated - v_qty,
           updated_at = now()
     WHERE organization_id = p_transfer.from_organization_id
       AND variant_id = v_variant
       AND stock_config_id = v_cfg;

    INSERT INTO public.stock_movements (
      movement_type, reference_type, reference_id, reference_no, variant_id, stock_config_id,
      from_organization_id, to_organization_id, quantity_change, quantity_before, quantity_after,
      unit_cost, company_id, created_by, notes
    ) VALUES (
      'deallocation', 'transfer', p_transfer.id, p_transfer.transfer_no, v_variant, v_cfg,
      p_transfer.to_organization_id, p_transfer.from_organization_id, -v_qty, v_qty, 0,
      v_cost, p_transfer.company_id, COALESCE(auth.uid(), p_transfer.created_by),
      'Transfer reservation released'
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public._stock_transfer_release_reservations(public.stock_transfers) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. save_stock_transfer_draft
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_stock_transfer_draft(
  p_company_id uuid,
  p_from_organization_id uuid,
  p_to_organization_id uuid,
  p_items jsonb,
  p_notes text DEFAULT NULL,
  p_required_date date DEFAULT NULL,
  p_transfer_id uuid DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
)
RETURNS public.stock_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := COALESCE(auth.uid(), p_created_by);
  v_items jsonb;
  v_totals record;
  v_transfer public.stock_transfers;
  v_transfer_no text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authenticated actor is required';
  END IF;
  IF auth.role() = 'authenticated' AND p_created_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'created_by must match the authenticated user';
  END IF;

  PERFORM public._stock_transfer_assert_route_access(p_from_organization_id, p_to_organization_id);
  v_items := public._stock_transfer_normalize_items(p_items);
  SELECT * INTO v_totals FROM public._stock_transfer_totals(v_items);

  IF p_transfer_id IS NULL THEN
    v_transfer_no := public.generate_transfer_number();
    INSERT INTO public.stock_transfers (
      transfer_no, from_organization_id, to_organization_id, status, items,
      total_items, total_value, notes, company_id, created_by, required_date
    ) VALUES (
      v_transfer_no, p_from_organization_id, p_to_organization_id, 'draft', v_items,
      v_totals.total_items, v_totals.total_value, NULLIF(btrim(p_notes), ''), p_company_id, v_actor, p_required_date
    ) RETURNING * INTO v_transfer;
    RETURN v_transfer;
  END IF;

  SELECT * INTO v_transfer
    FROM public.stock_transfers
   WHERE id = p_transfer_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer not found';
  END IF;
  IF v_transfer.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Only draft transfers can be edited';
  END IF;
  IF NOT (
    public.is_hq_admin()
    OR v_transfer.created_by = v_actor
    OR (public.can_access_org(v_transfer.from_organization_id) AND public.can_access_org(v_transfer.to_organization_id))
  ) THEN
    RAISE EXCEPTION 'Not authorized to edit this draft';
  END IF;

  UPDATE public.stock_transfers
     SET from_organization_id = p_from_organization_id,
         to_organization_id = p_to_organization_id,
         items = v_items,
         total_items = v_totals.total_items,
         total_value = v_totals.total_value,
         notes = NULLIF(btrim(p_notes), ''),
         required_date = p_required_date,
         updated_at = now()
   WHERE id = p_transfer_id
   RETURNING * INTO v_transfer;

  RETURN v_transfer;
END;
$$;

REVOKE ALL ON FUNCTION public.save_stock_transfer_draft(uuid, uuid, uuid, jsonb, text, date, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_stock_transfer_draft(uuid, uuid, uuid, jsonb, text, date, uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.save_stock_transfer_draft(uuid, uuid, uuid, jsonb, text, date, uuid, uuid) IS
  'Create or update a draft stock transfer. No reservation and no ledger movement.';

-- ---------------------------------------------------------------------------
-- 6. submit_stock_transfer_for_approval
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_stock_transfer_for_approval(
  p_transfer_id uuid,
  p_actor_id uuid DEFAULT NULL
)
RETURNS public.stock_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := COALESCE(auth.uid(), p_actor_id);
  v_transfer public.stock_transfers;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authenticated actor is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('stock-transfer:' || p_transfer_id::text, 0));

  SELECT * INTO v_transfer FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found'; END IF;

  IF v_transfer.status = 'pending_approval' THEN
    RETURN v_transfer;
  END IF;
  IF v_transfer.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Only draft transfers can be submitted for approval';
  END IF;

  PERFORM public._stock_transfer_assert_route_access(
    v_transfer.from_organization_id, v_transfer.to_organization_id
  );
  IF NOT (
    public.is_hq_admin()
    OR v_transfer.created_by = v_actor
  ) THEN
    RAISE EXCEPTION 'Not authorized to submit this transfer';
  END IF;

  v_transfer.items := public._stock_transfer_normalize_items(v_transfer.items);
  PERFORM public._stock_transfer_reserve_items(v_transfer);

  UPDATE public.stock_transfers
     SET status = 'pending_approval',
         items = v_transfer.items,
         submitted_at = COALESCE(submitted_at, now()),
         updated_at = now()
   WHERE id = p_transfer_id
   RETURNING * INTO v_transfer;

  RETURN v_transfer;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_stock_transfer_for_approval(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_stock_transfer_for_approval(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.submit_stock_transfer_for_approval(uuid, uuid) IS
  'Submit a draft for approval and reserve source available stock via quantity_allocated. No on_hand deduction.';

-- ---------------------------------------------------------------------------
-- 7. approve_stock_transfer (Ready to Dispatch / in_transit)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_stock_transfer(
  p_transfer_id uuid,
  p_actor_id uuid DEFAULT NULL
)
RETURNS public.stock_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := COALESCE(auth.uid(), p_actor_id);
  v_transfer public.stock_transfers;
  v_item jsonb;
  v_variant uuid;
  v_cfg uuid;
  v_qty integer;
  v_cost numeric;
  v_out_count integer;
  v_available integer;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authenticated actor is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('stock-transfer:' || p_transfer_id::text, 0));

  SELECT * INTO v_transfer FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found'; END IF;

  SELECT count(*) INTO v_out_count
    FROM public.stock_movements sm
   WHERE sm.reference_type = 'transfer'
     AND sm.reference_id = p_transfer_id
     AND sm.movement_type = 'transfer_out';

  IF v_transfer.status = 'in_transit' AND v_out_count > 0 THEN
    RETURN v_transfer;
  END IF;

  IF v_transfer.status IS DISTINCT FROM 'pending_approval' THEN
    RAISE EXCEPTION 'Only pending-approval transfers can be approved';
  END IF;

  -- HQ inventory approval: role level <= 10 (is_hq_admin). No silent bypass for others.
  IF NOT public.is_hq_admin() THEN
    RAISE EXCEPTION 'Unauthorized approval: HQ inventory approval authority is required';
  END IF;

  PERFORM public._stock_transfer_release_reservations(v_transfer);

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_transfer.items) LOOP
    v_variant := (v_item->>'variant_id')::uuid;
    v_cfg := (v_item->>'stock_config_id')::uuid;
    v_qty := (v_item->>'quantity')::integer;
    v_cost := NULLIF(v_item->>'cost', '')::numeric;

    IF EXISTS (
      SELECT 1 FROM public.stock_movements sm
       WHERE sm.reference_type = 'transfer'
         AND sm.reference_id = p_transfer_id
         AND sm.movement_type = 'transfer_out'
         AND sm.variant_id = v_variant
         AND sm.stock_config_id IS NOT DISTINCT FROM v_cfg
    ) THEN
      CONTINUE;
    END IF;

    -- Revalidate available after reservation release (on_hand - allocated).
    SELECT quantity_available INTO v_available
      FROM public.product_inventory
     WHERE organization_id = v_transfer.from_organization_id
       AND variant_id = v_variant
       AND stock_config_id = v_cfg
       AND is_active = true
     FOR UPDATE;
    IF COALESCE(v_available, 0) < v_qty THEN
      RAISE EXCEPTION 'Insufficient available stock at approval for configuration %', v_cfg;
    END IF;

    PERFORM public.record_stock_movement(
      p_movement_type := 'transfer_out',
      p_variant_id := v_variant,
      p_organization_id := v_transfer.from_organization_id,
      p_quantity_change := -v_qty,
      p_unit_cost := v_cost,
      p_reason := 'Approved warehouse transfer out',
      p_notes := v_transfer.notes,
      p_reference_type := 'transfer',
      p_reference_id := v_transfer.id,
      p_reference_no := v_transfer.transfer_no,
      p_company_id := v_transfer.company_id,
      p_created_by := v_actor,
      p_stock_config_id := v_cfg
    );
  END LOOP;

  UPDATE public.stock_transfers
     SET status = 'in_transit',
         approved_by = v_actor,
         approved_at = COALESCE(approved_at, now()),
         shipped_at = COALESCE(shipped_at, now()),
         updated_at = now()
   WHERE id = p_transfer_id
   RETURNING * INTO v_transfer;

  RETURN v_transfer;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_stock_transfer(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_stock_transfer(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.approve_stock_transfer(uuid, uuid) IS
  'HQ approval: release reservation and post source transfer_out exactly once. Status becomes in_transit (Ready to Dispatch). Destination stock is not posted.';

-- ---------------------------------------------------------------------------
-- 8. receive_stock_transfer
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.receive_stock_transfer(
  p_transfer_id uuid,
  p_actor_id uuid DEFAULT NULL
)
RETURNS public.stock_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := COALESCE(auth.uid(), p_actor_id);
  v_transfer public.stock_transfers;
  v_item jsonb;
  v_variant uuid;
  v_cfg uuid;
  v_qty integer;
  v_cost numeric;
  v_in_count integer;
  v_expected integer;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authenticated actor is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('stock-transfer:' || p_transfer_id::text, 0));

  SELECT * INTO v_transfer FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found'; END IF;

  IF v_transfer.status = 'received' THEN
    RETURN v_transfer;
  END IF;

  IF v_transfer.status IS DISTINCT FROM 'in_transit' THEN
    RAISE EXCEPTION 'Only ready-to-dispatch (in_transit) transfers can be received';
  END IF;

  IF NOT (
    public.is_hq_admin()
    OR public.can_access_org(v_transfer.to_organization_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized to receive this transfer';
  END IF;

  SELECT count(*) INTO v_expected FROM jsonb_array_elements(v_transfer.items);
  SELECT count(*) INTO v_in_count
    FROM public.stock_movements sm
   WHERE sm.reference_type = 'transfer'
     AND sm.reference_id = p_transfer_id
     AND sm.movement_type = 'transfer_in'
     AND sm.to_organization_id = v_transfer.to_organization_id;

  -- Historical creates already posted destination transfer_in; mark received without double-post.
  IF v_in_count >= v_expected AND v_expected > 0 THEN
    UPDATE public.stock_transfers
       SET status = 'received',
           received_by = COALESCE(received_by, v_actor),
           received_at = COALESCE(received_at, now()),
           updated_at = now()
     WHERE id = p_transfer_id
     RETURNING * INTO v_transfer;
    RETURN v_transfer;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_transfer.items) LOOP
    v_variant := (v_item->>'variant_id')::uuid;
    v_cfg := (v_item->>'stock_config_id')::uuid;
    v_qty := (v_item->>'quantity')::integer;
    v_cost := NULLIF(v_item->>'cost', '')::numeric;

    IF v_cfg IS NULL THEN
      RAISE EXCEPTION 'Historical unclassified transfer lines cannot be received through the normal flow';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.stock_movements sm
       WHERE sm.reference_type = 'transfer'
         AND sm.reference_id = p_transfer_id
         AND sm.movement_type = 'transfer_in'
         AND sm.to_organization_id = v_transfer.to_organization_id
         AND sm.variant_id = v_variant
         AND sm.stock_config_id IS NOT DISTINCT FROM v_cfg
    ) THEN
      CONTINUE;
    END IF;

    PERFORM public.record_stock_movement(
      p_movement_type := 'transfer_in',
      p_variant_id := v_variant,
      p_organization_id := v_transfer.to_organization_id,
      p_quantity_change := v_qty,
      p_unit_cost := v_cost,
      p_reason := 'Warehouse transfer received',
      p_notes := v_transfer.notes,
      p_reference_type := 'transfer',
      p_reference_id := v_transfer.id,
      p_reference_no := v_transfer.transfer_no,
      p_company_id := v_transfer.company_id,
      p_created_by := v_actor,
      p_stock_config_id := v_cfg
    );
  END LOOP;

  UPDATE public.stock_transfers
     SET status = 'received',
         received_by = v_actor,
         received_at = COALESCE(received_at, now()),
         updated_at = now()
   WHERE id = p_transfer_id
   RETURNING * INTO v_transfer;

  RETURN v_transfer;
END;
$$;

REVOKE ALL ON FUNCTION public.receive_stock_transfer(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_stock_transfer(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.receive_stock_transfer(uuid, uuid) IS
  'Destination receipt: post transfer_in exactly once per configuration line, or mark received when historical destination post already exists.';

-- ---------------------------------------------------------------------------
-- 9. cancel / reject
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_stock_transfer(
  p_transfer_id uuid,
  p_actor_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS public.stock_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := COALESCE(auth.uid(), p_actor_id);
  v_transfer public.stock_transfers;
  v_item jsonb;
  v_variant uuid;
  v_cfg uuid;
  v_qty integer;
  v_cost numeric;
  v_dest_posted boolean;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authenticated actor is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('stock-transfer:' || p_transfer_id::text, 0));

  SELECT * INTO v_transfer FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found'; END IF;

  IF v_transfer.status IN ('cancelled', 'rejected', 'received') THEN
    RETURN v_transfer;
  END IF;

  IF NOT (
    public.is_hq_admin()
    OR v_transfer.created_by = v_actor
    OR public.can_access_org(v_transfer.from_organization_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized to cancel this transfer';
  END IF;

  IF v_transfer.status = 'draft' THEN
    UPDATE public.stock_transfers
       SET status = 'cancelled',
           cancelled_at = COALESCE(cancelled_at, now()),
           notes = CASE
             WHEN NULLIF(btrim(p_reason), '') IS NULL THEN notes
             ELSE trim(both FROM coalesce(notes, '') || E'\nCancel: ' || btrim(p_reason))
           END,
           updated_at = now()
     WHERE id = p_transfer_id
     RETURNING * INTO v_transfer;
    RETURN v_transfer;
  END IF;

  IF v_transfer.status = 'pending_approval' THEN
    PERFORM public._stock_transfer_release_reservations(v_transfer);
    UPDATE public.stock_transfers
       SET status = 'cancelled',
           cancelled_at = COALESCE(cancelled_at, now()),
           notes = CASE
             WHEN NULLIF(btrim(p_reason), '') IS NULL THEN notes
             ELSE trim(both FROM coalesce(notes, '') || E'\nCancel: ' || btrim(p_reason))
           END,
           updated_at = now()
     WHERE id = p_transfer_id
     RETURNING * INTO v_transfer;
    RETURN v_transfer;
  END IF;

  IF v_transfer.status = 'in_transit' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.stock_movements sm
       WHERE sm.reference_type = 'transfer'
         AND sm.reference_id = p_transfer_id
         AND sm.movement_type = 'transfer_in'
         AND sm.to_organization_id = v_transfer.to_organization_id
    ) INTO v_dest_posted;

    IF v_dest_posted THEN
      RAISE EXCEPTION 'Cannot cancel a transfer after destination stock has been posted; use receive or a controlled reversal process';
    END IF;

    FOR v_item IN SELECT value FROM jsonb_array_elements(v_transfer.items) LOOP
      v_variant := (v_item->>'variant_id')::uuid;
      v_cfg := (v_item->>'stock_config_id')::uuid;
      v_qty := (v_item->>'quantity')::integer;
      v_cost := NULLIF(v_item->>'cost', '')::numeric;

      IF EXISTS (
        SELECT 1 FROM public.stock_movements sm
         WHERE sm.reference_type = 'transfer'
           AND sm.reference_id = p_transfer_id
           AND sm.movement_type = 'transfer_in'
           AND sm.to_organization_id = v_transfer.from_organization_id
           AND sm.variant_id = v_variant
           AND sm.stock_config_id IS NOT DISTINCT FROM v_cfg
           AND sm.notes ILIKE '%cancel%'
      ) THEN
        CONTINUE;
      END IF;

      -- Restore source on_hand exactly once (destination never received).
      PERFORM public.record_stock_movement(
        p_movement_type := 'transfer_in',
        p_variant_id := v_variant,
        p_organization_id := v_transfer.from_organization_id,
        p_quantity_change := v_qty,
        p_unit_cost := v_cost,
        p_reason := 'Transfer cancelled — source restored',
        p_notes := COALESCE(NULLIF(btrim(p_reason), ''), 'Transfer cancelled'),
        p_reference_type := 'transfer',
        p_reference_id := v_transfer.id,
        p_reference_no := v_transfer.transfer_no,
        p_company_id := v_transfer.company_id,
        p_created_by := v_actor,
        p_stock_config_id := v_cfg
      );
    END LOOP;

    UPDATE public.stock_transfers
       SET status = 'cancelled',
           cancelled_at = COALESCE(cancelled_at, now()),
           notes = CASE
             WHEN NULLIF(btrim(p_reason), '') IS NULL THEN notes
             ELSE trim(both FROM coalesce(notes, '') || E'\nCancel: ' || btrim(p_reason))
           END,
           updated_at = now()
     WHERE id = p_transfer_id
     RETURNING * INTO v_transfer;
    RETURN v_transfer;
  END IF;

  RAISE EXCEPTION 'Transfer status % cannot be cancelled', v_transfer.status;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_stock_transfer(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_stock_transfer(uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_stock_transfer(
  p_transfer_id uuid,
  p_actor_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS public.stock_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := COALESCE(auth.uid(), p_actor_id);
  v_transfer public.stock_transfers;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authenticated actor is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('stock-transfer:' || p_transfer_id::text, 0));

  SELECT * INTO v_transfer FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found'; END IF;

  IF v_transfer.status = 'rejected' THEN
    RETURN v_transfer;
  END IF;
  IF v_transfer.status IS DISTINCT FROM 'pending_approval' THEN
    RAISE EXCEPTION 'Only pending-approval transfers can be rejected';
  END IF;
  IF NOT public.is_hq_admin() THEN
    RAISE EXCEPTION 'Unauthorized rejection: HQ inventory approval authority is required';
  END IF;

  PERFORM public._stock_transfer_release_reservations(v_transfer);

  UPDATE public.stock_transfers
     SET status = 'rejected',
         rejected_by = v_actor,
         rejected_at = COALESCE(rejected_at, now()),
         rejection_reason = NULLIF(btrim(p_reason), ''),
         updated_at = now()
   WHERE id = p_transfer_id
   RETURNING * INTO v_transfer;

  RETURN v_transfer;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_stock_transfer(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_stock_transfer(uuid, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.cancel_stock_transfer(uuid, uuid, text) IS
  'Cancel draft (no stock), pending_approval (release reservation), or in_transit before destination post (restore source).';
COMMENT ON FUNCTION public.reject_stock_transfer(uuid, uuid, text) IS
  'HQ reject of pending_approval transfer; releases source reservation.';

NOTIFY pgrst, 'reload schema';

COMMIT;
