begin;

-- ============================================================================
-- Opening Balance Transactions policy — one policy for the eligible existing
-- Stock Adjustments, Returns and Stock Transfers surfaced in the Transactions
-- step (Step 4). Replaces the blocker-only treatment with an explicit,
-- persisted policy that mirrors the D2H / H2M policy contract.
-- ----------------------------------------------------------------------------
-- Forward-only. Does not edit prior migrations. Does not mutate QR data.
-- Does not cancel Opening Balance cutoffs. Does not delete, cancel or mutate
-- the business status of any stock_adjustment / return_case / stock_transfer.
-- Saving a policy and posting the Opening Balance create ZERO inventory impact
-- from these transactions and NEVER replay a stock movement that already
-- happened before the cut-off.
--
-- Policy values (immutable per cutoff snapshot once saved):
--   exclude_all        — Start Fresh: every eligible pre-boundary transaction is
--                        historical excluded from the new inventory baseline.
--   carry_forward_all  — Carry Forward: every server-eligible transaction keeps
--                        its authoritative existing lifecycle and continues after
--                        the cut-off. No inventory added/deducted while saving.
--   review_select      — Review: carry only the explicitly checked eligible
--                        transactions; unchecked eligible ones are excluded.
--
-- Eligibility (never `pending` status alone — real lifecycle + movement evidence):
--   stock_adjustment : open (status not completed/cancelled/resolved/rejected),
--                      non-quality-issue, in-category child lines with non-zero
--                      quantity, and NO posted stock movement yet.
--   return           : return_warehouse = cutoff warehouse, status in
--                      (return_submitted, return_received, return_processing),
--                      in-category line, and NO posted return stock movement yet.
--                      The policy never invents a stock direction — the return's
--                      own disposition/workflow performs the movement.
--   stock_transfer   : (from|to) = cutoff warehouse, status in (pending,
--                      pending_approval, ready_to_dispatch, in_transit),
--                      in-category jsonb line. Not-yet-dispatched transfers carry
--                      to dispatch; already-dispatched (in_transit / transfer_out
--                      posted) transfers are Stock in Transit and only continue to
--                      receive — the source is NEVER deducted again.
--
-- Requires Individual Resolution (a genuine, policy-irresolvable blocker):
--   a transaction whose posted stock-movement evidence is inconsistent with its
--   declared lifecycle status (partial / dispatched-but-open / received-without-
--   dispatch / adjustment posted-but-not-completed). Only these remain blockers.
--
-- Boundary timestamp: coalesce(posted_at, proposed_cutoff_at) — reuses the
-- authoritative cut-off boundary already stored by the exercise. No backdating
-- feature is added.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Storage — immutable-per-save policy snapshot + idempotency ledger
-- ---------------------------------------------------------------------------
create table if not exists public.inventory_cutoff_transactions_policies (
  cutoff_id uuid primary key
    references public.inventory_opening_cutoffs(id) on delete restrict,
  policy text not null
    check (policy in ('exclude_all', 'carry_forward_all', 'review_select')),
  boundary_at timestamptz not null,
  warehouse_organization_id uuid not null references public.organizations(id),
  company_id uuid not null references public.organizations(id),
  product_category_id uuid not null references public.product_categories(id),
  eligible_count integer not null default 0 check (eligible_count >= 0),
  carried_count integer not null default 0 check (carried_count >= 0),
  excluded_count integer not null default 0 check (excluded_count >= 0),
  blocked_count integer not null default 0 check (blocked_count >= 0),
  -- Authoritative effective decision snapshot (per transaction type).
  carried_adjustment_ids uuid[] not null default '{}',
  carried_return_ids uuid[] not null default '{}',
  carried_transfer_ids uuid[] not null default '{}',
  excluded_adjustment_ids uuid[] not null default '{}',
  excluded_return_ids uuid[] not null default '{}',
  excluded_transfer_ids uuid[] not null default '{}',
  -- Heterogeneous {type,id} lists for presentation/audit.
  carried_refs jsonb not null default '[]'::jsonb,
  excluded_refs jsonb not null default '[]'::jsonb,
  eligible_refs jsonb not null default '[]'::jsonb,
  confirmation_fingerprint text not null,
  decided_by uuid not null references public.users(id),
  decided_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  check (
    (policy = 'exclude_all'
      and carried_count = 0
      and cardinality(carried_adjustment_ids) = 0
      and cardinality(carried_return_ids) = 0
      and cardinality(carried_transfer_ids) = 0)
    or policy = 'carry_forward_all'
    or policy = 'review_select'
  )
);

