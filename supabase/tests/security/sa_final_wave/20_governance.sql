-- S&A Final Wave — governance invariants
BEGIN;

-- ── A. Self-assignment / scope escalation ──────────────────────────────────
SELECT saf.expect_raise('A: user cannot assign themselves a role',
  format($$SELECT public.sa_assign_role(%L, %L, %L, %L, ARRAY[%L]::uuid[], null, null, 'self grant attempt')$$,
         saf.uid('sa'), saf.uid('sa'), saf.role('finance-admin'), saf.org('hq_a'), saf.org_scope('hq_a')),
  'sa_self_assignment_prohibited');
SELECT saf.expect_raise('A: non-security user cannot assign roles (legacy mode: super admin only)',
  format($$SELECT public.sa_assign_role(%L, %L, %L, %L, ARRAY[%L]::uuid[], null, null, 'grant by HQ admin')$$,
         saf.uid('hq_a'), saf.uid('emp_a'), saf.role('finance-admin'), saf.org('hq_a'), saf.org_scope('hq_a')),
  'sa_authorization_required');
SELECT saf.expect_raise('B: scope outside the membership organization is rejected',
  format($$SELECT public.sa_assign_role(%L, %L, %L, %L, ARRAY[%L]::uuid[], null, null, 'cross tenant scope')$$,
         saf.uid('sa'), saf.uid('emp_a'), saf.role('finance-viewer'), saf.org('hq_a'),
         (SELECT public.sa_ensure_scope_internal(saf.org('hq_b'), 'organization', saf.org('hq_b')::text, 'HQ B', '{}'))),
  'sa_scope_outside_membership');
SELECT saf.expect_raise('compatibility roles are not manually assignable',
  format($$SELECT public.sa_assign_role(%L, %L, %L, %L, ARRAY[%L]::uuid[], null, null, 'assign compat role')$$,
         saf.uid('sa'), saf.uid('emp_a'), saf.role('legacy-sa'), saf.org('hq_a'), saf.org_scope('hq_a')),
  'sa_compat_role_not_assignable');
SELECT saf.expect_raise('consumer cannot receive an enterprise role (no membership)',
  format($$SELECT public.sa_assign_role(%L, %L, %L, %L, ARRAY[%L]::uuid[], null, null, 'consumer grant')$$,
         saf.uid('sa'), saf.uid('consumer'), saf.role('finance-viewer'), saf.org('hq_a'), saf.org_scope('hq_a')),
  'sa_membership_required');
SELECT saf.expect_raise('wildcard scopes are prohibited',
  format($$SELECT public.sa_define_scope(%L, %L, 'territory', '*', 'Everything')$$, saf.uid('sa'), saf.org('hq_a')),
  'sa_scope_wildcard_prohibited');

-- Super Admin (legacy authority in LEGACY/SHADOW) grants a scoped role.
SELECT public.sa_assign_role(saf.uid('sa'), saf.uid('emp_a'), saf.role('finance-viewer'), saf.org('hq_a'),
  ARRAY[saf.org_scope('hq_a')], null, null, 'Month-end reporting support');
SELECT saf.expect_eq('granted role is effective in scope',
  saf.decide(saf.uid('emp_a'), 'finance.report.view_sensitive', saf.ctx('hq_a')), 'ALLOW:ALLOWED_BY_ASSIGNMENT');
SELECT saf.expect_eq('granted role is not effective in another tenant',
  saf.decide(saf.uid('emp_a'), 'finance.report.view_sensitive', saf.ctx('hq_b')), 'DENY:MISSING_MEMBERSHIP');
SELECT saf.expect_eq('grant is audited',
  (SELECT count(*) FROM public.sa_access_change_log WHERE action = 'assignment.granted' AND target_user_id = saf.uid('emp_a'))::int, 1);

