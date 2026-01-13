-- Migration: Add case_id to support_threads for user-friendly case numbering
-- Date: 2026-01-13
-- Format: CASE0001, CASE0002, etc. - per user numbering

-- ============================================
-- Add case_id column to support_threads
-- ============================================

-- Add the case_id column if it doesn't exist
ALTER TABLE public.support_threads 
ADD COLUMN IF NOT EXISTS case_id TEXT;

-- Create unique constraint for case_id (globally unique)
ALTER TABLE public.support_threads 
ADD CONSTRAINT support_threads_case_id_unique UNIQUE (case_id);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_support_threads_case_id 
ON public.support_threads(case_id);

-- ============================================
-- Create sequence for global case numbering
-- ============================================

-- Create a sequence for generating case numbers
CREATE SEQUENCE IF NOT EXISTS support_case_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MAXVALUE
    NO CYCLE;

-- ============================================
-- Function to generate next case_id
-- ============================================

CREATE OR REPLACE FUNCTION generate_support_case_id()
RETURNS TEXT AS $$
DECLARE
    next_num INTEGER;
BEGIN
    -- Get next sequence value
    SELECT nextval('support_case_number_seq') INTO next_num;
    -- Format as CASE0001, CASE0002, etc.
    RETURN 'CASE' || LPAD(next_num::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Trigger to auto-generate case_id on insert
-- ============================================

CREATE OR REPLACE FUNCTION trigger_set_case_id()
RETURNS TRIGGER AS $$
BEGIN
    -- Only set case_id if it's not already set
    IF NEW.case_id IS NULL THEN
        NEW.case_id := generate_support_case_id();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists and recreate
DROP TRIGGER IF EXISTS trg_support_threads_set_case_id ON public.support_threads;

CREATE TRIGGER trg_support_threads_set_case_id
    BEFORE INSERT ON public.support_threads
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_case_id();

-- ============================================
-- Backfill existing threads with case_id
-- ============================================

-- Update existing threads that don't have case_id
DO $$
DECLARE
    thread_record RECORD;
    counter INTEGER := 0;
BEGIN
    -- Get max existing case number to set sequence correctly
    SELECT COALESCE(MAX(
        CASE 
            WHEN case_id ~ '^CASE[0-9]+$' 
            THEN SUBSTRING(case_id FROM 5)::INTEGER 
            ELSE 0 
        END
    ), 0) INTO counter
    FROM public.support_threads
    WHERE case_id IS NOT NULL;
    
    -- Set sequence to start after max existing
    IF counter > 0 THEN
        PERFORM setval('support_case_number_seq', counter);
    END IF;
    
    -- Backfill threads without case_id
    FOR thread_record IN 
        SELECT id FROM public.support_threads 
        WHERE case_id IS NULL 
        ORDER BY created_at ASC
    LOOP
        UPDATE public.support_threads 
        SET case_id = generate_support_case_id()
        WHERE id = thread_record.id;
    END LOOP;
END $$;

-- ============================================
-- Comment on column
-- ============================================

COMMENT ON COLUMN public.support_threads.case_id IS 
'User-friendly case identifier in format CASE0001, CASE0002, etc. Auto-generated on thread creation.';
