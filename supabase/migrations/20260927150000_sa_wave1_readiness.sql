-- Security & Access Wave 1: production-readiness (additive).
--
-- Purpose
--   A. Bounded authorization-decision retention
--      * sa_permissions.audit_sensitivity: explicit catalog attribute
--        ('ordinary' | 'security_sensitive'); unknown/new permissions default
--        to the protected value.
--      * sa_authorization_decisions.audit_class: explicit write-time
--        classification (no default). Rows written before this migration are
--        'UNCLASSIFIED' and are never purged automatically.
--      * sa_purge_ordinary_shadow_decisions(): service-only, bounded,
--        idempotent removal of ORDINARY_SHADOW rows older than 90 days, with
--        every run recorded in sa_retention_runs.
--      * Append-only is kept: UPDATE is always rejected; DELETE is rejected
--        unless the row is ORDINARY_SHADOW, older than 90 days, and the delete
--        happens inside the retention function. service_role loses direct
--        UPDATE/DELETE/TRUNCATE on the decision table.
-- This migration does NOT change any migration mode. inventory.stock_count.verify
-- stays SHADOW until a separately approved cutover.
--
-- Deployment order: apply together with the application release that writes
-- audit_class. Old application code writing decisions without audit_class is
-- rejected by NOT NULL; in the non-enforced modes the application only logs
-- that failure and the business operation continues.
--
-- Rollback (run as the migration owner, in one transaction):
--   drop function if exists public.sa_decision_retention_status();
--   drop function if exists public.sa_purge_ordinary_shadow_decisions(integer);
--   drop trigger if exists sa_authorization_decisions_audit_class on public.sa_authorization_decisions;
--   drop function if exists public.sa_validate_decision_audit_class();
--   drop trigger if exists sa_authorization_decisions_no_truncate on public.sa_authorization_decisions;
--   drop function if exists public.sa_reject_decision_truncate();
--   drop table if exists public.sa_retention_runs;
--   drop function if exists public.sa_reject_retention_run_mutation();
--   -- restore the Wave 1 unconditional append-only guard:
--   create or replace function public.sa_reject_decision_mutation() returns trigger
--     language plpgsql security definer set search_path = '' as $$
--     begin raise exception 'authorization_decisions_are_append_only'; end $$;
--   drop function if exists public.sa_ordinary_shadow_retention();
--   drop index if exists public.sa_decisions_ordinary_shadow_age_idx;
--   alter table public.sa_authorization_decisions drop constraint if exists sa_decisions_ordinary_shadow_shape;
--   alter table public.sa_authorization_decisions drop constraint if exists sa_decisions_audit_class_valid;
--   alter table public.sa_authorization_decisions drop column if exists audit_class;
--   alter table public.sa_permissions drop column if exists audit_sensitivity;
--   grant all on table public.sa_authorization_decisions to service_role;
--   alter function public.sa_save_business_role(uuid,uuid,text,text,text,text[]) set search_path = '';

-- ---------------------------------------------------------------------------
-- A0. Phase 0 invariant: every SECURITY DEFINER function pins a search_path
--     that ends in pg_temp. Wave 1 used an empty search_path (all references
--     are schema-qualified); align it with the Phase 0 standard.
-- ---------------------------------------------------------------------------
alter function public.sa_save_business_role(uuid,uuid,text,text,text,text[]) set search_path = pg_catalog, pg_temp;

-- ---------------------------------------------------------------------------
-- A1. Explicit permission audit sensitivity
-- ---------------------------------------------------------------------------
alter table public.sa_permissions
  add column if not exists audit_sensitivity text not null default 'security_sensitive';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sa_permissions_audit_sensitivity_valid') then
    alter table public.sa_permissions add constraint sa_permissions_audit_sensitivity_valid
      check (audit_sensitivity in ('ordinary','security_sensitive'));
  end if;
end $$;
comment on column public.sa_permissions.audit_sensitivity is
  'Explicit audit retention sensitivity. Only ordinary permissions can produce purgeable ORDINARY_SHADOW decisions. Defaults to security_sensitive so a new permission is protected until it is deliberately reviewed.';

