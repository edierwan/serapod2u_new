-- Migration: Fix Allocation on Cancel/Delete
-- Description: 
-- 1. Update release_allocation_for_order to be idempotent (check for existing deallocation).
-- 2. Add trigger to call release_allocation_for_order when order status changes to 'cancelled'.

-- 1. Update release_allocation_for_order
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
    v_current_on_hand integer;
    v_current_allocated integer;
    v_available integer;
    v_allocation_exists boolean;
    v_deallocation_exists boolean;
BEGIN
    -- Get order details
    SELECT * INTO v_order
    FROM public.orders
    WHERE id = p_order_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order not found: %', p_order_id;
    END IF;
    
    -- Only process D2H and S2D orders
    IF v_order.order_type NOT IN ('D2H', 'S2D') THEN
        RETURN;
    END IF;

    -- Check if already deallocated
    SELECT EXISTS (
        SELECT 1 FROM public.stock_movements 
        WHERE reference_id = p_order_id 
          AND movement_type = 'deallocation'
    ) INTO v_deallocation_exists;

    IF v_deallocation_exists THEN
        RAISE NOTICE 'Order % is already deallocated. Skipping.', p_order_id;
        RETURN;
    END IF;

    -- Check if ever allocated (optional but safer)
    -- We assume if status is Draft/Submitted it MIGHT have been allocated.
    -- But checking for 'allocation' movement is the most robust way.
    SELECT EXISTS (
        SELECT 1 FROM public.stock_movements 
        WHERE reference_id = p_order_id 
          AND movement_type = 'allocation'
    ) INTO v_allocation_exists;

    IF NOT v_allocation_exists THEN
        RAISE NOTICE 'Order % has no allocation record. Skipping release.', p_order_id;
        RETURN;
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
    
    -- Release allocation for each order item
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
            RAISE WARNING 'Inventory not found for variant % at organization %', 
                v_item.variant_id, v_inventory_org_id;
            CONTINUE;
        END IF;
        
        -- Decrease allocated quantity
        UPDATE public.product_inventory
        SET 
            quantity_allocated = GREATEST(0, quantity_allocated - v_item.qty),
            updated_at = now()
        WHERE variant_id = v_item.variant_id 
          AND organization_id = v_inventory_org_id;
        
        -- Log the deallocation in stock movements
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
            'deallocation',
            'order',
            v_order.id,
            v_order.order_no,
            v_item.variant_id,
            v_inventory_org_id,
            NULL,
            v_item.qty, -- Positive change (Available increases)
            v_available, -- Before: Available
            v_available + v_item.qty, -- After: Available + qty
            v_order.company_id,
            auth.uid(),
            now(),
            'Inventory allocation released (Order Cancelled/Deleted)'
        );
    END LOOP;
    
END;
$$;

-- 2. Create Trigger Function
CREATE OR REPLACE FUNCTION public.handle_order_cancellation()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if status changed to cancelled
    -- Cast to text to avoid enum errors if 'cancelled' is not yet in the enum
    IF NEW.status::text = 'cancelled' AND OLD.status::text != 'cancelled' THEN
        PERFORM public.release_allocation_for_order(NEW.id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Create Trigger
DROP TRIGGER IF EXISTS trg_order_cancellation ON public.orders;
CREATE TRIGGER trg_order_cancellation
AFTER UPDATE OF status ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.handle_order_cancellation();
