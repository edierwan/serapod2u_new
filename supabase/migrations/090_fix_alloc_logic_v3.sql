-- Migration: Fix Allocation Logic V3 (Correct Order)
-- Description: Drop constraint first, then update data, then add new constraint.

DO $$ 
BEGIN
    -- 1. Drop the existing constraint FIRST to allow updates
    ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS valid_quantity_change;

    -- 2. Update existing data to match new logic
    -- Flip allocation to negative (reducing available)
    UPDATE public.stock_movements 
    SET quantity_change = -ABS(quantity_change)
    WHERE movement_type = 'allocation' AND quantity_change > 0;

    -- Flip deallocation to positive (restoring available)
    UPDATE public.stock_movements 
    SET quantity_change = ABS(quantity_change)
    WHERE movement_type = 'deallocation' AND quantity_change < 0;

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
