-- Migration: 038_add_consumer_details_to_scans.sql
-- Description: Add consumer details columns to consumer_qr_scans table to support anonymous scanning with phone number.

ALTER TABLE consumer_qr_scans
ADD COLUMN IF NOT EXISTS consumer_name TEXT,
ADD COLUMN IF NOT EXISTS consumer_phone TEXT,
ADD COLUMN IF NOT EXISTS consumer_email TEXT;

COMMENT ON COLUMN consumer_qr_scans.consumer_name IS 'Name of the consumer (if anonymous/not logged in)';
COMMENT ON COLUMN consumer_qr_scans.consumer_phone IS 'Phone number of the consumer (if anonymous/not logged in)';
COMMENT ON COLUMN consumer_qr_scans.consumer_email IS 'Email of the consumer (if anonymous/not logged in)';
