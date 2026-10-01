-- Security & Access: granting a role never takes over automatic access.
--
-- sa_create_assignment_internal upserts on (user, role, membership). When the
-- person already held the role automatically (backfill/derived), a manual
-- grant or an approved access request overwrote that lifecycle row: it became
-- administrator-owned, took the grant's end date, and the person lost the
-- automatic access when the grant expired or was revoked (staging UAT,
-- 2026-10-01).
--
-- This migration rejects such a grant with sa_role_already_held (manual
-- grants and approvals), and rejects submitting an access request for a role
-- the target already holds actively. Lifecycle callers (backfill/derived) are
-- unchanged. Re-granting an ended automatic row, or changing an existing
-- manual grant, still works as before.
--
-- Idempotent (create or replace only); no data change. Requires
-- 20260928100000_sa_final_governance_foundation.sql.

CREATE OR REPLACE FUNCTION public.sa_create_assignment_internal(p_actor uuid, p_user uuid, p_role uuid, p_org uuid, p_scope_ids uuid[], p_from timestamp with time zone, p_until timestamp with time zone, p_reason text, p_source text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare
  v_membership uuid;
  v_assignment uuid;
  v_conflict record;
  v_scope_count integer;
begin
  if p_user is null or p_role is null or p_org is null then raise exception 'sa_invalid_assignment'; end if;
  if not exists (select 1 from public.sa_business_roles where id = p_role and status = 'active') then
    raise exception 'sa_role_not_assignable';
  end if;
  if exists (select 1 from public.sa_business_roles where id = p_role and source = 'legacy') and p_source not in ('backfill','derived') then
    raise exception 'sa_compat_role_not_assignable' using hint = 'Compatibility roles are managed by the lifecycle sync.';
  end if;
  -- Enterprise identity required: an active membership created from HR/User
  -- Management facts. Consumer relationships never qualify.
  select m.id into v_membership from public.sa_organization_memberships m
  where m.user_id = p_user and m.organization_id = p_org and m.status = 'active'
    and (m.effective_until is null or m.effective_until > now())
  order by m.is_primary desc limit 1;
  if v_membership is null then raise exception 'sa_membership_required'; end if;
  -- Never take over automatic access: re-granting a role the person already
  -- holds automatically would convert that lifecycle row into an
  -- administrator grant (and, with an end date, silently remove it later).
  if p_source not in ('backfill','derived') and exists (
       select 1 from public.sa_role_assignments a
       where a.user_id = p_user and a.role_id = p_role and a.membership_id = v_membership
         and a.status = 'active' and a.source in ('backfill','derived')
         and (a.effective_until is null or a.effective_until > now())) then
    raise exception 'sa_role_already_held' using hint = 'The person already holds this role automatically.';
  end if;
  if not exists (select 1 from public.users u where u.id = p_user and u.is_active is true) then
    raise exception 'sa_target_inactive';
  end if;
  if coalesce(cardinality(p_scope_ids), 0) = 0 then raise exception 'sa_scope_required'; end if;
  -- Every scope must lie inside the membership organization's subtree;
  -- organization-independent typed scopes (territory, campaign, ...) are
  -- allowed only for non-structural scope types.
  select count(*) into v_scope_count from public.sa_scope_definitions sd
  where sd.id = any(p_scope_ids) and sd.status = 'active'
    and ((sd.organization_id is not null and p_org = any(public.sa_org_ancestry(sd.organization_id)))
      or (sd.organization_id is null and sd.scope_type not in ('organization','warehouse','department','own_record','direct_reports')));
  if v_scope_count <> cardinality(p_scope_ids) then raise exception 'sa_scope_outside_membership'; end if;

  for v_conflict in select * from public.sa_sod_holding_conflicts(p_user, p_role) loop
    if v_conflict.enforcement = 'enforce' and not v_conflict.mitigated then
      raise exception 'sod_violation: %', v_conflict.rule_key using errcode = '42501';
    end if;
    insert into public.sa_sod_violations(rule_id, user_id, outcome, details)
    values (v_conflict.rule_id, p_user, case when v_conflict.mitigated then 'allowed_mitigated' else 'allowed_monitor' end,
            jsonb_build_object('role_id', p_role, 'context', 'assignment'));
  end loop;

  insert into public.sa_role_assignments(user_id, role_id, membership_id, status, effective_from, effective_until,
                                         assignment_reason, source, created_by, updated_by)
  values (p_user, p_role, v_membership, 'active', p_from, p_until, p_reason, p_source, p_actor, p_actor)
  on conflict (user_id, role_id, membership_id) do update set
    status = 'active', effective_from = excluded.effective_from, effective_until = excluded.effective_until,
    assignment_reason = excluded.assignment_reason, source = excluded.source, ended_reason = null,
    updated_at = now(), updated_by = excluded.updated_by
  returning id into v_assignment;
  delete from public.sa_assignment_scopes where assignment_id = v_assignment;
  insert into public.sa_assignment_scopes(assignment_id, scope_id, created_by)
  select v_assignment, unnest(p_scope_ids), p_actor on conflict do nothing;

  perform public.sa_log_access_change(p_actor, 'assignment.granted', p_user, 'sa_role_assignment', v_assignment::text,
    jsonb_build_object('role_id', p_role, 'organization_id', p_org, 'scope_ids', p_scope_ids,
                       'effective_from', p_from, 'effective_until', p_until, 'source', p_source),
    p_reason, case when p_source in ('backfill','derived') then 'system' else 'user' end);
  return v_assignment;
end $function$;
revoke all on function public.sa_create_assignment_internal(uuid,uuid,uuid,uuid,uuid[],timestamptz,timestamptz,text,text) from public, anon, authenticated;

-- Requests for a role the target already holds (any source) are pointless
-- and, once approved, would hit sa_role_already_held; reject them up front.
create or replace function public.sa_submit_access_request(p_actor uuid, p_target uuid, p_role uuid, p_org uuid, p_scope_ids uuid[], p_from timestamp with time zone, p_until timestamp with time zone, p_reason text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  v_id uuid;
  v_max_days integer := public.sa_setting_int('access_request.max_temporary_days', 90);
  v_type text := case when p_until is not null then 'temporary_role' else 'role' end;
begin
  if p_actor is null or not exists (select 1 from public.users u where u.id = p_actor and u.is_active is true) then
    raise exception 'sa_actor_inactive' using errcode = '42501';
  end if;
  -- Requests are raised by business members for themselves or their org.
  if not exists (select 1 from public.sa_organization_memberships m where m.user_id = p_actor and m.status = 'active') then
    raise exception 'sa_membership_required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.sa_organization_memberships m where m.user_id = p_target and m.organization_id = p_org and m.status = 'active') then
    raise exception 'sa_membership_required';
  end if;
  if exists (select 1 from public.sa_business_roles where id = p_role and (status <> 'active' or source = 'legacy')) then
    raise exception 'sa_role_not_requestable';
  end if;
  if exists (select 1 from public.sa_role_assignments a join public.sa_organization_memberships m on m.id = a.membership_id
             where a.user_id = p_target and a.role_id = p_role and m.organization_id = p_org and a.status = 'active'
               and (a.effective_until is null or a.effective_until > now())) then
    raise exception 'sa_role_already_held' using hint = 'The person already holds this role.';
  end if;
  if coalesce(cardinality(p_scope_ids), 0) = 0 then raise exception 'sa_scope_required'; end if;
  if p_until is not null and p_until > coalesce(p_from, now()) + make_interval(days => v_max_days) then
    raise exception 'sa_temporary_access_too_long';
  end if;
  insert into public.sa_access_requests(requester_id, target_user_id, request_type, role_id, organization_id, scope_ids,
                                        reason, effective_from, effective_until)
  values (p_actor, p_target, v_type, p_role, p_org, p_scope_ids, btrim(p_reason), p_from, p_until)
  returning id into v_id;
  perform public.sa_log_access_change(p_actor, 'access_request.submitted', p_target, 'sa_access_request', v_id::text,
    jsonb_build_object('role_id', p_role, 'organization_id', p_org, 'scope_ids', p_scope_ids, 'effective_until', p_until), btrim(p_reason));
  return v_id;
end $function$;
revoke all on function public.sa_submit_access_request(uuid,uuid,uuid,uuid,uuid[],timestamptz,timestamptz,text) from public, anon, authenticated;
