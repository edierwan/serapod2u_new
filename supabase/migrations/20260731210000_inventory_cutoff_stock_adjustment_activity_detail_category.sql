begin;

-- ============================================================================
-- Opening Balance Transactions — adjustment detail + category scope
-- ----------------------------------------------------------------------------
-- Forward-only correction. Does not mutate stock_adjustments / items / ledger /
-- orders / QR / receipt / opening-balance quantities.
--
-- Builds on 20260731190000 (header eligibility + child-line quantity):
--   * Scope open stock adjustments by inventory_opening_cutoffs.product_category_id
--     through stock_adjustment_items.variant_id -> product_variants -> products.
--     Pet Food must not appear or block a Vape Opening Balance.
--   * Emit authoritative child-line detail (variant, configuration, quantity)
--     under each adjustment header. One warehouse_activity row remains one
--     document/header — never flatten children into sibling activity rows and
--     never group unrelated headers by timestamp.
--   * Count distinct headers separately from child items; quantity and blockers
--     continue to use category-scoped non-zero child lines.
-- ============================================================================

alter function public.inventory_cutoff_preview(uuid)
  rename to inventory_cutoff_preview_pre_stock_adjustment_detail;

revoke all on function
  public.inventory_cutoff_preview_pre_stock_adjustment_detail(uuid)
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
  v_warehouse_name text;
begin
  select * into v_cutoff
  from public.inventory_opening_cutoffs
  where id = p_cutoff_id;
  if not found or not public.can_access_org(v_cutoff.warehouse_organization_id) then
    raise exception 'inventory_cutoff_not_found';
  end if;

  if v_cutoff.product_category_id is null
     or not exists (
       select 1
       from public.product_categories category_row
       where category_row.id = v_cutoff.product_category_id
         and category_row.is_active = true
     ) then
    raise exception 'stock_count_active_product_category_required';
  end if;

  select coalesce(nullif(trim(o.org_name), ''), 'Warehouse')
  into v_warehouse_name
  from public.organizations o
  where o.id = v_cutoff.warehouse_organization_id;

  v_report := public.inventory_cutoff_preview_pre_stock_adjustment_detail(p_cutoff_id);

  -- Keep every non-adjustment activity row; replace stock_adjustment slice with
  -- category-scoped headers + child-line detail.
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
        'reference_no', null,
        'reference_id', a.id,
        'status', a.status,
        'quantity', coalesce(impact.total_quantity, 0),
        'line_count', coalesce(impact.line_count, 0),
        'variant_count', coalesce(impact.variant_count, 0),
        'occurred_at', a.created_at,
        'classification', 'Complete Before Cut-off',
        'required_action', 'Complete or Cancel',
        'warehouse', coalesce(v_warehouse_name, 'Warehouse'),
        'items', coalesce(impact.items, '[]'::jsonb)
      ) as row_data,
      a.created_at as occurred_at
    from public.stock_adjustments a
    left join public.stock_adjustment_reasons r on r.id = a.reason_id
    cross join lateral (
      select
        sum(abs(i.adjustment_quantity))::integer as total_quantity,
        count(*)::integer as line_count,
        count(distinct i.variant_id)::integer as variant_count,
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'item_id', i.id,
              'variant_id', i.variant_id,
              'variant_name', pv.variant_name,
              'alternative_name', nullif(trim(pv.alternative_name), ''),
              'stock_config_id', i.stock_config_id,
              'stock_configuration', coalesce(nullif(trim(c.config_label), ''), 'Unclassified'),
              'quantity', abs(i.adjustment_quantity)::integer,
              'warehouse', coalesce(v_warehouse_name, 'Warehouse'),
              'status', a.status
            )
            order by pv.variant_name, coalesce(c.config_label, 'Unclassified'), i.id
          ),
          '[]'::jsonb
        ) as items
      from public.stock_adjustment_items i
      join public.product_variants pv on pv.id = i.variant_id
      join public.products p on p.id = pv.product_id
      left join public.inventory_stock_configurations c
        on c.id = i.stock_config_id
       and c.variant_id = i.variant_id
      where i.adjustment_id = a.id
        and coalesce(i.adjustment_quantity, 0) <> 0
        and p.category_id = v_cutoff.product_category_id
    ) impact
    where a.organization_id = v_cutoff.warehouse_organization_id
      and coalesce(a.status, 'completed') not in (
        'completed', 'cancelled', 'resolved', 'rejected'
      )
      and coalesce(r.reason_code, '') not in (
        'quality_issue', 'return_to_supplier', 'damaged_goods'
      )
      and coalesce(impact.line_count, 0) > 0
  ) rebuilt;

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
        'Stock adjustment dated %s is %s and must be completed before cut-off (impact quantity %s across %s item(s)).',
        to_char(a.created_at at time zone 'UTC', 'DD Mon YYYY, HH24:MI'),
        a.status,
        coalesce(impact.total_quantity, 0),
        coalesce(impact.line_count, 0)
      ) as message,
      a.created_at,
      a.id as adjustment_id
    from public.stock_adjustments a
    left join public.stock_adjustment_reasons r on r.id = a.reason_id
    cross join lateral (
      select
        sum(abs(i.adjustment_quantity))::integer as total_quantity,
        count(*)::integer as line_count
      from public.stock_adjustment_items i
      join public.product_variants pv on pv.id = i.variant_id
      join public.products p on p.id = pv.product_id
      where i.adjustment_id = a.id
        and coalesce(i.adjustment_quantity, 0) <> 0
        and p.category_id = v_cutoff.product_category_id
    ) impact
    where a.organization_id = v_cutoff.warehouse_organization_id
      and coalesce(a.status, 'completed') not in (
        'completed', 'cancelled', 'resolved', 'rejected'
      )
      and coalesce(r.reason_code, '') not in (
        'quality_issue', 'return_to_supplier', 'damaged_goods'
      )
      and coalesce(impact.line_count, 0) > 0
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
  'Opening Balance preview. Stock adjustments: one activity row per header, category-scoped child-line detail/quantity, and readiness blockers limited to incomplete non-quality-issue rows with real in-category line impact.';

commit;
