-- ============================================================================
-- Payment request documents: read boundary (20260928150000)
-- DISPOSABLE DATABASES ONLY (see 00_harness_and_fixtures.sql).
-- A payment request from Distributor A to HQ A must be readable by the issuer
-- and the receiving organization only — never by anon, a consumer account or
-- another tenant.
-- ============================================================================

-- Fixture row; foreign keys (order, creator) are not what is under test.
SET session_replication_role = replica;
INSERT INTO public.documents (id, order_id, doc_type, doc_no, issued_by_org_id, issued_to_org_id, company_id, created_by, payload)
VALUES ('00000000-0000-0000-0000-0000000d0c01', gen_random_uuid(), 'PAYMENT_REQUEST', 'F-PR-0001',
        saf.org('dist_a'), saf.org('hq_a'), saf.org('hq_a'), saf.uid('dist_a'), '{"amount": 1000}'::jsonb);
SET session_replication_role = origin;

DO $$
DECLARE q text := 'select count(*)::text from public.documents where id = ''00000000-0000-0000-0000-0000000d0c01''';
BEGIN
  PERFORM saf.expect_eq('payment request: no public-role SELECT policy remains',
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'documents'
       AND cmd IN ('SELECT','ALL') AND ('public' = ANY(roles) OR 'anon' = ANY(roles)))::int, 0);
  PERFORM saf.expect_eq('payment request: anon cannot read', saf.value_as('anon', NULL, q), '0');
  PERFORM saf.expect_eq('payment request: consumer account cannot read', saf.value_as('authenticated', saf.uid('consumer'), q), '0');
  PERFORM saf.expect_eq('payment request: another tenant HQ admin cannot read', saf.value_as('authenticated', saf.uid('hq_b'), q), '0');
  PERFORM saf.expect_eq('payment request: issuing organization reads', saf.value_as('authenticated', saf.uid('dist_a'), q), '1');
  PERFORM saf.expect_eq('payment request: receiving organization reads', saf.value_as('authenticated', saf.uid('emp_a'), q), '1');
  PERFORM saf.expect_eq('payment request: receiving HQ admin reads', saf.value_as('authenticated', saf.uid('hq_a'), q), '1');
END $$;

SET session_replication_role = replica;
DELETE FROM public.documents WHERE id = '00000000-0000-0000-0000-0000000d0c01';
SET session_replication_role = origin;
