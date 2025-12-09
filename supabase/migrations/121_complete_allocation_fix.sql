-- Migration: Complete D2H/S2D Allocation Fix
-- Description: 
-- 1. Update orders_approve to call fulfill_order_inventory (release allocation + deduct stock)
-- 2. Update allocate_inventory_for_order to show warehouse location in movements
-- 3. Update cancel trigger to release allocation for D2H orders from 'submitted' status
-- 4. Fix unit_cost column name to average_cost

-- ============================================================================
-- PART 1: Update orders_approve function
-- ============================================================================
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

COMMENT ON FUNCTION public.orders_approve(uuid) IS 'Approves order and triggers fulfillment (release allocation + deduct stock) for D2H/S2D orders. Allocation happens on submission, not approval.';

-- ============================================================================
-- PART 2: Update allocate_inventory_for_order function
-- ============================================================================
CREATE OR REPLACE FUNCTION public.allocate_inventory_for_order(
    p_order_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_order record;
    v_item record;
    v_inventory_org_id uuid;
    v_seller_type text;
    v_wh_id uuid;
    v_current_on_hand integer;
    v_current_allocated integer;
    v_available integer;
    v_unit_cost numeric;
BEGIN
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order not found: %', p_order_id;
    END IF;
    
    IF v_order.order_type NOT IN ('D2H', 'S2D') THEN
        RETURN;
    END IF;
    
    v_inventory_org_id := v_order.seller_org_id;
    
    SELECT org_type_code INTO v_seller_type 
    FROM public.organizations 
    WHERE id = v_order.seller_org_id;
    
    IF v_seller_type = 'HQ' THEN
        SELECT id INTO v_wh_id 
        FROM public.organizations 
        WHERE parent_org_id = v_order.seller_org_id 
          AND org_type_code = 'WH' 
          AND is_active = true 
        ORDER BY created_at ASC
        LIMIT 1;
        
        IF v_wh_id IS NOT NULL THEN
            v_inventory_org_id := v_wh_id;
        END IF;
    END IF;
    
    FOR v_item IN 
        SELECT * FROM public.order_items WHERE order_id = p_order_id
    LOOP
        SELECT 
            quantity_on_hand, 
            quantity_allocated,
            (quantity_on_hand - quantity_allocated) as available,
            COALESCE(average_cost, 0)
        INTO v_current_on_hand, v_current_allocated, v_available, v_unit_cost
        FROM public.product_inventory
        WHERE variant_id = v_item.variant_id 
          AND organization_id = v_inventory_org_id
        FOR UPDATE;
        
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Inventory not found for variant % at organization %', 
                v_item.variant_id, v_inventory_org_id;
        END IF;
        
        IF v_available < v_item.qty THEN
            RAISE EXCEPTION 'Insufficient available stock for variant %. Available: %, Requested: %', 
                v_item.variant_id, v_available, v_item.qty;
        END IF;
        
        UPDATE public.product_inventory
        SET 
            quantity_allocated = quantity_allocated + v_item.qty,
            updated_at = now()
        WHERE variant_id = v_item.variant_id 
          AND organization_id = v_inventory_org_id;
        
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
            company_id,
            created_by,
            created_at,
            notes
        ) VALUES (
            'allocation',
            'order',
            v_order.id,
            v_order.order_no,
            v_item.variant_id,
            v_inventory_org_id,
            v_order.buyer_org_id,
            v_item.qty,
            v_current_allocated,
            v_current_allocated + v_item.qty,
            v_unit_cost,
            v_order.company_id,
            COALESCE(auth.uid(), v_order.created_by),
            now(),
            'Allocated ' || v_item.qty || ' units for order ' || v_order.order_no || 
            ' to ' || (SELECT org_name FROM public.organizations WHERE id = v_order.buyer_org_id LIMIT 1)
        );
    END LOOP;
END;
$$;

COMMENT ON FUNCTION public.allocate_inventory_for_order(uuid) IS 'Allocates inventory for D2H/S2D orders. Movement records show warehouse location (where stock is), not buyer location.';

