-- Migration: Fix Allocation Movement to Show Warehouse Location
-- Description: 
-- Movement records should show the warehouse location (where stock physically is),
-- not the buyer/distributor location. This fixes the confusion where allocation
-- movements were showing distributor locations with warehouse quantities.

-- Update allocate_inventory_for_order to log movements at warehouse location
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
        ORDER BY created_at ASC
        LIMIT 1;
        
        IF v_wh_id IS NOT NULL THEN
            v_inventory_org_id := v_wh_id;
        END IF;
    END IF;
    
    -- Allocate inventory for each order item
    FOR v_item IN 
        SELECT * FROM public.order_items WHERE order_id = p_order_id
    LOOP
        -- Get current inventory levels and cost
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
        -- Movement shows allocation AT THE WAREHOUSE (where physical stock is)
        INSERT INTO public.stock_movements (
            movement_type,
            reference_type,
            reference_id,
            reference_no,
            variant_id,
            organization_id,
            quantity_change,
            quantity_before,
            quantity_after,
            unit_cost,
            total_cost,
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
            v_inventory_org_id, -- Warehouse location (where stock is)
            v_item.qty, -- Positive (allocated amount)
            v_current_allocated, -- Allocated before this order
            v_current_allocated + v_item.qty, -- Allocated after this order
            COALESCE(v_unit_cost, 0),
            COALESCE(v_unit_cost, 0) * v_item.qty,
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
