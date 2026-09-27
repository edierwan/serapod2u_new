-- ============================================================================
-- S&A Wave 1 readiness — harness + fixtures
-- ----------------------------------------------------------------------------
-- DISPOSABLE DATABASES ONLY. Restore a schema-only dump (pg_dump -s) of
-- staging, re-apply 20260927140000_sa_wave1_foundation.sql (idempotent; seeds
-- the permission catalog and migration modes), apply
-- 20260927150000_sa_wave1_readiness.sql, then run every file in this folder
-- in order:
--
--   createdb sa_ready -T <schema_only_template>
--   psql -d sa_ready -1 -f supabase/migrations/20260927140000_sa_wave1_foundation.sql
--   psql -d sa_ready -1 -f supabase/migrations/20260927150000_sa_wave1_readiness.sql
--   for f in supabase/tests/security/sa_wave1_readiness/*.sql; do
--     psql -X -v ON_ERROR_STOP=1 -d sa_ready -f "$f" || exit 1
--   done
--
-- NEVER run against staging: localhost shares the staging database. The guard
-- below refuses to run when non-fixture users exist. Requests are simulated
-- the way PostgREST does it (SET ROLE + request.jwt.claims).
-- ============================================================================

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.users WHERE id::text NOT LIKE '00000000-0000-0000-0000-0000000%') THEN
    RAISE EXCEPTION 'Refusing to run S&A readiness fixtures: database contains non-fixture users';
  END IF;
END
$guard$;

DROP SCHEMA IF EXISTS sar_test CASCADE;
CREATE SCHEMA sar_test;
GRANT USAGE ON SCHEMA sar_test TO PUBLIC;

-- Runs p_sql as p_role with JWT subject p_sub. Returns 'OK' or 'ERR:<state>:<msg>'.
CREATE FUNCTION sar_test.try_as(p_role text, p_sub uuid, p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_result text;
BEGIN
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

-- Runs a single-value query as p_role and returns its text result.
CREATE FUNCTION sar_test.value_as(p_role text, p_sub uuid, p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
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

CREATE FUNCTION sar_test.expect_ok(p_label text, p_role text, p_sub uuid, p_sql text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v text := sar_test.try_as(p_role, p_sub, p_sql);
BEGIN
  IF v <> 'OK' THEN RAISE EXCEPTION 'FAIL [%]: expected success, got %', p_label, v; END IF;
  RAISE NOTICE 'PASS [%]', p_label;
END $$;

-- Expects an error whose "<state>:<message>" contains p_fragment.
CREATE FUNCTION sar_test.expect_err(p_label text, p_role text, p_sub uuid, p_sql text, p_fragment text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v text := sar_test.try_as(p_role, p_sub, p_sql);
BEGIN
  IF v NOT LIKE 'ERR:%' || p_fragment || '%' THEN
    RAISE EXCEPTION 'FAIL [%]: expected error containing %, got %', p_label, p_fragment, v;
  END IF;
  RAISE NOTICE 'PASS [%] (%)', p_label, left(v, 100);
END $$;

CREATE FUNCTION sar_test.expect_eq(p_label text, p_actual anyelement, p_expected anyelement)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'FAIL [%]: expected %, got %', p_label, p_expected, p_actual;
  END IF;
  RAISE NOTICE 'PASS [%] = %', p_label, p_actual;
END $$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA sar_test TO PUBLIC;

-- ---------------------------------------------------------------------------
-- Fixtures: HQ_A -> WH_A1, WH_A2 ; HQ_B -> WH_B
-- ---------------------------------------------------------------------------
INSERT INTO public.organization_types (type_code, type_name, hierarchy_level) VALUES
  ('HQ','Headquarters',1), ('WH','Warehouse',4)
ON CONFLICT (type_code) DO NOTHING;

INSERT INTO public.roles (role_code, role_name, role_level, permissions) VALUES
  ('SA','Super Admin',1,'{}'::jsonb),
  ('HQ','HQ Admin',10,'{"post_stock_count": true}'::jsonb),
  ('MANAGER','Manager',30,'{"post_stock_count": true}'::jsonb),
  ('USER','User',40,'{"view_inventory": true}'::jsonb)
ON CONFLICT (role_code) DO UPDATE SET permissions = EXCLUDED.permissions, role_level = EXCLUDED.role_level;

INSERT INTO public.organizations (id, org_code, org_name, org_type_code, parent_org_id, is_active) VALUES
  ('00000000-0000-0000-0000-00000000a001', 'T-HQ-A',  'Test HQ A',  'HQ', NULL, true),
  ('00000000-0000-0000-0000-00000000a002', 'T-WH-A1', 'Test WH A1', 'WH', '00000000-0000-0000-0000-00000000a001', true),
  ('00000000-0000-0000-0000-00000000a003', 'T-WH-A2', 'Test WH A2', 'WH', '00000000-0000-0000-0000-00000000a001', true),
  ('00000000-0000-0000-0000-00000000a006', 'T-HQ-B',  'Test HQ B',  'HQ', NULL, true),
  ('00000000-0000-0000-0000-00000000a007', 'T-WH-B',  'Test WH B',  'WH', '00000000-0000-0000-0000-00000000a006', true);

INSERT INTO auth.users (id, email)
SELECT ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'fixture' || n || '@sar.test'
FROM generate_series(1, 6) AS n;

INSERT INTO public.users (id, email, role_code, organization_id, is_active, full_name, account_scope) VALUES
  ('00000000-0000-0000-0000-000000000001', 'fixture1@sar.test', 'SA',      '00000000-0000-0000-0000-00000000a001', true,  'SA A',       'portal'),
  ('00000000-0000-0000-0000-000000000002', 'fixture2@sar.test', 'HQ',      '00000000-0000-0000-0000-00000000a001', true,  'HQ A',       'portal'),
  ('00000000-0000-0000-0000-000000000003', 'fixture3@sar.test', 'MANAGER', '00000000-0000-0000-0000-00000000a001', true,  'Manager A',  'portal'),
  ('00000000-0000-0000-0000-000000000004', 'fixture4@sar.test', 'USER',    '00000000-0000-0000-0000-00000000a001', true,  'User A',     'portal'),
  ('00000000-0000-0000-0000-000000000005', 'fixture5@sar.test', 'HQ',      '00000000-0000-0000-0000-00000000a006', true,  'HQ B',       'portal'),
  ('00000000-0000-0000-0000-000000000006', 'fixture6@sar.test', 'MANAGER', '00000000-0000-0000-0000-00000000a001', false, 'Inactive A', 'portal');

CREATE FUNCTION sar_test.uid(p_name text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_name
    WHEN 'sa'       THEN '00000000-0000-0000-0000-000000000001'
    WHEN 'hq_a'     THEN '00000000-0000-0000-0000-000000000002'
    WHEN 'manager'  THEN '00000000-0000-0000-0000-000000000003'
    WHEN 'user'     THEN '00000000-0000-0000-0000-000000000004'
    WHEN 'hq_b'     THEN '00000000-0000-0000-0000-000000000005'
    WHEN 'inactive' THEN '00000000-0000-0000-0000-000000000006'
  END::uuid $$;
CREATE FUNCTION sar_test.org(p_name text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_name
    WHEN 'hq_a'  THEN '00000000-0000-0000-0000-00000000a001'
    WHEN 'wh_a1' THEN '00000000-0000-0000-0000-00000000a002'
    WHEN 'wh_a2' THEN '00000000-0000-0000-0000-00000000a003'
    WHEN 'hq_b'  THEN '00000000-0000-0000-0000-00000000a006'
  END::uuid $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA sar_test TO PUBLIC;

-- Inventory: one variant, one configuration, 10 on hand in WH_A1.
INSERT INTO public.product_categories (id, category_code, category_name) VALUES
  ('00000000-0000-0000-0000-0000000c0001', 'SAR-CAT', 'SAR Category');
INSERT INTO public.products (id, category_id, product_code, product_name) VALUES
  ('00000000-0000-0000-0000-0000000d0001', '00000000-0000-0000-0000-0000000c0001', 'SAR-P1', 'SAR Product');
INSERT INTO public.product_variants (id, product_id, variant_code, variant_name, base_cost) VALUES
  ('00000000-0000-0000-0000-0000000e0001', '00000000-0000-0000-0000-0000000d0001', 'SAR-V1', 'SAR Variant', 10);
-- The variant trigger creates its default configuration; count against it.
CREATE FUNCTION sar_test.config_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM public.inventory_stock_configurations
  WHERE variant_id = '00000000-0000-0000-0000-0000000e0001' ORDER BY created_at LIMIT 1 $$;
GRANT EXECUTE ON FUNCTION sar_test.config_id() TO PUBLIC;
INSERT INTO public.product_inventory (variant_id, organization_id, stock_config_id, quantity_on_hand, quantity_allocated, is_active)
VALUES ('00000000-0000-0000-0000-0000000e0001', '00000000-0000-0000-0000-00000000a002', sar_test.config_id(), 10, 0, true);
INSERT INTO public.stock_adjustment_reasons (reason_code, reason_name, is_active)
VALUES ('SAR_COUNT', 'Stock count variance', true) ON CONFLICT DO NOTHING;

-- Creates a draft full count in WH_A1 counting one unit less than on hand.
CREATE FUNCTION sar_test.new_session() RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid := gen_random_uuid();
  v_on_hand integer := (SELECT quantity_on_hand FROM public.product_inventory
    WHERE organization_id = sar_test.org('wh_a1') AND stock_config_id = sar_test.config_id());
BEGIN
  INSERT INTO public.stock_count_sessions (id, warehouse_organization_id, count_type, status, notes, reference_name, created_by)
  VALUES (v_id, sar_test.org('wh_a1'), 'full_count', 'draft', 'SAR fixture variance', 'SAR-' || left(v_id::text, 8), sar_test.uid('sa'));
  INSERT INTO public.stock_count_session_items (session_id, variant_id, stock_config_id, system_quantity, physical_quantity, adjustment_quantity, unit_cost)
  VALUES (v_id, '00000000-0000-0000-0000-0000000e0001', sar_test.config_id(), v_on_hand, v_on_hand - 1, -1, 10);
  RETURN v_id;
END $$;

-- Records a server-helper decision (what requireAuthorization writes via service_role).
CREATE FUNCTION sar_test.record_decision(
  p_actor uuid, p_session uuid, p_mode text, p_decision text, p_new text,
  p_permission text DEFAULT 'inventory.stock_count.verify', p_age interval DEFAULT interval '0')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.sa_authorization_decisions (
    id, occurred_at, actor_id, permission_key, resource_type, resource_id, decision, reason_code,
    migration_mode, legacy_decision, new_decision, comparison, audit_class, policy_version)
  VALUES (
    v_id, now() - p_age, p_actor, p_permission, 'stock_count', p_session::text, p_decision,
    CASE WHEN p_new = 'ALLOW' THEN 'ALLOWED_BY_ASSIGNMENT' ELSE 'MISSING_MEMBERSHIP' END,
    p_mode, 'ALLOW', p_new,
    CASE WHEN p_new = 'ALLOW' THEN 'MATCH_ALLOW' ELSE 'LEGACY_ALLOW_NEW_DENY' END,
    CASE WHEN p_mode IN ('NEW_ENFORCED','LEGACY_RETIRED') THEN 'ENFORCED_DECISION' ELSE 'ORDINARY_SHADOW' END,
    'sa-wave1-v1');
  RETURN v_id;
END $$;

-- Business-mutation footprint of a session (non-zero once anything was written).
CREATE FUNCTION sar_test.footprint(p_session uuid) RETURNS text LANGUAGE sql AS $$
  SELECT concat_ws('|',
    (SELECT status FROM public.stock_count_sessions WHERE id = p_session),
    (SELECT count(*) FROM public.stock_count_verification_requests WHERE session_id = p_session),
    (SELECT count(*) FROM public.stock_movements WHERE reference_id = p_session),
    (SELECT quantity_on_hand FROM public.product_inventory
      WHERE organization_id = sar_test.org('wh_a1') AND variant_id = '00000000-0000-0000-0000-0000000e0001'))
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA sar_test TO PUBLIC;

SELECT 'fixtures ready' AS status;
