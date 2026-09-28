-- ============================================================================
-- Identity Foundation Stage 1 — closure
-- Staff classification, HR no-authority baseline, application audit actions
-- ----------------------------------------------------------------------------
-- Requires 20260929100000 .. 20260929120000.
--
-- 1. Staff is a canonical identity fact, not a legacy role level.
--    Before: public.sa_actor_is_staff(n) = any active user whose legacy
--    role_level <= n. 55 RLS policies and one trigger use it (verified on
--    staging 2026-09-28). A store-scope consumer carrying a legacy business
--    role (3 on staging) or a shop-style account with USER/POWER_USER (5) was
--    therefore "staff": e.g. it could read every company-less
--    points_transactions row and every QR code through the ungated read
--    policies.
--    After: staff = principal_type INTERNAL_EMPLOYEE, account ACTIVE/INVITED,
--    an active S&A organization membership, and an active S&A role assignment
--    on that membership other than the employee-self-service baseline. The
--    legacy role_level is kept only as a narrowing ceiling (an admin-level
--    check stays an admin-level check); it never grants on its own.
--    Staging impact: 37 internal enterprise users keep staff status; the 3
--    store consumers and 5 shop-style accounts lose it.
--
-- 2. Supply partners keep their operational reads. Manufacturer and
--    distributor users (principal MANUFACTURER_USER / DISTRIBUTOR_USER, same
--    membership/assignment requirements) are not staff, but the manufacturer
--    and order screens read QR and stock tables from the browser. The six
--    ungated read policies they rely on (qr_codes, qr_batches,
--    qr_master_codes, qr_movements, stock_movements, stock_transfers) become
--    "staff OR supply partner" with their existing scoping unchanged.
--    Nothing is widened: these partners passed the old level check.
--
-- 3. HR / department onboarding grants no authority by default:
--    identity_provision gives identities authorized by hr.employee.manage the
--    no-authority legacy code GUEST instead of USER (legacy-user carries 29
--    staff-level compatibility grants; legacy-guest 1). The employee baseline
--    is the lifecycle's employee-self-service role. Any other legacy role is
--    access administration (platform.identity_access.manage, never above the
--    actor's own level). No role named "staff" exists or is created.
--
-- 4. audit_logs.audit_action_valid allowed only INSERT/UPDATE/DELETE, so the
--    application's own audit events were rejected: PASSWORD_RESET
--    (/api/users/reset-password) and BULK_ENABLE_STOCK_CONFIGURATIONS
--    (/api/inventory/stock-configurations/bulk-enable). The constraint keeps
--    its semantics (closed list) and adds exactly these two actions.
--
-- Grants: sa_actor_is_staff keeps its grants (CREATE OR REPLACE); the new
--   sa_actor_is_supply_partner is executable by authenticated/service_role
--   (used inside RLS), not anon. RLS: only the six named SELECT policies
--   change (USING expression); roles/commands unchanged.
-- Idempotent: yes (policy rewrite skips policies already rewritten).
-- No migration mode is changed.
--
-- Rollback guidance:
--   1. restore the previous sa_actor_is_staff body:
--        select exists (select 1 from public.users u join public.roles r on r.role_code = u.role_code
--                        where u.id = auth.uid() and u.is_active is true and r.role_level <= p_max_role_level)
--   2. for the six policies replace "(sa_actor_is_staff(40) OR sa_actor_is_supply_partner())"
--      with "sa_actor_is_staff(40)" (ALTER POLICY ... USING), then drop sa_actor_is_supply_partner();
--   3. re-run section 6 of 20260929110000 (identity_provision) to restore the USER baseline;
--   4. restore audit_action_valid to array['INSERT','UPDATE','DELETE'] (only if no rows use the new actions).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Canonical staff
-- ---------------------------------------------------------------------------
create or replace function public.sa_actor_is_staff(p_max_role_level integer)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1
      from public.users u
      join public.roles r on r.role_code = u.role_code
     where u.id = auth.uid()
       and u.is_active is true
       and u.account_status in ('ACTIVE', 'INVITED')
       and u.principal_type = 'INTERNAL_EMPLOYEE'
       and r.role_level <= p_max_role_level            -- compatibility ceiling only
       and exists (
         select 1
           from public.sa_organization_memberships m
           join public.sa_role_assignments a on a.membership_id = m.id and a.user_id = u.id
           join public.sa_business_roles br on br.id = a.role_id
          where m.user_id = u.id
            and m.status = 'active'
            and (m.effective_until is null or m.effective_until > now())
            and a.status = 'active'
            and (a.effective_until is null or a.effective_until > now())
            and br.status = 'active'
            and br.role_key <> 'employee-self-service'))
