-- Migration: 041_add_order_id_to_lucky_draw_entries.sql
-- Description: Add order_id column to lucky_draw_entries table

ALTER TABLE lucky_draw_entries
ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES orders(id);

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_lucky_draw_entries_order_id ON lucky_draw_entries(order_id);
