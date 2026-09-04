-- ============================================================================
-- Canonical operational stock configuration — Phase 1
-- ----------------------------------------------------------------------------
-- Business decision (final): each operational product variant has exactly ONE
-- canonical active stock configuration, and the application resolves it rather
-- than asking the operator to choose.
--
--   Cellera cartridges → 20NB (20 mg · New Box)
--   Non-vape products  → STD  (Standard)
--
-- 20NB is deliberately NOT hard-coded: non-vape variants resolve to STD, and a
-- future family would resolve to its own code without a code change.
--
-- ----------------------------------------------------------------------------
-- WHY THIS MIGRATION EXISTS
-- ----------------------------------------------------------------------------
-- public.resolve_default_stock_config() returns the configuration flagged
-- is_variant_default. In both staging and production that flag resolves to:
--
--   UNCLASSIFIED  for all 36 Cellera cartridge variants
--   STD           for all 39 non-vape variants
--
-- So every write path that omitted an explicit configuration posted Cellera
-- stock into UNCLASSIFIED — the legacy bucket the business has now decided to
-- retire. That is not a historical accident: production recorded 484 such
-- movements between 2026-07-29 and 2026-09-03, all from
-- post_return_case_inventory (Returns received into WH002).
--
-- This migration adds an operational resolver and repoints the write paths at
-- it. It changes no balance, no historical movement and no configuration row.
--
-- ----------------------------------------------------------------------------
-- WHAT IS DELIBERATELY NOT REPOINTED
-- ----------------------------------------------------------------------------
-- Two paths still call resolve_default_stock_config, correctly:
--
--   release_allocation_for_order        releases a reservation from the balance
--                                       the allocation was actually pinned to
--   revert_inventory_on_movement_delete reverses a movement against the balance
--                                       that movement was actually applied to
--
-- Both look BACKWARDS at where stock already sits. Repointing them would
-- release or reverse against the wrong balance. They must keep resolving to
-- the legacy sink for as long as legacy balances exist.
--
-- The seven repointed bodies below are the current production definitions,
-- byte-identical to staging, with exactly one line changed in each.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The canonical rule, in one place
-- ---------------------------------------------------------------------------
-- A configuration is a canonical operational candidate when it is:
--   * active                       — not phase_out, not inactive
--   * default_for_ord              — master data's own "this is the one" flag
--   * not UNCLASSIFIED             — the legacy bucket is never operational
--   * not requires_repacking       — 50OB-style stock cannot be transacted raw
--
-- Verified against live data before writing this migration: every active
-- variant resolves to exactly one candidate — 62 of 62 in production, 60 of 60
-- in staging — and no active variant resolves to zero or to more than one.

CREATE OR REPLACE VIEW public.v_canonical_stock_config AS
SELECT
  c.variant_id,
  c.id            AS stock_config_id,
  c.config_code,
  c.config_label,
  c.stock_sku,
  count(*) OVER (PARTITION BY c.variant_id) AS candidate_count
FROM public.inventory_stock_configurations c
WHERE c.status = 'active'
  AND c.default_for_ord
  AND c.config_code <> 'UNCLASSIFIED'
  AND NOT COALESCE(c.requires_repacking_before_sale, false);

COMMENT ON VIEW public.v_canonical_stock_config IS
  'One row per canonical operational stock configuration candidate. candidate_count > 1 means the variant is ambiguous and resolve_operational_stock_config() will fail closed on it.';