$$;
comment on function public.sa_actor_is_staff(integer) is
  'Canonical internal staff: INTERNAL_EMPLOYEE, active account, active S&A membership and a non-baseline S&A role assignment. The legacy role level is only a narrowing ceiling and never grants by itself.';

create or replace function public.sa_actor_is_supply_partner()
returns boolean
language sql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1
      from public.users u
      join public.roles r on r.role_code = u.role_code
     where u.id = auth.uid()
       and u.is_active is true
       and u.account_status in ('ACTIVE', 'INVITED')
       and u.principal_type in ('MANUFACTURER_USER', 'DISTRIBUTOR_USER')
       and r.role_level <= 40                            -- same ceiling the policies used
       and exists (
         select 1
           from public.sa_organization_memberships m
           join public.sa_role_assignments a on a.membership_id = m.id and a.user_id = u.id
           join public.sa_business_roles br on br.id = a.role_id
          where m.user_id = u.id
            and m.status = 'active'
            and (m.effective_until is null or m.effective_until > now())
            and a.status = 'active'
            and (a.effective_until is null or a.effective_until > now())
            and br.status = 'active'
            and br.role_key <> 'employee-self-service'))
$$;
revoke all on function public.sa_actor_is_supply_partner() from public, anon;
grant execute on function public.sa_actor_is_supply_partner() to authenticated, service_role;
comment on function public.sa_actor_is_supply_partner() is
  'Manufacturer/distributor enterprise user with an active S&A membership and assignment. Used only for the supply-chain operational read policies; never implies staff.';

-- ---------------------------------------------------------------------------
-- 2. Supply partners keep the operational reads they already had
-- ---------------------------------------------------------------------------
do $partner$
declare
  r record;
  v_qual text;
  v_new text;
begin
  -- Deparse with a minimal search_path so every name is schema-qualified.
  perform set_config('search_path', 'pg_catalog', true);
  for r in
    select * from (values
      ('qr_codes', 'sa_staff_read'), ('qr_batches', 'sa_staff_read'), ('qr_master_codes', 'sa_staff_read'),
      ('qr_movements', 'sa_scoped_staff_read'), ('stock_movements', 'stock_movements_view_all'),
      ('stock_transfers', 'stock_transfers_view_all')) as t(tbl, pol)
  loop
    select pg_get_expr(p.polqual, p.polrelid) into v_qual
    from pg_policy p where p.polrelid = to_regclass('public.' || r.tbl) and p.polname = r.pol;
    if v_qual is null then
      raise notice 'policy %.% not present, skipped', r.tbl, r.pol;
      continue;
    end if;
    if v_qual like '%sa_actor_is_supply_partner%' then continue; end if;
    if v_qual not like '%public.sa_actor_is_staff(40)%' then
      raise exception 'policy %.% does not have the expected staff clause: %', r.tbl, r.pol, v_qual;
    end if;
    v_new := replace(v_qual, 'public.sa_actor_is_staff(40)',
                     '(public.sa_actor_is_staff(40) OR public.sa_actor_is_supply_partner())');
    execute format('alter policy %I on public.%I using (%s)', r.pol, r.tbl, v_new);
  end loop;
  perform set_config('search_path', 'pg_catalog, public', true);
end
$partner$;

