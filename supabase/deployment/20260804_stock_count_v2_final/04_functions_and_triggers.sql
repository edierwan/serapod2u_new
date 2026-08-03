-- =============================================================================
-- 04_functions_and_triggers.sql  [SCHEMA CHANGE]
-- =============================================================================
-- PURPOSE      : Install the FINAL definition of every supporting function and trigger.
-- PREREQUISITES: 02 and 03 completed.
-- MUTATES      : SCHEMA ONLY (function/trigger definitions). No business row is modified. The function BODIES may write rows when the application later calls them, but installing them writes nothing.
-- EXPECTED     : Every function below exists with the exact signature the app calls.
-- VERIFY       : 08_post_deployment_verification.sql sections F and TR.
-- IDEMPOTENCY  : every function uses CREATE OR REPLACE and every trigger is
--                DROP TRIGGER IF EXISTS + CREATE TRIGGER, so this file is safely
--                rerunnable from any starting state.
-- DELIBERATE   : the historical migrations installed inventory_cutoff_preview and
--                verify_and_post_inventory_opening_cutoff via
--                "ALTER FUNCTION ... RENAME TO ..._pre_<x>" + "CREATE FUNCTION".
--                That pattern is NOT rerunnable and leaves _pre_* clutter behind.
--                This pack instead installs the final bodies with CREATE OR
--                REPLACE in 07_final_contract_fixes.sql. No rename is replayed.
-- -----------------------------------------------------------------------------
-- All SQL bodies below are copied verbatim from the authoritative migrations
-- listed per section. Only selection, ordering and idempotency guards are new.
-- Authoritative application commit: 9a62556aae6f64af3bc98f159196179669311b3f
-- =============================================================================

BEGIN;

-- ---- source (verbatim): supabase/migrations/20260731230000_inventory_cutoff_d2h_policy.sql

create or replace function public.inventory_cutoff_d2h_scoped_orders(p_cutoff_id uuid)
returns table (
  order_id uuid,
  order_item_id uuid,
  order_number text,
  status text,
  customer text,
  warehouse text,
  variant_id uuid,
  variant_name text,
  quantity integer,
  order_created_at timestamptz,
  product_category_id uuid,
  has_active_allocation boolean,
  has_order_fulfillment boolean,
  decision text,
  carry_forward_eligible boolean,
  carry_forward_reason text,
  carry_stock_config_id uuid
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_cutoff public.inventory_opening_cutoffs%rowtype;
  v_boundary timestamptz;
begin
  select * into v_cutoff from public.inventory_opening_cutoffs where id = p_cutoff_id;
  if not found then
    raise exception 'inventory_cutoff_not_found';
  end if;
  if v_cutoff.product_category_id is null then
    raise exception 'stock_count_active_product_category_required';
  end if;

  v_boundary := coalesce(v_cutoff.posted_at, v_cutoff.proposed_cutoff_at);

  return query
  with base as (
    select
      o.id as order_id,
      oi.id as order_item_id,
      coalesce(o.display_doc_no, o.order_no) as order_number,
      o.status::text as status,
      buyer.org_name as customer,
      wh.org_name as warehouse,
      oi.variant_id,
      pv.variant_name,
      oi.qty::integer as quantity,
      o.created_at as order_created_at,
      p.category_id as product_category_id,
      exists (
        select 1 from public.stock_movements sm
        where sm.reference_id = o.id
          and sm.variant_id = oi.variant_id
          and sm.movement_type = 'allocation'
      ) and not exists (
        select 1 from public.stock_movements sm
        where sm.reference_id = o.id
          and sm.variant_id = oi.variant_id
          and sm.movement_type in ('deallocation', 'order_fulfillment')
      ) as has_active_allocation,
      exists (
        select 1 from public.stock_movements sm
        where sm.reference_id = o.id
          and sm.variant_id = oi.variant_id
          and sm.movement_type = 'order_fulfillment'
      ) as has_order_fulfillment,
      d.decision,
      resolution.eligible as carry_forward_eligible,
      resolution.reason_code as carry_forward_reason,
      resolution.stock_config_id as carry_stock_config_id
    from public.orders o
    join public.order_items oi on oi.order_id = o.id
    join public.product_variants pv on pv.id = oi.variant_id
    join public.products p on p.id = pv.product_id
    join public.organizations buyer on buyer.id = o.buyer_org_id
    left join public.organizations wh
      on wh.id = public.order_inventory_organization(o.id)
    left join public.inventory_cutoff_decisions d
      on d.cutoff_id = v_cutoff.id
     and d.transaction_kind = 'distributor'
     and d.order_item_id = oi.id
    left join lateral public.resolve_inventory_cutoff_d2h_carry_forward(
      v_cutoff.id, array[oi.id]
    ) resolution on true
    where o.order_type in ('D2H', 'S2D')
      and public.order_inventory_organization(o.id) = v_cutoff.warehouse_organization_id
      and p.category_id = v_cutoff.product_category_id
      and o.created_at < v_boundary
      and (o.status <> 'draft' or exists (
        select 1 from public.stock_movements sm where sm.reference_id = o.id
      ))
  )
  select * from base
  order by order_created_at, order_id, order_item_id;
end;
$$;

revoke all on function public.inventory_cutoff_d2h_scoped_orders(uuid)
  from public, anon;

grant execute on function public.inventory_cutoff_d2h_scoped_orders(uuid)
  to authenticated, service_role;

-- ---- source (verbatim): supabase/migrations/20260731230000_inventory_cutoff_d2h_policy.sql

create or replace function public.inventory_cutoff_d2h_policy_preflight(
  p_cutoff_id uuid,
  p_policy text,
  p_selected_order_ids uuid[] default '{}'
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_cutoff public.inventory_opening_cutoffs%rowtype;
  v_category_name text;
  v_boundary timestamptz;
  v_result jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and (auth.uid() is null or not public.inventory_cutoff_is_hq_admin()) then
    raise exception 'permission_denied';
  end if;
  if p_policy not in ('exclude_all', 'review_select') then
    raise exception 'inventory_cutoff_d2h_policy_invalid';
  end if;
  if p_policy = 'review_select'
     and coalesce(cardinality(p_selected_order_ids), 0) = 0 then
    -- Empty selection is valid: all eligible orders remain historical.
    null;
  end if;

  select * into v_cutoff
  from public.inventory_opening_cutoffs
  where id = p_cutoff_id and status = 'counting';
  if not found then
    raise exception 'inventory_cutoff_not_active';
  end if;

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

  v_boundary := coalesce(v_cutoff.posted_at, v_cutoff.proposed_cutoff_at);

  with scoped as (
    select * from public.inventory_cutoff_d2h_scoped_orders(p_cutoff_id)
  ), orders as (
    select
      order_id,
      min(order_number) as order_number,
      min(status) as status,
      min(customer) as customer,
      count(*)::integer as item_count,
      sum(quantity)::integer as ordered_quantity,
      bool_or(has_active_allocation) as has_active_allocation,
      bool_or(has_order_fulfillment) as has_order_fulfillment,
      bool_and(coalesce(carry_forward_eligible, false)) as carry_forward_eligible,
      (array_agg(carry_forward_reason) filter (
        where not coalesce(carry_forward_eligible, false)
      ))[1] as blocked_reason
    from scoped
    group by order_id
  ), classified as (
    select
      orders.*,
      case
        when p_policy = 'exclude_all' then 'exclude'
        when orders.order_id = any(coalesce(p_selected_order_ids, '{}')) then
          case
            when orders.status = 'submitted'
                 and orders.has_active_allocation
                 and orders.carry_forward_eligible then 'select'
            else 'blocked'
          end
        else 'exclude'
      end as treatment
    from orders
  ), aggregates as (
    select
      count(*)::integer as eligible_order_count,
      coalesce(sum(item_count), 0)::integer as eligible_item_count,
      coalesce(sum(ordered_quantity), 0)::integer as eligible_quantity,
      count(*) filter (where treatment = 'select')::integer as selected_order_count,
      coalesce(sum(item_count) filter (where treatment = 'select'), 0)::integer
        as selected_item_count,
      coalesce(sum(ordered_quantity) filter (where treatment = 'select'), 0)::integer
        as selected_quantity,
      count(*) filter (where treatment = 'exclude')::integer as excluded_order_count,
      coalesce(sum(item_count) filter (where treatment = 'exclude'), 0)::integer
        as excluded_item_count,
      coalesce(sum(ordered_quantity) filter (where treatment = 'exclude'), 0)::integer
        as excluded_quantity,
      count(*) filter (where treatment = 'blocked')::integer as blocked_order_count,
      coalesce(
        array_agg(order_id order by order_id),
        '{}'
      ) as eligible_order_ids,
      coalesce(
        array_agg(order_id order by order_id) filter (where treatment = 'select'),
        '{}'
      ) as selected_order_ids,
      coalesce(
        array_agg(order_id order by order_id) filter (where treatment = 'exclude'),
        '{}'
      ) as excluded_order_ids,
      coalesce(
        array_agg(order_id order by order_id) filter (where treatment = 'blocked'),
        '{}'
      ) as blocked_order_ids,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'order_id', order_id,
            'order_number', order_number,
            'status', status,
            'customer', customer,
            'item_count', item_count,
            'ordered_quantity', ordered_quantity,
            'treatment', treatment,
            'blocked_reason', blocked_reason,
            'has_active_allocation', has_active_allocation,
            'has_order_fulfillment', has_order_fulfillment
          )
          order by order_number, order_id
        ),
        '[]'::jsonb
      ) as order_summaries,
      md5(concat_ws(
        '|',
        v_cutoff.id::text,
        v_cutoff.product_category_id::text,
        p_policy,
        v_boundary::text,
        coalesce(
          string_agg(
            concat_ws(':', order_id::text, treatment, status, item_count::text, ordered_quantity::text),
            ',' order by order_id
          ),
          ''
        )
      )) as confirmation_fingerprint
    from classified
  )
  select jsonb_build_object(
    'policy', p_policy,
    'cutoff_id', v_cutoff.id,
    'boundary_at', v_boundary,
    'confirmation_fingerprint', aggregates.confirmation_fingerprint,
    'warehouse_organization_id', v_cutoff.warehouse_organization_id,
    'company_id', v_cutoff.company_id,
    'product_category_id', v_cutoff.product_category_id,
    'product_category_name', v_category_name,
    'eligible_order_count', aggregates.eligible_order_count,
    'eligible_item_count', aggregates.eligible_item_count,
    'eligible_quantity', aggregates.eligible_quantity,
    'selected_order_count', aggregates.selected_order_count,
    'selected_item_count', aggregates.selected_item_count,
    'selected_quantity', aggregates.selected_quantity,
    'excluded_order_count', aggregates.excluded_order_count,
    'excluded_item_count', aggregates.excluded_item_count,
    'excluded_quantity', aggregates.excluded_quantity,
    'blocked_order_count', aggregates.blocked_order_count,
    'eligible_order_ids', to_jsonb(aggregates.eligible_order_ids),
    'selected_order_ids', to_jsonb(aggregates.selected_order_ids),
    'excluded_order_ids', to_jsonb(aggregates.excluded_order_ids),
    'blocked_order_ids', to_jsonb(aggregates.blocked_order_ids),
    'order_summaries', aggregates.order_summaries,
    'orders_cancelled', false,
    'historical_movements_reversed', false,
    'qr_impact', 'none',
    'notice', case
      when p_policy = 'exclude_all' then
        format(
          '%s historical D2H orders will be excluded from the new inventory baseline. Order history and reporting remain unchanged.',
          aggregates.eligible_order_count
        )
      else
        format(
          '%s order(s) selected to carry into new inventory; %s remain historical.',
          aggregates.selected_order_count,
          aggregates.excluded_order_count
        )
    end
  ) into v_result
  from aggregates;

  return v_result;
end;
$$;

revoke all on function public.inventory_cutoff_d2h_policy_preflight(uuid, text, uuid[])
  from public, anon;

grant execute on function public.inventory_cutoff_d2h_policy_preflight(uuid, text, uuid[])
  to authenticated, service_role;

-- ---- source (verbatim): supabase/migrations/20260731230000_inventory_cutoff_d2h_policy.sql

