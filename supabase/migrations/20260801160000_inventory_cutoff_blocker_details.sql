begin;

-- ============================================================================
-- Opening Balance — authoritative structured blocker contract (blocker_details)
-- ----------------------------------------------------------------------------
-- Review & Post (Step 5) reported an allocation-ownership blocker that Step 4
-- could not surface: the message lives only in the top-level `report.blockers[]`
-- string list. It is NOT a scoped transaction (`inventory_cutoff_transactions_
-- scoped`), so it never reaches `transactions_historical_summary.blocked_count`
-- or the Step 4 transaction list — leaving Step 4 reading "All resolved" (0)
-- while Step 5 reported one blocker.
--
-- This migration adds a STRUCTURED, authoritative `blocker_details[]` array to
-- the preview so BOTH steps consume the same collection with a stable, non-text
-- identity (variant id, stock config id, source order, quantities, boundary).
-- The allocation-ownership blocker is enriched with its source allocation and
-- related distributor order when one exists.
--
-- Forward-only. Does NOT edit prior migrations. Read-only preview wrapper:
--   * no inventory, allocation, order, QR or transaction data is modified;
--   * the legacy `blockers[]` string list is preserved unchanged for
--     backward-compatibility (older clients keep working);
--   * `blocker_details` mirrors `blockers[]` 1:1 in count, so Step 4 and Step 5
--     can never diverge.
-- No resolver is created here: every mutating resolution stays gated behind an
-- explicit user action and its own validated RPC.
-- ============================================================================

alter function public.inventory_cutoff_preview(uuid)
  rename to inventory_cutoff_preview_pre_blocker_details;

revoke all on function
  public.inventory_cutoff_preview_pre_blocker_details(uuid)
  from public;

create function public.inventory_cutoff_preview(p_cutoff_id uuid)
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
  -- same reconciliation the base preview uses so the reason string is identical.
  -- Enriched with the source allocation identity and, when one exists, the
  -- related distributor order that owns an allocation movement for the variant.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', 'allocation_reconciliation:' || pv.id::text || ':' || c.id::text,
    'code', 'allocation_reconciliation',
    'category', 'allocation_reconciliation',
    'step', 'transactions',
    'reason', format(
      'Allocation ownership does not reconcile for %s (%s): inventory allocated %s, selected order quantity %s.',
      pv.variant_name, c.config_label, pi.quantity_allocated, coalesce(sum(d.quantity), 0)),
    'action_label', 'Review Allocation',
    'product_variant_id', pv.id,
    'variant_name', pv.variant_name,
    'stock_config_id', c.id,
    'config_label', c.config_label,
    'warehouse_organization_id', v_cutoff.warehouse_organization_id,
    'product_category_id', v_cutoff.product_category_id,
    'cutoff_id', v_cutoff.id,
    'allocated_quantity', pi.quantity_allocated,
    'selected_quantity', coalesce(sum(d.quantity), 0),
    'difference', pi.quantity_allocated - coalesce(sum(d.quantity), 0),
    'orphan', coalesce(sum(d.quantity), 0) = 0,
    'allocation_status', 'allocated',
    'before_cutoff', true,
    'source_order_id', src.order_id,
    'source_order_number', src.order_number
  )), '[]'::jsonb)
  into v_alloc_details
  from public.product_inventory pi
  join public.inventory_stock_configurations c
    on c.id = pi.stock_config_id and c.variant_id = pi.variant_id
  join public.product_variants pv on pv.id = pi.variant_id
  left join public.inventory_cutoff_decisions d on d.cutoff_id = v_cutoff.id
    and d.transaction_kind = 'distributor'
    and exists (
      select 1 from public.order_items oi
      where oi.id = d.order_item_id
        and oi.variant_id = pi.variant_id
        and oi.stock_config_id = pi.stock_config_id)
  -- Best-effort link to the distributor order that owns an allocation movement
  -- for this variant/config in this warehouse (read-only; may be null/orphan).
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
  group by pv.id, pv.variant_name, c.id, c.config_label, pi.quantity_allocated,
    src.order_id, src.order_number
  having pi.quantity_allocated <> coalesce(sum(d.quantity), 0);

  -- Every OTHER blocker becomes a `{ reason }` detail; the client classifies its
  -- step/category/action label from the reason text. Allocation-ownership strings
  -- are excluded here because they are emitted (enriched) above.
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
  'Opening Balance preview with a structured, authoritative blocker_details[] contract. Mirrors blockers[] 1:1 so Step 4 (Transactions) and Step 5 (Review & Post) consume the same blocker collection with a stable, non-text identity. Allocation-ownership blockers are enriched with the source allocation, quantities, boundary and related distributor order. Read-only: no inventory, allocation, order, QR or transaction data is modified.';

commit;
