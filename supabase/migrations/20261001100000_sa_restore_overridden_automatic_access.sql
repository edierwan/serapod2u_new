-- Security & Access: restore automatic access an administrator revoked.
--
-- sa_revoke_assignment converts a lifecycle-owned row (backfill/derived) to
-- source 'manual' so the lifecycle sync never resurrects it. Legacy
-- compatibility roles cannot be granted manually and, with
-- legacy_authorization.read_only, the sync no longer re-derives them — so an
-- accidental revoke had no administrator restore path.
--
-- This migration:
--   1. records the overridden source on every administrator revoke;
--   2. adds sa_assignment_overridden_source(): the lifecycle source of a row
--      whose latest change is an administrator revoke (or null);
--   3. adds sa_restore_assignment(): permission-gated, reasoned, audited
--      restoration that hands the row back to the lifecycle sync;
--   4. adds sa_restorable_assignments() for the People & Access screen.
--
-- Idempotent (create or replace only); no data is changed by applying it.
-- Requires 20260928100000_sa_final_governance_foundation.sql.

-- 1. Revoke: unchanged behaviour; the audit entry now carries previous_source.
create or replace function public.sa_revoke_assignment(p_actor uuid, p_assignment uuid, p_reason text)
 returns void
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  v_a record;
begin
  select a.*, m.organization_id into v_a from public.sa_role_assignments a
  join public.sa_organization_memberships m on m.id = a.membership_id where a.id = p_assignment for update of a;
  if not found then raise exception 'sa_assignment_not_found'; end if;
  if p_reason is null or length(btrim(p_reason)) < 5 then raise exception 'sa_reason_required'; end if;
  perform public.sa_assert_actor_permission(p_actor, 'security.role.assign',
    jsonb_build_object('organization_id', v_a.organization_id), public.sa_legacy_is_super_admin(p_actor));
  -- An administrator's decision is final: a lifecycle-owned row becomes
  -- administrator-owned so the lifecycle sync never re-activates it.
  -- sa_restore_assignment can hand it back (previous_source below).
  update public.sa_role_assignments set status = 'revoked', ended_reason = btrim(p_reason),
    source = case when source in ('backfill','derived') then 'manual' else source end,
    effective_until = public.sa_end_at(effective_from, effective_until), updated_at = now(), updated_by = p_actor
  where id = p_assignment and status <> 'revoked';
  perform public.sa_log_access_change(p_actor, 'assignment.revoked', v_a.user_id, 'sa_role_assignment', p_assignment::text,
    jsonb_build_object('role_id', v_a.role_id, 'organization_id', v_a.organization_id, 'previous_source', v_a.source,
                       'previous_status', v_a.status), btrim(p_reason));
end $function$;

-- 2. Which lifecycle source an administrator overrode, if any. Restorable
-- only while the row is still revoked, administrator-owned, and its latest
-- audited change is that administrator revoke. Revokes logged before
-- previous_source existed: a legacy compatibility role was always
-- lifecycle-owned; any other role was lifecycle-owned when no administrator
-- or request ever granted it.
create or replace function public.sa_assignment_overridden_source(p_assignment uuid)
 returns text
 language sql
 stable
 security definer
 set search_path to 'pg_catalog', 'pg_temp'
as $function$
  with a as (
    select a.id, a.status, a.source, r.source as role_source
    from public.sa_role_assignments a join public.sa_business_roles r on r.id = a.role_id
    where a.id = p_assignment
  ), last_change as (
    select l.action, l.actor_kind, l.details from public.sa_access_change_log l
    where l.entity_type = 'sa_role_assignment' and l.entity_id = p_assignment::text
    order by l.occurred_at desc, l.id desc limit 1
  )
  select case
    when l.details ? 'previous_source' then
      case when l.details->>'previous_source' in ('backfill','derived') then l.details->>'previous_source' end
    when a.role_source = 'legacy' then 'derived'
    when not exists (select 1 from public.sa_access_change_log g
                     where g.entity_type = 'sa_role_assignment' and g.entity_id = p_assignment::text
                       and g.action = 'assignment.granted' and g.actor_kind = 'user') then 'derived'
  end
  from a join last_change l on true
  where a.status = 'revoked' and a.source = 'manual'
    and l.action = 'assignment.revoked' and l.actor_kind = 'user'
$function$;
revoke all on function public.sa_assignment_overridden_source(uuid) from public, anon, authenticated;
grant execute on function public.sa_assignment_overridden_source(uuid) to service_role;

