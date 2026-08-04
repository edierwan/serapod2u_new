-- Forward-only correction for the H2M bulk response contract and Not Incoming
-- targeting. This migration intentionally preserves the existing signatures,
-- authorization, locking, idempotency and per-item decision writer.
begin;

create or replace function public.inventory_cutoff_h2m_bulk_preflight(
  p_cutoff_id uuid,
  p_action text,
  p_order_ids uuid[] default '{}'
) returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp as $$
declare
  v_cutoff public.inventory_opening_cutoffs%rowtype;
  v_category_name text;
  v_result jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and (auth.uid() is null or not public.inventory_cutoff_is_hq_admin()) then
    raise exception 'permission_denied';
  end if;
  if p_action not in (
    'selected_incoming','selected_not_incoming','all_remaining_not_incoming'
  ) then
    raise exception 'inventory_cutoff_h2m_bulk_action_invalid';
  end if;
  if p_action <> 'all_remaining_not_incoming'
     and coalesce(cardinality(p_order_ids), 0) = 0 then
    raise exception 'inventory_cutoff_h2m_bulk_selection_required';
  end if;

  select cutoff.* into v_cutoff
  from public.inventory_opening_cutoffs cutoff
  where cutoff.id = p_cutoff_id
    and cutoff.status = 'counting';
  if not found then
    raise exception 'inventory_cutoff_not_active';
  end if;

  -- The immutable count session and cutoff must identify the same category.
  -- Every subsequent item predicate uses that authoritative category id.
  select category_row.category_name into v_category_name
  from public.stock_count_sessions session_row
  join public.product_categories category_row
    on category_row.id = session_row.product_category_id
   and category_row.is_active = true
  where session_row.id = v_cutoff.stock_count_session_id
    and session_row.product_category_id = v_cutoff.product_category_id;
  if v_cutoff.product_category_id is null or v_category_name is null then
    raise exception 'stock_count_active_product_category_required';
  end if;

  with scoped as (
    select
      order_row.id order_id,
      order_item.id order_item_id,
      decision_row.decision,
      resolution.eligible incoming_eligible,
      resolution.reason_code,
      resolution.stock_config_id
    from public.orders order_row
    join public.order_items order_item
      on order_item.order_id = order_row.id
    join public.product_variants variant
      on variant.id = order_item.variant_id
    join public.products product
      on product.id = variant.product_id
    left join (
      select
        receipt_item.order_id,
        receipt_item.variant_id,
        sum(receipt_item.received_now)::integer received_qty
      from public.warehouse_receipt_items receipt_item
      group by receipt_item.order_id, receipt_item.variant_id
    ) receipt
      on receipt.order_id = order_row.id
     and receipt.variant_id = order_item.variant_id
    left join public.inventory_cutoff_decisions decision_row
      on decision_row.cutoff_id = v_cutoff.id
     and decision_row.transaction_kind = 'manufacturer'
     and decision_row.order_item_id = order_item.id
    cross join lateral public.resolve_inventory_cutoff_h2m_incoming(
      v_cutoff.id,
      array[order_item.id]
    ) resolution
    where order_row.order_type = 'H2M'
      and order_row.status in ('approved','closed')
      and public.resolve_order_destination_warehouse(order_row.buyer_org_id) =
          v_cutoff.warehouse_organization_id
      and product.category_id = v_cutoff.product_category_id
      and greatest(order_item.qty - coalesce(receipt.received_qty, 0), 0) > 0
  ), targeted as (
    select
      scoped.*,
      scoped.decision is null unresolved,
      case
        when scoped.decision is not null then false
        when p_action = 'selected_incoming' then scoped.incoming_eligible
        else true
      end eligible
    from scoped
    where p_action = 'all_remaining_not_incoming'
       or scoped.order_id = any(coalesce(p_order_ids, '{}'))
  ), aggregate_row as (
    select
      count(*) filter (where targeted.eligible)::integer eligible_item_count,
      count(distinct order_id)
        filter (where targeted.eligible)::integer affected_order_count,
      count(*) filter (where not targeted.unresolved)::integer resolved_item_count,
      count(*) filter (
        where decision = 'carry_forward_incoming'
      )::integer saved_incoming_count,
      count(*) filter (
        where decision = 'history_only'
      )::integer saved_not_incoming_count,
      count(*) filter (
        where p_action = 'selected_incoming'
          and targeted.unresolved
          and not targeted.incoming_eligible
      )::integer blocked_item_count,
      coalesce(
        array_agg(distinct order_id order by order_id)
          filter (where targeted.eligible),
        '{}'
      ) eligible_order_ids,
      coalesce(
        array_agg(order_item_id order by order_item_id)
          filter (where targeted.eligible),
        '{}'
      ) eligible_item_ids,
      coalesce(
        array_agg(order_item_id order by order_item_id)
          filter (
            where p_action = 'selected_incoming'
              and targeted.unresolved
              and not targeted.incoming_eligible
          ),
        '{}'
      ) blocked_item_ids,
      md5(concat_ws(
        '|',
        v_cutoff.id::text,
        v_cutoff.product_category_id::text,
        p_action,
        coalesce(
          string_agg(
            concat_ws(
              ':',
              order_item_id::text,
              coalesce(decision, ''),
              incoming_eligible::text,
              coalesce(stock_config_id::text, '')
            ),
            ',' order by order_item_id
          ),
          ''
        )
      )) confirmation_fingerprint
    from targeted
  )
  select jsonb_build_object(
    'action', p_action,
    'cutoff_id', v_cutoff.id,
    'confirmation_fingerprint', aggregate_row.confirmation_fingerprint,
    'product_category_id', v_cutoff.product_category_id,
    'product_category_name', v_category_name,
    'eligible_item_count', aggregate_row.eligible_item_count,
    'affected_order_count', aggregate_row.affected_order_count,
    'resolved_item_count', aggregate_row.resolved_item_count,
    'saved_incoming_count', aggregate_row.saved_incoming_count,
    'saved_not_incoming_count', aggregate_row.saved_not_incoming_count,
    'blocked_item_count', aggregate_row.blocked_item_count,
    'eligible_order_ids', to_jsonb(aggregate_row.eligible_order_ids),
    'eligible_item_ids', to_jsonb(aggregate_row.eligible_item_ids),
    'blocked_item_ids', to_jsonb(aggregate_row.blocked_item_ids)
  ) into v_result
  from aggregate_row;

  return v_result;
