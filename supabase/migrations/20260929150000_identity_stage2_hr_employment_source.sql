-- ============================================================================
-- Identity Foundation Stage 2 — employment facts live in hr_employees
-- ----------------------------------------------------------------------------
-- Decision (management, 2026-09-29): hr_employees is the source of truth for
-- employment facts; the matching public.users columns remain a projection kept
-- in sync by the database, so every existing reader (org chart, S&A department
-- scope, approvals, JML lifecycle) keeps working.
--
--   hr_employees (source)                 public.users (projection)
--   department_id, position_id,     →     department_id, position_id,
--   manager_user_id, employment_type      manager_user_id, employment_type
--   hire_date                       →     join_date
--   status                          →     employment_status
--       active/probation/suspended  →       'active'
--       resigned / terminated       →       'resigned' / 'terminated'
--   employee_no                     →     employee_no
--
-- Scope: INTERNAL_EMPLOYEE identities only (the organisation's own staff).
-- Distributor, manufacturer, shop and consumer identities keep their users
-- columns as-is (they are not HR employees).
--
-- Compatibility: application code still writes the users columns. For an
-- internal employee such a write is forwarded into hr_employees (the
-- employment record of the identity's current organization) inside the same
-- statement; the projection back to users is suppressed for that forward by
-- a transaction-local flag, so there is no loop. A move between internal
-- organizations moves the single employment record (employee number kept).
-- Employment rows of former employees (identity now outside the organization
-- or no longer INTERNAL_EMPLOYEE) are kept as history and do not project.
--
-- Data: additive only. New columns are backfilled from users for records in
-- the identity's current organization; internal employees without a record
-- get one. No users value changes (the projection equals the backfill).
--
-- Security: trigger functions are SECURITY DEFINER with a pinned search_path
-- and not executable by API roles. HR employment writes remain governed by
-- the existing hr_employees RLS (unchanged) and the users guards.
-- Idempotent: yes. No migration mode is changed.
--
-- Rollback guidance:
--   drop trigger hr_employees_project_to_users on public.hr_employees;
--   drop trigger users_sync_employment on public.users;
--   drop function public.identity_hr_project_to_users(), public.identity_users_forward_employment(),
--                 public.identity_hr_employment_status(text);
--   restore fn_auto_create_hr_employee() from the staging schema (HQ-org rule);
--   the added hr_employees columns may stay (unused) or be dropped;
--   re-run the identity_history_references definition from 20260929120000.
-- ============================================================================

-- 1. Employment facts on the employment record
alter table public.hr_employees add column if not exists department_id uuid references public.departments(id) on delete set null;
alter table public.hr_employees add column if not exists position_id uuid references public.hr_positions(id) on delete set null;
alter table public.hr_employees add column if not exists manager_user_id uuid references public.users(id) on delete set null;
alter table public.hr_employees add column if not exists employment_type text;
alter table public.hr_employees add column if not exists end_date date;
alter table public.hr_employees drop constraint if exists hr_employees_employment_type_check;
alter table public.hr_employees add constraint hr_employees_employment_type_check check (
  employment_type is null or employment_type in ('Full-time','Part-time','Contract','Intern'));
alter table public.hr_employees drop constraint if exists hr_employees_no_self_manager;
alter table public.hr_employees add constraint hr_employees_no_self_manager check (manager_user_id is distinct from user_id);

comment on table public.hr_employees is
  'Employment record (source of truth for employment facts) of a central identity (users.id). One record per identity and employing organization; the record of the identity''s current organization projects onto users.';

create or replace function public.identity_hr_employment_status(p_status text)
returns text language sql immutable set search_path = pg_catalog, pg_temp as $$
  select case p_status when 'resigned' then 'resigned' when 'terminated' then 'terminated' else 'active' end
$$;
revoke all on function public.identity_hr_employment_status(text) from public, anon;
grant execute on function public.identity_hr_employment_status(text) to authenticated, service_role;

-- 2. Backfill (no users value changes)
update public.hr_employees e
set department_id = u.department_id, position_id = u.position_id, manager_user_id = u.manager_user_id,
    employment_type = u.employment_type,
    hire_date = coalesce(u.join_date, e.hire_date),
    status = case when u.employment_status in ('resigned','terminated') then u.employment_status
                  when e.status in ('probation','suspended') then e.status else 'active' end
from public.users u
where u.id = e.user_id and u.organization_id = e.organization_id and u.principal_type = 'INTERNAL_EMPLOYEE'
  and (e.department_id is distinct from u.department_id or e.position_id is distinct from u.position_id
       or e.manager_user_id is distinct from u.manager_user_id or e.employment_type is distinct from u.employment_type
       or (u.join_date is not null and e.hire_date is distinct from u.join_date)
       or public.identity_hr_employment_status(e.status) is distinct from coalesce(u.employment_status, 'active'));

insert into public.hr_employees (user_id, organization_id, hire_date, status, department_id, position_id, manager_user_id, employment_type)
select u.id, u.organization_id, coalesce(u.join_date, u.created_at::date),
       case when u.employment_status in ('resigned','terminated') then u.employment_status else 'active' end,
       u.department_id, u.position_id, u.manager_user_id, u.employment_type
from public.users u
where u.principal_type = 'INTERNAL_EMPLOYEE' and u.organization_id is not null
  and not exists (select 1 from public.hr_employees e where e.user_id = u.id and e.organization_id = u.organization_id)
on conflict (user_id, organization_id) do nothing;

-- employee_no projection for the records just created (users column is the projection)
do $bf$
begin
  execute 'alter table public.users disable trigger set_users_updated_at';
  update public.users u set employee_no = e.employee_no
  from public.hr_employees e
  where e.user_id = u.id and e.organization_id = u.organization_id and u.principal_type = 'INTERNAL_EMPLOYEE'
    and u.employee_no is distinct from e.employee_no;
  execute 'alter table public.users enable trigger set_users_updated_at';
end
$bf$;

-- 3. hr_employees → users projection
create or replace function public.identity_hr_project_to_users()
returns trigger language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if coalesce(current_setting('identity.hr_sync', true), '') = 'on' then
    return new;   -- this change came from users; the projection already holds it
  end if;
  perform set_config('identity.hr_sync', 'on', true);
  update public.users u set
    department_id = new.department_id,
    position_id = new.position_id,
    manager_user_id = new.manager_user_id,
    employment_type = new.employment_type,
    join_date = new.hire_date,
    employment_status = public.identity_hr_employment_status(new.status),
    employee_no = new.employee_no
  where u.id = new.user_id and u.organization_id = new.organization_id and u.principal_type = 'INTERNAL_EMPLOYEE'
    and (u.department_id is distinct from new.department_id or u.position_id is distinct from new.position_id
         or u.manager_user_id is distinct from new.manager_user_id or u.employment_type is distinct from new.employment_type
         or u.join_date is distinct from new.hire_date
         or u.employment_status is distinct from public.identity_hr_employment_status(new.status)
         or u.employee_no is distinct from new.employee_no);
  perform set_config('identity.hr_sync', 'off', true);
  return new;
end $$;
revoke all on function public.identity_hr_project_to_users() from public, anon, authenticated;

drop trigger if exists hr_employees_project_to_users on public.hr_employees;
create trigger hr_employees_project_to_users
after insert or update of department_id, position_id, manager_user_id, employment_type, hire_date, status, employee_no, organization_id
on public.hr_employees for each row execute function public.identity_hr_project_to_users();

-- 4. users → hr_employees forwarding (existing writers keep working)
create or replace function public.identity_users_forward_employment()
returns trigger language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare v_id uuid; v_no integer;
begin
  if coalesce(current_setting('identity.hr_sync', true), '') = 'on' then
    return new;   -- the projection itself is being written
  end if;
  if new.principal_type is distinct from 'INTERNAL_EMPLOYEE' or new.organization_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.organization_id is not distinct from old.organization_id
     and new.principal_type is not distinct from old.principal_type
     and new.department_id is not distinct from old.department_id and new.position_id is not distinct from old.position_id
     and new.manager_user_id is not distinct from old.manager_user_id and new.employment_type is not distinct from old.employment_type
     and new.join_date is not distinct from old.join_date and new.employment_status is not distinct from old.employment_status then
    return new;
  end if;

  perform set_config('identity.hr_sync', 'on', true);
  select id into v_id from public.hr_employees where user_id = new.id and organization_id = new.organization_id;
  if v_id is null and tg_op = 'UPDATE' and old.organization_id is distinct from new.organization_id
     and old.principal_type = 'INTERNAL_EMPLOYEE' then
    -- Move between internal organizations: the single employment record moves (employee number kept).
    update public.hr_employees set organization_id = new.organization_id, updated_at = now()
    where user_id = new.id and organization_id = old.organization_id
    returning id into v_id;
  end if;
  if v_id is null then
    insert into public.hr_employees (user_id, organization_id, hire_date, status, department_id, position_id, manager_user_id, employment_type)
    values (new.id, new.organization_id, coalesce(new.join_date, current_date),
            case when new.employment_status in ('resigned','terminated') then new.employment_status else 'active' end,
            new.department_id, new.position_id, new.manager_user_id, new.employment_type)
    on conflict (user_id, organization_id) do nothing
    returning id into v_id;
  else
    update public.hr_employees e set
      department_id = new.department_id, position_id = new.position_id, manager_user_id = new.manager_user_id,
      employment_type = new.employment_type,
      hire_date = coalesce(new.join_date, e.hire_date),
      status = case when new.employment_status in ('resigned','terminated') then new.employment_status
                    when e.status in ('probation','suspended') then e.status else 'active' end,
      updated_at = now()
    where e.id = v_id;
  end if;
  select employee_no into v_no from public.hr_employees where id = v_id;
  perform set_config('identity.hr_sync', 'off', true);
  if tg_op = 'UPDATE' then
    new.employee_no := coalesce(v_no, new.employee_no);
  end if;
  return new;
end $$;
revoke all on function public.identity_users_forward_employment() from public, anon, authenticated;

-- BEFORE UPDATE, named to fire after users_identity_projection (BEFORE
-- triggers run in name order) so principal_type is already re-derived.
-- New identities are handled by fn_auto_create_hr_employee (AFTER INSERT).
drop trigger if exists users_forward_employment on public.users;
drop trigger if exists users_sync_employment on public.users;
create trigger users_sync_employment
before update of organization_id, principal_type, account_scope, department_id, position_id, manager_user_id,
  employment_type, join_date, employment_status on public.users
for each row execute function public.identity_users_forward_employment();

-- 5. New internal employees get their employment record (replaces the HQ-org rule)
create or replace function public.fn_auto_create_hr_employee()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_no integer;
begin
  if new.principal_type is distinct from 'INTERNAL_EMPLOYEE' or new.organization_id is null then
    return new;
  end if;
  perform set_config('identity.hr_sync', 'on', true);
  insert into public.hr_employees (user_id, organization_id, hire_date, status, department_id, position_id, manager_user_id, employment_type)
  values (new.id, new.organization_id, coalesce(new.join_date, current_date),
          case when new.employment_status in ('resigned','terminated') then new.employment_status else 'active' end,
          new.department_id, new.position_id, new.manager_user_id, new.employment_type)
  on conflict (user_id, organization_id) do nothing;
  perform set_config('identity.hr_sync', 'off', true);
  select employee_no into v_no from public.hr_employees where user_id = new.id and organization_id = new.organization_id;
  update public.users set employee_no = v_no where id = new.id and employee_no is distinct from v_no;
  return new;
end $$;
revoke all on function public.fn_auto_create_hr_employee() from public, anon, authenticated;

-- 6. History: a reporting line on an employment record is not history (it is
--    released on removal like users.manager_user_id); the person's own
--    employment record (hr_employees.user_id) is HR history → archive.
create or replace function public.identity_history_references(p_user uuid)
returns text[] language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare
  r record;
  v_hit boolean;
  v_refs text[] := '{}';
  v_owned constant text[] := array[
    'users.manager_user_id', 'hr_employees.manager_user_id',
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

-- 7. Post-conditions
do $$
declare v_bad integer;
begin
  select count(*) into v_bad from public.users u
  where u.principal_type = 'INTERNAL_EMPLOYEE' and u.organization_id is not null
    and not exists (select 1 from public.hr_employees e where e.user_id = u.id and e.organization_id = u.organization_id);
  if v_bad > 0 then raise exception 'postcondition: % internal employees without an employment record', v_bad; end if;
  select count(*) into v_bad from public.users u join public.hr_employees e on e.user_id = u.id and e.organization_id = u.organization_id
  where u.principal_type = 'INTERNAL_EMPLOYEE'
    and (u.department_id is distinct from e.department_id or u.position_id is distinct from e.position_id
         or u.manager_user_id is distinct from e.manager_user_id or u.employment_type is distinct from e.employment_type
         or coalesce(u.employment_status,'active') is distinct from public.identity_hr_employment_status(e.status)
         or u.employee_no is distinct from e.employee_no);
  if v_bad > 0 then raise exception 'postcondition: % users rows differ from their employment record', v_bad; end if;
  if has_function_privilege('authenticated', 'public.identity_users_forward_employment()', 'EXECUTE') then
    raise exception 'postcondition: forwarding function must not be executable by API roles';
  end if;
end $$;
