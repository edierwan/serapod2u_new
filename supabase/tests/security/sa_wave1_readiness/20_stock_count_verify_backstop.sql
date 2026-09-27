-- ============================================================================
-- Blocker B: inventory.stock_count.verify database backstop + real mutation
-- ----------------------------------------------------------------------------
-- Exercises the real prepare_stock_count_verification ->
-- finalize_stock_count_verification_delivery -> verify_and_post_stock_count
-- chain as a direct authenticated client (the bypass path) and with a
-- server-helper decision present (the authorized path).
-- sar_test.footprint(): session status | #requests | #movements | on hand
-- ============================================================================
\set ON_ERROR_STOP on

CREATE FUNCTION sar_test.set_verify_mode(p_mode text) RETURNS void LANGUAGE sql AS $$
  UPDATE public.sa_migration_modes SET mode = p_mode WHERE permission_key = 'inventory.stock_count.verify' $$;
CREATE FUNCTION sar_test.prepare_sql(p_session uuid, p_org text DEFAULT 'hq_a') RETURNS text LANGUAGE sql AS $$
  SELECT format($f$SELECT public.prepare_stock_count_verification(%L::uuid, %L::uuid, %L, '[]'::jsonb, '{}'::jsonb)$f$,
    p_session, sar_test.org(p_org), repeat('a', 64)) $$;
CREATE FUNCTION sar_test.request_of(p_session uuid) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM public.stock_count_verification_requests WHERE session_id = p_session ORDER BY requested_at DESC LIMIT 1 $$;
CREATE FUNCTION sar_test.finalize_sql(p_session uuid) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.finalize_stock_count_verification_delivery(%L::uuid, true)', sar_test.request_of(p_session)) $$;
CREATE FUNCTION sar_test.post_sql(p_session uuid) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.verify_and_post_stock_count(%L::uuid, %L)', sar_test.request_of(p_session), repeat('a', 64)) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA sar_test TO PUBLIC;

CREATE TEMP TABLE s (name text PRIMARY KEY, id uuid);
GRANT ALL ON s TO PUBLIC;

-- ---- guard rails ---------------------------------------------------------------
SELECT sar_test.expect_eq('verify starts in SHADOW',
  (SELECT mode FROM public.sa_migration_modes WHERE permission_key = 'inventory.stock_count.verify'), 'SHADOW');
SELECT sar_test.expect_err('authenticated cannot change migration modes', 'authenticated', sar_test.uid('sa'),
  $q$UPDATE public.sa_migration_modes SET mode = 'SHADOW'$q$, '42501');
SELECT sar_test.expect_err('authenticated cannot call the backstop predicate', 'authenticated', sar_test.uid('manager'),
  $q$SELECT public.sa_has_recent_enforced_allow('00000000-0000-0000-0000-000000000003','inventory.stock_count.verify','stock_count','x')$q$, '42501');

-- ================================================================================
-- SHADOW: current behavior is preserved exactly (including the pre-existing
-- direct-RPC path, which stays governed by the legacy floor only).
-- ================================================================================
INSERT INTO s VALUES ('shadow', sar_test.new_session());
SELECT sar_test.expect_eq('shadow: baseline footprint', sar_test.footprint((SELECT id FROM s WHERE name = 'shadow')), 'draft|0|0|10');
SELECT sar_test.expect_ok('shadow: direct prepare without any S&A decision proceeds', 'authenticated', sar_test.uid('manager'), sar_test.prepare_sql((SELECT id FROM s WHERE name = 'shadow')));
SELECT sar_test.expect_ok('shadow: finalize proceeds', 'authenticated', sar_test.uid('manager'), sar_test.finalize_sql((SELECT id FROM s WHERE name = 'shadow')));
SELECT sar_test.expect_ok('shadow: verify-and-post proceeds', 'authenticated', sar_test.uid('manager'), sar_test.post_sql((SELECT id FROM s WHERE name = 'shadow')));
SELECT sar_test.expect_eq('shadow: stock count posted with one movement', sar_test.footprint((SELECT id FROM s WHERE name = 'shadow')), 'posted|1|1|9');

