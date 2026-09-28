-- ============================================================================
-- Identity Foundation Stage 2 — align profile identifiers with the login
-- ----------------------------------------------------------------------------
-- Decision (management, 2026-09-29): the login identity (auth.users — what the
-- person actually signs in with) is authoritative for email and phone.
--
-- For every identity that has both a login and a profile:
--   email  profile ← lower(trim(login email))        when they differ
--          (covers mixed-case profile emails and profile≠login values)
--   phone  profile ← normalized login phone           when the login has a
--          phone that normalizes and it differs from the profile
-- Verification follows the login: email_verified_at / phone_verified_at are
-- taken from the login's confirmation timestamps for the synced values.
--
-- Never done automatically (reported, left unchanged):
--   * the target value already belongs to another identity (collision);
--   * the login phone does not normalize (identity_normalize_phone = NULL);
--   * the login has no phone but the profile does (no authoritative value);
--   * login identities without a profile.
-- Archived identities are included (their identifiers stay reserved).
--
-- Evidence: one sa_access_change_log row per changed identity
-- (action 'identity.identifier_synced', details = changed field names only —
-- never the values) and one row per skipped identity
-- ('identity.identifier_sync_skipped', reason code). A NOTICE summarises the
-- counts. Staging expectation (audit 2026-09-29): 35 emails synced
-- (18 case-only, 17 value), 17 phones synced (16 differing + 1 missing),
-- 3 phones skipped (1 collision, 2 unnormalizable), 12 profile-only phones
-- and 5 logins without a profile reported.
--
-- Idempotent: a second run changes nothing. No migration mode is changed.
-- The logic is a function (identity_sync_identifiers_from_login, owner-only)
-- so the same alignment can be re-run and tested.
-- Rollback: drop function public.identity_sync_identifiers_from_login();
-- values are not restorable from this migration (they are the
-- login's); take a users(id, email, phone, email_verified_at,
-- phone_verified_at) export before running if a rollback copy is required.
-- ============================================================================
create or replace function public.identity_sync_identifiers_from_login()
returns jsonb language plpgsql volatile security definer set search_path = pg_catalog, pg_temp as $sync$
DECLARE
  r record;
  v_email text; v_phone text; v_fields text[];
  n_email integer := 0; n_phone integer := 0; n_skip integer := 0; n_profile_only_phone integer := 0; n_auth_only integer := 0;
