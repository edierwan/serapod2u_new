-- ============================================================================
-- Incoming / On Order stock: warehouse transfers (read-only) — 07
-- ============================================================================
-- Extends the Incoming Stock layer (migration 06) with warehouse-to-warehouse
-- stock transfers that are confirmed and in transit to a destination warehouse.
--
--   Total Incoming     = Manufacturer Incoming + Transfer Incoming
--   Inventory Position = Available + Total Incoming
--
-- TRANSFER RULES (traced from the existing workflow):
--   stock_transfers.status ∈ ('pending','in_transit','received','cancelled').
--   The only creation path (StockTransferView) inserts transfers directly as
--   'in_transit' — nothing in the app creates 'pending', so 'in_transit' IS the
--   confirmed/left-source status. Items live in the stock_transfers.items
--   jsonb array ({variant_id, quantity, ...}); there is no items table.
--
--   IMPORTANT DOUBLE-COUNT GUARD: the current creation flow posts BOTH the
--   transfer_out (source) AND transfer_in (destination) stock movements
--   immediately at creation, so destination On Hand already includes the
--   transferred quantity while status is still 'in_transit'. A transfer line
--   therefore only counts as incoming while its destination transfer_in
--   movement has NOT been posted (destination_posted = false). With the
--   current flow that is zero rows — correct, because the stock is already in
--   destination Available. If/when the workflow is changed to post the
--   destination movement at receipt, in-transit transfers will automatically
--   start appearing as Transfer Incoming with no further schema work.
--
-- Include: status = 'in_transit', same company, destination = to_organization_id,
--          matching variant, destination movement not yet posted.
-- Exclude: pending (never left source), received, cancelled, self-transfers
--          (blocked by the no_self_transfer constraint), H2M manufacturer
--          orders (handled by migration 06), and any line whose destination
--          inventory posting already happened.
--
-- READ-ONLY: no table changes, no status changes, no inventory updates,
-- no historical backfill.
--
-- TypeScript mirror: app/src/lib/inventory/incoming-stock.ts — keep in sync.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Guarded indexes
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_stock_transfers_in_transit
  ON public.stock_transfers (company_id, to_organization_id)
  WHERE status = 'in_transit';

CREATE INDEX IF NOT EXISTS idx_stock_movements_transfer_in_ref
  ON public.stock_movements (reference_id, to_organization_id, variant_id)
  WHERE movement_type = 'transfer_in' AND reference_type = 'transfer';

-- ----------------------------------------------------------------------------
-- 2. Per-transfer detail view
-- ----------------------------------------------------------------------------
-- One row per in-transit transfer x variant. Quantities for duplicate variant
-- entries inside one transfer's items array are summed once (no double count).
CREATE OR REPLACE VIEW public.v_incoming_transfers_detail
WITH (security_invoker = true) AS
WITH transfer_lines AS (
  SELECT
    t.id AS transfer_id,
    t.company_id,
    t.transfer_no,
    t.status,
    t.from_organization_id,
    t.to_organization_id,
    t.created_at,
    t.shipped_at,
    t.received_at,
    (item.value ->> 'variant_id')::uuid AS variant_id,
    SUM(COALESCE((item.value ->> 'quantity')::numeric, 0))::integer AS quantity
  FROM public.stock_transfers t
  CROSS JOIN LATERAL jsonb_array_elements(t.items) AS item(value)
  WHERE t.status = 'in_transit'
    AND (item.value ->> 'variant_id') IS NOT NULL
  GROUP BY
    t.id, t.company_id, t.transfer_no, t.status,
    t.from_organization_id, t.to_organization_id,
    t.created_at, t.shipped_at, t.received_at,
    (item.value ->> 'variant_id')::uuid
)
SELECT
  tl.company_id,
  tl.transfer_id,
  tl.transfer_no,
  tl.status,
  tl.from_organization_id AS source_warehouse_org_id,
  src.org_name AS source_warehouse_name,
  tl.to_organization_id AS destination_warehouse_org_id,
  dst.org_name AS destination_warehouse_name,
  tl.variant_id,
  tl.quantity,
  COALESCE(tl.shipped_at, tl.created_at) AS dispatched_at,
  tl.received_at,
  EXISTS (
    SELECT 1
    FROM public.stock_movements sm
    WHERE sm.reference_type = 'transfer'
      AND sm.reference_id = tl.transfer_id
      AND sm.movement_type = 'transfer_in'
      AND sm.to_organization_id = tl.to_organization_id
      AND sm.variant_id = tl.variant_id
  ) AS destination_posted,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.stock_movements sm
      WHERE sm.reference_type = 'transfer'
        AND sm.reference_id = tl.transfer_id
        AND sm.movement_type = 'transfer_in'
        AND sm.to_organization_id = tl.to_organization_id
        AND sm.variant_id = tl.variant_id
    ) THEN 0
    ELSE tl.quantity
  END AS incoming_qty,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.stock_movements sm
      WHERE sm.reference_type = 'transfer'
        AND sm.reference_id = tl.transfer_id
        AND sm.movement_type = 'transfer_in'
        AND sm.to_organization_id = tl.to_organization_id
        AND sm.variant_id = tl.variant_id
    ) THEN 'destination_already_posted'
    ELSE NULL
  END AS excluded_reason
