-- ============================================================================
-- Inventory Stock Configurations — Phase 2: ORD receiving + repacking (03)
-- ----------------------------------------------------------------------------
-- Requires Phases 0-1 (20260717_stock_config_01/02).
--
--   * Manufacturer ORD receiving (post_warehouse_receipt) now posts each line
--     into the variant's default_for_ord configuration (20ml + New Box for
--     vape variants, the STD row otherwise) and records it on
--     warehouse_receipt_items.stock_config_id. Variants whose ORD default is
--     missing fall back to the variant catch-all default — never a guess
--     between real configurations.
--   * New movement types repack_out (< 0) / repack_in (> 0) and reference
--     type 'repack' (both CHECK constraints extended; all existing rows
--     remain valid because the original arms are unchanged).
--   * repack_stock(): atomic manual repacking. Enforces same variant, same
--     volume (volume can never change), old_box -> new_box only, target
--     configuration active, sufficient unallocated stock; posts the paired
--     repack_out / repack_in movements through record_stock_movement under a
--     shared RPK-* reference from generate_display_doc_number. Unit cost is
--     carried from the source balance so repacking preserves inventory value.
--
-- ROLLBACK NOTES (manual):
--   DROP FUNCTION IF EXISTS public.repack_stock(uuid, uuid, uuid, uuid, integer, text, uuid);
--   Restore post_warehouse_receipt from
--     supabase/migrations/20260623_warehouse_received_inventory_posting_02.sql
--   Restore _movement_warehouse_id / both CHECK constraints from
--     supabase/schemas/current_schema_stg.sql (:677, :33020, :33022).
--   (Only safe while no repack_* movements exist.)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Movement-type sign matrix + reference types
-- ----------------------------------------------------------------------------

ALTER TABLE public.stock_movements
  DROP CONSTRAINT IF EXISTS valid_quantity_change;
ALTER TABLE public.stock_movements
  ADD CONSTRAINT valid_quantity_change CHECK (
    ((movement_type = ANY (ARRAY['addition'::text, 'transfer_in'::text, 'order_cancelled'::text, 'manual_in'::text, 'scratch_game_in'::text, 'allocation'::text, 'warranty_bonus'::text, 'repack_in'::text])) AND (quantity_change > 0))
    OR ((movement_type = 'adjustment'::text) AND (quantity_change <> 0))
    OR ((movement_type = ANY (ARRAY['transfer_out'::text, 'order_fulfillment'::text, 'manual_out'::text, 'scratch_game_out'::text, 'deallocation'::text, 'repack_out'::text])) AND (quantity_change < 0))
  );

ALTER TABLE public.stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_reference_type_check;
ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_reference_type_check CHECK (
    reference_type = ANY (ARRAY['manual'::text, 'order'::text, 'transfer'::text, 'adjustment'::text, 'purchase_order'::text, 'return'::text, 'campaign'::text, 'repack'::text])
  );

-- Balance-anchor warehouse resolution for the new types.
CREATE OR REPLACE FUNCTION public._movement_warehouse_id(p_movement_type text, p_from uuid, p_to uuid)
RETURNS uuid
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
           WHEN p_movement_type IN ('manual_out','shipment','transfer_out','repack_out') THEN p_from
           WHEN p_movement_type IN ('manual_in','purchase_in','transfer_in','adjust_in','repack_in') THEN p_to
           ELSE COALESCE(p_from, p_to)
         END
$$;