end;
$$;

revoke all on function public.inventory_cutoff_h2m_bulk_preflight(
  uuid,
  text,
  uuid[]
) from public, anon;
grant execute on function public.inventory_cutoff_h2m_bulk_preflight(
  uuid,
  text,
  uuid[]
) to authenticated, service_role;

comment on function public.inventory_cutoff_h2m_bulk_preflight(
  uuid,
  text,
  uuid[]
) is
  'Read-only authoritative H2M bulk snapshot. Uses the cutoff/session category, excludes saved decisions from targets, requires Incoming configuration only for selected_incoming, and returns the canonical confirmation contract.';

create or replace function public.apply_inventory_cutoff_h2m_bulk(
  p_cutoff_id uuid,
  p_action text,
  p_order_ids uuid[],
  p_expected_fingerprint text,
  p_idempotency_key uuid
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_summary jsonb;
  v_existing public.inventory_cutoff_h2m_bulk_requests%rowtype;
  v_order_item_id uuid;
  v_decision text;
  v_result jsonb;
begin
  if v_user is null or not public.inventory_cutoff_is_hq_admin() then
    raise exception 'permission_denied';
  end if;
  if p_idempotency_key is null then
    raise exception 'inventory_cutoff_h2m_bulk_idempotency_key_required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('inventory-cutoff-h2m-bulk:' || p_cutoff_id::text, 0)
  );
  perform 1
  from public.inventory_opening_cutoffs
  where id = p_cutoff_id
  for update;

  select * into v_existing
  from public.inventory_cutoff_h2m_bulk_requests
  where cutoff_id = p_cutoff_id
    and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.action <> p_action
       or v_existing.requested_order_ids
          is distinct from coalesce(p_order_ids, '{}')
       or v_existing.scope_fingerprint <> p_expected_fingerprint then
      raise exception 'inventory_cutoff_h2m_bulk_idempotency_conflict';
    end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;

  -- Recompute the authoritative unresolved/category/configuration scope while
  -- holding the same cutoff lock used by the decision writer.
  v_summary := public.inventory_cutoff_h2m_bulk_preflight(
    p_cutoff_id,
    p_action,
    coalesce(p_order_ids, '{}')
  );
  if coalesce(v_summary->>'confirmation_fingerprint', '') <>
     coalesce(p_expected_fingerprint, '') then
    raise exception 'inventory_cutoff_h2m_bulk_scope_changed';
  end if;
  if coalesce((v_summary->>'eligible_item_count')::integer, 0) = 0 then
    raise exception 'inventory_cutoff_h2m_bulk_no_eligible_items';
  end if;

  v_decision := case
    when p_action = 'selected_incoming' then 'carry_forward_incoming'
    else 'history_only'
  end;
  for v_order_item_id in
    select value::text::uuid
    from jsonb_array_elements_text(v_summary->'eligible_item_ids') value
    order by value::text
  loop
    perform public.set_inventory_cutoff_decision(
      p_cutoff_id,
      v_order_item_id,
      v_decision
    );
  end loop;

  v_result := v_summary || jsonb_build_object(
    'applied_item_count', (v_summary->>'eligible_item_count')::integer,
    'decision', v_decision,
    'idempotent_replay', false
  );
  insert into public.inventory_cutoff_h2m_bulk_requests(
    cutoff_id,
    idempotency_key,
    action,
    scope_fingerprint,
    requested_order_ids,
    result,
    created_by
  ) values (
    p_cutoff_id,
    p_idempotency_key,
    p_action,
    p_expected_fingerprint,
    coalesce(p_order_ids, '{}'),
    v_result,
    v_user
  );
  return v_result;
end;
$$;

revoke all on function public.apply_inventory_cutoff_h2m_bulk(
  uuid,
  text,
  uuid[],
  text,
  uuid
) from public, anon;
grant execute on function public.apply_inventory_cutoff_h2m_bulk(
  uuid,
  text,
  uuid[],
  text,
  uuid
) to authenticated;

comment on function public.apply_inventory_cutoff_h2m_bulk(
  uuid,
  text,
  uuid[],
  text,
  uuid
) is
  'Atomically applies a confirmed canonical H2M bulk snapshot. Revalidates cutoff/category/unresolved scope and fingerprint under lock, preserves saved decisions, and remains idempotent.';

notify pgrst, 'reload schema';

commit;
