-- Migration: Add Warranty Bonus Movement Type
-- Description: Update valid_quantity_change constraint to allow warranty_bonus movement type

DO $$ 
BEGIN
    -- 1. Drop the existing constraint
    ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS valid_quantity_change;

    -- 2. Add the updated constraint
    -- warranty_bonus: positive (increasing quantity)
    ALTER TABLE public.stock_movements ADD CONSTRAINT valid_quantity_change 
    CHECK (
        (movement_type IN ('addition', 'transfer_in', 'order_cancelled', 'manual_in', 'scratch_game_in', 'allocation', 'warranty_bonus') AND quantity_change > 0)
        OR
        (movement_type IN ('adjustment') AND quantity_change <> 0)
        OR
        (movement_type IN ('transfer_out', 'order_fulfillment', 'manual_out', 'scratch_game_out', 'deallocation') AND quantity_change < 0)
    );

END $$;
