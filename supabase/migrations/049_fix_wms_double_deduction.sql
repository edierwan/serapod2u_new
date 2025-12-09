-- Migration: Fix WMS Double Deduction
-- Moves the QR code status update INSIDE the WMS function to ensure
-- the skip_trigger variable works correctly within the same transaction/session.

CREATE OR REPLACE FUNCTION public.wms_ship_unique_auto(
  p_qr_code_ids uuid[], 
  p_from_org_id uuid, 
  p_to_org_id uuid, 
  p_order_id uuid, 
  p_shipped_at timestamp with time zone DEFAULT now()
) 
RETURNS jsonb
LANGUAGE plpgsql 
SECURITY DEFINER
AS $$
DECLARE
  v_payload jsonb;
  v_ids     jsonb;
BEGIN
  -- Step 1: Aggregate variant data from QR codes
  v_payload := public.wms_from_unique_codes(
    p_qr_code_ids, 
    p_from_org_id, 
    p_to_org_id, 
    p_order_id, 
    p_shipped_at
  );
  
  -- Step 2: Record consolidated stock movements and update inventory
  v_ids := public.wms_record_movements_from_items(v_payload);
  
  -- Step 3: Update QR codes status SAFELY (bypassing trigger)
  -- We set the session variable within this transaction block
  PERFORM set_config('app.skip_ship_trigger', 'true', true);
  
  UPDATE public.qr_codes
  SET 
    status = 'shipped_distributor',
    current_location_org_id = p_to_org_id,
    updated_at = p_shipped_at
  WHERE id = ANY(p_qr_code_ids)
    -- Only update if not already shipped (idempotency)
    AND status != 'shipped_distributor';
    
  -- Step 4: Return combined result
  RETURN (v_payload || v_ids);
END;
$$;