-- Explicit key list (not a prefix match): the nine Supply Chain pilot operations.
update public.sa_permissions set audit_sensitivity = 'ordinary'
where permission_key in (
  'inventory.stock_count.view','inventory.stock_count.create','inventory.stock_count.verify',
  'inventory.stock_count.post','inventory.transfer.view','inventory.transfer.request',
  'inventory.transfer.approve','inventory.transfer.dispatch','inventory.transfer.receive'
) and audit_sensitivity <> 'ordinary';

-- ---------------------------------------------------------------------------
-- A2. Explicit decision audit classification
-- ---------------------------------------------------------------------------
-- The constant default only labels pre-existing rows (no row rewrite, no
-- UPDATE trigger). It is dropped immediately so every new row must state its
-- class at write time.
alter table public.sa_authorization_decisions
  add column if not exists audit_class text not null default 'UNCLASSIFIED';
alter table public.sa_authorization_decisions alter column audit_class drop default;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sa_decisions_audit_class_valid') then
    alter table public.sa_authorization_decisions add constraint sa_decisions_audit_class_valid
      check (audit_class in ('ORDINARY_SHADOW','ENFORCED_DECISION','SECURITY_SENSITIVE','POLICY_ERROR','UNCLASSIFIED'));
  end if;
  -- Only a non-authoritative, error-free comparison can ever be purgeable.
  if not exists (select 1 from pg_constraint where conname = 'sa_decisions_ordinary_shadow_shape') then
    alter table public.sa_authorization_decisions add constraint sa_decisions_ordinary_shadow_shape
      check (audit_class <> 'ORDINARY_SHADOW' or (
        migration_mode in ('LEGACY_ENFORCED','SHADOW')
        and comparison <> 'POLICY_ERROR'
        and reason_code <> 'POLICY_ERROR'));
  end if;
end $$;
comment on column public.sa_authorization_decisions.audit_class is
  'Write-time retention class. ORDINARY_SHADOW (purgeable after 90 days) | ENFORCED_DECISION | SECURITY_SENSITIVE | POLICY_ERROR | UNCLASSIFIED (pre-readiness rows). Only ORDINARY_SHADOW is ever removed automatically.';

create index if not exists sa_decisions_ordinary_shadow_age_idx
  on public.sa_authorization_decisions(occurred_at)
  where audit_class = 'ORDINARY_SHADOW';

-- Validates classification on insert so an application bug cannot make a
-- protected decision purgeable.
create or replace function public.sa_validate_decision_audit_class()
returns trigger language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_sensitivity text;
begin
  if new.audit_class = 'UNCLASSIFIED' then
    raise exception 'authorization_decision_audit_class_required';
  end if;
  if new.audit_class = 'ENFORCED_DECISION'
     and new.migration_mode not in ('NEW_ENFORCED','LEGACY_RETIRED') then
    raise exception 'authorization_decision_audit_class_invalid';
  end if;
  if new.audit_class = 'ORDINARY_SHADOW' then
    select p.audit_sensitivity into v_sensitivity
    from public.sa_permissions p where p.permission_key = new.permission_key;
    if v_sensitivity is distinct from 'ordinary' then
      raise exception 'authorization_decision_audit_class_invalid';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.sa_validate_decision_audit_class() from public, anon, authenticated;
drop trigger if exists sa_authorization_decisions_audit_class on public.sa_authorization_decisions;
create trigger sa_authorization_decisions_audit_class
before insert on public.sa_authorization_decisions
for each row execute function public.sa_validate_decision_audit_class();

-- ---------------------------------------------------------------------------
-- A3. Retention: append-only guard with one narrow exception
-- ---------------------------------------------------------------------------
create or replace function public.sa_ordinary_shadow_retention()
returns interval language sql immutable set search_path = pg_catalog, pg_temp as $$ select interval '90 days' $$;
revoke all on function public.sa_ordinary_shadow_retention() from public, anon, authenticated;

