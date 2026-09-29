-- Identity Foundation — normalization and resolution rules
DO $$ BEGIN
  -- Email: trim + lowercase; malformed/empty → NULL
  PERFORM saf.expect_eq('email: trim + lowercase', public.identity_normalize_email('  Foo.Bar@Example.COM '), 'foo.bar@example.com');
  PERFORM saf.expect_eq('email: malformed → NULL', public.identity_normalize_email('not-an-email'), NULL::text);
  PERFORM saf.expect_eq('email: empty → NULL', public.identity_normalize_email('   '), NULL::text);
  PERFORM saf.expect_eq('email: generated column uses the same rule',
    (SELECT email_normalized FROM public.users WHERE id = saf.uid('emp_a')), 'fixture5@saf.test');

  -- Phone: strict E.164, Malaysian forms, no guessing
  PERFORM saf.expect_eq('phone: 01x national', public.identity_normalize_phone('0123456789'), '+60123456789');
  PERFORM saf.expect_eq('phone: separators', public.identity_normalize_phone('012-345 6789'), '+60123456789');
  PERFORM saf.expect_eq('phone: +60 with spaces', public.identity_normalize_phone('+60 12-345 6789'), '+60123456789');
  PERFORM saf.expect_eq('phone: 60 without plus', public.identity_normalize_phone('60123456789'), '+60123456789');
  PERFORM saf.expect_eq('phone: 011 (11-digit) mobile', public.identity_normalize_phone('01112345678'), '+601112345678');
  PERFORM saf.expect_eq('phone: 03 landline', public.identity_normalize_phone('0312345678'), '+60312345678');
  PERFORM saf.expect_eq('phone: international +65', public.identity_normalize_phone('+65 9123 4567'), '+6591234567');
  PERFORM saf.expect_eq('phone: 00 international prefix', public.identity_normalize_phone('0065 9123 4567'), '+6591234567');
  PERFORM saf.expect_eq('phone: bare subscriber number is not guessed', public.identity_normalize_phone('123456789'), NULL::text);
  PERFORM saf.expect_eq('phone: foreign number without + is not guessed', public.identity_normalize_phone('6591234567'), NULL::text);
  PERFORM saf.expect_eq('phone: letters rejected', public.identity_normalize_phone('012-ABC-6789'), NULL::text);
  PERFORM saf.expect_eq('phone: too short', public.identity_normalize_phone('+60 12'), NULL::text);
  PERFORM saf.expect_eq('phone: +60 then 0 is invalid', public.identity_normalize_phone('+600123456789'), NULL::text);
  PERFORM saf.expect_eq('phone: empty → NULL', public.identity_normalize_phone(''), NULL::text);
END $$;

-- Fixture identifiers for resolution
UPDATE public.users SET phone = '+60120000005', phone_verified_at = now() WHERE id = saf.uid('emp_a');   -- verified
UPDATE public.users SET phone = '+60120000012' WHERE id = saf.uid('emp_a2');                            -- unverified
UPDATE public.users SET phone = '+60120000003' WHERE id IN (saf.uid('pu_a'), saf.uid('pu_a2'));        -- shared (ambiguous)
UPDATE public.users SET account_status = 'ARCHIVED' WHERE id = saf.uid('contractor');

