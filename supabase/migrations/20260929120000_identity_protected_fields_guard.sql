-- ============================================================================
-- Identity Foundation Stage 1 — 3/3
-- Close browser/API-role writes to identity and enterprise-access fields;
-- identities with business/audit history are archived, never hard-deleted
-- ----------------------------------------------------------------------------
-- Purpose
--   Phase 0A (20260926200000) protects access fields only on a user's OWN row.
--   Other users' rows remain writable by any API caller passing the users RLS
--   policies; users_admin_all is gated by hr.employee.manage (Final Wave), so
--   an HR employee-manager could change role_code / organization_id /
--   account_scope / is_active of any user in scope directly through PostgREST
--   (verified on staging 2026-09-28: authenticated holds table UPDATE on
--   public.users; users_admin_all = sa_rls_gate('hr.employee.manage', ...)).
--   Employee management must not imply access administration.
--
--   This trigger makes the following columns immutable for the API roles
--   (anon, authenticated) on EVERY row:
--     identity:  id, email, phone, email_verified_at, phone_verified_at,
--                is_verified, auth_provider
--     access:    role_code, organization_id, account_scope, principal_type
--     lifecycle: account_status, account_status_changed_at,
--                account_status_reason, is_active
--   and rejects INSERT and DELETE of public.users by the API roles (identities
--   are created only by the trusted provisioning service; removal is a
--   lifecycle action).
--
--   Authorized changes go through the server (service_role) after an S&A
--   decision: identity_provision(), identity_admin_update_access(),
--   identity_set_account_status(), updateUserWithAuth (identity/profile only),
--   /api/user/update-profile (verified phone change). SECURITY DEFINER
--   database functions (lifecycle, reference-change RPCs) run as their owner
--   and are unaffected. HR facts (department, position, manager, employment_*)
--   stay HR-writable through the existing gated policies; Phase 0A still
--   protects them on the user's own row.
--
-- Security rationale
--   Closes client-side privilege escalation and organization moves; makes
--   hr.employee.manage insufficient for access administration.
--
-- Grants / RLS: unchanged (defence in depth via trigger; RLS policies and
--   grants are left as-is to avoid breaking legitimate profile writes).
-- Idempotent: yes.
--
--   History guard (second part of this file): identity_history_references()
--   lists business/audit references to an identity; users_history_delete_guard
--   refuses a hard delete by the server (service_role) or by GoTrue
--   (auth.admin.deleteUser cascade) while any exist. The OTP delete route and
--   deleteUserWithAuth consult the same function and archive instead.
--
-- Rollback guidance:
--   drop trigger users_history_delete_guard on public.users;
--   drop function public.identity_history_delete_guard();
--   drop function public.identity_history_references(uuid);
--   drop trigger users_protect_access_fields on public.users;
--   drop function public.identity_protect_access_fields();
-- ============================================================================

create or replace function public.identity_protect_access_fields()
returns trigger
language plpgsql
-- SECURITY INVOKER on purpose: current_user identifies the API role.
set search_path = pg_catalog, pg_temp
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    raise exception 'identity_create_requires_provisioning'
      using errcode = '42501', hint = 'Identities are created by the server-side provisioning service.';
  elsif tg_op = 'DELETE' then
    raise exception 'identity_delete_requires_lifecycle'
      using errcode = '42501', hint = 'Use the account lifecycle (disable/archive) on the server.';
  end if;

  if new.id is distinct from old.id
     or new.email is distinct from old.email
     or new.phone is distinct from old.phone
     or new.email_verified_at is distinct from old.email_verified_at
     or new.phone_verified_at is distinct from old.phone_verified_at
     or new.is_verified is distinct from old.is_verified
     or new.auth_provider is distinct from old.auth_provider
     or new.role_code is distinct from old.role_code
     or new.organization_id is distinct from old.organization_id
     or new.account_scope is distinct from old.account_scope
     or new.principal_type is distinct from old.principal_type
     or new.account_status is distinct from old.account_status
     or new.account_status_changed_at is distinct from old.account_status_changed_at
     or new.account_status_reason is distinct from old.account_status_reason
     or new.is_active is distinct from old.is_active then
    raise exception 'identity_protected_field'
      using errcode = '42501',
            hint = 'Identity and enterprise-access fields change only through authorized server endpoints.';
  end if;
  return new;
end $$;
revoke all on function public.identity_protect_access_fields() from public;
grant execute on function public.identity_protect_access_fields() to anon, authenticated, service_role;

-- Fires after the projection/normalization BEFORE triggers (name order), so it
-- sees the final row, including derived principal_type/account_status.
drop trigger if exists users_protect_access_fields on public.users;
create trigger users_protect_access_fields
before insert or update or delete on public.users
for each row execute function public.identity_protect_access_fields();

