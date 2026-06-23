-- ============================================================================
-- Warehouse Receive: Receipt Tracking (01)
-- ----------------------------------------------------------------------------
-- Adds audit/receipt structures that decouple "inventory posting" from the
-- existing QR worker. Every physical delivery (full or partial) is recorded as
-- a warehouse_receipt with line items, so one order can be received across
-- multiple sessions and still produce an accurate cumulative + extra count.
--
-- Companion migrations:
--   20260623_warehouse_received_inventory_posting_02.sql  (idempotent posting RPC)
--   20260623_warehouse_received_rls_policies_03.sql       (RLS)
--
-- ROLLBACK NOTES (manual):
--   DROP TABLE IF EXISTS public.warehouse_receipt_items;
--   DROP TABLE IF EXISTS public.warehouse_receipts;
--   ALTER TABLE public.qr_batches DROP COLUMN IF EXISTS receiving_mode;
--   DROP FUNCTION IF EXISTS public.next_warehouse_receipt_no(uuid);
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Tag each batch with the receiving mode chosen by the warehouse.
--    'full'    -> Receive All (Order + Buffer): worker posts inventory as today.
--    'partial' -> Actual count receive: worker only transitions QR statuses,
--                 inventory is posted from the submitted receipt quantities.
--    NULL      -> legacy batches (treated as 'full' for backward compatibility).
-- ----------------------------------------------------------------------------
ALTER TABLE public.qr_batches
  ADD COLUMN IF NOT EXISTS receiving_mode text;

COMMENT ON COLUMN public.qr_batches.receiving_mode IS
  'How this batch is being received: full (order+buffer via worker) or partial (inventory from submitted receipt quantities). NULL = legacy/full.';

-- ----------------------------------------------------------------------------
-- 2. warehouse_receipts: one row per confirmed delivery session.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.warehouse_receipts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL,
  order_id            uuid NOT NULL,
  batch_id            uuid NOT NULL,
  receipt_no          text NOT NULL,
  receipt_type        text NOT NULL CHECK (receipt_type IN ('full', 'partial')),
  -- Posting lifecycle of this receipt against inventory.
  posting_status      text NOT NULL DEFAULT 'posted'
                        CHECK (posting_status IN ('draft', 'posted', 'void')),
  total_received      integer NOT NULL DEFAULT 0,   -- sum of received_now on this receipt
  cumulative_received integer NOT NULL DEFAULT 0,   -- order-wide cumulative AFTER this receipt
  ordered_total       integer NOT NULL DEFAULT 0,   -- snapshot of ordered units at receipt time
  extra_received      integer NOT NULL DEFAULT 0,   -- units beyond ordered on this receipt
  notes               text,
  -- Idempotency guard: a client retry / double-click reuses the same key and
  -- the posting RPC returns the existing receipt instead of posting twice.
  idempotency_key     text,
  received_by         uuid,
  received_at         timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT warehouse_receipts_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES public.orders (id) ON DELETE CASCADE,
  CONSTRAINT warehouse_receipts_batch_id_fkey
    FOREIGN KEY (batch_id) REFERENCES public.qr_batches (id) ON DELETE CASCADE
);

-- One receipt_no per batch; one posted receipt per idempotency key.
CREATE UNIQUE INDEX IF NOT EXISTS warehouse_receipts_batch_no_uniq
  ON public.warehouse_receipts (batch_id, receipt_no);
CREATE UNIQUE INDEX IF NOT EXISTS warehouse_receipts_idempotency_uniq
  ON public.warehouse_receipts (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS warehouse_receipts_order_idx
  ON public.warehouse_receipts (order_id);
CREATE INDEX IF NOT EXISTS warehouse_receipts_batch_idx
  ON public.warehouse_receipts (batch_id);
CREATE INDEX IF NOT EXISTS warehouse_receipts_company_idx
  ON public.warehouse_receipts (company_id);

COMMENT ON TABLE public.warehouse_receipts IS
  'One row per confirmed warehouse receiving session (full or partial). Supports multiple receipts per order.';

-- ----------------------------------------------------------------------------
-- 3. warehouse_receipt_items: per-product/variant line of a receipt.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.warehouse_receipt_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id          uuid NOT NULL,
  company_id          uuid NOT NULL,
  order_id            uuid NOT NULL,
  batch_id            uuid NOT NULL,
  product_id          uuid,
  variant_id          uuid NOT NULL,
  ordered_qty         integer NOT NULL DEFAULT 0,
  previously_received integer NOT NULL DEFAULT 0,   -- cumulative for this variant BEFORE this receipt
  received_now        integer NOT NULL DEFAULT 0,   -- physically counted on this receipt
  cumulative_received integer NOT NULL DEFAULT 0,   -- previously_received + received_now
  extra_received      integer NOT NULL DEFAULT 0,   -- cumulative beyond ordered_qty
  -- Reference back to the inventory movement created for this line (audit trail).
  stock_movement_id   uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT warehouse_receipt_items_receipt_fkey
    FOREIGN KEY (receipt_id) REFERENCES public.warehouse_receipts (id) ON DELETE CASCADE,
  CONSTRAINT warehouse_receipt_items_received_now_nonneg
    CHECK (received_now >= 0)
);

CREATE INDEX IF NOT EXISTS warehouse_receipt_items_receipt_idx
  ON public.warehouse_receipt_items (receipt_id);
CREATE INDEX IF NOT EXISTS warehouse_receipt_items_order_idx
  ON public.warehouse_receipt_items (order_id);
CREATE INDEX IF NOT EXISTS warehouse_receipt_items_batch_idx
  ON public.warehouse_receipt_items (batch_id);
CREATE INDEX IF NOT EXISTS warehouse_receipt_items_variant_idx
  ON public.warehouse_receipt_items (variant_id);

COMMENT ON TABLE public.warehouse_receipt_items IS
  'Per-variant line items for a warehouse_receipt. received_now drives partial inventory posting.';

-- ----------------------------------------------------------------------------
-- 4. Helper: next sequential receipt number for a batch (e.g. WR-ORD123-01).
--    Counts existing receipts for the batch; callers should run this inside the
--    posting transaction (the RPC does) so numbering stays gap-free per batch.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.next_warehouse_receipt_no(p_batch_id uuid)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_seq      integer;
  v_order_no text;
BEGIN
  SELECT count(*) + 1 INTO v_seq
  FROM public.warehouse_receipts
  WHERE batch_id = p_batch_id;

  SELECT o.order_no INTO v_order_no
  FROM public.qr_batches b
  JOIN public.orders o ON o.id = b.order_id
  WHERE b.id = p_batch_id;

  RETURN 'WR-' || COALESCE(v_order_no, 'BATCH') || '-' || lpad(v_seq::text, 2, '0');
END;
$$;

COMMIT;
