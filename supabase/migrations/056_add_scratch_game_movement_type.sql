-- Migration: 056_add_scratch_game_movement_type.sql
-- Description: Ensure 'scratch_game' is a valid movement_type in stock_movements

DO $$ 
BEGIN
    -- 1. Check if movement_type is an ENUM
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'stock_movement_type') THEN
        ALTER TYPE stock_movement_type ADD VALUE IF NOT EXISTS 'scratch_game';
    END IF;

    -- 2. Check if there's a check constraint on the table
    -- We look for a constraint that involves the movement_type column
    IF EXISTS (
        SELECT 1 
        FROM information_schema.check_constraints cc
        JOIN information_schema.constraint_column_usage ccu 
        ON cc.constraint_name = ccu.constraint_name
        WHERE ccu.table_name = 'stock_movements' 
        AND ccu.column_name = 'movement_type'
    ) THEN
        -- If a constraint exists, we should probably update it.
        -- However, since we can't easily know the exact name or existing values dynamically in a safe way without potentially breaking things,
        -- we will assume that if it's a text column, we might need to drop and recreate the constraint if we knew the name.
        -- For now, we'll just log a notice.
        RAISE NOTICE 'Check constraint exists on stock_movements.movement_type. Please verify it allows ''scratch_game''.';
        
        -- Attempt to drop and recreate common constraint names if they exist
        ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check;
        
        -- Re-add with all known types including scratch_game
        ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_movement_type_check 
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
            'scratch_game'
        ));
    END IF;
END $$;
