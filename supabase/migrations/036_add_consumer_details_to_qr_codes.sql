-- Migration: 036_add_consumer_details_to_qr_codes.sql
-- Description: Add consumer details columns to qr_codes table to track who activated/redeemed the code.

ALTER TABLE qr_codes
ADD COLUMN IF NOT EXISTS consumer_name TEXT,
ADD COLUMN IF NOT EXISTS consumer_phone TEXT,
ADD COLUMN IF NOT EXISTS consumer_email TEXT;

COMMENT ON COLUMN qr_codes.consumer_name IS 'Name of the consumer who activated/redeemed this QR code';
COMMENT ON COLUMN qr_codes.consumer_phone IS 'Phone number of the consumer who activated/redeemed this QR code';
COMMENT ON COLUMN qr_codes.consumer_email IS 'Email of the consumer who activated/redeemed this QR code';
