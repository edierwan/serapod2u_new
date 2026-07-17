# Stock Configuration Enhancement — Staging Delivery and Coverage

## Safety boundary

No SQL was executed while preparing this enhancement. Migrations do not enable a real flavour, classify legacy stock, or move inventory. Migration 07 replaces constraints only. The readiness script requires four operator-selected UUIDs and stops when any selection is unsuitable.

## Migration order

Apply once, in this exact order:

1. `20260717_stock_config_01_groundwork.sql`
2. `20260717_stock_config_02_ledger.sql`
3. `20260717_stock_config_03_ord_repack.sql`
4. `20260717_stock_config_04_stock_count.sql`
5. `20260717_stock_config_05_so_fulfilment.sql`
6. `20260717_stock_config_06_views_reports.sql`
7. `20260717_stock_config_07_reference_type_fix.sql`

Staging already has 01–06. Execute only 07 there, then run the read-only readiness sections before choosing controlled test data. Migration 07 sends `NOTIFY pgrst, 'reload schema'`; if the hosted gateway still reports a stale signature, use the platform's normal API/schema restart control before testing RPCs.

## Current staging schema dump assessment

`supabase/schemas/current_schema_stg.sql` contains the tables, columns, FKs, RLS, functions and reporting views introduced by migrations 01–06. It is stale only for migration 07:

- `stock_movements_reference_type_check` still stops at `repack` and lacks `order_config_change` and `order_cancel_reversal`.
- `valid_quantity_change` lacks the active `spin_wheel_in` and `spin_wheel_out` movement types.

The dump was not edited. Application database types already contain the 01–06 tables, columns, relationships, RPCs and views. Constraint-only migration 07 does not change generated TypeScript shapes; regenerate types from staging after 07 as the normal verification step, not from a guessed local schema.

## Localhost route and menu map

| Flow | Localhost route | Menu/location |
|---|---|---|
| Product variant configuration | `http://localhost:3000/supply-chain/products/master-data` | Supply Chain → Products → Master Data → Variants → Edit Variant |
| Inventory | `http://localhost:3000/supply-chain/inventory` | Supply Chain → Inventory → View Inventory |
| Add Stock | `http://localhost:3000/supply-chain/inventory/add` | Supply Chain → Inventory → Add Stock |
| Stock Count | `http://localhost:3000/supply-chain/inventory/count` | Supply Chain → Inventory → Stock Adjustment (screen title: Stock Count) |
| Repacking | `http://localhost:3000/supply-chain/inventory/repack` | Supply Chain → Inventory → Repack Stock |
| Stock Transfer | `http://localhost:3000/supply-chain/inventory/transfer` | Supply Chain → Inventory → Stock Transfer |
| Movement Report | `http://localhost:3000/supply-chain/inventory/movements` | Supply Chain → Inventory → Movement Reports |
| Distributor SO | `http://localhost:3000/supply-chain/orders/distributor` | Supply Chain → Order Management → Distributor Order |
| Internal SO selection/fulfilment | `http://localhost:3000/supply-chain/orders` | Supply Chain → Order Management → Orders → open submitted SO |
| ORD receiving | `http://localhost:3000/supply-chain/qr/receive` | Supply Chain → QR Tracking → Warehouse Receive |
| WMS shipping | `http://localhost:3000/supply-chain/qr/ship` | Supply Chain → QR Tracking → Warehouse Ship |

Stock configuration enablement and 50ml distributor eligibility are now normal authorized UI operations in the Edit Variant panel. There is no ongoing operational need for uncontrolled SQL. Distributor users cannot see the panel or read the eligibility mapping; server authorization and database RLS enforce the same boundary.

## Controlled staging setup

Use `scripts/stock_config_staging_test_readiness.sql` without running it against production. It is deliberately split into:

- Section A: read-only object/signature/PostgREST/data-candidate preflight.
- Section B: operator placeholders and fail-closed validation.
- Section C: idempotent enablement for exactly 20NB, 50NB and 50OB; the script proves 20OB is absent and leaves legacy inventory untouched.
- Section D: optional, clearly labelled `TEST-*` quantity posting through `record_stock_movement` with exact `p_stock_config_id`.
- Section E: 50ml eligibility setup and verification using `distributor_stock_config_eligibility`.
- Section F: reconciliation queries.
- Section G: quantity reversal and eligibility cleanup.

The operator must choose and paste real staging values for `TEST_VARIANT_ID`, `TEST_WAREHOUSE_ID`, `NORMAL_DISTRIBUTOR_ORG_ID`, and `ELIGIBLE_50ML_DISTRIBUTOR_ORG_ID`. Never invent UUIDs. Capture the pre-test balance and every returned `TEST-*` movement reference before reversal.

## Localhost one-shot checklist

