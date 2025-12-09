-- Migration: Add Delete Trigger for Stock Movements
-- Description: Ensure inventory is reverted when a stock movement is deleted (e.g. when an order is deleted)

CREATE OR REPLACE FUNCTION public.revert_inventory_on_movement_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_target_org uuid;
BEGIN
  -- Ignore zero deltas
  IF COALESCE(OLD.quantity_change,0) = 0 THEN
    RETURN OLD;
  END IF;

  -- Determine which organization's inventory was updated
  -- Logic mirrors stock_movements_apply_to_inventory and record_stock_movement
  IF OLD.quantity_change < 0 THEN
    v_target_org := COALESCE(OLD.from_organization_id, OLD.to_organization_id);
  ELSE
    v_target_org := COALESCE(OLD.to_organization_id, OLD.from_organization_id);
  END IF;

  IF v_target_org IS NULL THEN
    RETURN OLD;
  END IF;

  -- Revert the change
  -- If we added 100 (change +100), we need to subtract 100.
  -- If we removed 100 (change -100), we need to add 100.
  -- So we subtract OLD.quantity_change.

  UPDATE public.product_inventory
     SET quantity_on_hand = quantity_on_hand - OLD.quantity_change,
         updated_at       = NOW()
   WHERE variant_id = OLD.variant_id
     AND organization_id = v_target_org;

  RETURN OLD;
END
$function$;

DROP TRIGGER IF EXISTS on_movement_delete ON public.stock_movements;

CREATE TRIGGER on_movement_delete
    AFTER DELETE ON public.stock_movements
    FOR EACH ROW
    EXECUTE FUNCTION public.revert_inventory_on_movement_delete();
