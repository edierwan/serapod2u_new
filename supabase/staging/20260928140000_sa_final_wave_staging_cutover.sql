-- ============================================================================
-- Security & Access Final Wave — STAGING cutover (NOT a migration)
-- ----------------------------------------------------------------------------
-- STAGING ONLY. Run as the database owner after the four Final Wave
-- migrations (20260928100000 … 20260928130000) have succeeded. This file is
-- deliberately outside supabase/migrations so it is never applied to
-- production by the normal migration path; production promotion decides its
-- own cutover separately.
--
-- What it does (one transaction; aborts entirely on any failed check)
--   1. Pre-checks
--        * every enforcement-ready permission exists and is registered;
--        * analytic parity: no active business identity loses access that its
--          legacy role definition grants (sa_compat_parity_report);
--        * at least one active identity keeps security.role.assign and
--          security.permission.manage through S&A (no administrator lockout).
--   2. NEW_ENFORCED for every operation in sa_enforcement_readiness (route
--      AND database backstop wired). inventory.stock_count.verify, already
--      NEW_ENFORCED on staging since the Wave 1 pilot, is left as is.
--   3. LEGACY_RETIRED for the Security & Access administration permissions
--      (their only legacy input was manage_authorization, i.e. Super Admin).
--   4. legacy_authorization.read_only = true: legacy role permissions,
--      department overrides and HR access groups become read-only, and a
--      legacy role code no longer derives any access.
--   Every mode change goes through sa_set_migration_mode (audited in
--   sa_access_change_log with actor 'system').
--
-- Rollback (staging): for each permission, run
--   select public.sa_set_migration_mode(null, '<key>', 'SHADOW', 'Rollback of staging cutover');
-- (LEGACY_RETIRED → SHADOW is allowed) and
--   update public.sa_settings set setting_value = 'false' where setting_key = 'legacy_authorization.read_only';
-- ============================================================================

begin;

do $precheck$
declare
  v_missing text;
  v_gap integer;
  v_admins integer;
begin
  select string_agg(r.permission_key, ', ') into v_missing
  from public.sa_enforcement_readiness r
  where not exists (select 1 from public.sa_migration_modes m where m.permission_key = r.permission_key);
  if v_missing is not null then raise exception 'cutover precheck: no migration mode for %', v_missing; end if;

  select count(*) into v_gap from public.sa_compat_parity_report(null) where classification = 'LEGACY_ALLOW_NEW_DENY';
  if v_gap > 0 then
    raise exception 'cutover precheck: % legacy grants are not represented in S&A — run select * from public.sa_compat_parity_report(null) where classification = ''LEGACY_ALLOW_NEW_DENY''', v_gap;
  end if;

  select count(*) into v_admins from public.users u
  where u.is_active and u.account_scope = 'portal' and u.organization_id is not null
    and public.sa_actor_has_permission(u.id, 'security.role.assign', jsonb_build_object('organization_id', u.organization_id))
    and public.sa_actor_has_permission(u.id, 'security.permission.manage', jsonb_build_object('organization_id', u.organization_id));
  if v_admins = 0 then raise exception 'cutover precheck: no active security administrator would remain'; end if;
  raise notice 'cutover precheck passed: parity gaps 0, security administrators %', v_admins;
end
$precheck$;

-- 2. Enforce every wired operation.
select r.permission_key, public.sa_set_migration_mode(null, r.permission_key, 'NEW_ENFORCED',
  'Final Wave staging cutover: route and database backstop wired; analytic parity clean')
from public.sa_enforcement_readiness r
where public.sa_permission_mode(r.permission_key) not in ('NEW_ENFORCED', 'LEGACY_RETIRED')
order by r.permission_key;

-- 3. Retire the legacy input for Security & Access administration.
select m.permission_key, public.sa_set_migration_mode(null, m.permission_key, 'LEGACY_RETIRED',
  'Final Wave staging cutover: security administration decided by S&A only (legacy manage_authorization retired)')
from public.sa_migration_modes m
where m.permission_key like 'security.%'
  and exists (select 1 from public.sa_enforcement_readiness r where r.permission_key = m.permission_key)
order by m.permission_key;

-- 4. Security & Access becomes the only writable authorization source.
update public.sa_settings set setting_value = 'true'::jsonb, updated_at = now()
where setting_key = 'legacy_authorization.read_only';
select public.sa_log_access_change(null, 'legacy_authorization.locked', null, 'sa_settings', 'legacy_authorization.read_only',
  '{}'::jsonb, 'Final Wave staging cutover', 'system');

-- Post-conditions
do $postcheck$
declare v_bad text;
begin
  select string_agg(r.permission_key, ', ') into v_bad from public.sa_enforcement_readiness r
  where public.sa_permission_mode(r.permission_key) not in ('NEW_ENFORCED', 'LEGACY_RETIRED');
  if v_bad is not null then raise exception 'cutover postcheck: not enforced: %', v_bad; end if;
  if public.sa_permission_mode('inventory.stock_count.verify') not in ('NEW_ENFORCED','LEGACY_RETIRED') then
    raise exception 'cutover postcheck: stock count verification must remain enforced';
  end if;
  if exists (select 1 from public.sa_migration_modes m where m.mode in ('NEW_ENFORCED','LEGACY_RETIRED')
             and not exists (select 1 from public.sa_enforcement_readiness r where r.permission_key = m.permission_key)) then
    raise exception 'cutover postcheck: an unregistered operation is enforced';
  end if;
  if not public.sa_legacy_authorization_read_only() then raise exception 'cutover postcheck: legacy stores not locked'; end if;
end
$postcheck$;

select mode, count(*) as operations from public.sa_migration_modes group by mode order by mode;

commit;
