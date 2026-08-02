begin;

-- ============================================================================
-- Opening Balance — fix "aggregate function calls cannot be nested" in preview
-- ----------------------------------------------------------------------------
-- 20260801160000 added a structured `blocker_details[]` contract by building the
-- allocation-reconciliation details with:
--
--   jsonb_agg(jsonb_build_object(
--     ...,
--     'selected_quantity', coalesce(sum(d.quantity), 0),  -- aggregate ...
--     ...))                                                -- ... inside aggregate
--
-- i.e. a `sum()` aggregate nested directly inside the outer `jsonb_agg()`
-- aggregate at the SAME query level (the query also carries its own GROUP BY /
-- HAVING). PostgreSQL forbids nesting aggregates like this, so every call to
-- `public.inventory_cutoff_preview(uuid)` raised:
--
--   aggregate function calls cannot be nested
--
-- Opening the `5th Initial` draft calls the preview on load, so the whole
-- Opening Balance workspace failed to render.
--
-- This forward-only migration replaces ONLY the public wrapper
-- `public.inventory_cutoff_preview(uuid)` and splits the allocation
-- reconciliation into two query levels:
--
--   * INNER CTE `alloc_recon` — one scalar row per (variant, stock config).
--     `coalesce(sum(d.quantity), 0)` is computed here, grouped, so the summed
--     `selected_quantity` / `difference` / `orphan` become plain scalar columns.
--   * OUTER `jsonb_agg(jsonb_build_object(...))` — references ONLY those scalar
--     columns. No sum()/count()/max() appears inside the outer aggregate.
--
-- It does NOT rename either preview function and does NOT create another
-- `_pre_*` function or any resolver. It continues to call the existing base
-- `public.inventory_cutoff_preview_pre_blocker_details(uuid)` unchanged.
--
-- Parity fix carried in from the base blockers[] query: the base allocation-
-- ownership blocker is CATEGORY-SCOPED (joins `products p` and filters
-- `p.category_id = v_cutoff.product_category_id` so Pet Food never blocks Vape).
-- 20260801160000 omitted that join, so `blocker_details[]` could have emitted an
-- allocation detail for an out-of-category variant that has no matching entry in
-- `blockers[]`, breaking the 1:1 mirror. The inner CTE below reproduces the base
-- predicates exactly, so the allocation details mirror the allocation blockers.
--
-- Read-only: no inventory, allocation, order, movement, QR or transaction data
-- is modified. `blockers[]` (legacy string list) is preserved untouched from the
-- base preview; `blocker_details[]` continues to mirror it 1:1.
-- ============================================================================

