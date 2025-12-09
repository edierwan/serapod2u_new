-- Migration: Fix Inventory Logic and Double Deduction
-- Description: 
-- 1. Fix double deduction in orders_approve by removing order_fulfillment from trigger
-- 2. Ensure allocate_inventory_for_order uses correct quantities (allocated)
-- 3. Ensure orders_approve handles on_hand and allocated correctly
-- 4. Fix record_stock_movement double update for manual movements

-- 1. Update trigger function to exclude types handled by explicit functions
CREATE OR REPLACE FUNCTION public.stock_movements_apply_to_inventory()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_inventory_id uuid;
  v_before int;
  v_after  int;
  v_target_org uuid;
BEGIN
  -- Ignore zero deltas
  IF COALESCE(NEW.quantity_change,0) = 0 THEN
    RETURN NEW;
  END IF;

  -- Only handle types that are NOT handled by explicit functions or record_stock_movement
  -- Removed: manual_in, manual_out, order_fulfillment, warehouse_adjustment_in, warehouse_adjustment_out
  -- Kept: qr_ship, warehouse_receive (assuming these might rely on trigger)
  IF NEW.movement_type NOT IN ('qr_ship', 'warehouse_receive') THEN
    RETURN NEW;
  END IF;

  -- Determine which organization's inventory should be updated
  IF NEW.quantity_change < 0 THEN
    v_target_org := COALESCE(NEW.from_organization_id, NEW.to_organization_id);
  ELSE
    v_target_org := COALESCE(NEW.to_organization_id, NEW.from_organization_id);
  END IF;

  IF v_target_org IS NULL THEN
    RETURN NEW;
  END IF;

  -- Lock/ensure inventory row
  SELECT id, quantity_on_hand
  INTO v_inventory_id, v_before
  FROM public.product_inventory
  WHERE variant_id = NEW.variant_id
    AND organization_id = v_target_org
    AND is_active = true
  FOR UPDATE;

  IF v_inventory_id IS NULL THEN
    -- Create a fresh row if missing
    INSERT INTO public.product_inventory(
      variant_id, organization_id, quantity_on_hand,
      quantity_allocated, warehouse_location, average_cost,
      created_at, updated_at, is_active
    )
    VALUES(
      NEW.variant_id, v_target_org, 0,
      0, NEW.warehouse_location, NEW.unit_cost,
      NOW(), NOW(), true
    )
    RETURNING id, quantity_on_hand INTO v_inventory_id, v_before;
  END IF;

  v_after := GREATEST(0, v_before + NEW.quantity_change);

  UPDATE public.product_inventory
     SET quantity_on_hand = v_after,
         updated_at       = NOW()
   WHERE id = v_inventory_id;

  -- If the inserter didn't fill before/after, backfill for consistency
  IF NEW.quantity_before IS NULL OR NEW.quantity_after IS NULL THEN
    NEW.quantity_before := v_before;
    NEW.quantity_after  := v_after;
  END IF;

  RETURN NEW;
END
$function$;

-- 2. Re-define allocate_inventory_for_order to be absolutely sure
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
BEGIN
    -- Get order details
    SELECT * INTO v_order
    FROM public.orders
    WHERE id = p_order_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order not found: %', p_order_id;
    END IF;
    
    -- Only allocate for D2H and S2D orders
    IF v_order.order_type NOT IN ('D2H', 'S2D') THEN
        RETURN; -- No allocation needed for other order types
    END IF;
    
    -- Determine inventory source organization
    v_inventory_org_id := v_order.seller_org_id;
    
    -- If seller is HQ, check for Warehouse
    SELECT org_type_code INTO v_seller_type 
    FROM public.organizations 
    WHERE id = v_order.seller_org_id;
    
    IF v_seller_type = 'HQ' THEN
        SELECT id INTO v_wh_id 
        FROM public.organizations 
        WHERE parent_org_id = v_order.seller_org_id 
          AND org_type_code = 'WH' 
          AND is_active = true 
        LIMIT 1;
        
        IF v_wh_id IS NOT NULL THEN
            v_inventory_org_id := v_wh_id;
        END IF;
    END IF;
    
    -- Allocate inventory for each order item
    FOR v_item IN 
        SELECT * FROM public.order_items WHERE order_id = p_order_id
    LOOP
        -- Get current inventory levels
        SELECT 
            quantity_on_hand, 
            quantity_allocated,
            (quantity_on_hand - quantity_allocated) as available
        INTO v_current_on_hand, v_current_allocated, v_available
        FROM public.product_inventory
        WHERE variant_id = v_item.variant_id 
          AND organization_id = v_inventory_org_id
        FOR UPDATE;
        
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Inventory not found for variant % at organization %', 
                v_item.variant_id, v_inventory_org_id;
        END IF;
        
        -- Check if sufficient available stock
        IF v_available < v_item.qty THEN
            RAISE EXCEPTION 'Insufficient available stock for variant %. Available: %, Requested: %', 
                v_item.variant_id, v_available, v_item.qty;
        END IF;
        
        -- Increase allocated quantity
        UPDATE public.product_inventory
        SET 
            quantity_allocated = quantity_allocated + v_item.qty,
            updated_at = now()
        WHERE variant_id = v_item.variant_id 
          AND organization_id = v_inventory_org_id;
        
        -- Log the allocation in stock movements
        -- IMPORTANT: quantity_before/after reflect ALLOCATED quantity
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
            'allocation',
            'order',
            v_order.id,
            v_order.order_no,
            v_item.variant_id,
            v_inventory_org_id,
            v_order.buyer_org_id,
            v_item.qty, -- Positive for tracking allocated amount
            v_current_allocated,
            v_current_allocated + v_item.qty,
            v_order.company_id,
            COALESCE(auth.uid(), v_order.created_by),
            now(),
            'Inventory allocated for order'
        );
    END LOOP;
    
END;
$$;

-- 3. Re-define orders_approve to ensure correct on_hand deduction
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

        -- Log seller inventory movement (order fulfillment)
        -- IMPORTANT: quantity_before/after reflect ON HAND quantity
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
            'order_fulfillment',
            'order',
            v.id,
            v.order_no,
            v_item.variant_id,
            v_inventory_org_id,
            v.buyer_org_id,
            -v_item.qty,
            v_current_qty,
            v_current_qty - v_item.qty,
            v.company_id,
            auth.uid(),
            now(),
            'Order approved - stock shipped to buyer'
        );

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