-- In NEW_ENFORCED the assigning administrator needs the S&A permission (not role_level).
SELECT saf.set_mode('security.role.assign', 'NEW_ENFORCED');
SELECT public.sa_assign_role(saf.uid('sa'), saf.uid('emp_a2'), saf.role('finance-viewer'), saf.org('hq_a'),
  ARRAY[saf.org_scope('hq_a')], null, null, 'Granted under NEW_ENFORCED');
SELECT saf.expect_raise('NEW_ENFORCED: role_level alone does not authorize assignment',
  format($$SELECT public.sa_assign_role(%L, %L, %L, %L, ARRAY[%L]::uuid[], null, null, 'HQ admin without S&A permission')$$,
         saf.uid('hq_a'), saf.uid('emp_a2'), saf.role('finance-ar-clerk'), saf.org('hq_a'), saf.org_scope('hq_a')),
  'sa_authorization_required');

-- ── C. Access requests ─────────────────────────────────────────────────────
CREATE TEMP TABLE req AS SELECT public.sa_submit_access_request(saf.uid('emp_a2'), saf.uid('emp_a2'), saf.role('finance-ap-clerk'),
  saf.org('hq_a'), ARRAY[saf.org_scope('hq_a')], null, now() + interval '7 days', 'Covering AP during leave') AS id;
SELECT saf.expect_eq('request grants nothing before approval',
  (SELECT count(*) FROM public.sa_role_assignments WHERE user_id = saf.uid('emp_a2') AND role_id = saf.role('finance-ap-clerk'))::int, 0);
SELECT saf.expect_raise('C: requester cannot approve own request',
  format($$SELECT public.sa_decide_access_request(%L, %L, true, 'self')$$, saf.uid('emp_a2'), (SELECT id FROM req)),
  'sa_self_approval_prohibited');
CREATE TEMP TABLE req_other AS SELECT public.sa_submit_access_request(saf.uid('hr_a'), saf.uid('pu_a2'), saf.role('security-administrator'),
  saf.org('hq_a'), ARRAY[saf.org_scope('hq_a')], null, null, 'Nominated as security administrator') AS id;
SELECT saf.expect_raise('C: target cannot approve a privileged request raised for them',
  format($$SELECT public.sa_decide_access_request(%L, %L, true, 'self')$$, saf.uid('pu_a2'), (SELECT id FROM req_other)),
  'sa_self_approval_prohibited');
SELECT saf.expect_raise('approver needs access_request.approve',
  format($$SELECT public.sa_decide_access_request(%L, %L, true, 'ok')$$, saf.uid('hq_a'), (SELECT id FROM req)),
  'sa_authorization_required');
SELECT public.sa_decide_access_request(saf.uid('sa'), (SELECT id FROM req), true, 'Approved for leave cover');
SELECT saf.expect_eq('approved request creates a temporary assignment',
  (SELECT a.source || ':' || (a.effective_until IS NOT NULL)::text FROM public.sa_access_requests r
     JOIN public.sa_role_assignments a ON a.id = r.resulting_assignment_id WHERE r.id = (SELECT id FROM req)), 'access_request:true');
SELECT saf.expect_raise('a decided request cannot be decided again',
  format($$SELECT public.sa_decide_access_request(%L, %L, false, 'x')$$, saf.uid('sa'), (SELECT id FROM req)),
  'sa_access_request_not_pending');
CREATE TEMP TABLE req2 AS SELECT public.sa_submit_access_request(saf.uid('emp_a'), saf.uid('emp_a'), saf.role('payment-approver'),
  saf.org('hq_a'), ARRAY[saf.org_scope('hq_a')], null, null, 'Would like to approve payments') AS id;
SELECT public.sa_decide_access_request(saf.uid('sa'), (SELECT id FROM req2), false, 'Not justified');
SELECT saf.expect_eq('denied request grants nothing',
  saf.decide(saf.uid('emp_a'), 'finance.payment.approve', saf.ctx('hq_a')), 'DENY:MISSING_PERMISSION');