create or replace function public.apply_inventory_cutoff_d2h_policy(
  p_cutoff_id uuid,
  p_policy text,
  p_selected_order_ids uuid[],
  p_expected_fingerprint text,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_summary jsonb;
  v_existing public.inventory_cutoff_d2h_policy_requests%rowtype;
  v_cutoff public.inventory_opening_cutoffs%rowtype;
  v_item record;
  v_selected uuid[] := coalesce(p_selected_order_ids, '{}');
  v_result jsonb;
  v_decision text;
begin
  if v_user is null or not public.inventory_cutoff_is_hq_admin() then
    raise exception 'permission_denied';
  end if;
  if p_idempotency_key is null then
    raise exception 'inventory_cutoff_d2h_policy_idempotency_key_required';
  end if;
  if p_policy not in ('exclude_all', 'review_select') then
    raise exception 'inventory_cutoff_d2h_policy_invalid';
  end if;

  -- Advisory lock is cutoff-scoped. Never invokes the Opening Balance cancel RPC.
  perform pg_advisory_xact_lock(
    hashtextextended('inventory-cutoff-d2h-policy:' || p_cutoff_id::text, 0)
  );

  select * into v_cutoff
  from public.inventory_opening_cutoffs
  where id = p_cutoff_id
  for update;
  if not found or v_cutoff.status <> 'counting' then
    raise exception 'inventory_cutoff_not_active';
  end if;

  select * into v_existing
  from public.inventory_cutoff_d2h_policy_requests
  where cutoff_id = p_cutoff_id
    and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.policy <> p_policy
       or v_existing.requested_order_ids is distinct from v_selected
       or v_existing.scope_fingerprint <> p_expected_fingerprint then
      raise exception 'inventory_cutoff_d2h_policy_idempotency_conflict';
    end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;

  v_summary := public.inventory_cutoff_d2h_policy_preflight(
    p_cutoff_id, p_policy, v_selected
  );
  if coalesce(v_summary->>'confirmation_fingerprint', '') <>
     coalesce(p_expected_fingerprint, '') then
    raise exception 'inventory_cutoff_d2h_policy_scope_changed';
  end if;
  if coalesce((v_summary->>'blocked_order_count')::integer, 0) > 0
     and p_policy = 'review_select' then
    raise exception 'inventory_cutoff_d2h_policy_selection_blocked';
  end if;

  -- Replace distributor decisions for the scoped universe. Out-of-scope
  -- (other category / post-boundary) decisions are left untouched.
  delete from public.inventory_cutoff_decisions d
  using public.inventory_cutoff_d2h_scoped_orders(p_cutoff_id) scoped
  where d.cutoff_id = p_cutoff_id
    and d.transaction_kind = 'distributor'
    and d.order_item_id = scoped.order_item_id;

  for v_item in
    select *
    from public.inventory_cutoff_d2h_scoped_orders(p_cutoff_id)
    where status = 'submitted'
      and has_active_allocation
    order by order_id, order_item_id
  loop
    if p_policy = 'exclude_all' then
      v_decision := 'do_not_carry_forward';
    elsif exists (
      select 1
      from jsonb_array_elements_text(v_summary->'selected_order_ids') selected(value)
      where selected.value::uuid = v_item.order_id
    ) then
      v_decision := 'carry_forward';
    else
      v_decision := 'do_not_carry_forward';
    end if;

    perform public.set_inventory_cutoff_decision(
      p_cutoff_id,
      v_item.order_item_id,
      v_decision
    );
  end loop;

  insert into public.inventory_cutoff_d2h_policies (
    cutoff_id, policy, boundary_at,
    warehouse_organization_id, company_id, product_category_id,
    eligible_order_count, eligible_item_count, eligible_quantity,
    selected_order_count, selected_item_count, selected_quantity,
    excluded_order_count, excluded_item_count, excluded_quantity,
    eligible_order_ids, selected_order_ids, excluded_order_ids,
    confirmation_fingerprint, decided_by, decided_at, details, updated_at
  ) values (
    p_cutoff_id,
    p_policy,
    (v_summary->>'boundary_at')::timestamptz,
    v_cutoff.warehouse_organization_id,
    v_cutoff.company_id,
    v_cutoff.product_category_id,
    (v_summary->>'eligible_order_count')::integer,
    (v_summary->>'eligible_item_count')::integer,
    (v_summary->>'eligible_quantity')::integer,
    (v_summary->>'selected_order_count')::integer,
    (v_summary->>'selected_item_count')::integer,
    (v_summary->>'selected_quantity')::integer,
    (v_summary->>'excluded_order_count')::integer,
    (v_summary->>'excluded_item_count')::integer,
    (v_summary->>'excluded_quantity')::integer,
    coalesce((
      select array_agg(value::uuid order by value)
      from jsonb_array_elements_text(v_summary->'eligible_order_ids') value
    ), '{}'),
    coalesce((
      select array_agg(value::uuid order by value)
      from jsonb_array_elements_text(v_summary->'selected_order_ids') value
    ), '{}'),
    coalesce((
      select array_agg(value::uuid order by value)
      from jsonb_array_elements_text(v_summary->'excluded_order_ids') value
    ), '{}'),
    v_summary->>'confirmation_fingerprint',
    v_user,
    now(),
    jsonb_build_object(
      'notice', v_summary->>'notice',
      'orders_cancelled', false,
      'historical_movements_reversed', false,
      'qr_impact', 'none'
    ),
    now()
  )
  on conflict (cutoff_id) do update set
    policy = excluded.policy,
    boundary_at = excluded.boundary_at,
    eligible_order_count = excluded.eligible_order_count,
    eligible_item_count = excluded.eligible_item_count,
    eligible_quantity = excluded.eligible_quantity,
    selected_order_count = excluded.selected_order_count,
    selected_item_count = excluded.selected_item_count,
    selected_quantity = excluded.selected_quantity,
    excluded_order_count = excluded.excluded_order_count,
    excluded_item_count = excluded.excluded_item_count,
    excluded_quantity = excluded.excluded_quantity,
    eligible_order_ids = excluded.eligible_order_ids,
    selected_order_ids = excluded.selected_order_ids,
    excluded_order_ids = excluded.excluded_order_ids,
    confirmation_fingerprint = excluded.confirmation_fingerprint,
    decided_by = excluded.decided_by,
    decided_at = excluded.decided_at,
    details = excluded.details,
    updated_at = now();

  update public.stock_count_verification_requests vr
  set status = 'invalidated',
      invalidated_at = now(),
      request_metadata = coalesce(request_metadata, '{}'::jsonb)
        || jsonb_build_object('invalidated_reason', 'inventory_cutoff_d2h_policy_changed')
  where vr.session_id = v_cutoff.stock_count_session_id
    and vr.status in ('pending_delivery', 'active');

  insert into public.inventory_cutoff_audit_events(
    cutoff_id, event_type, actor_id, details
  ) values (
    p_cutoff_id,
    'd2h_policy_recorded',
    v_user,
    jsonb_build_object(
      'policy', p_policy,
      'boundary_at', v_summary->>'boundary_at',
      'eligible_order_count', v_summary->'eligible_order_count',
      'selected_order_count', v_summary->'selected_order_count',
      'excluded_order_count', v_summary->'excluded_order_count',
      'orders_cancelled', false,
      'historical_movements_reversed', false,
      'qr_impact', 'none',
      'cutoff_status_preserved', v_cutoff.status
    )
  );

  v_result := v_summary || jsonb_build_object(
    'applied', true,
    'idempotent_replay', false,
    'cutoff_cancelled', false
  );

  insert into public.inventory_cutoff_d2h_policy_requests(
    cutoff_id, idempotency_key, policy, scope_fingerprint,
    requested_order_ids, result, created_by
  ) values (
    p_cutoff_id, p_idempotency_key, p_policy, p_expected_fingerprint,
    v_selected, v_result, v_user
  );

  return v_result;
end;
$$;

revoke all on function public.apply_inventory_cutoff_d2h_policy(
  uuid, text, uuid[], text, uuid
) from public, anon;

grant execute on function public.apply_inventory_cutoff_d2h_policy(
  uuid, text, uuid[], text, uuid
) to authenticated;

-- ---- source (verbatim): supabase/migrations/20260801090000_inventory_cutoff_h2m_policy.sql

create or replace function public.inventory_cutoff_h2m_scoped_orders(p_cutoff_id uuid)
returns table (
  order_id uuid,
  order_item_id uuid,
  order_number text,
  status text,
  manufacturer text,
  warehouse text,
  variant_id uuid,
  variant_name text,
  ordered_quantity integer,
  received_before_boundary integer,
  remaining_incoming_quantity integer,
  order_created_at timestamptz,
  product_category_id uuid,
  decision text,
  incoming_eligible boolean,
  incoming_reason text,
  stock_config_id uuid
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_cutoff public.inventory_opening_cutoffs%rowtype;
  v_boundary timestamptz;
begin
  select * into v_cutoff from public.inventory_opening_cutoffs where id = p_cutoff_id;
  if not found then
    raise exception 'inventory_cutoff_not_found';
  end if;
  if v_cutoff.product_category_id is null then
    raise exception 'stock_count_active_product_category_required';
  end if;

  v_boundary := coalesce(v_cutoff.posted_at, v_cutoff.proposed_cutoff_at);

  return query
  with receipts as (
    select
      receipt_item.order_id,
      receipt_item.variant_id,
      sum(receipt_item.received_now)::integer as received_qty,
      coalesce(sum(receipt_item.received_now) filter (
        where receipt.received_at < v_boundary
      ), 0)::integer as received_before_boundary
    from public.warehouse_receipt_items receipt_item
    join public.warehouse_receipts receipt on receipt.id = receipt_item.receipt_id
    group by receipt_item.order_id, receipt_item.variant_id
  ), base as (
    select
      o.id as order_id,
      oi.id as order_item_id,
      coalesce(o.display_doc_no, o.order_no) as order_number,
      o.status::text as status,
      mfg.org_name as manufacturer,
      wh.org_name as warehouse,
      oi.variant_id,
      pv.variant_name,
      oi.qty::integer as ordered_quantity,
      coalesce(r.received_before_boundary, 0)::integer as received_before_boundary,
      greatest(oi.qty - coalesce(r.received_qty, 0), 0)::integer as remaining_incoming_quantity,
      o.created_at as order_created_at,
      p.category_id as product_category_id,
      d.decision,
      resolution.eligible as incoming_eligible,
      resolution.reason_code as incoming_reason,
      resolution.stock_config_id as stock_config_id
    from public.orders o
    join public.order_items oi on oi.order_id = o.id
    join public.product_variants pv on pv.id = oi.variant_id
    join public.products p on p.id = pv.product_id
    join public.organizations mfg on mfg.id = o.seller_org_id
    left join public.organizations wh
      on wh.id = public.resolve_order_destination_warehouse(o.buyer_org_id)
    left join receipts r
      on r.order_id = o.id and r.variant_id = oi.variant_id
    left join public.inventory_cutoff_decisions d
      on d.cutoff_id = v_cutoff.id
     and d.transaction_kind = 'manufacturer'
     and d.order_item_id = oi.id
    left join lateral public.resolve_inventory_cutoff_h2m_incoming(
      v_cutoff.id, array[oi.id]
    ) resolution on true
    where o.order_type = 'H2M'
      and o.status in ('approved', 'closed')
      and public.resolve_order_destination_warehouse(o.buyer_org_id) = v_cutoff.warehouse_organization_id
      and p.category_id = v_cutoff.product_category_id
      and greatest(oi.qty - coalesce(r.received_qty, 0), 0) > 0
  )
  select * from base
  order by order_created_at, order_id, order_item_id;
end;
$$;

revoke all on function public.inventory_cutoff_h2m_scoped_orders(uuid)
  from public, anon;

grant execute on function public.inventory_cutoff_h2m_scoped_orders(uuid)
  to authenticated, service_role;

-- ---- source (verbatim): supabase/migrations/20260801090000_inventory_cutoff_h2m_policy.sql

create or replace function public.inventory_cutoff_h2m_policy_preflight(
  p_cutoff_id uuid,
  p_policy text,
  p_selected_order_ids uuid[] default '{}'
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_cutoff public.inventory_opening_cutoffs%rowtype;
  v_category_name text;
  v_boundary timestamptz;
  v_result jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and (auth.uid() is null or not public.inventory_cutoff_is_hq_admin()) then
    raise exception 'permission_denied';
  end if;
  if p_policy not in ('exclude_all', 'review_select') then
    raise exception 'inventory_cutoff_h2m_policy_invalid';
  end if;

  select * into v_cutoff
  from public.inventory_opening_cutoffs
  where id = p_cutoff_id and status = 'counting';
  if not found then
    raise exception 'inventory_cutoff_not_active';
  end if;

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

  v_boundary := coalesce(v_cutoff.posted_at, v_cutoff.proposed_cutoff_at);

  with scoped as (
    select * from public.inventory_cutoff_h2m_scoped_orders(p_cutoff_id)
  ), orders as (
    select
      order_id,
      min(order_number) as order_number,
      min(status) as status,
      min(manufacturer) as manufacturer,
      count(*)::integer as item_count,
      sum(ordered_quantity)::integer as ordered_quantity,
      sum(received_before_boundary)::integer as received_before_boundary,
      sum(remaining_incoming_quantity)::integer as outstanding_quantity,
      bool_and(coalesce(incoming_eligible, false)) as incoming_eligible,
      (array_agg(incoming_reason) filter (
        where not coalesce(incoming_eligible, false)
      ))[1] as blocked_reason
    from scoped
    group by order_id
  ), classified as (
    select
      orders.*,
      case
        when p_policy = 'exclude_all' then 'exclude'
        when orders.order_id = any(coalesce(p_selected_order_ids, '{}')) then
          case
            when orders.incoming_eligible then 'select'
            else 'blocked'
          end
        else 'exclude'
      end as treatment
    from orders
  ), aggregates as (
    select
      count(*)::integer as eligible_order_count,
      coalesce(sum(item_count), 0)::integer as eligible_item_count,
      coalesce(sum(ordered_quantity), 0)::integer as eligible_ordered_quantity,
      coalesce(sum(received_before_boundary), 0)::integer as eligible_received_before_boundary,
      coalesce(sum(outstanding_quantity), 0)::integer as eligible_outstanding_quantity,
      count(*) filter (where treatment = 'select')::integer as selected_order_count,
      coalesce(sum(item_count) filter (where treatment = 'select'), 0)::integer as selected_item_count,
      coalesce(sum(ordered_quantity) filter (where treatment = 'select'), 0)::integer as selected_ordered_quantity,
      coalesce(sum(received_before_boundary) filter (where treatment = 'select'), 0)::integer as selected_received_before_boundary,
      coalesce(sum(outstanding_quantity) filter (where treatment = 'select'), 0)::integer as selected_outstanding_quantity,
      count(*) filter (where treatment = 'exclude')::integer as excluded_order_count,
      coalesce(sum(item_count) filter (where treatment = 'exclude'), 0)::integer as excluded_item_count,
      coalesce(sum(ordered_quantity) filter (where treatment = 'exclude'), 0)::integer as excluded_ordered_quantity,
      coalesce(sum(received_before_boundary) filter (where treatment = 'exclude'), 0)::integer as excluded_received_before_boundary,
      coalesce(sum(outstanding_quantity) filter (where treatment = 'exclude'), 0)::integer as excluded_outstanding_quantity,
      count(*) filter (where treatment = 'blocked')::integer as blocked_order_count,
      coalesce(array_agg(order_id order by order_id), '{}') as eligible_order_ids,
      coalesce(array_agg(order_id order by order_id) filter (where treatment = 'select'), '{}') as selected_order_ids,
      coalesce(array_agg(order_id order by order_id) filter (where treatment = 'exclude'), '{}') as excluded_order_ids,
      coalesce(array_agg(order_id order by order_id) filter (where treatment = 'blocked'), '{}') as blocked_order_ids,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'order_id', order_id,
            'order_number', order_number,
            'status', status,
            'manufacturer', manufacturer,
            'item_count', item_count,
            'ordered_quantity', ordered_quantity,
            'received_before_boundary', received_before_boundary,
            'outstanding_quantity', outstanding_quantity,
            'treatment', treatment,
            'blocked_reason', blocked_reason
          )
          order by order_number, order_id
        ),
        '[]'::jsonb
      ) as order_summaries,
      md5(concat_ws(
        '|',
        v_cutoff.id::text,
        v_cutoff.product_category_id::text,
        p_policy,
        v_boundary::text,
        coalesce(
          string_agg(
            concat_ws(':', order_id::text, treatment, status, item_count::text, outstanding_quantity::text),
            ',' order by order_id
          ),
          ''
        )
      )) as confirmation_fingerprint
    from classified
  )
  select jsonb_build_object(
    'policy', p_policy,
    'cutoff_id', v_cutoff.id,
    'boundary_at', v_boundary,
    'confirmation_fingerprint', aggregates.confirmation_fingerprint,
    'warehouse_organization_id', v_cutoff.warehouse_organization_id,
    'company_id', v_cutoff.company_id,
    'product_category_id', v_cutoff.product_category_id,
    'product_category_name', v_category_name,
    'eligible_order_count', aggregates.eligible_order_count,
    'eligible_item_count', aggregates.eligible_item_count,
    'eligible_ordered_quantity', aggregates.eligible_ordered_quantity,
    'eligible_received_before_boundary', aggregates.eligible_received_before_boundary,
    'eligible_outstanding_quantity', aggregates.eligible_outstanding_quantity,
    -- Compatibility aliases used by shared parsers / UI quantity previews
    'eligible_quantity', aggregates.eligible_outstanding_quantity,
    'selected_order_count', aggregates.selected_order_count,
    'selected_item_count', aggregates.selected_item_count,
    'selected_ordered_quantity', aggregates.selected_ordered_quantity,
    'selected_received_before_boundary', aggregates.selected_received_before_boundary,
    'selected_outstanding_quantity', aggregates.selected_outstanding_quantity,
    'selected_quantity', aggregates.selected_outstanding_quantity,
    'excluded_order_count', aggregates.excluded_order_count,
    'excluded_item_count', aggregates.excluded_item_count,
    'excluded_ordered_quantity', aggregates.excluded_ordered_quantity,
    'excluded_received_before_boundary', aggregates.excluded_received_before_boundary,
    'excluded_outstanding_quantity', aggregates.excluded_outstanding_quantity,
    'excluded_quantity', aggregates.excluded_outstanding_quantity,
    'blocked_order_count', aggregates.blocked_order_count,
    'eligible_order_ids', to_jsonb(aggregates.eligible_order_ids),
    'selected_order_ids', to_jsonb(aggregates.selected_order_ids),
    'excluded_order_ids', to_jsonb(aggregates.excluded_order_ids),
    'blocked_order_ids', to_jsonb(aggregates.blocked_order_ids),
    'order_summaries', aggregates.order_summaries,
    'orders_cancelled', false,
    'orders_deleted', false,
    'inventory_added', false,
    'historical_movements_reversed', false,
    'qr_impact', 'none',
    'notice', case
      when p_policy = 'exclude_all' then
        format(
          '%s historical H2M orders will be excluded from expected incoming. Opening Balance posting adds zero H2M quantity. Order history remains unchanged.',
          aggregates.eligible_order_count
        )
      else
        format(
          '%s order(s) selected as expected incoming after cut-off (%s outstanding units informational only); %s remain historical. Opening Balance posting adds zero H2M quantity.',
          aggregates.selected_order_count,
          aggregates.selected_outstanding_quantity,
          aggregates.excluded_order_count
        )
    end
  ) into v_result
  from aggregates;

  return v_result;
end;
$$;

revoke all on function public.inventory_cutoff_h2m_policy_preflight(uuid, text, uuid[])
  from public, anon;

grant execute on function public.inventory_cutoff_h2m_policy_preflight(uuid, text, uuid[])
  to authenticated, service_role;

-- ---- source (verbatim): supabase/migrations/20260801090000_inventory_cutoff_h2m_policy.sql

