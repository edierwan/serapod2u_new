-- Migration: Track Consumer QR Code Scans for Journey Builder
-- Purpose: Track when consumers actually scan QR codes and interact with Journey Builder
-- This is separate from manufacturer scans (packed, shipped_distributor, etc.)

-- Create table to track consumer scans
CREATE TABLE IF NOT EXISTS consumer_qr_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  qr_code_id UUID NOT NULL REFERENCES qr_codes(id) ON DELETE CASCADE,
  consumer_id UUID REFERENCES users(id) ON DELETE SET NULL, -- Null if anonymous scan
  journey_config_id UUID REFERENCES journey_configurations(id) ON DELETE SET NULL,
  
  -- Scan details
  scanned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ip_address TEXT,
  user_agent TEXT,
  location_lat DECIMAL(10, 8),
  location_lng DECIMAL(11, 8),
  
  -- Journey interaction tracking
  viewed_welcome BOOLEAN DEFAULT true,
  collected_points BOOLEAN DEFAULT false,
  entered_lucky_draw BOOLEAN DEFAULT false,
  redeemed_gift BOOLEAN DEFAULT false,
  
  -- Points collection details (when user logs in to collect)
  points_collected_at TIMESTAMP WITH TIME ZONE,
  points_amount INTEGER,
  shop_id UUID REFERENCES organizations(id), -- Shop where points collected
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_consumer_qr_scans_qr_code_id ON consumer_qr_scans(qr_code_id);
CREATE INDEX IF NOT EXISTS idx_consumer_qr_scans_consumer_id ON consumer_qr_scans(consumer_id);
CREATE INDEX IF NOT EXISTS idx_consumer_qr_scans_journey_config_id ON consumer_qr_scans(journey_config_id);
CREATE INDEX IF NOT EXISTS idx_consumer_qr_scans_scanned_at ON consumer_qr_scans(scanned_at);
CREATE INDEX IF NOT EXISTS idx_consumer_qr_scans_collected_points ON consumer_qr_scans(collected_points) WHERE collected_points = true;

-- Add column to qr_codes table to track first consumer scan
ALTER TABLE qr_codes 
ADD COLUMN IF NOT EXISTS first_consumer_scan_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS total_consumer_scans INTEGER DEFAULT 0;

-- Create index
CREATE INDEX IF NOT EXISTS idx_qr_codes_first_consumer_scan ON qr_codes(first_consumer_scan_at) WHERE first_consumer_scan_at IS NOT NULL;

-- Function to update qr_codes when consumer scans
CREATE OR REPLACE FUNCTION update_qr_code_consumer_scan()
RETURNS TRIGGER AS $$
BEGIN
  -- Update the qr_codes table
  UPDATE qr_codes
  SET 
    total_consumer_scans = total_consumer_scans + 1,
    first_consumer_scan_at = COALESCE(first_consumer_scan_at, NEW.scanned_at),
    updated_at = NOW()
  WHERE id = NEW.qr_code_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update qr_codes table
DROP TRIGGER IF EXISTS trigger_update_qr_code_consumer_scan ON consumer_qr_scans;
CREATE TRIGGER trigger_update_qr_code_consumer_scan
  AFTER INSERT ON consumer_qr_scans
  FOR EACH ROW
  EXECUTE FUNCTION update_qr_code_consumer_scan();

