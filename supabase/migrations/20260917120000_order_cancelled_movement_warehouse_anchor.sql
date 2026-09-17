-- ============================================================================
-- Balance anchor for order_cancelled movements resolves to the destination
-- ----------------------------------------------------------------------------
-- Symptom (production): cancelling an approved D2H/S2D order fails with
--   Movement balance is not anchored to current inventory.
--   Current 2, before 1200, change 100, after 1300
--
-- Cause: release_allocation_for_order() reverses a fulfilled order by moving
-- the exact configuration back from the buyer to the warehouse, then posts:
--
--   transfer_out    buyer -> warehouse  -qty  buyer     before/after
--   order_cancelled buyer -> warehouse  +qty  warehouse before/after
--
-- trg_stock_movements_fill_cost_and_balance() checks both balance fields
-- against the product_inventory row of public._movement_warehouse_id().
-- order_cancelled was not listed, so it fell into COALESCE(p_from, p_to) and
-- resolved to the BUYER (from is always set). The warehouse balance
-- (1200 -> 1300) was compared with the buyer's on-hand (2) and the whole
-- cancellation rolled back.
--
-- Fix: order_cancelled is an inbound leg and anchors on p_to. Every other
-- mapping is unchanged (transfer_out -> p_from, transfer_in -> p_to, ...).
-- allocation/deallocation never read this function in the balance trigger.
--
-- idx_stock_movements_wh_variant_time is an expression index over this
-- IMMUTABLE function, so it is rebuilt here: existing order_cancelled rows
-- that carry both organisations would otherwise keep their old (buyer) key.
-- No movement, inventory, order or QR row is modified.
-- ============================================================================

begin;

create or replace function public._movement_warehouse_id(p_movement_type text, p_from uuid, p_to uuid)
returns uuid
language sql immutable
as $$
  SELECT CASE
           WHEN p_movement_type IN ('manual_out','shipment','transfer_out','repack_out') THEN p_from
           WHEN p_movement_type IN ('manual_in','purchase_in','transfer_in','adjust_in','repack_in','order_cancelled') THEN p_to
           ELSE COALESCE(p_from, p_to)
         END
$$;

-- The index exists in the deployed schema but is not created by a repository
-- migration, so rebuild it only where it is present.
do $$
begin
  if to_regclass('public.idx_stock_movements_wh_variant_time') is not null then
    execute 'reindex index public.idx_stock_movements_wh_variant_time';
  end if;
end $$;

commit;