-- ----------------------------------------------------------------------------
-- 2. ORD receiving resolves the default_for_ord configuration
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.post_warehouse_receipt(
  p_batch_id            uuid,
  p_order_id            uuid,
  p_company_id          uuid,
  p_warehouse_org_id    uuid,
  p_manufacturer_org_id uuid,
  p_receipt_type        text,
  p_received_by         uuid,
  p_items               jsonb,
  p_idempotency_key     text DEFAULT NULL,
  p_notes               text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing            public.warehouse_receipts%ROWTYPE;
  v_receipt_id          uuid;
  v_receipt_no          text;
  v_order_no            text;
  v_item                jsonb;
  v_variant_id          uuid;
  v_product_id          uuid;
  v_received_now        integer;
  v_ordered_qty         integer;
  v_prev_received       integer;
  v_cumulative          integer;
  v_unit_cost           numeric;
  v_movement_id         uuid;
  v_item_extra          integer;
  v_item_extra_added    integer;
  v_total_received      integer := 0;
  v_total_ordered       integer := 0;
  v_total_extra_added   integer := 0;
  v_order_prev_cum      integer := 0;
  v_order_cumulative    integer := 0;
  v_items_out           jsonb := '[]'::jsonb;
  v_config_id           uuid;
BEGIN
  IF p_receipt_type NOT IN ('full', 'partial') THEN
    RAISE EXCEPTION 'invalid receipt_type %, expected full or partial', p_receipt_type;
  END IF;

  -- 1. Idempotency: return the already-posted receipt unchanged.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.warehouse_receipts
    WHERE idempotency_key = p_idempotency_key
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'receipt_id', v_existing.id,
        'receipt_no', v_existing.receipt_no,
        'receipt_type', v_existing.receipt_type,
        'total_received', v_existing.total_received,
        'cumulative_received', v_existing.cumulative_received,
        'extra_received', v_existing.extra_received,
        'idempotent_replay', true
      );
    END IF;
  END IF;

  -- 2. Serialise concurrent confirms for the same batch.
  PERFORM pg_advisory_xact_lock(hashtext(p_batch_id::text));

  -- 3. Order-wide cumulative received BEFORE this receipt (across prior receipts).
  SELECT COALESCE(sum(received_now), 0) INTO v_order_prev_cum
  FROM public.warehouse_receipt_items
  WHERE order_id = p_order_id;

  SELECT order_no INTO v_order_no FROM public.orders WHERE id = p_order_id;
  v_receipt_no := public.next_warehouse_receipt_no(p_batch_id);

  -- 4. Insert the receipt header (totals patched after the item loop).
  INSERT INTO public.warehouse_receipts (
    company_id, order_id, batch_id, receipt_no, receipt_type,
    posting_status, notes, idempotency_key, received_by, received_at
  ) VALUES (
    p_company_id, p_order_id, p_batch_id, v_receipt_no, p_receipt_type,
    'posted', p_notes, p_idempotency_key, p_received_by, now()
  )
  RETURNING id INTO v_receipt_id;

  -- 5. Post each line.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_variant_id := (v_item->>'variant_id')::uuid;
    v_product_id := NULLIF(v_item->>'product_id', '')::uuid;
    v_received_now := COALESCE((v_item->>'received_now')::integer, 0);

    IF v_received_now < 0 THEN
      RAISE EXCEPTION 'received_now must be >= 0 (variant %)', v_variant_id;
    END IF;

    -- Manufacturer stock is received into the ORD default configuration
    -- (20ml + New Box for vape variants). Fall back to the variant catch-all
    -- default when no ORD default is flagged — never a guess between real
    -- configurations.
    SELECT c.id INTO v_config_id
    FROM public.inventory_stock_configurations c
    WHERE c.variant_id = v_variant_id
      AND c.default_for_ord
      AND c.allow_ord
      AND c.status = 'active'
    LIMIT 1;
    v_config_id := COALESCE(v_config_id, public.resolve_default_stock_config(v_variant_id));

    -- Ordered units for this variant = non-buffer QR codes in the batch.
    SELECT count(*) INTO v_ordered_qty
    FROM public.qr_codes
    WHERE batch_id = p_batch_id
      AND variant_id = v_variant_id
      AND COALESCE(is_buffer, false) = false;

    -- Cumulative for this variant BEFORE this receipt.
    SELECT COALESCE(sum(received_now), 0) INTO v_prev_received
    FROM public.warehouse_receipt_items
    WHERE order_id = p_order_id
      AND variant_id = v_variant_id;

    v_cumulative := v_prev_received + v_received_now;

    -- Extra = cumulative beyond ordered; extra_added = portion added this receipt.
    v_item_extra := GREATEST(0, v_cumulative - v_ordered_qty);
    v_item_extra_added := v_item_extra - GREATEST(0, v_prev_received - v_ordered_qty);

    -- Unit cost from the order line (best-effort).
    SELECT unit_price INTO v_unit_cost
    FROM public.order_items
    WHERE order_id = p_order_id AND variant_id = v_variant_id
    LIMIT 1;
    v_unit_cost := COALESCE(v_unit_cost, 0);

    v_movement_id := NULL;
    IF v_received_now > 0 AND p_warehouse_org_id IS NOT NULL THEN
      -- reference_type 'order' is an allowed value and accurately represents a
      -- receipt of stock against an order (consistent with the full-receive
      -- worker). Per-line receipt linkage is kept via stock_movement_id below.
      BEGIN
        SELECT public.record_stock_movement(
          p_movement_type   => 'addition',
          p_variant_id      => v_variant_id,
          p_organization_id => p_warehouse_org_id,
          p_quantity_change => v_received_now,
          p_unit_cost       => v_unit_cost,
          p_manufacturer_id => p_manufacturer_org_id,
          p_reason          => 'warehouse_receive',
          p_notes           => 'Warehouse receipt ' || v_receipt_no || ' (' || p_receipt_type || ')',
          p_reference_type  => 'order',
          p_reference_id    => p_order_id,
          p_reference_no    => v_order_no,
          p_company_id      => p_company_id,
          p_created_by      => p_received_by,
          p_stock_config_id => v_config_id
        ) INTO v_movement_id;
      EXCEPTION WHEN OTHERS THEN
        -- Aborts the whole function (single transaction => full rollback) with a
        -- clear, variant-identifying message for the API to surface.
        RAISE EXCEPTION
          'Stock movement failed for variant % (qty %, reference_type=order): %',
          v_variant_id, v_received_now, SQLERRM;
      END;
    END IF;

    INSERT INTO public.warehouse_receipt_items (
      receipt_id, company_id, order_id, batch_id, product_id, variant_id,
      stock_config_id, ordered_qty, previously_received, received_now,
      cumulative_received, extra_received, stock_movement_id
    ) VALUES (
      v_receipt_id, p_company_id, p_order_id, p_batch_id, v_product_id, v_variant_id,
      v_config_id, v_ordered_qty, v_prev_received, v_received_now,
      v_cumulative, v_item_extra, v_movement_id
    );

    v_total_received := v_total_received + v_received_now;
    v_total_ordered := v_total_ordered + v_ordered_qty;
    v_total_extra_added := v_total_extra_added + GREATEST(0, v_item_extra_added);

    v_items_out := v_items_out || jsonb_build_object(
      'variant_id', v_variant_id,
      'stock_config_id', v_config_id,
      'ordered_qty', v_ordered_qty,
      'previously_received', v_prev_received,
      'received_now', v_received_now,
      'cumulative_received', v_cumulative,
      'extra_received', v_item_extra,
      'stock_movement_id', v_movement_id
    );
  END LOOP;

  v_order_cumulative := v_order_prev_cum + v_total_received;

  -- 6. Patch header totals.
  UPDATE public.warehouse_receipts
  SET total_received      = v_total_received,
      cumulative_received = v_order_cumulative,
      ordered_total       = v_total_ordered,
      extra_received      = v_total_extra_added,
      updated_at          = now()
  WHERE id = v_receipt_id;

  RETURN jsonb_build_object(
    'receipt_id', v_receipt_id,
    'receipt_no', v_receipt_no,
    'receipt_type', p_receipt_type,
    'total_received', v_total_received,
    'cumulative_received', v_order_cumulative,
    'extra_received', v_total_extra_added,
    'items', v_items_out,
    'idempotent_replay', false
  );
