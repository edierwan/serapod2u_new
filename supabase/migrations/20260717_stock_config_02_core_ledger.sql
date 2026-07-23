-- ============================================================================
-- Inventory Stock Configurations — Phase 1: Core inventory ledger (02)
-- ----------------------------------------------------------------------------
-- Makes the balance/ledger core configuration-aware. Requires Phase 0
-- (20260717_stock_config_01_groundwork.sql) to be applied first.
--
--   * product_inventory.stock_config_id becomes NOT NULL and the uniqueness
--     key changes: uq_variant_org (variant_id, organization_id) is REPLACED by
--     uq_variant_org_config (variant_id, organization_id, stock_config_id).
--   * record_stock_movement gains p_stock_config_id (defaults to the
--     variant's catch-all configuration via resolve_default_stock_config).
--     Advisory lock, balance row targeting and the movement row now carry the
--     configuration.
--   * trg_stock_movements_fill_cost_and_balance resolves + assigns
--     NEW.stock_config_id for EVERY inserted movement (this centralises
--     configuration assignment for the direct SQL writers: orders_approve,
--     allocate/release allocation, fulfill_order_inventory, wms_ship_manual,
--     wms_record_movement_from_summary, log_qr_* and fn_test_*), and anchors
--     balance continuity to the configuration's inventory row.
--   * trg_block_duplicate_outbound dedupes per configuration (legacy NULL
--     rows are folded onto the variant default so existing protection is not
--     weakened).
--   * stock_movements_apply_to_inventory and
--     revert_inventory_on_movement_delete target the configuration row.
--   * Order flows (allocate_inventory_for_order, orders_approve,
--     fulfill_order_inventory, release_allocation_for_order) and the WMS/QR
--     deduction path (apply_inventory_ship_adjustment,
--     wms_deduct_and_summarize) are PINNED to the variant default
--     configuration. This is intentionally identical to today's behaviour
--     (every variant currently holds stock in exactly one configuration).
--     Real SO configuration selection is Phase 4 and must NOT be improvised
--     here.
--   * adjust_inventory_quantity is pinned to the default configuration; its
--     fallback INSERT also referenced columns that do not exist on
--     product_inventory (quantity_reserved / generated quantity_available)
--     and is corrected as part of the rewrite.
--   * apply_inventory_ship_adjustment no longer assigns the GENERATED column
--     quantity_available (such an UPDATE raises an error on PG15).
--
-- Historical stock_movements rows keep stock_config_id = NULL ("legacy",
-- pre-configuration). They are never rewritten.
--
-- Audited and intentionally unchanged (verified they either do not touch
-- product_inventory rows per-key, or delete wholesale):
--   hard_delete_order, hard_delete_organization,
--   delete_all_transactions_with_inventory(+_v3), delete_scratch_campaign,
--   fn_test_balance_request_flow, wms_ship_manual,
--   wms_record_movement_from_summary, wms_reverse_manual_movement,
--   log_qr_receive_movement, log_qr_shipment_movement.
--
-- ROLLBACK NOTES (manual, only safe while every (variant, org) still has a
-- single configuration row — i.e. before repack/Phase-2 receiving creates
-- additional balances):
--   Restore the previous function bodies from
--   supabase/schemas/current_schema_stg.sql (orders_approve :14137,
--   allocate_inventory_for_order :1179, fulfill_order_inventory :7029,
--   release_allocation_for_order :16970, record_stock_movement :16592,
--   trg_stock_movements_fill_cost_and_balance :19992,
--   stock_movements_apply_to_inventory :19114, trg_block_duplicate_outbound
--   :19591, revert_inventory_on_movement_delete :17490,
--   apply_inventory_ship_adjustment :1405, adjust_inventory_quantity :1090,
--   wms_deduct_and_summarize :21408), then:
--     ALTER TABLE public.product_inventory DROP CONSTRAINT uq_variant_org_config;
--     ALTER TABLE public.product_inventory ADD CONSTRAINT uq_variant_org UNIQUE (variant_id, organization_id);
--     ALTER TABLE public.product_inventory ALTER COLUMN stock_config_id DROP NOT NULL;
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0. Preconditions
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  v_missing bigint;
BEGIN
  SELECT count(*) INTO v_missing
  FROM public.product_inventory
  WHERE stock_config_id IS NULL;
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'Phase 1 aborted: % product_inventory rows have no stock_config_id. Run the Phase 0 backfill first.', v_missing;
  END IF;

  SELECT count(*) INTO v_missing
  FROM public.product_variants pv
  WHERE NOT EXISTS (
    SELECT 1 FROM public.inventory_stock_configurations c
    WHERE c.variant_id = pv.id AND c.is_variant_default
  );
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'Phase 1 aborted: % variants have no default stock configuration.', v_missing;
  END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- 1. Uniqueness swap
-- ----------------------------------------------------------------------------

ALTER TABLE public.product_inventory
  ALTER COLUMN stock_config_id SET NOT NULL;

ALTER TABLE public.product_inventory
  DROP CONSTRAINT IF EXISTS uq_variant_org;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_variant_org_config') THEN
    ALTER TABLE public.product_inventory
      ADD CONSTRAINT uq_variant_org_config UNIQUE (variant_id, organization_id, stock_config_id);
  END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- 2. record_stock_movement — configuration-aware central writer
-- ----------------------------------------------------------------------------
-- Signature changes (new trailing parameter), so the old signature must be
-- dropped to avoid a PostgREST-ambiguous overload.

DROP FUNCTION IF EXISTS public.record_stock_movement(
  text, uuid, uuid, integer, numeric, uuid, text, text, text, text, uuid, text, uuid, uuid, text[]);

CREATE FUNCTION public.record_stock_movement(
  p_movement_type text,
  p_variant_id uuid,
  p_organization_id uuid,
  p_quantity_change integer,
  p_unit_cost numeric DEFAULT NULL::numeric,
  p_manufacturer_id uuid DEFAULT NULL::uuid,
  p_warehouse_location text DEFAULT NULL::text,
  p_reason text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text,
  p_reference_type text DEFAULT 'manual'::text,
  p_reference_id uuid DEFAULT NULL::uuid,
  p_reference_no text DEFAULT NULL::text,
  p_company_id uuid DEFAULT NULL::uuid,
  p_created_by uuid DEFAULT NULL::uuid,
  p_evidence_urls text[] DEFAULT NULL::text[],
  p_stock_config_id uuid DEFAULT NULL::uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
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
  v_config_id := COALESCE(p_stock_config_id, public.resolve_default_stock_config(p_variant_id));
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
$$;

-- ----------------------------------------------------------------------------
-- 3. BEFORE INSERT: cost/balance trigger assigns + anchors the configuration
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_stock_movements_fill_cost_and_balance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_wh_id uuid;
  v_current_qty integer;
  v_cost numeric;
BEGIN
  -- Every NEW movement carries a configuration. Direct SQL writers that do
  -- not (yet) specify one are folded onto the variant's catch-all default —
  -- identical to pre-configuration behaviour. Historical rows are untouched.
  IF NEW.stock_config_id IS NULL THEN
    NEW.stock_config_id := public.resolve_default_stock_config(NEW.variant_id);
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
$$;

COMMENT ON FUNCTION public.trg_stock_movements_fill_cost_and_balance() IS
  'Validates invariant balances against locked company/warehouse/variant/configuration inventory; assigns the variant default configuration to writers that do not specify one; derives only unambiguous missing values.';

-- ----------------------------------------------------------------------------
-- 4. Duplicate-outbound guard — per configuration
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_block_duplicate_outbound()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_default_config uuid;
BEGIN
    IF NEW.movement_type IN ('manual_out','shipment','transfer_out') THEN
        -- Legacy rows carry NULL configuration; fold them (and an unresolved
        -- NEW value — the fill trigger runs after this one) onto the variant
        -- default so historical duplicate protection is not weakened.
        v_default_config := public.resolve_default_stock_config(NEW.variant_id);

        PERFORM 1
            FROM public.stock_movements m
         WHERE m.movement_type IN ('manual_out','shipment','transfer_out')
             AND m.variant_id = NEW.variant_id
             AND COALESCE(m.stock_config_id, v_default_config)
                     IS NOT DISTINCT FROM COALESCE(NEW.stock_config_id, v_default_config)
             AND m.from_organization_id = NEW.from_organization_id
             AND m.to_organization_id   = NEW.to_organization_id
             AND COALESCE(m.reference_no,'') = COALESCE(NEW.reference_no,'')
             AND COALESCE(m.company_id, '00000000-0000-0000-0000-000000000000') =
                     COALESCE(NEW.company_id, '00000000-0000-0000-0000-000000000000')
             AND (m.created_at, m.id) < (COALESCE(NEW.created_at, now()), COALESCE(NEW.id, gen_random_uuid()));

        IF FOUND THEN
            RAISE EXCEPTION
                'Duplicate outbound detected for (company/wh/dist/variant/ref): (%/%/%/%/%). Insert aborted.',
                NEW.company_id, NEW.from_organization_id, NEW.to_organization_id, NEW.variant_id, NEW.reference_no;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. AFTER INSERT apply / AFTER DELETE revert — per configuration
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.stock_movements_apply_to_inventory()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
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
  v_config_id := COALESCE(NEW.stock_config_id, public.resolve_default_stock_config(NEW.variant_id));

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
$$;

CREATE OR REPLACE FUNCTION public.revert_inventory_on_movement_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_target_org uuid;
  v_order_status text;
  v_config_id uuid;
BEGIN
  -- Ignore zero deltas
  IF COALESCE(OLD.quantity_change,0) = 0 THEN
    RETURN OLD;
  END IF;

  -- Skip allocation and deallocation movements
  -- These affect quantity_allocated, not quantity_on_hand
  IF OLD.movement_type IN ('allocation', 'deallocation') THEN
    RETURN OLD;
  END IF;

  -- Check if this movement is from a fulfilled order
  -- If so, don't revert - the stock has actually left the warehouse
  IF OLD.reference_type = 'order' AND OLD.reference_id IS NOT NULL THEN
    SELECT status INTO v_order_status
    FROM public.orders
    WHERE id = OLD.reference_id;

    IF v_order_status IN ('approved', 'warehouse_packed', 'shipped_distributor', 'fulfilled', 'completed') THEN
      -- Order was fulfilled, don't revert inventory
      RETURN OLD;
    END IF;
  END IF;

  -- Determine which organization's inventory was updated
  IF OLD.quantity_change < 0 THEN
    v_target_org := COALESCE(OLD.from_organization_id, OLD.to_organization_id);
  ELSE
    v_target_org := COALESCE(OLD.to_organization_id, OLD.from_organization_id);
  END IF;

  IF v_target_org IS NULL THEN
    RETURN OLD;
  END IF;

  -- Legacy movements (NULL configuration) applied to what is now the variant
  -- default configuration row.
  v_config_id := COALESCE(OLD.stock_config_id, public.resolve_default_stock_config(OLD.variant_id));

  -- Revert the change
  UPDATE public.product_inventory
     SET quantity_on_hand = quantity_on_hand - OLD.quantity_change,
         updated_at       = NOW()
   WHERE variant_id = OLD.variant_id
     AND organization_id = v_target_org
     AND stock_config_id = v_config_id;

  RETURN OLD;
END
$$;

-- ----------------------------------------------------------------------------
-- 6. Order flows — pinned to the variant default configuration (Phase 4
--    replaces this with real SO configuration selection)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.allocate_inventory_for_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_order record;
    v_item record;
    v_inventory_org_id uuid;
    v_seller_type text;
    v_wh_id uuid;
    v_current_on_hand integer;
    v_current_allocated integer;
    v_available integer;
    v_unit_cost numeric;
    v_config_id uuid;
BEGIN
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order not found: %', p_order_id;
    END IF;

    IF v_order.order_type NOT IN ('D2H', 'S2D') THEN
        RETURN;
    END IF;

    v_inventory_org_id := v_order.seller_org_id;

    SELECT org_type_code INTO v_seller_type
    FROM public.organizations
    WHERE id = v_order.seller_org_id;

    IF v_seller_type = 'HQ' THEN
        SELECT id INTO v_wh_id
        FROM public.organizations
        WHERE parent_org_id = v_order.seller_org_id
          AND org_type_code = 'WH'
          AND is_active = true
        ORDER BY created_at ASC
        LIMIT 1;

        IF v_wh_id IS NOT NULL THEN
            v_inventory_org_id := v_wh_id;
        END IF;
    END IF;

    FOR v_item IN
        SELECT * FROM public.order_items WHERE order_id = p_order_id
    LOOP
        -- Phase 1: allocation is pinned to the variant default configuration
        -- (identical to pre-configuration behaviour). Phase 4 introduces
        -- internal configuration selection for SO fulfilment.
        v_config_id := public.resolve_default_stock_config(v_item.variant_id);

        SELECT
            quantity_on_hand,
            quantity_allocated,
            (quantity_on_hand - quantity_allocated) as available,
            COALESCE(average_cost, 0)
        INTO v_current_on_hand, v_current_allocated, v_available, v_unit_cost
        FROM public.product_inventory
        WHERE variant_id = v_item.variant_id
          AND organization_id = v_inventory_org_id
          AND stock_config_id = v_config_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Inventory not found for variant % at organization %',
                v_item.variant_id, v_inventory_org_id;
        END IF;

        IF v_available < v_item.qty THEN
            RAISE EXCEPTION 'Insufficient available stock for variant %. Available: %, Requested: %',
                v_item.variant_id, v_available, v_item.qty;
        END IF;

        UPDATE public.product_inventory
        SET
            quantity_allocated = quantity_allocated + v_item.qty,
            updated_at = now()
        WHERE variant_id = v_item.variant_id
          AND organization_id = v_inventory_org_id
          AND stock_config_id = v_config_id;

        -- Log allocation movement
        -- Show per-order allocation: Before=0, After=qty
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
            company_id,
            created_by,
            created_at,
            notes
        ) VALUES (
            'allocation',
            'order',
            v_order.id,
            v_order.order_no,
            v_item.variant_id,
            v_config_id,
            v_inventory_org_id,  -- Warehouse (where stock is physically located)
            v_order.buyer_org_id, -- Buyer (who will receive the stock)
            v_item.qty,           -- Allocated quantity
            0,                    -- Before: 0 (per-order view)
            v_item.qty,           -- After: qty (per-order view)
            v_unit_cost,
            v_order.company_id,
            COALESCE(auth.uid(), v_order.created_by),
            now(),
            'Allocated ' || v_item.qty || ' units for order ' || v_order.order_no ||
            ' to ' || (SELECT org_name FROM public.organizations WHERE id = v_order.buyer_org_id LIMIT 1)
        );
    END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_allocation_for_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_order record;
    v_item record;
    v_inventory_org_id uuid;
    v_seller_type text;
    v_wh_id uuid;
    v_current_allocated integer;
    v_unit_cost numeric;
    v_config_id uuid;
BEGIN
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order not found: %', p_order_id;
    END IF;

    IF v_order.order_type NOT IN ('D2H', 'S2D') THEN
        RETURN;
    END IF;

    v_inventory_org_id := v_order.seller_org_id;

    SELECT org_type_code INTO v_seller_type
    FROM public.organizations
    WHERE id = v_order.seller_org_id;

    IF v_seller_type = 'HQ' THEN
        SELECT id INTO v_wh_id
        FROM public.organizations
        WHERE parent_org_id = v_order.seller_org_id
          AND org_type_code = 'WH'
          AND is_active = true
        ORDER BY created_at ASC
        LIMIT 1;

        IF v_wh_id IS NOT NULL THEN
            v_inventory_org_id := v_wh_id;
        END IF;
    END IF;

    FOR v_item IN
        SELECT * FROM public.order_items WHERE order_id = p_order_id
    LOOP
        -- Check if deallocation already exists for this order item
        IF EXISTS (
            SELECT 1 FROM public.stock_movements
            WHERE reference_id = p_order_id
              AND variant_id = v_item.variant_id
              AND movement_type = 'deallocation'
        ) THEN
            RAISE NOTICE 'Deallocation already exists for order % variant %', v_order.order_no, v_item.variant_id;
            CONTINUE;
        END IF;

        -- Release against the same configuration the allocation was pinned to.
        SELECT sm.stock_config_id INTO v_config_id
        FROM public.stock_movements sm
        WHERE sm.reference_id = p_order_id
          AND sm.variant_id = v_item.variant_id
          AND sm.movement_type = 'allocation'
        ORDER BY sm.created_at DESC, sm.id DESC
        LIMIT 1;
        v_config_id := COALESCE(v_config_id, public.resolve_default_stock_config(v_item.variant_id));

        SELECT
            quantity_allocated,
            COALESCE(average_cost, 0)
        INTO v_current_allocated, v_unit_cost
        FROM public.product_inventory
        WHERE variant_id = v_item.variant_id
          AND organization_id = v_inventory_org_id
          AND stock_config_id = v_config_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE WARNING 'Inventory not found for variant % at organization %',
                v_item.variant_id, v_inventory_org_id;
            CONTINUE;
        END IF;

        UPDATE public.product_inventory
        SET
            quantity_allocated = GREATEST(0, quantity_allocated - v_item.qty),
            updated_at = now()
        WHERE variant_id = v_item.variant_id
          AND organization_id = v_inventory_org_id
          AND stock_config_id = v_config_id;

        -- Create deallocation movement to reverse the allocation
        -- Swap from/to so it displays at the buyer location (matching the original allocation)
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
            company_id,
            created_by,
            created_at,
            notes
        ) VALUES (
            'deallocation',
            'order',
            v_order.id,
            v_order.order_no,
            v_item.variant_id,
            v_config_id,
            v_order.buyer_org_id,    -- FROM: Buyer location (where allocation was shown)
            v_inventory_org_id,       -- TO: Warehouse (stock returns here)
            -v_item.qty,
            v_item.qty, -- Before: The allocated amount for this order
            0,          -- After: 0
            v_unit_cost,
            v_order.company_id,
            COALESCE(auth.uid(), v_order.created_by),
            now(),
            CASE
                WHEN v_order.status = 'cancelled' THEN 'order_cancelled'
                ELSE 'order_deleted'
            END
        );
    END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.orders_approve(p_order_id uuid)
