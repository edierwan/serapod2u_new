-- Add receiving_status to qr_batches to track background receiving process
ALTER TABLE qr_batches
ADD COLUMN IF NOT EXISTS receiving_status text DEFAULT 'idle';

-- Add constraint for receiving_status
ALTER TABLE qr_batches DROP CONSTRAINT IF EXISTS qr_batches_receiving_status_check;
ALTER TABLE qr_batches 
ADD CONSTRAINT qr_batches_receiving_status_check 
CHECK (receiving_status IN ('idle', 'queued', 'processing', 'completed', 'failed'));

-- Index for faster worker lookup
CREATE INDEX IF NOT EXISTS idx_qr_batches_receiving_status ON qr_batches(receiving_status);