SELECT saf.expect_raise('temporary requests are bounded',
  format($$SELECT public.sa_submit_access_request(%L, %L, %L, %L, ARRAY[%L]::uuid[], null, now() + interval '400 days', 'A very long temporary request')$$,
         saf.uid('emp_a'), saf.uid('emp_a'), saf.role('finance-viewer'), saf.org('hq_a'), saf.org_scope('hq_a')),
  'sa_temporary_access_too_long');

-- Temporary assignment expiry.
UPDATE public.sa_role_assignments SET effective_from = now() - interval '2 days', effective_until = now() - interval '1 second'
WHERE id = (SELECT resulting_assignment_id FROM public.sa_access_requests WHERE id = (SELECT id FROM req));
SELECT saf.expect_eq('expired temporary access no longer allows',
  (public.sa_evaluate_permission(saf.uid('emp_a2'), 'finance.payable.view', saf.ctx('hq_a'))->'matched_assignments' @>
    jsonb_build_array(jsonb_build_object('roleKey','finance-ap-clerk'))), false);
SELECT public.sa_governance_maintenance();
SELECT saf.expect_eq('maintenance marks expired manual/request access revoked',
  (SELECT status FROM public.sa_role_assignments WHERE id = (SELECT resulting_assignment_id FROM public.sa_access_requests WHERE id = (SELECT id FROM req))), 'revoked');

-- ── E. Delegation ─────────────────────────────────────────────────────────
SELECT saf.expect_raise('E: delegation cannot exceed the delegator',
  format($$SELECT public.sa_create_delegation(%L, %L, %L, %L, ARRAY['finance.journal.post'], null, now() + interval '5 days', 'cover')$$,
         saf.uid('pu_a'), saf.uid('pu_a'), saf.uid('emp_a2'), saf.org('hq_a')),
  'sa_delegation_exceeds_delegator');
SELECT public.sa_create_delegation(saf.uid('pu_a'), saf.uid('pu_a'), saf.uid('emp_a2'), saf.org('hq_a'),
  ARRAY['finance.payment.approve'], null, now() + interval '5 days', 'Holiday cover');
SELECT saf.expect_eq('delegate allowed while delegator holds the permission',
  saf.decide(saf.uid('emp_a2'), 'finance.payment.approve', saf.ctx('hq_a')), 'ALLOW:ALLOWED_BY_DELEGATION');
SELECT saf.expect_eq('delegation is scoped to its organization',
  saf.decide(saf.uid('emp_a2'), 'finance.payment.approve', saf.ctx('hq_b')), 'DENY:MISSING_MEMBERSHIP');
SELECT saf.expect_raise('E: delegation is non-transitive (delegate cannot re-delegate)',
  format($$SELECT public.sa_create_delegation(%L, %L, %L, %L, ARRAY['finance.payment.approve'], null, now() + interval '2 days', 'onward')$$,
         saf.uid('emp_a2'), saf.uid('emp_a2'), saf.uid('emp_a'), saf.org('hq_a')),
  'sa_delegation_exceeds_delegator');
-- Delegator loses the permission → delegate loses it immediately.
UPDATE public.sa_role_assignments SET status = 'suspended' WHERE user_id = saf.uid('pu_a');
SELECT saf.expect_eq('delegate cannot exceed a delegator who lost the permission',
  saf.decide(saf.uid('emp_a2'), 'finance.payment.approve', saf.ctx('hq_a')), 'DENY:MISSING_PERMISSION');
UPDATE public.sa_role_assignments SET status = 'active' WHERE user_id = saf.uid('pu_a') AND status = 'suspended';
SELECT saf.expect_raise('delegations must end',
  format($$SELECT public.sa_create_delegation(%L, %L, %L, %L, ARRAY['finance.payment.approve'], null, null, 'open ended')$$,
         saf.uid('pu_a'), saf.uid('pu_a'), saf.uid('emp_a'), saf.org('hq_a')),
  'sa_delegation_end_required');
SELECT saf.expect_raise('consumers cannot be delegates',
  format($$SELECT public.sa_create_delegation(%L, %L, %L, %L, ARRAY['finance.payment.approve'], null, now() + interval '1 day', 'consumer')$$,
         saf.uid('pu_a'), saf.uid('pu_a'), saf.uid('consumer'), saf.org('hq_a')),
  'sa_delegate_must_be_member');

