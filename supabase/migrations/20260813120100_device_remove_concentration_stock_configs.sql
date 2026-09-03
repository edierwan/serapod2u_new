-- ============================================================================
-- Remove invalid concentration stock configurations from Device variants (2/2)
-- ----------------------------------------------------------------------------
-- CONTEXT
--   20NB (20ml New Box), 50NB (50ml New Box) and 50OB (50ml Old Box) describe
--   a liquid's nicotine volume and its box packaging version. They are valid
--   ONLY for Cartridge/liquid variants — i.e. variants whose product group has
--   stock_config_profile = 'concentration'. A Device (S.Box / S.Line) has no
--   volume and no box version: it must carry exactly ONE dimensionless
--   Standard configuration and nothing else.
--
--   `_enable_variant_stock_configurations_core()` was applied to Device
--   variants during the Cellera rollout and created those three rows anyway.
--   20260727 later deactivated them, but "inactive" is not the invariant the
--   business wants: the rows must not exist at all. This migration deletes
--   them — but only where deleting them provably destroys no history.
--
-- SAFETY CONTRACT (deliberately strict — see the abort behaviour below)
--   A Device concentration configuration is deleted ONLY when the reference
--   count is zero in EVERY table that can point at a stock configuration. The
--   full set was enumerated from the live catalog rather than assumed
--   (`pg_constraint` where confrelid = inventory_stock_configurations):
--
--     product_inventory                                  (id, variant_id)
--     stock_movements                                    (id, variant_id)
--     order_items                                        (id, variant_id) RESTRICT
--     warehouse_receipt_items                            (id, variant_id)
--     stock_adjustment_items                             (id, variant_id)
--     stock_count_session_items                          (id, variant_id)
--     stock_count_session_scope                          (id)
--     stock_count_classification_allocation_resolutions  (target_..., variant_id)
--     inventory_cutoff_decisions                         (id)
--     inventory_cutoff_allocation_requests               (id)
--
--   There is no non-FK / logical reference to reconcile: every column in the
--   public schema whose name matches '%stock_config%' is either one of the FK
--   columns above, `product_groups.stock_config_profile` (a group attribute),
--   or `order_items.stock_config_confirmed_at/by` (audit stamps on the row
--   that already carries stock_config_id). Stock transfers and repacking carry
--   their configuration through `stock_movements`, which is covered.
--
--   Reference CONSOLIDATION (repointing a 20NB reference at the variant's
--   generic STD row) is NOT attempted, because it is not provably safe here:
--     * stock_count_session_items is UNIQUE (session_id, stock_config_id)
--       (index stock_count_session_items_session_config_unique_full), and
--     * stock_count_session_scope's PRIMARY KEY is (session_id, stock_config_id).
--   Whenever a session that scoped a Device 20NB/50NB/50OB row also scoped that
--   variant's generic row — which is exactly how the classification and
--   opening-balance sessions were built — repointing collides with the existing
--   row. Resolving the collision means merging or discarding counted rows, i.e.
--   rewriting stock-count history. That is a business decision, not a
--   migration's, so this transaction ABORTS and reports instead.
--
-- ABORT BEHAVIOUR
--   If ANY Device concentration configuration still has a reference, the whole
--   transaction raises and rolls back, naming every affected variant and
--   configuration together with its per-table reference counts. Nothing is
--   partially deleted. Because the in-place Standard repair lives in the
--   separate, earlier transaction 20260813120000, an abort here never undoes
--   the repair that restores sellability.
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
  v_blocked     text;
  v_qty_before  bigint;
  v_qty_after   bigint;
  v_alloc_before bigint;
  v_alloc_after  bigint;
  v_cart_before integer;
  v_cart_after  integer;
  v_deleted     integer;
