-- ============================================================================
-- Identity Foundation Stage 1 — 2/3
-- Central identity: principal type, account lifecycle, identifier
-- normalization, identity resolution, conflict audit, canonical provisioning
-- ----------------------------------------------------------------------------
-- Canonical rule: ONE HUMAN = ONE CENTRAL IDENTITY.
--   auth.users.id = public.users.id = the central actor UUID (unchanged; still
--   the only primary key). Email and phone are login aliases and
--   identity-resolution keys, never keys.
--
-- Purpose
--   1. Normalization: identity_normalize_email (trim + lowercase) and
--      identity_normalize_phone (strict E.164; Malaysian 0…/60…/+60… forms;
--      never guesses a country for an ambiguous number). Mirrored exactly by
--      app/src/lib/identity/normalize.ts (tested).
--   2. users.principal_type — the human principal type, DERIVED from
--      account_scope + organization type (single source of truth, no second
--      identity table):
--        store                       → CONSUMER
--        portal + DIST               → DISTRIBUTOR_USER
--        portal + MFG                → MANUFACTURER_USER
--        portal + SHOP               → SHOP_STAFF
--        portal + HQ / WH / other    → INTERNAL_EMPLOYEE
--      Non-human principals (SERVICE_IDENTITY / INTEGRATION_PRINCIPAL) are NOT
--      users: they stay in sa_service_identities (principal_type column added
--      there, derived from identity_kind).
--   3. users.account_status — INVITED | ACTIVE | SUSPENDED | DISABLED |
--      ARCHIVED, kept consistent with the legacy is_active flag in both
--      directions (is_active = status IN (ACTIVE, INVITED)). ARCHIVED is
--      terminal. Backfill: is_active → ACTIVE, otherwise DISABLED. No other
--      data is rewritten.
--   4. users.email_normalized (generated) for resolution/uniqueness; a phone
--      change without an explicit verification change clears
--      phone_verified_at (an unverified phone never proves ownership).
--   5. identity_conflicts — append-only audit of every blocked resolution
--      (conflict code + raw user ids + SHA-256 fingerprints; no raw
--      email/phone values).
--   6. identity_resolve() — the single resolution rule set;
--      identity_provision() — transactional provisioning core (profile →
--      membership/baseline via the existing lifecycle → optional initial S&A
--      role); identity_set_account_status(); identity_admin_update_access();
--      identity_legacy_role_grant_allowed() (no privilege escalation through
--      legacy role codes).
--   7. Identity permissions (S&A catalogue; modes seeded SHADOW — no mode is
--      enforced by this migration):
--        platform.identity.view, platform.identity.disable,
--        platform.identity.delete, platform.identity_access.manage.
--      platform.user.manage remains the identity/profile-manage permission.
--      Identity/profile editing and access administration stay separate.
--
-- Security rationale
--   * Every function is SECURITY DEFINER with a pinned search_path and is
--     executable by service_role only (the trusted server acts after verifying
--     the human actor); each mutating function re-asserts the actor's S&A
--     permission in the database (sa_assert_actor_permission: new modes use the
--     S&A decision, legacy modes the legacy rule passed in).
--   * Legacy role codes can never be granted above the actor's own legacy level
--     (Super Admin only by Super Admin) — closes the createUserForDepartment
--     escalation at the database layer.
--   * Consumers never receive enterprise memberships (lifecycle keys on
--     account_scope; principal_type is derived and consistent with it).
--   * No silent merge: conflicting identifiers raise and are audited.
--
-- Grants / RLS
--   identity_conflicts: RLS enabled, no policies, no anon/authenticated grants;
--   service_role select/insert only (append-only + no-truncate triggers).
--   All new functions: revoked from public/anon/authenticated; service_role
--   execute only (normalizers: immutable helpers, executable by authenticated).
--
-- Compatibility
--   The lifecycle trigger sa_users_lifecycle is re-created to also fire on
--   account_status / principal_type (BEFORE-trigger changes to is_active are
--   not in an UPDATE's SET list and would otherwise not fire it). SUSPENDED
--   currently maps to is_active=false and therefore follows the existing
--   leaver path (access revoked); preserve-and-restore is Stage 2.
--
-- Idempotent: yes (IF NOT EXISTS / CREATE OR REPLACE / ON CONFLICT).
-- Requires: 20260928100000..20260928130000 (Final Wave), 20260929100000.
--
-- Rollback guidance (reverse order; data added here is disposable):
--   drop trigger users_identity_projection on public.users;
--   drop trigger sa_users_lifecycle on public.users; then re-create it exactly
--     as in 20260928110000 (after insert or update of is_active,
--     employment_status, organization_id, role_code, account_scope,
--     employment_type);
--   drop function identity_* (all, this file);
--   drop table public.identity_conflicts;
--   alter table public.users drop constraint users_principal_type_valid,
--     drop constraint users_account_status_valid,
--     drop constraint users_account_status_matches_is_active,
--     drop column email_normalized, drop column account_status_reason,
--     drop column account_status_changed_at, drop column account_status,
--     drop column principal_type;
--   alter table public.sa_service_identities drop column principal_type;
--   delete the four platform.identity* permission rows (modes, compat rules,
--     readiness, role grants cascade) and the identity-administrator role.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Normalization
-- ---------------------------------------------------------------------------
create or replace function public.identity_normalize_email(p_email text)
returns text language sql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
  select case
    when p_email is null or btrim(p_email) = '' then null
    when lower(btrim(p_email)) !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' then null
    else lower(btrim(p_email))
  end
$$;
comment on function public.identity_normalize_email(text) is
  'Canonical email for identity comparison: trim + lowercase; NULL when empty or malformed. Mirrors app/src/lib/identity/normalize.ts.';

create or replace function public.identity_normalize_phone(p_phone text)
returns text language plpgsql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
declare
  v_raw text := btrim(coalesce(p_phone, ''));
  v_digits text;
  v_e164 text;
begin
  if v_raw = '' then return null; end if;
  -- Only digits, one leading '+', and common separators are accepted.
  if v_raw !~ '^\+?[0-9 ()./-]+$' then return null; end if;
  v_digits := regexp_replace(v_raw, '[^0-9]', '', 'g');
  if v_digits = '' then return null; end if;

  if v_raw like '+%' then
    v_e164 := v_digits;                          -- explicit international
  elsif v_digits like '00%' then
    v_e164 := substr(v_digits, 3);               -- 00 international prefix
  elsif v_digits ~ '^0[1-9][0-9]{7,9}$' then
    v_e164 := '60' || substr(v_digits, 2);       -- Malaysian national (01x…, 03…)
  elsif v_digits ~ '^60[1-9][0-9]{7,9}$' then
    v_e164 := v_digits;                          -- Malaysian with country code, no '+'
  else
    return null;                                 -- ambiguous: never guess a country
  end if;

  if v_e164 !~ '^[1-9][0-9]{7,14}$' then return null; end if;
  -- Malaysian numbers: 60 + 8..10 national digits, first national digit 1-9.
  if v_e164 like '60%' and v_e164 !~ '^60[1-9][0-9]{7,9}$' then return null; end if;
  return '+' || v_e164;
end $$;
comment on function public.identity_normalize_phone(text) is
  'Strict canonical phone for identity resolution: E.164 (+CC…). Malaysian 01x/03…, 601x…, +601x… are accepted; numbers without a country prefix that are not Malaysian national format return NULL (no guessing). Mirrors app/src/lib/identity/normalize.ts.';

revoke all on function public.identity_normalize_email(text) from public, anon;
revoke all on function public.identity_normalize_phone(text) from public, anon;
grant execute on function public.identity_normalize_email(text) to authenticated, service_role;
grant execute on function public.identity_normalize_phone(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Principal type + account lifecycle on the central identity
-- ---------------------------------------------------------------------------
create or replace function public.identity_derive_principal_type(p_account_scope text, p_org_type text)
returns text language sql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
  select case
    when p_account_scope is distinct from 'portal' then 'CONSUMER'
    when p_org_type = 'DIST' then 'DISTRIBUTOR_USER'
    when p_org_type = 'MFG' then 'MANUFACTURER_USER'
    when p_org_type = 'SHOP' then 'SHOP_STAFF'
    else 'INTERNAL_EMPLOYEE'
  end
$$;
revoke all on function public.identity_derive_principal_type(text,text) from public, anon;
grant execute on function public.identity_derive_principal_type(text,text) to authenticated, service_role;

alter table public.users add column if not exists principal_type text;
alter table public.users add column if not exists account_status text;
alter table public.users add column if not exists account_status_changed_at timestamptz;
alter table public.users add column if not exists account_status_reason text;
alter table public.users add column if not exists email_normalized text
  generated always as (public.identity_normalize_email(email)) stored;

comment on column public.users.principal_type is
  'Human principal type, derived from account_scope + organization type (identity_derive_principal_type). CONSUMER ⇔ account_scope = store. Non-human principals live in sa_service_identities.';
comment on column public.users.account_status is
  'Canonical account lifecycle: INVITED | ACTIVE | SUSPENDED | DISABLED | ARCHIVED. is_active is the compatibility projection (ACTIVE/INVITED). ARCHIVED is terminal.';
comment on column public.users.email_normalized is
  'identity_normalize_email(email): trim + lowercase. Identity-resolution key; not a primary key.';

-- Backfill (only these new columns; existing columns are not rewritten). One
-- statement: updated_at is not bumped (set_users_updated_at is suspended for
-- the backfill only and re-enabled in the same statement); no other users
-- trigger reacts to these new columns.
do $backfill$
begin
  execute 'alter table public.users disable trigger set_users_updated_at';

  update public.users u
  set principal_type = public.identity_derive_principal_type(u.account_scope, o.org_type_code)
  from (select u2.id, o2.org_type_code from public.users u2
        left join public.organizations o2 on o2.id = u2.organization_id) o
  where o.id = u.id and u.principal_type is distinct from public.identity_derive_principal_type(u.account_scope, o.org_type_code);

  update public.users
  set account_status = case when is_active is false then 'DISABLED' else 'ACTIVE' end,
      account_status_changed_at = coalesce(account_status_changed_at, now())
  where account_status is null;

  -- is_active has no NULLs today (verified on staging); keep the projection total.
  update public.users set is_active = true where is_active is null and account_status = 'ACTIVE';

  execute 'alter table public.users enable trigger set_users_updated_at';
end
$backfill$;

alter table public.users drop constraint if exists users_principal_type_valid;
alter table public.users add constraint users_principal_type_valid check (
  principal_type in ('INTERNAL_EMPLOYEE','DISTRIBUTOR_USER','MANUFACTURER_USER','SHOP_STAFF','CONSUMER')
  and (principal_type = 'CONSUMER') = (account_scope = 'store')) not valid;
alter table public.users validate constraint users_principal_type_valid;

alter table public.users drop constraint if exists users_account_status_valid;
alter table public.users add constraint users_account_status_valid check (
  account_status in ('INVITED','ACTIVE','SUSPENDED','DISABLED','ARCHIVED')) not valid;
alter table public.users validate constraint users_account_status_valid;

alter table public.users drop constraint if exists users_account_status_matches_is_active;
alter table public.users add constraint users_account_status_matches_is_active check (
  is_active is not distinct from (account_status in ('ACTIVE','INVITED'))) not valid;
alter table public.users validate constraint users_account_status_matches_is_active;

alter table public.users alter column principal_type set not null;
alter table public.users alter column account_status set not null;

create index if not exists users_email_normalized_idx on public.users (email_normalized);
create index if not exists users_principal_type_idx on public.users (principal_type);

-- Projection trigger: keeps principal_type derived, account_status ⇔ is_active
-- consistent, ARCHIVED terminal, and phone verification honest.
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

  if old.account_status = 'ARCHIVED'
     and (new.account_status is distinct from old.account_status or new.is_active is distinct from old.is_active) then
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

drop trigger if exists users_identity_projection on public.users;
create trigger users_identity_projection
before insert or update on public.users
for each row execute function public.identity_users_projection();

-- Lifecycle must also react to canonical status / principal changes.
drop trigger if exists sa_users_lifecycle on public.users;
create trigger sa_users_lifecycle
after insert or update of is_active, employment_status, organization_id, role_code, account_scope,
  employment_type, account_status, principal_type on public.users
for each row execute function public.sa_users_lifecycle_trigger();

-- Non-human principals: explicit type on the service identity registry.
alter table public.sa_service_identities add column if not exists principal_type text
  generated always as (case when identity_kind in ('integration','webhook','agent')
                            then 'INTEGRATION_PRINCIPAL' else 'SERVICE_IDENTITY' end) stored;
comment on column public.sa_service_identities.principal_type is
  'Non-human principal type (SERVICE_IDENTITY | INTEGRATION_PRINCIPAL). Service identities are never public.users rows and never hold human roles.';

-- ---------------------------------------------------------------------------
-- 3. Identity conflicts (append-only audit)
-- ---------------------------------------------------------------------------
create table if not exists public.identity_conflicts (
  id uuid primary key default gen_random_uuid(),
  detected_at timestamptz not null default now(),
  conflict_code text not null check (conflict_code in (
    'IDENTITY_CONFLICT', 'IDENTITY_AMBIGUOUS_EMAIL', 'IDENTITY_AMBIGUOUS_PHONE',
    'IDENTITY_VERIFICATION_REQUIRED', 'IDENTITY_ARCHIVED', 'IDENTITY_INACTIVE',
    'IDENTITY_PRINCIPAL_UPGRADE_REQUIRED', 'IDENTITY_ORG_MOVE_REQUIRED')),
  email_user_id uuid,
  phone_user_id uuid,
  matched_user_ids uuid[] not null default '{}',
  email_fingerprint text,
  phone_fingerprint text,
  source text not null check (source ~ '^[a-z][a-z0-9_]*$'),
  actor_id uuid,
  details jsonb not null default '{}'::jsonb
);
comment on table public.identity_conflicts is
  'Append-only audit of blocked identity resolutions. Raw user ids (no FK, survives account removal) and SHA-256 fingerprints of the normalized identifiers; never raw email/phone. Resolution is an administrative action (Stage 2).';
create index if not exists identity_conflicts_detected_idx on public.identity_conflicts (detected_at desc);
create index if not exists identity_conflicts_users_idx on public.identity_conflicts using gin (matched_user_ids);

alter table public.identity_conflicts enable row level security;
revoke all on table public.identity_conflicts from public, anon, authenticated;
grant select, insert on table public.identity_conflicts to service_role;

create or replace function public.sa_reject_identity_conflict_mutation()
returns trigger language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  raise exception 'identity_conflicts_is_append_only';
end $$;
revoke all on function public.sa_reject_identity_conflict_mutation() from public, anon, authenticated;
drop trigger if exists identity_conflicts_append_only on public.identity_conflicts;
create trigger identity_conflicts_append_only before update or delete on public.identity_conflicts
for each row execute function public.sa_reject_identity_conflict_mutation();
drop trigger if exists identity_conflicts_no_truncate on public.identity_conflicts;
create trigger identity_conflicts_no_truncate before truncate on public.identity_conflicts
for each statement execute function public.sa_reject_identity_conflict_mutation();

create or replace function public.identity_fingerprint(p_value text)
returns text language sql immutable set search_path = pg_catalog, pg_temp as $$
  select case when p_value is null then null
              else encode(extensions.digest(convert_to(p_value, 'UTF8'), 'sha256'), 'hex') end
$$;
revoke all on function public.identity_fingerprint(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Resolution
-- ---------------------------------------------------------------------------
-- Pure resolution (no writes). Output never contains email/phone values.
-- Outcomes:
--   INVALID_INPUT                     nothing usable supplied / malformed value
--   NO_MATCH                          create one identity
--   MATCH                             reuse user_id (matched_by email|phone|email+phone)
--   IDENTITY_CONFLICT                 email → A, phone → B (never merged)
--   IDENTITY_AMBIGUOUS_EMAIL|PHONE    identifier already shared by >1 identity
--   IDENTITY_VERIFICATION_REQUIRED    only an UNVERIFIED phone matched
--   IDENTITY_ARCHIVED                 the match is archived (never resurrected)
create or replace function public.identity_resolve(p_email text, p_phone text)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_email text := public.identity_normalize_email(p_email);
  v_phone text := public.identity_normalize_phone(p_phone);
  v_email_ids uuid[];
  v_phone_ids uuid[];
  v_email_user uuid;
  v_phone_user uuid;
  v_user uuid;
  v_outcome text;
  v_matched_by text;
  u record;
begin
  if (nullif(btrim(coalesce(p_email, '')), '') is not null and v_email is null)
     or (nullif(btrim(coalesce(p_phone, '')), '') is not null and v_phone is null)
     or (v_email is null and v_phone is null) then
    return jsonb_build_object('outcome', 'INVALID_INPUT',
      'email_valid', v_email is not null or nullif(btrim(coalesce(p_email, '')), '') is null,
      'phone_valid', v_phone is not null or nullif(btrim(coalesce(p_phone, '')), '') is null);
  end if;

  if v_email is not null then
    select coalesce(array_agg(distinct x.id), '{}') into v_email_ids from (
      select pu.id from public.users pu where pu.email_normalized = v_email
      union select au.id from auth.users au where lower(btrim(au.email)) = v_email) x;
  else v_email_ids := '{}'; end if;

  if v_phone is not null then
    select coalesce(array_agg(distinct x.id), '{}') into v_phone_ids from (
      select pu.id from public.users pu where pu.phone = v_phone
      union select au.id from auth.users au
            where au.phone is not null and au.phone <> '' and public.identity_normalize_phone('+' || ltrim(au.phone, '+')) = v_phone) x;
  else v_phone_ids := '{}'; end if;

  v_email_user := v_email_ids[1];
  if cardinality(v_email_ids) > 1 then
    v_outcome := 'IDENTITY_AMBIGUOUS_EMAIL';
  elsif v_email_user is not null and exists (select 1 from unnest(v_phone_ids) p where p <> v_email_user) then
    -- The phone belongs to (at least) one identity other than the email's.
    v_phone_user := (select p from unnest(v_phone_ids) p where p <> v_email_user limit 1);
    v_outcome := 'IDENTITY_CONFLICT';
  elsif v_email_user is null and cardinality(v_phone_ids) > 1 then
    v_outcome := 'IDENTITY_AMBIGUOUS_PHONE';
  else
    v_phone_user := v_phone_ids[1];
    if v_email_user is null and v_phone_user is null then
      v_outcome := 'NO_MATCH';
    else
      v_user := coalesce(v_email_user, v_phone_user);
      v_matched_by := case when v_email_user is not null and v_phone_user is not null then 'email+phone'
                           when v_email_user is not null then 'email' else 'phone' end;
      v_outcome := 'MATCH';
      select pu.account_status, pu.phone_verified_at, pu.principal_type, pu.organization_id, pu.account_scope
        into u from public.users pu where pu.id = v_user;
      if found and u.account_status = 'ARCHIVED' then
        v_outcome := 'IDENTITY_ARCHIVED';
      elsif v_matched_by = 'phone' and (not found or u.phone_verified_at is null) then
        -- An unverified phone never proves ownership.
        v_outcome := 'IDENTITY_VERIFICATION_REQUIRED';
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'outcome', v_outcome,
    'user_id', case when v_outcome = 'MATCH' then v_user end,
    'matched_by', v_matched_by,
    'email_user_id', v_email_user,
    'phone_user_id', v_phone_user,
    'matched_user_ids', to_jsonb(array(select distinct unnest(v_email_ids || v_phone_ids))),
    'has_profile', case when v_user is null then null else exists (select 1 from public.users pu where pu.id = v_user) end,
    'account_status', case when v_user is not null then (select pu.account_status from public.users pu where pu.id = v_user) end,
    'principal_type', case when v_user is not null then (select pu.principal_type from public.users pu where pu.id = v_user) end,
    'organization_id', case when v_user is not null then (select pu.organization_id from public.users pu where pu.id = v_user) end,
    'phone_is_new', v_phone is not null and cardinality(v_phone_ids) = 0,
    'email_is_new', v_email is not null and cardinality(v_email_ids) = 0);
end $$;
revoke all on function public.identity_resolve(text,text) from public, anon, authenticated;
grant execute on function public.identity_resolve(text,text) to service_role;
comment on function public.identity_resolve(text,text) is
  'Single identity-resolution rule set (see outcomes above). Reads public.users and auth.users; returns ids and outcome only, never identifier values. service_role only.';

create or replace function public.identity_record_conflict(
  p_code text, p_resolution jsonb, p_email text, p_phone text, p_source text, p_actor uuid, p_details jsonb default '{}'::jsonb)
returns uuid language plpgsql volatile security definer set search_path = pg_catalog, pg_temp as $$
declare v_id uuid;
begin
  insert into public.identity_conflicts(conflict_code, email_user_id, phone_user_id, matched_user_ids,
                                        email_fingerprint, phone_fingerprint, source, actor_id, details)
  values (p_code,
          nullif(p_resolution->>'email_user_id', '')::uuid,
          nullif(p_resolution->>'phone_user_id', '')::uuid,
          coalesce(array(select jsonb_array_elements_text(coalesce(p_resolution->'matched_user_ids', '[]'::jsonb))::uuid), '{}'),
          public.identity_fingerprint(public.identity_normalize_email(p_email)),
          public.identity_fingerprint(public.identity_normalize_phone(p_phone)),
          coalesce(nullif(p_source, ''), 'unknown'), p_actor, coalesce(p_details, '{}'::jsonb))
  returning id into v_id;
  perform public.sa_log_access_change(p_actor, 'identity.conflict', null, 'identity_conflict', v_id::text,
    jsonb_build_object('conflict_code', p_code, 'source', p_source, 'matched_user_ids', p_resolution->'matched_user_ids'),
    null, case when p_actor is null then 'system' else 'user' end);
  return v_id;
end $$;
revoke all on function public.identity_record_conflict(text,jsonb,text,text,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.identity_record_conflict(text,jsonb,text,text,text,uuid,jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Legacy compatibility guards (no escalation through role_code)
-- ---------------------------------------------------------------------------
create or replace function public.identity_actor_legacy_level(p_actor uuid)
returns integer language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select r.role_level from public.users u join public.roles r on r.role_code = u.role_code
  where u.id = p_actor and u.is_active is true
$$;
revoke all on function public.identity_actor_legacy_level(uuid) from public, anon, authenticated;

-- True when the actor may place p_role_code on an identity: the role exists and
-- is active, and it is not above the actor's own legacy level; Super Admin
-- (level 1) only by a Super Admin.
create or replace function public.identity_legacy_role_grant_allowed(p_actor uuid, p_role_code text)
returns boolean language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare v_target integer; v_actor integer;
begin
  select r.role_level into v_target from public.roles r where r.role_code = p_role_code and r.is_active is true;
  if v_target is null then return false; end if;
  v_actor := public.identity_actor_legacy_level(p_actor);
  if v_actor is null then return false; end if;
  if v_target = 1 then return v_actor = 1; end if;
  return v_target >= v_actor;
end $$;
revoke all on function public.identity_legacy_role_grant_allowed(uuid,text) from public, anon, authenticated;
grant execute on function public.identity_legacy_role_grant_allowed(uuid,text) to service_role;

-- Legacy rules the application used before S&A (evaluated only in legacy modes).
create or replace function public.identity_legacy_user_admin(p_actor uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select exists (
    select 1 from public.users u join public.roles r on r.role_code = u.role_code
    where u.id = p_actor and u.is_active is true
      and (r.role_level <= 30
           or coalesce((case when jsonb_typeof(r.permissions) = 'object' then r.permissions->>'create_users' end)::boolean, false)
           or coalesce((case when jsonb_typeof(r.permissions) = 'object' then r.permissions->>'edit_users' end)::boolean, false)
           or (jsonb_typeof(r.permissions) = 'array' and r.permissions ?| array['create_users','edit_users'])))
$$;
revoke all on function public.identity_legacy_user_admin(uuid) from public, anon, authenticated;

create or replace function public.identity_legacy_hr_admin(p_actor uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select exists (
    select 1 from public.users u join public.roles r on r.role_code = u.role_code
    where u.id = p_actor and u.is_active is true and (r.role_level <= 20 or upper(u.role_code) = 'HR_MANAGER'))
$$;
revoke all on function public.identity_legacy_hr_admin(uuid) from public, anon, authenticated;

-- Legacy rule for ACCESS administration (legacy/SHADOW modes): HQ admin
-- level, identical to the platform.identity_access.manage compatibility rule
-- (max_role_level 10). Employee managers (level 20/30, HR_MANAGER) are not
-- access administrators — intentional tightening.
create or replace function public.identity_legacy_access_admin(p_actor uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select coalesce(public.identity_actor_legacy_level(p_actor) <= 10, false)
$$;
revoke all on function public.identity_legacy_access_admin(uuid) from public, anon, authenticated;

-- Baseline (non-privileged) legacy role for a new identity of a principal type.
create or replace function public.identity_baseline_role_code(p_principal_type text)
returns text language sql immutable set search_path = pg_catalog, pg_temp as $$
  select case when p_principal_type = 'CONSUMER' then 'GUEST' else 'USER' end
$$;
revoke all on function public.identity_baseline_role_code(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Canonical provisioning core (one transaction)
-- ---------------------------------------------------------------------------
-- Called by the trusted server AFTER the auth identity exists (GoTrue owns
-- auth.users and cannot join this transaction). If this function raises, the
-- server deletes an auth user it created for this request, so no orphan
-- remains. Steps: authorize → re-resolve under an advisory lock → create or
-- verify the profile → lifecycle derives membership + baseline (trigger) →
-- optional initial S&A business role (sa_assign_role: security.role.assign,
-- SoD, no self-assignment) → audit.
--
-- p_payload keys: email, phone, full_name, call_name, organization_id,
--   account_scope ('portal'|'store'), expected_principal_type, legacy_role_code,
--   authorizing_permission ('platform.user.manage'|'hr.employee.manage'),
--   created_identity (bool), source, reason,
--   hr: department_id, manager_user_id, position_id, employment_type, join_date,
--   initial_role_id, initial_scope_ids (uuid[]), initial_reason.
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
  v_baseline := public.identity_baseline_role_code(v_principal);
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
  'Canonical provisioning core (one transaction): authorize, re-resolve, create/verify profile, lifecycle membership + baseline, optional initial S&A role, audit. Blocked resolutions are recorded and returned as status=blocked (the server then deletes an auth user it created).';

-- ---------------------------------------------------------------------------
-- 7. Account status + access administration (server-side only)
-- ---------------------------------------------------------------------------
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
  v_perm := case when p_status = 'ARCHIVED' then 'platform.identity.delete' else 'platform.identity.disable' end;
  perform public.sa_assert_actor_permission(p_actor, v_perm,
    jsonb_build_object('organization_id', coalesce(v_org, (select u.organization_id from public.users u where u.id = p_actor))),
    case when p_status = 'ARCHIVED' then public.sa_legacy_is_super_admin(p_actor) else public.identity_legacy_user_admin(p_actor) end);
  if v_old = p_status then return v_old; end if;
  update public.users set account_status = p_status, account_status_reason = left(btrim(p_reason), 500) where id = p_user;
  perform public.sa_log_access_change(p_actor, 'identity.status_changed', p_user, 'user', p_user::text,
    jsonb_build_object('from', v_old, 'to', p_status), p_reason, 'user');
  return p_status;
end $$;
revoke all on function public.identity_set_account_status(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.identity_set_account_status(uuid,uuid,text,text) to service_role;

-- Enterprise access fields on an existing identity (legacy role code and
-- organization context). Requires platform.identity_access.manage in the
-- source AND destination organization, no self-change, and no legacy role
-- above the actor's own level. The lifecycle then re-derives S&A.
create or replace function public.identity_admin_update_access(
  p_actor uuid, p_user uuid, p_role_code text, p_organization_id uuid, p_change_org boolean, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = pg_catalog, pg_temp as $$
declare u record; v_new_org uuid; v_new_role text; v_new_scope text; v_legacy boolean;
begin
  if p_actor is null or p_user is null then raise exception 'identity_actor_and_user_required' using errcode = '22023'; end if;
  if p_actor = p_user then raise exception 'identity_self_access_change_prohibited' using errcode = '42501'; end if;
  select id, role_code, organization_id, account_scope, account_status into u from public.users where id = p_user for update;
  if not found then raise exception 'identity_unknown' using errcode = '22023'; end if;
  if u.account_status = 'ARCHIVED' then raise exception 'identity_archived_is_terminal' using errcode = '42501'; end if;
  v_new_org := case when coalesce(p_change_org, false) then p_organization_id else u.organization_id end;
  v_new_role := coalesce(nullif(p_role_code, ''), u.role_code);
  if v_new_org is not null and not exists (select 1 from public.organizations o where o.id = v_new_org) then
    raise exception 'identity_organization_unknown' using errcode = '22023';
  end if;
  v_legacy := public.identity_legacy_access_admin(p_actor);
  if v_new_role is distinct from u.role_code then
    if not public.identity_legacy_role_grant_allowed(p_actor, v_new_role) then
      raise exception 'identity_role_grant_not_allowed' using errcode = '42501';
    end if;
    -- Removing a role the actor could not grant is equally privileged.
    if u.role_code is not null and not public.identity_legacy_role_grant_allowed(p_actor, u.role_code) then
      raise exception 'identity_role_change_not_allowed' using errcode = '42501';
    end if;
  end if;
  perform public.sa_assert_actor_permission(p_actor, 'platform.identity_access.manage',
    jsonb_build_object('organization_id', coalesce(u.organization_id, (select a.organization_id from public.users a where a.id = p_actor))), v_legacy);
  if v_new_org is distinct from u.organization_id and v_new_org is not null then
    perform public.sa_assert_actor_permission(p_actor, 'platform.identity_access.manage',
      jsonb_build_object('organization_id', v_new_org), v_legacy);
  end if;
  -- Organization context drives the scope (as updateUserWithAuth did).
  v_new_scope := case when v_new_org is null then 'store'
                      when v_new_role in ('GUEST','CONSUMER') then u.account_scope
                      else 'portal' end;
  update public.users set role_code = v_new_role, organization_id = v_new_org, account_scope = v_new_scope
  where id = p_user;
  perform public.sa_log_access_change(p_actor, 'identity.access_changed', p_user, 'user', p_user::text,
    jsonb_build_object('from', jsonb_build_object('role_code', u.role_code, 'organization_id', u.organization_id, 'account_scope', u.account_scope),
                       'to', jsonb_build_object('role_code', v_new_role, 'organization_id', v_new_org, 'account_scope', v_new_scope)),
    p_reason, 'user');
  return jsonb_build_object('role_code', v_new_role, 'organization_id', v_new_org, 'account_scope', v_new_scope);
end $$;
revoke all on function public.identity_admin_update_access(uuid,uuid,text,uuid,boolean,text) from public, anon, authenticated;
grant execute on function public.identity_admin_update_access(uuid,uuid,text,uuid,boolean,text) to service_role;

-- ---------------------------------------------------------------------------
-- 8. Identity permissions (catalogue; mirrors app/src/lib/security-access/identity-catalog.ts)
-- ---------------------------------------------------------------------------
insert into public.sa_permissions(permission_key, module, resource, action, description, source, audit_sensitivity) values
 ('platform.identity.view','platform','identity','view','View central identities, principal types, lifecycle state and identity conflicts','new','security_sensitive'),
 ('platform.identity.disable','platform','identity','disable','Suspend, disable or reactivate an identity (account lifecycle)','new','security_sensitive'),
 ('platform.identity.delete','platform','identity','delete','Archive an identity (terminal; history is preserved)','new','security_sensitive'),
 ('platform.identity_access.manage','platform','identity_access','manage','Change enterprise access fields of an identity (legacy role code, organization context, principal upgrade)','new','security_sensitive')
on conflict (permission_key) do nothing;

insert into public.sa_legacy_compat_rules(permission_key, max_role_level, role_codes, legacy_permissions, employee_baseline, notes) values
 ('platform.identity.view', 30, '{}', array['view_users','edit_users','create_users'], false, 'Identity Foundation Stage 1 compatibility mapping (identity-catalog.ts)'),
 ('platform.identity.disable', 30, '{}', array['edit_users'], false, 'Identity Foundation Stage 1 compatibility mapping (identity-catalog.ts)'),
 ('platform.identity.delete', 1, '{}', '{}', false, 'Identity Foundation Stage 1 compatibility mapping (identity-catalog.ts)'),
 ('platform.identity_access.manage', 10, '{}', '{}', false, 'Identity Foundation Stage 1 compatibility mapping (identity-catalog.ts); intentional tightening: employee management no longer implies access administration')
on conflict (permission_key) do update set max_role_level = excluded.max_role_level, role_codes = excluded.role_codes,
  legacy_permissions = excluded.legacy_permissions, employee_baseline = excluded.employee_baseline,
  notes = excluded.notes, updated_at = now();

insert into public.sa_migration_modes(permission_key, mode, legacy_permission_key, notes)
select k, 'SHADOW', null, 'Identity Foundation Stage 1: legacy decides while the new model is evaluated and logged.'
from unnest(array['platform.identity.view','platform.identity.disable','platform.identity.delete','platform.identity_access.manage']) k
on conflict (permission_key) do nothing;

insert into public.sa_enforcement_readiness(permission_key, route_wiring, database_backstop, intentional_tightening, notes) values
 ('platform.identity.view', true, 'read_only', null, 'Identity diagnostics are server-side reads (service role).'),
 ('platform.identity.disable', true, 'governance_function', null, 'setUserAccountStatus action → identity_set_account_status(); browser writes to is_active/account_status blocked by users_protect_access_fields.'),
 ('platform.identity_access.manage', true, 'governance_function',
  'Employee management (hr.employee.manage / platform.user.manage) no longer implies changing legacy role codes or organization context.',
  'updateUserWithAuth / provisioning → identity_admin_update_access() / identity_provision(); browser writes blocked by users_protect_access_fields.')
on conflict (permission_key) do update set route_wiring = excluded.route_wiring, database_backstop = excluded.database_backstop,
  intentional_tightening = excluded.intentional_tightening, notes = excluded.notes;

insert into public.sa_business_roles(role_key, name, description, source) values
 ('identity-administrator', 'Identity Administrator',
  'Central identity registry: creates and maintains identities, contact data and account lifecycle. Does not include access administration.', 'template')
on conflict (role_key) do nothing;

insert into public.sa_business_role_permissions(role_id, permission_id)
select br.id, p.id
from (values
  ('identity-administrator', array['platform.user.manage','platform.identity.view','platform.identity.disable']),
  ('security-administrator', array['platform.identity.view','platform.identity_access.manage'])
) as t(role_key, keys)
join public.sa_business_roles br on br.role_key = t.role_key
join public.sa_permissions p on p.permission_key = any(t.keys)
on conflict do nothing;

-- Compatibility roles gain the new keys only while legacy authorization is
-- still writable (production today); once Security & Access is the only
-- writable source (staging), new permissions come from S&A roles only.
select public.sa_refresh_compat_role(r.role_code, false)
from public.roles r
where not public.sa_setting_bool('legacy_authorization.read_only', false)
  and exists (select 1 from public.sa_business_roles br where br.role_key = public.sa_compat_role_key(r.role_code));

-- ---------------------------------------------------------------------------
-- 9. Post-conditions
-- ---------------------------------------------------------------------------
do $$
declare v_bad integer;
begin
  select count(*) into v_bad from public.users where principal_type is null or account_status is null;
  if v_bad > 0 then raise exception 'postcondition: % users without principal_type/account_status', v_bad; end if;
  select count(*) into v_bad from public.users where (principal_type = 'CONSUMER') <> (account_scope = 'store');
  if v_bad > 0 then raise exception 'postcondition: % users with principal/account-scope mismatch', v_bad; end if;
  select count(*) into v_bad from public.users where is_active is distinct from (account_status in ('ACTIVE','INVITED'));
  if v_bad > 0 then raise exception 'postcondition: % users with is_active/account_status mismatch', v_bad; end if;
  if public.identity_normalize_phone('0123456789') <> '+60123456789'
     or public.identity_normalize_phone('60123456789') <> '+60123456789'
     or public.identity_normalize_phone('+60 12-345 6789') <> '+60123456789'
     or public.identity_normalize_phone('123456789') is not null
     or public.identity_normalize_email('  Foo.Bar@Example.COM ') <> 'foo.bar@example.com' then
    raise exception 'postcondition: normalization self-test failed';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname in ('identity_resolve','identity_provision','identity_record_conflict',
                   'identity_set_account_status','identity_admin_update_access','identity_legacy_role_grant_allowed')
               and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))) then
    raise exception 'postcondition: identity functions must not be executable by anon/authenticated';
  end if;
  if has_table_privilege('authenticated', 'public.identity_conflicts', 'SELECT')
     or has_table_privilege('anon', 'public.identity_conflicts', 'SELECT') then
    raise exception 'postcondition: identity_conflicts must not be readable by API roles';
  end if;
  if (select count(*) from public.sa_migration_modes where permission_key like 'platform.identity%' and mode <> 'SHADOW') > 0 then
    raise exception 'postcondition: identity permissions must be seeded in SHADOW';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'sa_users_lifecycle' and tgrelid = 'public.users'::regclass) then
    raise exception 'postcondition: lifecycle trigger missing';
  end if;
end $$;
