-- ============================================================================
-- Identity Foundation Stage 1 — SQL certification suite
-- ----------------------------------------------------------------------------
-- DISPOSABLE VANILLA PostgreSQL REPLICAS ONLY. Never run against staging or
-- production (the SET ROLE request simulation in 40_* crashes the Supabase
-- image; localhost shares the staging database).
--
--   createdb idf -T <schema_only_template>        # pg_dump -s of staging + catalog rows
--   for m in 20260929100000_sa_decisions_history_survives_user_deletion \
--            20260929110000_identity_foundation 20260929120000_identity_protected_fields_guard; do
--     psql -d idf -v ON_ERROR_STOP=1 -f supabase/migrations/$m.sql || exit 1; done
--   psql -d idf -v ON_ERROR_STOP=1 -f supabase/tests/security/sa_final_wave/00_harness_and_fixtures.sql
--   for f in supabase/tests/security/identity_foundation/*.sql; do
--     psql -X -v ON_ERROR_STOP=1 -d idf -f "$f" || exit 1; done
--
-- Uses the Final Wave fixtures and helpers (schema saf): SA/HQ/POWER_USER/
-- HR_MANAGER/USER/… in HQ A, HQ B, DIST A, SHOP A; fixture 14 is an auth
-- identity without a public profile. The baseline is the production-like
-- state (all modes SHADOW, legacy_authorization.read_only = false); tests that
-- need the new model switch a permission to NEW_ENFORCED explicitly.
-- ============================================================================

DO $pre$
BEGIN
  IF to_regnamespace('saf') IS NULL THEN
    RAISE EXCEPTION 'Run sa_final_wave/00_harness_and_fixtures.sql first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE id::text NOT LIKE '00000000-0000-0000-0000-0000000%') THEN
    RAISE EXCEPTION 'Refusing to run identity tests: database contains non-fixture users';
  END IF;
  IF to_regprocedure('public.identity_provision(uuid,uuid,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Identity Foundation migrations are not applied';
  END IF;
END
$pre$;

DROP SCHEMA IF EXISTS idt CASCADE;
CREATE SCHEMA idt;
GRANT USAGE ON SCHEMA idt TO PUBLIC;

-- Auth identity created the way GoTrue would (the provisioning core runs after it).
CREATE FUNCTION idt.auth_user(p_n integer, p_email text, p_phone text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid := ('00000000-0000-0000-0000-0000000001' || lpad(p_n::text, 2, '0'))::uuid;
BEGIN
  INSERT INTO auth.users (id, email, phone) VALUES (v, p_email, p_phone) ON CONFLICT (id) DO NOTHING;
  RETURN v;
END $$;

CREATE FUNCTION idt.provision(p_actor uuid, p_user uuid, p_payload jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.identity_provision(p_actor, p_user, p_payload) $$;

CREATE FUNCTION idt.new_uid(p_n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000000001' || lpad(p_n::text, 2, '0'))::uuid $$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA idt TO PUBLIC;

DO $$ BEGIN
  PERFORM saf.expect_eq('baseline: every permission SHADOW (production-like)',
    (SELECT count(*) FROM public.sa_migration_modes WHERE mode <> 'SHADOW')::int, 0);
  PERFORM saf.expect_eq('baseline: legacy authorization writable (production-like)',
    public.sa_setting_bool('legacy_authorization.read_only', true), false);
  PERFORM saf.expect_eq('fixtures carry derived principal types',
    (SELECT count(*) FROM public.users WHERE principal_type IS NULL OR account_status IS NULL)::int, 0);
  PERFORM saf.expect_eq('inactive fixture is DISABLED',
    (SELECT account_status FROM public.users WHERE id = saf.uid('inactive')), 'DISABLED');
  PERFORM saf.expect_eq('consumer fixture is CONSUMER',
    (SELECT principal_type FROM public.users WHERE id = saf.uid('consumer')), 'CONSUMER');
  PERFORM saf.expect_eq('distributor fixture is DISTRIBUTOR_USER',
    (SELECT principal_type FROM public.users WHERE id = saf.uid('dist_a')), 'DISTRIBUTOR_USER');
  PERFORM saf.expect_eq('warehouse fixture is INTERNAL_EMPLOYEE',
    (SELECT principal_type FROM public.users WHERE id = saf.uid('whm_a1')), 'INTERNAL_EMPLOYEE');
END $$;
