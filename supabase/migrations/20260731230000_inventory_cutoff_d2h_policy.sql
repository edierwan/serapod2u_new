begin;

-- ============================================================================
-- Opening Balance D2H policy — fresh baseline exclude-all vs review-select
-- ----------------------------------------------------------------------------
-- Forward-only. Does not edit prior migrations. Does not mutate QR data.
-- Does not cancel Opening Balance cutoffs. Does not delete historical orders.
--
-- Policy values (immutable per cutoff snapshot once saved):
--   exclude_all    — Start Fresh: all pre-boundary in-scope D2H/SO are historical
--   review_select  — Review & select specific SO orders to carry into new inventory
--
-- Boundary timestamp:
--   coalesce(posted_at, proposed_cutoff_at)
-- Before posting the proposed cut-off is the preview/decision boundary; after
-- posting the final posted_at is authoritative.
-- ============================================================================

create table if not exists public.inventory_cutoff_d2h_policies (
  cutoff_id uuid primary key
    references public.inventory_opening_cutoffs(id) on delete restrict,
  policy text not null check (policy in ('exclude_all', 'review_select')),
  boundary_at timestamptz not null,
  warehouse_organization_id uuid not null
    references public.organizations(id),
  company_id uuid not null
    references public.organizations(id),
  product_category_id uuid not null
    references public.product_categories(id),
  eligible_order_count integer not null check (eligible_order_count >= 0),
  eligible_item_count integer not null check (eligible_item_count >= 0),
  eligible_quantity integer not null check (eligible_quantity >= 0),
  selected_order_count integer not null default 0 check (selected_order_count >= 0),
  selected_item_count integer not null default 0 check (selected_item_count >= 0),
  selected_quantity integer not null default 0 check (selected_quantity >= 0),
  excluded_order_count integer not null default 0 check (excluded_order_count >= 0),
  excluded_item_count integer not null default 0 check (excluded_item_count >= 0),
  excluded_quantity integer not null default 0 check (excluded_quantity >= 0),
  eligible_order_ids uuid[] not null default '{}',
  selected_order_ids uuid[] not null default '{}',
  excluded_order_ids uuid[] not null default '{}',
  confirmation_fingerprint text not null,
  decided_by uuid not null references public.users(id),
  decided_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  check (
    (policy = 'exclude_all' and selected_order_count = 0 and cardinality(selected_order_ids) = 0)
    or
    (policy = 'review_select')
  )
);

create table if not exists public.inventory_cutoff_d2h_policy_requests (
  cutoff_id uuid not null
    references public.inventory_opening_cutoffs(id) on delete cascade,
  idempotency_key uuid not null,
  policy text not null check (policy in ('exclude_all', 'review_select')),
  scope_fingerprint text not null,
  requested_order_ids uuid[] not null default '{}',
  result jsonb not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (cutoff_id, idempotency_key)
);

alter table public.inventory_cutoff_d2h_policies enable row level security;
alter table public.inventory_cutoff_d2h_policy_requests enable row level security;

drop policy if exists inventory_cutoff_d2h_policies_read
  on public.inventory_cutoff_d2h_policies;
create policy inventory_cutoff_d2h_policies_read
  on public.inventory_cutoff_d2h_policies for select
  using (exists (
    select 1 from public.inventory_opening_cutoffs c
    where c.id = cutoff_id and public.can_access_org(c.warehouse_organization_id)
  ));

drop policy if exists inventory_cutoff_d2h_policies_hq_admin
  on public.inventory_cutoff_d2h_policies;
create policy inventory_cutoff_d2h_policies_hq_admin
  on public.inventory_cutoff_d2h_policies for all
  using (public.is_hq_admin()) with check (public.is_hq_admin());

revoke all on public.inventory_cutoff_d2h_policy_requests
  from public, anon, authenticated;

grant select on public.inventory_cutoff_d2h_policies to authenticated;

comment on table public.inventory_cutoff_d2h_policies is
  'Immutable-per-save Opening Balance D2H policy snapshot. Option A excludes all pre-boundary D2H; Option B records explicit selected/excluded order sets. Never mutates QR data or cancels the cutoff.';

-- ---------------------------------------------------------------------------
-- Scoped D2H order universe for a cutoff (category + warehouse + boundary)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Preflight — authoritative counts for Option A / Option B
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Apply — atomic, idempotent policy save + decision writes
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Preview wrapper — category/boundary D2H + policy-aware blockers
-- ---------------------------------------------------------------------------
alter function public.inventory_cutoff_preview(uuid)
  rename to inventory_cutoff_preview_pre_d2h_policy;

