-- Migration: Add Inventory Adjustment RPC
-- Used for auto-correcting inventory mismatches during shipment

CREATE OR REPLACE FUNCTION public.adjust_inventory_quantity(
  p_variant_id uuid,
  p_organization_id uuid,
  p_delta integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.product_inventory
  SET 
    quantity_on_hand = quantity_on_hand + p_delta,
    updated_at = now()
  WHERE variant_id = p_variant_id
    AND organization_id = p_organization_id;
    
  IF NOT FOUND THEN
    -- If record doesn't exist, create it (though it should exist if we have QR codes)
    INSERT INTO public.product_inventory (
      variant_id,
      organization_id,
      quantity_on_hand,
      quantity_reserved,
      quantity_available
    ) VALUES (
      p_variant_id,
      p_organization_id,
      GREATEST(p_delta, 0),
      0,
      GREATEST(p_delta, 0)
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.adjust_inventory_quantity TO authenticated, service_role;
