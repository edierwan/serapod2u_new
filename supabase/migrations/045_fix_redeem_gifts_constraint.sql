-- Migration: 045_fix_redeem_gifts_constraint.sql
-- Description: Fix check constraint to allow unlimited quantity (total_quantity = 0)

-- Drop the existing constraint if it exists
ALTER TABLE redeem_gifts DROP CONSTRAINT IF EXISTS redeem_gifts_quantity_check;

-- Add the corrected constraint
-- Allows claimed_quantity to exceed total_quantity ONLY if total_quantity is 0 (unlimited)
ALTER TABLE redeem_gifts ADD CONSTRAINT redeem_gifts_quantity_check 
CHECK (total_quantity = 0 OR claimed_quantity <= total_quantity);