create table if not exists public.inventory_cutoff_transactions_policy_requests (
  cutoff_id uuid not null
    references public.inventory_opening_cutoffs(id) on delete cascade,
  idempotency_key uuid not null,
  policy text not null
    check (policy in ('exclude_all', 'carry_forward_all', 'review_select')),
  scope_fingerprint text not null,
  requested_refs jsonb not null default '[]'::jsonb,
  result jsonb not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (cutoff_id, idempotency_key)
);

-- Authoritative historical-exclusion markers. Written ONLY at successful posting.
-- Enforces that a transaction excluded by a posted Opening Balance can never
-- later post inventory silently through its ordinary old path. Never used to
-- delete or cancel the original transaction.
create table if not exists public.inventory_cutoff_excluded_transactions (
  cutoff_id uuid not null
    references public.inventory_opening_cutoffs(id) on delete restrict,
  transaction_type text not null
    check (transaction_type in ('stock_adjustment', 'return', 'stock_transfer')),
  transaction_id uuid not null,
  warehouse_organization_id uuid not null references public.organizations(id),
  product_category_id uuid not null references public.product_categories(id),
  excluded_by uuid not null references public.users(id),
  excluded_at timestamptz not null default now(),
  primary key (cutoff_id, transaction_type, transaction_id)
);

create index if not exists inventory_cutoff_excluded_transactions_lookup
  on public.inventory_cutoff_excluded_transactions (transaction_type, transaction_id);

alter table public.inventory_cutoff_transactions_policies enable row level security;
alter table public.inventory_cutoff_transactions_policy_requests enable row level security;
alter table public.inventory_cutoff_excluded_transactions enable row level security;

drop policy if exists inventory_cutoff_transactions_policies_read
  on public.inventory_cutoff_transactions_policies;
create policy inventory_cutoff_transactions_policies_read
  on public.inventory_cutoff_transactions_policies for select
  using (exists (
    select 1 from public.inventory_opening_cutoffs c
    where c.id = cutoff_id and public.can_access_org(c.warehouse_organization_id)
  ));

drop policy if exists inventory_cutoff_transactions_policies_hq_admin
  on public.inventory_cutoff_transactions_policies;
create policy inventory_cutoff_transactions_policies_hq_admin
  on public.inventory_cutoff_transactions_policies for all
  using (public.is_hq_admin()) with check (public.is_hq_admin());

drop policy if exists inventory_cutoff_excluded_transactions_read
  on public.inventory_cutoff_excluded_transactions;
create policy inventory_cutoff_excluded_transactions_read
  on public.inventory_cutoff_excluded_transactions for select
  using (exists (
    select 1 from public.inventory_opening_cutoffs c
    where c.id = cutoff_id and public.can_access_org(c.warehouse_organization_id)
  ));

revoke all on public.inventory_cutoff_transactions_policy_requests
  from public, anon, authenticated;
-- No direct write grants: only SECURITY DEFINER RPCs mutate these tables.
revoke insert, update, delete, truncate
  on public.inventory_cutoff_transactions_policies,
     public.inventory_cutoff_excluded_transactions
  from authenticated;

grant select on public.inventory_cutoff_transactions_policies to authenticated;
grant select on public.inventory_cutoff_excluded_transactions to authenticated;

comment on table public.inventory_cutoff_transactions_policies is
  'Immutable-per-save Opening Balance Transactions policy snapshot for eligible Stock Adjustments, Returns and Stock Transfers. Start Fresh excludes all eligible; Carry Forward carries all eligible; Review carries only checked eligible ones. Never mutates QR data, never cancels the cutoff, never replays a pre-boundary stock movement.';
comment on table public.inventory_cutoff_excluded_transactions is
  'Authoritative historical-exclusion markers written only at successful Opening Balance posting. A guard trigger blocks any later stock movement for an excluded transaction so it can never silently enter the new inventory through its old path. Original transaction records are preserved for audit.';

-- ---------------------------------------------------------------------------
-- Scoped transaction universe for a cutoff (type + warehouse + category +
-- boundary + authoritative eligibility). Read-only, no mutation.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Preflight — authoritative counts + fingerprint for all three policies.
-- Read-only. Never mutates any transaction, inventory, movement or QR data.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Apply — atomic, idempotent policy save. Persists the snapshot only.
-- Never marks posting started, requests OTP, protects the draft, writes an
-- exclusion marker, mutates a transaction, or creates a stock movement.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Preview wrapper — overlay the Transactions policy onto the existing preview.
-- Removes the eligible-transaction blockers (replaced by policy classification),
-- keeps only genuine Requires-Individual-Resolution blockers, and requires a
-- saved policy before the Opening Balance can be Ready.
-- ---------------------------------------------------------------------------
alter function public.inventory_cutoff_preview(uuid)
  rename to inventory_cutoff_preview_pre_transactions_policy;