DO $$
DECLARE r jsonb;
BEGIN
  PERFORM saf.expect_eq('unverified phone stays unverified', (SELECT phone_verified_at FROM public.users WHERE id = saf.uid('emp_a2')), NULL::timestamptz);

  r := public.identity_resolve('brand.new@saf.test', '+60129999999');
  PERFORM saf.expect_eq('R1 no email/phone match → NO_MATCH', r->>'outcome', 'NO_MATCH');

  r := public.identity_resolve(' FIXTURE5@SAF.TEST ', NULL);
  PERFORM saf.expect_eq('R2 email (case/space-insensitive) → MATCH', r->>'outcome', 'MATCH');
  PERFORM saf.expect_eq('R2 user', (r->>'user_id')::uuid, saf.uid('emp_a'));
  PERFORM saf.expect_eq('R2 matched_by', r->>'matched_by', 'email');

  r := public.identity_resolve('fixture5@saf.test', '012-000 0005');
  PERFORM saf.expect_eq('R3 email + phone same user → MATCH', r->>'outcome', 'MATCH');
  PERFORM saf.expect_eq('R3 matched_by', r->>'matched_by', 'email+phone');

  r := public.identity_resolve('fixture5@saf.test', '+60127777777');
  PERFORM saf.expect_eq('R4 email match, phone new → reuse identity', r->>'outcome', 'MATCH');
  PERFORM saf.expect_eq('R4 phone flagged new (not attached)', (r->>'phone_is_new')::boolean, true);

  r := public.identity_resolve('someone.else@saf.test', '0120000005');
  PERFORM saf.expect_eq('R5 verified phone only → MATCH', r->>'outcome', 'MATCH');
  PERFORM saf.expect_eq('R5 user', (r->>'user_id')::uuid, saf.uid('emp_a'));
  PERFORM saf.expect_eq('R5 email flagged new (not attached)', (r->>'email_is_new')::boolean, true);

  r := public.identity_resolve('someone.else@saf.test', '0120000012');
  PERFORM saf.expect_eq('R6 unverified phone only → verification required', r->>'outcome', 'IDENTITY_VERIFICATION_REQUIRED');
  PERFORM saf.expect_eq('R6 no user returned', r->>'user_id', NULL::text);

  r := public.identity_resolve('fixture5@saf.test', '0120000012');
  PERFORM saf.expect_eq('R7 email → A, phone → B → IDENTITY_CONFLICT', r->>'outcome', 'IDENTITY_CONFLICT');
  PERFORM saf.expect_eq('R7 email user', (r->>'email_user_id')::uuid, saf.uid('emp_a'));
  PERFORM saf.expect_eq('R7 phone user', (r->>'phone_user_id')::uuid, saf.uid('emp_a2'));
  PERFORM saf.expect_eq('R7 never returns a user to reuse', r->>'user_id', NULL::text);

  r := public.identity_resolve('someone.else@saf.test', '0120000003');
  PERFORM saf.expect_eq('R8 phone shared by two identities → ambiguous', r->>'outcome', 'IDENTITY_AMBIGUOUS_PHONE');

  r := public.identity_resolve('fixture3@saf.test', '0120000003');
  PERFORM saf.expect_eq('R8b email → A, shared phone also → B → conflict', r->>'outcome', 'IDENTITY_CONFLICT');

  r := public.identity_resolve('fixture14@saf.test', NULL);
  PERFORM saf.expect_eq('R9 auth identity without profile is still one identity', r->>'outcome', 'MATCH');
  PERFORM saf.expect_eq('R9 has_profile', (r->>'has_profile')::boolean, false);

  r := public.identity_resolve('fixture11@saf.test', NULL);
  PERFORM saf.expect_eq('R10 archived identity is never reused', r->>'outcome', 'IDENTITY_ARCHIVED');

  PERFORM saf.expect_eq('R11 malformed email → INVALID_INPUT', public.identity_resolve('bad', NULL)->>'outcome', 'INVALID_INPUT');
  PERFORM saf.expect_eq('R11 nothing supplied → INVALID_INPUT', public.identity_resolve(NULL, NULL)->>'outcome', 'INVALID_INPUT');
  PERFORM saf.expect_eq('R11 malformed phone → INVALID_INPUT', public.identity_resolve('fixture5@saf.test', 'abc')->>'outcome', 'INVALID_INPUT');

  r := public.identity_resolve('fixture5@saf.test', '0120000012');
  PERFORM saf.expect_eq('R12 resolution output carries no email', position('@' in r::text), 0);
  PERFORM saf.expect_eq('R12 resolution output carries no phone', position('0120000' in r::text), 0);

  PERFORM saf.expect_eq('R13 resolver not executable by authenticated',
    has_function_privilege('authenticated', 'public.identity_resolve(text,text)', 'EXECUTE'), false);
  PERFORM saf.expect_eq('R13 resolver not executable by anon',
    has_function_privilege('anon', 'public.identity_resolve(text,text)', 'EXECUTE'), false);
  PERFORM saf.expect_eq('R13 provisioning not executable by authenticated',
    has_function_privilege('authenticated', 'public.identity_provision(uuid,uuid,jsonb)', 'EXECUTE'), false);
END $$;