-- ---------------------------------------------------------------------------
-- Historical attribution must survive account removal
-- ---------------------------------------------------------------------------
-- 54 foreign keys to public.users are ON DELETE CASCADE (verified on staging
-- 2026-09-28), including Supply Chain history: stock_movements.created_by and
-- stock_transfers.created_by. A hard delete (application or
-- auth.admin.deleteUser → users_id_fkey cascade) would silently delete that
-- history; other FKs would null or block. identity_history_references()
-- lists every reference that is NOT owned by the identity itself (explicit
-- column allowlist: the person's own memberships, sessions, notifications and
-- consumer loyalty data). Any other reference is business/audit history: the
-- identity must be archived (lifecycle), never hard-deleted.
create or replace function public.identity_history_references(p_user uuid)
returns text[] language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare
  r record;
  v_hit boolean;
  v_refs text[] := '{}';
  v_owned constant text[] := array[
    'users.manager_user_id',
    'account_scope_audit_log.user_id', 'hr_access_group_members.user_id', 'loyalty_program_user_memberships.user_id',
    'message_notifications.user_id', 'telegram_links.user_id', 'telegram_link_tokens.user_id',
    'serapp_user_presence.user_id', 'user_registration_bonus_progress.user_id',
    'point_reward_collections.user_id', 'points_transactions.user_id', 'consumer_qr_scans.consumer_id',
    'marketing_campaign_recipients.user_id', 'marketing_opt_outs.user_id', 'redeem_gift_transactions.user_id',
    'roadtour_participant_missions.participant_user_id', 'shop_requests.requester_user_id',
    'ellbow_wallets.owner_user_id', 'ellbow_point_transactions.owner_user_id', 'ellbow_redemptions.user_id',
    'ellbow_referral_accruals.referred_user_id', 'ellbow_referral_accruals.referrer_user_id',
    'sa_organization_memberships.user_id', 'sa_role_assignments.user_id', 'sa_access_requests.requester_id',
    'sa_access_requests.target_user_id', 'sa_access_review_items.user_id', 'sa_delegations.delegator_id',
    'sa_delegations.delegate_id', 'sa_emergency_access_grants.user_id', 'sa_sod_mitigations.user_id'];
begin
  if p_user is null then return v_refs; end if;
  for r in
    select c.conrelid::regclass as tbl, cl.relname::text as tname, a.attname::text as col
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_namespace ns on ns.oid = cl.relnamespace and ns.nspname = 'public'
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'public.users'::regclass and cardinality(c.conkey) = 1
    order by 2, 3
  loop
    if (r.tname || '.' || r.col) = any(v_owned) then continue; end if;
    execute format('select exists (select 1 from %s where %I = $1)', r.tbl, r.col) into v_hit using p_user;
    if v_hit then v_refs := v_refs || (r.tname || '.' || r.col); end if;
  end loop;
  -- Append-only history keeps raw ids without a foreign key.
  if exists (select 1 from public.sa_authorization_decisions where actor_id = p_user) then
    v_refs := v_refs || 'sa_authorization_decisions.actor_id'::text;
  end if;
  if exists (select 1 from public.sa_access_change_log where actor_id = p_user) then
    v_refs := v_refs || 'sa_access_change_log.actor_id'::text;
  end if;
  return v_refs;
end $$;
revoke all on function public.identity_history_references(uuid) from public, anon, authenticated;
grant execute on function public.identity_history_references(uuid) to service_role;
do $g$ begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'grant execute on function public.identity_history_references(uuid) to supabase_auth_admin';
  end if;
end $g$;
comment on function public.identity_history_references(uuid) is
  'References to an identity that are business/audit history (everything except the identity''s own memberships, sessions, notifications and consumer loyalty data). Non-empty ⇒ archive, never hard-delete.';

create or replace function public.identity_history_delete_guard()
returns trigger language plpgsql
-- SECURITY INVOKER: current_user/session_user identify the caller.
set search_path = pg_catalog, pg_temp as $$
declare v_refs text[];
begin
  -- API roles, the trusted server, and GoTrue (auth.admin.deleteUser cascades
  -- through users_id_fkey) are guarded; a database-owner maintenance session
  -- is exempt.
  if current_user in ('anon', 'authenticated') then
    return old;  -- API roles cannot delete identities at all (users_protect_access_fields)
  end if;
  if current_user <> 'service_role'
     and session_user not in ('supabase_auth_admin', 'authenticator') then
    return old;
  end if;
  v_refs := public.identity_history_references(old.id);
  if cardinality(v_refs) > 0 then
    raise exception 'identity_has_history'
      using errcode = '23503',
            detail = array_to_string(v_refs[1:10], ', '),
            hint = 'This identity is referenced by business or audit history. Archive it (account lifecycle) instead of deleting it.';
  end if;
  return old;
end $$;
revoke all on function public.identity_history_delete_guard() from public;
grant execute on function public.identity_history_delete_guard() to anon, authenticated, service_role;
do $g$ begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'grant execute on function public.identity_history_delete_guard() to supabase_auth_admin';
  end if;
end $g$;

drop trigger if exists users_history_delete_guard on public.users;
create trigger users_history_delete_guard
before delete on public.users
for each row execute function public.identity_history_delete_guard();

-- Post-conditions
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'users_history_delete_guard'
                 and tgrelid = 'public.users'::regclass and not tgisinternal and tgenabled = 'O') then
    raise exception 'postcondition: users_history_delete_guard trigger missing';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'users_protect_access_fields'
                 and tgrelid = 'public.users'::regclass and not tgisinternal and tgenabled = 'O') then
    raise exception 'postcondition: users_protect_access_fields trigger missing';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'users_prevent_self_service_access_field_update'
                 and tgrelid = 'public.users'::regclass and not tgisinternal) then
    raise exception 'postcondition: Phase 0A self-service trigger must remain';
  end if;
  if (select prosecdef from pg_proc where oid = 'public.identity_protect_access_fields()'::regprocedure) then
    raise exception 'postcondition: guard must be SECURITY INVOKER';
  end if;
end $$;
