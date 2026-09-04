-- ============================================================================
-- LEGACY-CONFIG-CUTOVER-2026 — pre-execution snapshot (READ ONLY)
-- ----------------------------------------------------------------------------
-- Produces the machine-readable CSV baseline that must exist before any
-- balance-changing execution. A database backup is not a substitute: this file
-- is the line-level record management reconciles the retired quantities
-- against, and it must be reviewable without restoring anything.
--
-- Run it against the environment you are about to cut over, per the runbook:
--
--   ssh -i ~/.ssh/serapod_migration root@<host> \
--     "docker exec -i <container> psql -U postgres -d supabase -v ON_ERROR_STOP=1" \
--     < scripts/legacy_config_cutover_snapshot.sql > snapshot-<env>-<date>.csv
--
-- Container identity matters: KVM2 (staging) runs BOTH serapod-stg-db and a
-- container named serapod-prd-db, and KVM8 (production) holds a
-- supabase_old_backup database alongside supabase. Staging is
-- serapod-stg-db / supabase; production is serapod-prd-db / supabase.
--
-- Covers all five configurations — 20NB, 50NB, 50OB, STD, UNCLASSIFIED — so
-- the file reconstructs the complete pre-cutover position, not only the half
-- being retired. The untouched 20NB and STD totals are what prove afterwards
-- that nothing was summed into them.
-- ============================================================================

SET default_transaction_read_only = on;
\pset pager off
\pset format csv

SELECT
  current_database()                                   AS environment,
  now()                                                AS captured_at,
  o.org_code                                           AS organization_code,
  o.org_name                                           AS organization_name,
  o.org_type_code                                      AS organization_type,
  p.product_name,
  v.variant_name,
  v.product_code                                       AS variant_product_code,
  pi.stock_config_id,
  COALESCE(c.config_code, '(NULL)')                    AS config_code,
  c.config_label,
  c.stock_sku,
  c.status                                             AS config_status,
  COALESCE(pi.quantity_on_hand, 0)                     AS quantity_on_hand,
  COALESCE(pi.quantity_allocated, 0)                   AS quantity_allocated,
  COALESCE(pi.quantity_available, 0)                   AS quantity_available,
  pi.average_cost,
  pi.is_active                                         AS inventory_row_active,
  (COALESCE(c.config_code, '') = ANY (ARRAY['50NB', '50OB', 'UNCLASSIFIED'])
     AND COALESCE(pi.quantity_on_hand, 0) <> 0)        AS is_retirement_target
FROM public.product_inventory pi
JOIN public.product_variants v ON v.id = pi.variant_id
JOIN public.products p ON p.id = v.product_id
JOIN public.organizations o ON o.id = pi.organization_id
LEFT JOIN public.inventory_stock_configurations c ON c.id = pi.stock_config_id
ORDER BY o.org_code, config_code, p.product_name, v.variant_name;
