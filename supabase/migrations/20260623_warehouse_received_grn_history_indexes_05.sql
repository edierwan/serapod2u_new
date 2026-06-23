-- ============================================================================
-- Warehouse Receive: GRN remarks + global history support (05)
-- ----------------------------------------------------------------------------
-- This migration is INDEX-ONLY and additive. It does NOT change any schema.
--
-- REMARKS (no schema change):
--   Receipt remarks reuse the existing public.warehouse_receipts.notes column.
--   That column is the *receipt remark* (delivery condition, shortage, damage,
--   supplier note...). It is distinct from public.stock_movements.notes, which
--   holds the technical movement note ("Warehouse receipt <GRN> (<type>)").
--   Both are preserved independently. No new column is added.
--
-- GLOBAL GOODS RECEIVED HISTORY:
--   The global history view lists GRNs across all orders for a company and
--   filters by date range / received_by / type / status. These indexes keep
--   that listing efficient as receipts grow. (Existing indexes already cover
--   order_id, batch_id, company_id, idempotency_key and (batch_id, receipt_no).)
--
-- GRN numbering is a DISPLAY-ONLY derivation (GRN-<display_doc_no>-<NN>); the
-- stored receipt_no (WR-...) and all FKs / IDs / movement links are unchanged.
-- No RLS change is required: history endpoints run with the service role and
-- filter by the caller's company id resolved via get_user_company_id().
--
-- Safe to rerun (IF NOT EXISTS). Non-destructive. Preserves all WR/GRN records.
--
-- ROLLBACK NOTES (manual):
--   DROP INDEX IF EXISTS public.warehouse_receipts_company_received_at_idx;
--   DROP INDEX IF EXISTS public.warehouse_receipts_received_by_idx;
--   DROP INDEX IF EXISTS public.warehouse_receipts_company_type_status_idx;
-- ============================================================================

BEGIN;

-- Global history default ordering: newest first within a company.
CREATE INDEX IF NOT EXISTS warehouse_receipts_company_received_at_idx
  ON public.warehouse_receipts (company_id, received_at DESC);

-- "Received By" filter.
CREATE INDEX IF NOT EXISTS warehouse_receipts_received_by_idx
  ON public.warehouse_receipts (received_by);

-- Type / posting-status filters within a company.
CREATE INDEX IF NOT EXISTS warehouse_receipts_company_type_status_idx
  ON public.warehouse_receipts (company_id, receipt_type, posting_status);

COMMENT ON COLUMN public.warehouse_receipts.notes IS
  'Receipt remark entered by warehouse staff (delivery condition / shortage / damage / supplier note). Distinct from stock_movements.notes.';

COMMIT;
