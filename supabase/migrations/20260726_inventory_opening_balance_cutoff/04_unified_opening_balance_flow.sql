begin;

-- Forward-only correction for the unified
-- "Inventory Opening Balance & Initial Classification" workflow.
-- Migrations 01-03 are already deployed and intentionally remain immutable.

-- 01-03 were warehouse-global. Product Management's authoritative relationship
-- is products.category_id -> product_categories.id; configurations inherit it
-- through inventory_stock_configurations.variant_id -> product_variants.product_id.
alter table public.stock_count_sessions
  add column if not exists product_category_id uuid
  references public.product_categories(id) on delete restrict;
alter table public.inventory_opening_cutoffs
  add column if not exists product_category_id uuid
  references public.product_categories(id) on delete restrict;

comment on column public.stock_count_sessions.product_category_id is
  'Stable Product Management category snapshot for a category-scoped Opening Balance draft.';
comment on column public.inventory_opening_cutoffs.product_category_id is
  'Category copied from the Opening Balance draft; null only for legacy warehouse-global cutoff history.';

alter table public.stock_count_sessions
  drop constraint if exists stock_count_opening_balance_category_required;
alter table public.stock_count_sessions
  add constraint stock_count_opening_balance_category_required check (
    count_type <> 'opening_balance_cutoff' or product_category_id is not null
  ) not valid;

drop index if exists public.inventory_opening_cutoffs_one_posted_warehouse;
create unique index if not exists inventory_opening_cutoffs_one_posted_warehouse_category
  on public.inventory_opening_cutoffs (
    warehouse_organization_id, product_category_id
  )
  where status = 'posted' and product_category_id is not null;

-- At most one *active* (still-draft) Opening Balance per warehouse/category. This
-- is the atomic backstop behind the UI's "Continue Existing Draft" and the safe
-- get-existing-or-create save path: a concurrent request or double-click loses
-- the race with a unique_violation instead of creating a duplicate draft.
-- Legacy warehouse-global drafts carry a null category (added by this migration
-- with no backfill) and are intentionally excluded, so index creation never
-- collides on historical rows.
create unique index if not exists stock_count_one_active_opening_balance_draft
  on public.stock_count_sessions (
    warehouse_organization_id, product_category_id
  )
  where count_type = 'opening_balance_cutoff'
    and status = 'draft'
    and product_category_id is not null;

comment on index public.stock_count_one_active_opening_balance_draft is
  'Guarantees a single active Opening Balance draft per warehouse/category. After posting or discard the row leaves draft status and a new draft may be started.';

-- One authoritative master-data predicate is shared by draft creation/update,
-- OTP preparation, freeze, and the final status transition inside posting.
create or replace function public.is_active_stock_count_warehouse(
  p_organization_id uuid
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.organizations o
    where o.id = p_organization_id
      and o.org_type_code = 'WH'
      and o.is_active = true
  );
$$;

revoke all on function public.is_active_stock_count_warehouse(uuid) from public;

-- Retire creation/posting of the old Initial Classification session type while
-- retaining all historical rows. Also prevent a new Opening Balance draft after
-- the warehouse already has its official posted baseline.
create or replace function public.stock_count_unified_opening_balance_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_active_stock_count_warehouse(new.warehouse_organization_id) then
    raise exception 'stock_count_active_warehouse_required';
  end if;

  if new.count_type = 'initial_configuration_classification' then
    if tg_op = 'INSERT' then
      raise exception 'stock_count_legacy_initial_read_only';
    elsif old.count_type is distinct from new.count_type
       or (old.status is distinct from 'posted' and new.status = 'posted') then
      raise exception 'stock_count_legacy_initial_read_only';
    end if;
  end if;

  if new.count_type = 'opening_balance_cutoff' then
    if new.product_category_id is null then
      raise exception 'stock_count_active_product_category_required';
    end if;
    if tg_op = 'INSERT' and not exists (
         select 1 from public.product_categories pc
         where pc.id = new.product_category_id and pc.is_active = true
    ) then
      raise exception 'stock_count_active_product_category_required';
    end if;
    if tg_op = 'UPDATE'
       and old.product_category_id is distinct from new.product_category_id
       and not exists (
         select 1 from public.product_categories pc
         where pc.id = new.product_category_id and pc.is_active = true
       ) then
      raise exception 'stock_count_active_product_category_required';
    end if;
    if tg_op = 'UPDATE'
       and old.product_category_id is distinct from new.product_category_id then
      raise exception 'stock_count_category_immutable';
    end if;
  elsif new.product_category_id is not null then
    raise exception 'stock_count_category_only_allowed_for_opening_balance';
  end if;

  if new.count_type = 'opening_balance_cutoff'
     and new.status = 'draft'
     and exists (
       select 1
       from public.inventory_opening_cutoffs c
       where c.warehouse_organization_id = new.warehouse_organization_id
         and (
           c.product_category_id = new.product_category_id
           or c.product_category_id is null
         )
         and c.status = 'posted'
     ) then
    raise exception 'inventory_opening_balance_already_posted';
  end if;

  return new;