RETURNS public.orders
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v public.orders;
  v_user_org uuid;
  v_user_org_type text;
  v_can boolean := false;
  v_po_doc_no text;
  v_item record;
  v_current_qty integer;
  v_current_allocated integer;
  v_inventory_org_id uuid;
  v_seller_type text;
  v_wh_id uuid;
  v_buyer_current_qty integer;
  v_creator_level integer;
  v_user_level integer;
  v_has_authority boolean;
  v_config_id uuid;
BEGIN
  -- 1) CHECKS & PERMISSIONS (UNCHANGED)
  SELECT * INTO v FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF v.status <> 'submitted' THEN RAISE EXCEPTION 'Order must be in submitted'; END IF;

  SELECT organization_id INTO v_user_org FROM public.users WHERE id = auth.uid();
  v_user_org_type := public.get_org_type(v_user_org);

  SELECT r.role_level INTO v_creator_level
  FROM public.users u
  JOIN public.roles r ON u.role_code = r.role_code
  WHERE u.id = v.created_by;

  SELECT r.role_level INTO v_user_level
  FROM public.users u
  JOIN public.roles r ON u.role_code = r.role_code
  WHERE u.id = auth.uid();

  v_creator_level := COALESCE(v_creator_level, 999);
  v_user_level := COALESCE(v_user_level, 999);

  IF v_creator_level = 10 THEN
      v_has_authority := (v_user_level = 10 OR v_user_level = 20);
  ELSE
      v_has_authority := (v_user_level < v_creator_level);
  END IF;

  CASE v.order_type
    WHEN 'H2M' THEN
      IF v_user_org_type='HQ' AND v_has_authority THEN v_can := true; END IF;
    WHEN 'D2H' THEN
      IF v_user_org_type='HQ' AND (v_has_authority OR
          EXISTS (SELECT 1 FROM pg_proc WHERE proname='is_hq_admin' AND pg_function_is_visible(oid) AND public.is_hq_admin())) THEN
        v_can := true;
      END IF;
    WHEN 'S2D' THEN
      IF v_user_org = v.seller_org_id AND v_has_authority THEN v_can := true; END IF;
  END CASE;

  IF NOT v_can THEN
    RAISE EXCEPTION 'User lacks permission to approve this order type';
  END IF;

  IF v.parent_order_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id=v.parent_order_id AND status='approved') THEN
      RAISE EXCEPTION 'Parent order must be approved first';
    END IF;
    PERFORM public.validate_child_quantities(p_order_id, v.parent_order_id);
  END IF;

  v_inventory_org_id := v.seller_org_id;

  SELECT org_type_code INTO v_seller_type FROM public.organizations WHERE id = v.seller_org_id;
  IF v_seller_type = 'HQ' THEN
      SELECT id INTO v_wh_id FROM public.organizations
      WHERE parent_org_id = v.seller_org_id AND org_type_code = 'WH' AND is_active = true LIMIT 1;

      IF v_wh_id IS NOT NULL THEN
          v_inventory_org_id := v_wh_id;
      END IF;
  END IF;

  -- 2) STOCK MOVEMENTS
  -- Phase 1: warehouse deduction and buyer credit are pinned to the variant
  -- default configuration (identical to pre-configuration behaviour; the
  -- distributor side stays consolidated at variant level). Phase 4 replaces
  -- the warehouse-side selection with real SO configuration allocation.
  IF v.order_type IN ('D2H', 'S2D') THEN
    FOR v_item IN SELECT * FROM public.order_items WHERE order_id = v.id LOOP
        v_config_id := public.resolve_default_stock_config(v_item.variant_id);
        IF v_config_id IS NULL THEN
            RAISE EXCEPTION 'No stock configuration found for variant %', v_item.variant_id;
        END IF;

        SELECT quantity_on_hand, quantity_allocated
        INTO v_current_qty, v_current_allocated
        FROM public.product_inventory
        WHERE variant_id = v_item.variant_id
          AND organization_id = v_inventory_org_id
          AND stock_config_id = v_config_id
        FOR UPDATE;

        IF v_current_qty IS NULL THEN
            RAISE EXCEPTION 'Inventory not found for variant %', v_item.variant_id;
        END IF;

        IF v_current_qty < v_item.qty THEN
            RAISE EXCEPTION 'Insufficient stock for variant %. On hand: %, Needed: %',
                v_item.variant_id, v_current_qty, v_item.qty;
        END IF;

        UPDATE public.product_inventory
        SET
            quantity_allocated = GREATEST(0, quantity_allocated - v_item.qty),
            quantity_on_hand = quantity_on_hand - v_item.qty,
            updated_at = now()
        WHERE variant_id = v_item.variant_id
          AND organization_id = v_inventory_org_id
          AND stock_config_id = v_config_id;

        INSERT INTO public.product_inventory (organization_id, variant_id, stock_config_id, quantity_on_hand)
        VALUES (v.buyer_org_id, v_item.variant_id, v_config_id, 0)
        ON CONFLICT (variant_id, organization_id, stock_config_id) DO NOTHING;

        SELECT quantity_on_hand INTO v_buyer_current_qty
        FROM public.product_inventory
        WHERE variant_id = v_item.variant_id
          AND organization_id = v.buyer_org_id
          AND stock_config_id = v_config_id;

        UPDATE public.product_inventory
        SET quantity_on_hand = quantity_on_hand + v_item.qty,
            updated_at = now()
        WHERE variant_id = v_item.variant_id
          AND organization_id = v.buyer_org_id
          AND stock_config_id = v_config_id;

        INSERT INTO public.stock_movements (
            movement_type, reference_type, reference_id, reference_no,
            variant_id, stock_config_id, from_organization_id, to_organization_id,
            quantity_change, quantity_before, quantity_after,
            company_id, created_by, created_at, notes
        ) VALUES (
            'transfer_in', 'order', v.id, v.order_no,
            v_item.variant_id, v_config_id, v_inventory_org_id, v.buyer_org_id,
            v_item.qty, v_buyer_current_qty, v_buyer_current_qty + v_item.qty,
            v.company_id, auth.uid(), now(),
            'Order approved - stock received from seller'
        );
    END LOOP;
  END IF;

  -- 3) DOCUMENT GENERATION (PATCHED + GUARDED)
  IF v.order_type IN ('D2H', 'S2D') THEN

      -- SO (NEW - must exist)
      IF NOT EXISTS (SELECT 1 FROM public.documents WHERE order_id = v.id AND doc_type = 'SO') THEN
          INSERT INTO public.documents (
            company_id, order_id, doc_type, doc_no, status,
            issued_by_org_id, issued_to_org_id, created_by, created_at, updated_at
          ) VALUES (
            v.company_id, v.id, 'SO', v.order_no, 'pending',
            v.seller_org_id, v.buyer_org_id, auth.uid(), now(), now()
          );
      END IF;

      -- DO (guarded)
      IF NOT EXISTS (SELECT 1 FROM public.documents WHERE order_id = v.id AND doc_type = 'DO') THEN
          INSERT INTO public.documents (
            company_id, order_id, doc_type, doc_no, status,
            issued_by_org_id, issued_to_org_id, created_by, created_at, updated_at
          ) VALUES (
            v.company_id, v.id, 'DO', 'DO-' || v.order_no, 'pending',
            v.seller_org_id, v.buyer_org_id, auth.uid(), now(), now()
          );
      END IF;

      -- INVOICE (guarded)
      IF NOT EXISTS (SELECT 1 FROM public.documents WHERE order_id = v.id AND doc_type = 'INVOICE') THEN
          INSERT INTO public.documents (
            company_id, order_id, doc_type, doc_no, status,
            issued_by_org_id, issued_to_org_id, created_by, created_at, updated_at
          ) VALUES (
            v.company_id, v.id, 'INVOICE', 'INV-' || v.order_no, 'pending',
            v.seller_org_id, v.buyer_org_id, auth.uid(), now(), now()
          );
      END IF;

  ELSE
      -- H2M -> PO (guarded)
      IF NOT EXISTS (SELECT 1 FROM public.documents WHERE order_id = v.id AND doc_type = 'PO') THEN
          v_po_doc_no := 'PO-' || v.order_no;
          INSERT INTO public.documents (
            company_id, order_id, doc_type, doc_no, status,
            issued_by_org_id, issued_to_org_id, created_by, created_at, updated_at
          ) VALUES (
            v.company_id, v.id, 'PO', v_po_doc_no, 'pending',
            v.buyer_org_id, v.seller_org_id, auth.uid(), now(), now()
          );
      END IF;
  END IF;

  -- 4) UPDATE ORDER STATUS (UNCHANGED)
  UPDATE public.orders
     SET status='approved',
         approved_by=auth.uid(),
         approved_at=now(),
         updated_by=auth.uid(),
         updated_at=now()
     WHERE id = p_order_id
     RETURNING * INTO v;

  RETURN v;
