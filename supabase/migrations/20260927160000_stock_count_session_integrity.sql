-- Stock Count session status integrity (additive).
--
-- Purpose
--   Invariant: a Stock Count session becomes 'posted' only through the
--   SECURITY DEFINER posting workflow (verify_and_post_stock_count /
--   verify_and_post_inventory_opening_cutoff* / verify_and_post_stock_classification),
--   which validates the OTP verification request and writes the inventory
--   movements atomically; posted history cannot be rewritten by API clients.
--
--   Before this migration, stock_count_sessions and stock_count_session_items
--   are GRANT ALL to authenticated and the manage_org RLS policies allow
--   UPDATE/INSERT/DELETE for anyone who can access the warehouse (or any HQ
--   admin). A browser/PostgREST client could therefore:
--     * flip draft -> 'posted' (with a forged posted_by), no OTP, no movement;
--     * insert a session already 'posted';
--     * revert posted -> draft/archived, rewrite posted totals and items,
--       or delete posted counts;
--   including Opening Balance counts, and regardless of the
--   inventory.stock_count.verify migration mode.
--
-- Approach (smallest safe change; workflow functions untouched)
--   Trigger guards that apply only to the PostgREST API roles (current_user
--   anon/authenticated). Inside SECURITY DEFINER functions current_user is the
--   function owner, so the posting, discard (archive) and cutoff functions
--   keep working unchanged; service_role (trusted server) is unaffected.
--     * API roles may insert and edit DRAFT sessions only, may not set
--       status to anything but 'draft', and may not set posted_at/posted_by.
--     * Non-draft (posted or archived) sessions and their items are read-only
--       for API roles (no update, no delete, no item insert/update/delete).
--   TRUNCATE (not reachable through PostgREST, and not subject to RLS) is
--   revoked from anon/authenticated on both tables.
--
-- Application impact: the app only writes drafts directly (draft save,
-- posting note) and discards through discard_stock_count_drafts(); verified
-- by code audit and by 30_stock_count_status_integrity.sql.
--
-- Rollback (as the migration owner, one transaction):
--   drop trigger if exists stock_count_api_write_guard on public.stock_count_sessions;
--   drop trigger if exists stock_count_items_api_write_guard on public.stock_count_session_items;
--   drop function if exists public.stock_count_session_api_write_guard();
--   drop function if exists public.stock_count_items_api_write_guard();
--   grant truncate on table public.stock_count_sessions, public.stock_count_session_items to anon, authenticated;

create or replace function public.stock_count_session_api_write_guard()
returns trigger
language plpgsql
-- SECURITY INVOKER on purpose: current_user must be the caller's role.
set search_path = pg_catalog, pg_temp
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    if new.status is distinct from 'draft' or new.posted_at is not null or new.posted_by is not null then
      raise exception 'stock_count_status_transition_not_allowed' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.status is distinct from 'draft' then
    raise exception 'stock_count_posted_session_immutable' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if new.status is distinct from 'draft' or new.posted_at is not null or new.posted_by is not null then
    raise exception 'stock_count_status_transition_not_allowed' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.stock_count_session_api_write_guard() from public, anon, authenticated;
comment on function public.stock_count_session_api_write_guard() is
  'API roles (anon/authenticated) may only create and edit draft Stock Count sessions. Posting happens only inside the SECURITY DEFINER verify-and-post functions.';

drop trigger if exists stock_count_api_write_guard on public.stock_count_sessions;
create trigger stock_count_api_write_guard
before insert or update or delete on public.stock_count_sessions
for each row execute function public.stock_count_session_api_write_guard();

create or replace function public.stock_count_items_api_write_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return coalesce(new, old);
  end if;
  if (tg_op <> 'INSERT' and exists (
        select 1 from public.stock_count_sessions s where s.id = old.session_id and s.status <> 'draft'))
     or (tg_op <> 'DELETE' and exists (
        select 1 from public.stock_count_sessions s where s.id = new.session_id and s.status <> 'draft')) then
    raise exception 'stock_count_posted_session_immutable' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
revoke all on function public.stock_count_items_api_write_guard() from public, anon, authenticated;

drop trigger if exists stock_count_items_api_write_guard on public.stock_count_session_items;
create trigger stock_count_items_api_write_guard
before insert or update or delete on public.stock_count_session_items
for each row execute function public.stock_count_items_api_write_guard();

revoke truncate on table public.stock_count_sessions, public.stock_count_session_items from anon, authenticated;

-- Post-conditions
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'stock_count_api_write_guard'
                 and tgrelid = 'public.stock_count_sessions'::regclass and tgenabled = 'O') then
    raise exception 'postcondition: session guard trigger missing';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'stock_count_items_api_write_guard'
                 and tgrelid = 'public.stock_count_session_items'::regclass and tgenabled = 'O') then
    raise exception 'postcondition: item guard trigger missing';
  end if;
  if has_table_privilege('authenticated', 'public.stock_count_sessions', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.stock_count_session_items', 'TRUNCATE') then
    raise exception 'postcondition: API roles must not truncate Stock Count tables';
  end if;
  if (select prosecdef from pg_proc where oid = 'public.stock_count_session_api_write_guard()'::regprocedure) then
    raise exception 'postcondition: guard must be SECURITY INVOKER';
  end if;
end $$;