end;
$$;

drop trigger if exists stock_count_unified_opening_balance_guard
  on public.stock_count_sessions;
create trigger stock_count_unified_opening_balance_guard
before insert or update of count_type, status, warehouse_organization_id, product_category_id
on public.stock_count_sessions
for each row execute function public.stock_count_unified_opening_balance_guard();

revoke all on function public.stock_count_unified_opening_balance_guard() from public;

-- The category is enforced server-side for both the immutable scope snapshot
-- and saved item rows. Client filtering is never trusted.
create or replace function public.stock_count_opening_category_scope_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.stock_count_sessions%rowtype;
  v_stock_config_id uuid;
begin
  select * into v_session
  from public.stock_count_sessions
  where id = new.session_id;
  if not found then raise exception 'stock_count_not_found'; end if;
  if v_session.count_type <> 'opening_balance_cutoff' then return new; end if;

  v_stock_config_id := new.stock_config_id;
  if v_stock_config_id is null or not exists (
    select 1
    from public.inventory_stock_configurations c
    join public.product_variants pv on pv.id = c.variant_id
    join public.products p on p.id = pv.product_id
    where c.id = v_stock_config_id
      and p.category_id = v_session.product_category_id
  ) then
    raise exception 'inventory_opening_balance_category_scope_mismatch';
  end if;
  return new;
end;
$$;

drop trigger if exists stock_count_opening_scope_category_guard
  on public.stock_count_session_scope;
create trigger stock_count_opening_scope_category_guard
before insert or update on public.stock_count_session_scope
for each row execute function public.stock_count_opening_category_scope_guard();

drop trigger if exists stock_count_opening_item_category_guard
  on public.stock_count_session_items;
create trigger stock_count_opening_item_category_guard
before insert or update on public.stock_count_session_items
for each row execute function public.stock_count_opening_category_scope_guard();

revoke all on function public.stock_count_opening_category_scope_guard()
  from public;

create or replace function public.inventory_cutoff_category_decision_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.inventory_opening_cutoffs c
    join public.order_items oi on oi.id = new.order_item_id
    join public.product_variants pv on pv.id = oi.variant_id
    join public.products p on p.id = pv.product_id
    where c.id = new.cutoff_id
      and c.product_category_id is not null
      and p.category_id = c.product_category_id
  ) then
    raise exception 'inventory_cutoff_order_outside_category';
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_cutoff_category_decision_guard
  on public.inventory_cutoff_decisions;
create trigger inventory_cutoff_category_decision_guard
before insert or update on public.inventory_cutoff_decisions
for each row execute function public.inventory_cutoff_category_decision_guard();

revoke all on function public.inventory_cutoff_category_decision_guard()
  from public;

-- Phase 17's safe discard remains the implementation (soft archive, never
-- inventory deletion). Tighten its server boundary for the unified flow:
-- once freeze/readiness/OTP has started, the draft is no longer discardable.
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
        and c.status in ('counting', 'posted')
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

drop trigger if exists stock_count_discard_posting_started_guard
  on public.stock_count_sessions;
create trigger stock_count_discard_posting_started_guard
before update of status on public.stock_count_sessions
for each row execute function public.stock_count_discard_posting_started_guard();

revoke all on function public.stock_count_discard_posting_started_guard()
  from public;

-- Starting the freeze is the authoritative server gate between the physical
-- count and operational cut-off. It rejects incomplete saved scopes and a
-- warehouse that already has a posted baseline.
create or replace function public.start_inventory_opening_cutoff(
  p_session_id uuid, p_proposed_cutoff_at timestamptz
) returns public.inventory_opening_cutoffs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_session public.stock_count_sessions%rowtype;
  v_company uuid;
  v_cutoff public.inventory_opening_cutoffs%rowtype;
