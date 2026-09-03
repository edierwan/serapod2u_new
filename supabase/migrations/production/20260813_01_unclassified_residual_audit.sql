-- 01 — Legacy/Unclassified residual audit (READ ONLY, no schema change)
--
-- Context: Quick Order / Paste Order List showed "Inventory Unclassified" for
-- flavours that View Inventory reported as healthy — for example Strawberry
-- Corn at Serapod Warehouse Balakong (10,514 units in 20NB, 73 units left in
-- the phase_out UNCLASSIFIED configuration).
--
-- The order blocker itself is a CODE bug and is fixed in the app: a variant is
-- only treated as unclassified when the Legacy/Unclassified balance is its ONLY
-- orderable stock. No schema migration is required for that fix.
--
-- This script is purely diagnostic. It lists the residual balances still parked
-- in Legacy/Unclassified configurations so they can be cleared through the
-- in-app Stock Count classification flow (which writes the stock-movement
-- ledger). Do NOT move these balances with a manual UPDATE.

SET default_transaction_read_only = on;

WITH warehouse AS (
  SELECT id, org_name
  FROM public.organizations
  WHERE org_type_code = 'WH' AND is_active
),
balance AS (
  SELECT
    pi.organization_id,
    pi.variant_id,
    SUM(CASE WHEN c.config_code ~* 'UNCLASSIFIED|LEGACY' THEN pi.quantity_on_hand ELSE 0 END) AS unclassified_on_hand,
    MAX(CASE
          WHEN c.status = 'active'
           AND c.allow_so
           AND NOT c.requires_repacking_before_sale
           AND ((c.volume_ml IS NULL AND c.packaging IS NULL)
                OR (c.volume_ml = 20 AND c.packaging = 'new_box'))
          THEN pi.quantity_available
          ELSE 0
        END) AS sellable_available
  FROM public.product_inventory pi
  JOIN public.inventory_stock_configurations c ON c.id = pi.stock_config_id
  WHERE pi.organization_id IN (SELECT id FROM warehouse)
  GROUP BY 1, 2
)
SELECT
  w.org_name                                   AS warehouse,
  p.product_name,
  v.variant_name,
  v.product_code                               AS variant_product_code,
  b.unclassified_on_hand                       AS residual_units,
  b.sellable_available                         AS sellable_units,
  CASE
    WHEN b.sellable_available > 0 THEN 'orderable — residual is cleanup only'
    ELSE 'BLOCKED — residual is the only stock'
  END                                          AS order_status
FROM balance b
JOIN warehouse w ON w.id = b.organization_id
JOIN public.product_variants v ON v.id = b.variant_id
JOIN public.products p ON p.id = v.product_id
WHERE b.unclassified_on_hand > 0
ORDER BY (b.sellable_available > 0), w.org_name, p.product_name, v.variant_name;