create or replace function public.apply_inventory_cutoff_h2m_policy(
  p_cutoff_id uuid,
  p_policy text,
  p_selected_order_ids uuid[],
  p_expected_fingerprint text,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_summary jsonb;
  v_existing public.inventory_cutoff_h2m_policy_requests%rowtype;
  v_cutoff public.inventory_opening_cutoffs%rowtype;
  v_item record;
  v_selected uuid[] := coalesce(p_selected_order_ids, '{}');
  v_result jsonb;
  v_decision text;
begin
  if v_user is null or not public.inventory_cutoff_is_hq_admin() then
    raise exception 'permission_denied';
  end if;
  if p_idempotency_key is null then
    raise exception 'inventory_cutoff_h2m_policy_idempotency_key_required';
  end if;
  if p_policy not in ('exclude_all', 'review_select') then
    raise exception 'inventory_cutoff_h2m_policy_invalid';
  end if;

  -- Advisory lock is cutoff-scoped. Never invokes the Opening Balance cancel RPC.
  perform pg_advisory_xact_lock(
    hashtextextended('inventory-cutoff-h2m-policy:' || p_cutoff_id::text, 0)
  );

  select * into v_cutoff
  from public.inventory_opening_cutoffs
  where id = p_cutoff_id
  for update;
  if not found or v_cutoff.status <> 'counting' then
    raise exception 'inventory_cutoff_not_active';
  end if;

  select * into v_existing
  from public.inventory_cutoff_h2m_policy_requests
  where cutoff_id = p_cutoff_id
    and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.policy <> p_policy
       or v_existing.requested_order_ids is distinct from v_selected
       or v_existing.scope_fingerprint <> p_expected_fingerprint then
      raise exception 'inventory_cutoff_h2m_policy_idempotency_conflict';
    end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;

  v_summary := public.inventory_cutoff_h2m_policy_preflight(
    p_cutoff_id, p_policy, v_selected
  );
  if coalesce(v_summary->>'confirmation_fingerprint', '') <>
     coalesce(p_expected_fingerprint, '') then
    raise exception 'inventory_cutoff_h2m_policy_scope_changed';
  end if;
  if coalesce((v_summary->>'blocked_order_count')::integer, 0) > 0
     and p_policy = 'review_select' then
    raise exception 'inventory_cutoff_h2m_policy_selection_blocked';
  end if;

  -- Replace manufacturer decisions for the scoped universe. Stale row-level
  -- carry_forward_incoming decisions are superseded by the saved policy.
  delete from public.inventory_cutoff_decisions d
  using public.inventory_cutoff_h2m_scoped_orders(p_cutoff_id) scoped
  where d.cutoff_id = p_cutoff_id
    and d.transaction_kind = 'manufacturer'
    and d.order_item_id = scoped.order_item_id;

  for v_item in
    select *
    from public.inventory_cutoff_h2m_scoped_orders(p_cutoff_id)
    order by order_id, order_item_id
  loop
    if p_policy = 'exclude_all' then
      v_decision := 'history_only';
    elsif exists (
      select 1
      from jsonb_array_elements_text(v_summary->'selected_order_ids') selected(value)
      where selected.value::uuid = v_item.order_id
    ) then
      v_decision := 'carry_forward_incoming';
    else
      v_decision := 'history_only';
    end if;

    perform public.set_inventory_cutoff_decision(
      p_cutoff_id,
      v_item.order_item_id,
      v_decision
    );
  end loop;

  insert into public.inventory_cutoff_h2m_policies (
    cutoff_id, policy, boundary_at,
    warehouse_organization_id, company_id, product_category_id,
    eligible_order_count, eligible_item_count,
    eligible_ordered_quantity, eligible_received_before_boundary, eligible_outstanding_quantity,
    selected_order_count, selected_item_count,
    selected_ordered_quantity, selected_received_before_boundary, selected_outstanding_quantity,
    excluded_order_count, excluded_item_count,
    excluded_ordered_quantity, excluded_received_before_boundary, excluded_outstanding_quantity,
    eligible_order_ids, selected_order_ids, excluded_order_ids,
    confirmation_fingerprint, decided_by, decided_at, details, updated_at
  ) values (
    p_cutoff_id,
    p_policy,
    (v_summary->>'boundary_at')::timestamptz,
    v_cutoff.warehouse_organization_id,
    v_cutoff.company_id,
    v_cutoff.product_category_id,
    (v_summary->>'eligible_order_count')::integer,
    (v_summary->>'eligible_item_count')::integer,
    (v_summary->>'eligible_ordered_quantity')::integer,
    (v_summary->>'eligible_received_before_boundary')::integer,
    (v_summary->>'eligible_outstanding_quantity')::integer,
    (v_summary->>'selected_order_count')::integer,
    (v_summary->>'selected_item_count')::integer,
    (v_summary->>'selected_ordered_quantity')::integer,
    (v_summary->>'selected_received_before_boundary')::integer,
    (v_summary->>'selected_outstanding_quantity')::integer,
    (v_summary->>'excluded_order_count')::integer,
    (v_summary->>'excluded_item_count')::integer,
    (v_summary->>'excluded_ordered_quantity')::integer,
    (v_summary->>'excluded_received_before_boundary')::integer,
    (v_summary->>'excluded_outstanding_quantity')::integer,
    coalesce((
      select array_agg(value::uuid order by value)
      from jsonb_array_elements_text(v_summary->'eligible_order_ids') value
    ), '{}'),
    coalesce((
      select array_agg(value::uuid order by value)
      from jsonb_array_elements_text(v_summary->'selected_order_ids') value
    ), '{}'),
    coalesce((
      select array_agg(value::uuid order by value)
      from jsonb_array_elements_text(v_summary->'excluded_order_ids') value
    ), '{}'),
    v_summary->>'confirmation_fingerprint',
    v_user,
    now(),
    jsonb_build_object(
      'notice', v_summary->>'notice',
      'orders_cancelled', false,
      'orders_deleted', false,
      'inventory_added', false,
      'historical_movements_reversed', false,
      'qr_impact', 'none'
    ),
    now()
  )
  on conflict (cutoff_id) do update set
    policy = excluded.policy,
    boundary_at = excluded.boundary_at,
    eligible_order_count = excluded.eligible_order_count,
    eligible_item_count = excluded.eligible_item_count,
    eligible_ordered_quantity = excluded.eligible_ordered_quantity,
    eligible_received_before_boundary = excluded.eligible_received_before_boundary,
    eligible_outstanding_quantity = excluded.eligible_outstanding_quantity,
    selected_order_count = excluded.selected_order_count,
    selected_item_count = excluded.selected_item_count,
    selected_ordered_quantity = excluded.selected_ordered_quantity,
    selected_received_before_boundary = excluded.selected_received_before_boundary,
    selected_outstanding_quantity = excluded.selected_outstanding_quantity,
    excluded_order_count = excluded.excluded_order_count,
    excluded_item_count = excluded.excluded_item_count,
    excluded_ordered_quantity = excluded.excluded_ordered_quantity,
    excluded_received_before_boundary = excluded.excluded_received_before_boundary,
    excluded_outstanding_quantity = excluded.excluded_outstanding_quantity,
    eligible_order_ids = excluded.eligible_order_ids,
    selected_order_ids = excluded.selected_order_ids,
    excluded_order_ids = excluded.excluded_order_ids,
    confirmation_fingerprint = excluded.confirmation_fingerprint,
    decided_by = excluded.decided_by,
    decided_at = excluded.decided_at,
    details = excluded.details,
    updated_at = now();

  update public.stock_count_verification_requests vr
  set status = 'invalidated',
      invalidated_at = now(),
      request_metadata = coalesce(request_metadata, '{}'::jsonb)
        || jsonb_build_object('invalidated_reason', 'inventory_cutoff_h2m_policy_changed')
  where vr.session_id = v_cutoff.stock_count_session_id
    and vr.status in ('pending_delivery', 'active');

  insert into public.inventory_cutoff_audit_events(
    cutoff_id, event_type, actor_id, details
  ) values (
    p_cutoff_id,
    'h2m_policy_recorded',
    v_user,
    jsonb_build_object(
      'policy', p_policy,
      'boundary_at', v_summary->>'boundary_at',
      'eligible_order_count', v_summary->'eligible_order_count',
      'selected_order_count', v_summary->'selected_order_count',
      'excluded_order_count', v_summary->'excluded_order_count',
      'selected_outstanding_quantity', v_summary->'selected_outstanding_quantity',
      'orders_cancelled', false,
      'orders_deleted', false,
      'inventory_added', false,
      'historical_movements_reversed', false,
      'qr_impact', 'none',
      'cutoff_status_preserved', v_cutoff.status
    )
  );

  v_result := v_summary || jsonb_build_object(
    'applied', true,
    'idempotent_replay', false,
    'cutoff_cancelled', false
  );

  insert into public.inventory_cutoff_h2m_policy_requests(
    cutoff_id, idempotency_key, policy, scope_fingerprint,
    requested_order_ids, result, created_by
  ) values (
    p_cutoff_id, p_idempotency_key, p_policy, p_expected_fingerprint,
    v_selected, v_result, v_user
  );

  return v_result;
end;
$$;

revoke all on function public.apply_inventory_cutoff_h2m_policy(
  uuid, text, uuid[], text, uuid
) from public, anon;

grant execute on function public.apply_inventory_cutoff_h2m_policy(
  uuid, text, uuid[], text, uuid
) to authenticated;

-- ---- source (verbatim): supabase/migrations/20260801090000_inventory_cutoff_h2m_policy.sql

create or replace function public.inventory_cutoff_h2m_excluded_blocks_receipt(
  p_order_id uuid
) returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  return exists (
    select 1
    from public.inventory_cutoff_decisions d
    join public.inventory_opening_cutoffs c on c.id = d.cutoff_id
    join public.inventory_cutoff_h2m_policies p on p.cutoff_id = c.id
    where d.order_id = p_order_id
      and d.transaction_kind = 'manufacturer'
      and d.decision = 'history_only'
      and c.status = 'posted'
  );
end;
$$;

revoke all on function public.inventory_cutoff_h2m_excluded_blocks_receipt(uuid)
  from public, anon;

grant execute on function public.inventory_cutoff_h2m_excluded_blocks_receipt(uuid)
  to authenticated, service_role;

comment on function public.inventory_cutoff_h2m_excluded_blocks_receipt(uuid) is
  'True when a posted Opening Balance marked the H2M order history_only / excluded. Callers must not revive receiving through the carried-forward incoming path; use an explicitly supported manual receiving process instead.';

-- ---- source (verbatim): supabase/migrations/20260801090000_inventory_cutoff_h2m_policy.sql

create or replace function public.assert_h2m_receipt_allowed_after_cutoff(
  p_order_id uuid
) returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if public.inventory_cutoff_h2m_excluded_blocks_receipt(p_order_id) then
    raise exception 'inventory_cutoff_h2m_excluded_receipt_blocked'
      using hint = 'This H2M order was excluded from expected incoming during Opening Balance. Do not receive it through the carried-forward path; use an explicitly supported manual receiving process for genuine post-cut-off arrivals.';
  end if;
end;
$$;

revoke all on function public.assert_h2m_receipt_allowed_after_cutoff(uuid)
  from public, anon;

grant execute on function public.assert_h2m_receipt_allowed_after_cutoff(uuid)
  to authenticated, service_role;

-- ---- source (verbatim): supabase/migrations/20260801140000_inventory_cutoff_transactions_policy.sql

create or replace function public.inventory_cutoff_transactions_scoped(p_cutoff_id uuid)
returns table (
  transaction_type text,
  transaction_id uuid,
  reference_no text,
  status text,
  occurred_at timestamptz,
  document_quantity integer,
  line_count integer,
  latest_stage text,
  remaining_action text,
  expected_event text,
  eligibility text,
  blocker_reason text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_cutoff public.inventory_opening_cutoffs%rowtype;
  v_category uuid;
  v_warehouse uuid;
  v_boundary timestamptz;
begin
  select * into v_cutoff from public.inventory_opening_cutoffs where id = p_cutoff_id;
  if not found then
    raise exception 'inventory_cutoff_not_found';
  end if;
  if v_cutoff.product_category_id is null then
    raise exception 'stock_count_active_product_category_required';
  end if;
  v_category := v_cutoff.product_category_id;
  v_warehouse := v_cutoff.warehouse_organization_id;
  v_boundary := coalesce(v_cutoff.posted_at, v_cutoff.proposed_cutoff_at);

  return query
  -- ---- Stock Adjustments -------------------------------------------------
  with adjustment_scope as (
    select
      a.id,
      a.status,
      a.created_at,
      coalesce((
        select sum(abs(i.adjustment_quantity))::integer
        from public.stock_adjustment_items i
        join public.product_variants pv on pv.id = i.variant_id
        join public.products p on p.id = pv.product_id
        where i.adjustment_id = a.id
          and coalesce(i.adjustment_quantity, 0) <> 0
          and p.category_id = v_category
      ), 0) as impact_quantity,
      coalesce((
        select count(*)::integer
        from public.stock_adjustment_items i
        join public.product_variants pv on pv.id = i.variant_id
        join public.products p on p.id = pv.product_id
        where i.adjustment_id = a.id
          and coalesce(i.adjustment_quantity, 0) <> 0
          and p.category_id = v_category
      ), 0) as line_count,
      exists (
        select 1 from public.stock_movements sm
        where sm.reference_id = a.id
          and coalesce(sm.reference_type, '') in ('adjustment', 'stock_adjustment')
      ) as has_movement
    from public.stock_adjustments a
    left join public.stock_adjustment_reasons r on r.id = a.reason_id
    where a.organization_id = v_warehouse
      and a.created_at < v_boundary
      and coalesce(a.status, 'completed') not in
        ('completed', 'cancelled', 'resolved', 'rejected')
      and coalesce(r.reason_code, '') not in
        ('quality_issue', 'return_to_supplier', 'damaged_goods')
  )
  select
    'stock_adjustment'::text,
    s.id,
    null::text,
    s.status,
    s.created_at,
    s.impact_quantity,
    s.line_count,
    'Draft / pending adjustment'::text,
    'Approve or cancel in the Stock Adjustment workflow'::text,
    'Inventory changes only when the adjustment is approved/posted'::text,
    case when s.has_movement then 'requires_resolution' else 'eligible' end,
    case when s.has_movement then
      'Adjustment already posted stock movements but is not completed; resolve it in the Stock Adjustment workflow to avoid replay.'
      else null end
  from adjustment_scope s
  where s.line_count > 0

  union all
  -- ---- Returns -----------------------------------------------------------
  select
    'return'::text,
    r.id,
    r.return_no,
    r.status,
    r.created_at,
    coalesce((
      select sum(ri.quantity)::integer
      from public.return_case_items ri
      join public.product_variants pv on pv.id = ri.variant_id
      join public.products p on p.id = pv.product_id
      where ri.return_case_id = r.id and p.category_id = v_category
    ), 0),
    coalesce((
      select count(*)::integer
      from public.return_case_items ri
      join public.product_variants pv on pv.id = ri.variant_id
      join public.products p on p.id = pv.product_id
      where ri.return_case_id = r.id and p.category_id = v_category
    ), 0),
    case r.status
      when 'return_submitted' then 'Submitted'
      when 'return_received' then 'Received at warehouse'
      when 'return_processing' then 'Processing'
      else r.status end,
    'Continue the Return workflow to its disposition/stock-affecting stage'::text,
    'Inventory changes only at the return''s existing stock-affecting stage (its authoritative direction is preserved)'::text,
    case when exists (
      select 1 from public.stock_movements sm
      where sm.reference_id = r.id and coalesce(sm.reference_type, '') = 'return'
    ) then 'requires_resolution' else 'eligible' end,
    case when exists (
      select 1 from public.stock_movements sm
      where sm.reference_id = r.id and coalesce(sm.reference_type, '') = 'return'
    ) then
      'Return already posted stock movements but is not completed; resolve it in the Return workflow to avoid replay.'
      else null end
  from public.return_cases r
  where r.return_warehouse_id = v_warehouse
    and r.created_at < v_boundary
    and r.status in ('return_submitted', 'return_received', 'return_processing')
    and exists (
      select 1 from public.return_case_items ri
      join public.product_variants pv on pv.id = ri.variant_id
      join public.products p on p.id = pv.product_id
      where ri.return_case_id = r.id and p.category_id = v_category
    )

  union all
  -- ---- Stock Transfers ---------------------------------------------------
  select
    'stock_transfer'::text,
    t.id,
    t.transfer_no,
    t.status,
    t.created_at,
    coalesce(t.total_items, 0),
    coalesce((
      select count(*)::integer
      from jsonb_array_elements(t.items) line
      join public.product_variants pv
        on pv.id = nullif(line->>'variant_id', '')::uuid
      join public.products p on p.id = pv.product_id
      where p.category_id = v_category
    ), 0),
    case
      when t.status = 'in_transit' then 'Dispatched (in transit)'
      when t.status = 'ready_to_dispatch' then 'Ready to dispatch'
      when t.status = 'pending_approval' then 'Pending approval'
      else 'Pending' end,
    case
      when t.status = 'in_transit'
        then 'Continue to receive at destination (source already deducted)'
      else 'Continue the transfer workflow to dispatch' end,
    case
      when t.status = 'in_transit'
        then 'Destination receipt only; the source is never deducted again'
      else 'Source is deducted only at legitimate dispatch' end,
    case
      -- Dispatched without in_transit status, or received without dispatch:
      -- inconsistent movement evidence -> genuine blocker.
      when t.status in ('pending', 'pending_approval', 'ready_to_dispatch')
           and exists (
             select 1 from public.stock_movements sm
             where sm.reference_id = t.id
               and coalesce(sm.reference_type, '') = 'transfer'
               and sm.movement_type = 'transfer_out'
           ) then 'requires_resolution'
      when exists (
             select 1 from public.stock_movements sm
             where sm.reference_id = t.id
               and coalesce(sm.reference_type, '') = 'transfer'
               and sm.movement_type = 'transfer_in'
           )
           and not exists (
             select 1 from public.stock_movements sm
             where sm.reference_id = t.id
               and coalesce(sm.reference_type, '') = 'transfer'
               and sm.movement_type = 'transfer_out'
           ) then 'requires_resolution'
      else 'eligible' end,
    case
      when t.status in ('pending', 'pending_approval', 'ready_to_dispatch')
           and exists (
             select 1 from public.stock_movements sm
             where sm.reference_id = t.id
               and coalesce(sm.reference_type, '') = 'transfer'
               and sm.movement_type = 'transfer_out'
           ) then
        'Transfer shows a dispatched (transfer_out) movement but its status is not in transit; resolve it in the Stock Transfer workflow.'
      when exists (
             select 1 from public.stock_movements sm
             where sm.reference_id = t.id
               and coalesce(sm.reference_type, '') = 'transfer'
               and sm.movement_type = 'transfer_in'
           )
           and not exists (
             select 1 from public.stock_movements sm
             where sm.reference_id = t.id
               and coalesce(sm.reference_type, '') = 'transfer'
               and sm.movement_type = 'transfer_out'
           ) then
        'Transfer shows a received (transfer_in) movement without a matching dispatch; resolve it in the Stock Transfer workflow.'
      else null end
  from public.stock_transfers t
  where (t.from_organization_id = v_warehouse or t.to_organization_id = v_warehouse)
    and t.created_at < v_boundary
    and t.status in ('pending', 'pending_approval', 'ready_to_dispatch', 'in_transit')
    and exists (
      select 1 from jsonb_array_elements(t.items) line
      join public.product_variants pv
        on pv.id = nullif(line->>'variant_id', '')::uuid
      join public.products p on p.id = pv.product_id
      where p.category_id = v_category
    );
end;
$$;

revoke all on function public.inventory_cutoff_transactions_scoped(uuid) from public, anon;

grant execute on function public.inventory_cutoff_transactions_scoped(uuid)
  to authenticated, service_role;

-- ---- source (verbatim): supabase/migrations/20260801140000_inventory_cutoff_transactions_policy.sql

create or replace function public.inventory_cutoff_transactions_policy_preflight(
  p_cutoff_id uuid,
  p_policy text,
  p_carried_refs jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_cutoff public.inventory_opening_cutoffs%rowtype;
  v_category_name text;
  v_boundary timestamptz;
  v_carried jsonb := coalesce(p_carried_refs, '[]'::jsonb);
  v_result jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and (auth.uid() is null or not public.inventory_cutoff_is_hq_admin()) then
    raise exception 'permission_denied';
  end if;
  if p_policy not in ('exclude_all', 'carry_forward_all', 'review_select') then
    raise exception 'inventory_cutoff_transactions_policy_invalid';
  end if;

  select * into v_cutoff
  from public.inventory_opening_cutoffs
  where id = p_cutoff_id and status = 'counting';
  if not found then
    raise exception 'inventory_cutoff_not_active';
  end if;

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

  v_boundary := coalesce(v_cutoff.posted_at, v_cutoff.proposed_cutoff_at);

  with scoped as (
    select * from public.inventory_cutoff_transactions_scoped(p_cutoff_id)
  ), carried_input as (
    select
      ref->>'type' as transaction_type,
      (ref->>'id')::uuid as transaction_id
    from jsonb_array_elements(v_carried) ref
    where ref ? 'type' and ref ? 'id'
  ), classified as (
    select
      scoped.*,
      case
        when scoped.eligibility = 'requires_resolution' then 'blocked'
        when p_policy = 'exclude_all' then 'exclude'
        when p_policy = 'carry_forward_all' then 'carry'
        when exists (
          select 1 from carried_input ci
          where ci.transaction_type = scoped.transaction_type
            and ci.transaction_id = scoped.transaction_id
        ) then 'carry'
        else 'exclude'
      end as treatment
    from scoped
  ), aggregates as (
    select
      count(*) filter (where eligibility = 'eligible')::integer as eligible_count,
      count(*) filter (where treatment = 'carry')::integer as carried_count,
      count(*) filter (where treatment = 'exclude')::integer as excluded_count,
      count(*) filter (where treatment = 'blocked')::integer as blocked_count,
      coalesce(array_agg(transaction_id) filter
        (where treatment = 'carry' and transaction_type = 'stock_adjustment'), '{}') as carried_adjustment_ids,
      coalesce(array_agg(transaction_id) filter
        (where treatment = 'carry' and transaction_type = 'return'), '{}') as carried_return_ids,
      coalesce(array_agg(transaction_id) filter
        (where treatment = 'carry' and transaction_type = 'stock_transfer'), '{}') as carried_transfer_ids,
      coalesce(array_agg(transaction_id) filter
        (where treatment = 'exclude' and transaction_type = 'stock_adjustment'), '{}') as excluded_adjustment_ids,
      coalesce(array_agg(transaction_id) filter
        (where treatment = 'exclude' and transaction_type = 'return'), '{}') as excluded_return_ids,
      coalesce(array_agg(transaction_id) filter
        (where treatment = 'exclude' and transaction_type = 'stock_transfer'), '{}') as excluded_transfer_ids,
      coalesce(jsonb_agg(
        jsonb_build_object('type', transaction_type, 'id', transaction_id)
        order by occurred_at desc nulls last, transaction_id
      ) filter (where treatment = 'carry'), '[]'::jsonb) as carried_refs,
      coalesce(jsonb_agg(
        jsonb_build_object('type', transaction_type, 'id', transaction_id)
        order by occurred_at desc nulls last, transaction_id
      ) filter (where treatment = 'exclude'), '[]'::jsonb) as excluded_refs,
      coalesce(jsonb_agg(
        jsonb_build_object('type', transaction_type, 'id', transaction_id)
        order by occurred_at desc nulls last, transaction_id
      ) filter (where eligibility = 'eligible'), '[]'::jsonb) as eligible_refs,
      coalesce(jsonb_agg(
        jsonb_build_object(
          'transaction_type', transaction_type,
          'transaction_id', transaction_id,
          'reference_no', reference_no,
          'status', status,
          'occurred_at', occurred_at,
          'document_quantity', document_quantity,
          'line_count', line_count,
          'latest_stage', latest_stage,
          'remaining_action', remaining_action,
          'expected_event', expected_event,
          'eligibility', eligibility,
          'blocker_reason', blocker_reason,
          'treatment', treatment
        )
        order by occurred_at desc nulls last, transaction_id
      ), '[]'::jsonb) as transaction_summaries,
      md5(concat_ws(
        '|',
        v_cutoff.id::text,
        v_cutoff.product_category_id::text,
        p_policy,
        v_boundary::text,
        coalesce(string_agg(
          concat_ws(':', transaction_type, transaction_id::text, treatment, status),
          ',' order by transaction_type, transaction_id
        ), '')
      )) as confirmation_fingerprint
    from classified
  )
  select jsonb_build_object(
    'policy', p_policy,
    'cutoff_id', v_cutoff.id,
    'boundary_at', v_boundary,
    'confirmation_fingerprint', aggregates.confirmation_fingerprint,
    'warehouse_organization_id', v_cutoff.warehouse_organization_id,
    'company_id', v_cutoff.company_id,
    'product_category_id', v_cutoff.product_category_id,
    'product_category_name', v_category_name,
    'eligible_count', aggregates.eligible_count,
    'carried_count', aggregates.carried_count,
    'excluded_count', aggregates.excluded_count,
    'blocked_count', aggregates.blocked_count,
    'carried_adjustment_ids', to_jsonb(aggregates.carried_adjustment_ids),
    'carried_return_ids', to_jsonb(aggregates.carried_return_ids),
    'carried_transfer_ids', to_jsonb(aggregates.carried_transfer_ids),
    'excluded_adjustment_ids', to_jsonb(aggregates.excluded_adjustment_ids),
    'excluded_return_ids', to_jsonb(aggregates.excluded_return_ids),
    'excluded_transfer_ids', to_jsonb(aggregates.excluded_transfer_ids),
    'carried_refs', aggregates.carried_refs,
    'excluded_refs', aggregates.excluded_refs,
    'eligible_refs', aggregates.eligible_refs,
    'transaction_summaries', aggregates.transaction_summaries,
    'inventory_impact', 0,
    'transactions_cancelled', false,
    'stock_movements_created', false,
    'historical_movements_reversed', false,
    'qr_impact', 'none',
    'notice', case
      when p_policy = 'exclude_all' then format(
        '%s eligible transactions will be historical excluded from the new inventory baseline. Their original records are preserved for audit and are not cancelled.',
        aggregates.eligible_count)
      when p_policy = 'carry_forward_all' then format(
        '%s eligible transactions will carry forward and continue from their existing lifecycle. No inventory is added or deducted while saving.',
        aggregates.eligible_count)
      else format(
        '%s transactions carried forward; %s remain historical excluded.',
        aggregates.carried_count, aggregates.excluded_count)
    end
  ) into v_result
  from aggregates;

  return v_result;
end;
$$;

revoke all on function
  public.inventory_cutoff_transactions_policy_preflight(uuid, text, jsonb)
  from public, anon;

grant execute on function
  public.inventory_cutoff_transactions_policy_preflight(uuid, text, jsonb)
  to authenticated, service_role;

-- ---- source (verbatim): supabase/migrations/20260801140000_inventory_cutoff_transactions_policy.sql

create or replace function public.apply_inventory_cutoff_transactions_policy(
  p_cutoff_id uuid,
  p_policy text,
  p_carried_refs jsonb,
  p_expected_fingerprint text,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_summary jsonb;
  v_existing public.inventory_cutoff_transactions_policy_requests%rowtype;
  v_cutoff public.inventory_opening_cutoffs%rowtype;
  v_carried jsonb := coalesce(p_carried_refs, '[]'::jsonb);
  v_result jsonb;
begin
  if v_user is null or not public.inventory_cutoff_is_hq_admin() then
    raise exception 'permission_denied';
  end if;
  if p_idempotency_key is null then
    raise exception 'inventory_cutoff_transactions_policy_idempotency_key_required';
  end if;
  if p_policy not in ('exclude_all', 'carry_forward_all', 'review_select') then
    raise exception 'inventory_cutoff_transactions_policy_invalid';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('inventory-cutoff-transactions-policy:' || p_cutoff_id::text, 0)
  );

  select * into v_cutoff
  from public.inventory_opening_cutoffs
  where id = p_cutoff_id
  for update;
  if not found or v_cutoff.status <> 'counting' then
    raise exception 'inventory_cutoff_not_active';
  end if;

  select * into v_existing
  from public.inventory_cutoff_transactions_policy_requests
  where cutoff_id = p_cutoff_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.policy <> p_policy
       or v_existing.requested_refs is distinct from v_carried
       or v_existing.scope_fingerprint <> p_expected_fingerprint then
      raise exception 'inventory_cutoff_transactions_policy_idempotency_conflict';
    end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;

  v_summary := public.inventory_cutoff_transactions_policy_preflight(
    p_cutoff_id, p_policy, v_carried
  );
  if coalesce(v_summary->>'confirmation_fingerprint', '') <>
     coalesce(p_expected_fingerprint, '') then
    raise exception 'inventory_cutoff_transactions_policy_scope_changed';
  end if;

  -- Option 1 supersedes any stale selection; a review selection that resolves to
  -- zero carried is valid. A carried ref that resolves to a genuine blocker can
  -- never be effective because preflight assigns it treatment 'blocked'.

  insert into public.inventory_cutoff_transactions_policies (
    cutoff_id, policy, boundary_at,
    warehouse_organization_id, company_id, product_category_id,
    eligible_count, carried_count, excluded_count, blocked_count,
    carried_adjustment_ids, carried_return_ids, carried_transfer_ids,
    excluded_adjustment_ids, excluded_return_ids, excluded_transfer_ids,
    carried_refs, excluded_refs, eligible_refs,
    confirmation_fingerprint, decided_by, decided_at, details, updated_at
  ) values (
    p_cutoff_id,
    p_policy,
    (v_summary->>'boundary_at')::timestamptz,
    v_cutoff.warehouse_organization_id,
    v_cutoff.company_id,
    v_cutoff.product_category_id,
    (v_summary->>'eligible_count')::integer,
    (v_summary->>'carried_count')::integer,
    (v_summary->>'excluded_count')::integer,
    (v_summary->>'blocked_count')::integer,
    coalesce((select array_agg(value::uuid order by value)
      from jsonb_array_elements_text(v_summary->'carried_adjustment_ids') value), '{}'),
    coalesce((select array_agg(value::uuid order by value)
      from jsonb_array_elements_text(v_summary->'carried_return_ids') value), '{}'),
    coalesce((select array_agg(value::uuid order by value)
      from jsonb_array_elements_text(v_summary->'carried_transfer_ids') value), '{}'),
    coalesce((select array_agg(value::uuid order by value)
      from jsonb_array_elements_text(v_summary->'excluded_adjustment_ids') value), '{}'),
    coalesce((select array_agg(value::uuid order by value)
      from jsonb_array_elements_text(v_summary->'excluded_return_ids') value), '{}'),
    coalesce((select array_agg(value::uuid order by value)
      from jsonb_array_elements_text(v_summary->'excluded_transfer_ids') value), '{}'),
    v_summary->'carried_refs',
    v_summary->'excluded_refs',
    v_summary->'eligible_refs',
    v_summary->>'confirmation_fingerprint',
    v_user,
    now(),
    jsonb_build_object(
      'notice', v_summary->>'notice',
      'inventory_impact', 0,
      'transactions_cancelled', false,
      'stock_movements_created', false,
      'qr_impact', 'none'
    ),
    now()
  )
  on conflict (cutoff_id) do update set
    policy = excluded.policy,
    boundary_at = excluded.boundary_at,
    eligible_count = excluded.eligible_count,
    carried_count = excluded.carried_count,
    excluded_count = excluded.excluded_count,
    blocked_count = excluded.blocked_count,
    carried_adjustment_ids = excluded.carried_adjustment_ids,
    carried_return_ids = excluded.carried_return_ids,
    carried_transfer_ids = excluded.carried_transfer_ids,
    excluded_adjustment_ids = excluded.excluded_adjustment_ids,
    excluded_return_ids = excluded.excluded_return_ids,
    excluded_transfer_ids = excluded.excluded_transfer_ids,
    carried_refs = excluded.carried_refs,
    excluded_refs = excluded.excluded_refs,
    eligible_refs = excluded.eligible_refs,
    confirmation_fingerprint = excluded.confirmation_fingerprint,
    decided_by = excluded.decided_by,
    decided_at = excluded.decided_at,
    details = excluded.details,
    updated_at = now();

  -- Changing this policy invalidates any pending/active OTP verification, exactly
  -- like the D2H/H2M policy save. It never requests OTP or protects the draft.
  update public.stock_count_verification_requests vr
  set status = 'invalidated',
      invalidated_at = now(),
      request_metadata = coalesce(request_metadata, '{}'::jsonb)
        || jsonb_build_object('invalidated_reason', 'inventory_cutoff_transactions_policy_changed')
  where vr.session_id = v_cutoff.stock_count_session_id
    and vr.status in ('pending_delivery', 'active');

  insert into public.inventory_cutoff_audit_events(cutoff_id, event_type, actor_id, details)
  values (
    p_cutoff_id, 'transactions_policy_recorded', v_user,
    jsonb_build_object(
      'policy', p_policy,
      'boundary_at', v_summary->>'boundary_at',
      'eligible_count', v_summary->'eligible_count',
      'carried_count', v_summary->'carried_count',
      'excluded_count', v_summary->'excluded_count',
      'blocked_count', v_summary->'blocked_count',
      'inventory_impact', 0,
      'transactions_cancelled', false,
      'stock_movements_created', false,
      'qr_impact', 'none',
      'cutoff_status_preserved', v_cutoff.status
    )
  );

  v_result := v_summary || jsonb_build_object(
    'applied', true, 'idempotent_replay', false, 'cutoff_cancelled', false
  );

  insert into public.inventory_cutoff_transactions_policy_requests(
    cutoff_id, idempotency_key, policy, scope_fingerprint, requested_refs, result, created_by
  ) values (
    p_cutoff_id, p_idempotency_key, p_policy, p_expected_fingerprint, v_carried, v_result, v_user
  );

  return v_result;
end;
$$;

revoke all on function public.apply_inventory_cutoff_transactions_policy(
  uuid, text, jsonb, text, uuid
) from public, anon;

grant execute on function public.apply_inventory_cutoff_transactions_policy(
  uuid, text, jsonb, text, uuid
) to authenticated;

-- ---- source (verbatim): supabase/migrations/20260731_inventory_cutoff_authoritative_h2m_incoming_resolver.sql

create or replace function public.resolve_inventory_cutoff_h2m_incoming(
  p_cutoff_id uuid,
  p_order_item_ids uuid[]
) returns table (
  order_id uuid,
  order_number text,
  order_item_id uuid,
  variant_id uuid,
  variant_name text,
  alternative_name text,
  variant_code text,
  product_code text,
  order_warehouse_organization_id uuid,
  cutoff_warehouse_organization_id uuid,
  session_warehouse_organization_id uuid,
  selected_stock_config_id uuid,
  stock_config_id uuid,
  config_variant_id uuid,
  config_label text,
  config_status text,
  allow_ord boolean,
  in_session_scope boolean,
  eligible boolean,
  reason_code text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_cutoff public.inventory_opening_cutoffs%rowtype;
  v_session public.stock_count_sessions%rowtype;
  v_item_id uuid;
  v_item public.order_items%rowtype;
  v_order public.orders%rowtype;
  v_selected public.inventory_stock_configurations%rowtype;
  v_config public.inventory_stock_configurations%rowtype;
  v_received integer;
  v_variant_line_count integer;
  v_all_count integer;
  v_active_count integer;
  v_receiving_count integer;
  v_scoped_count integer;
  v_item_product_category_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and (auth.uid() is null or not public.inventory_cutoff_is_hq_admin()) then
    raise exception 'permission_denied';
  end if;

  select * into v_cutoff
  from public.inventory_opening_cutoffs
  where id = p_cutoff_id;
  if not found then raise exception 'inventory_cutoff_not_found'; end if;

  select * into v_session
  from public.stock_count_sessions
  where id = v_cutoff.stock_count_session_id;
  if v_session.id is null
     or v_cutoff.product_category_id is null
     or v_session.product_category_id is distinct from v_cutoff.product_category_id
     or not exists (
       select 1
       from public.product_categories category_row
       where category_row.id = v_cutoff.product_category_id
         and category_row.is_active = true
     ) then
    raise exception 'stock_count_active_product_category_required';
  end if;

  foreach v_item_id in array coalesce(p_order_item_ids, array[]::uuid[])
  loop
    order_id := null;
    order_number := null;
    order_item_id := v_item_id;
    variant_id := null;
    variant_name := null;
    alternative_name := null;
    variant_code := null;
    product_code := null;
    order_warehouse_organization_id := null;
    cutoff_warehouse_organization_id := v_cutoff.warehouse_organization_id;
    session_warehouse_organization_id := v_session.warehouse_organization_id;
    selected_stock_config_id := null;
    stock_config_id := null;
    config_variant_id := null;
    config_label := null;
    config_status := null;
    allow_ord := null;
    in_session_scope := false;
    eligible := false;
    reason_code := null;
    v_item_product_category_id := null;

    select * into v_item from public.order_items where id = v_item_id;
    if not found then
      reason_code := 'inventory_cutoff_order_item_not_found';
      return next;
      continue;
    end if;

    select * into v_order from public.orders where id = v_item.order_id;
    order_id := v_order.id;
    order_number := coalesce(v_order.display_doc_no, v_order.order_no);
    order_item_id := v_item.id;
    variant_id := v_item.variant_id;
    selected_stock_config_id := v_item.stock_config_id;

    select pv.variant_name, pv.alternative_name, pv.variant_code,
           coalesce(to_jsonb(pv)->>'product_code', p.product_code),
           p.category_id
      into variant_name, alternative_name, variant_code, product_code,
           v_item_product_category_id
    from public.product_variants pv
    join public.products p on p.id = pv.product_id
    where pv.id = v_item.variant_id;

    if v_cutoff.status <> 'counting' then
      reason_code := 'inventory_cutoff_not_active';
      return next;
      continue;
    end if;
    if v_item_product_category_id is distinct from
       v_cutoff.product_category_id then
      reason_code := 'inventory_cutoff_product_category_scope_mismatch';
      return next;
      continue;
    end if;
    if v_order.order_type <> 'H2M'
       or v_order.status not in ('approved', 'closed') then
      reason_code := 'inventory_cutoff_manufacturer_not_eligible';
      return next;
      continue;
    end if;

    order_warehouse_organization_id :=
      public.resolve_order_destination_warehouse(v_order.buyer_org_id);
    if order_warehouse_organization_id is distinct from
       v_cutoff.warehouse_organization_id then
      reason_code := 'inventory_cutoff_configuration_wrong_warehouse';
      return next;
      continue;
    end if;
    if v_session.id is null
       or v_session.warehouse_organization_id is distinct from
          v_cutoff.warehouse_organization_id then
      reason_code := 'inventory_cutoff_session_wrong_warehouse';
      return next;
      continue;
    end if;

    select coalesce(sum(received_now), 0)::integer into v_received
    from public.warehouse_receipt_items receipt_item
    where receipt_item.order_id = v_order.id
      and receipt_item.variant_id = v_item.variant_id;
    if v_item.qty - v_received <= 0 then
      reason_code := 'inventory_cutoff_no_outstanding_incoming';
      return next;
      continue;
    end if;

    select count(*)::integer into v_variant_line_count
    from public.order_items oi
    where oi.order_id = v_order.id and oi.variant_id = v_item.variant_id;
    if v_variant_line_count <> 1 then
      reason_code := 'inventory_cutoff_manufacturer_variant_lines_conflicting';
      return next;
      continue;
    end if;

    -- A legacy selected ID that belongs to another exact variant must never be
    -- silently replaced; surface the identity defect explicitly.
    if v_item.stock_config_id is not null then
      select * into v_selected
      from public.inventory_stock_configurations c
      where c.id = v_item.stock_config_id;
      if found and v_selected.variant_id is distinct from v_item.variant_id then
        config_variant_id := v_selected.variant_id;
        config_label := v_selected.config_label;
        config_status := v_selected.status;
        allow_ord := v_selected.allow_ord;
        reason_code := 'inventory_cutoff_configuration_wrong_variant';
        return next;
        continue;
      end if;
    end if;

    select count(*)::integer into v_all_count
    from public.inventory_stock_configurations c
    where c.variant_id = v_item.variant_id;
    if v_all_count = 0 then
      reason_code := 'inventory_cutoff_configuration_missing';
      return next;
      continue;
    end if;

    select count(*)::integer into v_active_count
    from public.inventory_stock_configurations c
    where c.variant_id = v_item.variant_id and c.status = 'active';
    if v_active_count = 0 then
      reason_code := 'inventory_cutoff_configuration_inactive';
      return next;
      continue;
    end if;

    select count(*)::integer into v_receiving_count
    from public.inventory_stock_configurations c
    where c.variant_id = v_item.variant_id
      and c.status = 'active'
      and c.allow_ord;
    if v_receiving_count = 0 then
      reason_code := 'inventory_cutoff_configuration_not_receiving_eligible';
      return next;
      continue;
    end if;

    select count(*)::integer into v_scoped_count
    from public.inventory_stock_configurations c
    join public.stock_count_session_scope scope_row
      on scope_row.stock_config_id = c.id
     and scope_row.session_id = v_cutoff.stock_count_session_id
    where c.variant_id = v_item.variant_id
      and c.status = 'active'
      and c.allow_ord;
    if v_scoped_count = 0 then
      reason_code := 'inventory_cutoff_configuration_not_in_session_scope';
      return next;
      continue;
    end if;
    if v_scoped_count > 1 then
      reason_code := 'inventory_cutoff_configuration_ambiguous';
      return next;
      continue;
    end if;

    select c.* into v_config
    from public.inventory_stock_configurations c
    join public.stock_count_session_scope scope_row
      on scope_row.stock_config_id = c.id
     and scope_row.session_id = v_cutoff.stock_count_session_id
    where c.variant_id = v_item.variant_id
      and c.status = 'active'
      and c.allow_ord;

    stock_config_id := v_config.id;
    config_variant_id := v_config.variant_id;
    config_label := v_config.config_label;
    config_status := v_config.status;
    allow_ord := v_config.allow_ord;
    in_session_scope := true;
    eligible := true;
    reason_code := 'eligible';
    return next;
  end loop;
end;
$$;

revoke all on function
  public.resolve_inventory_cutoff_h2m_incoming(uuid, uuid[])
  from public;

grant execute on function
  public.resolve_inventory_cutoff_h2m_incoming(uuid, uuid[])
  to authenticated, service_role;

comment on function
  public.resolve_inventory_cutoff_h2m_incoming(uuid, uuid[]) is
  'Read-only authoritative H2M Incoming resolver. Requires products.category_id to equal the Opening Balance product_category_id, then resolves one exact-variant active allow_ord configuration from the cutoff session immutable scope. Product inventory, physical quantity and display names are not eligibility inputs.';

-- ---- source (verbatim): supabase/migrations/20260731_inventory_cutoff_authoritative_h2m_incoming_resolver.sql

create or replace function public.set_inventory_cutoff_decision(
  p_cutoff_id uuid, p_order_item_id uuid, p_decision text
) returns public.inventory_cutoff_decisions
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_cutoff public.inventory_opening_cutoffs%rowtype;
  v_order public.orders%rowtype;
  v_item public.order_items%rowtype;
  v_config uuid;
  v_resolution record;
  v_kind text;
  v_saved public.inventory_cutoff_decisions%rowtype;
  v_received integer;
  v_item_product_category_id uuid;
begin
  if v_user is null or not public.inventory_cutoff_is_hq_admin() then raise exception 'permission_denied'; end if;
  select * into v_cutoff from public.inventory_opening_cutoffs where id=p_cutoff_id for update;
  if not found or v_cutoff.status <> 'counting' then raise exception 'inventory_cutoff_not_active'; end if;
  select * into v_item from public.order_items where id=p_order_item_id for update;
  select * into v_order from public.orders where id=v_item.order_id;

  if v_order.order_type in ('D2H','S2D') then
    v_kind := 'distributor';
    if v_order.status <> 'submitted'
       or p_decision not in ('carry_forward','cancel_release','do_not_carry_forward') then
      raise exception 'inventory_cutoff_distributor_not_eligible';
    end if;
    if public.order_inventory_organization(v_order.id) <> v_cutoff.warehouse_organization_id then
      raise exception 'organization_mismatch';
    end if;
    if p_decision in ('carry_forward','cancel_release') then
      if not exists (
        select 1 from public.stock_movements sm
        where sm.reference_id=v_order.id and sm.variant_id=v_item.variant_id
          and sm.movement_type='allocation'
      ) or exists (
        select 1 from public.stock_movements sm
        where sm.reference_id=v_order.id and sm.variant_id=v_item.variant_id
          and sm.movement_type in ('deallocation','order_fulfillment')
      ) then raise exception 'inventory_cutoff_allocation_not_active'; end if;
    end if;
    if p_decision='carry_forward' then
      select * into v_resolution
      from public.resolve_inventory_cutoff_d2h_carry_forward(
        v_cutoff.id, array[v_item.id]
      );
      if not coalesce(v_resolution.eligible, false) then
        raise exception using message = coalesce(
          v_resolution.reason_code, 'inventory_cutoff_configuration_missing'
        );
      end if;
      v_config := v_resolution.stock_config_id;
    else
      v_config := v_item.stock_config_id;
    end if;
  elsif v_order.order_type='H2M' then
    v_kind := 'manufacturer';
    if v_cutoff.product_category_id is null
       or not exists (
         select 1
         from public.stock_count_sessions session_row
         join public.product_categories category_row
           on category_row.id = session_row.product_category_id
          and category_row.is_active = true
         where session_row.id = v_cutoff.stock_count_session_id
           and session_row.product_category_id = v_cutoff.product_category_id
       ) then
      raise exception 'stock_count_active_product_category_required';
    end if;
    select product.category_id into v_item_product_category_id
    from public.product_variants variant
    join public.products product on product.id = variant.product_id
    where variant.id = v_item.variant_id;
    if v_item_product_category_id is distinct from v_cutoff.product_category_id then
      raise exception 'inventory_cutoff_product_category_scope_mismatch';
    end if;
    if p_decision not in ('carry_forward_incoming','history_only')
       or v_order.status not in ('approved','closed') then
      raise exception 'inventory_cutoff_manufacturer_not_eligible';
    end if;
    if public.resolve_order_destination_warehouse(v_order.buyer_org_id)
       <> v_cutoff.warehouse_organization_id then raise exception 'organization_mismatch'; end if;
    select coalesce(sum(received_now),0)::integer into v_received
      from public.warehouse_receipt_items
      where order_id=v_order.id and variant_id=v_item.variant_id;
    if v_item.qty-v_received <= 0 then raise exception 'inventory_cutoff_no_outstanding_incoming'; end if;
    if (select count(*) from public.order_items oi where oi.order_id=v_order.id
      and oi.variant_id=v_item.variant_id) <> 1 then
      raise exception 'inventory_cutoff_manufacturer_variant_lines_conflicting';
    end if;

    if p_decision='carry_forward_incoming' then
      select * into v_resolution
      from public.resolve_inventory_cutoff_h2m_incoming(
        v_cutoff.id, array[v_item.id]
      );
      if not coalesce(v_resolution.eligible, false) then
        raise exception using message = coalesce(
          v_resolution.reason_code, 'inventory_cutoff_configuration_missing'
        );
      end if;
      v_config := v_resolution.stock_config_id;
      update public.order_items
      set stock_config_id = v_config,
          stock_config_confirmed_at = now(),
          stock_config_confirmed_by = v_user,
          updated_at = now()
      where id = v_item.id;
    else
      v_config := v_item.stock_config_id;
    end if;
  else
    raise exception 'inventory_cutoff_order_type_not_supported';
  end if;

  insert into public.inventory_cutoff_decisions(
    cutoff_id,transaction_kind,order_id,order_item_id,decision,stock_config_id,quantity,decided_by
  ) values (
    v_cutoff.id,v_kind,v_order.id,v_item.id,p_decision,v_config,
    case when v_kind='manufacturer' then v_item.qty-v_received else v_item.qty end,v_user
  )
  on conflict(cutoff_id,transaction_kind,order_item_id) do update set
    decision=excluded.decision,stock_config_id=excluded.stock_config_id,
    quantity=excluded.quantity,decided_by=excluded.decided_by,
    decided_at=now(),updated_at=now()
  returning * into v_saved;

  update public.stock_count_verification_requests vr
  set status='invalidated',invalidated_at=now(),
    request_metadata=coalesce(request_metadata,'{}'::jsonb)
      || jsonb_build_object('invalidated_reason','inventory_cutoff_decision_changed')
  where vr.session_id=v_cutoff.stock_count_session_id
    and vr.status in ('pending_delivery','active');

  insert into public.inventory_cutoff_audit_events(
    cutoff_id,event_type,actor_id,order_id,order_item_id,details
  ) values (
    v_cutoff.id,'decision_recorded',v_user,v_order.id,v_item.id,
    jsonb_build_object('kind',v_kind,'decision',p_decision,
      'quantity',v_saved.quantity,'stock_config_id',v_config)
  );
  return v_saved;
end;
$$;

revoke all on function public.set_inventory_cutoff_decision(uuid,uuid,text)
  from public;

grant execute on function public.set_inventory_cutoff_decision(uuid,uuid,text)
  to authenticated;

-- ---- source (verbatim): supabase/migrations/20260731173000_inventory_cutoff_h2m_bulk_contract_targeting_fix.sql

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

-- ---- source (verbatim): supabase/migrations/20260731173000_inventory_cutoff_h2m_bulk_contract_targeting_fix.sql

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

-- ---- source (verbatim): supabase/migrations/20260731_inventory_cutoff_authoritative_carry_forward_resolver.sql

create or replace function public.resolve_inventory_cutoff_d2h_carry_forward(
  p_cutoff_id uuid,
  p_order_item_ids uuid[]
) returns table (
  order_id uuid,
  order_number text,
  order_item_id uuid,
  variant_id uuid,
  variant_name text,
  alternative_name text,
  variant_code text,
  product_code text,
  order_warehouse_organization_id uuid,
  cutoff_warehouse_organization_id uuid,
  session_warehouse_organization_id uuid,
  stock_config_id uuid,
  config_variant_id uuid,
  config_status text,
  allow_so boolean,
  default_for_ord boolean,
  packaging text,
  volume_ml smallint,
  in_session_scope boolean,
  eligible boolean,
  reason_code text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_cutoff public.inventory_opening_cutoffs%rowtype;
  v_session public.stock_count_sessions%rowtype;
  v_item_id uuid;
  v_item public.order_items%rowtype;
  v_order public.orders%rowtype;
  v_config public.inventory_stock_configurations%rowtype;
  v_candidate_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and (auth.uid() is null or not public.inventory_cutoff_is_hq_admin()) then
    raise exception 'permission_denied';
  end if;

  select * into v_cutoff
  from public.inventory_opening_cutoffs
  where id = p_cutoff_id;

  if not found then
    raise exception 'inventory_cutoff_not_found';
  end if;

  select * into v_session
  from public.stock_count_sessions
  where id = v_cutoff.stock_count_session_id;

  foreach v_item_id in array coalesce(p_order_item_ids, array[]::uuid[])
  loop
    order_id := null;
    order_number := null;
    order_item_id := v_item_id;
    variant_id := null;
    variant_name := null;
    alternative_name := null;
    variant_code := null;
    product_code := null;
    order_warehouse_organization_id := null;
    cutoff_warehouse_organization_id := v_cutoff.warehouse_organization_id;
    session_warehouse_organization_id := v_session.warehouse_organization_id;
    stock_config_id := null;
    config_variant_id := null;
    config_status := null;
    allow_so := null;
    default_for_ord := null;
    packaging := null;
    volume_ml := null;
    in_session_scope := false;
    eligible := false;
    reason_code := null;

    select * into v_item from public.order_items where id = v_item_id;
    if not found then
      reason_code := 'inventory_cutoff_order_item_not_found';
      return next;
      continue;
    end if;

    select * into v_order from public.orders where id = v_item.order_id;
    order_id := v_order.id;
    order_number := coalesce(v_order.display_doc_no, v_order.order_no);
    order_item_id := v_item.id;
    variant_id := v_item.variant_id;

    select pv.variant_name, pv.alternative_name, pv.variant_code,
           coalesce(to_jsonb(pv)->>'product_code', p.product_code)
      into variant_name, alternative_name, variant_code, product_code
    from public.product_variants pv
    join public.products p on p.id = pv.product_id
    where pv.id = v_item.variant_id;

    if v_cutoff.status <> 'counting' then
      reason_code := 'inventory_cutoff_not_active';
      return next;
      continue;
    end if;
    if v_order.order_type not in ('D2H', 'S2D')
       or v_order.status <> 'submitted' then
      reason_code := 'inventory_cutoff_distributor_not_eligible';
      return next;
      continue;
    end if;

    order_warehouse_organization_id :=
      public.order_inventory_organization(v_order.id);
    if order_warehouse_organization_id is distinct from
       v_cutoff.warehouse_organization_id then
      reason_code := 'inventory_cutoff_configuration_wrong_warehouse';
      return next;
      continue;
    end if;
    if v_session.id is null
       or v_session.warehouse_organization_id is distinct from
          v_cutoff.warehouse_organization_id then
      reason_code := 'inventory_cutoff_session_wrong_warehouse';
      return next;
      continue;
    end if;

    select count(*)::integer into v_candidate_count
    from public.inventory_stock_configurations c
    where c.variant_id = v_item.variant_id
      and c.volume_ml = 20
      and c.packaging = 'new_box';

    if v_candidate_count = 0 then
      reason_code := 'inventory_cutoff_configuration_missing';
      return next;
      continue;
    end if;
    if v_candidate_count > 1 then
      reason_code := 'inventory_cutoff_configuration_ambiguous';
      return next;
      continue;
    end if;

    select * into v_config
    from public.inventory_stock_configurations c
    where c.variant_id = v_item.variant_id
      and c.volume_ml = 20
      and c.packaging = 'new_box';

    stock_config_id := v_config.id;
    config_variant_id := v_config.variant_id;
    config_status := v_config.status;
    allow_so := v_config.allow_so;
    default_for_ord := v_config.default_for_ord;
    packaging := v_config.packaging;
    volume_ml := v_config.volume_ml;
    in_session_scope := exists (
      select 1
      from public.stock_count_session_scope scope_row
      where scope_row.session_id = v_cutoff.stock_count_session_id
        and scope_row.stock_config_id = v_config.id
    );

    -- Defence in depth: the candidate query is variant-scoped, but retain an
    -- explicit identity reason if legacy/corrupt data ever violates that fact.
    if v_config.variant_id is distinct from v_item.variant_id then
      reason_code := 'inventory_cutoff_configuration_wrong_variant';
    elsif v_config.status <> 'active' then
      reason_code := 'inventory_cutoff_configuration_inactive';
    elsif not v_config.allow_so then
      reason_code := 'inventory_cutoff_configuration_not_order_eligible';
    elsif not in_session_scope then
      reason_code := 'inventory_cutoff_configuration_not_in_session_scope';
    else
      eligible := true;
      reason_code := 'eligible';
    end if;
    return next;
  end loop;
end;
$$;

revoke all on function
  public.resolve_inventory_cutoff_d2h_carry_forward(uuid, uuid[])
  from public;

grant execute on function
  public.resolve_inventory_cutoff_d2h_carry_forward(uuid, uuid[])
  to authenticated, service_role;

comment on function
  public.resolve_inventory_cutoff_d2h_carry_forward(uuid, uuid[]) is
  'Read-only authoritative D2H Carry Forward resolver. Matches exact order-item variant to active allow_so 20ml New Box within the cutoff session immutable scope; product_inventory and physical quantity are intentionally not eligibility inputs.';

-- ---- source (verbatim): supabase/migrations/20260731220000_inventory_cutoff_cancel_archives_draft_session.sql

create or replace function public.cancel_inventory_opening_cutoff(
  p_cutoff_id uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_session_id uuid;
begin
  if v_user is null or not public.inventory_cutoff_is_hq_admin() then
    raise exception 'permission_denied';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'cancellation_reason_required';
  end if;

  update public.inventory_opening_cutoffs
  set
    status = 'cancelled',
    cancelled_by = v_user,
    cancelled_at = now(),
    updated_at = now()
  where id = p_cutoff_id
    and status = 'counting'
  returning stock_count_session_id into v_session_id;

  if not found then
    raise exception 'inventory_cutoff_not_active';
  end if;

  -- Soft-archive the linked Opening Balance draft. Discard guard already allows
  -- archive when the cutoff is not counting/posted. This releases the active
  -- draft unique index so a retry can create a new session + new cutoff.
  update public.stock_count_sessions
  set
    status = 'archived',
    updated_at = now(),
    updated_by = v_user
  where id = v_session_id
    and status = 'draft'
    and count_type = 'opening_balance_cutoff';

  insert into public.inventory_cutoff_audit_events(
    cutoff_id, event_type, actor_id, details
  ) values (
    p_cutoff_id,
    'warehouse_freeze_cancelled',
    v_user,
    jsonb_build_object(
      'reason', trim(p_reason),
      'stock_count_session_id', v_session_id,
      'session_archived', true
    )
  );
end;
$$;

revoke all on function public.cancel_inventory_opening_cutoff(uuid, text) from public;

grant execute on function public.cancel_inventory_opening_cutoff(uuid, text) to authenticated;

comment on function public.cancel_inventory_opening_cutoff(uuid, text) is
  'Cancels an active Opening Balance freeze, reopens the warehouse, and soft-archives the linked draft session so Continue Existing Draft cannot reopen the cancelled cutoff. A retry must create a new draft and a new counting cutoff.';

-- ---- source (verbatim): supabase/migrations/20260801120000_inventory_cutoff_pre_otp_draft_discard.sql

create or replace function public.stock_count_discard_posting_started_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status = 'draft' and new.status = 'archived' and (
    exists (
      select 1
      from public.inventory_opening_cutoffs c
      where c.stock_count_session_id = old.id
        and c.status = 'posted'
    )
    or exists (
      select 1
      from public.stock_count_verification_requests r
      where r.session_id = old.id
        and r.status in ('pending_delivery', 'active', 'posted')
    )
  ) then
    raise exception 'stock_count_not_discardable_posting_started';
  end if;
  return new;
end;
$$;

comment on function public.stock_count_discard_posting_started_guard() is
  'Blocks hard discard once OTP verification for final posting has been requested or the Opening Balance cutoff is posted. A counting freeze alone is not a protection boundary.';

-- ---- source (verbatim): supabase/migrations/20260801170000_inventory_cutoff_pre_otp_discard_transactions_policy.sql

create or replace function public.archive_stock_count_draft(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.stock_count_sessions%rowtype;
  v_movement_count integer;
  v_cutoff_id uuid;
  v_cutoff_status text;
  v_released_counting_cutoff_id uuid;
begin
  if v_user_id is null then raise exception 'unauthorized'; end if;
  if p_session_id is null then raise exception 'stock_count_not_found'; end if;

  select * into v_session
  from public.stock_count_sessions
  where id = p_session_id
  for update;

  if not found then raise exception 'stock_count_not_found'; end if;

  if not (public.can_access_org(v_session.warehouse_organization_id) or public.is_hq_admin()) then
    raise exception 'permission_lost';
  end if;

  if v_session.status = 'archived' then
    return jsonb_build_object(
      'status', 'archived',
      'session_id', p_session_id,
      'already_archived', true
    );
  end if;

  if v_session.status <> 'draft' or v_session.posted_at is not null then
    raise exception 'stock_count_not_discardable';
  end if;

  -- Authoritative protection boundary: OTP requested for final posting.
  if exists (
    select 1
    from public.stock_count_verification_requests r
    where r.session_id = p_session_id
      and r.status in ('pending_delivery', 'active', 'posted')
  ) then
    raise exception 'stock_count_not_discardable_posting_started';
  end if;

  select c.id, c.status
    into v_cutoff_id, v_cutoff_status
  from public.inventory_opening_cutoffs c
  where c.stock_count_session_id = p_session_id
  for update;

  if v_cutoff_status = 'posted' then
    raise exception 'stock_count_not_discardable_posting_started';
  end if;

  select count(*)::integer into v_movement_count
  from public.stock_movements
  where reference_id = p_session_id
    and reference_type in ('adjustment', 'stock_classification');

  if coalesce(v_movement_count, 0) > 0 then
    raise exception 'stock_count_not_discardable';
  end if;

  -- Pre-OTP counting freeze is draft-owned. Release it and remove draft-owned
  -- dependents so discard does not leave a warehouse freeze or cancelled-history
  -- row. Orders, inventory, movements and QR are never touched. Every child is
  -- removed for this exact cutoff only, before the parent cutoff, so the delete
  -- can never violate a RESTRICT foreign key.
  if v_cutoff_id is not null and v_cutoff_status = 'counting' then
    delete from public.inventory_cutoff_d2h_policy_requests
      where cutoff_id = v_cutoff_id;
    delete from public.inventory_cutoff_d2h_policies
      where cutoff_id = v_cutoff_id;
    delete from public.inventory_cutoff_h2m_policy_requests
      where cutoff_id = v_cutoff_id;
    delete from public.inventory_cutoff_h2m_policies
      where cutoff_id = v_cutoff_id;
    delete from public.inventory_cutoff_h2m_bulk_requests
      where cutoff_id = v_cutoff_id;
    -- Transactions policy (Step 4) draft-owned snapshot + idempotency ledger.
    -- inventory_cutoff_transactions_policies has ON DELETE RESTRICT; without this
    -- delete the parent cutoff delete below fails.
    delete from public.inventory_cutoff_transactions_policy_requests
      where cutoff_id = v_cutoff_id;
    delete from public.inventory_cutoff_transactions_policies
      where cutoff_id = v_cutoff_id;
    -- Historical-exclusion markers exist only for POSTED cutoffs. A counting
    -- cutoff has none; this scoped delete is a defensive no-op that also clears
    -- the next RESTRICT foreign key. Bounded to this exact cutoff.
    delete from public.inventory_cutoff_excluded_transactions
      where cutoff_id = v_cutoff_id;
    delete from public.inventory_cutoff_posting_context
      where cutoff_id = v_cutoff_id;
    delete from public.inventory_cutoff_decisions
      where cutoff_id = v_cutoff_id;
    delete from public.inventory_cutoff_reports
      where cutoff_id = v_cutoff_id;
    delete from public.inventory_cutoff_audit_events
      where cutoff_id = v_cutoff_id;
    delete from public.inventory_opening_cutoffs
      where id = v_cutoff_id
        and status = 'counting'
        and posted_at is null
        and cancelled_at is null;

    if not found then
      raise exception 'stock_count_not_discardable_posting_started';
    end if;

    v_released_counting_cutoff_id := v_cutoff_id;
  end if;

  -- Re-check OTP under the same session lock after freeze release so a concurrent
  -- Request OTP cannot race past the earlier check.
  if exists (
    select 1
    from public.stock_count_verification_requests r
    where r.session_id = p_session_id
      and r.status in ('pending_delivery', 'active', 'posted')
  ) then
    raise exception 'stock_count_not_discardable_posting_started';
  end if;

  update public.stock_count_sessions
  set
    status = 'archived',
    archived_by = v_user_id,
    archived_at = now(),
    updated_by = v_user_id,
    updated_at = now()
  where id = p_session_id
    and status = 'draft'
    and posted_at is null;

  if not found then
    raise exception 'stock_count_not_discardable';
  end if;

  update public.stock_count_verification_requests
  set status = 'invalidated', invalidated_at = now()
  where session_id = p_session_id
    and status in ('pending_delivery', 'active');

  return jsonb_build_object(
    'status', 'archived',
    'session_id', p_session_id,
    'already_archived', false,
    'released_counting_cutoff_id', v_released_counting_cutoff_id
  );
end;
$$;

comment on function public.archive_stock_count_draft(uuid) is
  'Soft-discards a Stock Count draft. Pre-OTP Opening Balance counting freezes are released and draft-owned cutoff dependents (D2H / H2M / Transactions policies + requests, decisions, reports, posting context, audit) are removed for the exact cutoff before the counting cutoff itself. OTP-requested, posted, cancelled-history protection and inventory/order/movement/allocation/QR data are never discarded through this path.';

-- ---- source (verbatim): supabase/migrations/20260731_archive_product_variant_atomic.sql

CREATE OR REPLACE FUNCTION public.archive_product_variant(p_variant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_was_active boolean;
  v_variant_rows integer := 0;
  v_configurations_archived integer := 0;
  v_remaining_operational integer := 0;
  v_variant_is_active boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- This RPC bypasses table RLS in order to make both writes atomic, so enforce
  -- the same HQ-admin boundary used by the stock-configuration management RLS.
  IF NOT public.is_hq_admin() THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  IF p_variant_id IS NULL THEN
    RAISE EXCEPTION 'variant_not_found';
  END IF;

  SELECT pv.is_active
  INTO v_was_active
  FROM public.product_variants AS pv
  WHERE pv.id = p_variant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'variant_not_found';
  END IF;

  UPDATE public.product_variants
  SET is_active = false,
      updated_at = now()
  WHERE id = p_variant_id
    AND is_active IS DISTINCT FROM false;

  GET DIAGNOSTICS v_variant_rows = ROW_COUNT;

  -- If the row was active, exactly one variant row must have changed. This
  -- catches trigger/policy behavior that silently suppresses a mutation.
  IF v_was_active IS DISTINCT FROM false AND v_variant_rows <> 1 THEN
    RAISE EXCEPTION 'variant_archive_failed';
  END IF;

  UPDATE public.inventory_stock_configurations
  SET status = 'inactive',
      updated_at = now()
  WHERE variant_id = p_variant_id
    AND status IN ('active', 'phase_out');

  GET DIAGNOSTICS v_configurations_archived = ROW_COUNT;

  SELECT pv.is_active
  INTO v_variant_is_active
  FROM public.product_variants AS pv
  WHERE pv.id = p_variant_id;

  SELECT count(*)::integer
  INTO v_remaining_operational
  FROM public.inventory_stock_configurations AS isc
  WHERE isc.variant_id = p_variant_id
    AND isc.status IN ('active', 'phase_out');

  -- Raising from the function rolls back both UPDATE statements. A caller can
  -- therefore never receive success for a partial archive.
  IF v_variant_is_active IS DISTINCT FROM false
     OR v_remaining_operational <> 0 THEN
    RAISE EXCEPTION 'variant_archive_incomplete';
  END IF;

  RETURN jsonb_build_object(
    'status', 'archived',
    'variant_id', p_variant_id,
    'variant_is_active', v_variant_is_active,
    'configurations_archived', v_configurations_archived,
    'remaining_operational_configurations', v_remaining_operational,
    'already_archived', v_was_active IS NOT DISTINCT FROM false
  );
END;
$$;

COMMENT ON FUNCTION public.archive_product_variant(uuid) IS
  'Atomically soft-archives one Product Variant and changes only its active/phase_out stock configurations to inactive. Preserves every historical and snapshot row.';

REVOKE ALL ON FUNCTION public.archive_product_variant(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.archive_product_variant(uuid) TO authenticated;

-- ---- source (verbatim): supabase/migrations/20260730_stock_count_reference_required.sql

CREATE OR REPLACE FUNCTION public.enforce_stock_count_reference_required()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'draft'
     AND NEW.count_type <> 'initial_configuration_classification' THEN
    IF NEW.reference_name IS NULL OR btrim(NEW.reference_name) = '' THEN
      RAISE EXCEPTION 'Reference / Batch Name is required.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF char_length(btrim(NEW.reference_name)) > 120 THEN
      RAISE EXCEPTION 'Reference / Batch Name must be 120 characters or fewer.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ---- source (verbatim): supabase/migrations/20260801140000_inventory_cutoff_transactions_policy.sql

create or replace function public.inventory_cutoff_excluded_transaction_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_type text;
begin
  if new.reference_id is null then
    return new;
  end if;
  v_type := case coalesce(new.reference_type, '')
    when 'adjustment' then 'stock_adjustment'
    when 'stock_adjustment' then 'stock_adjustment'
    when 'return' then 'return'
    when 'transfer' then 'stock_transfer'
    else null end;
  if v_type is null then
    return new;
  end if;
  if exists (
    select 1
    from public.inventory_cutoff_excluded_transactions x
    join public.inventory_opening_cutoffs c on c.id = x.cutoff_id
    where x.transaction_type = v_type
      and x.transaction_id = new.reference_id
      and c.status = 'posted'
  ) then
    raise exception 'inventory_cutoff_transaction_historically_excluded: transaction % was excluded by a posted Opening Balance and cannot post inventory through its original path.', new.reference_id;
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_cutoff_excluded_transaction_guard on public.stock_movements;

create trigger inventory_cutoff_excluded_transaction_guard
before insert on public.stock_movements
for each row execute function public.inventory_cutoff_excluded_transaction_guard();

comment on function public.inventory_cutoff_excluded_transaction_guard() is
  'Fail-closed guard: blocks a stock movement for any transaction historically excluded by a POSTED Opening Balance. Carried transactions are never marked and are unaffected. Does not delete or cancel the original transaction.';

-- ---- source (verbatim): supabase/migrations/20260801090000_inventory_cutoff_h2m_policy.sql

create or replace function public.trg_warehouse_receipt_h2m_excluded_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_h2m_receipt_allowed_after_cutoff(new.order_id);
  return new;
end;
$$;

drop trigger if exists warehouse_receipt_h2m_excluded_guard on public.warehouse_receipts;

create trigger warehouse_receipt_h2m_excluded_guard
  before insert on public.warehouse_receipts
  for each row
  execute function public.trg_warehouse_receipt_h2m_excluded_guard();

-- ---- source (verbatim): supabase/migrations/20260730_stock_count_reference_required.sql

DROP TRIGGER IF EXISTS stock_count_reference_required ON public.stock_count_sessions;

CREATE TRIGGER stock_count_reference_required
  BEFORE INSERT OR UPDATE OF status, count_type, reference_name
  ON public.stock_count_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_stock_count_reference_required();

-- ===========================================================================
-- Opening Balance preview DELEGATION CHAIN  (load-bearing -- do not remove)
-- ---------------------------------------------------------------------------
-- inventory_cutoff_preview is NOT self-contained. Development built it by
-- repeatedly renaming the live function to a *_pre_<feature> name and creating
-- a thin new wrapper on top. The result is an eight-layer stack in which each
-- layer CALLS the layer below it:
--
--   inventory_cutoff_preview                                  (installed in 07)
--     -> inventory_cutoff_preview_pre_blocker_details
--          -> inventory_cutoff_preview_pre_transactions_policy
--               -> inventory_cutoff_preview_pre_h2m_policy
--                    -> inventory_cutoff_preview_pre_d2h_policy
--                         -> inventory_cutoff_preview_pre_stock_adjustment_detail
--                              -> inventory_cutoff_preview_pre_stock_adjustment_eligibility
--                                   -> inventory_cutoff_preview_h2m_unscoped_legacy
--
-- Deploying only the top function would compile fine and then fail at RUNTIME
-- with "function ... does not exist" the first time a cut-off is previewed.
--
-- The layers are reproduced here under their FINAL names with CREATE OR REPLACE
-- instead of replaying the rename dance, which is not rerunnable.
--
-- SOURCE OF THESE BODIES: exported with pg_get_functiondef() from the staging
-- database, which this pack's audit proved byte-equivalent (ignoring comments
-- and whitespace) to the repository's last-writer migration for every function
-- checked. Sourcing the assembled chain avoids hand-reconstructing seven
-- successive renames, which is the highest-risk step in the whole migration.
--
-- NOTE: verify_and_post_inventory_opening_cutoff_pre_transactions_polic is
-- truncated at 63 characters by PostgreSQL's identifier limit. That truncated
-- spelling is the real object name and must be preserved exactly.
--
-- These layers are reached only through the SECURITY DEFINER wrapper, so they
-- are revoked from PUBLIC and carry no direct grant.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.inventory_cutoff_preview_h2m_unscoped_legacy(p_cutoff_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_cutoff public.inventory_opening_cutoffs%rowtype;
  v_inventory jsonb; v_distributor jsonb; v_manufacturer jsonb;
  v_activity jsonb; v_drafts jsonb; v_blockers jsonb; v_review jsonb;
  v_readiness text;
begin
  select * into v_cutoff from public.inventory_opening_cutoffs where id=p_cutoff_id;
  if not found or not public.can_access_org(v_cutoff.warehouse_organization_id) then
    raise exception 'inventory_cutoff_not_found';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'variant_id',i.variant_id,'variant_name',pv.variant_name,
    'stock_config_id',i.stock_config_id,'stock_configuration',c.config_label,
    'config_code',c.config_code,'system_quantity',i.system_quantity,
    'physical_quantity',i.physical_quantity,
    'variance',case when i.physical_quantity is null then null
      else i.physical_quantity-i.system_quantity end,
    'allocated_quantity',coalesce(pi.quantity_allocated,0)
  ) order by pv.variant_name,c.sort_order),'[]'::jsonb) into v_inventory
  from public.stock_count_session_items i
  join public.inventory_stock_configurations c on c.id=i.stock_config_id and c.variant_id=i.variant_id
  join public.product_variants pv on pv.id=i.variant_id
  left join public.product_inventory pi on pi.organization_id=v_cutoff.warehouse_organization_id
    and pi.variant_id=i.variant_id and pi.stock_config_id=i.stock_config_id and pi.is_active
  where i.session_id=v_cutoff.stock_count_session_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'order_id',o.id,'order_item_id',oi.id,'order_number',coalesce(o.display_doc_no,o.order_no),
    'status',o.status,'customer',buyer.org_name,'warehouse',wh.org_name,
    'variant_id',oi.variant_id,'variant',pv.variant_name,'quantity',oi.qty,
    'current_stock_config_id',oi.stock_config_id,
    'decision',d.decision,'carry_stock_config_id',d.stock_config_id,
    'classification',case
      when o.status='submitted' and d.decision='carry_forward' then 'Carry Forward'
      when o.status='submitted' and d.decision='cancel_release' then 'Cancel & Release'
      when o.status='submitted' and d.decision='do_not_carry_forward' then 'Do Not Carry Forward'
      when o.status='submitted' then 'Blocked'
      when o.status in ('approved','warehouse_packed') then 'Complete Before Cut-off'
      when o.status='shipped_distributor' then 'Stock in Transit'
      when o.status in ('closed','cancelled') then 'History Only'
      else 'Complete Before Cut-off' end,
    'available_actions',case when o.status='submitted'
      then jsonb_build_array('Carry Forward','Cancel & Release','Do Not Carry Forward') else '[]'::jsonb end
  ) order by o.created_at,o.id,oi.id),'[]'::jsonb) into v_distributor
  from public.orders o join public.order_items oi on oi.order_id=o.id
  join public.organizations buyer on buyer.id=o.buyer_org_id
  left join public.organizations wh on wh.id=public.order_inventory_organization(o.id)
  join public.product_variants pv on pv.id=oi.variant_id
  left join public.inventory_cutoff_decisions d on d.cutoff_id=v_cutoff.id
    and d.transaction_kind='distributor' and d.order_item_id=oi.id
  where o.order_type in ('D2H','S2D')
    and public.order_inventory_organization(o.id)=v_cutoff.warehouse_organization_id
    and (o.status <> 'draft' or exists(select 1 from public.stock_movements sm where sm.reference_id=o.id));

  select coalesce(jsonb_agg(jsonb_build_object(
    'order_id',x.order_id,'order_item_id',x.order_item_id,'order_number',x.order_number,
    'status',x.status,'manufacturer',x.manufacturer,'variant_id',x.variant_id,
    'variant',x.variant,'ordered_quantity',x.ordered_qty,'received_quantity',x.received_qty,
    'remaining_incoming_quantity',x.remaining_qty,
    'stock_config_id',x.stock_config_id,'stock_configuration',x.stock_configuration,
    'decision',x.decision,
    'classification',case when x.decision='history_only' then 'History Only'
      when x.stock_config_id is null then 'Blocked'
      when x.decision='carry_forward_incoming' then 'Carry Forward' else 'Blocked' end
  ) order by x.created_at,x.order_id,x.order_item_id),'[]'::jsonb) into v_manufacturer
  from (
    select o.id order_id,oi.id order_item_id,coalesce(o.display_doc_no,o.order_no) order_number,
      o.status,m.org_name manufacturer,oi.variant_id,pv.variant_name variant,oi.qty ordered_qty,
      coalesce(r.received_qty,0) received_qty,
      greatest(oi.qty-coalesce(r.received_qty,0),0) remaining_qty,
      oi.stock_config_id,c.config_label stock_configuration,d.decision,o.created_at
    from public.orders o join public.order_items oi on oi.order_id=o.id
    join public.organizations m on m.id=o.seller_org_id
    join public.product_variants pv on pv.id=oi.variant_id
    left join public.inventory_stock_configurations c on c.id=oi.stock_config_id and c.variant_id=oi.variant_id
    left join (select order_id,variant_id,sum(received_now)::integer received_qty
      from public.warehouse_receipt_items group by order_id,variant_id) r
      on r.order_id=o.id and r.variant_id=oi.variant_id
    left join public.inventory_cutoff_decisions d on d.cutoff_id=v_cutoff.id
      and d.transaction_kind='manufacturer' and d.order_item_id=oi.id
    where o.order_type='H2M' and o.status in ('approved','closed')
      and public.resolve_order_destination_warehouse(o.buyer_org_id)=v_cutoff.warehouse_organization_id
  ) x where x.remaining_qty>0;

  select coalesce(jsonb_agg(jsonb_build_object(
    'movement_type',a.movement_type,'reference_type',a.reference_type,
    'reference_no',a.reference_no,'status',a.status,'quantity',a.quantity,
    'occurred_at',a.occurred_at,'classification',a.classification
  ) order by a.occurred_at desc),'[]'::jsonb) into v_activity
  from (
    select sm.movement_type,sm.reference_type,sm.reference_no,null::text status,
      sm.quantity_change quantity,sm.created_at occurred_at,'History Only'::text classification
    from public.stock_movements sm where
      (sm.from_organization_id=v_cutoff.warehouse_organization_id
        or sm.to_organization_id=v_cutoff.warehouse_organization_id)
      and sm.movement_type in ('transfer_out','transfer_in','repack_out','repack_in','adjustment','addition')
      and sm.created_at >= v_cutoff.started_at - interval '30 days'
    union all
    select 'stock_transfer', 'transfer',t.transfer_no,t.status,t.total_items,t.created_at,
      case when t.status='in_transit' then 'Stock in Transit'
        else 'Complete Before Cut-off' end
    from public.stock_transfers t
    where (t.from_organization_id=v_cutoff.warehouse_organization_id
      or t.to_organization_id=v_cutoff.warehouse_organization_id)
      and t.status in ('pending','pending_approval','ready_to_dispatch','in_transit')
    union all
    select 'return','return',r.return_no,r.status,0,r.created_at,'Complete Before Cut-off'
    from public.return_cases r where r.return_warehouse_id=v_cutoff.warehouse_organization_id
      and r.status in ('return_submitted','return_received','return_processing')
    union all
    select 'stock_adjustment','adjustment',a.id::text,a.status,0,a.created_at,'Complete Before Cut-off'
    from public.stock_adjustments a where a.organization_id=v_cutoff.warehouse_organization_id
      and coalesce(a.status,'completed')<>'completed'
  ) a;

  select coalesce(jsonb_agg(jsonb_build_object(
    'session_id',id,'count_type',count_type,'reference_name',reference_name,
    'created_at',created_at,'classification',
      case when id=v_cutoff.stock_count_session_id then 'Carry Forward' else 'Blocked' end
  ) order by created_at),'[]'::jsonb) into v_drafts
  from public.stock_count_sessions
  where warehouse_organization_id=v_cutoff.warehouse_organization_id and status='draft';

  select coalesce(jsonb_agg(message),'[]'::jsonb) into v_blockers from (
    select format('Physical count is missing for %s (%s).',pv.variant_name,c.config_label) message
    from public.stock_count_session_items i
    join public.product_variants pv on pv.id=i.variant_id
    join public.inventory_stock_configurations c on c.id=i.stock_config_id
    where i.session_id=v_cutoff.stock_count_session_id and i.physical_quantity is null
    union all
    select format('Distributor order %s / %s requires a carry-forward, cancel-and-release, or do-not-carry-forward decision.',
      coalesce(o.display_doc_no,o.order_no),pv.variant_name)
    from public.orders o join public.order_items oi on oi.order_id=o.id
    join public.product_variants pv on pv.id=oi.variant_id
    where o.order_type in ('D2H','S2D') and o.status='submitted'
      and public.order_inventory_organization(o.id)=v_cutoff.warehouse_organization_id
      and exists(select 1 from public.stock_movements sm where sm.reference_id=o.id
        and sm.variant_id=oi.variant_id and sm.movement_type='allocation')
      and not exists(select 1 from public.inventory_cutoff_decisions d
        where d.cutoff_id=v_cutoff.id and d.transaction_kind='distributor' and d.order_item_id=oi.id)
    union all
    select format('Manufacturer order %s / %s requires an incoming decision and valid selected configuration.',
      coalesce(o.display_doc_no,o.order_no),pv.variant_name)
    from public.orders o join public.order_items oi on oi.order_id=o.id
    join public.product_variants pv on pv.id=oi.variant_id
    left join (select order_id,variant_id,sum(received_now)::integer qty from public.warehouse_receipt_items
      group by order_id,variant_id) r on r.order_id=o.id and r.variant_id=oi.variant_id
    where o.order_type='H2M' and o.status in ('approved','closed')
      and public.resolve_order_destination_warehouse(o.buyer_org_id)=v_cutoff.warehouse_organization_id
      and greatest(oi.qty-coalesce(r.qty,0),0)>0
      and not exists(select 1 from public.inventory_cutoff_decisions d
        where d.cutoff_id=v_cutoff.id and d.transaction_kind='manufacturer'
          and d.order_item_id=oi.id and (
            d.decision='history_only' or
            (d.decision='carry_forward_incoming' and oi.stock_config_id is not null)
          ))
    union all
    select format('Manufacturer order %s / %s has duplicate variant lines; outstanding quantity and configuration are ambiguous.',
      coalesce(o.display_doc_no,o.order_no),pv.variant_name)
    from public.orders o join public.order_items oi on oi.order_id=o.id
    join public.product_variants pv on pv.id=oi.variant_id
    where o.order_type='H2M' and o.status in ('approved','closed')
      and public.resolve_order_destination_warehouse(o.buyer_org_id)=v_cutoff.warehouse_organization_id
    group by o.id,o.display_doc_no,o.order_no,pv.id,pv.variant_name
    having count(*)>1
    union all
    select format('Carried allocation exceeds physical opening quantity for %s (%s): physical %s, carried %s.',
      pv.variant_name,c.config_label,i.physical_quantity,sum(d.quantity))
    from public.inventory_cutoff_decisions d
    join public.inventory_stock_configurations c on c.id=d.stock_config_id
    join public.product_variants pv on pv.id=c.variant_id
    join public.stock_count_session_items i on i.session_id=v_cutoff.stock_count_session_id
      and i.stock_config_id=d.stock_config_id and i.variant_id=c.variant_id
    where d.cutoff_id=v_cutoff.id and d.transaction_kind='distributor'
      and d.decision='carry_forward'
    group by pv.variant_name,c.config_label,i.physical_quantity
    having sum(d.quantity)>i.physical_quantity
    union all
    select format('Distributor order %s has mixed carry-forward and cancel decisions. Choose one lifecycle action for every line on the order.',
      coalesce(o.display_doc_no,o.order_no))
    from public.inventory_cutoff_decisions d join public.orders o on o.id=d.order_id
    where d.cutoff_id=v_cutoff.id and d.transaction_kind='distributor'
    group by o.id,o.display_doc_no,o.order_no having count(distinct d.decision)>1
    union all
    select format('Allocation ownership does not reconcile for %s (%s): inventory allocated %s, selected order quantity %s.',
      pv.variant_name,c.config_label,pi.quantity_allocated,coalesce(sum(d.quantity),0))
    from public.product_inventory pi
    join public.inventory_stock_configurations c on c.id=pi.stock_config_id and c.variant_id=pi.variant_id
    join public.product_variants pv on pv.id=pi.variant_id
    left join public.inventory_cutoff_decisions d on d.cutoff_id=v_cutoff.id
      and d.transaction_kind='distributor'
      and exists(select 1 from public.order_items oi where oi.id=d.order_item_id
        and oi.variant_id=pi.variant_id and oi.stock_config_id=pi.stock_config_id)
    where pi.organization_id=v_cutoff.warehouse_organization_id and pi.quantity_allocated>0
    group by pv.variant_name,c.config_label,pi.quantity_allocated
    having pi.quantity_allocated<>coalesce(sum(d.quantity),0)
    union all
    select format('Transfer %s is %s and must be completed or cancelled before cut-off.',t.transfer_no,t.status)
    from public.stock_transfers t where
      (t.from_organization_id=v_cutoff.warehouse_organization_id
        or t.to_organization_id=v_cutoff.warehouse_organization_id)
      and t.status in ('pending','pending_approval','ready_to_dispatch')
    union all
    select format('Return %s is %s and must be completed or cancelled before cut-off.',r.return_no,r.status)
    from public.return_cases r where r.return_warehouse_id=v_cutoff.warehouse_organization_id
      and r.status in ('return_submitted','return_received','return_processing')
    union all
    select format('Stock adjustment %s is %s and must be completed before cut-off.',a.id,a.status)
    from public.stock_adjustments a where a.organization_id=v_cutoff.warehouse_organization_id
      and coalesce(a.status,'completed')<>'completed'
    union all
    select format('Distributor order %s is %s. Approval already posted order_fulfillment, but physical shipment is not confirmed; complete or safely reverse it before restarting cut-off.',
      coalesce(o.display_doc_no,o.order_no),o.status)
    from public.orders o where o.order_type in ('D2H','S2D')
      and o.status in ('approved','warehouse_packed')
      and public.order_inventory_organization(o.id)=v_cutoff.warehouse_organization_id
  ) b;

  select coalesce(jsonb_agg(message),'[]'::jsonb) into v_review from (
    select 'Review stock-in-transit distributor transactions; they are not cancellable by cut-off.' message
    where exists(select 1 from public.orders o where o.order_type in ('D2H','S2D')
      and o.status='shipped_distributor'
      and public.order_inventory_organization(o.id)=v_cutoff.warehouse_organization_id)
    union all
    select 'Another open Stock Count draft must be completed or archived before cut-off.'
    where exists(select 1 from public.stock_count_sessions s
      where s.warehouse_organization_id=v_cutoff.warehouse_organization_id
        and s.status='draft' and s.id<>v_cutoff.stock_count_session_id)
    union all
    select 'A warehouse transfer is in transit. It remains Stock in Transit and is not included in physical opening stock.'
    where exists(select 1 from public.stock_transfers t where
      (t.from_organization_id=v_cutoff.warehouse_organization_id
        or t.to_organization_id=v_cutoff.warehouse_organization_id)
      and t.status='in_transit')
  ) r;

  v_readiness := case when jsonb_array_length(v_blockers)>0 then 'Blocked'
    when jsonb_array_length(v_review)>0 then 'Review Required' else 'Ready' end;
  return jsonb_build_object(
    'cutoff_id',v_cutoff.id,'status',v_cutoff.status,
    'proposed_cutoff_at',v_cutoff.proposed_cutoff_at,
    'warehouse_organization_id',v_cutoff.warehouse_organization_id,
    'company_id',v_cutoff.company_id,'readiness',v_readiness,
    'inventory',v_inventory,'distributor_orders',v_distributor,
    'manufacturer_incoming',v_manufacturer,'warehouse_activity',v_activity,
    'stock_count_drafts',v_drafts,'blockers',v_blockers,'review_items',v_review,
    'freeze_active',v_cutoff.status='counting',
    'qr_status','Protected — No Impact',
    'notice','Preview only — no inventory, order, allocation, or QR data will be changed.'
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.inventory_cutoff_preview_pre_stock_adjustment_eligibility(p_cutoff_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_cutoff public.inventory_opening_cutoffs%rowtype;
  v_session public.stock_count_sessions%rowtype;
  v_category_name text;
  v_report jsonb;
  v_manufacturer jsonb;
  v_non_h2m_blockers jsonb;
  v_h2m_blockers jsonb;
  v_blockers jsonb;
  v_readiness text;
begin
  select * into v_cutoff
  from public.inventory_opening_cutoffs
  where id = p_cutoff_id;
  if not found or not public.can_access_org(v_cutoff.warehouse_organization_id) then
    raise exception 'inventory_cutoff_not_found';
  end if;

  select * into v_session
  from public.stock_count_sessions
  where id = v_cutoff.stock_count_session_id;
  select category_row.category_name into v_category_name
  from public.product_categories category_row
  where category_row.id = v_cutoff.product_category_id
    and category_row.is_active = true;
  if v_session.id is null
     or v_cutoff.product_category_id is null
     or v_session.product_category_id is distinct from v_cutoff.product_category_id
     or v_category_name is null then
    raise exception 'stock_count_active_product_category_required';
  end if;

  v_report := public.inventory_cutoff_preview_h2m_unscoped_legacy(p_cutoff_id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'order_id', scoped.order_id,
    'order_item_id', scoped.order_item_id,
    'order_number', scoped.order_number,
    'status', scoped.status,
    'manufacturer', scoped.manufacturer,
    'variant_id', scoped.variant_id,
    'variant', scoped.variant,
    'ordered_quantity', scoped.ordered_qty,
    'received_quantity', scoped.received_qty,
    'remaining_incoming_quantity', scoped.remaining_qty,
    'stock_config_id', scoped.stock_config_id,
    'stock_configuration', scoped.stock_configuration,
    'decision', scoped.decision,
    'order_created_at', scoped.created_at,
    'order_sequence', scoped.base_seq,
    'product_category_id', scoped.product_category_id,
    'classification', case
      when scoped.decision = 'history_only' then 'History Only'
      when scoped.stock_config_id is null then 'Blocked'
      when scoped.decision = 'carry_forward_incoming' then 'Carry Forward'
      else 'Blocked'
    end
  ) order by
    scoped.created_at desc,
    scoped.base_seq desc nulls last,
    scoped.order_id desc,
    scoped.order_item_id),'[]'::jsonb)
  into v_manufacturer
  from (
    select
      order_row.id order_id,
      order_item.id order_item_id,
      coalesce(order_row.display_doc_no, order_row.order_no) order_number,
      order_row.status,
      manufacturer.org_name manufacturer,
      order_item.variant_id,
      variant.variant_name variant,
      order_item.qty ordered_qty,
      coalesce(receipt.received_qty, 0) received_qty,
      greatest(order_item.qty - coalesce(receipt.received_qty, 0), 0) remaining_qty,
      order_item.stock_config_id,
      config.config_label stock_configuration,
      decision_row.decision,
      order_row.created_at,
      order_row.base_seq,
      product.category_id product_category_id
    from public.orders order_row
    join public.order_items order_item on order_item.order_id = order_row.id
    join public.organizations manufacturer on manufacturer.id = order_row.seller_org_id
    join public.product_variants variant on variant.id = order_item.variant_id
    join public.products product on product.id = variant.product_id
    left join public.inventory_stock_configurations config
      on config.id = order_item.stock_config_id
     and config.variant_id = order_item.variant_id
    left join (
      select receipt_item.order_id, receipt_item.variant_id,
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
    where order_row.order_type = 'H2M'
      and order_row.status in ('approved','closed')
      and public.resolve_order_destination_warehouse(order_row.buyer_org_id) =
          v_cutoff.warehouse_organization_id
      and product.category_id = v_cutoff.product_category_id
  ) scoped
  where scoped.remaining_qty > 0;

  -- Remove the unscoped legacy H2M blocker messages and rebuild them from the
  -- exact same item relation as the displayed/category-scoped list.
  select coalesce(jsonb_agg(blocker.value order by blocker.ordinality), '[]'::jsonb)
  into v_non_h2m_blockers
  from jsonb_array_elements_text(coalesce(v_report->'blockers', '[]'::jsonb))
       with ordinality blocker(value, ordinality)
  where blocker.value not like 'Manufacturer order %';

  select coalesce(jsonb_agg(scoped_blocker.message order by
    scoped_blocker.created_at desc,
    scoped_blocker.base_seq desc nulls last,
    scoped_blocker.order_id desc,
    scoped_blocker.order_item_id desc
  ), '[]'::jsonb)
  into v_h2m_blockers
  from (
    select
      format(
        'Manufacturer order %s / %s requires an incoming decision and valid selected configuration.',
        coalesce(order_row.display_doc_no, order_row.order_no),
        variant.variant_name
      ) message,
      order_row.created_at,
      order_row.base_seq,
      order_row.id order_id,
      order_item.id order_item_id
    from public.orders order_row
    join public.order_items order_item on order_item.order_id = order_row.id
    join public.product_variants variant on variant.id = order_item.variant_id
    join public.products product on product.id = variant.product_id
    left join (
      select receipt_item.order_id, receipt_item.variant_id,
             sum(receipt_item.received_now)::integer qty
      from public.warehouse_receipt_items receipt_item
      group by receipt_item.order_id, receipt_item.variant_id
    ) receipt
      on receipt.order_id = order_row.id
     and receipt.variant_id = order_item.variant_id
    where order_row.order_type = 'H2M'
      and order_row.status in ('approved','closed')
      and public.resolve_order_destination_warehouse(order_row.buyer_org_id) =
          v_cutoff.warehouse_organization_id
      and product.category_id = v_cutoff.product_category_id
      and greatest(order_item.qty - coalesce(receipt.qty, 0), 0) > 0
      and not exists (
        select 1
        from public.inventory_cutoff_decisions decision_row
        where decision_row.cutoff_id = v_cutoff.id
          and decision_row.transaction_kind = 'manufacturer'
          and decision_row.order_item_id = order_item.id
          and (
            decision_row.decision = 'history_only'
            or (
              decision_row.decision = 'carry_forward_incoming'
              and order_item.stock_config_id is not null
            )
          )
      )
    union all
    select
      format(
        'Manufacturer order %s / %s has duplicate variant lines; outstanding quantity and configuration are ambiguous.',
        coalesce(order_row.display_doc_no, order_row.order_no),
        variant.variant_name
      ) message,
      order_row.created_at,
      order_row.base_seq,
      order_row.id order_id,
      min(order_item.id::text)::uuid order_item_id
    from public.orders order_row
    join public.order_items order_item on order_item.order_id = order_row.id
    join public.product_variants variant on variant.id = order_item.variant_id
    join public.products product on product.id = variant.product_id
    where order_row.order_type = 'H2M'
      and order_row.status in ('approved','closed')
      and public.resolve_order_destination_warehouse(order_row.buyer_org_id) =
          v_cutoff.warehouse_organization_id
      and product.category_id = v_cutoff.product_category_id
    group by
      order_row.id, order_row.display_doc_no, order_row.order_no,
      order_row.created_at, order_row.base_seq, variant.id, variant.variant_name
    having count(*) > 1
  ) scoped_blocker;

  v_blockers := v_non_h2m_blockers || v_h2m_blockers;
  v_readiness := case
    when jsonb_array_length(v_blockers) > 0 then 'Blocked'
    when jsonb_array_length(coalesce(v_report->'review_items', '[]'::jsonb)) > 0
      then 'Review Required'
    else 'Ready'
  end;

  return v_report || jsonb_build_object(
    'product_category_id', v_cutoff.product_category_id,
    'product_category_name', v_category_name,
    'manufacturer_incoming', v_manufacturer,
    'blockers', v_blockers,
    'readiness', v_readiness
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.inventory_cutoff_preview_pre_stock_adjustment_detail(p_cutoff_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.inventory_cutoff_preview_pre_d2h_policy(p_cutoff_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.inventory_cutoff_preview_pre_h2m_policy(p_cutoff_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_cutoff public.inventory_opening_cutoffs%rowtype;
  v_policy public.inventory_cutoff_d2h_policies%rowtype;
  v_report jsonb;
  v_distributor jsonb;
  v_blockers jsonb;
  v_non_d2h_blockers jsonb;
  v_d2h_blockers jsonb;
  v_readiness text;
  v_boundary timestamptz;
  v_has_policy boolean := false;
begin
  select * into v_cutoff
  from public.inventory_opening_cutoffs
  where id = p_cutoff_id;
  if not found or not public.can_access_org(v_cutoff.warehouse_organization_id) then
    raise exception 'inventory_cutoff_not_found';
  end if;

  v_boundary := coalesce(v_cutoff.posted_at, v_cutoff.proposed_cutoff_at);
  select * into v_policy
  from public.inventory_cutoff_d2h_policies
  where cutoff_id = p_cutoff_id;
  v_has_policy := found;

  v_report := public.inventory_cutoff_preview_pre_d2h_policy(p_cutoff_id);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'order_id', scoped.order_id,
      'order_item_id', scoped.order_item_id,
      'order_number', scoped.order_number,
      'status', scoped.status,
      'customer', scoped.customer,
      'warehouse', scoped.warehouse,
      'variant_id', scoped.variant_id,
      'variant', scoped.variant_name,
      'quantity', scoped.quantity,
      'order_created_at', scoped.order_created_at,
      'product_category_id', scoped.product_category_id,
      'decision', scoped.decision,
      'carry_stock_config_id', scoped.carry_stock_config_id,
      'has_active_allocation', scoped.has_active_allocation,
      'has_order_fulfillment', scoped.has_order_fulfillment,
      'classification', case
        when scoped.status = 'submitted' and scoped.decision = 'carry_forward'
          then 'Carry Forward'
        when scoped.status = 'submitted' and scoped.decision = 'cancel_release'
          then 'Cancel & Release'
        when scoped.status = 'submitted' and scoped.decision = 'do_not_carry_forward'
          then 'Do Not Carry Forward'
        when scoped.status = 'shipped_distributor' then 'Stock in Transit'
        when scoped.status in ('closed', 'cancelled') then 'History Only'
        when v_has_policy and v_policy.policy = 'exclude_all'
          then 'Historical Excluded'
        when v_has_policy and v_policy.policy = 'review_select'
             and scoped.order_id = any(v_policy.excluded_order_ids)
          then 'Historical Excluded'
        when scoped.status = 'submitted' and scoped.decision is null
          then 'Blocked'
        when scoped.status in ('approved', 'warehouse_packed')
          then 'Complete Before Cut-off'
        else 'Complete Before Cut-off'
      end,
      'available_actions', case
        when not v_has_policy then jsonb_build_array(
          'Start Fresh — Exclude All Existing D2H Orders',
          'Review Orders to Carry Into New Inventory'
        )
        when v_policy.policy = 'review_select'
             and scoped.status = 'submitted'
             and scoped.has_active_allocation
          then jsonb_build_array(
            'Carry Into New Inventory',
            'Keep as Historical'
          )
        else '[]'::jsonb
      end
    )
    order by scoped.order_created_at, scoped.order_id, scoped.order_item_id
  ), '[]'::jsonb)
  into v_distributor
  from public.inventory_cutoff_d2h_scoped_orders(p_cutoff_id) scoped;

  -- Strip legacy D2H blockers; rebuild from policy + scoped universe.
  select coalesce(jsonb_agg(blocker.value order by blocker.ordinality), '[]'::jsonb)
  into v_non_d2h_blockers
  from jsonb_array_elements_text(coalesce(v_report->'blockers', '[]'::jsonb))
       with ordinality blocker(value, ordinality)
  where blocker.value not like 'Distributor order %'
    and blocker.value not like 'Allocation ownership does not reconcile for %'
    and blocker.value not like 'Carried allocation exceeds physical opening quantity for %';

  select coalesce(jsonb_agg(message order by sort_key), '[]'::jsonb)
  into v_d2h_blockers
  from (
    select
      'A D2H policy is required before Opening Balance can be posted. Choose Start Fresh or Review Orders.' as message,
      0 as sort_key
    where not v_has_policy
      and exists (select 1 from public.inventory_cutoff_d2h_scoped_orders(p_cutoff_id) limit 1)

    union all

    select
      format(
        'Distributor order %s / %s requires a Carry Into New Inventory or Keep as Historical decision.',
        scoped.order_number, scoped.variant_name
      ) as message,
      1 as sort_key
    from public.inventory_cutoff_d2h_scoped_orders(p_cutoff_id) scoped
    where v_has_policy
      and v_policy.policy = 'review_select'
      and scoped.status = 'submitted'
      and scoped.has_active_allocation
      and scoped.decision is null

    union all

    select
      format(
        'Carried allocation exceeds physical opening quantity for %s (%s): physical %s, carried %s.',
        pv.variant_name, c.config_label, i.physical_quantity, sum(d.quantity)
      ) as message,
      2 as sort_key
    from public.inventory_cutoff_decisions d
    join public.inventory_stock_configurations c on c.id = d.stock_config_id
    join public.product_variants pv on pv.id = c.variant_id
    join public.products p on p.id = pv.product_id
    join public.stock_count_session_items i
      on i.session_id = v_cutoff.stock_count_session_id
     and i.stock_config_id = d.stock_config_id
     and i.variant_id = c.variant_id
    where d.cutoff_id = v_cutoff.id
      and d.transaction_kind = 'distributor'
      and d.decision = 'carry_forward'
      and p.category_id = v_cutoff.product_category_id
    group by pv.variant_name, c.config_label, i.physical_quantity
    having sum(d.quantity) > i.physical_quantity

    union all

    -- Category-scoped allocation ownership only (Pet Food must not block Vape).
    select
      format(
        'Allocation ownership does not reconcile for %s (%s): inventory allocated %s, selected order quantity %s.',
        pv.variant_name, c.config_label, pi.quantity_allocated, coalesce(sum(d.quantity), 0)
      ) as message,
      3 as sort_key
    from public.product_inventory pi
    join public.inventory_stock_configurations c
      on c.id = pi.stock_config_id and c.variant_id = pi.variant_id
    join public.product_variants pv on pv.id = pi.variant_id
    join public.products p on p.id = pv.product_id
    left join public.inventory_cutoff_decisions d
      on d.cutoff_id = v_cutoff.id
     and d.transaction_kind = 'distributor'
     and exists (
       select 1 from public.order_items oi
       where oi.id = d.order_item_id
         and oi.variant_id = pi.variant_id
         and oi.stock_config_id = pi.stock_config_id
     )
    where pi.organization_id = v_cutoff.warehouse_organization_id
      and pi.quantity_allocated > 0
      and p.category_id = v_cutoff.product_category_id
    group by pv.variant_name, c.config_label, pi.quantity_allocated
    having pi.quantity_allocated <> coalesce(sum(d.quantity), 0)

    union all

    -- Under fresh-baseline exclude_all, approved/packed pre-boundary D2H are
    -- historical excluded — never hard blockers. Without a policy they remain
    -- reported so operators choose a policy first.
    select
      format(
        'Distributor order %s is %s. Approval already posted order_fulfillment, but physical shipment is not confirmed; complete or safely reverse it before restarting cut-off.',
        scoped.order_number, scoped.status
      ) as message,
      4 as sort_key
    from public.inventory_cutoff_d2h_scoped_orders(p_cutoff_id) scoped
    where scoped.status in ('approved', 'warehouse_packed')
      and not (
        v_has_policy and v_policy.policy in ('exclude_all', 'review_select')
      )
  ) rebuilt;

  v_blockers := v_non_d2h_blockers || v_d2h_blockers;
  v_readiness := case
    when jsonb_array_length(v_blockers) > 0 then 'Blocked'
    when jsonb_array_length(coalesce(v_report->'review_items', '[]'::jsonb)) > 0
      then 'Review Required'
    else 'Ready'
  end;

  return v_report || jsonb_build_object(
    'distributor_orders', v_distributor,
    'blockers', v_blockers,
    'readiness', v_readiness,
    'cutoff_boundary_at', v_boundary,
    'd2h_policy', case when v_has_policy then jsonb_build_object(
      'policy', v_policy.policy,
      'boundary_at', v_policy.boundary_at,
      'warehouse_organization_id', v_policy.warehouse_organization_id,
      'company_id', v_policy.company_id,
      'product_category_id', v_policy.product_category_id,
      'eligible_order_count', v_policy.eligible_order_count,
      'eligible_item_count', v_policy.eligible_item_count,
      'eligible_quantity', v_policy.eligible_quantity,
      'selected_order_count', v_policy.selected_order_count,
      'selected_item_count', v_policy.selected_item_count,
      'selected_quantity', v_policy.selected_quantity,
      'excluded_order_count', v_policy.excluded_order_count,
      'excluded_item_count', v_policy.excluded_item_count,
      'excluded_quantity', v_policy.excluded_quantity,
      'eligible_order_ids', to_jsonb(v_policy.eligible_order_ids),
      'selected_order_ids', to_jsonb(v_policy.selected_order_ids),
      'excluded_order_ids', to_jsonb(v_policy.excluded_order_ids),
      'decided_by', v_policy.decided_by,
      'decided_at', v_policy.decided_at,
      'confirmation_fingerprint', v_policy.confirmation_fingerprint,
      'orders_cancelled', false,
      'historical_movements_reversed', false,
      'qr_impact', 'none'
    ) else null end,
    'd2h_historical_summary', jsonb_build_object(
      'order_count', coalesce((
        select count(distinct order_id)::integer
        from public.inventory_cutoff_d2h_scoped_orders(p_cutoff_id) scoped
        where v_has_policy and (
          (v_policy.policy = 'exclude_all')
          or (v_policy.policy = 'review_select'
              and scoped.order_id = any(v_policy.excluded_order_ids))
          or scoped.decision = 'do_not_carry_forward'
          or scoped.status in ('closed', 'cancelled', 'approved', 'warehouse_packed')
        )
      ), 0),
      'item_count', coalesce((
        select count(*)::integer
        from public.inventory_cutoff_d2h_scoped_orders(p_cutoff_id) scoped
        where v_has_policy and (
          (v_policy.policy = 'exclude_all')
          or (v_policy.policy = 'review_select'
              and scoped.order_id = any(v_policy.excluded_order_ids))
          or scoped.decision = 'do_not_carry_forward'
          or scoped.status in ('closed', 'cancelled', 'approved', 'warehouse_packed')
        )
      ), 0),
      'ordered_quantity', coalesce((
        select sum(quantity)::integer
        from public.inventory_cutoff_d2h_scoped_orders(p_cutoff_id) scoped
        where v_has_policy and (
          (v_policy.policy = 'exclude_all')
          or (v_policy.policy = 'review_select'
              and scoped.order_id = any(v_policy.excluded_order_ids))
          or scoped.decision = 'do_not_carry_forward'
          or scoped.status in ('closed', 'cancelled', 'approved', 'warehouse_packed')
        )
      ), 0),
      'orders_cancelled', false,
      'historical_stock_returned', false,
      'notice', case
        when v_has_policy and v_policy.policy = 'exclude_all' then
          format(
            '%s historical D2H orders will be excluded from the new inventory baseline. Order history and reporting remain unchanged.',
            v_policy.eligible_order_count
          )
        when v_has_policy then
          format(
            '%s historical D2H orders remain excluded from the new inventory baseline.',
            v_policy.excluded_order_count
          )
        else null
      end
    )
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.inventory_cutoff_preview_pre_transactions_policy(p_cutoff_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_cutoff public.inventory_opening_cutoffs%rowtype;
  v_policy public.inventory_cutoff_h2m_policies%rowtype;
  v_report jsonb;
  v_manufacturer jsonb;
  v_blockers jsonb;
  v_non_h2m_blockers jsonb;
  v_h2m_blockers jsonb;
  v_readiness text;
  v_has_policy boolean := false;
begin
  select * into v_cutoff
  from public.inventory_opening_cutoffs
  where id = p_cutoff_id;
  if not found or not public.can_access_org(v_cutoff.warehouse_organization_id) then
    raise exception 'inventory_cutoff_not_found';
  end if;

  select * into v_policy
  from public.inventory_cutoff_h2m_policies
  where cutoff_id = p_cutoff_id;
  v_has_policy := found;

  v_report := public.inventory_cutoff_preview_pre_h2m_policy(p_cutoff_id);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'order_id', scoped.order_id,
      'order_item_id', scoped.order_item_id,
      'order_number', scoped.order_number,
      'status', scoped.status,
      'manufacturer', scoped.manufacturer,
      'warehouse', scoped.warehouse,
      'variant_id', scoped.variant_id,
      'variant', scoped.variant_name,
      'ordered_quantity', scoped.ordered_quantity,
      'received_quantity', scoped.received_before_boundary,
      'remaining_incoming_quantity', scoped.remaining_incoming_quantity,
      'order_created_at', scoped.order_created_at,
      'product_category_id', scoped.product_category_id,
      'decision', scoped.decision,
      'stock_config_id', scoped.stock_config_id,
      'stock_configuration', null,
      'classification', case
        when scoped.decision = 'carry_forward_incoming' then 'Carry Forward'
        when scoped.decision = 'history_only' then 'History Only'
        when v_has_policy and v_policy.policy = 'exclude_all' then 'Historical Excluded'
        when v_has_policy and v_policy.policy = 'review_select'
             and scoped.order_id = any(v_policy.excluded_order_ids)
          then 'Historical Excluded'
        when scoped.decision is null then 'Blocked'
        else 'Blocked'
      end,
      'available_actions', case
        when not v_has_policy then jsonb_build_array(
          'Start Fresh — Exclude All Existing H2M Orders',
          'Review Orders Expected After Cut-off'
        )
        when v_policy.policy = 'review_select' then jsonb_build_array(
          'Expected Incoming After Cut-off',
          'Keep as Historical'
        )
        else '[]'::jsonb
      end
    )
    order by scoped.order_created_at, scoped.order_id, scoped.order_item_id
  ), '[]'::jsonb)
  into v_manufacturer
  from public.inventory_cutoff_h2m_scoped_orders(p_cutoff_id) scoped;

  -- Strip legacy H2M per-item blockers; rebuild from policy authority.
  select coalesce(jsonb_agg(blocker.value order by blocker.ordinality), '[]'::jsonb)
  into v_non_h2m_blockers
  from jsonb_array_elements_text(coalesce(v_report->'blockers', '[]'::jsonb))
       with ordinality blocker(value, ordinality)
  where blocker.value not like 'Manufacturer order %'
    and blocker.value not like 'H2M order %'
    and blocker.value not like 'An H2M policy is required%'
    and blocker.value not like '%requires a Carry Forward as Incoming%'
    and blocker.value not like '%requires an Incoming After Cut-off%'
    and blocker.value not like '%History Only — no receiving%';

  select coalesce(jsonb_agg(message order by sort_key), '[]'::jsonb)
  into v_h2m_blockers
  from (
    select
      'An H2M policy is required before Opening Balance can be posted. Choose Start Fresh or Review Orders Expected After Cut-off.' as message,
      0 as sort_key
    where not v_has_policy
      and exists (select 1 from public.inventory_cutoff_h2m_scoped_orders(p_cutoff_id) limit 1)

    union all

    select
      format(
        'Manufacturer order %s / %s requires an Expected Incoming or Keep as Historical decision under the saved H2M Review policy.',
        scoped.order_number, scoped.variant_name
      ) as message,
      1 as sort_key
    from public.inventory_cutoff_h2m_scoped_orders(p_cutoff_id) scoped
    where v_has_policy
      and v_policy.policy = 'review_select'
      and scoped.decision is null
  ) messages;

  v_blockers := coalesce(v_non_h2m_blockers, '[]'::jsonb) || coalesce(v_h2m_blockers, '[]'::jsonb);

  if jsonb_array_length(v_blockers) > 0 then
    v_readiness := 'Blocked';
  else
    v_readiness := coalesce(v_report->>'readiness', 'Ready');
    if v_readiness = 'Blocked' then
      v_readiness := 'Ready';
    end if;
  end if;

  return v_report || jsonb_build_object(
    'readiness', v_readiness,
    'blockers', v_blockers,
    'manufacturer_incoming', v_manufacturer,
    'h2m_policy', case when v_has_policy then jsonb_build_object(
      'policy', v_policy.policy,
      'boundary_at', v_policy.boundary_at,
      'warehouse_organization_id', v_policy.warehouse_organization_id,
      'company_id', v_policy.company_id,
      'product_category_id', v_policy.product_category_id,
      'eligible_order_count', v_policy.eligible_order_count,
      'eligible_item_count', v_policy.eligible_item_count,
      'eligible_quantity', v_policy.eligible_outstanding_quantity,
      'eligible_ordered_quantity', v_policy.eligible_ordered_quantity,
      'eligible_received_before_boundary', v_policy.eligible_received_before_boundary,
      'eligible_outstanding_quantity', v_policy.eligible_outstanding_quantity,
      'selected_order_count', v_policy.selected_order_count,
      'selected_item_count', v_policy.selected_item_count,
      'selected_quantity', v_policy.selected_outstanding_quantity,
      'selected_ordered_quantity', v_policy.selected_ordered_quantity,
      'selected_received_before_boundary', v_policy.selected_received_before_boundary,
      'selected_outstanding_quantity', v_policy.selected_outstanding_quantity,
      'excluded_order_count', v_policy.excluded_order_count,
      'excluded_item_count', v_policy.excluded_item_count,
      'excluded_quantity', v_policy.excluded_outstanding_quantity,
      'excluded_ordered_quantity', v_policy.excluded_ordered_quantity,
      'excluded_received_before_boundary', v_policy.excluded_received_before_boundary,
      'excluded_outstanding_quantity', v_policy.excluded_outstanding_quantity,
      'eligible_order_ids', to_jsonb(v_policy.eligible_order_ids),
      'selected_order_ids', to_jsonb(v_policy.selected_order_ids),
      'excluded_order_ids', to_jsonb(v_policy.excluded_order_ids),
      'decided_by', v_policy.decided_by,
      'decided_at', v_policy.decided_at,
      'confirmation_fingerprint', v_policy.confirmation_fingerprint,
      'orders_cancelled', false,
      'inventory_added', false,
      'historical_movements_reversed', false,
      'qr_impact', 'none'
    ) else null end,
    'h2m_historical_summary', jsonb_build_object(
      'order_count', case when v_has_policy then
        case when v_policy.policy = 'exclude_all' then v_policy.eligible_order_count
             else v_policy.excluded_order_count end
        else 0 end,
      'item_count', case when v_has_policy then
        case when v_policy.policy = 'exclude_all' then v_policy.eligible_item_count
             else v_policy.excluded_item_count end
        else 0 end,
      'ordered_quantity', case when v_has_policy then
        case when v_policy.policy = 'exclude_all' then v_policy.eligible_ordered_quantity
             else v_policy.excluded_ordered_quantity end
        else 0 end,
      'received_before_boundary', case when v_has_policy then
        case when v_policy.policy = 'exclude_all' then v_policy.eligible_received_before_boundary
             else v_policy.excluded_received_before_boundary end
        else 0 end,
      'outstanding_quantity', case when v_has_policy then
        case when v_policy.policy = 'exclude_all' then v_policy.eligible_outstanding_quantity
             else v_policy.excluded_outstanding_quantity end
        else 0 end,
      'orders_cancelled', false,
      'inventory_added', false,
      'notice', case
        when v_has_policy and v_policy.policy = 'exclude_all' then
          format(
            '%s historical H2M orders will be excluded from expected incoming. Opening Balance posting adds zero H2M quantity.',
            v_policy.eligible_order_count
          )
        when v_has_policy then
          format(
            '%s historical H2M orders remain excluded from expected incoming.',
            v_policy.excluded_order_count
          )
        else null
      end
    )
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.inventory_cutoff_preview_pre_blocker_details(p_cutoff_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_cutoff public.inventory_opening_cutoffs%rowtype;
  v_policy public.inventory_cutoff_transactions_policies%rowtype;
  v_has_policy boolean := false;
  v_report jsonb;
  v_activity jsonb;
  v_kept_blockers jsonb;
  v_tx_blockers jsonb;
  v_blockers jsonb;
  v_readiness text;
  v_eligible_count integer := 0;
  v_blocked_count integer := 0;
begin
  select * into v_cutoff from public.inventory_opening_cutoffs where id = p_cutoff_id;
  if not found or not public.can_access_org(v_cutoff.warehouse_organization_id) then
    raise exception 'inventory_cutoff_not_found';
  end if;

  select * into v_policy
  from public.inventory_cutoff_transactions_policies
  where cutoff_id = p_cutoff_id;
  v_has_policy := found;

  v_report := public.inventory_cutoff_preview_pre_transactions_policy(p_cutoff_id);

  select
    count(*) filter (where eligibility = 'eligible'),
    count(*) filter (where eligibility = 'requires_resolution')
  into v_eligible_count, v_blocked_count
  from public.inventory_cutoff_transactions_scoped(p_cutoff_id);

  -- Rebuild warehouse_activity with typed, policy-aware classification.
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'movement_type', scoped.transaction_type,
      'reference_type', case scoped.transaction_type
        when 'stock_adjustment' then 'adjustment'
        when 'return' then 'return'
        else 'transfer' end,
      'reference_no', scoped.reference_no,
      'reference_id', scoped.transaction_id,
      'status', scoped.status,
      'quantity', scoped.document_quantity,
      'line_count', scoped.line_count,
      'occurred_at', scoped.occurred_at,
      'latest_stage', scoped.latest_stage,
      'remaining_action', scoped.remaining_action,
      'expected_event', scoped.expected_event,
      'eligibility', scoped.eligibility,
      'blocker_reason', scoped.blocker_reason,
      'required_action', case
        when scoped.eligibility = 'requires_resolution' then 'Resolve individually'
        else 'Governed by Transactions policy' end,
      'classification', case
        when scoped.eligibility = 'requires_resolution' then 'Requires Individual Resolution'
        when not v_has_policy then 'Complete Before Cut-off'
        when v_policy.policy = 'exclude_all' then 'Historical Excluded'
        when v_policy.policy = 'carry_forward_all' then 'Carry Forward'
        when scoped.transaction_type = 'stock_adjustment'
             and scoped.transaction_id = any(v_policy.carried_adjustment_ids) then 'Carry Forward'
        when scoped.transaction_type = 'return'
             and scoped.transaction_id = any(v_policy.carried_return_ids) then 'Carry Forward'
        when scoped.transaction_type = 'stock_transfer'
             and scoped.transaction_id = any(v_policy.carried_transfer_ids) then 'Carry Forward'
        else 'Historical Excluded' end
    )
    order by scoped.occurred_at desc nulls last, scoped.transaction_id
  ), '[]'::jsonb)
  into v_activity
  from public.inventory_cutoff_transactions_scoped(p_cutoff_id) scoped;

  -- Strip legacy per-transaction blockers; keep everything else (D2H/H2M/count).
  select coalesce(jsonb_agg(blocker.value order by blocker.ordinality), '[]'::jsonb)
  into v_kept_blockers
  from jsonb_array_elements_text(coalesce(v_report->'blockers', '[]'::jsonb))
       with ordinality blocker(value, ordinality)
  where blocker.value not like 'Stock adjustment %'
    and blocker.value not like 'Transfer %must be completed or cancelled%'
    and blocker.value not like 'Return %must be completed or cancelled%';

  -- Rebuild transaction blockers from genuine Requires-Individual-Resolution set
  -- plus the "save a policy first" gate.
  select coalesce(jsonb_agg(message order by sort_key, message), '[]'::jsonb)
  into v_tx_blockers
  from (
    select
      'A Transactions policy is required before Opening Balance can be posted. Choose Start Fresh, Carry Forward All, or Review Transactions.' as message,
      0 as sort_key
    where not v_has_policy and v_eligible_count > 0

    union all

    select
      format(
        '%s %s (%s) requires individual resolution: %s',
        case scoped.transaction_type
          when 'stock_adjustment' then 'Stock adjustment'
          when 'return' then 'Return'
          else 'Transfer' end,
        coalesce(scoped.reference_no, to_char(scoped.occurred_at at time zone 'UTC', 'DD Mon YYYY, HH24:MI')),
        scoped.status,
        scoped.blocker_reason
      ) as message,
      1 as sort_key
    from public.inventory_cutoff_transactions_scoped(p_cutoff_id) scoped
    where scoped.eligibility = 'requires_resolution'
  ) rebuilt;

  v_blockers := v_kept_blockers || v_tx_blockers;
  v_readiness := case
    when jsonb_array_length(v_blockers) > 0 then 'Blocked'
    when jsonb_array_length(coalesce(v_report->'review_items', '[]'::jsonb)) > 0 then 'Review Required'
    else 'Ready'
  end;

  return v_report || jsonb_build_object(
    'warehouse_activity', v_activity,
    'blockers', v_blockers,
    'readiness', v_readiness,
    'transactions_policy', case when v_has_policy then jsonb_build_object(
      'policy', v_policy.policy,
      'boundary_at', v_policy.boundary_at,
      'warehouse_organization_id', v_policy.warehouse_organization_id,
      'company_id', v_policy.company_id,
      'product_category_id', v_policy.product_category_id,
      'eligible_count', v_policy.eligible_count,
      'carried_count', v_policy.carried_count,
      'excluded_count', v_policy.excluded_count,
      'blocked_count', v_policy.blocked_count,
      'carried_adjustment_ids', to_jsonb(v_policy.carried_adjustment_ids),
      'carried_return_ids', to_jsonb(v_policy.carried_return_ids),
      'carried_transfer_ids', to_jsonb(v_policy.carried_transfer_ids),
      'excluded_adjustment_ids', to_jsonb(v_policy.excluded_adjustment_ids),
      'excluded_return_ids', to_jsonb(v_policy.excluded_return_ids),
      'excluded_transfer_ids', to_jsonb(v_policy.excluded_transfer_ids),
      'carried_refs', v_policy.carried_refs,
      'excluded_refs', v_policy.excluded_refs,
      'eligible_refs', v_policy.eligible_refs,
      'decided_by', v_policy.decided_by,
      'decided_at', v_policy.decided_at,
      'confirmation_fingerprint', v_policy.confirmation_fingerprint,
      'inventory_impact', 0,
      'transactions_cancelled', false,
      'stock_movements_created', false,
      'qr_impact', 'none'
    ) else null end,
    'transactions_historical_summary', jsonb_build_object(
      'eligible_count', v_eligible_count,
      'carried_count', case when v_has_policy then v_policy.carried_count else 0 end,
      'excluded_count', case when v_has_policy then v_policy.excluded_count else 0 end,
      'blocked_count', v_blocked_count,
      'inventory_impact', 0,
      'transactions_cancelled', false,
      'notice', case
        when not v_has_policy then null
        when v_policy.policy = 'exclude_all' then format(
          '%s eligible transactions excluded from the new inventory baseline. Records preserved for audit.', v_policy.excluded_count)
        when v_policy.policy = 'carry_forward_all' then format(
          '%s eligible transactions carried forward under their existing lifecycle.', v_policy.carried_count)
        else format(
          '%s carried forward; %s historical excluded.', v_policy.carried_count, v_policy.excluded_count)
      end
    )
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.verify_and_post_inventory_opening_cutoff_pre_transactions_polic(p_request_id uuid, p_code_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '300s'
 SET lock_timeout TO '30s'
AS $function$
declare
  v_user uuid := auth.uid();
  v_cutoff_id uuid;
  v_warehouse_id uuid;
  v_session_id uuid;
  v_category_id uuid;
  v_session_category_id uuid;
  v_d2h_policy public.inventory_cutoff_d2h_policies%rowtype;
  v_h2m_policy public.inventory_cutoff_h2m_policies%rowtype;
  v_resolution record;
  v_has_d2h boolean := false;
  v_has_h2m boolean := false;
begin
  if v_user is null or not public.inventory_cutoff_is_hq_admin() then
    raise exception 'permission_denied';
  end if;

  select
    cutoff.id,
    cutoff.warehouse_organization_id,
    cutoff.stock_count_session_id,
    cutoff.product_category_id,
    session_row.product_category_id
  into
    v_cutoff_id,
    v_warehouse_id,
    v_session_id,
    v_category_id,
    v_session_category_id
  from public.stock_count_verification_requests request_row
  join public.inventory_opening_cutoffs cutoff
    on cutoff.stock_count_session_id = request_row.session_id
  join public.stock_count_sessions session_row
    on session_row.id = cutoff.stock_count_session_id
  where request_row.id = p_request_id
    and request_row.requesting_user_id = v_user;

  if v_cutoff_id is not null then
    if v_category_id is null
       or v_session_category_id is distinct from v_category_id
       or not exists (
         select 1 from public.product_categories category_row
         where category_row.id = v_category_id
           and category_row.is_active = true
       ) then
      raise exception 'stock_count_active_product_category_required';
    end if;

    select * into v_d2h_policy
    from public.inventory_cutoff_d2h_policies
    where cutoff_id = v_cutoff_id;
    v_has_d2h := found;
    if not v_has_d2h then
      if exists (
        select 1 from public.inventory_cutoff_d2h_scoped_orders(v_cutoff_id) limit 1
      ) then
        raise exception 'inventory_cutoff_d2h_policy_required';
      end if;
    else
      if v_d2h_policy.product_category_id is distinct from v_category_id
         or v_d2h_policy.warehouse_organization_id is distinct from v_warehouse_id then
        raise exception 'inventory_cutoff_d2h_policy_scope_mismatch';
      end if;
    end if;

    select * into v_h2m_policy
    from public.inventory_cutoff_h2m_policies
    where cutoff_id = v_cutoff_id;
    v_has_h2m := found;
    if not v_has_h2m then
      if exists (
        select 1 from public.inventory_cutoff_h2m_scoped_orders(v_cutoff_id) limit 1
      ) then
        raise exception 'inventory_cutoff_h2m_policy_required';
      end if;
    else
      if v_h2m_policy.product_category_id is distinct from v_category_id
         or v_h2m_policy.warehouse_organization_id is distinct from v_warehouse_id then
        raise exception 'inventory_cutoff_h2m_policy_scope_mismatch';
      end if;

      -- Authoritative revalidation of the saved H2M policy set.
      if v_h2m_policy.policy = 'exclude_all' then
        if exists (
          select 1 from public.inventory_cutoff_decisions d
          where d.cutoff_id = v_cutoff_id
            and d.transaction_kind = 'manufacturer'
            and d.decision = 'carry_forward_incoming'
        ) then
          raise exception 'inventory_cutoff_h2m_policy_stale_incoming';
        end if;
        if cardinality(v_h2m_policy.selected_order_ids) <> 0 then
          raise exception 'inventory_cutoff_h2m_policy_stale_incoming';
        end if;
      else
        if exists (
          select 1 from public.inventory_cutoff_decisions d
          where d.cutoff_id = v_cutoff_id
            and d.transaction_kind = 'manufacturer'
            and d.decision = 'carry_forward_incoming'
            and d.order_id <> all(v_h2m_policy.selected_order_ids)
        ) then
          raise exception 'inventory_cutoff_h2m_policy_stale_incoming';
        end if;
      end if;
    end if;

    if exists (
      select 1
      from public.inventory_cutoff_decisions decision_row
      join public.order_items order_item
        on order_item.id = decision_row.order_item_id
      join public.product_variants variant
        on variant.id = order_item.variant_id
      join public.products product
        on product.id = variant.product_id
      where decision_row.cutoff_id = v_cutoff_id
        and decision_row.transaction_kind in ('distributor', 'manufacturer')
        and product.category_id is distinct from v_category_id
    ) then
      raise exception 'inventory_cutoff_product_category_scope_mismatch';
    end if;

    if exists (
      select 1
      from public.product_inventory pi
      join public.product_variants pv on pv.id = pi.variant_id
      join public.products p on p.id = pv.product_id
      where pi.organization_id = v_warehouse_id
        and pi.quantity_allocated > 0
        and p.category_id = v_category_id
        and pi.quantity_allocated <> coalesce((
          select sum(d.quantity)
          from public.inventory_cutoff_decisions d
          join public.order_items oi on oi.id = d.order_item_id
          where d.cutoff_id = v_cutoff_id
            and d.transaction_kind = 'distributor'
            and oi.variant_id = pi.variant_id
            and oi.stock_config_id = pi.stock_config_id
        ), 0)
    ) then
      raise exception 'inventory_cutoff_allocation_owner_unresolved';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(
      'inventory-opening-cutoff:' || v_warehouse_id::text, 0
    ));
    perform 1
    from public.product_inventory inventory_row
    where inventory_row.organization_id = v_warehouse_id
    order by inventory_row.stock_config_id
    for update;
    perform 1
    from public.stock_count_session_scope scope_row
    where scope_row.session_id = v_session_id
    order by scope_row.stock_config_id
    for share;
    perform 1
    from public.inventory_stock_configurations config
    join public.stock_count_session_scope scope_row
      on scope_row.stock_config_id = config.id
    where scope_row.session_id = v_session_id
    order by config.id
    for share of config, scope_row;
    perform 1
    from public.orders order_row
    where exists (
      select 1 from public.inventory_cutoff_decisions decision_row
      where decision_row.cutoff_id = v_cutoff_id
        and decision_row.order_id = order_row.id
        and decision_row.decision in ('carry_forward', 'carry_forward_incoming')
    )
    order by order_row.id
    for update;
    perform 1
    from public.order_items order_item
    where exists (
      select 1 from public.inventory_cutoff_decisions decision_row
      where decision_row.cutoff_id = v_cutoff_id
        and decision_row.order_item_id = order_item.id
        and decision_row.transaction_kind = 'manufacturer'
        and decision_row.decision = 'carry_forward_incoming'
    )
    order by order_item.id
    for update;
  end if;

  for v_resolution in
    select resolution.*
    from public.inventory_cutoff_decisions decision_row
    cross join lateral public.resolve_inventory_cutoff_d2h_carry_forward(
      decision_row.cutoff_id, array[decision_row.order_item_id]
    ) resolution
    where decision_row.cutoff_id = v_cutoff_id
      and decision_row.transaction_kind = 'distributor'
      and decision_row.decision = 'carry_forward'
    order by decision_row.order_id, decision_row.order_item_id
  loop
    if not v_resolution.eligible then
      raise exception using message = v_resolution.reason_code;
    end if;
    if v_resolution.stock_config_id is distinct from (
      select decision_row.stock_config_id
      from public.inventory_cutoff_decisions decision_row
      where decision_row.cutoff_id = v_cutoff_id
        and decision_row.order_item_id = v_resolution.order_item_id
        and decision_row.transaction_kind = 'distributor'
    ) then
      raise exception 'inventory_cutoff_stale_preflight_data';
    end if;
  end loop;

  for v_resolution in
    select resolution.*
    from public.inventory_cutoff_decisions decision_row
    cross join lateral public.resolve_inventory_cutoff_h2m_incoming(
      decision_row.cutoff_id, array[decision_row.order_item_id]
    ) resolution
    where decision_row.cutoff_id = v_cutoff_id
      and decision_row.transaction_kind = 'manufacturer'
      and decision_row.decision = 'carry_forward_incoming'
    order by decision_row.order_id, decision_row.order_item_id
  loop
    if not v_resolution.eligible then
      raise exception using message = v_resolution.reason_code;
    end if;
    if v_resolution.stock_config_id is distinct from (
      select decision_row.stock_config_id
      from public.inventory_cutoff_decisions decision_row
      where decision_row.cutoff_id = v_cutoff_id
        and decision_row.order_item_id = v_resolution.order_item_id
        and decision_row.transaction_kind = 'manufacturer'
    ) or v_resolution.stock_config_id is distinct from
      v_resolution.selected_stock_config_id then
      raise exception 'inventory_cutoff_stale_preflight_data';
    end if;
  end loop;

  return public.verify_and_post_inventory_opening_cutoff_scoped_legacy(
    p_request_id, p_code_hash
  );
end;
$function$
;
REVOKE ALL ON FUNCTION public.inventory_cutoff_preview_h2m_unscoped_legacy(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inventory_cutoff_preview_pre_stock_adjustment_eligibility(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inventory_cutoff_preview_pre_stock_adjustment_detail(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inventory_cutoff_preview_pre_d2h_policy(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inventory_cutoff_preview_pre_h2m_policy(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inventory_cutoff_preview_pre_transactions_policy(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inventory_cutoff_preview_pre_blocker_details(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_and_post_inventory_opening_cutoff_pre_transactions_polic(uuid, text) FROM PUBLIC;

NOTIFY pgrst, 'reload schema';

COMMIT;
