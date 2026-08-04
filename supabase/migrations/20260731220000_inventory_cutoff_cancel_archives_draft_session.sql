begin;

-- ============================================================================
-- Opening Balance — cancel freeze must release the active draft slot
-- ----------------------------------------------------------------------------
-- Forward-only correction. Does not mutate inventory, stock movements, orders,
-- QR, receipts or Opening Balance posted quantities.
--
-- Root cause:
--   cancel_inventory_opening_cutoff set the freeze to cancelled but left the
--   linked stock_count_sessions row as status='draft'. Continue Existing Draft
--   therefore reopened that session, inventory_cutoff_preview / load found the
--   cancelled cutoff via unique stock_count_session_id, and the UI blocked
--   retry while the one-active-draft unique index still occupied the slot.
--
-- Fix:
--   1) On cancel, soft-archive the linked Opening Balance draft session so it
--      leaves the resumable draft list and frees
--      stock_count_one_active_opening_balance_draft.
--   2) Backfill any already-stuck draft sessions whose only cutoff is cancelled.
--   3) Cancelled cutoffs remain linked to the archived session for History/Audit.
--   4) A retry must create a NEW draft session, then start_inventory_opening_cutoff
--      inserts a NEW counting cutoff (never reuse the cancelled row).
-- ============================================================================

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

-- Backfill stuck draft sessions already linked only to a cancelled cutoff.
-- Does not touch counting/posted cutoffs, inventory, orders or QR.
update public.stock_count_sessions s
set
  status = 'archived',
  updated_at = now()
where s.status = 'draft'
  and s.count_type = 'opening_balance_cutoff'
  and exists (
    select 1
    from public.inventory_opening_cutoffs c
    where c.stock_count_session_id = s.id
      and c.status = 'cancelled'
  )
  and not exists (
    select 1
    from public.inventory_opening_cutoffs c
    where c.stock_count_session_id = s.id
      and c.status in ('counting', 'posted')
  );

commit;
