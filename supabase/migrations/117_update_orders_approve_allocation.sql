-- Migration: Update D2H Order Approval Logic
-- Description: 
-- 1. Update orders_approve to CALL allocate_inventory_for_order for D2H/S2D orders.
--    This means Approval = Allocation (Reservation).
--    Previously, orders_approve was doing "Fulfillment" (Deduction).
--    Now, we need to separate Approval (Allocation) from Fulfillment (Deduction).
--    BUT, if the user wants "Approve" to mean "Allocate", then we need another step for "Ship".
--    However, the user prompt says: "The Allocation inventory movement must be triggered ONLY when the order status changes from 'Pending Approval' to 'Approved'."
--    And "Deallocation ... when ... 'Fulfilled' or 'Shipped'".
--    So `orders_approve` should ONLY Allocate.

CREATE OR REPLACE FUNCTION public.orders_approve(p_order_id uuid) RETURNS public.orders
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v public.orders;
  v_user_org uuid;
  v_user_org_type text;
  v_can boolean := false;
  v_po_doc_no text;
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

  -- Handle inventory for D2H and S2D orders
  -- NEW LOGIC: Approval triggers Fulfillment (Release Allocation + Deduct Stock)
  -- Allocation already happened on order submission
  IF v.order_type IN ('D2H', 'S2D') THEN
      PERFORM public.fulfill_order_inventory(p_order_id);
  END IF;

  -- Generate Purchase Order Document for ALL order types
  v_po_doc_no := 'PO-' || v.order_no;
  
  BEGIN
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
  EXCEPTION
    WHEN unique_violation THEN
      -- PO already exists, skip
      NULL;
  END;
  
  -- Update order status to approved
  UPDATE public.orders
  SET 
    status = 'approved',
    approved_by = auth.uid(),
    approved_at = now(),
    updated_at = now()
  WHERE id = p_order_id
  RETURNING * INTO v;

  RETURN v;
END;
$$;
