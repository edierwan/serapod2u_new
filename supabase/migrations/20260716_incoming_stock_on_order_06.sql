-- ============================================================================
-- Incoming / On Order stock (read-only) — 06
-- ============================================================================
-- Adds derived, read-only visibility of confirmed manufacturer (H2M) orders
-- that have not yet been fully received at the destination warehouse.
--
--   Incoming = SUM( GREATEST(ordered_qty - received_qty, 0) )
--
-- Scope   : company_id + destination warehouse + variant_id
-- Include : order_type = 'H2M', status IN ('approved', 'closed')
--           ('closed' means fully PAID, not fully received — goods may still
--            be inbound; fully received orders self-zero via the GREATEST clamp)
-- Exclude : draft / submitted / cancelled, D2H / S2D, warehouse transfers,
--           over-receipt (clamped), and two receipt-less full-receive flows:
--             * "Receive All" posts only a warehouse_receipts header row
--               (receipt_type = 'full', no warehouse_receipt_items)
--             * legacy QR-only receives completed before the receipt tables
--               existed (qr_batches.receiving_completed_at set, no items)
--
-- Received source of truth: warehouse_receipt_items (supports partial receiving).
--
-- This migration is READ-ONLY: no table changes, no status changes, no
-- inventory updates, no backfill. It only creates a resolver function,
-- three security-invoker views, and supporting indexes.
--
-- The TypeScript mirror of these rules lives in
-- app/src/lib/inventory/incoming-stock.ts — keep the two in sync.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Canonical destination-warehouse resolution
-- ----------------------------------------------------------------------------
-- Mirrors resolveWarehouseOrgId() used by warehouse receiving
-- (app/src/app/api/warehouse/confirm-receipt/route.ts and the receiving
-- worker): if the buyer org is an HQ, inventory is posted to its first active
-- WH child (by created_at); otherwise to the buyer org itself.
-- orders.warehouse_org_id is NOT authoritative for where stock lands — the
-- views below surface it as declared_warehouse_org_id with a mismatch flag
-- instead of silently trusting it.
CREATE OR REPLACE FUNCTION public.resolve_order_destination_warehouse(p_buyer_org_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT wh.id
      FROM public.organizations wh
      WHERE wh.parent_org_id = p_buyer_org_id
        AND wh.org_type_code = 'WH'
        AND wh.is_active = true
        AND EXISTS (
          SELECT 1 FROM public.organizations hq
          WHERE hq.id = p_buyer_org_id AND hq.org_type_code = 'HQ'
        )
      ORDER BY wh.created_at ASC
      LIMIT 1
    ),
    p_buyer_org_id
  );
$$;

COMMENT ON FUNCTION public.resolve_order_destination_warehouse(uuid) IS
  'Canonical destination warehouse for an order''s buyer org. Mirrors the warehouse receiving resolution (first active WH child of an HQ buyer, else the buyer org itself). Keep in sync with resolveWarehouseOrgId in the app.';

-- ----------------------------------------------------------------------------
-- 2. Supporting indexes (guarded; no-ops where they already exist)
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_orders_h2m_confirmed
  ON public.orders (company_id, buyer_org_id)
  WHERE order_type = 'H2M'
    AND status IN ('approved'::public.order_status, 'closed'::public.order_status);

CREATE INDEX IF NOT EXISTS warehouse_receipt_items_order_variant_idx
  ON public.warehouse_receipt_items (order_id, variant_id);

CREATE INDEX IF NOT EXISTS idx_qr_batches_order_created
  ON public.qr_batches (order_id, created_at);

CREATE INDEX IF NOT EXISTS idx_qr_master_codes_batch_status
  ON public.qr_master_codes (batch_id, status);

