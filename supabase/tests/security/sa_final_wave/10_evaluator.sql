-- S&A Final Wave — canonical evaluator (sa_evaluate_permission)
BEGIN;

-- Compatibility grants reproduce legacy role definitions.
SELECT saf.expect_eq('HQ admin may post journals in own company',
  saf.decide(saf.uid('hq_a'), 'finance.journal.post', saf.ctx('hq_a')), 'ALLOW:ALLOWED_BY_ASSIGNMENT');
SELECT saf.expect_eq('power user (level 20) may not post journals (legacy is_hq_admin <= 10)',
  saf.decide(saf.uid('pu_a'), 'finance.journal.post', saf.ctx('hq_a')), 'DENY:MISSING_PERMISSION');
SELECT saf.expect_eq('power user may approve payments (legacy HQ power user)',
  saf.decide(saf.uid('pu_a'), 'finance.payment.approve', saf.ctx('hq_a')), 'ALLOW:ALLOWED_BY_ASSIGNMENT');
SELECT saf.expect_eq('HR_MANAGER role code holds payroll prepare',
  saf.decide(saf.uid('hr_a'), 'hr.payroll.prepare', saf.ctx('hq_a')), 'ALLOW:ALLOWED_BY_ASSIGNMENT');
SELECT saf.expect_eq('HR_MANAGER does not hold payroll release (legacy staff level 20)',
  saf.decide(saf.uid('hr_a'), 'hr.payroll.release', saf.ctx('hq_a')), 'DENY:MISSING_PERMISSION');
SELECT saf.expect_eq('ordinary employee has no payroll view',
  saf.decide(saf.uid('emp_a'), 'hr.payroll.view', saf.ctx('hq_a')), 'DENY:MISSING_PERMISSION');

-- Organization hierarchy: an HQ scope covers descendants; never siblings/other tenants.
SELECT saf.expect_eq('HQ admin covers own warehouse (descendant)',
  saf.decide(saf.uid('hq_a'), 'inventory.adjustment.post', jsonb_build_object('organization_id', saf.org('wh_a1'), 'warehouse_id', saf.org('wh_a1'))), 'ALLOW:ALLOWED_BY_ASSIGNMENT');
SELECT saf.expect_eq('HQ admin covers shop under own distributor',
  saf.decide(saf.uid('hq_a'), 'supply_chain.order.approve', saf.ctx('shop_a')), 'ALLOW:ALLOWED_BY_ASSIGNMENT');
SELECT saf.expect_eq('cross-tenant: HQ admin A denied in HQ B',
  saf.decide(saf.uid('hq_a'), 'finance.journal.post', saf.ctx('hq_b')), 'DENY:MISSING_MEMBERSHIP');
SELECT saf.expect_eq('cross-tenant: Super Admin A denied in HQ B warehouse',
  saf.decide(saf.uid('sa'), 'inventory.adjustment.post', jsonb_build_object('organization_id', saf.org('wh_b'), 'warehouse_id', saf.org('wh_b'))), 'DENY:MISSING_MEMBERSHIP');
SELECT saf.expect_eq('descendant cannot act on ancestor: distributor denied at HQ',
  saf.decide(saf.uid('dist_a'), 'supply_chain.order.create', saf.ctx('hq_a')), 'DENY:MISSING_MEMBERSHIP');
SELECT saf.expect_eq('distributor may create orders for own org',
  saf.decide(saf.uid('dist_a'), 'supply_chain.order.create', saf.ctx('dist_a')), 'ALLOW:ALLOWED_BY_ASSIGNMENT');

-- Warehouse scope requires warehouse context; wrong warehouse is a scope mismatch.
SELECT saf.expect_eq('warehouse manager: own warehouse',
  saf.decide(saf.uid('whm_a1'), 'warehouse.receipt.post', jsonb_build_object('organization_id', saf.org('wh_a1'), 'warehouse_id', saf.org('wh_a1'))), 'ALLOW:ALLOWED_BY_ASSIGNMENT');
SELECT saf.expect_eq('warehouse manager: missing warehouse context never matches',
  saf.decide(saf.uid('whm_a1'), 'warehouse.receipt.post', jsonb_build_object('organization_id', saf.org('wh_a1'))), 'DENY:MISSING_CONTEXT');

-- Inactive and consumer identities.
SELECT saf.expect_eq('inactive account denied', saf.decide(saf.uid('inactive'), 'hr.self_service.use', saf.ctx('hq_a')), 'DENY:ACCOUNT_INACTIVE');
SELECT saf.expect_eq('consumer has no enterprise membership', saf.decide(saf.uid('consumer'), 'customer.loyalty.adjust', saf.ctx('hq_a')), 'DENY:MISSING_MEMBERSHIP');
SELECT saf.expect_eq('consumer holds no assignments', (SELECT count(*) FROM public.sa_role_assignments WHERE user_id = saf.uid('consumer'))::int, 0);

-- Own record (baseline) and direct reports.
SELECT saf.expect_eq('employee self-service on own record',
  saf.decide(saf.uid('emp_a'), 'hr.self_service.use', jsonb_build_object('organization_id', saf.org('hq_a'), 'owner_user_id', saf.uid('emp_a'))), 'ALLOW:ALLOWED_BY_ASSIGNMENT');
SELECT saf.expect_eq('employee self-service on another employee record',
  saf.decide(saf.uid('emp_a'), 'hr.self_service.use', jsonb_build_object('organization_id', saf.org('hq_a'), 'owner_user_id', saf.uid('emp_a2'))), 'DENY:SCOPE_MISMATCH');
SELECT saf.expect_eq('own_record never matches without an owner in context',
  saf.decide(saf.uid('emp_a'), 'hr.self_service.use', saf.ctx('hq_a')), 'DENY:MISSING_CONTEXT');

-- Empty scope never means global.
INSERT INTO public.sa_role_assignments(user_id, role_id, membership_id, source)
SELECT saf.uid('emp_a2'), saf.role('finance-admin'), m.id, 'manual'
FROM public.sa_organization_memberships m WHERE m.user_id = saf.uid('emp_a2') AND m.status = 'active';
SELECT saf.expect_eq('assignment without scope grants nothing',
  saf.decide(saf.uid('emp_a2'), 'finance.account.manage', saf.ctx('hq_a')), 'DENY:SCOPE_MISMATCH');

-- Expired assignment.
UPDATE public.sa_role_assignments SET effective_from = now() - interval '2 days', effective_until = now() - interval '1 day'
WHERE user_id = saf.uid('pu_a2') AND role_id = (SELECT id FROM public.sa_business_roles WHERE role_key = 'legacy-power-user');
SELECT saf.expect_eq('expired assignment is ignored',
  saf.decide(saf.uid('pu_a2'), 'finance.payment.approve', saf.ctx('hq_a')), 'DENY:MISSING_PERMISSION');

-- Deprecated permission / inactive role.
UPDATE public.sa_business_roles SET status = 'deprecated' WHERE role_key = 'legacy-hr-manager';
SELECT saf.expect_eq('deprecated role grants nothing',
  saf.decide(saf.uid('hr_a'), 'hr.payroll.prepare', saf.ctx('hq_a')), 'DENY:MISSING_PERMISSION');

ROLLBACK;
