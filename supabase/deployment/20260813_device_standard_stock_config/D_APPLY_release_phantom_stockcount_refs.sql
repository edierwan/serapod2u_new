-- ============================================================================
-- D. APPLY — release the archived stock-count references that block B2.
--     Run ONLY after B1 has committed and B2 has reported
--     BLOCKED_REFERENCED_LIQUID_CONFIG. Re-run B2 afterwards.
-- ----------------------------------------------------------------------------
-- ⚠ THIS SCRIPT DELETES STOCK-COUNT ROWS. It is the only script in this package
--   that removes history, and it exists solely because B2 correctly refused to.
--   Read the safety contract below before running it.
--
-- WHAT IT DELETES
--   Only rows that reference a Device concentration configuration — a
--   20NB/50NB/50OB row that should never have existed on a Device:
--     * public.stock_count_session_scope  (60 rows in production)
--     * public.stock_count_session_items  (24 rows in production)
--   Every other row in those sessions — including every Cartridge row and every
--   row for the Device variants' own Standard configuration — is left untouched.
--
-- WHY THIS IS SAFE (each point is re-asserted inside the transaction)
--   1. Both affected sessions are ARCHIVED and were NEVER POSTED
--      (posted_at IS NULL, posted_by IS NULL), so no ledger was ever derived
--      from these rows.
--   2. Every session aggregate is already zero — total_variants_counted,
--      variance_items, net_quantity_adjustment, estimated_adjustment_value —
--      so removing zero-quantity rows cannot desynchronise them.
--   3. The item rows carry NO counted data: system_quantity = 0,
--      physical_quantity IS NULL (never counted), adjustment_quantity = 0,
--      note IS NULL. (They do carry a unit_cost snapshot, which is preserved in
--      the backup; at zero quantity it contributes zero value.)
--   4. NOTHING references stock_count_session_items or
--      stock_count_session_scope — verified from pg_constraint, and re-verified
--      dynamically below so this script refuses to run if a future migration
--      adds such a foreign key.
--   5. Both tables' triggers are BEFORE INSERT OR UPDATE only, so no guard
--      fires on DELETE and no derived state is recomputed.
--   6. No inventory_opening_cutoffs, stock_count_verification_requests or
--      stock_count_classification_allocation_resolutions row references either
--      session.
--
-- WHAT IT DOES NOT TOUCH
--   No configuration row (that is B2's job). No product_inventory,
--   stock_movements, order_items, quantity, allocation or unit cost anywhere.
--   No session row. No Cartridge data of any kind.
--
-- ROLLBACK
--   Complete verbatim copies are written to
--     public._backup_phantom_scope_20260813
--     public._backup_phantom_items_20260813
--   before the DELETEs. To revert, re-INSERT from those tables (drop the two
--   trailing audit columns).
-- ============================================================================

BEGIN;

LOCK TABLE public.stock_count_session_items, public.stock_count_session_scope,
           public.inventory_stock_configurations IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS public._backup_phantom_scope_20260813 (
  LIKE public.stock_count_session_scope INCLUDING DEFAULTS
);
ALTER TABLE public._backup_phantom_scope_20260813
  ADD COLUMN IF NOT EXISTS backup_reason text,
  ADD COLUMN IF NOT EXISTS backed_up_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public._backup_phantom_items_20260813 (
  LIKE public.stock_count_session_items INCLUDING DEFAULTS
);
ALTER TABLE public._backup_phantom_items_20260813
  ADD COLUMN IF NOT EXISTS backup_reason text,
  ADD COLUMN IF NOT EXISTS backed_up_at timestamptz NOT NULL DEFAULT now();

COMMENT ON TABLE public._backup_phantom_scope_20260813 IS
  'Verbatim copy of stock_count_session_scope rows referencing phantom Device concentration configurations, removed 2026-08-13 to unblock their deletion. Audit + rollback source.';
COMMENT ON TABLE public._backup_phantom_items_20260813 IS
  'Verbatim copy of stock_count_session_items rows referencing phantom Device concentration configurations, removed 2026-08-13 to unblock their deletion. Audit + rollback source.';

DO $release$
DECLARE
  v_blocked        text;
  v_fk_count       integer;
  v_scope_deleted  integer;
  v_items_deleted  integer;
  v_qty_before     bigint;  v_qty_after     bigint;
  v_alloc_before   bigint;  v_alloc_after   bigint;
  v_other_scope_before bigint; v_other_scope_after bigint;
  v_other_items_before bigint; v_other_items_after bigint;
  v_sessions_fingerprint_before text;
  v_sessions_fingerprint_after  text;
BEGIN
  -- --------------------------------------------------------------------------
  -- 1. Resolve the phantom Device configurations (same structural rule as B1/B2)
  -- --------------------------------------------------------------------------
  DROP TABLE IF EXISTS _phantom_cfg;
  CREATE TEMP TABLE _phantom_cfg ON COMMIT DROP AS
  SELECT c.id, c.variant_id, c.config_code
  FROM public.inventory_stock_configurations c
  JOIN public.product_variants pv ON pv.id = c.variant_id
  JOIN public.products p          ON p.id = pv.product_id
  JOIN public.product_groups g    ON g.id = p.group_id
  WHERE p.is_vape IS TRUE
    AND COALESCE(g.stock_config_profile, 'standard') = 'standard'
    AND (c.config_code IN ('20NB','50NB','50OB')
         OR c.volume_ml IS NOT NULL OR c.packaging IS NOT NULL);

  IF NOT EXISTS (SELECT 1 FROM _phantom_cfg) THEN
    RAISE EXCEPTION 'No phantom Device concentration configurations found — nothing to release. Has B2 already succeeded?'
      USING ERRCODE = 'no_data_found';
  END IF;

  -- --------------------------------------------------------------------------
  -- 2. GUARD: nothing may reference the two tables we are about to delete from.
  --    Checked dynamically so a future schema change invalidates this script
  --    instead of silently orphaning data.
  -- --------------------------------------------------------------------------
  SELECT count(*) INTO v_fk_count
  FROM pg_constraint con
  JOIN pg_class tgt ON tgt.oid = con.confrelid
  WHERE con.contype = 'f'
    AND tgt.relname IN ('stock_count_session_items','stock_count_session_scope');
  IF v_fk_count <> 0 THEN
    RAISE EXCEPTION 'BLOCKED: % foreign key(s) now reference stock_count_session_items/_scope. This script was written when nothing did. Re-review before deleting.', v_fk_count;
  END IF;

  -- GUARD: no DELETE-firing trigger may exist on either table.
  SELECT string_agg(format('%s on %s', t.tgname, c.relname), '; ') INTO v_blocked
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
  WHERE NOT t.tgisinternal
    AND c.relname IN ('stock_count_session_items','stock_count_session_scope')
    AND (t.tgtype & 8) <> 0;   -- bit 3 = DELETE
  IF v_blocked IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCKED: DELETE trigger(s) present (%). Re-review before deleting.', v_blocked;
  END IF;

  -- --------------------------------------------------------------------------
  -- 3. GUARD: every affected session must be archived and never posted.
  -- --------------------------------------------------------------------------
  DROP TABLE IF EXISTS _affected_sessions;
  CREATE TEMP TABLE _affected_sessions ON COMMIT DROP AS
  SELECT DISTINCT s.id
  FROM public.stock_count_sessions s
  WHERE EXISTS (SELECT 1 FROM public.stock_count_session_scope sc
                JOIN _phantom_cfg pc ON pc.id = sc.stock_config_id
                WHERE sc.session_id = s.id)
     OR EXISTS (SELECT 1 FROM public.stock_count_session_items i
                JOIN _phantom_cfg pc ON pc.id = i.stock_config_id
                WHERE i.session_id = s.id);

  SELECT string_agg(format('session %s (%s, status=%s, posted_at=%s)',
                           s.id, s.count_type, s.status, COALESCE(s.posted_at::text,'null')), '; ')
    INTO v_blocked
  FROM public.stock_count_sessions s
  JOIN _affected_sessions a ON a.id = s.id
  WHERE s.status <> 'archived' OR s.posted_at IS NOT NULL OR s.posted_by IS NOT NULL;
  IF v_blocked IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCKED_SESSION_NOT_ARCHIVED_OR_POSTED: %', v_blocked;
  END IF;

  -- GUARD: session aggregates must already be zero, so deleting zero-quantity
  -- rows cannot leave a stale summary behind.
  SELECT string_agg(format('session %s has non-zero aggregates (counted=%s variance=%s net=%s value=%s)',
                           s.id, s.total_variants_counted, s.variance_items,
                           s.net_quantity_adjustment, s.estimated_adjustment_value), '; ')
    INTO v_blocked
  FROM public.stock_count_sessions s
  JOIN _affected_sessions a ON a.id = s.id
  WHERE COALESCE(s.total_variants_counted,0) <> 0
     OR COALESCE(s.variance_items,0) <> 0
     OR COALESCE(s.net_quantity_adjustment,0) <> 0
     OR COALESCE(s.estimated_adjustment_value,0) <> 0;
  IF v_blocked IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCKED_SESSION_HAS_AGGREGATES: %', v_blocked;
  END IF;

  -- GUARD: no downstream record may depend on an affected session.
  SELECT string_agg(msg, '; ') INTO v_blocked FROM (
    SELECT format('inventory_opening_cutoffs references session %s', a.id) AS msg
    FROM _affected_sessions a
    WHERE EXISTS (SELECT 1 FROM public.inventory_opening_cutoffs x WHERE x.stock_count_session_id = a.id)
    UNION ALL
    SELECT format('stock_count_verification_requests references session %s', a.id)
    FROM _affected_sessions a
    WHERE EXISTS (SELECT 1 FROM public.stock_count_verification_requests x WHERE x.session_id = a.id)
    UNION ALL
    SELECT format('stock_count_classification_allocation_resolutions references session %s', a.id)
    FROM _affected_sessions a
    WHERE EXISTS (SELECT 1 FROM public.stock_count_classification_allocation_resolutions x WHERE x.session_id = a.id)
  ) q;
  IF v_blocked IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCKED_SESSION_HAS_DEPENDENTS: %', v_blocked;
  END IF;

  -- --------------------------------------------------------------------------
  -- 4. GUARD: the item rows must carry no counted data.
  -- --------------------------------------------------------------------------
  SELECT string_agg(format('item %s (session %s, config %s): system=%s physical=%s adjustment=%s note=%s',
                           i.id, i.session_id, i.stock_config_id,
                           i.system_quantity, i.physical_quantity, i.adjustment_quantity,
                           COALESCE(i.note,'null')), '; ')
    INTO v_blocked
  FROM public.stock_count_session_items i
  JOIN _phantom_cfg pc ON pc.id = i.stock_config_id
  WHERE COALESCE(i.system_quantity,0) <> 0
     OR i.physical_quantity IS NOT NULL
     OR COALESCE(i.adjustment_quantity,0) <> 0
     OR (i.note IS NOT NULL AND btrim(i.note) <> '');
  IF v_blocked IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCKED_ITEM_HAS_COUNTED_DATA: %', v_blocked;
  END IF;

  -- --------------------------------------------------------------------------
  -- 5. Baselines that must be provably unchanged at COMMIT time
  -- --------------------------------------------------------------------------
  SELECT COALESCE(sum(quantity_on_hand),0), COALESCE(sum(quantity_allocated),0)
    INTO v_qty_before, v_alloc_before FROM public.product_inventory;

  -- Every scope/item row that is NOT a phantom Device row must survive intact.
  SELECT count(*) INTO v_other_scope_before
  FROM public.stock_count_session_scope sc
  WHERE NOT EXISTS (SELECT 1 FROM _phantom_cfg pc WHERE pc.id = sc.stock_config_id);
  SELECT count(*) INTO v_other_items_before
  FROM public.stock_count_session_items i
  WHERE NOT EXISTS (SELECT 1 FROM _phantom_cfg pc WHERE pc.id = i.stock_config_id);

  SELECT md5(string_agg(t, '|' ORDER BY t)) INTO v_sessions_fingerprint_before
  FROM (SELECT s.id::text||':'||s.status||':'||COALESCE(s.posted_at::text,'-')||':'||
               COALESCE(s.total_variants_counted::text,'-')||':'||COALESCE(s.variance_items::text,'-')||':'||
               COALESCE(s.net_quantity_adjustment::text,'-')||':'||COALESCE(s.estimated_adjustment_value::text,'-') AS t
        FROM public.stock_count_sessions s) x;

  -- --------------------------------------------------------------------------
  -- 6. Back up, then delete
  -- --------------------------------------------------------------------------
  INSERT INTO public._backup_phantom_items_20260813
  SELECT i.*, 'release_phantom_device_config_ref', now()
  FROM public.stock_count_session_items i
  JOIN _phantom_cfg pc ON pc.id = i.stock_config_id;

  INSERT INTO public._backup_phantom_scope_20260813
  SELECT sc.*, 'release_phantom_device_config_ref', now()
  FROM public.stock_count_session_scope sc
  JOIN _phantom_cfg pc ON pc.id = sc.stock_config_id;

  DELETE FROM public.stock_count_session_items i
  USING _phantom_cfg pc WHERE pc.id = i.stock_config_id;
  GET DIAGNOSTICS v_items_deleted = ROW_COUNT;

  DELETE FROM public.stock_count_session_scope sc
  USING _phantom_cfg pc WHERE pc.id = sc.stock_config_id;
  GET DIAGNOSTICS v_scope_deleted = ROW_COUNT;

  -- --------------------------------------------------------------------------
  -- 7. Verify before COMMIT — any failure rolls everything back
  -- --------------------------------------------------------------------------
  IF EXISTS (SELECT 1 FROM public.stock_count_session_items i
             JOIN _phantom_cfg pc ON pc.id = i.stock_config_id)
     OR EXISTS (SELECT 1 FROM public.stock_count_session_scope sc
                JOIN _phantom_cfg pc ON pc.id = sc.stock_config_id) THEN
    RAISE EXCEPTION 'POST_CHECK_FAILED: a phantom stock-count reference survived.';
  END IF;

  SELECT count(*) INTO v_other_scope_after
  FROM public.stock_count_session_scope sc
  WHERE NOT EXISTS (SELECT 1 FROM _phantom_cfg pc WHERE pc.id = sc.stock_config_id);
  SELECT count(*) INTO v_other_items_after
  FROM public.stock_count_session_items i
  WHERE NOT EXISTS (SELECT 1 FROM _phantom_cfg pc WHERE pc.id = i.stock_config_id);
  IF v_other_scope_after <> v_other_scope_before OR v_other_items_after <> v_other_items_before THEN
    RAISE EXCEPTION 'POST_CHECK_FAILED: non-phantom stock-count rows were affected (scope % -> %, items % -> %).',
      v_other_scope_before, v_other_scope_after, v_other_items_before, v_other_items_after;
  END IF;

  SELECT COALESCE(sum(quantity_on_hand),0), COALESCE(sum(quantity_allocated),0)
    INTO v_qty_after, v_alloc_after FROM public.product_inventory;
  IF v_qty_after <> v_qty_before OR v_alloc_after <> v_alloc_before THEN
    RAISE EXCEPTION 'POST_CHECK_FAILED: inventory changed (on_hand % -> %, allocated % -> %).',
      v_qty_before, v_qty_after, v_alloc_before, v_alloc_after;
  END IF;

  SELECT md5(string_agg(t, '|' ORDER BY t)) INTO v_sessions_fingerprint_after
  FROM (SELECT s.id::text||':'||s.status||':'||COALESCE(s.posted_at::text,'-')||':'||
               COALESCE(s.total_variants_counted::text,'-')||':'||COALESCE(s.variance_items::text,'-')||':'||
               COALESCE(s.net_quantity_adjustment::text,'-')||':'||COALESCE(s.estimated_adjustment_value::text,'-') AS t
        FROM public.stock_count_sessions s) x;
  IF v_sessions_fingerprint_after IS DISTINCT FROM v_sessions_fingerprint_before THEN
    RAISE EXCEPTION 'POST_CHECK_FAILED: a stock_count_sessions row was modified.';
  END IF;

  -- Every phantom configuration must now be fully unreferenced, so B2 can run.
  SELECT string_agg(format('config %s (%s) still has references', pc.id, pc.config_code), '; ')
    INTO v_blocked
  FROM _phantom_cfg pc
  WHERE (SELECT count(*) FROM public.product_inventory x WHERE x.stock_config_id = pc.id)
      + (SELECT count(*) FROM public.stock_movements x WHERE x.stock_config_id = pc.id)
      + (SELECT count(*) FROM public.order_items x WHERE x.stock_config_id = pc.id)
      + (SELECT count(*) FROM public.warehouse_receipt_items x WHERE x.stock_config_id = pc.id)
      + (SELECT count(*) FROM public.stock_adjustment_items x WHERE x.stock_config_id = pc.id)
      + (SELECT count(*) FROM public.stock_count_session_items x WHERE x.stock_config_id = pc.id)
      + (SELECT count(*) FROM public.stock_count_session_scope x WHERE x.stock_config_id = pc.id)
      + (SELECT count(*) FROM public.stock_count_classification_allocation_resolutions x WHERE x.target_stock_config_id = pc.id)
      + (SELECT count(*) FROM public.inventory_cutoff_decisions x WHERE x.stock_config_id = pc.id)
      + (SELECT count(*) FROM public.inventory_cutoff_allocation_requests x WHERE x.stock_config_id = pc.id) > 0;
  IF v_blocked IS NOT NULL THEN
    RAISE EXCEPTION 'POST_CHECK_FAILED: %', v_blocked;
  END IF;

  RAISE NOTICE 'Released phantom references: % scope row(s), % item row(s). B2 can now run.',
    v_scope_deleted, v_items_deleted;
END
$release$;

-- Affected rows — exactly what was removed.
SELECT 'scope' AS source, b.session_id, s.reference_name, s.count_type, s.status,
       b.stock_config_id, pv.variant_name, c.config_code,
       NULL::integer AS system_quantity, NULL::integer AS physical_quantity, NULL::numeric AS unit_cost
FROM public._backup_phantom_scope_20260813 b
JOIN public.stock_count_sessions s ON s.id = b.session_id
LEFT JOIN public.inventory_stock_configurations c ON c.id = b.stock_config_id
LEFT JOIN public.product_variants pv ON pv.id = c.variant_id
WHERE b.backed_up_at = transaction_timestamp()
UNION ALL
SELECT 'item', b.session_id, s.reference_name, s.count_type, s.status,
       b.stock_config_id, pv.variant_name, c.config_code,
       b.system_quantity, b.physical_quantity, b.unit_cost
FROM public._backup_phantom_items_20260813 b
JOIN public.stock_count_sessions s ON s.id = b.session_id
LEFT JOIN public.inventory_stock_configurations c ON c.id = b.stock_config_id
LEFT JOIN public.product_variants pv ON pv.id = c.variant_id
WHERE b.backed_up_at = transaction_timestamp()
ORDER BY 1, 7, 8;

COMMIT;