-- ── SoD ───────────────────────────────────────────────────────────────────
SELECT saf.expect_raise('enforced same-document rule blocks the maker',
  format($$SELECT public.sa_enforce_same_document_sod('order-maker-checker', 'order-1', %L, ARRAY[%L]::uuid[])$$, saf.uid('hq_a'), saf.uid('hq_a')),
  'sod_violation');
SELECT public.sa_enforce_same_document_sod('order-maker-checker', 'order-1', saf.uid('hq_a'), ARRAY[saf.uid('pu_a')]);
SELECT saf.expect_eq('a different checker passes', true, true);
SELECT public.sa_enforce_same_document_sod('payroll-prepare-approve', 'run-1', saf.uid('hr_a'), ARRAY[saf.uid('hr_a')]);
SELECT saf.expect_eq('monitor rule records a violation without blocking',
  (SELECT outcome FROM public.sa_sod_violations WHERE document_id = 'run-1'), 'allowed_monitor');
SELECT saf.expect_raise('mitigation cannot be self-granted',
  format($$SELECT public.sa_grant_sod_mitigation(%L, (SELECT id FROM public.sa_sod_rules WHERE rule_key = 'order-maker-checker'), %L, 'Single approver site for a month', now() + interval '30 days')$$, saf.uid('sa'), saf.uid('sa')),
  'sa_self_mitigation_prohibited');
SELECT public.sa_grant_sod_mitigation(saf.uid('sa'), (SELECT id FROM public.sa_sod_rules WHERE rule_key = 'order-maker-checker'),
  saf.uid('hq_a'), 'Single approver site during audit month', now() + interval '30 days');
SELECT public.sa_enforce_same_document_sod('order-maker-checker', 'order-2', saf.uid('hq_a'), ARRAY[saf.uid('hq_a')]);
SELECT saf.expect_eq('mitigation allows and is recorded',
  (SELECT outcome FROM public.sa_sod_violations WHERE document_id = 'order-2'), 'allowed_mitigated');
INSERT INTO public.sa_sod_rules(rule_key, name, rule_kind, left_key, right_key, enforcement)
VALUES ('test-role-conflict', 'Test conflict', 'role_conflict', 'finance-ap-clerk', 'payment-approver', 'enforce');
SELECT public.sa_assign_role(saf.uid('sa'), saf.uid('emp_a'), saf.role('finance-ap-clerk'), saf.org('hq_a'), ARRAY[saf.org_scope('hq_a')], null, null, 'AP clerk');
SELECT saf.expect_raise('enforced role conflict blocks a conflicting assignment',
  format($$SELECT public.sa_assign_role(%L, %L, %L, %L, ARRAY[%L]::uuid[], null, null, 'payment approver too')$$,
         saf.uid('sa'), saf.uid('emp_a'), saf.role('payment-approver'), saf.org('hq_a'), saf.org_scope('hq_a')),
  'sod_violation');

-- ── Access reviews ────────────────────────────────────────────────────────
CREATE TEMP TABLE rev AS SELECT public.sa_create_access_review(saf.uid('sa'), 'Q3 Finance review', saf.org('hq_a'), saf.role('finance-viewer'), saf.uid('sa'), now() + interval '14 days') AS id;
SELECT saf.expect_eq('review snapshots current assignments',
  (SELECT count(*) FROM public.sa_access_review_items WHERE campaign_id = (SELECT id FROM rev))::int, 2);
SELECT public.sa_decide_access_review_item(saf.uid('sa'), (SELECT id FROM public.sa_access_review_items WHERE campaign_id = (SELECT id FROM rev) AND user_id = saf.uid('emp_a')), 'revoke', 'No longer needed');
SELECT saf.expect_eq('review revoke removes the reviewed assignment',
  (SELECT a.status || ':' || a.source FROM public.sa_access_review_items i JOIN public.sa_role_assignments a ON a.id = i.assignment_id
    WHERE i.campaign_id = (SELECT id FROM rev) AND i.user_id = saf.uid('emp_a')), 'revoked:manual');
