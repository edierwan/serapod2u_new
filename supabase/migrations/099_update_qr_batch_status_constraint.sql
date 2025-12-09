-- Update the check constraint for qr_batches status to include new states
ALTER TABLE qr_batches DROP CONSTRAINT IF EXISTS qr_batches_status_check;

ALTER TABLE qr_batches 
ADD CONSTRAINT qr_batches_status_check 
CHECK (status IN ('pending', 'queued', 'processing', 'generated', 'printing', 'in_production', 'completed', 'failed'));