BEGIN
  SELECT COALESCE(sum(quantity_on_hand), 0), COALESCE(sum(quantity_allocated), 0)
    INTO v_qty_before, v_alloc_before
  FROM public.product_inventory;

  SELECT count(*) INTO v_cart_before
  FROM public.inventory_stock_configurations c
  JOIN public.product_variants pv ON pv.id = c.variant_id
  JOIN public.products p          ON p.id = pv.product_id
  JOIN public.product_groups g    ON g.id = p.group_id
  WHERE COALESCE(g.stock_config_profile, 'standard') = 'concentration';

  -- Device variants, resolved structurally (never by product/variant name).
  DROP TABLE IF EXISTS _device_variants;
  CREATE TEMP TABLE _device_variants ON COMMIT DROP AS
  SELECT pv.id AS variant_id
  FROM public.product_variants pv
  JOIN public.products p       ON p.id = pv.product_id
  JOIN public.product_groups g ON g.id = p.group_id
  WHERE p.is_vape IS TRUE
    AND COALESCE(g.stock_config_profile, 'standard') = 'standard';

  -- Every Device configuration that must not exist, with its reference counts.
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
    (SELECT count(*) FROM public.product_inventory x WHERE x.stock_config_id = c.id)                                  AS ref_product_inventory,
    (SELECT count(*) FROM public.stock_movements x WHERE x.stock_config_id = c.id)                                    AS ref_stock_movements,
    (SELECT count(*) FROM public.order_items x WHERE x.stock_config_id = c.id)                                        AS ref_order_items,
    (SELECT count(*) FROM public.warehouse_receipt_items x WHERE x.stock_config_id = c.id)                            AS ref_warehouse_receipt_items,
    (SELECT count(*) FROM public.stock_adjustment_items x WHERE x.stock_config_id = c.id)                             AS ref_stock_adjustment_items,
    (SELECT count(*) FROM public.stock_count_session_items x WHERE x.stock_config_id = c.id)                          AS ref_stock_count_session_items,
    (SELECT count(*) FROM public.stock_count_session_scope x WHERE x.stock_config_id = c.id)                          AS ref_stock_count_session_scope,
    (SELECT count(*) FROM public.stock_count_classification_allocation_resolutions x
       WHERE x.target_stock_config_id = c.id)                                                                         AS ref_classification_resolutions,
    (SELECT count(*) FROM public.inventory_cutoff_decisions x WHERE x.stock_config_id = c.id)                         AS ref_cutoff_decisions,
    (SELECT count(*) FROM public.inventory_cutoff_allocation_requests x WHERE x.stock_config_id = c.id)               AS ref_cutoff_allocation_requests
  FROM public.inventory_stock_configurations c
  JOIN _device_variants d ON d.variant_id = c.variant_id
  WHERE c.config_code IN ('20NB', '50NB', '50OB')
     OR c.volume_ml IS NOT NULL
     OR c.packaging IS NOT NULL
  ) r;

  -- --------------------------------------------------------------------------
  -- BLOCKED_REFERENCED_LIQUID_CONFIG — abort, do not guess
  -- --------------------------------------------------------------------------
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
    RAISE EXCEPTION E'BLOCKED_REFERENCED_LIQUID_CONFIG: % Device concentration configuration(s) are still referenced and cannot be deleted without rewriting history. Reference consolidation onto the variant Standard row is not provably safe (stock_count_session_items is UNIQUE (session_id, stock_config_id) and stock_count_session_scope is keyed on (session_id, stock_config_id), so repointing collides with the generic row already scoped by the same session). Manual treatment required for:\n  %',
      (SELECT count(*) FROM _device_concentration_configs WHERE total_refs > 0), v_blocked
      USING ERRCODE = 'raise_exception',
            HINT = 'Decide per session whether the counted rows for these phantom configurations may be archived and removed, then re-run this migration.';
  END IF;

  -- --------------------------------------------------------------------------
  -- SAFE_DELETE_UNREFERENCED_LIQUID_CONFIG
  -- --------------------------------------------------------------------------
  INSERT INTO public._backup_device_stock_config_20260813
  SELECT c.*, 'purge_concentration_config', now()
  FROM public.inventory_stock_configurations c
  JOIN _device_concentration_configs t ON t.id = c.id;

  DELETE FROM public.inventory_stock_configurations c
  USING _device_concentration_configs t
  WHERE c.id = t.id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- --------------------------------------------------------------------------
  -- Post-conditions
  -- --------------------------------------------------------------------------
  IF EXISTS (
    SELECT 1 FROM public.inventory_stock_configurations c
    JOIN _device_variants d ON d.variant_id = c.variant_id
    WHERE c.config_code IN ('20NB', '50NB', '50OB')
       OR c.volume_ml IS NOT NULL OR c.packaging IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'POST_CHECK_FAILED: a Device variant still carries a concentration configuration.';
  END IF;

  SELECT string_agg(format('variant %s has %s configurations', variant_id, n), '; ')
    INTO v_blocked
  FROM (
    SELECT c.variant_id, count(*) AS n
    FROM public.inventory_stock_configurations c
    JOIN _device_variants d ON d.variant_id = c.variant_id
    GROUP BY c.variant_id HAVING count(*) <> 1
  ) x;
  IF v_blocked IS NOT NULL THEN
    RAISE EXCEPTION 'POST_CHECK_FAILED: %', v_blocked;
  END IF;

  SELECT COALESCE(sum(quantity_on_hand), 0), COALESCE(sum(quantity_allocated), 0)
    INTO v_qty_after, v_alloc_after
  FROM public.product_inventory;
  IF v_qty_after <> v_qty_before OR v_alloc_after <> v_alloc_before THEN
    RAISE EXCEPTION 'POST_CHECK_FAILED: inventory changed (on_hand % -> %, allocated % -> %).',
      v_qty_before, v_qty_after, v_alloc_before, v_alloc_after;
  END IF;

  SELECT count(*) INTO v_cart_after
  FROM public.inventory_stock_configurations c
  JOIN public.product_variants pv ON pv.id = c.variant_id
  JOIN public.products p          ON p.id = pv.product_id
  JOIN public.product_groups g    ON g.id = p.group_id
  WHERE COALESCE(g.stock_config_profile, 'standard') = 'concentration';
  IF v_cart_after <> v_cart_before THEN
    RAISE EXCEPTION 'POST_CHECK_FAILED: Cartridge configuration count changed (% -> %).',
      v_cart_before, v_cart_after;
  END IF;

  RAISE NOTICE 'Device concentration purge: % configuration row(s) deleted.', v_deleted;
END
$purge$;

COMMIT;
