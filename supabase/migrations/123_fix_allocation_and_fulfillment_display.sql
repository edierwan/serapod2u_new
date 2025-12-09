-- Migration: Fix Allocation and Fulfillment Movement Display
-- Description: 
-- 1. Update allocate_inventory_for_order to show per-order allocation (Before: 0, After: qty)
-- 2. Update fulfill_order_inventory to show actual warehouse stock levels (Before: OnHand, After: OnHand - qty)

-- ============================================================================
-- PART 1: Update allocate_inventory_for_order
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
        
        -- Log allocation movement
        -- Show per-order allocation: Before=0, After=qty
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
            v_inventory_org_id,  -- Warehouse (where stock is physically located)
            v_order.buyer_org_id, -- Buyer (who will receive the stock)
            v_item.qty,           -- Allocated quantity
            0,                    -- Before: 0 (per-order view)
            v_item.qty,           -- After: qty (per-order view)
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

COMMENT ON FUNCTION public.allocate_inventory_for_order(uuid) IS 'Allocates inventory for D2H/S2D orders. Movement shows warehouse location with per-order allocation (Before: 0, After: qty).';

-- ============================================================================
-- PART 2: Update fulfill_order_inventory
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fulfill_order_inventory(p_order_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_order record;
    v_item record;
    v_inventory_org_id uuid;
    v_seller_type text;
    v_wh_id uuid;
    v_current_on_hand integer;
    v_current_allocated integer;
    v_unit_cost numeric;
BEGIN
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
    
    -- Determine inventory source organization
    v_inventory_org_id := v_order.seller_org_id;
    
    SELECT org_type_code INTO v_seller_type FROM public.organizations WHERE id = v_order.seller_org_id;
    
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

    FOR v_item IN SELECT * FROM public.order_items WHERE order_id = p_order_id LOOP
        -- Fetch current inventory stats
        SELECT 
            quantity_on_hand,
            quantity_allocated,
            COALESCE(average_cost, 0)
        INTO v_current_on_hand, v_current_allocated, v_unit_cost
        FROM public.product_inventory
        WHERE variant_id = v_item.variant_id 
          AND organization_id = v_inventory_org_id
        FOR UPDATE;

        IF NOT FOUND THEN
             RAISE EXCEPTION 'Inventory not found for variant % at organization %', v_item.variant_id, v_inventory_org_id;
        END IF;

        -- 1. Release Allocation
        UPDATE public.product_inventory
        SET quantity_allocated = GREATEST(0, quantity_allocated - v_item.qty),
            updated_at = now()
        WHERE variant_id = v_item.variant_id AND organization_id = v_inventory_org_id;

        -- 2. Deduct On Hand
        UPDATE public.product_inventory
        SET quantity_on_hand = quantity_on_hand - v_item.qty,
            updated_at = now()
        WHERE variant_id = v_item.variant_id AND organization_id = v_inventory_org_id;

        -- 3. Log Fulfillment (Deduction)
        -- Show actual warehouse stock levels
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
            'order_fulfillment',
            'order',
            v_order.id,
            v_order.order_no,
            v_item.variant_id,
            v_inventory_org_id,
            v_order.buyer_org_id,
            -v_item.qty,
            v_current_on_hand,              -- Before: Actual On Hand
            v_current_on_hand - v_item.qty, -- After: New On Hand
            v_unit_cost,
            v_order.company_id,
            auth.uid(),
            now(),
            'Order Fulfilled/Shipped'
        );
    END LOOP;
END;
$$;

COMMENT ON FUNCTION public.fulfill_order_inventory(uuid) IS 'Fulfills order: releases allocation, deducts stock, and logs movement with actual warehouse stock levels.';