-- Replaces the Wave 1 body. UPDATE is still always rejected. DELETE is allowed
-- only for an ORDINARY_SHADOW row older than the retention window, and only
-- while the retention function has set its transaction-local flag. The flag is
-- not a privilege boundary (table privileges are); it prevents even the owner
-- from deleting eligible rows by accident outside the audited function.
create or replace function public.sa_reject_decision_mutation()
returns trigger language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if tg_op = 'DELETE'
     and current_setting('sa.decision_retention_purge', true) = 'on'
     and old.audit_class = 'ORDINARY_SHADOW'
     and old.occurred_at < now() - public.sa_ordinary_shadow_retention() then
    return old;
  end if;
  raise exception 'authorization_decisions_are_append_only';
end $$;
revoke all on function public.sa_reject_decision_mutation() from public, anon, authenticated;

create or replace function public.sa_reject_decision_truncate()
returns trigger language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  raise exception 'authorization_decisions_are_append_only';
end $$;
revoke all on function public.sa_reject_decision_truncate() from public, anon, authenticated;
drop trigger if exists sa_authorization_decisions_no_truncate on public.sa_authorization_decisions;
create trigger sa_authorization_decisions_no_truncate
before truncate on public.sa_authorization_decisions
for each statement execute function public.sa_reject_decision_truncate();

-- The application only ever reads and appends decisions.
revoke update, delete, truncate, references, trigger on table public.sa_authorization_decisions from service_role;
revoke all on table public.sa_authorization_decisions from anon, authenticated;
grant select, insert on table public.sa_authorization_decisions to service_role;

create table if not exists public.sa_retention_runs (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(),
  target_table text not null check (target_table = 'sa_authorization_decisions'),
  audit_class text not null check (audit_class = 'ORDINARY_SHADOW'),
  retention_window interval not null,
  cutoff timestamptz not null,
  batch_limit integer not null check (batch_limit between 1 and 50000),
  deleted_count integer not null check (deleted_count >= 0),
  more_remaining boolean not null,
  invoked_by_role text not null
);
create index if not exists sa_retention_runs_time_idx on public.sa_retention_runs(run_at desc);
comment on table public.sa_retention_runs is 'Append-only record of every authorization-decision retention run.';
alter table public.sa_retention_runs enable row level security;
alter table public.sa_retention_runs force row level security;
revoke all on table public.sa_retention_runs from public, anon, authenticated, service_role;
grant select on table public.sa_retention_runs to service_role;

create or replace function public.sa_reject_retention_run_mutation()
returns trigger language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  raise exception 'retention_runs_are_append_only';
end $$;
revoke all on function public.sa_reject_retention_run_mutation() from public, anon, authenticated;
drop trigger if exists sa_retention_runs_append_only on public.sa_retention_runs;
create trigger sa_retention_runs_append_only
before update or delete on public.sa_retention_runs
for each row execute function public.sa_reject_retention_run_mutation();

create or replace function public.sa_purge_ordinary_shadow_decisions(p_batch_limit integer default 5000)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_batch_limit, 5000), 1), 50000);
  v_window interval := public.sa_ordinary_shadow_retention();
  v_cutoff timestamptz := now() - public.sa_ordinary_shadow_retention();
  v_deleted integer := 0;
  v_more boolean;
  v_run_id uuid;
