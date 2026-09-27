-- ============================================================================
-- S&A Final Wave — harness + fixtures
-- ----------------------------------------------------------------------------
-- DISPOSABLE DATABASES ONLY. Restore a schema-only dump (pg_dump -s) of
-- staging, re-apply the idempotent Wave 1 migrations (catalog seeds), apply
-- the four Final Wave migrations in order, then run every file here:
--
--   createdb sa_final -T <schema_only_template>
--   for m in 20260927140000_sa_wave1_foundation 20260927150000_sa_wave1_readiness \
--            20260928100000_sa_final_governance_foundation 20260928110000_sa_final_finance_hr_lifecycle \
--            20260928120000_sa_final_modules_supply_chain 20260928130000_sa_final_legacy_retirement_support; do
--     psql -d sa_final -v ON_ERROR_STOP=1 -1 -f supabase/migrations/$m.sql || exit 1; done
--   for f in supabase/tests/security/sa_final_wave/*.sql; do
--     psql -X -v ON_ERROR_STOP=1 -d sa_final -f "$f" || exit 1; done
--
-- NEVER run against staging or production (localhost shares staging). The
-- guard refuses to run when non-fixture users exist. Requests are simulated
-- the way PostgREST does (SET ROLE + request.jwt.claims) — this pattern is
-- only safe on a vanilla PostgreSQL replica (it crashes the Supabase image).
-- ============================================================================

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.users WHERE id::text NOT LIKE '00000000-0000-0000-0000-0000000%') THEN
    RAISE EXCEPTION 'Refusing to run S&A Final Wave fixtures: database contains non-fixture users';
  END IF;
END
$guard$;

DROP SCHEMA IF EXISTS saf CASCADE;
CREATE SCHEMA saf;
GRANT USAGE ON SCHEMA saf TO PUBLIC;

-- The database gates memoise decisions per transaction (by design, one
-- PostgREST request = one transaction). Tests that change modes/assignments
-- inside one transaction clear the memo first.
CREATE FUNCTION saf.clear_cache() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('sa_cache.epoch', gen_random_uuid()::text, true)
$$;

CREATE FUNCTION saf.try_as(p_role text, p_sub uuid, p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_result text;
BEGIN
  PERFORM saf.clear_cache();
  PERFORM set_config('request.jwt.claims', json_build_object('role', p_role, 'sub', p_sub)::text, true);
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
END $$;

CREATE FUNCTION saf.value_as(p_role text, p_sub uuid, p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM saf.clear_cache();
  PERFORM set_config('request.jwt.claims', json_build_object('role', p_role, 'sub', p_sub)::text, true);
  PERFORM set_config('role', p_role, true);
  BEGIN
    EXECUTE p_sql INTO v;
  EXCEPTION WHEN OTHERS THEN
    v := 'ERR:' || SQLSTATE || ':' || SQLERRM;
  END;
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN v;
END $$;

CREATE FUNCTION saf.expect_ok(p_label text, p_role text, p_sub uuid, p_sql text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v text := saf.try_as(p_role, p_sub, p_sql);
BEGIN
  IF v <> 'OK' THEN RAISE EXCEPTION 'FAIL [%]: expected success, got %', p_label, v; END IF;
  RAISE NOTICE 'PASS [%]', p_label;
END $$;

CREATE FUNCTION saf.expect_err(p_label text, p_role text, p_sub uuid, p_sql text, p_fragment text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v text := saf.try_as(p_role, p_sub, p_sql);
BEGIN
  IF v NOT LIKE 'ERR:%' || p_fragment || '%' THEN
    RAISE EXCEPTION 'FAIL [%]: expected error containing %, got %', p_label, p_fragment, v;
  END IF;
  RAISE NOTICE 'PASS [%] (%)', p_label, left(v, 110);
END $$;

-- Owner-side call expecting an error (governance functions run as service).
CREATE FUNCTION saf.expect_raise(p_label text, p_sql text, p_fragment text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%' || p_fragment || '%' THEN
      RAISE EXCEPTION 'FAIL [%]: expected error containing %, got %', p_label, p_fragment, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS [%] (%)', p_label, left(SQLERRM, 110);
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL [%]: expected error containing %, got success', p_label, p_fragment;
END $$;

CREATE FUNCTION saf.expect_eq(p_label text, p_actual anyelement, p_expected anyelement)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'FAIL [%]: expected %, got %', p_label, p_expected, p_actual;
  END IF;
  RAISE NOTICE 'PASS [%] = %', p_label, p_actual;
END $$;

CREATE FUNCTION saf.set_mode(p_permission text, p_mode text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.sa_migration_modes SET mode = p_mode WHERE permission_key = p_permission;
  PERFORM saf.clear_cache();
END $$;

CREATE FUNCTION saf.decide(p_actor uuid, p_permission text, p_ctx jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT (public.sa_evaluate_permission(p_actor, p_permission, p_ctx)->>'decision') || ':' ||
         (public.sa_evaluate_permission(p_actor, p_permission, p_ctx)->>'reason_code')
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA saf TO PUBLIC;

-- ---------------------------------------------------------------------------
-- Fixtures: HQ_A -> WH_A1, DIST_A -> SHOP_A ; HQ_B -> WH_B
-- ---------------------------------------------------------------------------
INSERT INTO public.organization_types (type_code, type_name, hierarchy_level) VALUES
  ('HQ','Headquarters',1), ('WH','Warehouse',4), ('DIST','Distributor',2), ('SHOP','Shop',3)
ON CONFLICT (type_code) DO NOTHING;

INSERT INTO public.roles (role_code, role_name, role_level, permissions) VALUES
  ('SA','Super Admin',1,'{}'::jsonb),
  ('HQ','HQ Admin',10,'{"approve_orders": true}'::jsonb),
  ('POWER_USER','Power User',20,'{"approve_orders": true, "view_users": true}'::jsonb),
  ('HR_MANAGER','HR Manager',30,'{}'::jsonb),
  ('MANAGER','Manager',30,'{"post_stock_count": true}'::jsonb),
  ('DIST','Distributor',30,'{"create_orders": true}'::jsonb),
  ('USER','User',40,'{}'::jsonb),
  ('GUEST','Guest',50,'{}'::jsonb)
ON CONFLICT (role_code) DO UPDATE SET permissions = EXCLUDED.permissions, role_level = EXCLUDED.role_level;

INSERT INTO public.organizations (id, org_code, org_name, org_type_code, parent_org_id, is_active) VALUES
  ('00000000-0000-0000-0000-00000000a001', 'F-HQ-A',  'Final HQ A',  'HQ',   NULL, true),
  ('00000000-0000-0000-0000-00000000a002', 'F-WH-A1', 'Final WH A1', 'WH',   '00000000-0000-0000-0000-00000000a001', true),
  ('00000000-0000-0000-0000-00000000a004', 'F-DIST-A','Final DIST A','DIST', '00000000-0000-0000-0000-00000000a001', true),
  ('00000000-0000-0000-0000-00000000a005', 'F-SHOP-A','Final SHOP A','SHOP', '00000000-0000-0000-0000-00000000a004', true),
  ('00000000-0000-0000-0000-00000000a006', 'F-HQ-B',  'Final HQ B',  'HQ',   NULL, true),
  ('00000000-0000-0000-0000-00000000a007', 'F-WH-B',  'Final WH B',  'WH',   '00000000-0000-0000-0000-00000000a006', true);

INSERT INTO auth.users (id, email)
SELECT ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'fixture' || n || '@saf.test'
FROM generate_series(1, 14) AS n;

-- The lifecycle trigger derives S&A memberships/assignments on insert.
INSERT INTO public.users (id, email, role_code, organization_id, is_active, full_name, account_scope, employment_type, employment_status) VALUES
  ('00000000-0000-0000-0000-000000000001','fixture1@saf.test','SA',        '00000000-0000-0000-0000-00000000a001', true,  'SA A',          'portal', 'Full-time', 'active'),
  ('00000000-0000-0000-0000-000000000002','fixture2@saf.test','HQ',        '00000000-0000-0000-0000-00000000a001', true,  'HQ Admin A',    'portal', 'Full-time', 'active'),
  ('00000000-0000-0000-0000-000000000003','fixture3@saf.test','POWER_USER','00000000-0000-0000-0000-00000000a001', true,  'Power User A',  'portal', 'Full-time', 'active'),
  ('00000000-0000-0000-0000-000000000004','fixture4@saf.test','HR_MANAGER','00000000-0000-0000-0000-00000000a001', true,  'HR Manager A',  'portal', 'Full-time', 'active'),
  ('00000000-0000-0000-0000-000000000005','fixture5@saf.test','USER',      '00000000-0000-0000-0000-00000000a001', true,  'Employee A',    'portal', 'Full-time', 'active'),
  ('00000000-0000-0000-0000-000000000006','fixture6@saf.test','MANAGER',   '00000000-0000-0000-0000-00000000a002', true,  'WH Manager A1', 'portal', 'Full-time', 'active'),
  ('00000000-0000-0000-0000-000000000007','fixture7@saf.test','DIST',      '00000000-0000-0000-0000-00000000a004', true,  'Distributor A', 'portal', 'Full-time', 'active'),
  ('00000000-0000-0000-0000-000000000008','fixture8@saf.test','HQ',        '00000000-0000-0000-0000-00000000a006', true,  'HQ Admin B',    'portal', 'Full-time', 'active'),
  ('00000000-0000-0000-0000-000000000009','fixture9@saf.test','USER',      '00000000-0000-0000-0000-00000000a001', false, 'Inactive A',    'portal', 'Full-time', 'active'),
  ('00000000-0000-0000-0000-000000000010','fixture10@saf.test','GUEST',    NULL,                                   true,  'Consumer',      'store',  NULL,        'active'),
  ('00000000-0000-0000-0000-000000000011','fixture11@saf.test','USER',     '00000000-0000-0000-0000-00000000a001', true,  'Contractor A',  'portal', 'Contract',  'active'),
  ('00000000-0000-0000-0000-000000000012','fixture12@saf.test','USER',     '00000000-0000-0000-0000-00000000a001', true,  'Employee A2',   'portal', 'Full-time', 'active'),
  ('00000000-0000-0000-0000-000000000013','fixture13@saf.test','POWER_USER','00000000-0000-0000-0000-00000000a001', true, 'Power User A2', 'portal', 'Full-time', 'active');
-- Reporting line: Employee A reports to HR Manager A.
UPDATE public.users SET manager_user_id = '00000000-0000-0000-0000-000000000004' WHERE id = '00000000-0000-0000-0000-000000000005';

CREATE FUNCTION saf.uid(p_name text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_name
    WHEN 'sa' THEN '00000000-0000-0000-0000-000000000001' WHEN 'hq_a' THEN '00000000-0000-0000-0000-000000000002'
    WHEN 'pu_a' THEN '00000000-0000-0000-0000-000000000003' WHEN 'hr_a' THEN '00000000-0000-0000-0000-000000000004'
    WHEN 'emp_a' THEN '00000000-0000-0000-0000-000000000005' WHEN 'whm_a1' THEN '00000000-0000-0000-0000-000000000006'
    WHEN 'dist_a' THEN '00000000-0000-0000-0000-000000000007' WHEN 'hq_b' THEN '00000000-0000-0000-0000-000000000008'
    WHEN 'inactive' THEN '00000000-0000-0000-0000-000000000009' WHEN 'consumer' THEN '00000000-0000-0000-0000-000000000010'
    WHEN 'contractor' THEN '00000000-0000-0000-0000-000000000011' WHEN 'emp_a2' THEN '00000000-0000-0000-0000-000000000012'
    WHEN 'pu_a2' THEN '00000000-0000-0000-0000-000000000013'
  END::uuid $$;
CREATE FUNCTION saf.org(p_name text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_name
    WHEN 'hq_a' THEN '00000000-0000-0000-0000-00000000a001' WHEN 'wh_a1' THEN '00000000-0000-0000-0000-00000000a002'
    WHEN 'dist_a' THEN '00000000-0000-0000-0000-00000000a004' WHEN 'shop_a' THEN '00000000-0000-0000-0000-00000000a005'
    WHEN 'hq_b' THEN '00000000-0000-0000-0000-00000000a006' WHEN 'wh_b' THEN '00000000-0000-0000-0000-00000000a007'
  END::uuid $$;
CREATE FUNCTION saf.ctx(p_org text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('organization_id', saf.org(p_org)) $$;
CREATE FUNCTION saf.role(p_key text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM public.sa_business_roles WHERE role_key = p_key $$;
CREATE FUNCTION saf.org_scope(p_org text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM public.sa_scope_definitions WHERE scope_value = saf.org(p_org)::text AND scope_type IN ('organization','warehouse') $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA saf TO PUBLIC;

SELECT 'fixtures ready' AS status,
  (SELECT count(*) FROM public.sa_organization_memberships WHERE status = 'active') AS memberships,
  (SELECT count(*) FROM public.sa_role_assignments WHERE status = 'active') AS assignments;