-- ----------------------------------------------------------------------------
-- 3. Per-order detail view
-- ----------------------------------------------------------------------------
-- One row per confirmed H2M order x ordered variant. security_invoker so the
-- caller's RLS on orders / order_items / warehouse_receipt* applies — company
-- and organization isolation come from the existing policies.
CREATE OR REPLACE VIEW public.v_incoming_stock_detail
WITH (security_invoker = true) AS
WITH h2m_orders AS (
  SELECT
    o.id,
    o.company_id,
    o.order_no,
    o.display_doc_no,
    o.status,
    o.approved_at,
    o.created_at,
    o.seller_org_id,
    o.buyer_org_id,
    o.warehouse_org_id AS declared_warehouse_org_id,
    public.resolve_order_destination_warehouse(o.buyer_org_id) AS destination_warehouse_org_id
  FROM public.orders o
  WHERE o.order_type = 'H2M'
    AND o.status IN ('approved'::public.order_status, 'closed'::public.order_status)
),
-- Ordered units per order + variant. order_items.qty is unit-level.
-- Grouped here so duplicate order_items rows for the same variant can never
-- double-count.
order_lines AS (
  SELECT
    oi.order_id,
    oi.variant_id,
    MIN(oi.product_id::text)::uuid AS product_id,
    SUM(oi.qty)::integer AS ordered_qty
  FROM public.order_items oi
  WHERE EXISTS (SELECT 1 FROM h2m_orders o WHERE o.id = oi.order_id)
  GROUP BY oi.order_id, oi.variant_id
),
-- Received units per order + variant (partial receiving source of truth).
received_lines AS (
  SELECT
    ri.order_id,
    ri.variant_id,
    SUM(ri.received_now)::integer AS received_qty
  FROM public.warehouse_receipt_items ri
  GROUP BY ri.order_id, ri.variant_id
),
order_flags AS (
  SELECT
    o.id AS order_id,
    EXISTS (
      SELECT 1 FROM public.warehouse_receipt_items ri WHERE ri.order_id = o.id
    ) AS has_receipt_items,
    EXISTS (
      SELECT 1 FROM public.warehouse_receipts wr
      WHERE wr.order_id = o.id
        AND wr.receipt_type = 'full'
        AND wr.posting_status = 'posted'
    ) AS full_receipt_posted,
    b.id AS batch_id,
    (b.receiving_completed_at IS NOT NULL OR b.receiving_status = 'completed') AS batch_completed,
    COALESCE(m.master_received, 0) AS master_received,
    COALESCE(m.master_in_transit, 0) AS master_in_transit,
    COALESCE(m.master_packed, 0) AS master_packed
  FROM h2m_orders o
  LEFT JOIN LATERAL (
    SELECT qb.id, qb.receiving_status, qb.receiving_completed_at
    FROM public.qr_batches qb
    WHERE qb.order_id = o.id
    ORDER BY qb.created_at ASC
    LIMIT 1
  ) b ON true
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) FILTER (WHERE qm.status = 'received_warehouse') AS master_received,
      COUNT(*) FILTER (WHERE qm.status IN ('ready_to_ship', 'in_transit')) AS master_in_transit,
      COUNT(*) FILTER (WHERE qm.status = 'packed') AS master_packed
    FROM public.qr_master_codes qm
    WHERE qm.batch_id = b.id
  ) m ON b.id IS NOT NULL
)
SELECT
  o.company_id,
  o.id AS order_id,
  o.order_no,
  o.display_doc_no,
  o.status AS order_status,
  o.approved_at,
  o.created_at AS order_created_at,
  o.seller_org_id AS manufacturer_org_id,
  mfg.org_name AS manufacturer_name,
  o.buyer_org_id,
  o.declared_warehouse_org_id,
  o.destination_warehouse_org_id,
  (
    o.declared_warehouse_org_id IS NOT NULL
    AND o.declared_warehouse_org_id <> o.destination_warehouse_org_id
  ) AS warehouse_mismatch,
  ol.variant_id,
  ol.product_id,
  ol.ordered_qty,
  COALESCE(rl.received_qty, 0) AS received_qty,
  CASE
    WHEN f.full_receipt_posted THEN 0
    WHEN NOT f.has_receipt_items AND f.batch_completed THEN 0
    ELSE GREATEST(ol.ordered_qty - COALESCE(rl.received_qty, 0), 0)
  END AS incoming_qty,
  CASE
    WHEN f.full_receipt_posted THEN 'full_receipt_posted'
    WHEN NOT f.has_receipt_items AND f.batch_completed THEN 'legacy_qr_completed'
    ELSE NULL
  END AS excluded_reason,
  CASE
    WHEN f.batch_id IS NULL THEN 'awaiting_qr_generation'
    WHEN f.batch_completed THEN 'receiving_completed'
    WHEN f.master_received > 0 THEN 'receiving_in_progress'
    WHEN f.master_in_transit > 0 THEN 'in_transit'
    WHEN f.master_packed > 0 THEN 'packing'
    ELSE 'qr_generated'
  END AS qr_stage
FROM h2m_orders o
JOIN order_lines ol ON ol.order_id = o.id
LEFT JOIN received_lines rl ON rl.order_id = o.id AND rl.variant_id = ol.variant_id
JOIN order_flags f ON f.order_id = o.id
LEFT JOIN public.organizations mfg ON mfg.id = o.seller_org_id;

