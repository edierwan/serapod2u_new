begin;

-- ============================================================================
-- Opening Balance — pre-OTP draft discard removes the Transactions policy too
-- ----------------------------------------------------------------------------
-- Forward-only. Does not edit prior migrations. Does not mutate inventory
-- balances, orders, order items, stock movements, allocations, QR tables, or
-- posted / cancelled Opening Balance history.
--
-- Root cause:
--   Migration 20260801140000 added three new children of
--   inventory_opening_cutoffs AFTER archive_stock_count_draft was last written
--   (20260801120000):
--     * inventory_cutoff_transactions_policies          (ON DELETE RESTRICT)
--     * inventory_cutoff_transactions_policy_requests   (ON DELETE CASCADE)
--     * inventory_cutoff_excluded_transactions          (ON DELETE RESTRICT)
--   A pre-OTP draft that saved a Transactions policy (Step 4) therefore owns a
--   row in inventory_cutoff_transactions_policies. archive_stock_count_draft did
--   not remove it, so deleting the parent counting cutoff failed with:
--     update or delete on table "inventory_opening_cutoffs" violates foreign key
--     constraint "inventory_cutoff_transactions_policies_cutoff_id_fkey"
--
-- Data classification for the new children (deleted only for the exact pre-OTP
-- counting cutoff being discarded):
--   * inventory_cutoff_transactions_policies        — DRAFT-OWNED snapshot saved
--       while the cutoff is `counting`, before OTP/posting. Mirrors the D2H/H2M
--       policy snapshots already cleaned up here. Zero inventory/movement/QR
--       impact. Safe to remove for a pre-OTP draft.
--   * inventory_cutoff_transactions_policy_requests — DRAFT-OWNED idempotency
--       ledger for the policy save. ON DELETE CASCADE (non-blocking); removed
--       explicitly so cleanup order stays deterministic and idempotent.
--   * inventory_cutoff_excluded_transactions        — OFFICIAL history, written
--       ONLY at successful posting. A `counting` cutoff has none; the scoped
--       delete is a defensive no-op that also removes the next RESTRICT FK. It
--       is bounded to this exact cutoff_id, so no posted cutoff's markers are
--       ever touched.
--
-- Everything else is unchanged from 20260801120000: OTP protection boundary,
-- posted/cancelled protection, session/cutoff row locks, defensive OTP recheck,
-- exact cutoff/session scoping, and idempotency for an already-archived session.
-- ============================================================================

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

notify pgrst, 'reload schema';

commit;