FROM transfer_lines tl
LEFT JOIN public.organizations src ON src.id = tl.from_organization_id
LEFT JOIN public.organizations dst ON dst.id = tl.to_organization_id;

COMMENT ON VIEW public.v_incoming_transfers_detail IS
  'Per-transfer, per-variant incoming stock from in-transit warehouse transfers. incoming_qty is zeroed once the destination transfer_in movement is posted (the current creation flow posts it immediately, so such lines are already inside destination On Hand). Read-only.';

-- ----------------------------------------------------------------------------
-- 3. Transfer aggregate
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_incoming_stock_transfers
WITH (security_invoker = true) AS
SELECT
  d.company_id,
  d.destination_warehouse_org_id,
  d.variant_id,
  SUM(d.incoming_qty)::integer AS incoming_qty,
  COUNT(DISTINCT d.transfer_id) FILTER (WHERE d.incoming_qty > 0)::integer AS in_transit_transfer_count
FROM public.v_incoming_transfers_detail d
GROUP BY d.company_id, d.destination_warehouse_org_id, d.variant_id
HAVING SUM(d.incoming_qty) > 0;

COMMENT ON VIEW public.v_incoming_stock_transfers IS
  'Transfer Incoming per company + destination warehouse + variant (in-transit warehouse transfers whose destination inventory posting has not happened yet). Read-only.';

-- ----------------------------------------------------------------------------
-- 4. Combined aggregate — v_incoming_stock now reports Total Incoming
-- ----------------------------------------------------------------------------
-- Recreated (not replaced) because the column list grows. The first seven
-- columns keep the exact names/order of migration 06 so existing consumers
-- keep working; incoming_qty is now Manufacturer + Transfer (Total Incoming),
-- with each source still independently traceable in the appended columns.
DROP VIEW IF EXISTS public.v_incoming_stock;

CREATE VIEW public.v_incoming_stock
WITH (security_invoker = true) AS
WITH mfg AS (
  SELECT
    d.company_id,
    d.destination_warehouse_org_id,
    d.variant_id,
    SUM(d.incoming_qty)::integer AS incoming_qty,
    COUNT(*) FILTER (WHERE d.incoming_qty > 0)::integer AS open_order_count,
    MIN(d.approved_at) FILTER (WHERE d.incoming_qty > 0) AS oldest_approved_at,
    BOOL_OR(d.warehouse_mismatch AND d.incoming_qty > 0) AS has_warehouse_mismatch
  FROM public.v_incoming_stock_detail d
  GROUP BY d.company_id, d.destination_warehouse_org_id, d.variant_id
  HAVING SUM(d.incoming_qty) > 0
),
tr AS (
  SELECT
    company_id,
    destination_warehouse_org_id,
    variant_id,
    incoming_qty,
    in_transit_transfer_count
  FROM public.v_incoming_stock_transfers
)
SELECT
  COALESCE(m.company_id, t.company_id) AS company_id,
  COALESCE(m.destination_warehouse_org_id, t.destination_warehouse_org_id) AS destination_warehouse_org_id,
  COALESCE(m.variant_id, t.variant_id) AS variant_id,
  (COALESCE(m.incoming_qty, 0) + COALESCE(t.incoming_qty, 0))::integer AS incoming_qty,
  COALESCE(m.open_order_count, 0) AS open_order_count,
  m.oldest_approved_at,
  COALESCE(m.has_warehouse_mismatch, false) AS has_warehouse_mismatch,
  COALESCE(m.incoming_qty, 0) AS manufacturer_incoming_qty,
  COALESCE(t.incoming_qty, 0) AS transfer_incoming_qty,
  COALESCE(t.in_transit_transfer_count, 0) AS in_transit_transfer_count
FROM mfg m
FULL OUTER JOIN tr t
  ON t.company_id = m.company_id
 AND t.destination_warehouse_org_id = m.destination_warehouse_org_id
 AND t.variant_id = m.variant_id;

COMMENT ON VIEW public.v_incoming_stock IS
  'Total Incoming (manufacturer H2M orders + in-transit warehouse transfers) per company + destination warehouse + variant. incoming_qty = manufacturer_incoming_qty + transfer_incoming_qty; each source stays independently traceable. Inventory Position = product_inventory.quantity_available + incoming_qty. Read-only.';

-- ----------------------------------------------------------------------------
-- 5. Grants
-- ----------------------------------------------------------------------------
GRANT SELECT ON public.v_incoming_transfers_detail TO authenticated;
GRANT SELECT ON public.v_incoming_stock_transfers TO authenticated;
GRANT SELECT ON public.v_incoming_stock TO authenticated;
