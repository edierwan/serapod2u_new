-- Migration: Fix Deallocation Movement Display
-- Description: 
-- Update release_allocation_for_order to show per-order deallocation (Before: qty, After: 0)
-- This matches the allocation logic (Before: 0, After: qty)

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
        
        -- We don't strictly need to check if allocated < qty because we are just releasing what we can.
        -- But good to warn.
        
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
            v_item.qty, -- Before: The allocated amount for this order
            0,          -- After: 0
            v_unit_cost,
            v_order.company_id,
            COALESCE(auth.uid(), v_order.created_by),
            now(),
            CASE 
                WHEN v_order.status = 'cancelled' THEN 'Order cancelled - allocation released for ' || v_order.order_no
                ELSE 'Order deleted - allocation reversed for ' || v_order.order_no
            END
        );
    END LOOP;
END;
$$;

COMMENT ON FUNCTION public.release_allocation_for_order(uuid) IS 'Releases allocated inventory for D2H/S2D orders. Shows per-order deallocation (Before: qty, After: 0).';
