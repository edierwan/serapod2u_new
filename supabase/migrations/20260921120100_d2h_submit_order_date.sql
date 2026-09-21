-- ============================================================================
-- submit_and_allocate_d2h_order: persist the business SO date atomically
-- ----------------------------------------------------------------------------
-- Adds an optional 9th parameter, p_order_date date DEFAULT NULL, written to
-- orders.order_date inside the same transaction that creates the order,
-- inserts its lines, submits it and allocates inventory. Requires
-- 20260921120000_add_orders_order_date.sql.
--
-- Backward compatibility
--   PostgreSQL treats (8 args) and (9 args) as two different functions.
--   Keeping the old 8-arg function beside a 9-arg one with a default would make
--   every existing 8-argument named call ambiguous for PostgREST (both
--   candidates match) and break the dashboard, Serapp and the assistant.
--   The 8-arg signature is therefore DROPPED and replaced by the single 9-arg
--   function in one transaction. Every existing caller passes named arguments
--   without p_order_date, so it resolves to the new function unchanged and its
--   order gets today's date in Asia/Kuala_Lumpur.
--
-- Semantics
--   * p_order_date NULL  -> today in Asia/Kuala_Lumpur (never the UTC date).
--   * p_order_date > MYT today -> 'SO Date cannot be in the future.' (22023),
--     raised before anything is written.
--   * Only orders.order_date carries the business date. created_at,
--     updated_at, stock movements (allocate_inventory_for_order), notification
--     and timeline rows all keep their real now() timestamps.
--   * Order numbering (orders_before_insert / auto_generate_display_doc_no) is
--     untouched: a backdated SO still takes the next number in sequence.
--   * Idempotency, advisory locking, authorisation and validation are the
--     previous body unchanged apart from the order_date lines.
--
-- NOT applied automatically: run manually after review.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.submit_and_allocate_d2h_order(uuid, uuid, uuid, uuid, jsonb, text, uuid, text);

