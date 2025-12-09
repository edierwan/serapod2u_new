CREATE OR REPLACE FUNCTION mark_batch_as_printed(p_batch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Update batch status
  UPDATE public.qr_batches
  SET 
    status = 'printing',
    updated_at = now()
  WHERE id = p_batch_id AND status = 'generated';

  -- Update master codes
  UPDATE public.qr_master_codes
  SET 
    status = 'printed',
    updated_at = now()
  WHERE batch_id = p_batch_id AND status = 'generated';

  -- Update unique codes
  UPDATE public.qr_codes
  SET 
    status = 'printed',
    updated_at = now()
  WHERE batch_id = p_batch_id AND status = 'generated';
END;
$$;
