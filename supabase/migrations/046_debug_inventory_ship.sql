-- Migration: Debug Inventory Ship Adjustment
-- Redefines apply_inventory_ship_adjustment with detailed error logging
-- to diagnose "Insufficient stock" errors.

-- Drop first to avoid "cannot remove parameter defaults" error
DROP FUNCTION IF EXISTS public.apply_inventory_ship_adjustment(uuid, uuid, integer, integer, timestamp with time zone);

CREATE OR REPLACE FUNCTION public.apply_inventory_ship_adjustment(
  p_variant_id uuid,
  p_organization_id uuid,
  p_units integer,
  p_cases integer DEFAULT 0,
  p_shipped_at timestamp with time zone DEFAULT now()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_qty integer;
  v_org_name text;
  v_variant_name text;
BEGIN
  -- Get current quantity
  SELECT quantity_on_hand INTO v_current_qty
  FROM public.product_inventory
  WHERE variant_id = p_variant_id
    AND organization_id = p_organization_id
  FOR UPDATE;

  v_current_qty := COALESCE(v_current_qty, 0);

  -- Check if sufficient stock
  IF v_current_qty < p_units THEN
    -- Get names for better error message
    SELECT name INTO v_org_name FROM public.organizations WHERE id = p_organization_id;
    SELECT variant_name INTO v_variant_name FROM public.product_variants WHERE id = p_variant_id;
    
    RAISE EXCEPTION 'Insufficient stock for shipment. On hand: %, requested: %. Variant: % (%), Org: % (%)', 
      v_current_qty, p_units, COALESCE(v_variant_name, 'Unknown'), p_variant_id, COALESCE(v_org_name, 'Unknown'), p_organization_id;
  END IF;

  -- Update inventory
  UPDATE public.product_inventory
  SET 
    quantity_on_hand = quantity_on_hand - p_units,
    quantity_available = quantity_available - p_units,
    updated_at = now()
  WHERE variant_id = p_variant_id
    AND organization_id = p_organization_id;
    
  -- If no row was updated (shouldn't happen due to check above, but if row didn't exist), raise error
  IF NOT FOUND THEN
     SELECT name INTO v_org_name FROM public.organizations WHERE id = p_organization_id;
     SELECT variant_name INTO v_variant_name FROM public.product_variants WHERE id = p_variant_id;
     
     RAISE EXCEPTION 'Inventory record not found for Variant % (%) in Org % (%)', 
       COALESCE(v_variant_name, 'Unknown'), p_variant_id, COALESCE(v_org_name, 'Unknown'), p_organization_id;
  END IF;
END;
$$;
