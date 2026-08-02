begin;

-- ============================================================================
-- Opening Balance Transactions — stock_adjustment reference & eligibility
-- ----------------------------------------------------------------------------
-- Forward-only correction. Does not mutate stock_adjustments / items / ledger.
--
-- Root cause:
--   inventory_cutoff_preview emitted open stock_adjustments with
--   the header UUID as reference_no, quantity hardcoded to 0, classification
--   'Complete Before Cut-off', and a readiness blocker for every
--   status <> 'completed'. Quality Issues reuse stock_adjustments as
--   complaint tickets (no inventory ledger movement) and remain draft /
--   resolved / rejected — incorrectly blocking Opening Balance.
--
-- Authoritative reference:
--   stock_adjustments has no persisted document number. Keep id as
--   reference_id for joins/audit. Leave reference_no null so the UI can
--   show an existing business number when present (transfers/returns) or a
--   dated fallback for adjustments — never invent a duplicate document no.
--
-- Eligibility:
--   Block only incomplete, non-quality-issue adjustments that have real
--   child-line quantity impact. Empty drafts and QI complaint tickets do
--   not gate cut-off. Child-line qty is summed (never abs(adjustment_quantity)).
-- ============================================================================

alter function public.inventory_cutoff_preview(uuid)
  rename to inventory_cutoff_preview_pre_stock_adjustment_eligibility;

revoke all on function
  public.inventory_cutoff_preview_pre_stock_adjustment_eligibility(uuid)
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
  v_activity jsonb;
  v_blockers jsonb;
  v_non_adjustment_blockers jsonb;
  v_adjustment_blockers jsonb;
  v_readiness text;
begin
  select * into v_cutoff
  from public.inventory_opening_cutoffs
  where id = p_cutoff_id;
  if not found or not public.can_access_org(v_cutoff.warehouse_organization_id) then
    raise exception 'inventory_cutoff_not_found';
  end if;

  v_report := public.inventory_cutoff_preview_pre_stock_adjustment_eligibility(p_cutoff_id);

  -- Rebuild warehouse_activity: keep every non-adjustment row; replace the
  -- stock_adjustment slice with authoritative eligibility + child-line qty.
  select coalesce(jsonb_agg(row_data order by occurred_at desc nulls last), '[]'::jsonb)
  into v_activity
  from (
    select
      activity_row.value as row_data,
      nullif(activity_row.value->>'occurred_at', '')::timestamptz as occurred_at
    from jsonb_array_elements(coalesce(v_report->'warehouse_activity', '[]'::jsonb))
         with ordinality activity_row(value, ordinality)
    where coalesce(activity_row.value->>'movement_type', '') <> 'stock_adjustment'

    union all

    select
      jsonb_build_object(
        'movement_type', 'stock_adjustment',
        'reference_type', 'adjustment',
        -- No persisted document number on stock_adjustments; keep UUID internal.
        'reference_no', null,
        'reference_id', a.id,
        'status', a.status,
        'quantity', coalesce((
          select sum(abs(i.adjustment_quantity))::integer
          from public.stock_adjustment_items i
          where i.adjustment_id = a.id
        ), 0),
        'occurred_at', a.created_at,
        'classification', 'Complete Before Cut-off'
      ) as row_data,
      a.created_at as occurred_at
    from public.stock_adjustments a
    left join public.stock_adjustment_reasons r on r.id = a.reason_id
    where a.organization_id = v_cutoff.warehouse_organization_id
      and coalesce(a.status, 'completed') not in (
        'completed', 'cancelled', 'resolved', 'rejected'
      )
      -- Quality Issues / complaint tickets never post inventory ledger rows.
      and coalesce(r.reason_code, '') not in (
        'quality_issue', 'return_to_supplier', 'damaged_goods'
      )
      -- Header qty is unused; only child lines prove stock impact.
      and exists (
        select 1
        from public.stock_adjustment_items i
        where i.adjustment_id = a.id
          and coalesce(i.adjustment_quantity, 0) <> 0
      )
  ) rebuilt;

  -- Drop the legacy UUID-based stock adjustment blockers; re-add only for
  -- the same inventory-impacting open set (warehouse-scoped).
  select coalesce(jsonb_agg(blocker.value order by blocker.ordinality), '[]'::jsonb)
  into v_non_adjustment_blockers
  from jsonb_array_elements_text(coalesce(v_report->'blockers', '[]'::jsonb))
       with ordinality blocker(value, ordinality)
  where blocker.value not like 'Stock adjustment %';

  select coalesce(jsonb_agg(message order by created_at desc, adjustment_id), '[]'::jsonb)
  into v_adjustment_blockers
  from (
    select
      format(
        'Stock adjustment dated %s is %s and must be completed before cut-off (impact quantity %s).',
        to_char(a.created_at at time zone 'UTC', 'DD Mon YYYY, HH24:MI'),
        a.status,
        coalesce((
          select sum(abs(i.adjustment_quantity))::integer
          from public.stock_adjustment_items i
          where i.adjustment_id = a.id
        ), 0)
      ) as message,
      a.created_at,
      a.id as adjustment_id
    from public.stock_adjustments a
    left join public.stock_adjustment_reasons r on r.id = a.reason_id
    where a.organization_id = v_cutoff.warehouse_organization_id
      and coalesce(a.status, 'completed') not in (
        'completed', 'cancelled', 'resolved', 'rejected'
      )
      and coalesce(r.reason_code, '') not in (
        'quality_issue', 'return_to_supplier', 'damaged_goods'
      )
      and exists (
        select 1
        from public.stock_adjustment_items i
        where i.adjustment_id = a.id
          and coalesce(i.adjustment_quantity, 0) <> 0
      )
  ) impacting;

  v_blockers := v_non_adjustment_blockers || v_adjustment_blockers;
  v_readiness := case
    when jsonb_array_length(v_blockers) > 0 then 'Blocked'
    when jsonb_array_length(coalesce(v_report->'review_items', '[]'::jsonb)) > 0
      then 'Review Required'
    else 'Ready'
  end;

  return v_report || jsonb_build_object(
    'warehouse_activity', v_activity,
    'blockers', v_blockers,
    'readiness', v_readiness
  );
end;
$$;

grant execute on function public.inventory_cutoff_preview(uuid) to authenticated;

comment on function public.inventory_cutoff_preview(uuid) is
  'Opening Balance preview. Stock adjustments: internal reference_id only, child-line quantity, and readiness blockers limited to incomplete non-quality-issue rows with real line impact. Quality Issue complaint tickets do not gate cut-off.';

commit;
