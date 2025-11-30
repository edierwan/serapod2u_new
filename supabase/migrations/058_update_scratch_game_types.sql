-- Migration: 058_update_scratch_game_types.sql
-- Description: Rename 'scratch_game' to 'scratch_game_out' and add 'scratch_game_in'

DO $$ 
BEGIN
    -- 1. Update constraints on stock_movements table
    -- We need to drop the existing constraint and recreate it with new values
    ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check;
    ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS valid_quantity_change;

    -- 2. Update existing data
    -- Rename 'scratch_game' to 'scratch_game_out' for deductions (negative change)
    UPDATE public.stock_movements 
    SET movement_type = 'scratch_game_out' 
    WHERE movement_type = 'scratch_game' AND quantity_change < 0;

    -- Rename 'scratch_game' to 'scratch_game_in' for returns (positive change)
    UPDATE public.stock_movements 
    SET movement_type = 'scratch_game_in' 
    WHERE movement_type = 'scratch_game' AND quantity_change > 0;

    -- 3. Add new constraints
    ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_movement_type_check 
    CHECK (movement_type IN (
        'addition', 
        'adjustment', 
        'transfer_out', 
        'transfer_in', 
        'allocation', 
        'deallocation', 
        'order_fulfillment', 
        'order_cancelled', 
        'manual_in', 
        'manual_out',
        'scratch_game_out', -- Renamed from scratch_game (SG-)
        'scratch_game_in'   -- New type (SG+)
    ));

    -- Update valid_quantity_change to reflect directions
    -- scratch_game_out (SG-) -> quantity_change < 0 (Deduct from stock)
    -- scratch_game_in (SG+) -> quantity_change > 0 (Return to stock)
    ALTER TABLE public.stock_movements ADD CONSTRAINT valid_quantity_change 
    CHECK (
        (movement_type IN ('addition', 'transfer_in', 'deallocation', 'order_cancelled', 'manual_in', 'scratch_game_in') AND quantity_change > 0)
        OR
        (movement_type IN ('adjustment') AND quantity_change <> 0)
        OR
        (movement_type IN ('transfer_out', 'allocation', 'order_fulfillment', 'manual_out', 'scratch_game_out') AND quantity_change < 0)
    );

END $$;
