-- ============================================================================
-- Archived-variant stock-configuration reconciliation
-- ----------------------------------------------------------------------------
-- Context
--   Variants are soft-deleted (product_variants.is_active = false) from Master
--   Data. Their inventory_stock_configurations rows, however, were left with
--   status = 'active'. Any Stock Adjustment / stock-count code path that keyed
--   off configuration status (rather than the owning variant's is_active flag)
--   could therefore still surface an archived variant after it disappeared
--   from active Master Data.
--
--   This migration reconciles the two so archived variants are consistently
--   excluded from NEW operational selections, while ALL history is preserved.
--
-- Safety
--   * Forward-only and idempotent (re-running changes nothing new).
--   * NON-DESTRUCTIVE: no DELETE, no hard delete, no history removed. It only
--     flips configuration status 'active'/'phase_out' -> 'inactive' for configs
--     whose variant is already archived. 'inactive' is an allowed value of
--     isc_status_check.
--   * Does NOT restore hard-deleted variants. Soft-deleted product_variants rows
--     remain joinable and can therefore be reconciled generically. There are no
--     orphaned configuration rows to recreate.
--     Should a genuine hard-delete ever be discovered, the original IDs would be
--     required and a separate, reviewed restore migration must be authored --
--     never guess or mint new IDs.
--
-- Review before applying against any environment.
-- ============================================================================

BEGIN;

-- Reconcile stock configurations owned by archived variants.
--   The condition is deliberately narrow: only OPERATIONAL statuses
--   ('active','phase_out') are reconciled to 'inactive'. Matching an explicit
--   allow-list (rather than "<> 'inactive'") guarantees that if the
--   isc_status_check constraint ever gains a new status value, this migration
--   will not silently reclassify it. 'inactive' is already terminal, so it is
--   left untouched and re-running remains a no-op.
UPDATE public.inventory_stock_configurations AS isc
SET status = 'inactive'
FROM public.product_variants AS pv
WHERE isc.variant_id = pv.id
  AND pv.is_active = false
  AND isc.status IN ('active', 'phase_out');

-- Post-check (read-only; safe to run manually). Expect zero rows: no config
-- belonging to an archived variant should remain in an operational status.
--   SELECT isc.id, isc.variant_id, isc.status
--   FROM public.inventory_stock_configurations isc
--   JOIN public.product_variants pv ON pv.id = isc.variant_id
--   WHERE pv.is_active = false AND isc.status IN ('active', 'phase_out');

COMMIT;
