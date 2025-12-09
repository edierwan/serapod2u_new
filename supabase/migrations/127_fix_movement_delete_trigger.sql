-- Migration: Fix Stock Movement Deletion Trigger
-- Description:
-- The revert_inventory_on_movement_delete trigger was reverting inventory for ALL
-- deleted movements, including allocation/deallocation and movements from fulfilled orders.
-- This caused quantity_on_hand to go negative when deleting approved orders.
--
-- Fix: Skip reverting for:
-- 1. Allocation/deallocation movements (they don't affect quantity_on_hand)
-- 2. Movements from fulfilled orders (stock has already physically left)

CREATE OR REPLACE FUNCTION public.revert_inventory_on_movement_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_target_org uuid;
  v_order_status text;
BEGIN
  -- Ignore zero deltas
  IF COALESCE(OLD.quantity_change,0) = 0 THEN
    RETURN OLD;
  END IF;

  -- Skip allocation and deallocation movements
  -- These affect quantity_allocated, not quantity_on_hand
  IF OLD.movement_type IN ('allocation', 'deallocation') THEN
    RETURN OLD;
  END IF;

  -- Check if this movement is from a fulfilled order
  -- If so, don't revert - the stock has actually left the warehouse
  IF OLD.reference_type = 'order' AND OLD.reference_id IS NOT NULL THEN
    SELECT status INTO v_order_status
    FROM public.orders
    WHERE id = OLD.reference_id;
    
    IF v_order_status IN ('approved', 'warehouse_packed', 'shipped_distributor', 'fulfilled', 'completed') THEN
      -- Order was fulfilled, don't revert inventory
      RETURN OLD;
    END IF;
  END IF;

  -- Determine which organization's inventory was updated
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

COMMENT ON FUNCTION public.revert_inventory_on_movement_delete() IS 'Reverts inventory changes when stock movements are deleted. Skips allocation/deallocation and fulfilled orders.';