INSERT INTO s VALUES ('shadow_legacy_deny', sar_test.new_session());
SELECT sar_test.expect_err('shadow: ordinary USER still denied by the legacy floor', 'authenticated', sar_test.uid('user'),
  sar_test.prepare_sql((SELECT id FROM s WHERE name = 'shadow_legacy_deny')), 'permission_lost');
SELECT sar_test.expect_err('shadow: inactive account still denied by the legacy floor', 'authenticated', sar_test.uid('inactive'),
  sar_test.prepare_sql((SELECT id FROM s WHERE name = 'shadow_legacy_deny')), 'permission_lost');
SELECT sar_test.expect_ok('shadow: other-tenant HQ (legacy too broad) is unchanged', 'authenticated', sar_test.uid('hq_b'),
  sar_test.prepare_sql((SELECT id FROM s WHERE name = 'shadow_legacy_deny'), 'hq_b'));
-- Leave no active request behind for the next section.
SELECT sar_test.expect_eq('shadow: other-tenant request created (legacy behavior)',
  (SELECT count(*) FROM public.stock_count_verification_requests WHERE session_id = (SELECT id FROM s WHERE name = 'shadow_legacy_deny'))::int, 1);

-- ================================================================================
-- NEW_ENFORCED: no fresh server-side S&A ALLOW => no verification, no mutation
-- ================================================================================
SELECT sar_test.set_verify_mode('NEW_ENFORCED');
INSERT INTO s VALUES ('enf', sar_test.new_session());
SELECT sar_test.expect_err('enforced: direct prepare with no decision is rejected', 'authenticated', sar_test.uid('manager'),
  sar_test.prepare_sql((SELECT id FROM s WHERE name = 'enf')), 'sa_authorization_required');
SELECT sar_test.expect_eq('enforced: rejected prepare left no business mutation', sar_test.footprint((SELECT id FROM s WHERE name = 'enf')), 'draft|0|0|9');

SELECT sar_test.record_decision(sar_test.uid('manager'), (SELECT id FROM s WHERE name = 'enf'), 'SHADOW', 'ALLOW', 'ALLOW');
SELECT sar_test.expect_err('enforced: a SHADOW-mode ALLOW is not accepted', 'authenticated', sar_test.uid('manager'),
  sar_test.prepare_sql((SELECT id FROM s WHERE name = 'enf')), 'sa_authorization_required');
SELECT sar_test.record_decision(sar_test.uid('manager'), (SELECT id FROM s WHERE name = 'enf'), 'NEW_ENFORCED', 'DENY', 'DENY');
SELECT sar_test.expect_err('enforced: an enforced DENY is not accepted', 'authenticated', sar_test.uid('manager'),
  sar_test.prepare_sql((SELECT id FROM s WHERE name = 'enf')), 'sa_authorization_required');
SELECT sar_test.record_decision(sar_test.uid('manager'), (SELECT id FROM s WHERE name = 'shadow'), 'NEW_ENFORCED', 'ALLOW', 'ALLOW');
SELECT sar_test.expect_err('enforced: an ALLOW for another stock count is not accepted', 'authenticated', sar_test.uid('manager'),
  sar_test.prepare_sql((SELECT id FROM s WHERE name = 'enf')), 'sa_authorization_required');
SELECT sar_test.record_decision(sar_test.uid('sa'), (SELECT id FROM s WHERE name = 'enf'), 'NEW_ENFORCED', 'ALLOW', 'ALLOW');
SELECT sar_test.expect_err('enforced: an ALLOW for another actor is not accepted', 'authenticated', sar_test.uid('manager'),
  sar_test.prepare_sql((SELECT id FROM s WHERE name = 'enf')), 'sa_authorization_required');
SELECT sar_test.record_decision(sar_test.uid('manager'), (SELECT id FROM s WHERE name = 'enf'), 'NEW_ENFORCED', 'ALLOW', 'ALLOW', 'inventory.stock_count.post');
SELECT sar_test.expect_err('enforced: an ALLOW for another permission is not accepted', 'authenticated', sar_test.uid('manager'),
  sar_test.prepare_sql((SELECT id FROM s WHERE name = 'enf')), 'sa_authorization_required');
