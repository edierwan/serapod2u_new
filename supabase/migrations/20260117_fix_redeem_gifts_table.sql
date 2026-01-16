-- Fix schema for Point Redeem Pool
-- Previous migration 20251227_add_point_redeem_pool.sql incorrectly targeted 'redemption_gifts' table 
-- instead of 'redeem_gifts' which is used by the application.
-- This migration applies the necessary schema changes to 'redeem_gifts'.

ALTER TABLE public.redeem_gifts
ADD COLUMN IF NOT EXISTS redeem_type text DEFAULT 'order', -- 'order' or 'master'
ADD COLUMN IF NOT EXISTS category text DEFAULT 'gift', -- 'gift' or 'point_pool'
ADD COLUMN IF NOT EXISTS points_per_collection integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_points_allocated integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS remaining_points integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS collection_option_1 boolean DEFAULT false, -- Option 1: Per user only
ADD COLUMN IF NOT EXISTS collection_option_2 boolean DEFAULT false, -- Option 2: Everyday
ADD COLUMN IF NOT EXISTS status text DEFAULT 'active', -- 'active', 'expired', 'scheduled'
ADD COLUMN IF NOT EXISTS start_date timestamptz,
ADD COLUMN IF NOT EXISTS end_date timestamptz;

-- Make order_id nullable for Master Redeem
ALTER TABLE public.redeem_gifts
ALTER COLUMN order_id DROP NOT NULL;

-- Create index
CREATE INDEX IF NOT EXISTS idx_redeem_gifts_status ON public.redeem_gifts(status);