END;
$$;

COMMENT ON FUNCTION public.orders_approve(p_order_id uuid) IS
  'Approves order and triggers fulfillment (release allocation + deduct stock) for D2H/S2D orders. Allocation happens on submission, not approval. Phase 1: inventory effects pinned to the variant default stock configuration.';

CREATE OR REPLACE FUNCTION public.fulfill_order_inventory(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_order record;
    v_item record;
    v_inventory_org_id uuid;
    v_seller_type text;
    v_wh_id uuid;
    v_current_on_hand integer;
    v_current_allocated integer;
    v_unit_cost numeric;
    v_config_id uuid;
BEGIN
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;

    -- Determine inventory source organization
    v_inventory_org_id := v_order.seller_org_id;

    SELECT org_type_code INTO v_seller_type FROM public.organizations WHERE id = v_order.seller_org_id;

    IF v_seller_type = 'HQ' THEN
        SELECT id INTO v_wh_id
        FROM public.organizations
        WHERE parent_org_id = v_order.seller_org_id
          AND org_type_code = 'WH'
          AND is_active = true
        ORDER BY created_at ASC
        LIMIT 1;

        IF v_wh_id IS NOT NULL THEN
            v_inventory_org_id := v_wh_id;
        END IF;
    END IF;

    FOR v_item IN SELECT * FROM public.order_items WHERE order_id = p_order_id LOOP
        -- Phase 1: pinned to the variant default configuration (Phase 4 adds
        -- real configuration selection).
        v_config_id := public.resolve_default_stock_config(v_item.variant_id);

        -- Fetch current inventory stats
        SELECT
            quantity_on_hand,
            quantity_allocated,
            COALESCE(average_cost, 0)
        INTO v_current_on_hand, v_current_allocated, v_unit_cost
        FROM public.product_inventory
        WHERE variant_id = v_item.variant_id
          AND organization_id = v_inventory_org_id
          AND stock_config_id = v_config_id
        FOR UPDATE;

        IF NOT FOUND THEN
             RAISE EXCEPTION 'Inventory not found for variant % at organization %', v_item.variant_id, v_inventory_org_id;
        END IF;

        -- 1. Release Allocation
        UPDATE public.product_inventory
        SET quantity_allocated = GREATEST(0, quantity_allocated - v_item.qty),
            updated_at = now()
        WHERE variant_id = v_item.variant_id
          AND organization_id = v_inventory_org_id
          AND stock_config_id = v_config_id;

        -- 2. Deduct On Hand
        UPDATE public.product_inventory
        SET quantity_on_hand = quantity_on_hand - v_item.qty,
            updated_at = now()
        WHERE variant_id = v_item.variant_id
          AND organization_id = v_inventory_org_id
          AND stock_config_id = v_config_id;

        -- 3. Log Fulfillment (Deduction)
        -- Show actual warehouse stock levels
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
            company_id,
            created_by,
            created_at,
            notes
        ) VALUES (
            'order_fulfillment',
            'order',
            v_order.id,
            v_order.order_no,
            v_item.variant_id,
            v_config_id,
            v_inventory_org_id,
            v_order.buyer_org_id,
            -v_item.qty,
            v_current_on_hand,              -- Before: Actual On Hand
            v_current_on_hand - v_item.qty, -- After: New On Hand
            v_unit_cost,
            v_order.company_id,
            auth.uid(),
            now(),
            'Order Fulfilled/Shipped'
        );
    END LOOP;