revoke all on function
  public.inventory_cutoff_preview_pre_transactions_policy(uuid)
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
$$;

grant execute on function public.inventory_cutoff_preview(uuid) to authenticated;

comment on function public.inventory_cutoff_preview(uuid) is
  'Opening Balance preview with Transactions policy overlay: typed Stock Adjustment / Return / Stock Transfer activity, policy-aware classification, blockers limited to genuine Requires-Individual-Resolution rows plus the save-a-policy gate. D2H / H2M / stock-adjustment overlays remain underneath. Zero transaction-related inventory impact.';

-- ---------------------------------------------------------------------------
-- Posting wrapper — require a saved policy when eligible transactions exist,
-- revalidate scope, then write authoritative historical-exclusion markers for
-- the excluded set (metadata only). Zero inventory / stock-movement impact.
-- ---------------------------------------------------------------------------
alter function public.verify_and_post_inventory_opening_cutoff(uuid, text)
  rename to verify_and_post_inventory_opening_cutoff_pre_transactions_policy;

revoke all on function
  public.verify_and_post_inventory_opening_cutoff_pre_transactions_policy(uuid, text)
  from public;

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
  v_cutoff public.inventory_opening_cutoffs%rowtype;
  v_policy public.inventory_cutoff_transactions_policies%rowtype;
  v_eligible_count integer := 0;
  v_result jsonb;
begin
  if v_user is null or not public.inventory_cutoff_is_hq_admin() then
    raise exception 'permission_denied';
  end if;

  select cutoff.* into v_cutoff
  from public.stock_count_verification_requests request_row
  join public.inventory_opening_cutoffs cutoff
    on cutoff.stock_count_session_id = request_row.session_id
  where request_row.id = p_request_id
    and request_row.requesting_user_id = v_user;

  if v_cutoff.id is not null then
    select count(*) into v_eligible_count
    from public.inventory_cutoff_transactions_scoped(v_cutoff.id)
    where eligibility = 'eligible';

    select * into v_policy
    from public.inventory_cutoff_transactions_policies
    where cutoff_id = v_cutoff.id;

    if not found then
      if v_eligible_count > 0 then
        raise exception 'inventory_cutoff_transactions_policy_required';
      end if;
    else
      if v_policy.product_category_id is distinct from v_cutoff.product_category_id
         or v_policy.warehouse_organization_id is distinct from v_cutoff.warehouse_organization_id then
        raise exception 'inventory_cutoff_transactions_policy_scope_mismatch';
      end if;
      -- Re-derive current authoritative eligibility; reject stale drift.
      if v_policy.confirmation_fingerprint is distinct from (
        public.inventory_cutoff_transactions_policy_preflight(
          v_cutoff.id, v_policy.policy, v_policy.carried_refs
        )->>'confirmation_fingerprint'
      ) then
        raise exception 'inventory_cutoff_transactions_policy_scope_changed';
      end if;
    end if;
  end if;

  -- Inner posting performs all inventory/order work (transactions contribute none).
  v_result := public.verify_and_post_inventory_opening_cutoff_pre_transactions_policy(
    p_request_id, p_code_hash
  );

  -- Only stamp exclusion markers on a genuinely successful post (no error_code)
  -- and only once the cutoff is posted. Metadata-only; original transactions and
  -- their statuses are never touched.
  if v_cutoff.id is not null
     and (v_result is null or not (v_result ? 'error_code'))
     and exists (
       select 1 from public.inventory_opening_cutoffs c
       where c.id = v_cutoff.id and c.status = 'posted'
     )
     and v_policy.cutoff_id is not null then
    insert into public.inventory_cutoff_excluded_transactions(
      cutoff_id, transaction_type, transaction_id,
      warehouse_organization_id, product_category_id, excluded_by
    )
    select
      v_cutoff.id,
      ref->>'type',
      (ref->>'id')::uuid,
      v_cutoff.warehouse_organization_id,
      v_cutoff.product_category_id,
      v_user
    from jsonb_array_elements(v_policy.excluded_refs) ref
    where ref ? 'type' and ref ? 'id'
    on conflict (cutoff_id, transaction_type, transaction_id) do nothing;
  end if;

  return v_result;
end;
$$;

revoke all on function public.verify_and_post_inventory_opening_cutoff(uuid, text) from public;
grant execute on function public.verify_and_post_inventory_opening_cutoff(uuid, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Historical-exclusion enforcement. After an Opening Balance is posted, a stock
-- movement for an excluded transaction must never silently affect the new
-- inventory through the ordinary old path. Fail-closed. Only affects
-- transactions explicitly excluded by a POSTED cutoff — carried transactions are
-- never in the marker table and continue their lifecycle normally.
-- ---------------------------------------------------------------------------
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

commit;