END;
$$;

-- NOTE: the original 20260623 version passed p_reference_type =>
-- 'warehouse_receipt', which stock_movements_reference_type_check rejects.
-- Repair 20260623_..._reference_fix_04 standardised on reference_type='order',
-- reference_id=order_id, reference_no=order_no (receipt number stays in the
-- movement notes and warehouse_receipt_items.stock_movement_id); this rewrite
-- keeps that behaviour and only adds the stock configuration.

-- ----------------------------------------------------------------------------
-- 3. Manual repacking: 50ml Old Box -> 50ml New Box
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.repack_stock(
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
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Repack quantity must be greater than zero';
  END IF;
  IF p_from_config_id = p_to_config_id THEN
    RAISE EXCEPTION 'Source and target configurations must differ';
  END IF;

  SELECT * INTO v_from_config FROM public.inventory_stock_configurations
  WHERE id = p_from_config_id AND variant_id = p_variant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source configuration % does not belong to variant %', p_from_config_id, p_variant_id;
  END IF;

  SELECT * INTO v_to_config FROM public.inventory_stock_configurations
  WHERE id = p_to_config_id AND variant_id = p_variant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target configuration % does not belong to variant %', p_to_config_id, p_variant_id;
  END IF;

  -- Business rules: the only permitted conversion is the existing
  -- 50ml Old Box -> 50ml New Box pair. This also makes the same-volume rule
  -- explicit and prevents future Old Box dimensions from becoming eligible.
  IF v_from_config.volume_ml IS NULL OR v_to_config.volume_ml IS NULL
     OR v_from_config.volume_ml <> v_to_config.volume_ml THEN
    RAISE EXCEPTION 'Repacking cannot change volume (from % ml to % ml)',
      v_from_config.volume_ml, v_to_config.volume_ml;
  END IF;
  IF v_from_config.volume_ml <> 50 OR v_to_config.volume_ml <> 50 THEN
    RAISE EXCEPTION 'Only 50ml Old Box -> 50ml New Box repacking is allowed';
  END IF;
  IF v_from_config.packaging IS DISTINCT FROM 'old_box'
     OR v_to_config.packaging IS DISTINCT FROM 'new_box' THEN
    RAISE EXCEPTION 'Only Old Box -> New Box repacking is allowed (got % -> %)',
      COALESCE(v_from_config.packaging, 'none'), COALESCE(v_to_config.packaging, 'none');
  END IF;
  IF v_from_config.status = 'inactive' THEN
    RAISE EXCEPTION 'Source configuration % is inactive', v_from_config.config_code;
  END IF;
  IF v_to_config.status <> 'active' THEN
    RAISE EXCEPTION 'Target configuration % is not active', v_to_config.config_code;
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

  -- Serialise both configuration balances (same key scheme as
  -- record_stock_movement, ordered by config id to avoid deadlocks).
  PERFORM pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', v_company_id::text, p_warehouse_org_id::text, p_variant_id::text, cfg), 0))
  FROM (
    SELECT unnest(ARRAY[least(p_from_config_id, p_to_config_id)::text,
                        greatest(p_from_config_id, p_to_config_id)::text]) AS cfg
  ) locks;

  SELECT quantity_available, COALESCE(average_cost, 0)
    INTO v_available, v_unit_cost
    FROM public.product_inventory
   WHERE variant_id = p_variant_id
     AND organization_id = p_warehouse_org_id
     AND stock_config_id = p_from_config_id
     AND is_active = true
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No % stock found at this warehouse for the selected variant', v_from_config.config_label;
  END IF;
  IF COALESCE(v_available, 0) < p_quantity THEN
    RAISE EXCEPTION 'Insufficient unallocated % stock. Available: %, requested: %',
      v_from_config.config_label, COALESCE(v_available, 0), p_quantity;
  END IF;

  v_rpk_no := public.generate_display_doc_number(v_company_id, 'RPK');

  -- Paired movements share the RPK reference. Unit cost is carried from the
  -- source balance so quantity and inventory value are preserved.
  v_out_id := public.record_stock_movement(
    p_movement_type   => 'repack_out',
    p_variant_id      => p_variant_id,
    p_organization_id => p_warehouse_org_id,
    p_quantity_change => -p_quantity,
    p_unit_cost       => v_unit_cost,
    p_reason          => 'Repack ' || v_from_config.config_label || ' -> ' || v_to_config.config_label,
    p_notes           => p_notes,
    p_reference_type  => 'repack',
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
    p_reason          => 'Repack ' || v_from_config.config_label || ' -> ' || v_to_config.config_label,
    p_notes           => p_notes,
    p_reference_type  => 'repack',
    p_reference_no    => v_rpk_no,
    p_company_id      => v_company_id,
    p_created_by      => p_created_by,
    p_stock_config_id => p_to_config_id
  );

  RETURN jsonb_build_object(
    'reference_no', v_rpk_no,
    'variant_id', p_variant_id,
    'warehouse_org_id', p_warehouse_org_id,
    'from_config_id', p_from_config_id,
    'to_config_id', p_to_config_id,
    'quantity', p_quantity,
    'unit_cost', v_unit_cost,
    'repack_out_movement_id', v_out_id,
    'repack_in_movement_id', v_in_id
  );
END;
$$;

COMMENT ON FUNCTION public.repack_stock(uuid, uuid, uuid, uuid, integer, text, uuid) IS
  'Atomic manual repacking of one variant''s 50ml stock at a warehouse. 50ml Old Box -> 50ml New Box only. Posts paired repack_out/repack_in movements under a shared RPK reference; preserves quantity and inventory value.';

REVOKE ALL ON FUNCTION public.repack_stock(uuid, uuid, uuid, uuid, integer, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.repack_stock(uuid, uuid, uuid, uuid, integer, text, uuid) TO authenticated, service_role;

COMMIT;
