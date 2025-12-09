-- Migration: 053_add_image_url_to_rewards.sql

ALTER TABLE scratch_card_rewards
ADD COLUMN IF NOT EXISTS image_url TEXT;
