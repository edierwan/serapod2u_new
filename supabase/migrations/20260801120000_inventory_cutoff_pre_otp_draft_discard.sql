begin;

-- ============================================================================
-- Opening Balance — pre-OTP drafts remain discardable
-- ----------------------------------------------------------------------------
-- Forward-only. Does not mutate inventory balances, orders, stock movements,
-- QR tables, or posted Opening Balance history.
--
-- Root cause:
--   stock_count_discard_posting_started_guard and the posting-status route
--   treated inventory_opening_cutoffs.status = 'counting' as "posting started".
--   Warehouse freeze / D2H / H2M / Transactions review correctly create a
--   counting cutoff before OTP, so unfinished drafts became permanently
--   protected even though final verification had never been requested.
--
-- Agreed protection boundary:
--   Explicit OTP request for final posting (stock_count_verification_requests
--   in pending_delivery / active / posted). A counting freeze alone is a
--   temporary draft freeze and must remain discardable.
--
-- Fix:
--   1) Guard blocks discard only for OTP verification or a posted cutoff.
--   2) archive_stock_count_draft releases a pre-OTP counting freeze and deletes
--      draft-owned cutoff dependents before soft-archiving the session, so the
--      warehouse/category slot is freed and the row leaves Count Type History.
-- ============================================================================

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
  -- row. Orders, inventory, movements and QR are never touched.
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
  'Soft-discards a Stock Count draft. Pre-OTP Opening Balance counting freezes are released and draft-owned cutoff decisions/policies are removed. OTP-requested, posted, cancelled-history protection and inventory/order/QR data are never discarded through this path.';

notify pgrst, 'reload schema';

commit;