begin
  -- One run at a time; a concurrent invocation is a harmless no-op.
  if not pg_try_advisory_xact_lock(hashtextextended('sa_purge_ordinary_shadow_decisions', 0)) then
    return jsonb_build_object('status', 'skipped_concurrent_run');
  end if;

  perform set_config('sa.decision_retention_purge', 'on', true);
  with doomed as (
    select d.id from public.sa_authorization_decisions d
    where d.audit_class = 'ORDINARY_SHADOW' and d.occurred_at < v_cutoff
    order by d.occurred_at
    limit v_limit
  )
  delete from public.sa_authorization_decisions d
  using doomed where d.id = doomed.id
    and d.audit_class = 'ORDINARY_SHADOW' and d.occurred_at < v_cutoff;
  get diagnostics v_deleted = row_count;
  perform set_config('sa.decision_retention_purge', 'off', true);

  select exists (
    select 1 from public.sa_authorization_decisions d
    where d.audit_class = 'ORDINARY_SHADOW' and d.occurred_at < v_cutoff
  ) into v_more;

  insert into public.sa_retention_runs(
    target_table, audit_class, retention_window, cutoff, batch_limit,
    deleted_count, more_remaining, invoked_by_role)
  values (
    'sa_authorization_decisions', 'ORDINARY_SHADOW', v_window, v_cutoff, v_limit,
    v_deleted, v_more, coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', session_user::text))
  returning id into v_run_id;

  return jsonb_build_object(
    'status', 'completed', 'run_id', v_run_id, 'deleted', v_deleted,
    'more_remaining', v_more, 'cutoff', v_cutoff, 'retention_days', 90);
end $$;
revoke all on function public.sa_purge_ordinary_shadow_decisions(integer) from public, anon, authenticated;
grant execute on function public.sa_purge_ordinary_shadow_decisions(integer) to service_role;
comment on function public.sa_purge_ordinary_shadow_decisions(integer) is
  'Service-only, bounded (<=50000 rows per call), idempotent removal of ORDINARY_SHADOW authorization decisions older than 90 days. Protected classes cannot be removed. Every run is recorded in sa_retention_runs.';

create or replace function public.sa_decision_retention_status()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select jsonb_build_object(
    'retention_days', 90,
    'oldest_ordinary_shadow', (select min(d.occurred_at) from public.sa_authorization_decisions d where d.audit_class = 'ORDINARY_SHADOW'),
    'eligible_for_purge', (select count(*) from public.sa_authorization_decisions d
                           where d.audit_class = 'ORDINARY_SHADOW' and d.occurred_at < now() - public.sa_ordinary_shadow_retention()),
    'by_class', coalesce((select jsonb_object_agg(c.audit_class, c.n) from (
                  select d.audit_class, count(*) n from public.sa_authorization_decisions d group by d.audit_class) c), '{}'::jsonb),
    'last_run', (select to_jsonb(r) - 'invoked_by_role' from public.sa_retention_runs r order by r.run_at desc limit 1)
  )
$$;
revoke all on function public.sa_decision_retention_status() from public, anon, authenticated;
grant execute on function public.sa_decision_retention_status() to service_role;

-- ---------------------------------------------------------------------------
-- Post-conditions
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.sa_migration_modes where permission_key = 'inventory.stock_count.verify' and mode <> 'SHADOW') then
    raise notice 'inventory.stock_count.verify is not SHADOW; this migration did not change it';
  end if;
  if has_table_privilege('service_role', 'public.sa_authorization_decisions', 'DELETE')
     or has_table_privilege('service_role', 'public.sa_authorization_decisions', 'UPDATE')
     or has_table_privilege('authenticated', 'public.sa_authorization_decisions', 'DELETE')
     or has_table_privilege('anon', 'public.sa_authorization_decisions', 'DELETE') then
    raise exception 'postcondition: decision table must not be directly deletable/updatable by API roles';
  end if;
  if has_function_privilege('authenticated', 'public.sa_purge_ordinary_shadow_decisions(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.sa_purge_ordinary_shadow_decisions(integer)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.sa_purge_ordinary_shadow_decisions(integer)', 'EXECUTE') then
    raise exception 'postcondition: retention purge must be service-only';
  end if;
  if exists (select 1 from public.sa_authorization_decisions where audit_class is null) then
    raise exception 'postcondition: every decision must carry an audit class';
  end if;
  if (select count(*) from public.sa_permissions where audit_sensitivity = 'ordinary'
      and permission_key not like 'inventory.%') > 0 then
    raise exception 'postcondition: only reviewed Supply Chain permissions may be ordinary';
  end if;
end $$;
