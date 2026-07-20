# HQ Direct Inventory Cutover Runbook

**Branch:** `enhancement/hq-warehouse-inventory-flow-20260720`  
**Purpose:** Controlled later cutover of remaining direct inventory on
`Serapod Technology Sdn Bhd` (HQ) into `Serapod HQ Warehouse`.  
**Safety:** Do **not** run against staging/production inventory until explicitly approved.

## Preconditions

1. Batch 1–3 application changes are deployed/available.
2. Stock Transfer workflow supports HQ → Warehouse:
   - draft → submit → approve → dispatch → receive
   - configuration-aware quantities
   - idempotent dispatch/receive
   - full audit via `stock_movements`
3. Quiet period agreed with operations.
4. Read-only VPS/staging DB access available for assessment queries.

## Correct reconciliation identity

```
Total Serapod-controlled inventory before
=
Total Serapod-controlled inventory after
```

Do **not** use only `HQ balance before = HQ Warehouse balance after` unless the
destination warehouse was confirmed empty.

Serapod-controlled inventory = inventory on:
- the HQ organization (legacy direct)
- all active WH children of that HQ

Exclude distributor, shop, and manufacturer balances.

## Execution checklist

1. **Read-only balance assessment**
   - HQ direct on-hand / allocated / available by variant + stock config
   - Each active HQ warehouse balance
   - Consolidated warehouse total
   - Grand Serapod-controlled total
2. **Freeze / quiet period**
   - Pause D2H fulfillment from cutover SKUs if needed
   - Pause Add Stock / Adjust / Count posting on HQ and HQ Warehouse
3. **Check open allocations** on HQ direct inventory
4. **Check open D2H/S2D orders** still sourcing HQ direct inventory
5. **Check pending returns** destined for any HQ warehouse
6. **Check open stock counts** for HQ and HQ Warehouse
7. **Check open stock transfers** involving HQ or HQ Warehouse
8. **Physical stock count** at the destination warehouse
9. **Reconcile** book vs physical; resolve variances first
10. **Create audited HQ → Serapod HQ Warehouse transfer** (safe test data only until approval)
11. **Dispatch** (`transfer_out` from HQ once)
12. **Receive** (`transfer_in` to Serapod HQ Warehouse once)
13. **Verify source and destination** movements, before/after quantities, config IDs
14. **Confirm HQ direct balance is zero** for transferred SKUs
15. **Confirm consolidated Serapod-controlled total is unchanged**

## Explicit non-actions

- Do not delete HQ inventory rows
- Do not rewrite historical movements
- Do not create manual untracked balances
- Do not perform staging/production cutover without approval
- Do not use the consolidated “All Serapod HQ Warehouses” location as transfer source/destination

## Suggested read-only assessment queries

```sql
-- Active HQ warehouses (dynamic; no hardcoded names)
SELECT wh.id, wh.org_code, wh.org_name
FROM organizations wh
JOIN organizations hq ON hq.id = wh.parent_org_id
WHERE hq.org_type_code = 'HQ'
  AND hq.is_active
  AND wh.org_type_code = 'WH'
  AND wh.is_active
ORDER BY wh.org_name;

-- HQ direct balances
SELECT pi.variant_id, pi.stock_config_id, pi.quantity_on_hand, pi.quantity_allocated, pi.quantity_available
FROM product_inventory pi
JOIN organizations o ON o.id = pi.organization_id
WHERE o.org_type_code = 'HQ' AND o.is_active AND pi.is_active
ORDER BY pi.variant_id, pi.stock_config_id;

-- Open transfers involving HQ or its warehouses
SELECT id, transfer_no, status, from_organization_id, to_organization_id
FROM stock_transfers
WHERE status NOT IN ('received', 'cancelled', 'rejected');
```

## After cutover

- Keep individual warehouse filters.
- Consolidated HQ warehouses view remains display-only.
- The informational note about legacy HQ direct inventory can be removed in a later approved change once HQ direct balances are confirmed zero.