create or replace function public.inventory_cutoff_preview(p_cutoff_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_cutoff public.inventory_opening_cutoffs%rowtype;
  v_report jsonb;
  v_blockers jsonb;
  v_alloc_details jsonb;
  v_other_details jsonb;
  v_details jsonb;
begin
  select * into v_cutoff from public.inventory_opening_cutoffs where id = p_cutoff_id;
  if not found or not public.can_access_org(v_cutoff.warehouse_organization_id) then
    raise exception 'inventory_cutoff_not_found';
  end if;

  v_report := public.inventory_cutoff_preview_pre_blocker_details(p_cutoff_id);
  v_blockers := coalesce(v_report->'blockers', '[]'::jsonb);

  -- Structured detail for every ALLOCATION-OWNERSHIP blocker, rebuilt from the
  -- SAME reconciliation the base preview uses so the reason string is identical
  -- and the detail set mirrors blockers[] 1:1 (same category scope, same
  -- variant/config ownership, same mismatch predicate).
  --
  -- Two-level design (fixes the nested-aggregate failure):
  --   * inner `alloc_recon` groups per (variant, stock config) and computes the
  --     single scalar `selected_quantity` = coalesce(sum(d.quantity), 0);
  --   * the outer jsonb_agg() consumes only scalar columns — no aggregate is
  --     nested inside it.
  --
  -- Quantity multiplication is prevented by construction:
  --   * one `product_inventory` row per (variant, stock config);
  --   * the source-order enrichment is a `left join lateral (... limit 1)`, so a
  --     variant with many order_items / stock_movements yields at most one `src`
  --     row and never fans out the `d.quantity` sum;
  --   * decision rows are matched by EXACT variant + stock-config ownership via
  --     the `order_items` EXISTS predicate, so unrelated order lines cannot leak
  --     into the sum.
  with alloc_recon as (
    select
      pv.id                              as product_variant_id,
      pv.variant_name                    as variant_name,
      c.id                               as stock_config_id,
      c.config_label                     as config_label,
      pi.quantity_allocated              as allocated_quantity,
      coalesce(sum(d.quantity), 0)       as selected_quantity,
      pi.quantity_allocated - coalesce(sum(d.quantity), 0) as difference,
      (coalesce(sum(d.quantity), 0) = 0) as orphan,
      v_cutoff.warehouse_organization_id as warehouse_organization_id,
      v_cutoff.product_category_id       as product_category_id,
      v_cutoff.id                        as cutoff_id,
      src.order_id                       as source_order_id,
      src.order_number                   as source_order_number
    from public.product_inventory pi
    join public.inventory_stock_configurations c
      on c.id = pi.stock_config_id and c.variant_id = pi.variant_id
    join public.product_variants pv on pv.id = pi.variant_id
    join public.products p on p.id = pv.product_id
    left join public.inventory_cutoff_decisions d on d.cutoff_id = v_cutoff.id
      and d.transaction_kind = 'distributor'
      and exists (
        select 1 from public.order_items oi
        where oi.id = d.order_item_id
          and oi.variant_id = pi.variant_id
          and oi.stock_config_id = pi.stock_config_id)
    -- Best-effort link to the distributor order that owns an allocation movement
    -- for this variant/config in this warehouse (read-only; may be null/orphan).
    -- `limit 1` keeps this single-valued so it never multiplies the sum above.
    left join lateral (
      select o.id as order_id, coalesce(o.display_doc_no, o.order_no) as order_number
      from public.orders o
      join public.order_items oi2 on oi2.order_id = o.id
      join public.stock_movements sm on sm.reference_id = o.id
        and sm.variant_id = pi.variant_id and sm.movement_type = 'allocation'
      where o.order_type in ('D2H', 'S2D')
        and oi2.variant_id = pi.variant_id
        and oi2.stock_config_id = pi.stock_config_id
        and public.order_inventory_organization(o.id) = v_cutoff.warehouse_organization_id
      order by o.created_at desc
      limit 1
    ) src on true
    where pi.organization_id = v_cutoff.warehouse_organization_id
      and pi.quantity_allocated > 0
      and p.category_id = v_cutoff.product_category_id
    group by pv.id, pv.variant_name, c.id, c.config_label, pi.quantity_allocated,
      src.order_id, src.order_number
    having pi.quantity_allocated <> coalesce(sum(d.quantity), 0)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', 'allocation_reconciliation:' || ar.product_variant_id::text || ':' || ar.stock_config_id::text,
    'code', 'allocation_reconciliation',
    'category', 'allocation_reconciliation',
    'step', 'transactions',
    'reason', format(
      'Allocation ownership does not reconcile for %s (%s): inventory allocated %s, selected order quantity %s.',
      ar.variant_name, ar.config_label, ar.allocated_quantity, ar.selected_quantity),
    'action_label', 'Review Allocation',
    'product_variant_id', ar.product_variant_id,
    'variant_name', ar.variant_name,
    'stock_config_id', ar.stock_config_id,
    'config_label', ar.config_label,
    'warehouse_organization_id', ar.warehouse_organization_id,
    'product_category_id', ar.product_category_id,
    'cutoff_id', ar.cutoff_id,
    'allocated_quantity', ar.allocated_quantity,
    'selected_quantity', ar.selected_quantity,
    'difference', ar.difference,
    'orphan', ar.orphan,
    'allocation_status', 'allocated',
    'before_cutoff', true,
    'source_order_id', ar.source_order_id,
    'source_order_number', ar.source_order_number
  )), '[]'::jsonb)
  into v_alloc_details
  from alloc_recon ar;

  -- Every OTHER blocker becomes a `{ reason }` detail; the client classifies its
  -- step/category/action label from the reason text. Allocation-ownership strings
  -- are excluded here because they are emitted (enriched) above — this keeps each
  -- allocation blocker from being counted once as a generic blocker and again as
  -- a structured blocker.
  select coalesce(jsonb_agg(jsonb_build_object('reason', msg.value)
    order by msg.ordinality), '[]'::jsonb)
  into v_other_details
  from jsonb_array_elements_text(v_blockers) with ordinality msg(value, ordinality)
  where msg.value not like 'Allocation ownership does not reconcile for %';

  v_details := v_other_details || v_alloc_details;

  return v_report || jsonb_build_object('blocker_details', v_details);
end;
$$;

grant execute on function public.inventory_cutoff_preview(uuid) to authenticated;

comment on function public.inventory_cutoff_preview(uuid) is
  'Opening Balance preview with a structured, authoritative blocker_details[] contract. Allocation reconciliation is computed in two query levels (inner CTE aggregates sum(d.quantity); outer jsonb_agg consumes only scalar columns) so no aggregate is nested inside another. Mirrors blockers[] 1:1 (category-scoped) so Step 4 (Transactions) and Step 5 (Review & Post) consume the same blocker collection with a stable, non-text identity. Read-only: no inventory, allocation, order, movement, QR or transaction data is modified.';

commit;
