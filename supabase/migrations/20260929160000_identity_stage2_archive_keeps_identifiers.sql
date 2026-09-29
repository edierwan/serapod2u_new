-- ============================================================================
-- Identity Foundation Stage 2 — archived identities keep their identifiers
-- ----------------------------------------------------------------------------
-- Decision (management, 2026-09-29): archiving keeps the real email and phone
-- on the archived identity (identifiers stay reserved). The same person is
-- never re-created as a second identity: a returning person is REACTIVATED.
--
--   * ARCHIVED stays terminal for every writer (legacy is_active toggles,
--     API roles, provisioning), except an audited reactivation to ACTIVE by
--     identity_set_account_status, which requires platform.identity.delete
--     (Super Admin in legacy modes) and logs 'identity.reactivated'.
--   * identity_resolve already reports IDENTITY_ARCHIVED for a match, so
--     provisioning blocks re-creation and points to reactivation.
--   * The application stops rewriting email/phone to placeholders when it
--     archives, and bans/unbans the login identity (GoTrue) on archive/
--     reactivation (application change in the same release).
--
-- Existing archived rows that already carry placeholder identifiers are left
-- as they are (history).
-- Security: functions keep SECURITY DEFINER, pinned search_path and
-- service-role-only execution. Idempotent: yes. No migration mode changes.
--
-- Rollback guidance: re-run sections 2 and 7 of 20260929110000 (previous
-- definitions of identity_users_projection and identity_set_account_status).
-- ============================================================================

create or replace function public.identity_users_projection()
returns trigger language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_org_type text;
  v_derived text;
begin
  select o.org_type_code into v_org_type from public.organizations o where o.id = new.organization_id;
  v_derived := public.identity_derive_principal_type(new.account_scope, v_org_type);
  if tg_op = 'INSERT' then
    if new.principal_type is not null and new.principal_type <> v_derived then
      raise exception 'identity_principal_type_mismatch' using errcode = '22023',
        detail = format('requested %s, account scope/organization imply %s', new.principal_type, v_derived);
    end if;
    new.principal_type := v_derived;
    if new.account_status is null then
      new.account_status := case when new.is_active is false then 'DISABLED' else 'ACTIVE' end;
    end if;
    new.is_active := new.account_status in ('ACTIVE','INVITED');
    new.account_status_changed_at := coalesce(new.account_status_changed_at, now());
    return new;
  end if;

  -- UPDATE: re-derive only when the inputs change (an unrelated profile edit
  -- never flips the principal type).
  if new.principal_type is distinct from old.principal_type and new.principal_type is distinct from v_derived then
    raise exception 'identity_principal_type_mismatch' using errcode = '22023',
      detail = format('requested %s, account scope/organization imply %s', new.principal_type, v_derived);
  end if;
  if new.account_scope is distinct from old.account_scope
     or new.organization_id is distinct from old.organization_id
     or new.principal_type is distinct from old.principal_type then
    new.principal_type := v_derived;
  end if;

  -- ARCHIVED is terminal except for an audited reactivation by
  -- identity_set_account_status (Super Admin; one human = one identity: a
  -- returning person is reactivated, never re-created).
  if old.account_status = 'ARCHIVED'
     and (new.account_status is distinct from old.account_status or new.is_active is distinct from old.is_active)
     and not (coalesce(current_setting('identity.reactivating', true), '') = 'on' and new.account_status = 'ACTIVE') then
    raise exception 'identity_archived_is_terminal' using errcode = '42501';
  end if;
  if new.account_status is distinct from old.account_status then
    new.is_active := new.account_status in ('ACTIVE','INVITED');
    new.account_status_changed_at := now();
  elsif new.is_active is distinct from old.is_active then
    -- Legacy writers toggle is_active only; map to the canonical status.
    new.account_status := case when new.is_active is true then 'ACTIVE' else 'DISABLED' end;
    new.is_active := new.account_status in ('ACTIVE','INVITED');
    new.account_status_changed_at := now();
  end if;

  -- An identifier change is not a verification.
  if public.normalize_phone_e164(new.phone) is distinct from old.phone
     and new.phone_verified_at is not distinct from old.phone_verified_at then
    new.phone_verified_at := null;
  end if;
  if new.email is distinct from old.email and new.email_verified_at is not distinct from old.email_verified_at
     and lower(btrim(coalesce(new.email, ''))) <> lower(btrim(coalesce(old.email, ''))) then
    new.email_verified_at := null;
  end if;
  return new;
end $$;
revoke all on function public.identity_users_projection() from public, anon, authenticated;

create or replace function public.identity_set_account_status(p_actor uuid, p_user uuid, p_status text, p_reason text)
returns text language plpgsql volatile security definer set search_path = pg_catalog, pg_temp as $$
declare v_old text; v_org uuid; v_perm text;
begin
  if p_status not in ('ACTIVE','SUSPENDED','DISABLED','ARCHIVED') then raise exception 'identity_status_invalid' using errcode = '22023'; end if;
  if p_actor is null or p_user is null then raise exception 'identity_actor_and_user_required' using errcode = '22023'; end if;
  if p_actor = p_user then raise exception 'identity_self_status_change_prohibited' using errcode = '42501'; end if;
  if p_reason is null or length(btrim(p_reason)) < 5 then raise exception 'identity_reason_required' using errcode = '22023'; end if;
  select u.account_status, u.organization_id into v_old, v_org from public.users u where u.id = p_user for update;
  if not found then raise exception 'identity_unknown' using errcode = '22023'; end if;
  -- Archiving and reactivating an archived identity are Super Admin actions.
  v_perm := case when p_status = 'ARCHIVED' or v_old = 'ARCHIVED' then 'platform.identity.delete' else 'platform.identity.disable' end;
  perform public.sa_assert_actor_permission(p_actor, v_perm,
    jsonb_build_object('organization_id', coalesce(v_org, (select u.organization_id from public.users u where u.id = p_actor))),
    case when v_perm = 'platform.identity.delete' then public.sa_legacy_is_super_admin(p_actor) else public.identity_legacy_user_admin(p_actor) end);
  if v_old = p_status then return v_old; end if;
  if v_old = 'ARCHIVED' and p_status <> 'ACTIVE' then
    raise exception 'identity_archived_is_terminal' using errcode = '42501', hint = 'An archived identity can only be reactivated.';
  end if;
  if v_old = 'ARCHIVED' then perform set_config('identity.reactivating', 'on', true); end if;
  update public.users set account_status = p_status, account_status_reason = left(btrim(p_reason), 500) where id = p_user;
  perform set_config('identity.reactivating', 'off', true);
  perform public.sa_log_access_change(p_actor, case when v_old = 'ARCHIVED' then 'identity.reactivated' else 'identity.status_changed' end,
    p_user, 'user', p_user::text, jsonb_build_object('from', v_old, 'to', p_status), p_reason, 'user');
  return p_status;
end $$;
revoke all on function public.identity_set_account_status(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.identity_set_account_status(uuid,uuid,text,text) to service_role;

do $$
begin
  if position('identity.reactivating' in pg_get_functiondef('public.identity_users_projection()'::regprocedure)) = 0
     or position('identity.reactivated' in pg_get_functiondef('public.identity_set_account_status(uuid,uuid,text,text)'::regprocedure)) = 0 then
    raise exception 'postcondition: archived-identity reactivation path missing';
  end if;
  if has_function_privilege('authenticated', 'public.identity_set_account_status(uuid,uuid,text,text)', 'EXECUTE') then
    raise exception 'postcondition: account status function must stay service-role only';
  end if;
end $$;
