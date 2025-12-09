-- Add packing_status to qr_batches to track background packing process
ALTER TABLE qr_batches
ADD COLUMN IF NOT EXISTS packing_status text DEFAULT 'idle';

-- Add constraint for packing_status
ALTER TABLE qr_batches DROP CONSTRAINT IF EXISTS qr_batches_packing_status_check;
ALTER TABLE qr_batches 
ADD CONSTRAINT qr_batches_packing_status_check 
CHECK (packing_status IN ('idle', 'queued', 'processing', 'completed', 'failed'));

-- Index for faster worker lookup
CREATE INDEX IF NOT EXISTS idx_qr_batches_packing_status ON qr_batches(packing_status);