begin
  if v_user is null or not public.inventory_cutoff_is_hq_admin() then
    raise exception 'permission_denied';
  end if;

  select * into v_session
  from public.stock_count_sessions
  where id = p_session_id
  for update;

  if not found then raise exception 'stock_count_not_found'; end if;
  if v_session.status <> 'draft'
     or v_session.count_type <> 'opening_balance_cutoff' then
    raise exception 'inventory_cutoff_requires_opening_balance_draft';
  end if;
  if v_session.product_category_id is null or not exists (
    select 1 from public.product_categories pc
    where pc.id = v_session.product_category_id
  ) then
    raise exception 'stock_count_active_product_category_required';
  end if;
  if not public.is_active_stock_count_warehouse(
    v_session.warehouse_organization_id
  ) then
    raise exception 'stock_count_active_warehouse_required';
  end if;

  if exists (
    select 1
    from public.inventory_opening_cutoffs c
    where c.warehouse_organization_id = v_session.warehouse_organization_id
      and (
        c.product_category_id = v_session.product_category_id
        or c.product_category_id is null
      )
      and c.status = 'posted'
  ) then
    raise exception 'inventory_opening_balance_already_posted';
  end if;

  if not exists (
    select 1
    from public.stock_count_session_scope s
    where s.session_id = v_session.id
  ) or exists (
    select 1
    from public.stock_count_session_scope s
    left join public.stock_count_session_items i
      on i.session_id = s.session_id
     and i.stock_config_id = s.stock_config_id
    where s.session_id = v_session.id
      and i.physical_quantity is null
  ) then
    raise exception 'inventory_opening_balance_count_incomplete';
  end if;

  if exists (
    select 1
    from public.stock_count_session_scope s
    join public.inventory_stock_configurations c on c.id = s.stock_config_id
    join public.product_variants pv on pv.id = c.variant_id
    join public.products p on p.id = pv.product_id
    where s.session_id = v_session.id
      and p.category_id is distinct from v_session.product_category_id
  ) or exists (
    select 1
    from public.stock_count_session_items i
    left join public.stock_count_session_scope s
      on s.session_id = i.session_id
     and s.stock_config_id = i.stock_config_id
    where i.session_id = v_session.id and s.stock_config_id is null
  ) then
    raise exception 'inventory_opening_balance_category_scope_mismatch';
  end if;

  v_company := public.get_company_id(v_session.warehouse_organization_id);
  if v_company is null then raise exception 'organization_mismatch'; end if;

  insert into public.inventory_opening_cutoffs(
    company_id, warehouse_organization_id, product_category_id,
    stock_count_session_id,
    proposed_cutoff_at, started_by
  ) values (
    v_company, v_session.warehouse_organization_id,
    v_session.product_category_id, v_session.id,
    coalesce(p_proposed_cutoff_at, now()), v_user
  ) returning * into v_cutoff;

  insert into public.inventory_cutoff_audit_events(
    cutoff_id, event_type, actor_id, details
  ) values (
    v_cutoff.id, 'warehouse_freeze_started', v_user,
    jsonb_build_object(
      'warehouse_organization_id', v_cutoff.warehouse_organization_id,
      'product_category_id', v_cutoff.product_category_id,
      'stock_count_session_id', v_session.id
    )
  );

  return v_cutoff;
end;
$$;

revoke all on function public.start_inventory_opening_cutoff(uuid,timestamptz)
  from public;
grant execute on function public.start_inventory_opening_cutoff(uuid,timestamptz)
  to authenticated;

