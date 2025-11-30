-- Migration: 068_add_claim_details_to_plays.sql

ALTER TABLE scratch_card_plays
ADD COLUMN IF NOT EXISTS is_claimed BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS shop_id UUID REFERENCES organizations(id),
ADD COLUMN IF NOT EXISTS claim_details JSONB,
ADD COLUMN IF NOT EXISTS consumer_email TEXT;