revoke all on function public.inventory_cutoff_preview_pre_d2h_policy(uuid)
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
$$;

grant execute on function public.inventory_cutoff_preview(uuid) to authenticated;

comment on function public.inventory_cutoff_preview(uuid) is
  'Opening Balance preview with D2H policy overlay: category/boundary-scoped distributor orders, policy-aware blockers, and historical exclusion summary. H2M and stock-adjustment overlays remain underneath.';

-- ---------------------------------------------------------------------------
-- Posting wrapper — require saved D2H policy + category-scoped allocation check
-- ---------------------------------------------------------------------------
create or replace function public.verify_and_post_inventory_opening_cutoff(
  p_request_id uuid, p_code_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '300s'
set lock_timeout = '30s'
as $$
declare
  v_user uuid := auth.uid();
  v_cutoff_id uuid;
  v_warehouse_id uuid;
  v_session_id uuid;
  v_category_id uuid;
  v_session_category_id uuid;
  v_policy public.inventory_cutoff_d2h_policies%rowtype;
  v_resolution record;
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

    select * into v_policy
    from public.inventory_cutoff_d2h_policies
    where cutoff_id = v_cutoff_id;
    if not found then
      if exists (
        select 1 from public.inventory_cutoff_d2h_scoped_orders(v_cutoff_id) limit 1
      ) then
        raise exception 'inventory_cutoff_d2h_policy_required';
      end if;
    else
      if v_policy.product_category_id is distinct from v_category_id
         or v_policy.warehouse_organization_id is distinct from v_warehouse_id then
        raise exception 'inventory_cutoff_d2h_policy_scope_mismatch';
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

    -- Category-scoped allocation ownership (replaces warehouse-wide check
    -- inside the legacy body for this category's inventory rows).
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
$$;

revoke all on function
  public.verify_and_post_inventory_opening_cutoff(uuid, text)
  from public;
grant execute on function
  public.verify_and_post_inventory_opening_cutoff(uuid, text)
  to authenticated;

-- Soften the legacy warehouse-wide allocation ownership check so category-
-- scoped Opening Balance can post when other categories still have allocations.
-- The outer wrapper above already enforces the category-scoped equivalent.
create or replace function public.verify_and_post_inventory_opening_cutoff_scoped_legacy(
  p_request_id uuid, p_code_hash text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
set statement_timeout = '300s' set lock_timeout = '30s' as $$
declare
  v_user uuid := auth.uid();
  v_request public.stock_count_verification_requests%rowtype;
  v_session public.stock_count_sessions%rowtype;
  v_cutoff public.inventory_opening_cutoffs%rowtype;
  v_preview jsonb;
  v_current_snapshot text;
  v_item record;
  v_order record;
  v_old_on integer;
  v_old_alloc integer;
  v_target_alloc integer;
  v_variances integer := 0;
  v_cancelled integer := 0;
  v_carried integer := 0;
  v_incoming integer := 0;
  v_history_orders integer := 0;
  v_excluded integer := 0;
begin
  if v_user is null or not public.inventory_cutoff_is_hq_admin() then raise exception 'permission_denied'; end if;
  select * into v_request from public.stock_count_verification_requests
    where id=p_request_id for update;
  if not found or v_request.requesting_user_id<>v_user then raise exception 'invalid_verification_code'; end if;
  select * into v_session from public.stock_count_sessions
    where id=v_request.session_id for update;
  if v_session.count_type<>'opening_balance_cutoff' then raise exception 'stock_count_wrong_posting_function'; end if;
  if v_session.status='posted' then raise exception 'stock_count_already_posted'; end if;
  select * into v_cutoff from public.inventory_opening_cutoffs
    where stock_count_session_id=v_session.id for update;
  if not found or v_cutoff.status<>'counting' then raise exception 'inventory_cutoff_not_active'; end if;
  if v_request.status='posted' or v_request.consumed_at is not null then
    raise exception 'verification_code_already_used';
  end if;
  if v_request.status='expired' or v_request.expires_at<=now() then
    update public.stock_count_verification_requests set status='expired'
      where id=p_request_id and status<>'expired';
    return jsonb_build_object('error_code','verification_code_expired');
  end if;
  if v_request.status<>'active' then raise exception 'invalid_verification_code'; end if;

  v_current_snapshot := public.inventory_cutoff_snapshot_hash(v_cutoff.id);
  if v_current_snapshot is distinct from v_request.snapshot_hash then
    update public.stock_count_verification_requests set status='invalidated',
      invalidated_at=now(),snapshot_mismatch=true where id=p_request_id;
    return jsonb_build_object('error_code','stock_count_snapshot_changed');
  end if;
  if p_code_hash is distinct from v_request.code_hash then
    update public.stock_count_verification_requests
      set failed_attempt_count=least(failed_attempt_count+1,5),
        status=case when failed_attempt_count+1>=5 then 'too_many_attempts' else status end,
        invalidated_at=case when failed_attempt_count+1>=5 then now() else invalidated_at end
      where id=p_request_id;
    return jsonb_build_object('error_code','invalid_verification_code');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'inventory-opening-cutoff:'||v_cutoff.warehouse_organization_id::text,0));
  perform 1 from public.product_inventory
    where organization_id=v_cutoff.warehouse_organization_id
    order by stock_config_id for update;
  perform 1 from public.orders o where
    (o.order_type in ('D2H','S2D') and public.order_inventory_organization(o.id)=v_cutoff.warehouse_organization_id)
    or (o.order_type='H2M' and public.resolve_order_destination_warehouse(o.buyer_org_id)=v_cutoff.warehouse_organization_id)
    order by o.id for update;

  v_preview := public.inventory_cutoff_preview(v_cutoff.id);
  if v_preview->>'readiness'<>'Ready' then
    raise exception 'inventory_cutoff_not_ready: %',coalesce((v_preview->'blockers')::text,'[]');
  end if;

  if exists (
    select 1 from public.inventory_cutoff_decisions d
    where d.cutoff_id=v_cutoff.id and d.transaction_kind='distributor'
    group by d.order_id having count(distinct d.decision)>1
  ) then raise exception 'inventory_cutoff_mixed_order_decisions'; end if;
  if exists (
    select 1 from public.inventory_cutoff_decisions d
    where d.cutoff_id=v_cutoff.id and d.transaction_kind='manufacturer'
    group by d.order_id having count(distinct d.decision)>1
  ) then raise exception 'inventory_cutoff_mixed_manufacturer_order_decisions'; end if;

  if exists (
    select 1 from public.inventory_cutoff_decisions d
    join public.order_items oi on oi.id=d.order_item_id
    join public.orders o on o.id=d.order_id
    where d.cutoff_id=v_cutoff.id and d.transaction_kind='distributor'
      and (o.status<>'submitted' or o.order_type not in ('D2H','S2D')
        or d.quantity<>oi.qty)
  ) then raise exception 'inventory_cutoff_distributor_decision_stale'; end if;
  if exists (
    select 1 from public.inventory_cutoff_decisions d
    join public.order_items oi on oi.id=d.order_item_id
    join public.orders o on o.id=d.order_id
    left join (
      select order_id,variant_id,sum(received_now)::integer received_qty
      from public.warehouse_receipt_items group by order_id,variant_id
    ) r on r.order_id=o.id and r.variant_id=oi.variant_id
    where d.cutoff_id=v_cutoff.id and d.transaction_kind='manufacturer'
      and (o.status not in ('approved','closed') or o.order_type<>'H2M'
        or d.quantity<>greatest(oi.qty-coalesce(r.received_qty,0),0))
  ) then raise exception 'inventory_cutoff_manufacturer_decision_stale'; end if;

  -- Category-scoped allocation ownership only. Out-of-category allocations are
  -- intentionally ignored so a Vape Opening Balance cannot be blocked by Pet Food.
  if exists (
    select 1 from public.product_inventory pi
    join public.product_variants pv on pv.id = pi.variant_id
    join public.products p on p.id = pv.product_id
    where pi.organization_id=v_cutoff.warehouse_organization_id
      and pi.quantity_allocated>0
      and p.category_id = v_cutoff.product_category_id
      and pi.quantity_allocated <> coalesce((
        select sum(d.quantity) from public.inventory_cutoff_decisions d
        join public.order_items oi on oi.id=d.order_item_id
        where d.cutoff_id=v_cutoff.id and d.transaction_kind='distributor'
          and oi.variant_id=pi.variant_id and oi.stock_config_id=pi.stock_config_id
      ),0)
  ) then raise exception 'inventory_cutoff_allocation_owner_unresolved'; end if;

  insert into public.inventory_cutoff_posting_context(
    backend_pid,transaction_id,cutoff_id,created_by
  ) values(pg_backend_pid(),txid_current(),v_cutoff.id,v_user);

  for v_order in
    select o.* from public.orders o
    where exists(select 1 from public.inventory_cutoff_decisions d
      where d.cutoff_id=v_cutoff.id and d.order_id=o.id and d.decision='cancel_release')
    order by o.id for update
  loop
    if v_order.status<>'submitted' or v_order.order_type not in ('D2H','S2D') then
      raise exception 'inventory_cutoff_distributor_not_eligible';
    end if;
    update public.orders set status='cancelled',
      notes=concat_ws(E'\n',nullif(notes,''),'Cancelled during Inventory Opening Balance Cut-off'),
      updated_by=v_user,updated_at=now() where id=v_order.id and status='submitted';
    perform public.release_allocation_for_order(v_order.id);
    insert into public.inventory_cutoff_audit_events(
      cutoff_id,event_type,actor_id,order_id,details
    ) values(v_cutoff.id,'order_cancelled_and_allocation_released',v_user,v_order.id,
      jsonb_build_object('reason','Cancelled during Inventory Opening Balance Cut-off'));
    v_cancelled:=v_cancelled+1;
  end loop;

  for v_order in
    select o.* from public.orders o
    where exists(select 1 from public.inventory_cutoff_decisions d
      where d.cutoff_id=v_cutoff.id and d.transaction_kind='distributor'
        and d.order_id=o.id and d.decision='do_not_carry_forward')
    order by o.id for update
  loop
    if v_order.status<>'submitted' or v_order.order_type not in ('D2H','S2D') then
      raise exception 'inventory_cutoff_distributor_not_eligible';
    end if;
    insert into public.inventory_cutoff_audit_events(
      cutoff_id,event_type,actor_id,order_id,details
    ) values(v_cutoff.id,'distributor_order_excluded_do_not_carry_forward',v_user,v_order.id,
      jsonb_build_object(
        'reason','Do Not Carry Forward during Inventory Opening Balance Cut-off',
        'order_status_preserved',v_order.status,
        'allocation_released',false,'inventory_impact','none','qr_impact','none'));
    v_excluded:=v_excluded+1;
  end loop;

  for v_item in
    select i.*,pi.quantity_on_hand live_on_hand,pi.quantity_allocated live_allocated,
      pi.warehouse_location,pi.average_cost
    from public.stock_count_session_items i
    left join public.product_inventory pi
      on pi.organization_id=v_cutoff.warehouse_organization_id
      and pi.variant_id=i.variant_id and pi.stock_config_id=i.stock_config_id and pi.is_active
    where i.session_id=v_session.id and i.physical_quantity is not null
    order by i.stock_config_id,i.variant_id
  loop
    v_old_on:=coalesce(v_item.live_on_hand,0);
    v_old_alloc:=coalesce(v_item.live_allocated,0);
    insert into public.product_inventory(
      variant_id,organization_id,stock_config_id,quantity_on_hand,quantity_allocated,
      average_cost,warehouse_location,is_active,last_counted_at,last_counted_by
    ) values(
      v_item.variant_id,v_cutoff.warehouse_organization_id,v_item.stock_config_id,
      v_item.physical_quantity,0,v_item.average_cost,v_item.warehouse_location,true,now(),v_user
    ) on conflict(organization_id,variant_id,stock_config_id) do update set
      quantity_on_hand=excluded.quantity_on_hand,quantity_allocated=0,
      last_counted_at=now(),last_counted_by=v_user,updated_at=now(),is_active=true;
    if v_item.physical_quantity<>v_old_on then
      insert into public.stock_movements(
        movement_type,reference_type,reference_id,reference_no,variant_id,stock_config_id,
        from_organization_id,to_organization_id,quantity_change,quantity_before,quantity_after,
        unit_cost,company_id,created_by,reason,notes
      ) values(
        'adjustment','adjustment',v_session.id,
        coalesce(v_session.reference_name,'Inventory Opening Balance Cut-off'),
        v_item.variant_id,v_item.stock_config_id,
        v_cutoff.warehouse_organization_id,v_cutoff.warehouse_organization_id,
        v_item.physical_quantity-v_old_on,v_old_on,v_item.physical_quantity,
        v_item.unit_cost,v_cutoff.company_id,v_user,'inventory_opening_balance_cutoff',
        'Physical opening quantity established; pre-cut-off history retained'
      );
      v_variances:=v_variances+1;
    end if;
  end loop;

  -- Carry-forward only. Historical order_fulfillment movements are never replayed.
  for v_item in
    select d.*,oi.variant_id,oi.stock_config_id old_stock_config_id,
      o.order_no,o.display_doc_no,o.buyer_org_id
    from public.inventory_cutoff_decisions d
    join public.order_items oi on oi.id=d.order_item_id
    join public.orders o on o.id=d.order_id
    where d.cutoff_id=v_cutoff.id and d.transaction_kind='distributor'
      and d.decision='carry_forward'
    order by d.stock_config_id,d.order_id,d.order_item_id for update of oi,o
  loop
    if not exists(select 1 from public.inventory_stock_configurations c
      where c.id=v_item.stock_config_id and c.variant_id=v_item.variant_id
        and c.volume_ml=20 and c.packaging='new_box' and c.status='active' and c.allow_so)
    then raise exception 'inventory_cutoff_20ml_new_box_missing'; end if;
    select quantity_allocated into v_target_alloc from public.product_inventory
      where organization_id=v_cutoff.warehouse_organization_id
        and variant_id=v_item.variant_id and stock_config_id=v_item.stock_config_id for update;
    update public.product_inventory set quantity_allocated=quantity_allocated+v_item.quantity,
      updated_at=now()
      where organization_id=v_cutoff.warehouse_organization_id
        and variant_id=v_item.variant_id and stock_config_id=v_item.stock_config_id
        and quantity_on_hand-quantity_allocated>=v_item.quantity;
    if not found then raise exception 'inventory_cutoff_carried_allocation_shortage: order %, config %, quantity %',
      coalesce(v_item.display_doc_no,v_item.order_no),v_item.stock_config_id,v_item.quantity; end if;
    update public.order_items set stock_config_id=v_item.stock_config_id,
      stock_config_confirmed_at=now(),stock_config_confirmed_by=v_user,updated_at=now()
      where id=v_item.order_item_id;
    insert into public.stock_movements(
      movement_type,reference_type,reference_id,reference_no,variant_id,stock_config_id,
      from_organization_id,to_organization_id,quantity_change,quantity_before,quantity_after,
      company_id,created_by,reason,notes
    ) values(
      'allocation','order_config_change',v_item.order_id,
      coalesce(v_item.display_doc_no,v_item.order_no),v_item.variant_id,v_item.stock_config_id,
      v_cutoff.warehouse_organization_id,v_item.buyer_org_id,v_item.quantity,
      coalesce(v_target_alloc,0),coalesce(v_target_alloc,0)+v_item.quantity,
      v_cutoff.company_id,v_user,'inventory_opening_balance_cutoff',
      'Explicit distributor allocation carried forward to 20ml New Box'
    );
    insert into public.inventory_cutoff_audit_events(
      cutoff_id,event_type,actor_id,order_id,order_item_id,details
    ) values(v_cutoff.id,'distributor_allocation_carried_forward',v_user,
      v_item.order_id,v_item.order_item_id,jsonb_build_object(
        'quantity',v_item.quantity,'stock_config_id',v_item.stock_config_id));
    v_carried:=v_carried+v_item.quantity;
  end loop;

  for v_order in
    select o.* from public.orders o
    where exists(select 1 from public.inventory_cutoff_decisions d
      where d.cutoff_id=v_cutoff.id and d.transaction_kind='manufacturer'
        and d.order_id=o.id and d.decision='history_only')
    order by o.id for update
  loop
    if v_order.order_type<>'H2M' or v_order.status not in ('approved','closed') then
      raise exception 'inventory_cutoff_manufacturer_not_eligible';
    end if;
    update public.orders set status='cancelled',
      notes=concat_ws(E'\n',nullif(notes,''),
        'Marked History Only during Inventory Opening Balance Cut-off'),
      updated_by=v_user,updated_at=now()
      where id=v_order.id and status in ('approved','closed');
    insert into public.inventory_cutoff_audit_events(
      cutoff_id,event_type,actor_id,order_id,details
    ) values(v_cutoff.id,'manufacturer_order_marked_history_only',v_user,v_order.id,
      jsonb_build_object('previous_status',v_order.status,
        'reason','History Only during Inventory Opening Balance Cut-off',
        'future_receiving_allowed',false));
    v_history_orders:=v_history_orders+1;
  end loop;

  for v_item in select * from public.inventory_cutoff_decisions
    where cutoff_id=v_cutoff.id and transaction_kind='manufacturer'
      and decision='carry_forward_incoming'
  loop
    insert into public.inventory_cutoff_audit_events(
      cutoff_id,event_type,actor_id,order_id,order_item_id,details
    ) values(v_cutoff.id,'manufacturer_incoming_carried_forward',v_user,
      v_item.order_id,v_item.order_item_id,jsonb_build_object(
        'remaining_incoming_quantity',v_item.quantity,'stock_config_id',v_item.stock_config_id,
        'inventory_posted',false));
    v_incoming:=v_incoming+v_item.quantity;
  end loop;

  update public.stock_count_sessions set status='posted',posted_by=v_user,posted_at=now(),
    total_variants_counted=(select count(*) from public.stock_count_session_items
      where session_id=v_session.id and physical_quantity is not null),
    variance_items=v_variances,
    net_quantity_adjustment=(select coalesce(sum(physical_quantity-system_quantity),0)
      from public.stock_count_session_items where session_id=v_session.id and physical_quantity is not null),
    estimated_adjustment_value=(select coalesce(sum((physical_quantity-system_quantity)*unit_cost),0)
      from public.stock_count_session_items where session_id=v_session.id and physical_quantity is not null),
    updated_by=v_user,updated_at=now()
    where id=v_session.id and status='draft';
  if not found then raise exception 'stock_count_already_posted'; end if;

  insert into public.inventory_cutoff_reports(
    cutoff_id,report_kind,readiness,report_payload,generated_by
  ) values(v_cutoff.id,'posted','Ready',v_preview,v_user);
  update public.inventory_opening_cutoffs set status='posted',posted_by=v_user,
    posted_at=now(),updated_at=now() where id=v_cutoff.id and status='counting';
  insert into public.inventory_cutoff_audit_events(cutoff_id,event_type,actor_id,details)
    values(v_cutoff.id,'cutoff_posted_and_warehouse_reopened',v_user,jsonb_build_object(
      'variance_movements',v_variances,'cancelled_orders',v_cancelled,
      'carried_distributor_quantity',v_carried,'carried_manufacturer_incoming',v_incoming,
      'manufacturer_history_only_orders',v_history_orders,
      'excluded_do_not_carry_forward_orders',v_excluded,
      'd2h_policy', coalesce(v_preview->'d2h_policy'->>'policy', null),
      'qr_impact','none'));

  update public.stock_count_verification_requests set status='posted',verified_by=v_user,
    verified_at=now(),consumed_at=now(),
    code_hash=encode(extensions.digest(extensions.gen_random_bytes(32),'sha256'),'hex'),
    posting_result=jsonb_build_object('status','posted','cutoff_id',v_cutoff.id,
      'cancelled_orders',v_cancelled,'carried_distributor_quantity',v_carried,
      'carried_manufacturer_incoming',v_incoming,
      'manufacturer_history_only_orders',v_history_orders,
      'excluded_do_not_carry_forward_orders',v_excluded,'variance_movements',v_variances)
    where id=p_request_id;
  update public.stock_count_verification_requests set status='invalidated',invalidated_at=now()
    where session_id=v_session.id and id<>p_request_id and status in ('pending_delivery','active');
  delete from public.inventory_cutoff_posting_context
    where backend_pid=pg_backend_pid() and transaction_id=txid_current()
      and cutoff_id=v_cutoff.id and created_by=v_user;
  return jsonb_build_object('status','posted','cutoff_id',v_cutoff.id,
    'session_id',v_session.id,'cancelled_orders',v_cancelled,
    'carried_distributor_quantity',v_carried,
    'carried_manufacturer_incoming',v_incoming,
    'manufacturer_history_only_orders',v_history_orders,
    'excluded_do_not_carry_forward_orders',v_excluded,'variance_movements',v_variances,
    'qr_impact','none');
end;
$$;

revoke all on function
  public.verify_and_post_inventory_opening_cutoff_scoped_legacy(uuid, text)
  from public;
grant execute on function
  public.verify_and_post_inventory_opening_cutoff_scoped_legacy(uuid, text)
  to authenticated;

notify pgrst, 'reload schema';

commit;
