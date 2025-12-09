-- Migration: Fix movement type constraint
-- Description: Drop the restrictive stock_movements_movement_type_check constraint and ensure valid_quantity_change handles it.

DO $$ 
BEGIN
    -- Drop the constraint that is blocking warranty_bonus
    ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check;

    -- Re-apply valid_quantity_change just in case, ensuring warranty_bonus is included
    ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS valid_quantity_change;
    
    ALTER TABLE public.stock_movements ADD CONSTRAINT valid_quantity_change 
    CHECK (
        (movement_type IN ('addition', 'transfer_in', 'order_cancelled', 'manual_in', 'scratch_game_in', 'allocation', 'warranty_bonus') AND quantity_change > 0)
        OR
        (movement_type IN ('adjustment') AND quantity_change <> 0)
        OR
        (movement_type IN ('transfer_out', 'order_fulfillment', 'manual_out', 'scratch_game_out', 'deallocation') AND quantity_change < 0)
    );

END $$;