-- Function to get consumer scan statistics for a journey/order
CREATE OR REPLACE FUNCTION get_consumer_scan_stats(p_order_id UUID)
RETURNS TABLE (
  total_qr_codes BIGINT,
  unique_consumer_scans BIGINT,
  total_consumer_scans BIGINT,
  points_collected_count BIGINT,
  lucky_draw_entries BIGINT,
  redemptions BIGINT,
  anonymous_scans BIGINT,
  authenticated_scans BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    -- Total QR codes for this order
    (SELECT COUNT(DISTINCT qc.id)
     FROM qr_codes qc
     JOIN qr_batches qb ON qb.id = qc.batch_id
     WHERE qb.order_id = p_order_id) AS total_qr_codes,
    
    -- Unique QR codes scanned by consumers
    (SELECT COUNT(DISTINCT cqs.qr_code_id)
     FROM consumer_qr_scans cqs
     JOIN qr_codes qc ON qc.id = cqs.qr_code_id
     JOIN qr_batches qb ON qb.id = qc.batch_id
     WHERE qb.order_id = p_order_id) AS unique_consumer_scans,
    
    -- Total consumer scans (including repeat scans)
    (SELECT COUNT(*)
     FROM consumer_qr_scans cqs
     JOIN qr_codes qc ON qc.id = cqs.qr_code_id
     JOIN qr_batches qb ON qb.id = qc.batch_id
     WHERE qb.order_id = p_order_id) AS total_consumer_scans,
    
    -- Points collected (user logged in and collected)
    (SELECT COUNT(*)
     FROM consumer_qr_scans cqs
     JOIN qr_codes qc ON qc.id = cqs.qr_code_id
     JOIN qr_batches qb ON qb.id = qc.batch_id
     WHERE qb.order_id = p_order_id
       AND cqs.collected_points = true) AS points_collected_count,
    
    -- Lucky draw entries
    (SELECT COUNT(*)
     FROM consumer_qr_scans cqs
     JOIN qr_codes qc ON qc.id = cqs.qr_code_id
     JOIN qr_batches qb ON qb.id = qc.batch_id
     WHERE qb.order_id = p_order_id
       AND cqs.entered_lucky_draw = true) AS lucky_draw_entries,
    
    -- Redemptions
    (SELECT COUNT(*)
     FROM consumer_qr_scans cqs
     JOIN qr_codes qc ON qc.id = cqs.qr_code_id
     JOIN qr_batches qb ON qb.id = qc.batch_id
     WHERE qb.order_id = p_order_id
       AND cqs.redeemed_gift = true) AS redemptions,
    
    -- Anonymous scans (no login)
    (SELECT COUNT(*)
     FROM consumer_qr_scans cqs
     JOIN qr_codes qc ON qc.id = cqs.qr_code_id
     JOIN qr_batches qb ON qb.id = qc.batch_id
     WHERE qb.order_id = p_order_id
       AND cqs.consumer_id IS NULL) AS anonymous_scans,
    
    -- Authenticated scans (with login)
    (SELECT COUNT(*)
     FROM consumer_qr_scans cqs
     JOIN qr_codes qc ON qc.id = cqs.qr_code_id
     JOIN qr_batches qb ON qb.id = qc.batch_id
     WHERE qb.order_id = p_order_id
       AND cqs.consumer_id IS NOT NULL) AS authenticated_scans;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON consumer_qr_scans TO authenticated;
GRANT SELECT, INSERT, UPDATE ON consumer_qr_scans TO anon;
-- Note: No sequence needed as we use UUID with gen_random_uuid()

-- Add RLS policies
ALTER TABLE consumer_qr_scans ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can insert consumer scans (for anonymous tracking)
CREATE POLICY "Anyone can record consumer scans"
  ON consumer_qr_scans
  FOR INSERT
  TO public
  WITH CHECK (true);

-- Policy: Users can view their own scans
CREATE POLICY "Users can view their own scans"
  ON consumer_qr_scans
  FOR SELECT
  TO authenticated
  USING (
    consumer_id = auth.uid()
    OR
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role_code IN ('SA', 'HQ', 'POWER_USER')
    )
  );

-- Policy: Admins can view all scans
CREATE POLICY "Admins can view all consumer scans"
  ON consumer_qr_scans
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role_code IN ('SA', 'HQ')
    )
  );

COMMENT ON TABLE consumer_qr_scans IS 'Tracks when consumers scan QR codes and interact with Journey Builder features';
COMMENT ON COLUMN consumer_qr_scans.qr_code_id IS 'The QR code that was scanned';
COMMENT ON COLUMN consumer_qr_scans.consumer_id IS 'User who scanned (NULL for anonymous scans)';
COMMENT ON COLUMN consumer_qr_scans.collected_points IS 'True when user logged in and collected points';
COMMENT ON COLUMN consumer_qr_scans.shop_id IS 'Shop where points were collected (for staff OTP verification)';