-- ---------------------------------------------------------------------------
-- 3. HR / department onboarding: no authority by default
-- ---------------------------------------------------------------------------
create or replace function public.identity_provision(p_actor uuid, p_user uuid, p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_email text := public.identity_normalize_email(p_payload->>'email');
  v_phone text := public.identity_normalize_phone(nullif(p_payload->>'phone', ''));
  v_org uuid := nullif(p_payload->>'organization_id', '')::uuid;
  v_scope text := coalesce(nullif(p_payload->>'account_scope', ''), case when v_org is null then 'store' else 'portal' end);
  v_perm text := coalesce(nullif(p_payload->>'authorizing_permission', ''), 'platform.user.manage');
  v_created boolean := coalesce((p_payload->>'created_identity')::boolean, false);
  v_source text := coalesce(nullif(p_payload->>'source', ''), 'api');
  v_org_type text;
  v_principal text;
  v_role_code text;
  v_baseline text;
  v_res jsonb;
  v_existing record;
  v_outcome text;
  v_membership uuid;
  v_assignment uuid;
  v_scope_ids uuid[];
  v_legacy boolean;
begin
  if p_actor is null or p_user is null then raise exception 'identity_actor_and_user_required' using errcode = '22023'; end if;
  if p_actor = p_user then raise exception 'identity_self_provisioning_prohibited' using errcode = '42501'; end if;
  if v_email is null then raise exception 'identity_email_invalid' using errcode = '22023'; end if;
  if nullif(p_payload->>'phone', '') is not null and v_phone is null then raise exception 'identity_phone_invalid' using errcode = '22023'; end if;
  if v_scope not in ('portal','store') then raise exception 'identity_account_scope_invalid' using errcode = '22023'; end if;
  if v_scope = 'portal' and v_org is null then raise exception 'identity_organization_required' using errcode = '22023'; end if;
  if v_perm not in ('platform.user.manage','hr.employee.manage') then raise exception 'identity_authorizing_permission_invalid' using errcode = '22023'; end if;
  if v_perm = 'hr.employee.manage' and v_scope <> 'portal' then raise exception 'identity_hr_requires_enterprise' using errcode = '22023'; end if;

  if v_org is not null then
    select o.org_type_code into v_org_type from public.organizations o where o.id = v_org and o.is_active is not false;
    if not found then raise exception 'identity_organization_unknown' using errcode = '22023'; end if;
  end if;
  v_principal := public.identity_derive_principal_type(v_scope, v_org_type);
  if nullif(p_payload->>'expected_principal_type', '') is not null and p_payload->>'expected_principal_type' <> v_principal then
    raise exception 'identity_principal_type_mismatch' using errcode = '22023',
      detail = format('requested %s, organization implies %s', p_payload->>'expected_principal_type', v_principal);
  end if;

  -- Authorization (identity management; organization of the new identity, or
  -- the actor's own organization for a consumer without one).
  v_legacy := case when v_perm = 'hr.employee.manage' then public.identity_legacy_hr_admin(p_actor)
                   else public.identity_legacy_user_admin(p_actor) end;
  perform public.sa_assert_actor_permission(p_actor, v_perm,
    jsonb_build_object('organization_id', coalesce(v_org, (select u.organization_id from public.users u where u.id = p_actor))),
    v_legacy);

  -- Legacy role code: baseline unless explicitly requested; anything above the
  -- baseline is access administration, never implied by identity management.
  -- HR / department onboarding grants no authority by default: the legacy
  -- compatibility code is the no-authority GUEST (never USER, which carries
  -- staff-level compatibility grants); the employee baseline comes from the
  -- lifecycle (employee-self-service). Anything else is access administration.
  v_baseline := case when v_perm = 'hr.employee.manage' and v_principal <> 'CONSUMER' then 'GUEST'
                     else public.identity_baseline_role_code(v_principal) end;
  v_role_code := coalesce(nullif(p_payload->>'legacy_role_code', ''), v_baseline);
  if v_role_code <> v_baseline then
    if not public.identity_legacy_role_grant_allowed(p_actor, v_role_code) then
      raise exception 'identity_role_grant_not_allowed' using errcode = '42501',
        detail = format('role %s is unknown, inactive or above the actor''s own level', v_role_code);
    end if;
    perform public.sa_assert_actor_permission(p_actor, 'platform.identity_access.manage',
      jsonb_build_object('organization_id', coalesce(v_org, (select u.organization_id from public.users u where u.id = p_actor))),
      public.identity_legacy_access_admin(p_actor));
  end if;

  -- Serialize concurrent provisioning of the same identifiers.
  perform pg_advisory_xact_lock(hashtextextended('identity:' || v_email, 0));
  if v_phone is not null then perform pg_advisory_xact_lock(hashtextextended('identity:' || v_phone, 0)); end if;

  v_res := public.identity_resolve(v_email, v_phone);
  if v_res->>'outcome' <> 'MATCH' or (v_res->>'user_id')::uuid is distinct from p_user then
    perform public.identity_record_conflict(
      case when v_res->>'outcome' in ('IDENTITY_CONFLICT','IDENTITY_AMBIGUOUS_EMAIL','IDENTITY_AMBIGUOUS_PHONE',
                                       'IDENTITY_VERIFICATION_REQUIRED','IDENTITY_ARCHIVED')
           then v_res->>'outcome' else 'IDENTITY_CONFLICT' end,
      v_res, v_email, v_phone, v_source, p_actor, jsonb_build_object('stage', 'provision', 'expected_user_id', p_user));
    -- Returned (not raised) so the conflict record commits; the server
    -- compensates (deletes an auth user it created) on any non-success.
    return jsonb_build_object('status', 'blocked', 'code', coalesce(nullif(v_res->>'outcome', 'MATCH'), 'IDENTITY_CONFLICT'),
                              'user_id', null, 'matched_user_ids', v_res->'matched_user_ids');
  end if;

  select u.id, u.account_scope, u.organization_id, u.account_status, u.principal_type
    into v_existing from public.users u where u.id = p_user;

  if not found then
    insert into public.users (id, email, full_name, call_name, phone, role_code, organization_id, account_scope,
                              account_status, is_verified, email_verified_at, phone_verified_at, employment_status,
                              department_id, manager_user_id, position_id, employment_type, join_date)
    values (p_user, v_email, nullif(p_payload->>'full_name', ''), nullif(p_payload->>'call_name', ''), v_phone,
            v_role_code, v_org, v_scope, 'ACTIVE', true, now(),
            case when v_phone is not null and coalesce((p_payload->>'phone_verified')::boolean, false) then now() end,
            'active',
            nullif(p_payload->>'department_id', '')::uuid, nullif(p_payload->>'manager_user_id', '')::uuid,
            nullif(p_payload->>'position_id', '')::uuid, nullif(p_payload->>'employment_type', ''),
            nullif(p_payload->>'join_date', '')::date);
    v_outcome := 'CREATED';
  else
    -- Reuse: identifiers and access of an existing identity are never changed
    -- here (no silent merge, no silent move/upgrade).
    if v_existing.account_status = 'ARCHIVED' then
      perform public.identity_record_conflict('IDENTITY_ARCHIVED', v_res, v_email, v_phone, v_source, p_actor, '{}'::jsonb);
      return jsonb_build_object('status', 'blocked', 'code', 'IDENTITY_ARCHIVED', 'user_id', p_user);
    end if;
    if v_existing.account_status not in ('ACTIVE','INVITED') then
      perform public.identity_record_conflict('IDENTITY_INACTIVE', v_res, v_email, v_phone, v_source, p_actor, '{}'::jsonb);
      return jsonb_build_object('status', 'blocked', 'code', 'IDENTITY_INACTIVE', 'user_id', p_user);
    end if;
    if v_existing.principal_type = 'CONSUMER' and v_principal <> 'CONSUMER' then
      perform public.identity_record_conflict('IDENTITY_PRINCIPAL_UPGRADE_REQUIRED', v_res, v_email, v_phone, v_source, p_actor, '{}'::jsonb);
      return jsonb_build_object('status', 'blocked', 'code', 'IDENTITY_PRINCIPAL_UPGRADE_REQUIRED', 'user_id', p_user);
    end if;
    if v_existing.organization_id is distinct from v_org or v_existing.account_scope <> v_scope then
      perform public.identity_record_conflict('IDENTITY_ORG_MOVE_REQUIRED', v_res, v_email, v_phone, v_source, p_actor, '{}'::jsonb);
      return jsonb_build_object('status', 'blocked', 'code', 'IDENTITY_ORG_MOVE_REQUIRED', 'user_id', p_user);
    end if;
    -- Same identity, same organization: HR facts may be completed, nothing else.
    if v_perm = 'hr.employee.manage' then
      update public.users u set
        department_id = coalesce(nullif(p_payload->>'department_id', '')::uuid, u.department_id),
        manager_user_id = coalesce(nullif(p_payload->>'manager_user_id', '')::uuid, u.manager_user_id),
        position_id = coalesce(nullif(p_payload->>'position_id', '')::uuid, u.position_id),
        employment_type = coalesce(nullif(p_payload->>'employment_type', ''), u.employment_type),
        join_date = coalesce(nullif(p_payload->>'join_date', '')::date, u.join_date)
      where u.id = p_user;
    end if;
    v_outcome := 'REUSED';
  end if;

  -- Organization-owned HR references must belong to the identity's organization.
  if exists (select 1 from public.users u
             where u.id = p_user and (
               (u.department_id is not null and not exists (select 1 from public.departments d where d.id = u.department_id and d.organization_id = u.organization_id))
               or (u.manager_user_id is not null and not exists (select 1 from public.users m where m.id = u.manager_user_id and m.organization_id = u.organization_id))
               or (u.position_id is not null and not exists (select 1 from public.hr_positions p where p.id = u.position_id and p.organization_id = u.organization_id)))) then
    raise exception 'identity_hr_reference_outside_organization' using errcode = '22023';
  end if;

  -- Membership + baseline come from the lifecycle trigger (enterprise only).
  select m.id into v_membership from public.sa_organization_memberships m
  where m.user_id = p_user and m.organization_id = v_org and m.status = 'active' limit 1;
  if v_principal <> 'CONSUMER' and v_membership is null then
    raise exception 'identity_membership_not_established' using errcode = 'P0001';
  end if;
  if v_principal = 'CONSUMER' and exists (select 1 from public.sa_organization_memberships m where m.user_id = p_user and m.status = 'active') then
    raise exception 'identity_consumer_must_not_hold_enterprise_membership' using errcode = 'P0001';
  end if;

  -- Optional initial S&A business role (access administration).
  if nullif(p_payload->>'initial_role_id', '') is not null then
    if v_principal = 'CONSUMER' then raise exception 'identity_consumer_cannot_receive_business_role' using errcode = '42501'; end if;
    select coalesce(array_agg(x::uuid), '{}') into v_scope_ids
    from jsonb_array_elements_text(coalesce(p_payload->'initial_scope_ids', '[]'::jsonb)) x;
    if cardinality(v_scope_ids) = 0 then
      select array[d.id] into v_scope_ids from public.sa_scope_definitions d
      where d.organization_id = v_org and d.scope_value = v_org::text and d.status = 'active'
        and d.scope_type in ('organization','warehouse') limit 1;
    end if;
    v_assignment := public.sa_assign_role(p_actor, p_user, (p_payload->>'initial_role_id')::uuid, v_org, v_scope_ids,
                                          now(), null, coalesce(nullif(p_payload->>'initial_reason', ''), 'Initial access at provisioning'));
  end if;

  perform public.sa_log_access_change(p_actor, 'identity.provisioned', p_user, 'user', p_user::text,
    jsonb_build_object('outcome', v_outcome, 'source', v_source, 'principal_type', v_principal,
                       'organization_id', v_org, 'legacy_role_code', case when v_outcome = 'CREATED' then v_role_code end,
                       'created_identity', v_created, 'authorizing_permission', v_perm,
                       'initial_assignment_id', v_assignment),
    nullif(p_payload->>'reason', ''), 'user');

  return jsonb_build_object('status', 'ok', 'outcome', v_outcome, 'user_id', p_user, 'principal_type', v_principal,
                            'membership_id', v_membership, 'initial_assignment_id', v_assignment,
                            'legacy_role_code', (select u.role_code from public.users u where u.id = p_user));
end $$;
revoke all on function public.identity_provision(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.identity_provision(uuid,uuid,jsonb) to service_role;
comment on function public.identity_provision(uuid,uuid,jsonb) is
  'Canonical provisioning core (one transaction): authorize, re-resolve, create/verify profile, lifecycle membership + baseline, optional initial S&A role, audit. HR/department onboarding receives the no-authority legacy code GUEST. Blocked resolutions are recorded and returned as status=blocked (the server then deletes an auth user it created).';

-- ---------------------------------------------------------------------------
-- 4. Application audit actions
-- ---------------------------------------------------------------------------
alter table public.audit_logs drop constraint if exists audit_action_valid;
alter table public.audit_logs add constraint audit_action_valid check (
  action = any (array['INSERT'::text, 'UPDATE'::text, 'DELETE'::text,
                      'PASSWORD_RESET'::text, 'BULK_ENABLE_STOCK_CONFIGURATIONS'::text])) not valid;
alter table public.audit_logs validate constraint audit_action_valid;

-- ---------------------------------------------------------------------------
-- 5. Post-conditions
-- ---------------------------------------------------------------------------
do $$
declare v_bad integer;
begin
  if position('INTERNAL_EMPLOYEE' in pg_get_functiondef('public.sa_actor_is_staff(integer)'::regprocedure)) = 0
     or position('employee-self-service' in pg_get_functiondef('public.sa_actor_is_staff(integer)'::regprocedure)) = 0 then
    raise exception 'postcondition: sa_actor_is_staff must require the canonical staff identity';
  end if;
  select count(*) into v_bad from pg_policy p
  where p.polrelid in (to_regclass('public.qr_codes'), to_regclass('public.qr_batches'), to_regclass('public.qr_master_codes'),
                       to_regclass('public.qr_movements'), to_regclass('public.stock_movements'), to_regclass('public.stock_transfers'))
    and p.polname in ('sa_staff_read', 'sa_scoped_staff_read', 'stock_movements_view_all', 'stock_transfers_view_all')
    and pg_get_expr(p.polqual, p.polrelid) not like '%sa_actor_is_supply_partner%';
  if v_bad > 0 then raise exception 'postcondition: % supply-partner read policies not rewritten', v_bad; end if;
  select count(*) into v_bad from pg_policies
  where schemaname = 'public' and (coalesce(qual, '') || coalesce(with_check, '')) like '%sa_actor_is_supply_partner%'
    and cmd <> 'SELECT';
  if v_bad > 0 then raise exception 'postcondition: supply-partner access must be read-only'; end if;
  if has_function_privilege('anon', 'public.sa_actor_is_supply_partner()', 'EXECUTE') then
    raise exception 'postcondition: sa_actor_is_supply_partner must not be executable by anon';
  end if;
  if position('''GUEST''' in pg_get_functiondef('public.identity_provision(uuid,uuid,jsonb)'::regprocedure)) = 0 then
    raise exception 'postcondition: HR baseline must be the no-authority legacy code';
  end if;
  if pg_get_constraintdef((select oid from pg_constraint where conname = 'audit_action_valid' and conrelid = 'public.audit_logs'::regclass))
     not like '%PASSWORD_RESET%' then
    raise exception 'postcondition: PASSWORD_RESET must be a valid audit action';
  end if;
  if (select count(*) from public.sa_migration_modes where permission_key like 'platform.identity%' and mode <> 'SHADOW') > 0 then
    raise exception 'postcondition: identity permissions must remain SHADOW';
  end if;
end $$;