CREATE FUNCTION public.submit_and_allocate_d2h_order(
  p_company_id uuid,
  p_buyer_org_id uuid,
  p_seller_org_id uuid,
  p_fulfillment_warehouse_id uuid,
  p_items jsonb,
  p_notes text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_order_date date DEFAULT NULL
) RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := COALESCE(p_created_by, auth.uid());
  v_order public.orders%ROWTYPE;
  v_existing_id uuid;
  v_item jsonb;
  v_variant uuid;
  v_product uuid;
  v_qty integer;
  v_price numeric;
  v_buyer public.organizations%ROWTYPE;
  v_seller public.organizations%ROWTYPE;
  v_hq uuid;
  v_today date := (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date;
  v_order_date date := COALESCE(p_order_date, (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date);
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authenticated user is required';
  END IF;
  IF p_company_id IS NULL OR p_buyer_org_id IS NULL OR p_seller_org_id IS NULL THEN
    RAISE EXCEPTION 'Company, buyer and seller are required';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one order item is required';
  END IF;
  -- Business SO date: today or earlier in Malaysia, never the future. This is
  -- the authoritative check; the dashboard's <input max> is only a convenience.
  IF v_order_date > v_today THEN
    RAISE EXCEPTION 'SO Date cannot be in the future.'
      USING ERRCODE = '22023',
            DETAIL = format('p_order_date %s is after today (%s, Asia/Kuala_Lumpur).', v_order_date, v_today);
  END IF;

  IF p_idempotency_key IS NOT NULL AND length(trim(p_idempotency_key)) > 0 THEN
    SELECT order_id INTO v_existing_id
    FROM public.d2h_order_submit_idempotency
    WHERE idempotency_key = trim(p_idempotency_key);
    IF v_existing_id IS NOT NULL THEN
      SELECT * INTO v_order FROM public.orders WHERE id = v_existing_id;
      RETURN v_order;
    END IF;
  END IF;

  -- Serialize concurrent submits that target the same fulfillment warehouse stock.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', 'd2h-submit', p_seller_org_id::text, p_fulfillment_warehouse_id::text),
    0
  ));

  SELECT * INTO v_buyer FROM public.organizations WHERE id = p_buyer_org_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Buyer organization not found';
  END IF;
  SELECT * INTO v_seller FROM public.organizations WHERE id = p_seller_org_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller organization not found';
  END IF;
  IF v_buyer.org_type_code <> 'DIST' OR v_buyer.is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Buyer must be an active distributor';
  END IF;
  IF v_seller.org_type_code NOT IN ('HQ', 'WH') OR v_seller.is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Seller must be an active HQ or warehouse';
  END IF;

  v_hq := public.resolve_seller_hq_organization(p_seller_org_id);
  IF v_buyer.parent_org_id IS DISTINCT FROM v_hq THEN
    RAISE EXCEPTION 'Distributor is not under the seller HQ';
  END IF;

  PERFORM public.assert_hq_fulfillment_warehouse(p_seller_org_id, p_fulfillment_warehouse_id);

  IF auth.role() = 'authenticated' THEN
    IF NOT (public.is_hq_admin() OR public.can_access_org(p_seller_org_id) OR public.can_access_org(v_hq)) THEN
      RAISE EXCEPTION 'Not authorized to create this D2H order';
    END IF;
  END IF;

  INSERT INTO public.orders (
    order_type, company_id, buyer_org_id, seller_org_id,
    fulfillment_warehouse_id, status, has_rfid, has_points, has_lucky_draw,
    has_redeem, notes, created_by, order_date
  ) VALUES (
    'D2H', p_company_id, p_buyer_org_id, p_seller_org_id,
    p_fulfillment_warehouse_id, 'draft', false, true, true,
    true, p_notes, v_actor, v_order_date
  )
  RETURNING * INTO v_order;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_variant := NULLIF(v_item->>'variant_id', '')::uuid;
    v_product := NULLIF(v_item->>'product_id', '')::uuid;
    v_qty := (v_item->>'qty')::integer;
    v_price := (v_item->>'unit_price')::numeric;
    IF v_variant IS NULL OR v_product IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Each item requires product_id, variant_id and a positive qty';
    END IF;
    IF v_price IS NULL OR v_price <= 0 THEN
      RAISE EXCEPTION 'Each item requires a positive unit_price';
    END IF;

    INSERT INTO public.order_items (
      order_id, product_id, variant_id, qty, unit_price, company_id
    ) VALUES (
      v_order.id, v_product, v_variant, v_qty, v_price, p_company_id
    );
  END LOOP;

  UPDATE public.orders
  SET status = 'submitted',
      updated_by = v_actor,
      updated_at = now()
  WHERE id = v_order.id
  RETURNING * INTO v_order;

  PERFORM public.allocate_inventory_for_order(v_order.id);

  IF p_idempotency_key IS NOT NULL AND length(trim(p_idempotency_key)) > 0 THEN
    INSERT INTO public.d2h_order_submit_idempotency (idempotency_key, order_id, created_by)
    VALUES (trim(p_idempotency_key), v_order.id, v_actor)
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = v_order.id;
  RETURN v_order;
EXCEPTION
  WHEN unique_violation THEN
    -- Concurrent idempotent retry won the insert race.
    IF p_idempotency_key IS NOT NULL THEN
      SELECT o.* INTO v_order
      FROM public.d2h_order_submit_idempotency i
      JOIN public.orders o ON o.id = i.order_id
      WHERE i.idempotency_key = trim(p_idempotency_key);
      IF FOUND THEN
        RETURN v_order;
      END IF;
    END IF;
    RAISE;
END;
$$;

COMMENT ON FUNCTION public.submit_and_allocate_d2h_order(uuid, uuid, uuid, uuid, jsonb, text, uuid, text, date) IS
  'Atomically creates a D2H draft, inserts items, submits, and allocates inventory from the selected fulfillment warehouse. Rolls back entirely on failure. Optional idempotency_key prevents duplicate orders on retry. Optional p_order_date is the business SO date (default: today in Asia/Kuala_Lumpur; future dates rejected); created_at stays the real creation time.';

REVOKE ALL ON FUNCTION public.submit_and_allocate_d2h_order(uuid, uuid, uuid, uuid, jsonb, text, uuid, text, date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_and_allocate_d2h_order(uuid, uuid, uuid, uuid, jsonb, text, uuid, text, date)
  TO authenticated, service_role;

COMMIT;

-- PostgREST picks up the new signature on its next schema reload.
NOTIFY pgrst, 'reload schema';