-- Opening Balance is the one pre-go-live process allowed to count configured
-- rows alongside a genuine Legacy/Unclassified balance. Once a baseline is
-- posted, later normal counts may also count those independent configurations.
-- The retired Initial type is rejected before an OTP request can be created.
create or replace function public.prepare_stock_count_verification(
  p_session_id uuid,
  p_organization_id uuid,
  p_code_hash text,
  p_recipient_summary jsonb,
  p_request_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.stock_count_sessions%rowtype;
  v_snapshot text;
  v_request_id uuid;
  v_company_id uuid;
  v_resend_count integer := 0;
  v_recent_count integer;
begin
  if v_user_id is null then raise exception 'unauthorized'; end if;
  if p_code_hash is null or length(p_code_hash) < 32 then
    raise exception 'invalid_code_hash';
  end if;

  select * into v_session
  from public.stock_count_sessions
  where id = p_session_id
  for update;

  if not found then raise exception 'stock_count_not_found'; end if;
  if v_session.status <> 'draft' then raise exception 'stock_count_already_posted'; end if;
  if not public.is_active_stock_count_warehouse(
    v_session.warehouse_organization_id
  ) then
    raise exception 'stock_count_active_warehouse_required';
  end if;
  if v_session.count_type = 'initial_configuration_classification' then
    raise exception 'stock_count_legacy_initial_read_only';
  end if;
  if not public.stock_count_user_can_post(
    v_user_id, v_session.warehouse_organization_id
  ) then
    raise exception 'permission_lost';
  end if;
  if not exists (
    select 1
    from public.users
    where id = v_user_id
      and organization_id = p_organization_id
  ) then
    raise exception 'organization_mismatch';
  end if;
  if not exists (
    select 1
    from public.stock_count_session_items
    where session_id = p_session_id
      and physical_quantity is not null
  ) then
    raise exception 'no_counted_variants';
  end if;
  if v_session.count_type = 'opening_balance_cutoff' and (
    v_session.product_category_id is null
    or not exists (
      select 1 from public.inventory_opening_cutoffs c
      where c.stock_count_session_id = v_session.id
        and c.product_category_id = v_session.product_category_id
        and c.status = 'counting'
    )
    or exists (
      select 1
      from public.stock_count_session_scope s
      left join public.stock_count_session_items i
        on i.session_id = s.session_id
       and i.stock_config_id = s.stock_config_id
      where s.session_id = v_session.id
        and i.physical_quantity is null
    )
  ) then
    raise exception 'inventory_opening_balance_count_incomplete';
  end if;
  if exists (
    select 1
    from public.stock_count_session_items
    where session_id = p_session_id
      and physical_quantity is not null
      and stock_config_id is null
  ) then
    raise exception 'stock_count_config_identity_missing';
  end if;

  -- Preserve the pre-go-live protection for normal counts. Opening Balance is
  -- the official classification baseline, and after it posts the configurations
  -- are independent countable balances.
  if v_session.count_type not in (
    'initial_configuration_classification', 'opening_balance_cutoff'
  ) then
    if exists (
      select 1
      from public.stock_count_session_items i
      join public.inventory_stock_configurations c
        on c.id = i.stock_config_id
       and c.variant_id = i.variant_id
      join public.product_variants pv on pv.id = i.variant_id
      join public.products p on p.id = pv.product_id
      where i.session_id = p_session_id
        and i.physical_quantity is not null
        and c.config_code in ('20NB', '50NB', '50OB')
        and not exists (
          select 1
          from public.inventory_opening_cutoffs cutoff
          where cutoff.warehouse_organization_id =
            v_session.warehouse_organization_id
            and cutoff.status = 'posted'
            and (
              cutoff.product_category_id = p.category_id
              or cutoff.product_category_id is null
            )
        )
        and exists (
          select 1
          from public.inventory_stock_configurations lc
          join public.product_inventory lpi
            on lpi.stock_config_id = lc.id
           and lpi.variant_id = lc.variant_id
           and lpi.organization_id = v_session.warehouse_organization_id
           and lpi.is_active = true
          where lc.variant_id = i.variant_id
            and lc.config_code = 'UNCLASSIFIED'
            and coalesce(lpi.quantity_on_hand, 0) > 0
        )
    ) then
      raise exception 'stock_count_full_count_on_unclassified';
    end if;
  end if;

  v_company_id := public.get_company_id(v_session.warehouse_organization_id);
  if v_company_id is null then raise exception 'organization_mismatch'; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws(
      ':', v_company_id::text,
      v_session.warehouse_organization_id::text,
      i.variant_id::text, i.stock_config_id::text
    ), 0
  ))
  from public.stock_count_session_items i
  where i.session_id = p_session_id
    and i.physical_quantity is not null
  order by i.stock_config_id, i.variant_id;

  perform 1
  from public.product_inventory pi
  join public.stock_count_session_items i
    on i.variant_id = pi.variant_id
   and i.stock_config_id = pi.stock_config_id
  where i.session_id = p_session_id
    and pi.organization_id = v_session.warehouse_organization_id
    and pi.is_active = true
    and i.physical_quantity is not null
  order by i.stock_config_id, i.variant_id
  for update of pi;

  if exists (
    select 1
    from public.stock_count_session_items i
    left join public.inventory_stock_configurations c
      on c.id = i.stock_config_id
     and c.variant_id = i.variant_id
    where i.session_id = p_session_id
      and i.physical_quantity is not null
      and c.id is null
  ) then
    raise exception 'stock_count_config_identity_missing';
  end if;

  if exists (
    select 1
    from public.stock_count_session_items i
    left join public.product_inventory pi
      on pi.variant_id = i.variant_id
     and pi.organization_id = v_session.warehouse_organization_id
     and pi.stock_config_id = i.stock_config_id
     and pi.is_active = true
    where i.session_id = p_session_id
      and i.physical_quantity is not null
      and coalesce(pi.quantity_on_hand, 0) is distinct from i.system_quantity
  ) then
    raise exception 'stock_count_snapshot_changed';
  end if;

  if exists (
    select 1
    from public.stock_count_session_items
    where session_id = p_session_id
      and coalesce(adjustment_quantity, 0) <> 0
  ) and nullif(btrim(coalesce(v_session.notes, '')), '') is null then
    raise exception 'posting_note_required';
  end if;

  if exists (
    select 1
    from public.stock_count_session_items i
    left join public.product_variants pv on pv.id = i.variant_id
    where i.session_id = p_session_id
      and coalesce(i.adjustment_quantity, 0) <> 0
      and pv.base_cost is null
  ) then
    raise exception 'stock_count_base_cost_missing';
  end if;

  update public.stock_count_session_items i
  set unit_cost = pv.base_cost,
      updated_at = now()
  from public.product_variants pv
  where i.session_id = p_session_id
    and i.variant_id = pv.id
    and i.physical_quantity is not null;

  select count(*) into v_recent_count
  from public.stock_count_verification_requests
  where requesting_user_id = v_user_id
    and requested_at > now() - interval '15 minutes';
  if v_recent_count >= 5 then raise exception 'request_rate_limited'; end if;

  select coalesce(max(resend_count), -1) + 1 into v_resend_count
  from public.stock_count_verification_requests
  where session_id = p_session_id;

  if exists (
    select 1
    from public.stock_count_verification_requests
    where session_id = p_session_id
      and requested_at > now() - interval '60 seconds'
      and status in ('pending_delivery', 'active')
  ) then
    raise exception 'resend_cooldown';
  end if;

  update public.stock_count_verification_requests
  set status = 'invalidated',
      invalidated_at = now(),
      code_hash = encode(
        extensions.digest(extensions.gen_random_bytes(32), 'sha256'), 'hex'
      )
  where session_id = p_session_id
    and status in ('pending_delivery', 'active');

  v_snapshot := public.stock_count_snapshot_hash(p_session_id);
  insert into public.stock_count_verification_requests(
    organization_id, session_id, requesting_user_id, code_hash, snapshot_hash,
    recipient_summary, expires_at, resend_count, request_metadata
  ) values (
    p_organization_id, p_session_id, v_user_id, p_code_hash, v_snapshot,
    coalesce(p_recipient_summary, '[]'::jsonb),
    now() + interval '15 minutes', v_resend_count,
    coalesce(p_request_metadata, '{}'::jsonb)
  ) returning id into v_request_id;

  return jsonb_build_object(
    'request_id', v_request_id,
    'snapshot_hash', v_snapshot,
    'expires_at', now() + interval '15 minutes',
    'resend_count', v_resend_count
  );
end;
$$;

comment on function public.prepare_stock_count_verification(
  uuid, uuid, text, jsonb, jsonb
) is
  'Prepares OTP verification for normal counts and the unified Opening Balance. Legacy Initial Classification is read-only. Before go-live, normal counts remain blocked from classifying configured rows over a positive Legacy balance; Opening Balance and post-go-live normal counts use independent configuration balances.';

revoke all on function public.prepare_stock_count_verification(
  uuid, uuid, text, jsonb, jsonb
) from public;
grant execute on function public.prepare_stock_count_verification(
  uuid, uuid, text, jsonb, jsonb
) to authenticated;

comment on index public.inventory_opening_cutoffs_one_posted_warehouse_category is
  'Allows at most one successfully posted official Opening Balance per warehouse/category. Cancelled attempts remain auditable and retryable through a new draft.';

commit;
