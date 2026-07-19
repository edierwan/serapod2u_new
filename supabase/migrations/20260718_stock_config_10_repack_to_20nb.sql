-- ============================================================================
-- Inventory Stock Configurations — Phase 8 follow-up (10):
-- Reclassify 50ml boxes into 20ml New Box
-- ----------------------------------------------------------------------------
-- Migrations 01-09 are immutable. This forward-only migration changes no
-- inventory or historical movement data.
--
-- Final operational rule:
--   * 50OB -> 20NB or 50NB -> 20NB, exactly 1:1.
--   * Partial conversion is allowed from unallocated stock only.
--   * This is an auditable box reclassification; internal liquid volume is
--     intentionally not validated.
--   * A caller-supplied request UUID provides transaction-scoped idempotency.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.repack_stock_v2(
  p_request_id       uuid,
  p_variant_id       uuid,
  p_warehouse_org_id uuid,
  p_from_config_id   uuid,
  p_to_config_id     uuid,
  p_quantity         integer,
  p_notes            text DEFAULT NULL,
  p_created_by       uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_from_config public.inventory_stock_configurations%ROWTYPE;
  v_to_config   public.inventory_stock_configurations%ROWTYPE;
  v_company_id  uuid;
  v_available   integer;
  v_unit_cost   numeric;
  v_rpk_no      text;
  v_out_id      uuid;
  v_in_id       uuid;
  v_existing_count integer;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'Repack request id is required';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Repack quantity must be greater than zero';
  END IF;
  IF p_from_config_id = p_to_config_id THEN
    RAISE EXCEPTION 'Source and destination configurations must differ';
  END IF;

  v_company_id := public.get_company_id(p_warehouse_org_id);
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Cannot resolve company for organization %', p_warehouse_org_id;
  END IF;

  IF auth.role() = 'authenticated' THEN
    IF auth.uid() IS NULL OR p_created_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'created_by must match the authenticated user';
    END IF;
    IF NOT (public.can_access_org(p_warehouse_org_id) OR public.is_hq_admin()) THEN
      RAISE EXCEPTION 'User cannot repack stock for organization %', p_warehouse_org_id;
    END IF;
  END IF;

  -- Serialise retries before checking for an already-committed pair. A failed
  -- first attempt leaves no rows because both movements run in this function's
  -- transaction; the retry then proceeds normally.
  PERFORM pg_advisory_xact_lock(hashtextextended('repack-request:' || p_request_id::text, 0));

  SELECT count(*), min(reference_no)
    INTO v_existing_count, v_rpk_no
    FROM public.stock_movements
   WHERE reference_type = 'repack'
     AND reference_id = p_request_id;

  IF v_existing_count > 0 THEN
    IF v_existing_count <> 2
       OR NOT EXISTS (
         SELECT 1 FROM public.stock_movements sm
          WHERE sm.reference_type = 'repack' AND sm.reference_id = p_request_id
            AND sm.movement_type = 'repack_out'
            AND sm.variant_id = p_variant_id
            AND sm.from_organization_id = p_warehouse_org_id
            AND sm.stock_config_id = p_from_config_id
            AND sm.quantity_change = -p_quantity
       )
       OR NOT EXISTS (
         SELECT 1 FROM public.stock_movements sm
          WHERE sm.reference_type = 'repack' AND sm.reference_id = p_request_id
            AND sm.movement_type = 'repack_in'
            AND sm.variant_id = p_variant_id
            AND sm.to_organization_id = p_warehouse_org_id
            AND sm.stock_config_id = p_to_config_id
            AND sm.quantity_change = p_quantity
       )
    THEN
      RAISE EXCEPTION 'Repack request id % was already used for different parameters', p_request_id;
    END IF;

    SELECT id INTO v_out_id FROM public.stock_movements
     WHERE reference_type = 'repack' AND reference_id = p_request_id AND movement_type = 'repack_out';
    SELECT id INTO v_in_id FROM public.stock_movements
     WHERE reference_type = 'repack' AND reference_id = p_request_id AND movement_type = 'repack_in';

    RETURN jsonb_build_object(
      'reference_no', v_rpk_no,
      'request_id', p_request_id,
      'variant_id', p_variant_id,
      'warehouse_org_id', p_warehouse_org_id,
      'from_config_id', p_from_config_id,
      'to_config_id', p_to_config_id,
      'quantity', p_quantity,
      'repack_out_movement_id', v_out_id,
      'repack_in_movement_id', v_in_id,
      'idempotent_replay', true
    );
  END IF;

  SELECT * INTO v_from_config
    FROM public.inventory_stock_configurations
   WHERE id = p_from_config_id AND variant_id = p_variant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source configuration % does not belong to variant %', p_from_config_id, p_variant_id;
  END IF;

  SELECT * INTO v_to_config
    FROM public.inventory_stock_configurations
   WHERE id = p_to_config_id AND variant_id = p_variant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Destination configuration % does not belong to variant %', p_to_config_id, p_variant_id;
  END IF;

  -- Source identity remains visible on repack_out. Both supported 50ml box
  -- configurations converge on the same flavour's 20NB balance.
  IF v_from_config.volume_ml IS DISTINCT FROM 50
     OR NOT (
       (v_from_config.config_code = '50OB' AND v_from_config.packaging = 'old_box')
       OR (v_from_config.config_code = '50NB' AND v_from_config.packaging = 'new_box')
     ) THEN
    RAISE EXCEPTION 'Source must be 50ml Old Box or 50ml New Box';
  END IF;
  IF v_to_config.config_code <> '20NB'
     OR v_to_config.volume_ml IS DISTINCT FROM 20
     OR v_to_config.packaging IS DISTINCT FROM 'new_box' THEN
    RAISE EXCEPTION 'Destination must be 20ml New Box for the same flavour';
  END IF;
  IF v_from_config.status = 'inactive' THEN
    RAISE EXCEPTION 'Source configuration % is inactive', v_from_config.config_code;
  END IF;
  IF v_to_config.status <> 'active' THEN
    RAISE EXCEPTION 'Destination configuration % is not active', v_to_config.config_code;
  END IF;

  -- Match record_stock_movement's per-configuration lock key and lock both
  -- balances in UUID order. This protects an absent destination row as well as
  -- existing rows and prevents opposite-order deadlocks.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', v_company_id::text, p_warehouse_org_id::text, p_variant_id::text, cfg), 0))
  FROM (
    SELECT unnest(ARRAY[least(p_from_config_id, p_to_config_id)::text,
                        greatest(p_from_config_id, p_to_config_id)::text]) AS cfg
  ) locks;

  PERFORM 1
    FROM public.product_inventory
   WHERE variant_id = p_variant_id
     AND organization_id = p_warehouse_org_id
     AND stock_config_id IN (p_from_config_id, p_to_config_id)
     AND is_active = true
   ORDER BY stock_config_id
   FOR UPDATE;

  SELECT quantity_available, COALESCE(average_cost, 0)
    INTO v_available, v_unit_cost
    FROM public.product_inventory
   WHERE variant_id = p_variant_id
     AND organization_id = p_warehouse_org_id
     AND stock_config_id = p_from_config_id
     AND is_active = true
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No % stock found at this warehouse for the selected flavour', v_from_config.config_label;
  END IF;
  IF COALESCE(v_available, 0) < p_quantity THEN
    RAISE EXCEPTION 'Insufficient unallocated % stock. Available: %, requested: %',
      v_from_config.config_label, COALESCE(v_available, 0), p_quantity;
  END IF;

  v_rpk_no := public.generate_display_doc_number(v_company_id, 'RPK');

  -- No exception handler is intentional: any failure after the first movement
  -- aborts this function call and PostgreSQL rolls the entire pair back.
  v_out_id := public.record_stock_movement(
    p_movement_type   => 'repack_out',
    p_variant_id      => p_variant_id,
    p_organization_id => p_warehouse_org_id,
    p_quantity_change => -p_quantity,
    p_unit_cost       => v_unit_cost,
    p_reason          => 'Reclassify ' || v_from_config.config_label || ' -> ' || v_to_config.config_label,
    p_notes           => p_notes,
    p_reference_type  => 'repack',
    p_reference_id    => p_request_id,
    p_reference_no    => v_rpk_no,
    p_company_id      => v_company_id,
    p_created_by      => p_created_by,
    p_stock_config_id => p_from_config_id
  );

  v_in_id := public.record_stock_movement(
    p_movement_type   => 'repack_in',
    p_variant_id      => p_variant_id,
    p_organization_id => p_warehouse_org_id,
    p_quantity_change => p_quantity,
    p_unit_cost       => v_unit_cost,
    p_reason          => 'Reclassify ' || v_from_config.config_label || ' -> ' || v_to_config.config_label,
    p_notes           => p_notes,
    p_reference_type  => 'repack',
    p_reference_id    => p_request_id,
    p_reference_no    => v_rpk_no,
    p_company_id      => v_company_id,
    p_created_by      => p_created_by,
    p_stock_config_id => p_to_config_id
  );

  RETURN jsonb_build_object(
    'reference_no', v_rpk_no,
    'request_id', p_request_id,
    'variant_id', p_variant_id,
    'warehouse_org_id', p_warehouse_org_id,
    'from_config_id', p_from_config_id,
    'to_config_id', p_to_config_id,
    'quantity', p_quantity,
    'unit_cost', v_unit_cost,
    'repack_out_movement_id', v_out_id,
    'repack_in_movement_id', v_in_id,
    'idempotent_replay', false
  );
END;
$$;

COMMENT ON FUNCTION public.repack_stock_v2(uuid, uuid, uuid, uuid, uuid, integer, text, uuid) IS
  'Idempotent atomic 1:1 box reclassification: 50OB or 50NB to the same variant''s active 20NB configuration. Posts exact-config repack_out/repack_in movements under one RPK reference and request UUID.';

REVOKE ALL ON FUNCTION public.repack_stock_v2(uuid, uuid, uuid, uuid, uuid, integer, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.repack_stock_v2(uuid, uuid, uuid, uuid, uuid, integer, text, uuid)
  TO authenticated, service_role;

-- The old signature implements the prohibited 50OB -> 50NB rule and has no
-- replay key. Keep the object only to provide an explicit error to stale
-- callers; it is no longer executable by application roles.
CREATE OR REPLACE FUNCTION public.repack_stock(
  p_variant_id uuid,
  p_warehouse_org_id uuid,
  p_from_config_id uuid,
  p_to_config_id uuid,
  p_quantity integer,
  p_notes text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'repack_stock is obsolete; use repack_stock_v2 with an idempotency request id';
END;
$$;

REVOKE ALL ON FUNCTION public.repack_stock(uuid, uuid, uuid, uuid, integer, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
