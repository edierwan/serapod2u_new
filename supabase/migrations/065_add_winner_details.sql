-- Migration: 065_add_winner_details.sql

ALTER TABLE scratch_card_plays
ADD COLUMN IF NOT EXISTS consumer_email TEXT,
ADD COLUMN IF NOT EXISTS winner_details_submitted_at TIMESTAMPTZ;
