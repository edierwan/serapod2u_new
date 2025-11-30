-- Migration: 057_fix_scratch_game_constraints.sql
-- Description: Update constraints to allow 'scratch_game' movement type and 'campaign' reference type

-- 1. Update valid_quantity_change constraint to allow scratch_game (can be positive or negative)
ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS valid_quantity_change;

ALTER TABLE public.stock_movements ADD CONSTRAINT valid_quantity_change 
CHECK (
    (movement_type IN ('addition', 'transfer_in', 'deallocation', 'order_cancelled', 'manual_in') AND quantity_change > 0)
    OR
    (movement_type IN ('adjustment', 'scratch_game') AND quantity_change <> 0)
    OR
    (movement_type IN ('transfer_out', 'allocation', 'order_fulfillment', 'manual_out') AND quantity_change < 0)
);

-- 2. Update stock_movements_reference_type_check to allow 'campaign'
ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_reference_type_check;

ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_reference_type_check 
CHECK (
    reference_type IN ('manual', 'order', 'transfer', 'adjustment', 'purchase_order', 'return', 'campaign')
);
