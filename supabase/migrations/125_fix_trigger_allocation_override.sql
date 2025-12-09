-- Migration: Fix Trigger Overriding Allocation Display
-- Description:
-- The trigger trg_stock_movements_fill_cost_and_balance was overwriting quantity_after
-- with running balance calculations for ALL movements, including allocation/deallocation.
-- This caused allocation movements to show cumulative warehouse totals (132) instead of
-- per-order allocation amounts (31).
--
-- Fix: Skip the running balance calculation for allocation/deallocation movements,
-- as these should show per-order values, not warehouse inventory levels.

CREATE OR REPLACE FUNCTION public.trg_stock_movements_fill_cost_and_balance()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_wh_id uuid;
  v_prev_after integer;
  v_cost numeric;
BEGIN
  -- Determine warehouse context for running balance
  v_wh_id := public._movement_warehouse_id(NEW.movement_type, NEW.from_organization_id, NEW.to_organization_id);
  
  -- 2.3.a) Fill outbound cost if missing: use latest known unit_cost at this warehouse & variant
  IF NEW.unit_cost IS NULL
     AND NEW.movement_type IN ('manual_out','shipment','transfer_out') THEN
    SELECT sm.unit_cost
      INTO v_cost
      FROM public.stock_movements sm
     WHERE sm.from_organization_id = NEW.from_organization_id
       AND sm.variant_id = NEW.variant_id
       AND sm.unit_cost IS NOT NULL
       AND (sm.created_at, sm.id) < (COALESCE(NEW.created_at, now()), COALESCE(NEW.id, gen_random_uuid()))
     ORDER BY sm.created_at DESC, sm.id DESC
     LIMIT 1;

    NEW.unit_cost := COALESCE(v_cost, 0);
  END IF;

  -- 2.3.b) Compute running balance deterministically (prev_after + quantity_change)
  -- BUT: Skip for allocation/deallocation movements, as they show per-order values
  IF NEW.movement_type NOT IN ('allocation', 'deallocation') THEN
    -- Find the previous WAREHOUSE-LEVEL movement (skip allocation/deallocation)
    SELECT sm.quantity_after
      INTO v_prev_after
      FROM public.stock_movements sm
     WHERE public._movement_warehouse_id(sm.movement_type, sm.from_organization_id, sm.to_organization_id) = v_wh_id
       AND sm.variant_id = NEW.variant_id
       AND sm.movement_type NOT IN ('allocation', 'deallocation')
       AND (sm.created_at, sm.id) < (COALESCE(NEW.created_at, now()), COALESCE(NEW.id, gen_random_uuid()))
     ORDER BY sm.created_at DESC, sm.id DESC
     LIMIT 1;

    NEW.quantity_after := COALESCE(v_prev_after, 0) + COALESCE(NEW.quantity_change, 0);
  END IF;
  -- For allocation/deallocation, keep the quantity_after value set by the calling function

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.trg_stock_movements_fill_cost_and_balance() IS 'Fills cost and computes running balance for movements. Skips balance calculation for allocation/deallocation to preserve per-order display values.';