-- 3. Restore. Same authority as grant/revoke (security.role.assign in the
-- membership organization), never on yourself, reason required, and every
-- grant invariant re-checked: active role, active membership, active
-- enterprise identity, scopes inside the membership, SoD. A compatibility
-- role is restored only while it still matches the person's legacy role
-- code. The row returns to its lifecycle source and the lifecycle sync then
-- re-applies its normal expiry (for example contract end dates).
create or replace function public.sa_restore_assignment(p_actor uuid, p_assignment uuid, p_reason text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  v_a record;
  v_role record;
  v_u record;
  v_source text;
  v_scopes integer;
  v_valid_scopes integer;
  v_conflict record;
begin
  select a.*, m.organization_id, m.status as membership_status, m.effective_until as membership_until into v_a
  from public.sa_role_assignments a join public.sa_organization_memberships m on m.id = a.membership_id
  where a.id = p_assignment for update of a;
  if not found then raise exception 'sa_assignment_not_found'; end if;
  if p_reason is null or length(btrim(p_reason)) < 5 then raise exception 'sa_reason_required'; end if;
  if p_actor = v_a.user_id then raise exception 'sa_self_assignment_prohibited' using errcode = '42501'; end if;
  perform public.sa_assert_actor_permission(p_actor, 'security.role.assign',
    jsonb_build_object('organization_id', v_a.organization_id), public.sa_legacy_is_super_admin(p_actor));

  v_source := public.sa_assignment_overridden_source(p_assignment);
  if v_source is null then
    raise exception 'sa_assignment_not_restorable'
      using hint = 'Only automatic access ended by an administrator can be restored; grant other roles again instead.';
  end if;

  select id, source, status, role_key into v_role from public.sa_business_roles where id = v_a.role_id;
  if v_role.status <> 'active' then raise exception 'sa_role_not_assignable'; end if;
  if v_a.membership_status <> 'active' or (v_a.membership_until is not null and v_a.membership_until <= now()) then
    raise exception 'sa_membership_required';
  end if;
  select is_active, account_scope, employment_status, account_status, role_code into v_u
  from public.users where id = v_a.user_id;
  if not coalesce(v_u.is_active, false) or v_u.account_scope is distinct from 'portal'
     or coalesce(v_u.employment_status, 'active') <> 'active' or v_u.account_status = 'SUSPENDED' then
    raise exception 'sa_target_inactive';
  end if;
  if v_role.source = 'legacy' and v_role.role_key is distinct from public.sa_compat_role_key(v_u.role_code) then
    raise exception 'sa_compat_role_stale'
      using hint = 'The person''s legacy role has changed since this access was revoked.';
  end if;

  select count(*), count(*) filter (where sd.status = 'active' and (
           (sd.organization_id is not null and v_a.organization_id = any(public.sa_org_ancestry(sd.organization_id)))
           or (sd.organization_id is null and sd.scope_type not in ('organization','warehouse','department','own_record','direct_reports'))))
    into v_scopes, v_valid_scopes
  from public.sa_assignment_scopes s join public.sa_scope_definitions sd on sd.id = s.scope_id
  where s.assignment_id = p_assignment;
  if v_scopes = 0 then raise exception 'sa_scope_required'; end if;
  if v_valid_scopes <> v_scopes then raise exception 'sa_scope_outside_membership'; end if;

  for v_conflict in select * from public.sa_sod_holding_conflicts(v_a.user_id, v_a.role_id) loop
    if v_conflict.enforcement = 'enforce' and not v_conflict.mitigated then
      raise exception 'sod_violation: %', v_conflict.rule_key using errcode = '42501';
    end if;
    insert into public.sa_sod_violations(rule_id, user_id, outcome, details)
    values (v_conflict.rule_id, v_a.user_id, case when v_conflict.mitigated then 'allowed_mitigated' else 'allowed_monitor' end,
            jsonb_build_object('role_id', v_a.role_id, 'context', 'restore'));
  end loop;

  update public.sa_role_assignments set status = 'active', source = v_source, ended_reason = null,
    effective_until = null, updated_at = now(), updated_by = p_actor
  where id = p_assignment;
  perform public.sa_log_access_change(p_actor, 'assignment.restored', v_a.user_id, 'sa_role_assignment', p_assignment::text,
    jsonb_build_object('role_id', v_a.role_id, 'organization_id', v_a.organization_id, 'restored_source', v_source),
    btrim(p_reason));
  perform public.sa_sync_user_lifecycle(v_a.user_id, 'assignment_restore');
  return p_assignment;
end $function$;
revoke all on function public.sa_restore_assignment(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.sa_restore_assignment(uuid, uuid, text) to service_role;

-- 4. Restorable rows for the People & Access screen (display only; the
-- restore function re-checks everything).
create or replace function public.sa_restorable_assignments()
 returns table(assignment_id uuid, restored_source text)
 language sql
 stable
 security definer
 set search_path to 'pg_catalog', 'pg_temp'
as $function$
  select a.id, public.sa_assignment_overridden_source(a.id)
  from public.sa_role_assignments a
  where a.status = 'revoked' and a.source = 'manual'
    and public.sa_assignment_overridden_source(a.id) is not null
$function$;
revoke all on function public.sa_restorable_assignments() from public, anon, authenticated;
grant execute on function public.sa_restorable_assignments() to service_role;
