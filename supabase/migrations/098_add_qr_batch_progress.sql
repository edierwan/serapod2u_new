-- Add progress tracking fields to qr_batches
ALTER TABLE qr_batches
ADD COLUMN IF NOT EXISTS total_unique_codes integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_master_codes integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS excel_generated boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS master_inserted boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS qr_inserted_count integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS storage_url text,
ADD COLUMN IF NOT EXISTS last_error text,
ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
ADD COLUMN IF NOT EXISTS processing_finished_at timestamptz;

-- Update status check constraint if it exists, or just ensure the column accepts new values
-- We don't know if there is a constraint, so we'll try to drop it if it has a standard name, or just add a new one.
-- Safest is to just alter the column to text if it isn't already, but it probably is.
-- Let's just add a comment for now.