SELECT sar_test.record_decision(sar_test.uid('manager'), (SELECT id FROM s WHERE name = 'enf'), 'NEW_ENFORCED', 'ALLOW', 'ALLOW', 'inventory.stock_count.verify', interval '5 minutes');
SELECT sar_test.expect_err('enforced: a stale (5 min) ALLOW is not accepted', 'authenticated', sar_test.uid('manager'),
  sar_test.prepare_sql((SELECT id FROM s WHERE name = 'enf')), 'sa_authorization_required');
SELECT sar_test.expect_eq('enforced: still no business mutation after every rejected attempt', sar_test.footprint((SELECT id FROM s WHERE name = 'enf')), 'draft|0|0|9');

-- Authorized path: the helper recorded a fresh enforced ALLOW for this actor/session.
SELECT sar_test.record_decision(sar_test.uid('manager'), (SELECT id FROM s WHERE name = 'enf'), 'NEW_ENFORCED', 'ALLOW', 'ALLOW');
SELECT sar_test.expect_ok('enforced: prepare with fresh ALLOW proceeds', 'authenticated', sar_test.uid('manager'), sar_test.prepare_sql((SELECT id FROM s WHERE name = 'enf')));
SELECT sar_test.expect_ok('enforced: finalize (not a verification step) proceeds', 'authenticated', sar_test.uid('manager'), sar_test.finalize_sql((SELECT id FROM s WHERE name = 'enf')));
SELECT sar_test.expect_ok('enforced: verify-and-post with fresh ALLOW proceeds', 'authenticated', sar_test.uid('manager'), sar_test.post_sql((SELECT id FROM s WHERE name = 'enf')));
SELECT sar_test.expect_eq('enforced: authorized verification posted', sar_test.footprint((SELECT id FROM s WHERE name = 'enf')), 'posted|1|1|8');

-- A challenge issued before cutover cannot be consumed without a fresh ALLOW,
-- and the whole atomic posting rolls back.
SELECT sar_test.set_verify_mode('SHADOW');
INSERT INTO s VALUES ('cutover', sar_test.new_session());
SELECT sar_test.expect_ok('cutover: challenge issued while SHADOW', 'authenticated', sar_test.uid('hq_a'), sar_test.prepare_sql((SELECT id FROM s WHERE name = 'cutover')));
SELECT sar_test.expect_ok('cutover: challenge delivered', 'authenticated', sar_test.uid('hq_a'), sar_test.finalize_sql((SELECT id FROM s WHERE name = 'cutover')));
SELECT sar_test.set_verify_mode('NEW_ENFORCED');
SELECT sar_test.expect_err('cutover: consuming it after NEW_ENFORCED without ALLOW is rejected', 'authenticated', sar_test.uid('hq_a'),
  sar_test.post_sql((SELECT id FROM s WHERE name = 'cutover')), 'sa_authorization_required');
SELECT sar_test.expect_eq('cutover: atomic posting fully rolled back (no movement, stock unchanged)', sar_test.footprint((SELECT id FROM s WHERE name = 'cutover')), 'draft|1|0|8');
SELECT sar_test.expect_eq('cutover: challenge still active, not consumed',
  (SELECT status FROM public.stock_count_verification_requests WHERE id = sar_test.request_of((SELECT id FROM s WHERE name = 'cutover'))), 'active');
SELECT sar_test.record_decision(sar_test.uid('hq_a'), (SELECT id FROM s WHERE name = 'cutover'), 'NEW_ENFORCED', 'ALLOW', 'ALLOW');
SELECT sar_test.expect_ok('cutover: consuming with a fresh ALLOW proceeds', 'authenticated', sar_test.uid('hq_a'), sar_test.post_sql((SELECT id FROM s WHERE name = 'cutover')));
SELECT sar_test.expect_eq('cutover: posted', sar_test.footprint((SELECT id FROM s WHERE name = 'cutover')), 'posted|1|1|7');

