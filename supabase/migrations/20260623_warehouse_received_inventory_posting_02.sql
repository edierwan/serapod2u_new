-- ============================================================================
-- Warehouse Receive: Inventory Posting RPC (02)
-- ----------------------------------------------------------------------------
-- Idempotent posting of a warehouse receipt. This is the heart of the
-- decoupling: inventory is increased ONLY by the physically-counted quantities
-- supplied in p_items, never by the number of QR codes. The QR worker is now
-- responsible purely for QR/master status transitions (see worker route +
-- migration 01 receiving_mode flag).
--
-- Behaviour:
--   * Serialised per batch via an advisory lock so concurrent confirms cannot
--     race on receipt numbering or cumulative math.
--   * Idempotent on p_idempotency_key: a retry/double-click returns the
--     existing receipt and posts nothing new.
--   * Per item: posts an inventory 'addition' stock movement for received_now>0
--     using the existing record_stock_movement RPC, records the movement id for
--     audit, and computes cumulative + actual-extra-received.
--   * NO automatic warranty buffer is added (partial receiving). Excess over
--     ordered qty is surfaced as extra_received (actual manufacturer extra).
--
-- ROLLBACK NOTES (manual):
--   DROP FUNCTION IF EXISTS public.post_warehouse_receipt(
--     uuid, uuid, uuid, uuid, uuid, text, uuid, jsonb, text, text);
-- ============================================================================

BEGIN;

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
      SELECT public.record_stock_movement(
        p_movement_type   => 'addition',
        p_variant_id      => v_variant_id,
        p_organization_id => p_warehouse_org_id,
        p_quantity_change => v_received_now,
        p_unit_cost       => v_unit_cost,
        p_manufacturer_id => p_manufacturer_org_id,
        p_reason          => 'warehouse_receive',
        p_notes           => 'Warehouse receipt ' || v_receipt_no || ' (' || p_receipt_type || ')',
        p_reference_type  => 'warehouse_receipt',
        p_reference_id    => v_receipt_id,
        p_reference_no    => v_receipt_no,
        p_company_id      => p_company_id,
        p_created_by      => p_received_by
      ) INTO v_movement_id;
    END IF;

    INSERT INTO public.warehouse_receipt_items (
      receipt_id, company_id, order_id, batch_id, product_id, variant_id,
      ordered_qty, previously_received, received_now, cumulative_received,
      extra_received, stock_movement_id
    ) VALUES (
      v_receipt_id, p_company_id, p_order_id, p_batch_id, v_product_id, v_variant_id,
      v_ordered_qty, v_prev_received, v_received_now, v_cumulative,
      v_item_extra, v_movement_id
    );

    v_total_received := v_total_received + v_received_now;
    v_total_ordered := v_total_ordered + v_ordered_qty;
    v_total_extra_added := v_total_extra_added + GREATEST(0, v_item_extra_added);

    v_items_out := v_items_out || jsonb_build_object(
      'variant_id', v_variant_id,
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

COMMIT;
