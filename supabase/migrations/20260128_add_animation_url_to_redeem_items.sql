-- Migration: Add animation_url to redeem_items table
-- Date: 2026-01-28
-- Issue: Save failed - Could not find the 'animation_url' column of 'redeem_items' in the schema cache
-- The animation feature is optional for rewards, so this column is nullable

-- Add animation_url column to redeem_items
ALTER TABLE public.redeem_items
ADD COLUMN IF NOT EXISTS animation_url TEXT;

COMMENT ON COLUMN public.redeem_items.animation_url IS 'Optional URL to the storage path for reward animation (mp4/webm)';

-- Add display_duration column for animation timing if it doesn't exist
ALTER TABLE public.redeem_items
ADD COLUMN IF NOT EXISTS display_duration INTEGER DEFAULT 3;

COMMENT ON COLUMN public.redeem_items.display_duration IS 'Duration in seconds to display the animation, default 3 seconds';
