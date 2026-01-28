-- =============================================================================
-- Migration: Add SO document creation for D2H/S2D orders
-- =============================================================================
-- This migration updates the orders_approve function to create Sales Order (SO)
-- documents for D2H and S2D order types.
--
-- Workflow: SO → DO → Invoice → Payment → Receipt
-- =============================================================================

CREATE OR REPLACE FUNCTION public.orders_approve(p_order_id uuid) RETURNS public.orders
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v public.orders;
  v_user_org uuid;
  v_user_org_type text;
  v_can boolean := false;
  v_po_doc_no text;
  v_so_doc_no text;
  v_do_doc_no text;
  v_inv_doc_no text;
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
BEGIN
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

  IF v.order_type IN ('D2H', 'S2D') THEN
    FOR v_item IN SELECT * FROM public.order_items WHERE order_id = v.id LOOP
        SELECT 
            quantity_on_hand,
            quantity_allocated
        INTO v_current_qty, v_current_allocated
        FROM public.product_inventory
        WHERE variant_id = v_item.variant_id AND organization_id = v_inventory_org_id
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
        WHERE variant_id = v_item.variant_id AND organization_id = v_inventory_org_id;

        INSERT INTO public.product_inventory (organization_id, variant_id, quantity_on_hand)
        VALUES (v.buyer_org_id, v_item.variant_id, 0)
        ON CONFLICT (organization_id, variant_id) DO NOTHING;

        SELECT quantity_on_hand INTO v_buyer_current_qty
        FROM public.product_inventory
        WHERE variant_id = v_item.variant_id AND organization_id = v.buyer_org_id;

        UPDATE public.product_inventory
        SET quantity_on_hand = quantity_on_hand + v_item.qty,
            updated_at = now()
        WHERE variant_id = v_item.variant_id AND organization_id = v.buyer_org_id;

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
            created_at,
            notes
        ) VALUES (
            'transfer_in',
            'order',
            v.id,
            v.order_no,
            v_item.variant_id,
            v_inventory_org_id,
            v.buyer_org_id,
            v_item.qty,
            v_buyer_current_qty,
            v_buyer_current_qty + v_item.qty,
            v.company_id,
            auth.uid(),
            now(),
            'Order approved - stock received from seller'
        );

    END LOOP;
  END IF;

  -- Document Generation Logic
  IF v.order_type IN ('D2H', 'S2D') THEN
      -- Generate Sales Order (SO) FIRST for D2H/S2D workflow
      v_so_doc_no := 'SO' || v.order_no;
      INSERT INTO public.documents (
        company_id, order_id, doc_type, doc_no, status,
        issued_by_org_id, issued_to_org_id, created_by, created_at, updated_at
      ) VALUES (
        v.company_id, v.id, 'SO', v_so_doc_no, 'pending',
        v.seller_org_id, v.buyer_org_id, auth.uid(), now(), now()
      );

      -- Generate Delivery Order (DO)
      v_do_doc_no := 'DO' || v.order_no;
      INSERT INTO public.documents (
        company_id, order_id, doc_type, doc_no, status,
        issued_by_org_id, issued_to_org_id, created_by, created_at, updated_at
      ) VALUES (
        v.company_id, v.id, 'DO', v_do_doc_no, 'pending',
        v.seller_org_id, v.buyer_org_id, auth.uid(), now(), now()
      );

      -- Generate Invoice
      v_inv_doc_no := 'INV' || v.order_no;
      INSERT INTO public.documents (
        company_id, order_id, doc_type, doc_no, status,
        issued_by_org_id, issued_to_org_id, created_by, created_at, updated_at
      ) VALUES (
        v.company_id, v.id, 'INVOICE', v_inv_doc_no, 'pending',
        v.seller_org_id, v.buyer_org_id, auth.uid(), now(), now()
      );
  ELSE
      -- Standard H2M flow: Generate Purchase Order (PO)
      v_po_doc_no := 'PO' || v.order_no;
      INSERT INTO public.documents (
        company_id, order_id, doc_type, doc_no, status,
        issued_by_org_id, issued_to_org_id, created_by, created_at, updated_at
      ) VALUES (
        v.company_id, v.id, 'PO', v_po_doc_no, 'pending',
        v.buyer_org_id, v.seller_org_id, auth.uid(), now(), now()
      );
  END IF;

  -- Update order status
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

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.orders_approve(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.orders_approve(uuid) TO service_role;
