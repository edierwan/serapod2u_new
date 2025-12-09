-- Migration: Fix D2H/S2D Order Allocation Flow
-- Description: 
-- 1. Allocation happens on order SUBMISSION (when status becomes 'submitted')
-- 2. Approval triggers FULFILLMENT (Release Allocation + Deduct Stock)
-- 3. Cancellation triggers DEALLOCATION (Release Allocation only)

-- Update orders_approve to call fulfill_order_inventory instead of allocate_inventory_for_order
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

-- Add comment to document the change
COMMENT ON FUNCTION public.orders_approve(uuid) IS 'Approves order and triggers fulfillment (release allocation + deduct stock) for D2H/S2D orders. Allocation happens on submission, not approval.';

-- Update the order status change trigger to handle D2H cancellation correctly
-- D2H orders are now allocated on submission, so we need to release allocation when cancelled
CREATE OR REPLACE FUNCTION public.handle_order_status_change()
RETURNS TRIGGER AS $$
BEGIN
    -- If status changed to 'cancelled'
    IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' THEN
        -- D2H and S2D: Both are allocated at submission, so release allocation if cancelled
        -- from submitted, approved, processing, or warehouse_packed status
        IF NEW.order_type IN ('D2H', 'S2D') AND OLD.status IN ('submitted', 'approved', 'processing', 'warehouse_packed') THEN
             PERFORM public.release_allocation_for_order(NEW.id);
        END IF;
    END IF;

    -- If status changed to 'shipped_distributor'
    IF NEW.status = 'shipped_distributor' AND OLD.status != 'shipped_distributor' THEN
        IF NEW.order_type IN ('D2H', 'S2D') THEN
             -- Fulfillment already handled by approval
             NULL; 
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate the trigger
DROP TRIGGER IF EXISTS on_order_status_change ON public.orders;
CREATE TRIGGER on_order_status_change
    AFTER UPDATE OF status ON public.orders
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_order_status_change();

COMMENT ON FUNCTION public.handle_order_status_change() IS 'Handles order status changes: releases allocation on cancel for D2H/S2D orders (both allocated on submission).';