SELECT saf.expect_raise('review cannot be completed with pending items',
  format($$SELECT public.sa_complete_access_review(%L, %L)$$, saf.uid('sa'), (SELECT id FROM rev)), 'sa_review_items_pending');
SELECT public.sa_decide_access_review_item(saf.uid('sa'), (SELECT id FROM public.sa_access_review_items WHERE campaign_id = (SELECT id FROM rev) AND user_id = saf.uid('emp_a2')), 'modify', 'Limit to quarter end', now() + interval '10 days');
SELECT public.sa_complete_access_review(saf.uid('sa'), (SELECT id FROM rev));
SELECT saf.expect_eq('review completed', (SELECT status FROM public.sa_access_review_campaigns WHERE id = (SELECT id FROM rev)), 'completed');
CREATE TEMP TABLE rev2 AS SELECT public.sa_create_access_review(saf.uid('sa'), 'Self review', saf.org('hq_a'), saf.role('legacy-sa'), saf.uid('sa'), null) AS id;
SELECT saf.expect_raise('reviewer cannot certify their own access',
  format($$SELECT public.sa_decide_access_review_item(%L, (SELECT id FROM public.sa_access_review_items WHERE campaign_id = %L AND user_id = %L), 'retain', null)$$,
         saf.uid('sa'), (SELECT id FROM rev2), saf.uid('sa')), 'sa_self_certification_prohibited');

-- ── Emergency access / service identities / audit ─────────────────────────
SELECT saf.expect_err('O: emergency access unavailable without MFA step-up', 'authenticated', saf.uid('sa'),
  format($$SELECT public.sa_request_emergency_access(%L, ARRAY['finance.payment.approve'], 'Production incident requires payment release', 30)$$, saf.org('hq_a')),
  'emergency_access_unavailable');
SELECT saf.expect_raise('emergency access cannot be enabled while MFA is unavailable',
  $$UPDATE public.sa_settings SET setting_value = 'true' WHERE setting_key = 'emergency_access.enabled'$$, 'emergency_access_prerequisite_unmet');
SELECT saf.expect_eq('N: service identities hold no secret values',
  (SELECT count(*) FROM public.sa_service_identities WHERE credential_reference !~ '^[A-Z][A-Z0-9_]*$')::int, 0);
SELECT saf.expect_raise('M: access change log is append-only',
  $$UPDATE public.sa_access_change_log SET reason = 'rewritten'$$, 'is_append_only');
SELECT saf.expect_raise('M: access change log cannot be deleted',
  $$DELETE FROM public.sa_access_change_log$$, 'is_append_only');
SELECT saf.expect_raise('M: SoD violations are append-only', $$DELETE FROM public.sa_sod_violations$$, 'is_append_only');
SELECT saf.expect_err('server cannot write assignments directly (must use governance functions)', 'service_role', null,
  format($$INSERT INTO public.sa_role_assignments(user_id, role_id, membership_id) SELECT %L, %L, id FROM public.sa_organization_memberships WHERE user_id = %L$$,
         saf.uid('emp_a'), saf.role('finance-admin'), saf.uid('emp_a')), 'permission denied');
SELECT saf.expect_err('server cannot change migration modes directly', 'service_role', null,
  $$UPDATE public.sa_migration_modes SET mode = 'SHADOW'$$, 'permission denied');
SELECT saf.expect_err('authenticated cannot read governance tables', 'authenticated', saf.uid('sa'),
  $$SELECT count(*) FROM public.sa_access_requests$$, 'permission denied');
SELECT saf.expect_err('authenticated cannot call the evaluator directly', 'authenticated', saf.uid('emp_a'),
  format($$SELECT public.sa_evaluate_permission(%L, 'finance.payment.approve', '{}')$$, saf.uid('sa')), 'permission denied');

ROLLBACK;