END;
$$;

COMMENT ON FUNCTION public.fulfill_order_inventory(p_order_id uuid) IS
  'Fulfills order: releases allocation, deducts stock, and logs movement with actual warehouse stock levels. Phase 1: pinned to the variant default stock configuration.';

-- ----------------------------------------------------------------------------
-- 7. WMS/QR deduction path and manual adjustment helper — default-pinned
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.apply_inventory_ship_adjustment(
  p_variant_id uuid, p_organization_id uuid, p_units integer,
  p_cases integer DEFAULT 0, p_shipped_at timestamp with time zone DEFAULT now())
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_current_qty integer;
  v_org_name text;
  v_variant_name text;
  v_config_id uuid;
BEGIN
  v_config_id := public.resolve_default_stock_config(p_variant_id);

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
$$;

CREATE OR REPLACE FUNCTION public.wms_deduct_and_summarize(
  p_variant_id uuid, p_from_org_id uuid, p_to_org_id uuid, p_units integer,
  p_order_id uuid, p_shipped_at timestamp with time zone DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_before int;
  v_after  int;
  v_config_id uuid;
BEGIN
  IF p_units IS NULL OR p_units <= 0 THEN
    RAISE EXCEPTION 'p_units must be > 0 (got %)', p_units;
  END IF;

  v_config_id := public.resolve_default_stock_config(p_variant_id);

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
$$;

CREATE OR REPLACE FUNCTION public.adjust_inventory_quantity(
  p_variant_id uuid, p_organization_id uuid, p_delta integer)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_config_id uuid;
BEGIN
  v_config_id := public.resolve_default_stock_config(p_variant_id);

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
$$;

COMMIT;