COMMENT ON VIEW public.v_incoming_stock_detail IS
  'Per-order, per-variant incoming (on-order) stock for confirmed H2M orders. incoming_qty = GREATEST(ordered - received, 0), zeroed for posted full receipts and legacy QR-only completed receives (excluded_reason). Read-only.';

-- ----------------------------------------------------------------------------
-- 4. Aggregate view — the replenishment-facing number
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_incoming_stock
WITH (security_invoker = true) AS
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
HAVING SUM(d.incoming_qty) > 0;

COMMENT ON VIEW public.v_incoming_stock IS
  'Incoming (on-order) stock per company + destination warehouse + variant. Sum of GREATEST(ordered - received, 0) over confirmed H2M orders. Join to product_inventory on (organization_id, variant_id) to compute Inventory Position = quantity_available + incoming_qty. Read-only.';

-- ----------------------------------------------------------------------------
-- 5. Legacy diagnostic report (read-only; no automatic backfill)
-- ----------------------------------------------------------------------------
-- Confirmed H2M orders with NO warehouse_receipt_items history. Each row is
-- classified by the safe rule actually applied by the incoming views, so ops
-- can audit exactly which receipt-less orders are excluded vs still counted.
-- Review with:  SELECT * FROM public.v_incoming_stock_legacy_review;
CREATE OR REPLACE VIEW public.v_incoming_stock_legacy_review
WITH (security_invoker = true) AS
SELECT
  o.company_id,
  o.id AS order_id,
  o.order_no,
  o.display_doc_no,
  o.status AS order_status,
  o.approved_at,
  o.created_at AS order_created_at,
  EXTRACT(DAY FROM now() - COALESCE(o.approved_at, o.created_at))::integer AS order_age_days,
  o.buyer_org_id,
  o.seller_org_id AS manufacturer_org_id,
  o.warehouse_org_id AS declared_warehouse_org_id,
  public.resolve_order_destination_warehouse(o.buyer_org_id) AS destination_warehouse_org_id,
  (SELECT SUM(oi.qty)::integer FROM public.order_items oi WHERE oi.order_id = o.id) AS ordered_units,
  b.id AS batch_id,
  b.receiving_status,
  b.receiving_completed_at,
  COALESCE(m.master_total, 0) AS master_codes_total,
  COALESCE(m.master_received, 0) AS master_codes_received,
  EXISTS (
    SELECT 1 FROM public.warehouse_receipts wr
    WHERE wr.order_id = o.id AND wr.receipt_type = 'full' AND wr.posting_status = 'posted'
  ) AS full_receipt_posted,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM public.warehouse_receipts wr
      WHERE wr.order_id = o.id AND wr.receipt_type = 'full' AND wr.posting_status = 'posted'
    ) THEN 'excluded_full_receipt'
    WHEN b.receiving_completed_at IS NOT NULL OR b.receiving_status = 'completed'
      THEN 'excluded_legacy_qr_completed'
    ELSE 'counted_as_incoming'
  END AS classification
FROM public.orders o
LEFT JOIN LATERAL (
  SELECT qb.id, qb.receiving_status, qb.receiving_completed_at
  FROM public.qr_batches qb
  WHERE qb.order_id = o.id
  ORDER BY qb.created_at ASC
  LIMIT 1
) b ON true
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) AS master_total,
    COUNT(*) FILTER (WHERE qm.status = 'received_warehouse') AS master_received
  FROM public.qr_master_codes qm
  WHERE qm.batch_id = b.id
) m ON b.id IS NOT NULL
WHERE o.order_type = 'H2M'
  AND o.status IN ('approved'::public.order_status, 'closed'::public.order_status)
  AND NOT EXISTS (
    SELECT 1 FROM public.warehouse_receipt_items ri WHERE ri.order_id = o.id
  );

COMMENT ON VIEW public.v_incoming_stock_legacy_review IS
  'Diagnostic: confirmed H2M orders with no warehouse_receipt_items history, classified by whether the incoming views exclude them (posted full receipt / legacy QR-completed) or still count them as incoming. Read-only; no automatic backfill.';

-- ----------------------------------------------------------------------------
-- 6. Grants
-- ----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.resolve_order_destination_warehouse(uuid) TO authenticated;
GRANT SELECT ON public.v_incoming_stock_detail TO authenticated;
GRANT SELECT ON public.v_incoming_stock TO authenticated;
GRANT SELECT ON public.v_incoming_stock_legacy_review TO authenticated;
