-- Migration: Fix Orders Approve PO Generation
-- Description: Update orders_approve to generate a Purchase Order (PO) document when an order is approved.

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
  v_current_allocated integer;
  v_inventory_org_id uuid;
  v_seller_type text;
  v_wh_id uuid;
  v_buyer_current_qty integer;
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
      -- Allow if user is from Seller Org (Distributor or HQ acting as Seller)
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

  -- Determine inventory source
  v_inventory_org_id := v.seller_org_id;
  
  -- If seller is HQ, check for Warehouse
  SELECT org_type_code INTO v_seller_type FROM public.organizations WHERE id = v.seller_org_id;
  IF v_seller_type = 'HQ' THEN
      SELECT id INTO v_wh_id FROM public.organizations 
      WHERE parent_org_id = v.seller_org_id AND org_type_code = 'WH' AND is_active = true LIMIT 1;
      
      IF v_wh_id IS NOT NULL THEN
          v_inventory_org_id := v_wh_id;
      END IF;
  END IF;

  -- Handle inventory for D2H and S2D orders
  IF v.order_type IN ('D2H', 'S2D') THEN
    FOR v_item IN SELECT * FROM public.order_items WHERE order_id = v.id LOOP
        -- Get current inventory levels (including allocated)
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

        -- Check sufficient stock (should always pass since already allocated)
        IF v_current_qty < v_item.qty THEN
            RAISE EXCEPTION 'Insufficient stock for variant %. On hand: %, Needed: %', 
                v_item.variant_id, v_current_qty, v_item.qty;
        END IF;

        -- 1. SELLER SIDE: Release allocation AND deduct from on_hand
        UPDATE public.product_inventory
        SET 
            quantity_allocated = GREATEST(0, quantity_allocated - v_item.qty),
            quantity_on_hand = quantity_on_hand - v_item.qty,
            updated_at = now()
        WHERE variant_id = v_item.variant_id AND organization_id = v_inventory_org_id;

        -- 2. BUYER SIDE: Add inventory
        -- Ensure inventory record exists for Buyer
        INSERT INTO public.product_inventory (organization_id, variant_id, quantity_on_hand)
        VALUES (v.buyer_org_id, v_item.variant_id, 0)
        ON CONFLICT (organization_id, variant_id) DO NOTHING;

        -- Get current buyer qty
        SELECT quantity_on_hand INTO v_buyer_current_qty
        FROM public.product_inventory
        WHERE variant_id = v_item.variant_id AND organization_id = v.buyer_org_id;

        -- Update buyer inventory
        UPDATE public.product_inventory
        SET quantity_on_hand = quantity_on_hand + v_item.qty,
            updated_at = now()
        WHERE variant_id = v_item.variant_id AND organization_id = v.buyer_org_id;

        -- Log buyer movement
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

  -- Generate Purchase Order Document
  v_po_doc_no := 'PO-' || v.order_no;
  
  INSERT INTO public.documents (
    company_id,
    order_id,
    doc_type,
    doc_no,
    status,
    issued_by_org_id,
    issued_to_org_id,
    created_by,
    created_at,
    updated_at
  ) VALUES (
    v.company_id,
    v.id,
    'PO',
    v_po_doc_no,
    'pending',
    v.buyer_org_id,
    v.seller_org_id,
    auth.uid(),
    now(),
    now()
  );

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
