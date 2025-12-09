-- Migration: Fix Inventory Allocation Constraints
-- Description: Update valid_quantity_change constraint to allow positive allocation and negative deallocation
--              This aligns with 086_add_inventory_allocation_functions.sql which tracks changes to quantity_allocated

DO $$ 
BEGIN
    -- 1. Update existing data to match new constraints if any exist
    -- allocation should be positive (increasing quantity_allocated)
    UPDATE public.stock_movements 
    SET quantity_change = ABS(quantity_change)
    WHERE movement_type = 'allocation' AND quantity_change < 0;

    -- deallocation should be negative (decreasing quantity_allocated)
    UPDATE public.stock_movements 
    SET quantity_change = -ABS(quantity_change)
    WHERE movement_type = 'deallocation' AND quantity_change > 0;

    -- 2. Drop the existing constraint
    ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS valid_quantity_change;

    -- 3. Add the updated constraint
    -- allocation: positive (increasing quantity_allocated)
    -- deallocation: negative (decreasing quantity_allocated)
    ALTER TABLE public.stock_movements ADD CONSTRAINT valid_quantity_change 
    CHECK (
        (movement_type IN ('addition', 'transfer_in', 'order_cancelled', 'manual_in', 'scratch_game_in', 'allocation') AND quantity_change > 0)
        OR
        (movement_type IN ('adjustment') AND quantity_change <> 0)
        OR
        (movement_type IN ('transfer_out', 'order_fulfillment', 'manual_out', 'scratch_game_out', 'deallocation') AND quantity_change < 0)
    );

END $$;
