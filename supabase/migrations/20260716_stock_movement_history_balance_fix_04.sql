-- Stock movement historical-balance safety.
--
-- Future writes only: this migration performs no historical UPDATE and must be
-- applied manually. Existing invalid rows remain available for review/repair.

-- Clients must use an authoritative SECURITY DEFINER RPC/service. The current
-- application has no direct stock_movements insert; its writers use RPCs.
REVOKE INSERT ON TABLE public.stock_movements FROM anon, authenticated;

-- Low-level JSON/log writers are implementation details and accept balance
-- material directly. Keep them callable by trusted server jobs and by their
-- owning SECURITY DEFINER wrappers, but not as public client RPCs.
REVOKE ALL ON FUNCTION public.log_qr_receive_movement(uuid, uuid, integer, numeric, uuid, text, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_qr_shipment_movement(uuid, uuid, integer, numeric, uuid, text, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wms_record_movement_from_summary(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wms_record_movements_from_items(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wms_ship_manual(uuid, uuid, uuid, uuid, integer, uuid, text, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.log_qr_receive_movement(uuid, uuid, integer, numeric, uuid, text, uuid, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.log_qr_shipment_movement(uuid, uuid, integer, numeric, uuid, text, uuid, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.wms_record_movement_from_summary(jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.wms_record_movements_from_items(jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.wms_ship_manual(uuid, uuid, uuid, uuid, integer, uuid, text, text)
  TO service_role;

-- Serialize the main movement RPC before it reads the inventory balance. The
-- advisory lock also covers a not-yet-created inventory row; FOR UPDATE then
-- protects the authoritative row once it exists.
CREATE OR REPLACE FUNCTION public.record_stock_movement(
  p_movement_type text,
  p_variant_id uuid,
  p_organization_id uuid,
  p_quantity_change integer,
  p_unit_cost numeric DEFAULT NULL,
  p_manufacturer_id uuid DEFAULT NULL,
  p_warehouse_location text DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_reference_type text DEFAULT 'manual',
  p_reference_id uuid DEFAULT NULL,
  p_reference_no text DEFAULT NULL,
  p_company_id uuid DEFAULT NULL,
  p_created_by uuid DEFAULT NULL,
  p_evidence_urls text[] DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
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
    concat_ws(':', v_company_id::text, p_organization_id::text, p_variant_id::text),
    0
  ));

  SELECT id, quantity_on_hand
    INTO v_inventory_id, v_current_qty
    FROM public.product_inventory
   WHERE variant_id = p_variant_id
     AND organization_id = p_organization_id
     AND is_active = true
   FOR UPDATE;

  IF v_inventory_id IS NULL THEN
    IF p_quantity_change < 0 THEN
      RAISE EXCEPTION 'Inventory not found for outgoing movement (organization %, variant %)',
        p_organization_id, p_variant_id;
    END IF;

    INSERT INTO public.product_inventory (
      variant_id,
      organization_id,
      quantity_on_hand,
      quantity_allocated,
      warehouse_location,
      average_cost,
      created_at,
      updated_at
    ) VALUES (
      p_variant_id,
      p_organization_id,
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

-- Validate or safely derive row balances at the table boundary. A supplied
-- pair is accepted only when it satisfies the invariant and is anchored to the
-- locked current inventory as either a pre-update or post-update writer.
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
     ORDER BY sm.created_at DESC, sm.id DESC
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
     AND is_active = true
   FOR UPDATE;

  IF NOT FOUND THEN
    IF NEW.quantity_change < 0 THEN
      RAISE EXCEPTION 'Inventory not found for outgoing movement (warehouse %, variant %)',
        v_wh_id, NEW.variant_id;
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
  'Validates invariant balances against locked company/warehouse/variant inventory; derives only unambiguous missing values.';

-- Do not attach a NOT VALID CHECK constraint while corrupt legacy rows remain:
-- PostgreSQL would enforce it during unrelated legacy-row updates. Protect only
-- explicit future edits of the three balance columns instead.
CREATE OR REPLACE FUNCTION public.enforce_stock_movement_quantity_invariant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.quantity_after <> NEW.quantity_before + NEW.quantity_change THEN
    RAISE EXCEPTION 'Movement quantity invariant failed: before %, change %, after %',
      NEW.quantity_before, NEW.quantity_change, NEW.quantity_after;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stock_movements_quantity_invariant_update
  ON public.stock_movements;

CREATE TRIGGER stock_movements_quantity_invariant_update
BEFORE UPDATE OF quantity_before, quantity_change, quantity_after
ON public.stock_movements
FOR EACH ROW
EXECUTE FUNCTION public.enforce_stock_movement_quantity_invariant();

-- Correct every repository-owned historical view at read time. This leaves the
-- underlying legacy rows untouched while protecting SQL/report consumers that
-- do not use the TypeScript shared helper.
CREATE OR REPLACE VIEW public.v_stock_movements_display AS
SELECT
  sm.id,
  sm.created_at,
  sm.movement_type,
  sm.variant_id,
  sm.from_organization_id,
  sm.to_organization_id,
  sm.quantity_change,
  sm.quantity_before,
  sm.quantity_before + sm.quantity_change AS quantity_after,
  sm.unit_cost,
  sm.reference_id,
  sm.reason,
  sm.created_by,
  sm.reference_type
FROM public.stock_movements sm
WHERE NOT (
  sm.movement_type = 'order_fulfillment'
  AND sm.quantity_before = 0
  AND sm.quantity_before + sm.quantity_change = 0
)
AND NOT (sm.from_organization_id IS NULL AND sm.to_organization_id IS NULL);

CREATE OR REPLACE VIEW public.v_wms_movements_recent AS
SELECT
  sm.created_at,
  sm.movement_type,
  sm.reference_type,
  sm.reference_id AS order_id,
  sm.variant_id,
  sm.from_organization_id AS from_org_id,
  sm.to_organization_id AS to_org_id,
  sm.quantity_before,
  sm.quantity_change,
  sm.quantity_before + sm.quantity_change AS quantity_after
FROM public.stock_movements sm
ORDER BY sm.created_at DESC, sm.id DESC
LIMIT 500;

CREATE OR REPLACE VIEW public.vw_stock_movements_ordered AS
SELECT
  sm.id,
  sm.movement_type,
  sm.reference_type,
  sm.reference_id,
  sm.reference_no,
  sm.variant_id,
  sm.from_organization_id,
  sm.to_organization_id,
  sm.quantity_change,
  sm.quantity_before,
  sm.quantity_before + sm.quantity_change AS quantity_after,
  sm.unit_cost,
  sm.total_cost,
  sm.manufacturer_id,
  sm.warehouse_location,
  sm.reason,
  sm.notes,
  sm.company_id,
  sm.created_by,
  sm.created_at
FROM public.stock_movements sm
ORDER BY sm.created_at, sm.id;
