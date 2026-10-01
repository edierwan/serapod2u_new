-- Security & Access: remove the legacy-guest compatibility role.
--
-- GUEST is the no-authority legacy code (identity_provision gives it to
-- HR-onboarded identities; the employee baseline comes from the lifecycle's
-- employee-self-service role). Its generated compatibility role legacy-guest
-- nevertheless picked up inventory.transfer.cancel through the MEMBER tier
-- (max_role_level 50) of the compatibility rules.
--
-- This migration:
--   1. stops sa_refresh_compat_role from ever creating or filling a
--      compatibility role for GUEST (lifecycle sync, roles trigger). Where
--      legacy_authorization.read_only is false, the next lifecycle sync of a
--      GUEST identity therefore derives no compatibility role;
--   2. removes every legacy-guest assignment (each audited as
--      assignment.removed) and deletes the role; its permission links,
--      review campaigns and authority policies cascade.
--
-- Idempotent: rerunning finds no legacy-guest role and only re-applies the
-- function. Refuses to run while an access request or review item still
-- references the role. No session temp tables; the removal is one statement.
-- Requires 20260928100000_sa_final_governance_foundation.sql.

create or replace function public.sa_refresh_compat_role(p_role_code text, p_create boolean default true)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  v_role_id uuid;
  v_level integer;
  v_perms text[];
  v_key text := public.sa_compat_role_key(p_role_code);
begin
  if p_role_code is null or p_role_code !~ '[a-zA-Z0-9]' then return null; end if;
  -- GUEST carries no authority: it never has a compatibility role.
  if upper(p_role_code) = 'GUEST' then return null; end if;
  select r.role_level,
    coalesce((select array_agg(k) from jsonb_object_keys(case when jsonb_typeof(r.permissions)='object' then r.permissions else '{}'::jsonb end) k
               where coalesce((r.permissions->>k)::boolean, false)), array[]::text[])
    || coalesce((select array_agg(k) from jsonb_array_elements_text(case when jsonb_typeof(r.permissions)='array' then r.permissions else '[]'::jsonb end) k), array[]::text[])
  into v_level, v_perms
  from public.roles r where r.role_code = p_role_code;

  select id into v_role_id from public.sa_business_roles where role_key = v_key;
  if v_role_id is null then
    if not p_create then return null; end if;
    insert into public.sa_business_roles(role_key, name, description, source, status)
    values (v_key, 'Legacy ' || p_role_code,
            'Compatibility-only role generated from the existing role table. Not a target-state business role.',
            'legacy', 'active')
    on conflict (role_key) do nothing
    returning id into v_role_id;
    if v_role_id is null then select id into v_role_id from public.sa_business_roles where role_key = v_key; end if;
  end if;

  insert into public.sa_business_role_permissions(role_id, permission_id)
  select v_role_id, p.id
  from public.sa_legacy_compat_rules c
  join public.sa_permissions p on p.permission_key = c.permission_key and p.status = 'active'
  -- Own-record permissions come only from the lifecycle baseline role with an
  -- own_record scope; a compatibility role (organization scope) must never
  -- hold them.
  where not c.employee_baseline and (
      v_level = 1
      or (c.max_role_level is not null and v_level is not null and v_level <= c.max_role_level)
      or upper(p_role_code) = any(c.role_codes)
      or (v_perms && c.legacy_permissions)
    )
  on conflict do nothing;
  return v_role_id;
end $function$;
revoke all on function public.sa_refresh_compat_role(text, boolean) from public, anon, authenticated;

do $remove$
declare
  v_role uuid;
  v_refs integer;
  v_removed integer := 0;
  v_a record;
begin
  select id into v_role from public.sa_business_roles where role_key = 'legacy-guest' and source = 'legacy';
  if v_role is null then return; end if;
  select (select count(*) from public.sa_access_requests where role_id = v_role)
       + (select count(*) from public.sa_access_review_items where role_id = v_role) into v_refs;
  if v_refs > 0 then
    raise exception 'legacy-guest is referenced by % access request(s)/review item(s); resolve them before removing the role', v_refs;
  end if;
  for v_a in
    select a.id, a.user_id, a.status, a.source, m.organization_id
    from public.sa_role_assignments a join public.sa_organization_memberships m on m.id = a.membership_id
    where a.role_id = v_role
  loop
    perform public.sa_log_access_change(null, 'assignment.removed', v_a.user_id, 'sa_role_assignment', v_a.id::text,
      jsonb_build_object('role_id', v_role, 'role_key', 'legacy-guest', 'organization_id', v_a.organization_id,
                         'previous_status', v_a.status, 'previous_source', v_a.source),
      'legacy-guest compatibility role removed: GUEST carries no authority', 'system');
    v_removed := v_removed + 1;
  end loop;
  delete from public.sa_role_assignments where role_id = v_role;
  delete from public.sa_business_roles where id = v_role;
  perform public.sa_log_access_change(null, 'role.deleted', null, 'sa_business_role', v_role::text,
    jsonb_build_object('role_key', 'legacy-guest', 'assignments_removed', v_removed),
    'legacy-guest compatibility role removed: GUEST carries no authority', 'system');
end $remove$;