-- ============================================================================
-- PART 3: Update cancel trigger to handle D2H from 'submitted' status
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_order_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' THEN
        -- D2H and S2D: Both are allocated at submission, so release allocation if cancelled
        IF NEW.order_type IN ('D2H', 'S2D') AND OLD.status IN ('submitted', 'approved', 'processing', 'warehouse_packed') THEN
             PERFORM public.release_allocation_for_order(NEW.id);
        END IF;
    END IF;

    IF NEW.status = 'shipped_distributor' AND OLD.status != 'shipped_distributor' THEN
        IF NEW.order_type IN ('D2H', 'S2D') THEN
             NULL; 
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_order_status_change ON public.orders;
CREATE TRIGGER on_order_status_change
    AFTER UPDATE OF status ON public.orders
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_order_status_change();

COMMENT ON FUNCTION public.handle_order_status_change() IS 'Handles order status changes: releases allocation on cancel for D2H/S2D orders (both allocated on submission).';

-- ============================================================================
-- PART 4: Update release_allocation_for_order function
-- ============================================================================
CREATE OR REPLACE FUNCTION public.release_allocation_for_order(
    p_order_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_order record;
    v_item record;
    v_inventory_org_id uuid;
    v_seller_type text;
    v_wh_id uuid;
    v_current_allocated integer;
    v_unit_cost numeric;
BEGIN
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order not found: %', p_order_id;
    END IF;
    
    IF v_order.order_type NOT IN ('D2H', 'S2D') THEN
        RETURN;
    END IF;
    
    v_inventory_org_id := v_order.seller_org_id;
    
    SELECT org_type_code INTO v_seller_type 
    FROM public.organizations 
    WHERE id = v_order.seller_org_id;
    
    IF v_seller_type = 'HQ' THEN
        SELECT id INTO v_wh_id 
        FROM public.organizations 
        WHERE parent_org_id = v_order.seller_org_id 
          AND org_type_code = 'WH' 
          AND is_active = true 
        ORDER BY created_at ASC
        LIMIT 1;
        
        IF v_wh_id IS NOT NULL THEN
            v_inventory_org_id := v_wh_id;
        END IF;
    END IF;
    
    FOR v_item IN 
        SELECT * FROM public.order_items WHERE order_id = p_order_id
    LOOP
        SELECT 
            quantity_allocated,
            COALESCE(average_cost, 0)
        INTO v_current_allocated, v_unit_cost
        FROM public.product_inventory
        WHERE variant_id = v_item.variant_id 
          AND organization_id = v_inventory_org_id
        FOR UPDATE;
        
        IF NOT FOUND THEN
            RAISE WARNING 'Inventory not found for variant % at organization %', 
                v_item.variant_id, v_inventory_org_id;
            CONTINUE;
        END IF;
        
        IF v_current_allocated < v_item.qty THEN
            RAISE WARNING 'Allocated quantity (%) is less than order quantity (%) for variant %', 
                v_current_allocated, v_item.qty, v_item.variant_id;
        END IF;
        
        UPDATE public.product_inventory
        SET 
            quantity_allocated = GREATEST(0, quantity_allocated - v_item.qty),
            updated_at = now()
        WHERE variant_id = v_item.variant_id 
          AND organization_id = v_inventory_org_id;
        
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
            company_id,
            created_by,
            created_at,
            notes
        ) VALUES (
            'deallocation',
            'order',
            v_order.id,
            v_order.order_no,
            v_item.variant_id,
            v_inventory_org_id,
            v_order.buyer_org_id,
            -v_item.qty,
            v_current_allocated,
            GREATEST(0, v_current_allocated - v_item.qty),
            v_unit_cost,
            v_order.company_id,
            COALESCE(auth.uid(), v_order.created_by),
            now(),
            'Released allocation for cancelled order ' || v_order.order_no
        );
    END LOOP;
END;
$$;

COMMENT ON FUNCTION public.release_allocation_for_order(uuid) IS 'Releases allocated inventory for D2H/S2D orders. Shows warehouse location in movements.';
