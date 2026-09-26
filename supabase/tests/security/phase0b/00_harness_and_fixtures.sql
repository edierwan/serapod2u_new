-- ============================================================================
-- Phase 0B security regression tests — harness + fixtures
-- ----------------------------------------------------------------------------
-- DISPOSABLE DATABASES ONLY.
--   These scripts insert fixture organizations/users. Run them only against a
--   throwaway database restored from a schema-only dump (pg_dump -s) with the
--   Phase 0B migrations applied, e.g.:
--
--     createdb phase0b_test -T <schema_only_template>
--     psql -d phase0b_test -1 -f supabase/migrations/2026092710*.sql ...
--     for f in supabase/tests/security/phase0b/*.sql; do
--       psql -X -v ON_ERROR_STOP=1 -d phase0b_test -f "$f" || exit 1
--     done
--
--   NEVER run against staging: localhost shares the staging database.
--   The guard below refuses to run when real users exist.
--
-- Requests are simulated the same way PostgREST does it: SET ROLE to the API
-- role and set request.jwt.claims, so auth.uid()/auth.role() behave as in
-- production.
-- ============================================================================

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.users WHERE id::text NOT LIKE '00000000-0000-0000-0000-0000000%') THEN
    RAISE EXCEPTION 'Refusing to run Phase 0B fixtures: database contains non-fixture users';
  END IF;
END
$guard$;

-- Persistent (per-database) test helpers in a dedicated schema.
DROP SCHEMA IF EXISTS phase0b_test CASCADE;
CREATE SCHEMA phase0b_test;
GRANT USAGE ON SCHEMA phase0b_test TO PUBLIC;

-- Runs p_sql as p_role with the given JWT subject (NULL = no subject).
-- Returns 'OK' or 'ERR:<sqlstate>:<message>'.
CREATE FUNCTION phase0b_test.try_as(p_role text, p_sub uuid, p_sql text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_result text;
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('role', p_role, 'sub', p_sub)::text,
    true
  );
  PERFORM set_config('role', p_role, true);
  BEGIN
    EXECUTE p_sql;
    v_result := 'OK';
  EXCEPTION WHEN OTHERS THEN
    v_result := 'ERR:' || SQLSTATE || ':' || SQLERRM;
  END;
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN v_result;
END;
$$;

-- Returns the integer produced by p_sql (a single-value SELECT) as p_role.
CREATE FUNCTION phase0b_test.count_as(p_role text, p_sub uuid, p_sql text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer;
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('role', p_role, 'sub', p_sub)::text,
    true
  );
  PERFORM set_config('role', p_role, true);
  BEGIN
    EXECUTE p_sql INTO v_count;
  EXCEPTION WHEN OTHERS THEN
    v_count := -1; -- permission denied / error
  END;
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN v_count;
END;
$$;

CREATE FUNCTION phase0b_test.expect_ok(p_label text, p_role text, p_sub uuid, p_sql text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v text := phase0b_test.try_as(p_role, p_sub, p_sql);
BEGIN
  IF v <> 'OK' THEN
    RAISE EXCEPTION 'FAIL [%]: expected success, got %', p_label, v;
  END IF;
  RAISE NOTICE 'PASS [%]', p_label;
END;
$$;

-- Denied = permission error (42501) or an explicit guard exception.
CREATE FUNCTION phase0b_test.expect_denied(p_label text, p_role text, p_sub uuid, p_sql text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v text := phase0b_test.try_as(p_role, p_sub, p_sql);
BEGIN
  IF v NOT LIKE 'ERR:42501:%' THEN
    RAISE EXCEPTION 'FAIL [%]: expected permission denial, got %', p_label, v;
  END IF;
  RAISE NOTICE 'PASS [%] (%)', p_label, left(v, 90);
END;
$$;

CREATE FUNCTION phase0b_test.expect_count(p_label text, p_role text, p_sub uuid, p_sql text, p_expected integer)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v integer := phase0b_test.count_as(p_role, p_sub, p_sql);
BEGIN
  IF v IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'FAIL [%]: expected %, got % (-1 = error)', p_label, p_expected, v;
  END IF;
  RAISE NOTICE 'PASS [%] = %', p_label, v;
END;
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA phase0b_test TO PUBLIC;

-- ---------------------------------------------------------------------------
-- Fixtures
--   Company A: HQ_A -> WH_A1, WH_A2, DIST_A -> SHOP_A
--   Company B: HQ_B -> WH_B
-- ---------------------------------------------------------------------------
INSERT INTO public.organization_types (type_code, type_name, hierarchy_level) VALUES
  ('MFG','Manufacturer',2), ('DIST','Distributor',3), ('WH','Warehouse',4), ('SHOP','Shop',5),
  ('HQ','Headquarters',1), ('END_USER','End User',99), ('INDEP','Independent',50)
ON CONFLICT (type_code) DO NOTHING;

INSERT INTO public.roles (role_code, role_name, role_level) VALUES
  ('MANAGER','Manager',30), ('DIST','Distributor',30), ('USER','User',40), ('SHOP','Shop',40),
  ('GUEST','Guest',50), ('WH','Warehouse',30), ('POWER_USER','Power User',20),
  ('MFG','Manufacturer',30), ('SA','Super Admin',1), ('HQ','HQ Admin',10)
ON CONFLICT (role_code) DO NOTHING;

INSERT INTO public.organizations (id, org_code, org_name, org_type_code, parent_org_id) VALUES
  ('00000000-0000-0000-0000-00000000a001', 'T-HQ-A',  'Test HQ A',   'HQ',   NULL),
  ('00000000-0000-0000-0000-00000000a002', 'T-WH-A1', 'Test WH A1',  'WH',   '00000000-0000-0000-0000-00000000a001'),
  ('00000000-0000-0000-0000-00000000a003', 'T-WH-A2', 'Test WH A2',  'WH',   '00000000-0000-0000-0000-00000000a001'),
  ('00000000-0000-0000-0000-00000000a004', 'T-DIST-A','Test DIST A', 'DIST', '00000000-0000-0000-0000-00000000a001'),
  ('00000000-0000-0000-0000-00000000a005', 'T-SHOP-A','Test SHOP A', 'SHOP', '00000000-0000-0000-0000-00000000a004'),
  ('00000000-0000-0000-0000-00000000a006', 'T-HQ-B',  'Test HQ B',   'HQ',   NULL),
  ('00000000-0000-0000-0000-00000000a007', 'T-WH-B',  'Test WH B',   'WH',   '00000000-0000-0000-0000-00000000a006');

INSERT INTO auth.users (id, email)
SELECT ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'fixture' || n || '@phase0b.test'
FROM generate_series(1, 12) AS n;

-- id suffix | role | org | active | purpose
INSERT INTO public.users (id, email, role_code, organization_id, is_active, full_name, phone) VALUES
  ('00000000-0000-0000-0000-000000000001', 'fixture1@phase0b.test',  'SA',         '00000000-0000-0000-0000-00000000a001', true,  'SA A',        '+60110000001'),
  ('00000000-0000-0000-0000-000000000002', 'fixture2@phase0b.test',  'HQ',         '00000000-0000-0000-0000-00000000a001', true,  'HQ Admin A',  '+60110000002'),
  ('00000000-0000-0000-0000-000000000003', 'fixture3@phase0b.test',  'WH',         '00000000-0000-0000-0000-00000000a002', true,  'WH A1 user',  '+60110000003'),
  ('00000000-0000-0000-0000-000000000004', 'fixture4@phase0b.test',  'WH',         '00000000-0000-0000-0000-00000000a003', true,  'WH A2 user',  '+60110000004'),
  ('00000000-0000-0000-0000-000000000005', 'fixture5@phase0b.test',  'GUEST',      '00000000-0000-0000-0000-00000000a005', true,  'Shop A user', '+60110000005'),
  ('00000000-0000-0000-0000-000000000006', 'fixture6@phase0b.test',  'GUEST',      NULL,                                   true,  'Consumer',    '+60110000006'),
  ('00000000-0000-0000-0000-000000000007', 'fixture7@phase0b.test',  'HQ',         '00000000-0000-0000-0000-00000000a006', true,  'HQ Admin B',  '+60110000007'),
  ('00000000-0000-0000-0000-000000000008', 'fixture8@phase0b.test',  'HQ',         '00000000-0000-0000-0000-00000000a001', false, 'Inactive HQ', '+60110000008'),
  ('00000000-0000-0000-0000-000000000009', 'fixture9@phase0b.test',  'POWER_USER', '00000000-0000-0000-0000-00000000a001', true,  'PU A',        '+60110000009'),
  ('00000000-0000-0000-0000-000000000010', 'fixture10@phase0b.test', 'USER',       '00000000-0000-0000-0000-00000000a001', true,  'HQ A staff',  '+60110000010'),
  ('00000000-0000-0000-0000-000000000011', 'fixture11@phase0b.test', 'MANAGER',    '00000000-0000-0000-0000-00000000a001', true,  'Manager A',   '+60110000011'),
  ('00000000-0000-0000-0000-000000000012', 'fixture12@phase0b.test', 'USER',       '00000000-0000-0000-0000-00000000a006', true,  'HQ B staff',  '+60110000012');

-- Readable aliases for the tests.
CREATE FUNCTION phase0b_test.uid(p_name text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_name
    WHEN 'sa'         THEN '00000000-0000-0000-0000-000000000001'
    WHEN 'hq_a'       THEN '00000000-0000-0000-0000-000000000002'
    WHEN 'wh_a1'      THEN '00000000-0000-0000-0000-000000000003'
    WHEN 'wh_a2'      THEN '00000000-0000-0000-0000-000000000004'
    WHEN 'shop_a'     THEN '00000000-0000-0000-0000-000000000005'
    WHEN 'consumer'   THEN '00000000-0000-0000-0000-000000000006'
    WHEN 'hq_b'       THEN '00000000-0000-0000-0000-000000000007'
    WHEN 'inactive'   THEN '00000000-0000-0000-0000-000000000008'
    WHEN 'pu_a'       THEN '00000000-0000-0000-0000-000000000009'
    WHEN 'staff_a'    THEN '00000000-0000-0000-0000-000000000010'
    WHEN 'manager_a'  THEN '00000000-0000-0000-0000-000000000011'
    WHEN 'staff_b'    THEN '00000000-0000-0000-0000-000000000012'
  END::uuid
$$;

CREATE FUNCTION phase0b_test.org(p_name text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_name
    WHEN 'hq_a'   THEN '00000000-0000-0000-0000-00000000a001'
    WHEN 'wh_a1'  THEN '00000000-0000-0000-0000-00000000a002'
    WHEN 'wh_a2'  THEN '00000000-0000-0000-0000-00000000a003'
    WHEN 'dist_a' THEN '00000000-0000-0000-0000-00000000a004'
    WHEN 'shop_a' THEN '00000000-0000-0000-0000-00000000a005'
    WHEN 'hq_b'   THEN '00000000-0000-0000-0000-00000000a006'
    WHEN 'wh_b'   THEN '00000000-0000-0000-0000-00000000a007'
  END::uuid
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA phase0b_test TO PUBLIC;
