-- Migration: Add entry_unit and entered_quantity columns to return_case_items
-- Purpose: Support Pcs/Box mode persistence for the Return Product worksheet.
--
-- entry_unit: 'pcs' | 'box' — the mode the user was using when entering quantity.
-- entered_quantity: The raw quantity entered by the user in the selected mode.
--   - In Pcs mode: the total piece count
--   - In Box mode: the box count (extra pieces are stored separately if needed,
--     but for simplicity we store the total pieces here as well, since the
--     breakdown can be recomputed from case_qty + loose_piece_qty)
--
-- These columns are additive and optional. Existing data is unaffected.
-- The worksheet can restore using a sensible default (Pcs mode) while preserving
-- the correct total quantity and normalized Box/Pcs values.
--
-- This migration is NOT executed. It is provided for reference only.

-- ALTER TABLE public.return_case_items
--     ADD COLUMN IF NOT EXISTS entry_unit text NOT NULL DEFAULT 'pcs'
--         CHECK (entry_unit IN ('pcs', 'box'));

-- ALTER TABLE public.return_case_items
--     ADD COLUMN IF NOT EXISTS entered_quantity integer NOT NULL DEFAULT 0
--         CHECK (entered_quantity >= 0);

-- COMMENT ON COLUMN public.return_case_items.entry_unit IS
--     'The quantity entry mode used by the user: pcs or box. Defaults to pcs.';

-- COMMENT ON COLUMN public.return_case_items.entered_quantity IS
--     'The raw quantity entered by the user in the selected mode. In Pcs mode this is the total piece count; in Box mode this is the box count.';
