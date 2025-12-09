CREATE OR REPLACE FUNCTION public.orders_approve(p_order_id uuid) RETURNS public.orders
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
BEGIN
  SELECT * INTO v FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF v.status <> 'submitted' THEN RAISE EXCEPTION 'Order must be in submitted'; END IF;

  SELECT organization_id INTO v_user_org FROM public.users WHERE id = auth.uid();
  v_user_org_type := public.get_org_type(v_user_org);

  -- Approval permissions
  CASE v.order_type
    WHEN 'H2M' THEN
      IF v_user_org_type='HQ' AND public.is_power_user() THEN v_can := true; END IF;
    WHEN 'D2H' THEN
      IF v_user_org_type='HQ' AND (public.is_power_user() OR
          EXISTS (SELECT 1 FROM pg_proc WHERE proname='is_hq_admin' AND pg_function_is_visible(oid) AND public.is_hq_admin())) THEN
        v_can := true;
      END IF;
    WHEN 'S2D' THEN
      IF v_user_org = v.seller_org_id AND public.is_power_user() THEN v_can := true; END IF;
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

  -- NEW LOGIC: Deduct inventory and log movement for D2H orders
  IF v.order_type = 'D2H' THEN
    FOR v_item IN SELECT * FROM public.order_items WHERE order_id = v.id LOOP
        -- Check current quantity
        SELECT quantity_on_hand INTO v_current_qty
        FROM public.product_inventory
        WHERE variant_id = v_item.variant_id AND organization_id = v.seller_org_id;

        IF v_current_qty IS NULL OR v_current_qty < v_item.qty THEN
            RAISE EXCEPTION 'Insufficient stock for variant %', v_item.variant_id;
        END IF;

        -- Deduct inventory
        UPDATE public.product_inventory
        SET quantity_on_hand = quantity_on_hand - v_item.qty,
            updated_at = now()
        WHERE variant_id = v_item.variant_id AND organization_id = v.seller_org_id;

        -- Log movement
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
            company_id,
            created_by,
            created_at
        ) VALUES (
            'order_fulfillment',
            'order',
            v.id,
            v.order_no,
            v_item.variant_id,
            v.seller_org_id,
            v.buyer_org_id,
            -v_item.qty,
            v_current_qty,
            v_current_qty - v_item.qty,
            v.company_id,
            auth.uid(),
            now()
        );
    END LOOP;
  END IF;

  UPDATE public.orders
     SET status='approved',
         approved_by=auth.uid(),
         approved_at=now(),
         updated_by=auth.uid(),
         updated_at=now()
   WHERE id=p_order_id
   RETURNING * INTO v;

  v_po_doc_no := public.format_doc_no_from_order('PO', v.order_no);
  INSERT INTO public.documents (
    order_id, doc_type, doc_no, status,
    issued_by_org_id, issued_to_org_id,
    company_id, created_by
  )
  VALUES (
    v.id, 'PO',
    v_po_doc_no,
    'pending',
    v.buyer_org_id,
    v.seller_org_id,
    v.company_id, auth.uid()
  );
  
  RETURN v;
END;
$$;