-- Non-verification state changes stay unrestricted under NEW_ENFORCED.
INSERT INTO s VALUES ('invalidate', sar_test.new_session());
SELECT sar_test.record_decision(sar_test.uid('sa'), (SELECT id FROM s WHERE name = 'invalidate'), 'NEW_ENFORCED', 'ALLOW', 'ALLOW');
SELECT sar_test.expect_ok('enforced: SA prepare with ALLOW proceeds', 'authenticated', sar_test.uid('sa'), sar_test.prepare_sql((SELECT id FROM s WHERE name = 'invalidate')));
SELECT sar_test.expect_ok('enforced: expiry/invalidation updates are not blocked', 'supabase_admin', NULL,
  format($f$UPDATE public.stock_count_verification_requests SET status = 'invalidated', invalidated_at = now() WHERE id = %L$f$, sar_test.request_of((SELECT id FROM s WHERE name = 'invalidate'))));

-- Legacy floor is kept under NEW_ENFORCED: an S&A ALLOW never widens legacy.
INSERT INTO s VALUES ('floor', sar_test.new_session());
SELECT sar_test.record_decision(sar_test.uid('user'), (SELECT id FROM s WHERE name = 'floor'), 'NEW_ENFORCED', 'ALLOW', 'ALLOW');
SELECT sar_test.expect_err('enforced: legacy-denied USER stays denied even with an ALLOW row', 'authenticated', sar_test.uid('user'),
  sar_test.prepare_sql((SELECT id FROM s WHERE name = 'floor')), 'permission_lost');
SELECT sar_test.record_decision(sar_test.uid('inactive'), (SELECT id FROM s WHERE name = 'floor'), 'NEW_ENFORCED', 'ALLOW', 'ALLOW');
SELECT sar_test.expect_err('enforced: inactive account stays denied', 'authenticated', sar_test.uid('inactive'),
  sar_test.prepare_sql((SELECT id FROM s WHERE name = 'floor')), 'permission_lost');
SELECT sar_test.expect_err('enforced: other-tenant HQ without ALLOW is rejected', 'authenticated', sar_test.uid('hq_b'),
  sar_test.prepare_sql((SELECT id FROM s WHERE name = 'floor'), 'hq_b'), 'sa_authorization_required');

-- ================================================================================
-- LEGACY_RETIRED behaves like NEW_ENFORCED for the backstop
-- ================================================================================
SELECT sar_test.set_verify_mode('LEGACY_RETIRED');
INSERT INTO s VALUES ('retired', sar_test.new_session());
SELECT sar_test.expect_err('retired: direct prepare with no decision is rejected', 'authenticated', sar_test.uid('sa'),
  sar_test.prepare_sql((SELECT id FROM s WHERE name = 'retired')), 'sa_authorization_required');
SELECT sar_test.record_decision(sar_test.uid('sa'), (SELECT id FROM s WHERE name = 'retired'), 'LEGACY_RETIRED', 'ALLOW', 'ALLOW');
SELECT sar_test.expect_ok('retired: prepare with fresh ALLOW proceeds', 'authenticated', sar_test.uid('sa'), sar_test.prepare_sql((SELECT id FROM s WHERE name = 'retired')));

-- ================================================================================
-- LEGACY_ENFORCED: inert, like SHADOW
-- ================================================================================
SELECT sar_test.set_verify_mode('LEGACY_ENFORCED');
INSERT INTO s VALUES ('legacy', sar_test.new_session());
SELECT sar_test.expect_ok('legacy-enforced: direct prepare without decision proceeds (unchanged)', 'authenticated', sar_test.uid('manager'), sar_test.prepare_sql((SELECT id FROM s WHERE name = 'legacy')));

SELECT sar_test.set_verify_mode('SHADOW');
SELECT sar_test.expect_eq('suite restores SHADOW',
  (SELECT mode FROM public.sa_migration_modes WHERE permission_key = 'inventory.stock_count.verify'), 'SHADOW');
SELECT sar_test.expect_eq('other pilot operations untouched (all SHADOW)',
  (SELECT count(*) FROM public.sa_migration_modes WHERE permission_key LIKE 'inventory.%' AND mode <> 'SHADOW')::int, 0);

SELECT 'stock count verify backstop suite passed' AS status;
