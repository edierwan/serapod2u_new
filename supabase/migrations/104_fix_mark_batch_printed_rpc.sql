-- Fix mark_batch_as_printed to abort if batch status update fails
-- This prevents race conditions with the worker

CREATE OR REPLACE FUNCTION mark_batch_as_printed(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '120s' -- Set explicit timeout of 2 minutes
AS $$
DECLARE
  v_batch_updated integer := 0;
  v_master_updated integer := 0;
  v_unique_updated integer := 0;
  v_chunk_size integer := 1000; -- Process 1000 codes at a time
  v_total_chunks integer := 0;
  v_processed_chunks integer := 0;
BEGIN
  -- Update batch status first (fast operation)
  UPDATE public.qr_batches
  SET 
    status = 'printing',
    updated_at = now()
  WHERE id = p_batch_id AND status = 'generated';
  
  GET DIAGNOSTICS v_batch_updated = ROW_COUNT;

  -- CRITICAL: If batch was not updated (e.g. it's processing or already printed), ABORT
  IF v_batch_updated = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Batch is not in generated status. It might be processing or already printed.',
      'batch_updated', 0,
      'master_codes_updated', 0,
      'unique_codes_updated', 0
    );
  END IF;

  -- Update master codes (typically small number)
  UPDATE public.qr_master_codes
  SET 
    status = 'printed',
    updated_at = now()
  WHERE batch_id = p_batch_id AND status = 'generated';
  
  GET DIAGNOSTICS v_master_updated = ROW_COUNT;

  -- Update unique codes in chunks to avoid timeout
  -- Use a cursor-based approach for better memory management
  LOOP
    -- Update one chunk at a time
    WITH codes_to_update AS (
      SELECT id
      FROM public.qr_codes
      WHERE batch_id = p_batch_id 
        AND status = 'generated'
      LIMIT v_chunk_size
    )
    UPDATE public.qr_codes
    SET 
      status = 'printed',
      updated_at = now()
    FROM codes_to_update
    WHERE qr_codes.id = codes_to_update.id;
    
    -- Check how many rows were updated
    GET DIAGNOSTICS v_processed_chunks = ROW_COUNT;
    v_unique_updated := v_unique_updated + v_processed_chunks;
    
    -- Exit loop if no more rows to update
    EXIT WHEN v_processed_chunks = 0;
    
    -- Optional: Add a small delay to reduce database load
    -- PERFORM pg_sleep(0.1);
  END LOOP;

  -- Return summary of updates
  RETURN jsonb_build_object(
    'success', true,
    'batch_updated', v_batch_updated,
    'master_codes_updated', v_master_updated,
    'unique_codes_updated', v_unique_updated,
    'message', format('Successfully updated batch and %s codes', v_unique_updated)
  );
  
EXCEPTION
  WHEN OTHERS THEN
    -- Return error information
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM,
      'error_code', SQLSTATE,
      'batch_updated', v_batch_updated,
      'master_codes_updated', v_master_updated,
      'unique_codes_updated', v_unique_updated
    );
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION mark_batch_as_printed(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION mark_batch_as_printed(uuid) TO anon;

-- Add comment for documentation
COMMENT ON FUNCTION mark_batch_as_printed IS 'Updates batch status to printing and marks all associated QR codes as printed. Aborts if batch is not in generated status.';
