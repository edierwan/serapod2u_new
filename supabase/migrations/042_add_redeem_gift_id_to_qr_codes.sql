-- Migration: 042_add_redeem_gift_id_to_qr_codes.sql
-- Description: Add redeem_gift_id column to qr_codes table to track selected free gift

ALTER TABLE qr_codes
ADD COLUMN IF NOT EXISTS redeem_gift_id UUID REFERENCES redeem_gifts(id);

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_qr_codes_redeem_gift_id ON qr_codes(redeem_gift_id);
