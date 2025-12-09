-- Migration: Fix Allocation Logic to Track Available Stock
-- Description: 
-- 1. Update valid_quantity_change to allow negative allocation (reducing available) and positive deallocation (restoring available)
-- 2. Update allocate_inventory_for_order to log negative change and use Available stock for before/after
-- 3. Update release_allocation_for_order to log positive change and use Available stock for before/after
-- 4. Update orders_approve to ensure correct logging

DO $$ 
BEGIN
    -- 1. Update existing data to match new constraints
    -- We want allocation to be negative (reducing available)
    -- We want deallocation to be positive (restoring available)
    
    -- Flip allocation to negative if positive
    UPDATE public.stock_movements 
    SET quantity_change = -ABS(quantity_change)
    WHERE movement_type = 'allocation' AND quantity_change > 0;

    -- Flip deallocation to positive if negative
    UPDATE public.stock_movements 
    SET quantity_change = ABS(quantity_change)
    WHERE movement_type = 'deallocation' AND quantity_change < 0;

    -- 2. Drop the existing constraint
    ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS valid_quantity_change;

    -- 3. Add the updated constraint
    -- allocation: negative (reducing available)
    -- deallocation: positive (restoring available)
    ALTER TABLE public.stock_movements ADD CONSTRAINT valid_quantity_change 
    CHECK (
        (movement_type IN ('addition', 'transfer_in', 'order_cancelled', 'manual_in', 'scratch_game_in', 'deallocation') AND quantity_change > 0)
        OR
        (movement_type IN ('adjustment') AND quantity_change <> 0)
        OR
        (movement_type IN ('transfer_out', 'order_fulfillment', 'manual_out', 'scratch_game_out', 'allocation') AND quantity_change < 0)
    );

END $$;

-- 4. Update allocate_inventory_for_order
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
        -- IMPORTANT: 
        -- Change is NEGATIVE (reducing available)
        -- Before/After reflect AVAILABLE quantity
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
            NULL, -- Keep destination NULL to avoid showing it as a transfer to buyer
            -v_item.qty, -- Negative change (Available decreases)
            v_available, -- Before: Available
            v_available - v_item.qty, -- After: Available - qty
            v_order.company_id,
            COALESCE(auth.uid(), v_order.created_by),
            now(),
            'Inventory allocated for order'
        );
    END LOOP;
    
END;
$$;

-- 5. Update release_allocation_for_order
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
        
        -- Ensure we don't go negative
        IF v_current_allocated < v_item.qty THEN
            RAISE WARNING 'Allocated quantity (%) is less than order quantity (%) for variant %', 
                v_current_allocated, v_item.qty, v_item.variant_id;
        END IF;
        
        -- Decrease allocated quantity
        UPDATE public.product_inventory
        SET 
            quantity_allocated = GREATEST(0, quantity_allocated - v_item.qty),
            updated_at = now()
        WHERE variant_id = v_item.variant_id 
          AND organization_id = v_inventory_org_id;
        
        -- Log the deallocation in stock movements
        -- IMPORTANT:
        -- Change is POSITIVE (restoring available)
        -- Before/After reflect AVAILABLE quantity
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
            'Inventory allocation released'
        );
    END LOOP;
    
END;
$$;