BEGIN
  FOR r IN
    SELECT u.id, u.email AS p_email, u.phone AS p_phone, a.email AS a_email, a.phone AS a_phone,
           a.email_confirmed_at, a.phone_confirmed_at
    FROM public.users u JOIN auth.users a ON a.id = u.id
  LOOP
    v_fields := '{}';
    v_email := public.identity_normalize_email(r.a_email);
    v_phone := CASE WHEN coalesce(r.a_phone, '') <> '' THEN public.identity_normalize_phone('+' || ltrim(r.a_phone, '+')) END;

    -- email
    IF v_email IS NOT NULL AND r.p_email IS DISTINCT FROM v_email THEN
      IF EXISTS (SELECT 1 FROM public.users v WHERE v.id <> r.id AND v.email_normalized = v_email) THEN
        PERFORM public.sa_log_access_change(NULL, 'identity.identifier_sync_skipped', r.id, 'user', r.id::text,
          jsonb_build_object('field', 'email', 'reason', 'collision'), 'Stage 2 identifier drift sync', 'system');
        n_skip := n_skip + 1;
      ELSE
        UPDATE public.users SET email = v_email,
          email_verified_at = coalesce(r.email_confirmed_at, email_verified_at)
        WHERE id = r.id;
        v_fields := v_fields || 'email'::text; n_email := n_email + 1;
      END IF;
    END IF;

    -- phone
    IF coalesce(r.a_phone, '') <> '' THEN
      IF v_phone IS NULL THEN
        PERFORM public.sa_log_access_change(NULL, 'identity.identifier_sync_skipped', r.id, 'user', r.id::text,
          jsonb_build_object('field', 'phone', 'reason', 'login_phone_not_normalizable'), 'Stage 2 identifier drift sync', 'system');
        n_skip := n_skip + 1;
      ELSIF r.p_phone IS DISTINCT FROM v_phone THEN
        IF EXISTS (SELECT 1 FROM public.users v WHERE v.id <> r.id AND v.phone = v_phone) THEN
          PERFORM public.sa_log_access_change(NULL, 'identity.identifier_sync_skipped', r.id, 'user', r.id::text,
            jsonb_build_object('field', 'phone', 'reason', 'collision'), 'Stage 2 identifier drift sync', 'system');
          n_skip := n_skip + 1;
        ELSE
          UPDATE public.users SET phone = v_phone, phone_verified_at = r.phone_confirmed_at WHERE id = r.id;
          v_fields := v_fields || 'phone'::text; n_phone := n_phone + 1;
        END IF;
      END IF;
    ELSIF r.p_phone IS NOT NULL THEN
      n_profile_only_phone := n_profile_only_phone + 1;   -- no authoritative value: reported only
    END IF;

    IF cardinality(v_fields) > 0 THEN
      PERFORM public.sa_log_access_change(NULL, 'identity.identifier_synced', r.id, 'user', r.id::text,
        jsonb_build_object('fields', to_jsonb(v_fields), 'source', 'login'), 'Stage 2 identifier drift sync', 'system');
    END IF;
  END LOOP;

  SELECT count(*) INTO n_auth_only FROM auth.users a WHERE NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = a.id);
  RAISE NOTICE 'identifier drift sync: % email(s) and % phone(s) aligned with the login; % skipped (collision/unnormalizable); % profile-only phone(s) and % login(s) without profile reported',
    n_email, n_phone, n_skip, n_profile_only_phone, n_auth_only;
  RETURN jsonb_build_object('emails_synced', n_email, 'phones_synced', n_phone, 'skipped', n_skip,
                            'profile_only_phones', n_profile_only_phone, 'logins_without_profile', n_auth_only);
END
$sync$;
revoke all on function public.identity_sync_identifiers_from_login() from public, anon, authenticated, service_role;
comment on function public.identity_sync_identifiers_from_login() is
  'Aligns profile email/phone with the login identity (auth.users is authoritative); skips collisions and unnormalizable values; logs changed field names only. Owner-run maintenance (not executable by API roles or the application).';

select public.identity_sync_identifiers_from_login();

-- Post-conditions: no remaining drift other than the reported categories
DO $$
DECLARE v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad FROM public.users u JOIN auth.users a ON a.id = u.id
  WHERE public.identity_normalize_email(a.email) IS NOT NULL
    AND u.email IS DISTINCT FROM public.identity_normalize_email(a.email)
    AND NOT EXISTS (SELECT 1 FROM public.users v WHERE v.id <> u.id AND v.email_normalized = public.identity_normalize_email(a.email));
  IF v_bad > 0 THEN RAISE EXCEPTION 'postcondition: % profile emails still differ from their login', v_bad; END IF;
  SELECT count(*) INTO v_bad FROM public.users u JOIN auth.users a ON a.id = u.id
  WHERE coalesce(a.phone, '') <> '' AND public.identity_normalize_phone('+' || ltrim(a.phone, '+')) IS NOT NULL
    AND u.phone IS DISTINCT FROM public.identity_normalize_phone('+' || ltrim(a.phone, '+'))
    AND NOT EXISTS (SELECT 1 FROM public.users v WHERE v.id <> u.id AND v.phone = public.identity_normalize_phone('+' || ltrim(a.phone, '+')));
  IF v_bad > 0 THEN RAISE EXCEPTION 'postcondition: % profile phones still differ from their login', v_bad; END IF;
END $$;
