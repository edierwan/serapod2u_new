-- ============================================================================
-- Warehouse Receive: RLS Policies (03)
-- ----------------------------------------------------------------------------
-- Locks the new receipt tables to the caller's company. Writes are expected to
-- flow through API routes using the service-role/admin client (which bypasses
-- RLS); these policies cover direct authenticated reads (receipt summary,
-- receipt history) and provide defence-in-depth for writes.
--
-- Uses the existing public.get_user_company_id() helper to resolve the caller's
-- company (HQ) org id, consistent with other tenant-scoped tables.
--
-- ROLLBACK NOTES (manual):
--   DROP POLICY IF EXISTS warehouse_receipts_select ON public.warehouse_receipts;
--   DROP POLICY IF EXISTS warehouse_receipts_write  ON public.warehouse_receipts;
--   DROP POLICY IF EXISTS warehouse_receipt_items_select ON public.warehouse_receipt_items;
--   DROP POLICY IF EXISTS warehouse_receipt_items_write  ON public.warehouse_receipt_items;
--   ALTER TABLE public.warehouse_receipts        DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.warehouse_receipt_items   DISABLE ROW LEVEL SECURITY;
-- ============================================================================

BEGIN;

ALTER TABLE public.warehouse_receipts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_receipt_items ENABLE ROW LEVEL SECURITY;

-- --------------------------- warehouse_receipts ----------------------------
DROP POLICY IF EXISTS warehouse_receipts_select ON public.warehouse_receipts;
CREATE POLICY warehouse_receipts_select
  ON public.warehouse_receipts
  FOR SELECT
  TO authenticated
  USING (company_id = public.get_user_company_id());

DROP POLICY IF EXISTS warehouse_receipts_write ON public.warehouse_receipts;
CREATE POLICY warehouse_receipts_write
  ON public.warehouse_receipts
  FOR ALL
  TO authenticated
  USING (company_id = public.get_user_company_id())
  WITH CHECK (company_id = public.get_user_company_id());

-- ------------------------ warehouse_receipt_items --------------------------
DROP POLICY IF EXISTS warehouse_receipt_items_select ON public.warehouse_receipt_items;
CREATE POLICY warehouse_receipt_items_select
  ON public.warehouse_receipt_items
  FOR SELECT
  TO authenticated
  USING (company_id = public.get_user_company_id());

DROP POLICY IF EXISTS warehouse_receipt_items_write ON public.warehouse_receipt_items;
CREATE POLICY warehouse_receipt_items_write
  ON public.warehouse_receipt_items
  FOR ALL
  TO authenticated
  USING (company_id = public.get_user_company_id())
  WITH CHECK (company_id = public.get_user_company_id());

COMMIT;
