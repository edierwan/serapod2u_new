-- ============================================================================
-- Stock Count status integrity: a session can become 'posted' only through the
-- SECURITY DEFINER posting workflow (OTP verification + atomic inventory
-- movements). Direct PostgREST table writes by API roles are limited to drafts.
-- Requires 00_harness_and_fixtures.sql and
-- 20260927160000_stock_count_session_integrity.sql.
-- ============================================================================
\set ON_ERROR_STOP on

CREATE TEMP TABLE si (name text PRIMARY KEY, id uuid);
GRANT ALL ON si TO PUBLIC;
CREATE FUNCTION sar_test.si(p_name text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM si WHERE name = p_name $$;
GRANT EXECUTE ON FUNCTION sar_test.si(text) TO PUBLIC;

-- A legitimately posted count (real workflow) to attack afterwards.
INSERT INTO si VALUES ('posted', sar_test.new_session());
SELECT sar_test.expect_ok('workflow: prepare', 'authenticated', sar_test.uid('manager'),
  format($f$SELECT public.prepare_stock_count_verification(%L::uuid, %L::uuid, %L, '[]'::jsonb, '{}'::jsonb)$f$, sar_test.si('posted'), sar_test.org('hq_a'), repeat('b', 64)));
SELECT sar_test.expect_ok('workflow: finalize', 'authenticated', sar_test.uid('manager'),
  format('SELECT public.finalize_stock_count_verification_delivery(%L::uuid, true)', (SELECT id FROM public.stock_count_verification_requests WHERE session_id = sar_test.si('posted'))));
SELECT sar_test.expect_ok('workflow: verify and post (SECURITY DEFINER path still works)', 'authenticated', sar_test.uid('manager'),
  format('SELECT public.verify_and_post_stock_count(%L::uuid, %L)', (SELECT id FROM public.stock_count_verification_requests WHERE session_id = sar_test.si('posted')), repeat('b', 64)));
SELECT sar_test.expect_eq('workflow: posted with movement', split_part(sar_test.footprint(sar_test.si('posted')), '|', 1) || '|' || split_part(sar_test.footprint(sar_test.si('posted')), '|', 3), 'posted|1');

INSERT INTO si VALUES ('draft', sar_test.new_session());
CREATE TEMP TABLE before_attack AS SELECT sar_test.footprint(sar_test.si('posted')) fp;
GRANT ALL ON before_attack TO PUBLIC;

-- ---- direct status forcing by API roles ------------------------------------------
SELECT sar_test.expect_err('USER cannot flip draft -> posted', 'authenticated', sar_test.uid('user'),
  format($f$UPDATE public.stock_count_sessions SET status = 'posted', posted_at = now(), posted_by = %L WHERE id = %L$f$, sar_test.uid('user'), sar_test.si('draft')), 'stock_count_status_transition_not_allowed');
SELECT sar_test.expect_err('SA cannot flip draft -> posted directly either', 'authenticated', sar_test.uid('sa'),
  format($f$UPDATE public.stock_count_sessions SET status = 'posted', posted_at = now() WHERE id = %L$f$, sar_test.si('draft')), 'stock_count_status_transition_not_allowed');
SELECT sar_test.expect_err('USER cannot archive a draft directly (discard uses the RPC)', 'authenticated', sar_test.uid('user'),
  format($f$UPDATE public.stock_count_sessions SET status = 'archived' WHERE id = %L$f$, sar_test.si('draft')), 'stock_count_status_transition_not_allowed');
SELECT sar_test.expect_err('USER cannot insert a session already posted', 'authenticated', sar_test.uid('user'),
  format($f$INSERT INTO public.stock_count_sessions (warehouse_organization_id, count_type, status, posted_at, reference_name) VALUES (%L, 'full_count', 'posted', now(), 'forged')$f$, sar_test.org('wh_a1')), 'stock_count_status_transition_not_allowed');
SELECT sar_test.expect_err('USER cannot stamp posted_by on a draft', 'authenticated', sar_test.uid('user'),
  format($f$UPDATE public.stock_count_sessions SET posted_by = %L WHERE id = %L$f$, sar_test.uid('sa'), sar_test.si('draft')), 'stock_count_status_transition_not_allowed');

-- ---- posted history is immutable to API roles ---------------------------------------
SELECT sar_test.expect_err('USER cannot revert posted -> draft', 'authenticated', sar_test.uid('user'),
  format($f$UPDATE public.stock_count_sessions SET status = 'draft', posted_at = NULL, posted_by = NULL WHERE id = %L$f$, sar_test.si('posted')), 'stock_count_posted_session_immutable');
SELECT sar_test.expect_err('USER cannot archive a posted count', 'authenticated', sar_test.uid('user'),
  format($f$UPDATE public.stock_count_sessions SET status = 'archived', posted_at = NULL WHERE id = %L$f$, sar_test.si('posted')), 'stock_count_posted_session_immutable');
SELECT sar_test.expect_err('USER cannot rewrite posted totals/notes', 'authenticated', sar_test.uid('user'),
  format($f$UPDATE public.stock_count_sessions SET net_quantity_adjustment = 0, notes = 'x' WHERE id = %L$f$, sar_test.si('posted')), 'stock_count_posted_session_immutable');
SELECT sar_test.expect_err('USER cannot delete a posted count', 'authenticated', sar_test.uid('user'),
  format($f$DELETE FROM public.stock_count_sessions WHERE id = %L$f$, sar_test.si('posted')), 'stock_count_posted_session_immutable');
SELECT sar_test.expect_err('USER cannot edit items of a posted count', 'authenticated', sar_test.uid('user'),
  format($f$UPDATE public.stock_count_session_items SET physical_quantity = 1 WHERE session_id = %L$f$, sar_test.si('posted')), 'stock_count_posted_session_immutable');
SELECT sar_test.expect_err('USER cannot add items to a posted count', 'authenticated', sar_test.uid('user'),
  format($f$INSERT INTO public.stock_count_session_items (session_id, variant_id, stock_config_id, system_quantity, physical_quantity) VALUES (%L, '00000000-0000-0000-0000-0000000e0001', sar_test.config_id(), 0, 0)$f$, sar_test.si('posted')), 'stock_count_posted_session_immutable');
SELECT sar_test.expect_err('USER cannot delete items of a posted count', 'authenticated', sar_test.uid('user'),
  format($f$DELETE FROM public.stock_count_session_items WHERE session_id = %L$f$, sar_test.si('posted')), 'stock_count_posted_session_immutable');
SELECT sar_test.expect_eq('posted count untouched (status, request, movement, stock)', sar_test.footprint(sar_test.si('posted')), (SELECT fp FROM before_attack));
SELECT sar_test.expect_eq('draft untouched', split_part(sar_test.footprint(sar_test.si('draft')), '|', 1), 'draft');

-- ---- opening balance session ---------------------------------------------------------
INSERT INTO si VALUES ('opening', gen_random_uuid());
INSERT INTO public.stock_count_sessions (id, warehouse_organization_id, count_type, status, product_category_id, reference_name, notes)
VALUES (sar_test.si('opening'), sar_test.org('wh_a2'), 'opening_balance_cutoff', 'draft', '00000000-0000-0000-0000-0000000c0001', 'SAR-OB', 'ob');
SELECT sar_test.expect_err('USER cannot flip an Opening Balance count to posted', 'authenticated', sar_test.uid('user'),
  format($f$UPDATE public.stock_count_sessions SET status = 'posted', posted_at = now() WHERE id = %L$f$, sar_test.si('opening')), 'stock_count_status_transition_not_allowed');

-- ---- anon ---------------------------------------------------------------------------
SELECT sar_test.expect_eq('anon sees/changes no sessions (RLS)',
  sar_test.value_as('anon', NULL, format($f$WITH u AS (UPDATE public.stock_count_sessions SET status = 'posted', posted_at = now() WHERE id = %L RETURNING 1) SELECT count(*)::text FROM u$f$, sar_test.si('draft'))), '0');

-- ---- legitimate draft behavior is preserved ---------------------------------------------
SELECT sar_test.expect_ok('draft save: insert a draft', 'authenticated', sar_test.uid('manager'),
  format($f$INSERT INTO public.stock_count_sessions (warehouse_organization_id, count_type, status, reference_name, created_by) VALUES (%L, 'full_count', 'draft', 'SAR-new', %L)$f$, sar_test.org('wh_a1'), sar_test.uid('manager')));
SELECT sar_test.expect_ok('draft save: update draft fields + notes', 'authenticated', sar_test.uid('manager'),
  format($f$UPDATE public.stock_count_sessions SET notes = 'updated', reference_name = 'SAR-renamed', status = 'draft' WHERE id = %L AND status = 'draft'$f$, sar_test.si('draft')));
SELECT sar_test.expect_ok('draft save: upsert items of a draft', 'authenticated', sar_test.uid('manager'),
  format($f$UPDATE public.stock_count_session_items SET note = 'n' WHERE session_id = %L$f$, sar_test.si('draft')));
SELECT sar_test.expect_ok('discard RPC still archives a draft', 'authenticated', sar_test.uid('manager'),
  format($f$SELECT public.discard_stock_count_drafts(ARRAY[%L]::uuid[])$f$, sar_test.si('draft')));
SELECT sar_test.expect_eq('draft archived through the RPC', split_part(sar_test.footprint(sar_test.si('draft')), '|', 1), 'archived');
SELECT sar_test.expect_ok('service_role (trusted server) is unaffected', 'service_role', NULL,
  format($f$UPDATE public.stock_count_sessions SET notes = 'svc' WHERE id = %L$f$, sar_test.si('opening')));

SELECT 'stock count status integrity suite passed' AS status;
