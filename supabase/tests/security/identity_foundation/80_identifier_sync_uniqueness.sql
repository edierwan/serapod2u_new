-- Identity Foundation Stage 2 — profile identifiers follow the login; one identity per email / verified phone
-- Drift is created directly (the database owner can); the sync is the same
-- function the 20260929170000 migration runs.
UPDATE auth.users SET phone = NULL WHERE phone IS NOT NULL;   -- isolate from earlier files
UPDATE public.users SET email = 'Fixture5@SAF.test' WHERE id = saf.uid('emp_a');                       -- case-only drift
UPDATE public.users SET email = 'old.address@saf.test' WHERE id = saf.uid('emp_a2');                    -- value drift
UPDATE auth.users SET phone = '60129990012', phone_confirmed_at = now() WHERE id = saf.uid('emp_a2');   -- login phone differs
UPDATE public.users SET phone = '+60129990011' WHERE id = saf.uid('pu_a');
UPDATE auth.users SET phone = '60129990011' WHERE id = saf.uid('whm_a1');                               -- would collide with pu_a
UPDATE auth.users SET phone = '123' WHERE id = saf.uid('hr_a');                                        -- not normalizable

DO $$
DECLARE r jsonb; n_log integer;
BEGIN
  SELECT count(*) INTO n_log FROM public.sa_access_change_log WHERE action LIKE 'identity.identifier_sync%';
  r := public.identity_sync_identifiers_from_login();
  PERFORM saf.expect_eq('S1 case-only email drift aligned to the login', (SELECT email FROM public.users WHERE id = saf.uid('emp_a')), 'fixture5@saf.test');
  PERFORM saf.expect_eq('S2 profile email follows the login email', (SELECT email FROM public.users WHERE id = saf.uid('emp_a2')), 'fixture12@saf.test');
  PERFORM saf.expect_eq('S3 profile phone follows the normalized login phone', (SELECT phone FROM public.users WHERE id = saf.uid('emp_a2')), '+60129990012');
  PERFORM saf.expect_eq('S3 verification follows the login confirmation',
    (SELECT phone_verified_at IS NOT NULL FROM public.users WHERE id = saf.uid('emp_a2')), true);
  PERFORM saf.expect_eq('S4 collision is skipped, never merged', (SELECT phone FROM public.users WHERE id = saf.uid('whm_a1')), NULL::text);
  PERFORM saf.expect_eq('S4 the other identity keeps its phone', (SELECT phone FROM public.users WHERE id = saf.uid('pu_a')), '+60129990011');
  PERFORM saf.expect_eq('S5 unnormalizable login phone is skipped (no guessing)',
    (SELECT count(*) FROM public.sa_access_change_log WHERE action = 'identity.identifier_sync_skipped' AND target_user_id = saf.uid('hr_a')
       AND details->>'reason' = 'login_phone_not_normalizable')::int, 1);
  PERFORM saf.expect_eq('S6 evidence rows carry field names, never values',
    (SELECT count(*) FROM public.sa_access_change_log WHERE action LIKE 'identity.identifier_sync%'
       AND (details::text LIKE '%@%' OR details::text LIKE '%+60%'))::int, 0);
  PERFORM saf.expect_eq('S6 evidence written', (SELECT count(*) FROM public.sa_access_change_log WHERE action LIKE 'identity.identifier_sync%')::int > n_log, true);

  r := public.identity_sync_identifiers_from_login();
  PERFORM saf.expect_eq('S7 idempotent: a second run changes nothing', (r->>'emails_synced')::int + (r->>'phones_synced')::int, 0);
  PERFORM saf.expect_eq('S8 not executable by the application',
    has_function_privilege('service_role', 'public.identity_sync_identifiers_from_login()', 'EXECUTE'), false);
END $$;

DO $$
BEGIN
  -- U1 one identity per normalized email (case variants included)
  PERFORM saf.expect_raise('U1 a case variant of an existing email cannot become a second identity',
    format('insert into auth.users (id, email) values (%L, %L); insert into public.users (id, email, role_code, account_scope) values (%L, %L, %L, %L)',
      idt.new_uid(95), 'FIXTURE5@saf.test', idt.new_uid(95), 'FIXTURE5@saf.test', 'GUEST', 'store'),
    'users_email_normalized_key');

  -- U2 a verified phone belongs to one identity; unverified phones may repeat
  UPDATE public.users SET phone = '+60129990020', phone_verified_at = NULL WHERE id IN (saf.uid('pu_a2'), saf.uid('hq_b'));
  PERFORM saf.expect_eq('U2 unverified duplicates are allowed',
    (SELECT count(*) FROM public.users WHERE phone = '+60129990020')::int, 2);
  UPDATE public.users SET phone_verified_at = now() WHERE id = saf.uid('pu_a2');
  PERFORM saf.expect_raise('U2 a second identity cannot verify the same phone',
    format('update public.users set phone_verified_at = now() where id = %L', saf.uid('hq_b')), 'users_verified_phone_key');
  PERFORM saf.expect_eq('U3 email/phone are indexes, the key stays users.id',
    (SELECT string_agg(a.attname, ',') FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = 'public.users'::regclass AND i.indisprimary), 'id');
END $$;
