-- ============================================================================
-- A. PRECHECK — READ ONLY. Run this FIRST in the production SQL Editor.
-- ----------------------------------------------------------------------------
-- Writes nothing. `SET LOCAL default_transaction_read_only = on` makes that
-- guarantee enforced by the server, not just by inspection.
--
-- Send the output back before running B_APPLY. B_APPLY refuses to continue if
-- ANY row here is classified BLOCKED_* or UNEXPECTED_STATE.
--
-- "Device" is resolved structurally, never by product or variant name:
--   products.is_vape = true AND the owning group's stock_config_profile
--   = 'standard'  (a vape product that is not a flavour/Cartridge group).
-- ============================================================================

BEGIN;
SET LOCAL default_transaction_read_only = on;

WITH device_variants AS (
  SELECT
    pv.id            AS variant_id,
    pv.variant_name,
    pv.is_active     AS variant_is_active,
    p.id             AS product_id,
    p.product_name,
    g.id             AS group_id,
    g.group_code,
    g.group_name,
    COALESCE(g.stock_config_profile, 'standard') AS stock_config_profile
  FROM public.product_variants pv
  JOIN public.products p       ON p.id = pv.product_id
  JOIN public.product_groups g ON g.id = p.group_id
  WHERE p.is_vape IS TRUE
    AND COALESCE(g.stock_config_profile, 'standard') = 'standard'
),
cfg AS (
  SELECT
    dv.*,
    c.id                             AS stock_config_id,
    c.config_code,
    c.config_label,
    c.status                         AS lifecycle_status,
    c.volume_ml,
    c.packaging,
    c.allow_so,
    c.allow_ord,
    c.default_for_ord,
    c.is_variant_default,
    c.requires_repacking_before_sale,
    c.sort_order,
    c.stock_sku,
    (c.volume_ml IS NULL AND c.packaging IS NULL) AS is_generic,
    -- Every FK that can point at a stock configuration (enumerated from
    -- pg_constraint where confrelid = inventory_stock_configurations).
    (SELECT count(*) FROM public.product_inventory x                                  WHERE x.stock_config_id = c.id)        AS ref_product_inventory,
    (SELECT count(*) FROM public.stock_movements x                                    WHERE x.stock_config_id = c.id)        AS ref_stock_movements,
    (SELECT count(*) FROM public.order_items x                                        WHERE x.stock_config_id = c.id)        AS ref_order_items,
    (SELECT count(*) FROM public.warehouse_receipt_items x                            WHERE x.stock_config_id = c.id)        AS ref_warehouse_receipt_items,
    (SELECT count(*) FROM public.stock_adjustment_items x                             WHERE x.stock_config_id = c.id)        AS ref_stock_adjustment_items,
    (SELECT count(*) FROM public.stock_count_session_items x                          WHERE x.stock_config_id = c.id)        AS ref_stock_count_session_items,
    (SELECT count(*) FROM public.stock_count_session_scope x                          WHERE x.stock_config_id = c.id)        AS ref_stock_count_session_scope,
    (SELECT count(*) FROM public.stock_count_classification_allocation_resolutions x  WHERE x.target_stock_config_id = c.id) AS ref_classification_resolutions,
    (SELECT count(*) FROM public.inventory_cutoff_decisions x                         WHERE x.stock_config_id = c.id)        AS ref_cutoff_decisions,
    (SELECT count(*) FROM public.inventory_cutoff_allocation_requests x               WHERE x.stock_config_id = c.id)        AS ref_cutoff_allocation_requests,
    -- product_inventory quantities per warehouse for this configuration.
    (SELECT string_agg(o.org_name || ': on_hand=' || pi.quantity_on_hand
                       || ' allocated=' || pi.quantity_allocated
                       || ' available=' || pi.quantity_available, ' | ' ORDER BY o.org_name)
       FROM public.product_inventory pi
       LEFT JOIN public.organizations o ON o.id = pi.organization_id
      WHERE pi.stock_config_id = c.id)                                                AS inventory_by_warehouse,
    (SELECT COALESCE(sum(pi.quantity_on_hand), 0)   FROM public.product_inventory pi WHERE pi.stock_config_id = c.id) AS total_on_hand,
    (SELECT COALESCE(sum(pi.quantity_allocated), 0) FROM public.product_inventory pi WHERE pi.stock_config_id = c.id) AS total_allocated
  FROM device_variants dv
  JOIN public.inventory_stock_configurations c ON c.variant_id = dv.variant_id
),
counted AS (
  SELECT cfg.*,
    ref_product_inventory + ref_stock_movements + ref_order_items
      + ref_warehouse_receipt_items + ref_stock_adjustment_items
      + ref_stock_count_session_items + ref_stock_count_session_scope
      + ref_classification_resolutions + ref_cutoff_decisions
      + ref_cutoff_allocation_requests                                    AS total_refs,
    count(*)      FILTER (WHERE is_generic) OVER (PARTITION BY variant_id) AS generic_cfg_count,
    count(*)      FILTER (WHERE config_code = 'STD') OVER (PARTITION BY variant_id) AS std_cfg_count,
    bool_or(is_variant_default AND NOT is_generic) OVER (PARTITION BY variant_id)   AS default_held_by_dimensioned,
    bool_or(default_for_ord AND NOT is_generic)    OVER (PARTITION BY variant_id)   AS ord_default_held_by_dimensioned
  FROM cfg
)
SELECT
  product_name,
  variant_id,
  variant_name,
  variant_is_active,
  group_name        AS product_group,
  group_code,
  stock_config_profile,
  stock_config_id,
  config_code,
  config_label,
  lifecycle_status,
  volume_ml,
  packaging,
  allow_so,
  allow_ord,
  default_for_ord,
  is_variant_default,
  requires_repacking_before_sale,
  sort_order,
  stock_sku,
  ref_product_inventory,
  ref_stock_movements,
  ref_order_items,
  ref_warehouse_receipt_items,
  ref_stock_adjustment_items,
  ref_stock_count_session_items,
  ref_stock_count_session_scope,
  ref_classification_resolutions,
  ref_cutoff_decisions,
  ref_cutoff_allocation_requests,
  total_refs,
  total_on_hand,
  total_allocated,
  inventory_by_warehouse,
  CASE
    -- Blocking states are evaluated first: they veto the whole APPLY run.
    WHEN generic_cfg_count > 1                       THEN 'BLOCKED_DUPLICATE_GENERIC_CONFIG'
    WHEN is_generic AND config_code <> 'STD'
         AND std_cfg_count > 0                       THEN 'BLOCKED_DUPLICATE_STD'
    WHEN generic_cfg_count = 0                       THEN 'UNEXPECTED_STATE'
    WHEN default_held_by_dimensioned                 THEN 'UNEXPECTED_STATE'
    WHEN ord_default_held_by_dimensioned             THEN 'UNEXPECTED_STATE'
    WHEN is_generic
         AND config_code NOT IN ('STD','UNCLASSIFIED') THEN 'UNEXPECTED_STATE'

    -- Dimensioned rows: must not exist on a Device at all.
    WHEN NOT is_generic AND total_refs > 0           THEN 'BLOCKED_REFERENCED_LIQUID_CONFIG'
    WHEN NOT is_generic                              THEN 'SAFE_DELETE_UNREFERENCED_LIQUID_CONFIG'

    -- The single generic row: already correct, or repairable in place.
    WHEN config_code = 'STD' AND config_label = 'Standard' AND lifecycle_status = 'active'
         AND allow_so AND allow_ord AND default_for_ord AND is_variant_default
         AND NOT requires_repacking_before_sale AND sort_order = 0
                                                     THEN 'ALREADY_CORRECT'
    WHEN config_code = 'UNCLASSIFIED'                THEN 'SAFE_RENAME_UNCLASSIFIED_TO_STD'
    WHEN config_code = 'STD'                         THEN 'SAFE_ACTIVATE_EXISTING_STD'
    ELSE 'UNEXPECTED_STATE'
  END AS classification
FROM counted
ORDER BY product_name, variant_name, is_generic DESC, config_code;

COMMIT;