GRANT SELECT ON public.v_canonical_stock_config TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.resolve_operational_stock_config(p_variant_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_config_id uuid;
  v_count     integer;
  v_codes     text;
BEGIN
  IF p_variant_id IS NULL THEN
    RAISE EXCEPTION 'Cannot resolve an operational stock configuration for a null variant';
  END IF;

  SELECT count(*), min(stock_config_id), string_agg(config_code, ', ' ORDER BY config_code)
    INTO v_count, v_config_id, v_codes
    FROM public.v_canonical_stock_config
   WHERE variant_id = p_variant_id;

  -- Fail loudly in both directions. Silently picking one of several, or
  -- silently falling back to the legacy sink, is what produced 303,598 units
  -- of UNCLASSIFIED stock in the first place.
  IF v_count = 0 THEN
    RAISE EXCEPTION
      'No canonical operational stock configuration for variant %. Master data must carry exactly one active default_for_ord configuration that is not UNCLASSIFIED.',
      p_variant_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_count > 1 THEN
    RAISE EXCEPTION
      'Ambiguous canonical operational stock configuration for variant %: % candidates (%). Exactly one is required.',
      p_variant_id, v_count, v_codes
      USING ERRCODE = 'cardinality_violation';
  END IF;

  RETURN v_config_id;
END;
$$;

COMMENT ON FUNCTION public.resolve_operational_stock_config(uuid) IS
  'The one canonical operational stock configuration for a variant (20NB for Cellera cartridges, STD for non-vape). Fails closed when zero or more than one candidate exists. Operational write paths use this; resolve_default_stock_config remains only for reversing historical postings against the legacy sink they actually landed in.';

REVOKE ALL ON FUNCTION public.resolve_operational_stock_config(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_operational_stock_config(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.resolve_default_stock_config(uuid) IS
  'LEGACY SINK RESOLVER — returns the is_variant_default configuration, which is UNCLASSIFIED for Cellera cartridges and STD for non-vape. Use ONLY to reverse or release a posting against the balance it actually landed in. Never use it on a forward operational write path: use resolve_operational_stock_config(uuid).';

-- ---------------------------------------------------------------------------
-- 2. Repointed write paths
-- ---------------------------------------------------------------------------
-- Each body below is the current production definition with exactly one call
-- to resolve_default_stock_config replaced by resolve_operational_stock_config.

-- ---- record_stock_movement ---------------------------------------------
CREATE OR REPLACE FUNCTION public.record_stock_movement(p_movement_type text, p_variant_id uuid, p_organization_id uuid, p_quantity_change integer, p_unit_cost numeric DEFAULT NULL::numeric, p_manufacturer_id uuid DEFAULT NULL::uuid, p_warehouse_location text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_reference_type text DEFAULT 'manual'::text, p_reference_id uuid DEFAULT NULL::uuid, p_reference_no text DEFAULT NULL::text, p_company_id uuid DEFAULT NULL::uuid, p_created_by uuid DEFAULT NULL::uuid, p_evidence_urls text[] DEFAULT NULL::text[], p_stock_config_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_movement_id uuid;
  v_current_qty integer;
  v_new_qty integer;
  v_inventory_id uuid;
  v_company_id uuid;
  v_from_org uuid := NULL;
  v_to_org uuid := NULL;
  v_final_unit_cost numeric;
  v_normalized_type text;
  v_config_id uuid;
BEGIN
  IF p_quantity_change IS NULL OR p_quantity_change = 0 THEN
    RAISE EXCEPTION 'quantity_change must be non-zero';
  END IF;

  v_normalized_type := lower(trim(p_movement_type));
  v_final_unit_cost := CASE
    WHEN v_normalized_type = 'warranty_bonus' THEN 0
    ELSE p_unit_cost
  END;

  IF p_quantity_change < 0 THEN
    v_from_org := p_organization_id;
  ELSE
    v_to_org := p_organization_id;
  END IF;

  -- Resolve configuration: explicit > variant catch-all default.
  v_config_id := COALESCE(p_stock_config_id, public.resolve_operational_stock_config(p_variant_id));
  IF v_config_id IS NULL THEN
    RAISE EXCEPTION 'No stock configuration found for variant %', p_variant_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_stock_configurations c
    WHERE c.id = v_config_id AND c.variant_id = p_variant_id
  ) THEN
    RAISE EXCEPTION 'Stock configuration % does not belong to variant %', v_config_id, p_variant_id;
  END IF;

  v_company_id := public.get_company_id(p_organization_id);
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Cannot resolve company for organization %', p_organization_id;
  END IF;
  IF p_company_id IS NOT NULL AND p_company_id IS DISTINCT FROM v_company_id THEN
    RAISE EXCEPTION 'Company % does not own organization %', p_company_id, p_organization_id;
  END IF;

  IF auth.role() = 'authenticated' THEN
    IF auth.uid() IS NULL OR p_created_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'created_by must match the authenticated user';
    END IF;
    IF NOT (public.can_access_org(p_organization_id) OR public.is_hq_admin()) THEN
      RAISE EXCEPTION 'User cannot post stock movement for organization %', p_organization_id;
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', v_company_id::text, p_organization_id::text, p_variant_id::text, v_config_id::text),
    0
  ));

  SELECT id, quantity_on_hand
    INTO v_inventory_id, v_current_qty
    FROM public.product_inventory
   WHERE variant_id = p_variant_id
     AND organization_id = p_organization_id
     AND stock_config_id = v_config_id
     AND is_active = true
   FOR UPDATE;

  IF v_inventory_id IS NULL THEN
    IF p_quantity_change < 0 THEN
      RAISE EXCEPTION 'Inventory not found for outgoing movement (organization %, variant %, configuration %)',
        p_organization_id, p_variant_id, v_config_id;
    END IF;

    INSERT INTO public.product_inventory (
      variant_id,
      organization_id,
      stock_config_id,
      quantity_on_hand,
      quantity_allocated,
      warehouse_location,
      average_cost,
      created_at,
      updated_at
    ) VALUES (
      p_variant_id,
      p_organization_id,
      v_config_id,
      0,
      0,
      p_warehouse_location,
      v_final_unit_cost,
      now(),
      now()
    )
    RETURNING id, quantity_on_hand INTO v_inventory_id, v_current_qty;
  END IF;

  v_new_qty := v_current_qty + p_quantity_change;
  IF v_new_qty < 0 THEN
    RAISE EXCEPTION 'Insufficient stock. Current: %, requested change: %',
      v_current_qty, p_quantity_change;
  END IF;

  INSERT INTO public.stock_movements (
    movement_type,
    reference_type,
    reference_id,
    reference_no,
    variant_id,
    stock_config_id,
    from_organization_id,
    to_organization_id,
    quantity_change,
    quantity_before,
    quantity_after,
    unit_cost,
    manufacturer_id,
    warehouse_location,
    reason,
    notes,
    company_id,
    created_by,
    evidence_urls
  ) VALUES (
    p_movement_type,
    p_reference_type,
    p_reference_id,
    p_reference_no,
    p_variant_id,
    v_config_id,
    v_from_org,
    v_to_org,
    p_quantity_change,
    v_current_qty,
    v_new_qty,
    v_final_unit_cost,
    p_manufacturer_id,
    p_warehouse_location,
    p_reason,
    p_notes,
    v_company_id,
    p_created_by,
    p_evidence_urls
  )
  RETURNING id INTO v_movement_id;

  UPDATE public.product_inventory
     SET quantity_on_hand = v_new_qty,
         updated_at = now(),
         average_cost = CASE
           WHEN p_quantity_change > 0 AND v_final_unit_cost IS NOT NULL THEN
             ((quantity_on_hand * coalesce(average_cost, 0)) +
               (p_quantity_change * v_final_unit_cost)) /
             (quantity_on_hand + p_quantity_change)
           ELSE average_cost
         END
   WHERE id = v_inventory_id;

  RETURN v_movement_id;
END;
$function$;

-- ---- trg_stock_movements_fill_cost_and_balance -------------------------
CREATE OR REPLACE FUNCTION public.trg_stock_movements_fill_cost_and_balance()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_wh_id uuid;
  v_current_qty integer;
  v_cost numeric;
BEGIN
  -- Every NEW movement carries a configuration. Direct SQL writers that do
  -- not (yet) specify one are folded onto the variant's catch-all default —
  -- identical to pre-configuration behaviour. Historical rows are untouched.
  IF NEW.stock_config_id IS NULL THEN
    NEW.stock_config_id := public.resolve_operational_stock_config(NEW.variant_id);
    IF NEW.stock_config_id IS NULL THEN
      RAISE EXCEPTION 'No stock configuration found for variant %', NEW.variant_id;
    END IF;
  END IF;

  v_wh_id := public._movement_warehouse_id(
    NEW.movement_type,
    NEW.from_organization_id,
    NEW.to_organization_id
  );

  IF NEW.unit_cost IS NULL
     AND NEW.movement_type IN ('manual_out', 'shipment', 'transfer_out') THEN
    SELECT sm.unit_cost
      INTO v_cost
      FROM public.stock_movements sm
     WHERE sm.company_id = NEW.company_id
       AND sm.from_organization_id = NEW.from_organization_id
       AND sm.variant_id = NEW.variant_id
       AND sm.unit_cost IS NOT NULL
       AND (sm.created_at, sm.id) < (
         coalesce(NEW.created_at, now()),
         coalesce(NEW.id, gen_random_uuid())
       )
     -- Prefer same-configuration cost history; legacy (NULL) and other
     -- configurations remain a fallback so costing keeps working across the
     -- migration boundary.
     ORDER BY (sm.stock_config_id = NEW.stock_config_id) DESC NULLS LAST,
              sm.created_at DESC, sm.id DESC
     LIMIT 1;

    NEW.unit_cost := coalesce(v_cost, 0);
  END IF;

  -- Allocation/deallocation balances are per-order allocated quantities, not
  -- warehouse on-hand. Their authoritative RPCs lock product_inventory and
  -- supply the explicit pair, so only the arithmetic invariant applies here.
  IF NEW.movement_type IN ('allocation', 'deallocation') THEN
    IF NEW.quantity_before IS NULL
       OR NEW.quantity_after IS NULL
       OR NEW.quantity_after <> NEW.quantity_before + NEW.quantity_change THEN
      RAISE EXCEPTION 'Invalid % movement balance: before %, change %, after %',
        NEW.movement_type, NEW.quantity_before, NEW.quantity_change, NEW.quantity_after;
    END IF;
    RETURN NEW;
  END IF;

  IF v_wh_id IS NULL THEN
    RAISE EXCEPTION 'Cannot resolve movement warehouse for type %', NEW.movement_type;
  END IF;

  IF public.get_company_id(v_wh_id) IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'Movement company % does not own warehouse %', NEW.company_id, v_wh_id;
  END IF;

  SELECT quantity_on_hand
    INTO v_current_qty
    FROM public.product_inventory
   WHERE variant_id = NEW.variant_id
     AND organization_id = v_wh_id
     AND stock_config_id = NEW.stock_config_id
     AND is_active = true
   FOR UPDATE;

  IF NOT FOUND THEN
    IF NEW.quantity_change < 0 THEN
      RAISE EXCEPTION 'Inventory not found for outgoing movement (warehouse %, variant %, configuration %)',
        v_wh_id, NEW.variant_id, NEW.stock_config_id;
    END IF;
    v_current_qty := 0;
  END IF;

  IF NEW.quantity_before IS NOT NULL AND NEW.quantity_after IS NOT NULL THEN
    IF NEW.quantity_after = NEW.quantity_before + NEW.quantity_change
       AND (v_current_qty = NEW.quantity_before OR v_current_qty = NEW.quantity_after) THEN
      NULL; -- Valid pre-update or post-update authoritative writer.
    ELSIF v_current_qty = NEW.quantity_before THEN
      NEW.quantity_after := NEW.quantity_before + NEW.quantity_change;
    ELSIF v_current_qty = NEW.quantity_after THEN
      NEW.quantity_before := NEW.quantity_after - NEW.quantity_change;
    ELSE
      RAISE EXCEPTION 'Movement balance is not anchored to current inventory. Current %, before %, change %, after %',
        v_current_qty, NEW.quantity_before, NEW.quantity_change, NEW.quantity_after;
    END IF;
  ELSIF NEW.quantity_before IS NOT NULL THEN
    IF v_current_qty = NEW.quantity_before THEN
      NEW.quantity_after := NEW.quantity_before + NEW.quantity_change;
    ELSIF v_current_qty = NEW.quantity_before + NEW.quantity_change THEN
      NEW.quantity_after := v_current_qty;
    ELSE
      RAISE EXCEPTION 'Supplied movement before quantity is stale';
    END IF;
  ELSIF NEW.quantity_after IS NOT NULL THEN
    IF v_current_qty = NEW.quantity_after THEN
      NEW.quantity_before := NEW.quantity_after - NEW.quantity_change;
    ELSIF v_current_qty + NEW.quantity_change = NEW.quantity_after THEN
      NEW.quantity_before := v_current_qty;
    ELSE
      RAISE EXCEPTION 'Supplied movement after quantity is stale';
    END IF;
  ELSIF NEW.movement_type IN ('qr_ship', 'warehouse_receive') THEN
    -- These are the only types whose AFTER INSERT trigger applies inventory;
    -- therefore the locked current value is unambiguously the opening balance.
    NEW.quantity_before := v_current_qty;
    NEW.quantity_after := v_current_qty + NEW.quantity_change;
  ELSE
    RAISE EXCEPTION 'Both movement balance fields are required for type %', NEW.movement_type;
  END IF;

  IF NEW.quantity_after < 0 THEN
    RAISE EXCEPTION 'Movement would produce negative stock: %', NEW.quantity_after;
  END IF;

  IF NEW.quantity_after <> NEW.quantity_before + NEW.quantity_change THEN
    RAISE EXCEPTION 'Movement quantity invariant failed: before %, change %, after %',
      NEW.quantity_before, NEW.quantity_change, NEW.quantity_after;
  END IF;

  RETURN NEW;
END;
$function$;

-- ---- post_return_case_inventory ----------------------------------------
CREATE OR REPLACE FUNCTION public.post_return_case_inventory(p_return_case_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

    v_cfg := public.resolve_operational_stock_config(v_item.variant_id);
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
$function$;

-- ---- adjust_inventory_quantity -----------------------------------------
CREATE OR REPLACE FUNCTION public.adjust_inventory_quantity(p_variant_id uuid, p_organization_id uuid, p_delta integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_config_id uuid;
BEGIN
  v_config_id := public.resolve_operational_stock_config(p_variant_id);

  UPDATE public.product_inventory
  SET
    quantity_on_hand = quantity_on_hand + p_delta,
    updated_at = now()
  WHERE variant_id = p_variant_id
    AND organization_id = p_organization_id
    AND stock_config_id = v_config_id;

  IF NOT FOUND THEN
    -- If record doesn't exist, create it (though it should exist if we have
    -- QR codes). The previous body referenced quantity_reserved and the
    -- generated quantity_available column, neither of which is insertable.
    INSERT INTO public.product_inventory (
      variant_id,
      organization_id,
      stock_config_id,
      quantity_on_hand,
      quantity_allocated
    ) VALUES (
      p_variant_id,
      p_organization_id,
      v_config_id,
      GREATEST(p_delta, 0),
      0
    );
  END IF;
END;
$function$;

-- ---- apply_inventory_ship_adjustment -----------------------------------
CREATE OR REPLACE FUNCTION public.apply_inventory_ship_adjustment(p_variant_id uuid, p_organization_id uuid, p_units integer, p_cases integer DEFAULT 0, p_shipped_at timestamp with time zone DEFAULT now())
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_current_qty integer;
  v_org_name text;
  v_variant_name text;
  v_config_id uuid;
BEGIN
  v_config_id := public.resolve_operational_stock_config(p_variant_id);

  -- Get current quantity
  SELECT quantity_on_hand INTO v_current_qty
  FROM public.product_inventory
  WHERE variant_id = p_variant_id
    AND organization_id = p_organization_id
    AND stock_config_id = v_config_id
  FOR UPDATE;

  v_current_qty := COALESCE(v_current_qty, 0);

  -- Check if sufficient stock
  IF v_current_qty < p_units THEN
    -- Get names for better error message
    SELECT org_name INTO v_org_name FROM public.organizations WHERE id = p_organization_id;
    SELECT variant_name INTO v_variant_name FROM public.product_variants WHERE id = p_variant_id;

    RAISE EXCEPTION 'Insufficient stock for shipment. On hand: %, requested: %. Variant: % (%), Org: % (%)',
      v_current_qty, p_units, COALESCE(v_variant_name, 'Unknown'), p_variant_id, COALESCE(v_org_name, 'Unknown'), p_organization_id;
  END IF;

  -- Update inventory (quantity_available is a GENERATED column and must not
  -- be assigned directly).
  UPDATE public.product_inventory
  SET
    quantity_on_hand = quantity_on_hand - p_units,
    updated_at = now()
  WHERE variant_id = p_variant_id
    AND organization_id = p_organization_id
    AND stock_config_id = v_config_id;

  -- If no row was updated (shouldn't happen due to check above, but if row didn't exist), raise error
  IF NOT FOUND THEN
     SELECT org_name INTO v_org_name FROM public.organizations WHERE id = p_organization_id;
     SELECT variant_name INTO v_variant_name FROM public.product_variants WHERE id = p_variant_id;

     RAISE EXCEPTION 'Inventory record not found for Variant % (%) in Org % (%)',
       COALESCE(v_variant_name, 'Unknown'), p_variant_id, COALESCE(v_org_name, 'Unknown'), p_organization_id;
  END IF;
END;
$function$;

-- ---- wms_deduct_and_summarize ------------------------------------------
CREATE OR REPLACE FUNCTION public.wms_deduct_and_summarize(p_variant_id uuid, p_from_org_id uuid, p_to_org_id uuid, p_units integer, p_order_id uuid, p_shipped_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_before int;
  v_after  int;
  v_config_id uuid;
BEGIN
  IF p_units IS NULL OR p_units <= 0 THEN
    RAISE EXCEPTION 'p_units must be > 0 (got %)', p_units;
  END IF;

  v_config_id := public.resolve_operational_stock_config(p_variant_id);

  -- Read BEFORE qty (warehouse side)
  SELECT pi.quantity_on_hand
  INTO v_before
  FROM public.product_inventory pi
  WHERE pi.variant_id = p_variant_id
    AND pi.organization_id = p_from_org_id
    AND pi.stock_config_id = v_config_id
  FOR UPDATE;

  v_before := COALESCE(v_before, 0);

  -- Deduct inventory using existing adjustment function
  PERFORM public.apply_inventory_ship_adjustment(
    p_variant_id,
    p_from_org_id,
    p_units,
    0,                -- cases optional; units drive the truth
    p_shipped_at
  );

  -- Read AFTER qty
  SELECT pi.quantity_on_hand
  INTO v_after
  FROM public.product_inventory pi
  WHERE pi.variant_id = p_variant_id
    AND pi.organization_id = p_from_org_id
    AND pi.stock_config_id = v_config_id;

  v_after := COALESCE(v_after, 0);

  RETURN jsonb_build_object(
    'variant_id',  p_variant_id,
    'from_org',    p_from_org_id,
    'to_org',      p_to_org_id,
    'order_id',    p_order_id,
    'units',       p_units,
    'before',      v_before,
    'after',       v_after,
    'shipped_at',  p_shipped_at
  );
END;
$function$;

-- ---- stock_movements_apply_to_inventory --------------------------------
CREATE OR REPLACE FUNCTION public.stock_movements_apply_to_inventory()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_inventory_id uuid;
  v_before int;
  v_after  int;
  v_target_org uuid;
  v_config_id uuid;
BEGIN
  -- Ignore zero deltas
  IF COALESCE(NEW.quantity_change,0) = 0 THEN
    RETURN NEW;
  END IF;

  -- Only handle types that are NOT handled by explicit functions or record_stock_movement
  IF NEW.movement_type NOT IN ('qr_ship', 'warehouse_receive') THEN
    RETURN NEW;
  END IF;

  -- Determine which organization's inventory should be updated
  IF NEW.quantity_change < 0 THEN
    v_target_org := COALESCE(NEW.from_organization_id, NEW.to_organization_id);
  ELSE
    v_target_org := COALESCE(NEW.to_organization_id, NEW.from_organization_id);
  END IF;

  IF v_target_org IS NULL THEN
    RETURN NEW;
  END IF;

  -- The BEFORE trigger (fill_cost_and_balance) has already assigned the
  -- configuration on every new row; fall back defensively anyway.
  v_config_id := COALESCE(NEW.stock_config_id, public.resolve_operational_stock_config(NEW.variant_id));

  -- Lock/ensure inventory row
  SELECT id, quantity_on_hand
  INTO v_inventory_id, v_before
  FROM public.product_inventory
  WHERE variant_id = NEW.variant_id
    AND organization_id = v_target_org
    AND stock_config_id = v_config_id
    AND is_active = true
  FOR UPDATE;

  IF v_inventory_id IS NULL THEN
    -- Create a fresh row if missing
    INSERT INTO public.product_inventory(
      variant_id, organization_id, stock_config_id, quantity_on_hand,
      quantity_allocated, warehouse_location, average_cost,
      created_at, updated_at, is_active
    )
    VALUES(
      NEW.variant_id, v_target_org, v_config_id, 0,
      0, NEW.warehouse_location, NEW.unit_cost,
      NOW(), NOW(), true
    )
    RETURNING id, quantity_on_hand INTO v_inventory_id, v_before;
  END IF;

  v_after := GREATEST(0, v_before + NEW.quantity_change);

  UPDATE public.product_inventory
     SET quantity_on_hand = v_after,
         updated_at       = NOW()
   WHERE id = v_inventory_id;

  -- If the inserter didn't fill before/after, backfill for consistency
  IF NEW.quantity_before IS NULL OR NEW.quantity_after IS NULL THEN
    NEW.quantity_before := v_before;
    NEW.quantity_after  := v_after;
  END IF;

  RETURN NEW;
END
$function$;

COMMIT;
