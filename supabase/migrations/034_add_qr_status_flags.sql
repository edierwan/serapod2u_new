-- Add status flags to qr_codes table for robust state tracking
-- This prevents duplicate claims/entries by maintaining state on the unique QR code record

ALTER TABLE qr_codes 
ADD COLUMN IF NOT EXISTS is_redeemed BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS redeemed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS is_lucky_draw_entered BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS lucky_draw_entered_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS is_points_collected BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS points_collected_at TIMESTAMPTZ;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_qr_codes_status_flags ON qr_codes(is_redeemed, is_lucky_draw_entered, is_points_collected);

-- Comment on columns
COMMENT ON COLUMN qr_codes.is_redeemed IS 'Flag indicating if a gift has been redeemed for this QR code';
COMMENT ON COLUMN qr_codes.is_lucky_draw_entered IS 'Flag indicating if this QR code has been used for a lucky draw entry';
COMMENT ON COLUMN qr_codes.is_points_collected IS 'Flag indicating if points have been collected for this QR code';
