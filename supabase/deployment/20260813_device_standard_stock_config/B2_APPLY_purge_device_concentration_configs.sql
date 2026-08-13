-- ============================================================================
-- B2. APPLY — remove the invalid 20NB / 50NB / 50OB rows from Device variants.
--     Mirrors supabase/migrations/20260813120100_device_remove_concentration_stock_configs.sql
--     Run ONLY after B1 has committed.
-- ----------------------------------------------------------------------------
-- ⚠ EXPECTED OUTCOME ON PRODUCTION TODAY: THIS SCRIPT WILL ABORT.
--   A_PRECHECK classified all 36 Device 20NB/50NB/50OB rows as
--   BLOCKED_REFERENCED_LIQUID_CONFIG. Aborting is the correct, specified
--   behaviour — the script refuses to destroy history — and because B1 is a
--   separate, already-committed transaction, this abort changes nothing and
--   undoes nothing. Running it produces the authoritative list of records
--   requiring manual treatment.
--
-- WHY THE REFERENCES CANNOT SIMPLY BE MOVED
--   Consolidating (repointing a 20NB reference at the variant's Standard row)
--   is not provably safe:
--     * stock_count_session_items is UNIQUE (session_id, stock_config_id)
--       — index stock_count_session_items_session_config_unique_full;
--     * stock_count_session_scope's PRIMARY KEY is (session_id, stock_config_id).
--   The sessions that scoped these phantom rows also scoped the same variant's
--   generic row, so every repoint collides with a row that already exists.
--   Resolving a collision means merging or discarding counted rows, i.e.
--   rewriting stock-count history — a business decision, not a migration's.
--
-- REFERENCE COVERAGE
--   All ten FK columns that can point at a stock configuration are counted
--   (enumerated from pg_constraint, not assumed):
--     product_inventory, stock_movements, order_items, warehouse_receipt_items,
--     stock_adjustment_items, stock_count_session_items,
--     stock_count_session_scope,
--     stock_count_classification_allocation_resolutions (target_stock_config_id),
--     inventory_cutoff_decisions, inventory_cutoff_allocation_requests.
--   There is no non-FK reference to reconcile: every other '%stock_config%'
--   column in the schema is product_groups.stock_config_profile (a group
--   attribute) or order_items.stock_config_confirmed_at/by (audit stamps on the
--   row that already carries stock_config_id). Transfers and repacking carry
--   their configuration through stock_movements, which is covered.
--
-- ROLLBACK
--   Deleted rows are copied verbatim into
--   public._backup_device_stock_config_20260813 (backup_reason =
--   'purge_concentration_config') before the DELETE and can be re-inserted.
-- ============================================================================

BEGIN;

LOCK TABLE public.inventory_stock_configurations IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS public._backup_device_stock_config_20260813 (
  LIKE public.inventory_stock_configurations INCLUDING DEFAULTS
);
ALTER TABLE public._backup_device_stock_config_20260813
  ADD COLUMN IF NOT EXISTS backup_reason text,
  ADD COLUMN IF NOT EXISTS backed_up_at timestamptz NOT NULL DEFAULT now();

DO $purge$
DECLARE
  v_blocked      text;
  v_qty_before   bigint;  v_qty_after   bigint;
  v_alloc_before bigint;  v_alloc_after bigint;
  v_cart_before  integer; v_cart_after  integer;
  v_deleted      integer;
BEGIN
  SELECT COALESCE(sum(quantity_on_hand),0), COALESCE(sum(quantity_allocated),0)
    INTO v_qty_before, v_alloc_before FROM public.product_inventory;

  SELECT count(*) INTO v_cart_before
  FROM public.inventory_stock_configurations c
  JOIN public.product_variants pv ON pv.id = c.variant_id
  JOIN public.products p          ON p.id = pv.product_id
  JOIN public.product_groups g    ON g.id = p.group_id
  WHERE COALESCE(g.stock_config_profile,'standard') = 'concentration';

  DROP TABLE IF EXISTS _device_variants;
  CREATE TEMP TABLE _device_variants ON COMMIT DROP AS
  SELECT pv.id AS variant_id
  FROM public.product_variants pv
  JOIN public.products p       ON p.id = pv.product_id
  JOIN public.product_groups g ON g.id = p.group_id
  WHERE p.is_vape IS TRUE
    AND COALESCE(g.stock_config_profile, 'standard') = 'standard';

  DROP TABLE IF EXISTS _device_concentration_configs;
  CREATE TEMP TABLE _device_concentration_configs ON COMMIT DROP AS
  SELECT r.*,
         r.ref_product_inventory + r.ref_stock_movements + r.ref_order_items
       + r.ref_warehouse_receipt_items + r.ref_stock_adjustment_items
       + r.ref_stock_count_session_items + r.ref_stock_count_session_scope
       + r.ref_classification_resolutions + r.ref_cutoff_decisions
       + r.ref_cutoff_allocation_requests AS total_refs
  FROM (
    SELECT
      c.id, c.variant_id, c.config_code, c.status, c.volume_ml, c.packaging, c.stock_sku,
      (SELECT count(*) FROM public.product_inventory x                                 WHERE x.stock_config_id = c.id)        AS ref_product_inventory,
      (SELECT count(*) FROM public.stock_movements x                                   WHERE x.stock_config_id = c.id)        AS ref_stock_movements,
      (SELECT count(*) FROM public.order_items x                                       WHERE x.stock_config_id = c.id)        AS ref_order_items,
      (SELECT count(*) FROM public.warehouse_receipt_items x                           WHERE x.stock_config_id = c.id)        AS ref_warehouse_receipt_items,
      (SELECT count(*) FROM public.stock_adjustment_items x                            WHERE x.stock_config_id = c.id)        AS ref_stock_adjustment_items,
      (SELECT count(*) FROM public.stock_count_session_items x                         WHERE x.stock_config_id = c.id)        AS ref_stock_count_session_items,
      (SELECT count(*) FROM public.stock_count_session_scope x                         WHERE x.stock_config_id = c.id)        AS ref_stock_count_session_scope,
      (SELECT count(*) FROM public.stock_count_classification_allocation_resolutions x WHERE x.target_stock_config_id = c.id) AS ref_classification_resolutions,
      (SELECT count(*) FROM public.inventory_cutoff_decisions x                        WHERE x.stock_config_id = c.id)        AS ref_cutoff_decisions,
      (SELECT count(*) FROM public.inventory_cutoff_allocation_requests x              WHERE x.stock_config_id = c.id)        AS ref_cutoff_allocation_requests
    FROM public.inventory_stock_configurations c
    JOIN _device_variants d ON d.variant_id = c.variant_id
    WHERE c.config_code IN ('20NB','50NB','50OB')
       OR c.volume_ml IS NOT NULL
       OR c.packaging IS NOT NULL
  ) r;

  -- BLOCKED_REFERENCED_LIQUID_CONFIG — abort the ENTIRE transaction.
  SELECT string_agg(
           format('%s / %s (config %s, sku %s): product_inventory=%s stock_movements=%s order_items=%s warehouse_receipt_items=%s stock_adjustment_items=%s stock_count_session_items=%s stock_count_session_scope=%s classification_resolutions=%s cutoff_decisions=%s cutoff_allocation_requests=%s',
                  pv.variant_name, t.config_code, t.id, t.stock_sku,
                  t.ref_product_inventory, t.ref_stock_movements, t.ref_order_items,
                  t.ref_warehouse_receipt_items, t.ref_stock_adjustment_items,
                  t.ref_stock_count_session_items, t.ref_stock_count_session_scope,
                  t.ref_classification_resolutions, t.ref_cutoff_decisions,
                  t.ref_cutoff_allocation_requests),
           E'\n  ' ORDER BY pv.variant_name, t.config_code)
    INTO v_blocked
  FROM _device_concentration_configs t
  JOIN public.product_variants pv ON pv.id = t.variant_id
  WHERE t.total_refs > 0;

  IF v_blocked IS NOT NULL THEN
    RAISE EXCEPTION E'BLOCKED_REFERENCED_LIQUID_CONFIG: % Device concentration configuration(s) are still referenced and cannot be deleted without rewriting history. Manual treatment required for:\n  %',
      (SELECT count(*) FROM _device_concentration_configs WHERE total_refs > 0), v_blocked
      USING HINT = 'Decide per stock-count session whether the counted rows for these phantom configurations may be archived and removed, then re-run B2.';
  END IF;

  -- SAFE_DELETE_UNREFERENCED_LIQUID_CONFIG
  INSERT INTO public._backup_device_stock_config_20260813
  SELECT c.*, 'purge_concentration_config', now()
  FROM public.inventory_stock_configurations c
  JOIN _device_concentration_configs t ON t.id = c.id;

  DELETE FROM public.inventory_stock_configurations c
  USING _device_concentration_configs t
  WHERE c.id = t.id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- Verify BEFORE commit.
  IF EXISTS (
    SELECT 1 FROM public.inventory_stock_configurations c
    JOIN _device_variants d ON d.variant_id = c.variant_id
    WHERE c.config_code IN ('20NB','50NB','50OB')
       OR c.volume_ml IS NOT NULL OR c.packaging IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'POST_CHECK_FAILED: a Device variant still carries a concentration configuration.';
  END IF;

  SELECT string_agg(format('variant %s has %s configurations', variant_id, n), '; ')
    INTO v_blocked
  FROM (SELECT c.variant_id, count(*) AS n
        FROM public.inventory_stock_configurations c
        JOIN _device_variants d ON d.variant_id = c.variant_id
        GROUP BY c.variant_id HAVING count(*) <> 1) x;
  IF v_blocked IS NOT NULL THEN RAISE EXCEPTION 'POST_CHECK_FAILED: %', v_blocked; END IF;

  SELECT COALESCE(sum(quantity_on_hand),0), COALESCE(sum(quantity_allocated),0)
    INTO v_qty_after, v_alloc_after FROM public.product_inventory;
  IF v_qty_after <> v_qty_before OR v_alloc_after <> v_alloc_before THEN
    RAISE EXCEPTION 'POST_CHECK_FAILED: inventory changed (on_hand % -> %, allocated % -> %).',
      v_qty_before, v_qty_after, v_alloc_before, v_alloc_after;
  END IF;

  SELECT count(*) INTO v_cart_after
  FROM public.inventory_stock_configurations c
  JOIN public.product_variants pv ON pv.id = c.variant_id
  JOIN public.products p          ON p.id = pv.product_id
  JOIN public.product_groups g    ON g.id = p.group_id
  WHERE COALESCE(g.stock_config_profile,'standard') = 'concentration';
  IF v_cart_after <> v_cart_before THEN
    RAISE EXCEPTION 'POST_CHECK_FAILED: Cartridge configuration count changed (% -> %).', v_cart_before, v_cart_after;
  END IF;

  RAISE NOTICE 'Device concentration purge: % configuration row(s) deleted.', v_deleted;
END
$purge$;

-- Affected rows — exactly what was removed.
SELECT p.product_name, pv.variant_name, b.id AS stock_config_id,
       b.config_code, b.config_label, b.status, b.volume_ml, b.packaging, b.stock_sku
FROM public._backup_device_stock_config_20260813 b
JOIN public.product_variants pv ON pv.id = b.variant_id
JOIN public.products p          ON p.id = pv.product_id
WHERE b.backup_reason = 'purge_concentration_config'
  -- Only what THIS run deleted (backed_up_at defaults to transaction_timestamp).
  AND b.backed_up_at = transaction_timestamp()
ORDER BY p.product_name, pv.variant_name, b.config_code;

COMMIT;