1. Point localhost environment variables at staging and restart localhost; do not copy or display service-role secrets.
2. Apply migration 07 to staging through the approved migration runner.
3. Run readiness Section A only. Confirm all 01–07 objects/signatures and PostgREST exposure pass.
4. Select one active Cellera flavour, one active warehouse, one normal distributor and a different active distributor for 50ml eligibility.
5. Fill Section B placeholders and run its validation before any setup block.
6. As HQ Admin, open the flavour in Edit Variant. Confirm the empty state, warning and enablement dialog; enable and verify exactly three rows and a separate Legacy/Unclassified balance.
7. Open 50ml New Box eligibility, search the eligible test distributor, add it, and verify the responsible user/date. Confirm the normal distributor remains ineligible.
8. Add small `TEST-*` quantities only if needed, through readiness Section D or Add Stock. Verify current balance before posting and exact Stock SKU afterward.
9. Submit flavour-level SOs as each distributor. Internally confirm normal distributor offers 20NB only; eligible distributor offers sufficiently stocked 20NB and 50NB; 50OB never appears.
10. Change an allocated eligible line once after confirmation. Verify the confirmation prompt and exactly one deallocation/allocation pair under `order_config_change`.
11. Approve/fulfil, then test the approved cancellation path. Verify buyer debit and warehouse restoration use the exact same configuration.
12. Receive a manufacturer ORD. Confirm `Inventory destination: 20ml · New Box`, partial replay idempotency, and the receipt-history Stock SKU.
13. Repack a small 50OB quantity to 50NB. Confirm one shared RPK reference, paired signs, equal quantity and resulting balances.
14. Transfer one exact Stock SKU between warehouses; verify source availability and identical destination configuration.
15. Download/import a Stock Count workbook; verify identity columns, reject an old variant-only template, save/load a draft, and post one exact configuration variance.
16. In Warehouse Ship, verify the picking card shows the confirmed order-item Stock SKU. Confirm missing/unconfirmed linkage blocks scanning and 50OB cannot ship.
17. Verify Inventory expandable totals equal configuration sums once, inactive toggle behavior, and visible Legacy/Unclassified quantities.
18. Filter/export Movement Reports by flavour, Stock SKU, volume, packaging, movement/reference type, date and warehouse.
19. Run readiness Section F reconciliations, then Section G cleanup for only captured `TEST-*` quantities and test eligibility.
20. Re-run Section A and reconciliation queries. Confirm no unaccounted variance or duplicate movement.

## Complete UI/transaction coverage matrix

| Screen/flow | Current configuration behavior | UI | Database | Tests | Outstanding issue |
|---|---|---|---|---|---|
| Variant enablement | Exactly 20NB/50NB/50OB; idempotent; legacy untouched | HQ panel, confirmation, balances/flags | `enable_variant_stock_configurations(uuid)` | SQL and UI contracts | None |
| 50ml eligibility | HQ search/add/remove; unsafe open-demand removal blocked | Inline manager | Existing table/RLS only | Authorization/source contracts | None |
| Distributor ordering | Flavour and quantity remain variant-level | Unchanged intentionally | Resolution occurs at allocation | End-to-end SQL contract | None |
| Internal SO fulfilment | Eligibility, availability and Old Box rules; explicit atomic reallocation | Balance-aware selection cards | `set_order_item_stock_config` | UI + migration contracts | Split fulfilment intentionally unsupported |
| SO approval/cancel | Exact allocation, outbound, buyer credit and reversal | Confirmed configuration visible internally | Phase 05 RPCs + migration 07 allowlist | Migration contracts | None |
| Partial ORD receive | ORD default, idempotent exact-config receipt | Destination badge and history SKU | `post_warehouse_receipt` | UI + SQL contracts | None |
| Full/master ORD receive | Exact ORD default passed by worker/master API; RPC failures fail closed | Normal no-choice ORD UI | `record_stock_movement(...p_stock_config_id)` | Source audit | Worker remains asynchronous by design |
| Inventory | Detail rows plus non-duplicating expandable flavour total | Summary/detail, legacy warning, inactive toggle | `vw_inventory_on_hand`; base fallback for inactive | UI + report contracts | None |
| Add Stock | Exact selected config; STD auto-selected | Physical selector only for configured variants | Exact movement RPC | Helper + UI contracts | None |
| Stock Count/Excel | Exact row/config identity, drafts and posting | Three-row maximum, lifecycle, inactive toggle | Phase 04 RPC/tables | Excel/preflight/SQL tests | None |
| Repacking | 50OB→50NB only, shared RPK, atomic | Source/destination/balances/history | `repack_stock` | Component + SQL contracts | None |
| Stock Transfer | Same config at both ends; atomic lines; over-transfer blocked | Exact physical selector; STD auto | `post_stock_transfer_configured` | SQL + UI contracts | None |
| WMS QR shipping | Configuration comes only from confirmed `order_item_id` | Picking Stock SKU; missing linkage blocks | Phase 05 WMS RPCs/dedup | UI + SQL contracts | Phone/manual shipping remains STD-only by design |
| Movement Report | Configuration detail and historical NULL retained | SKU/volume/packaging/reference/date/warehouse filters | Phase 06 detail view | UI + view contracts | None |
| Incoming Stock | Variant-level incoming totals; internal default destination | Inventory incoming detail | Phase 06 aggregate views | Incoming/report tests | None |
| Low Stock/HQ/hierarchy reports | Aggregate after configuration rows | Existing management UI remains flavour-level | `v_hq_inventory` and aggregate views | View contracts | None |
| Supply-chain assistant | Variant totals by default; config drill-down in movement tool | Existing assistant surface | Configuration columns exposed | Source audit | None |
| Scratch/Spin campaigns | STD exact config only; configured variants fail clearly | Existing campaign error feedback | Exact movement parameter | Source audit + migration 07 signs | Exact configured campaign allocation is not a supported business flow |
| Permissions/navigation | HQ admin manages; warehouse operates; distributor has no admin mapping | Stable localhost paths and menus | Server auth + RLS/RPC checks | Navigation/auth contracts | None |

## Updated UI states

- Variant edit: empty enablement state; enabled three-row matrix; legacy warning; eligibility modal.
- SO order detail: requested flavour/quantity plus selectable physical cards with balances, eligibility, sufficiency and confirmation state.
- ORD receiving/history: exact destination badge and Stock SKU.
- Inventory: expandable aggregate flavour rows and configuration detail.
- Add Stock/Transfer: configured selector with physical labels; unobtrusive automatic Standard message for unrelated products.
- WMS: order-linked picking card and explicit blocked state.
- Movement Report: Stock SKU, volume and packaging filters alongside existing filters.

No real balance was automatically classified or moved by implementation or verification.
