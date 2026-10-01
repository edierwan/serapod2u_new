-- Identity / S&A Stage 2D — deferred authorization closure
-- (migration 20260930100000_sa_stage2d_deferred_closure.sql)
-- The fixtures are loaded after the migration, so the backfill is re-run here
-- exactly as the migration runs it.
DO $$
DECLARE n integer;
BEGIN
  n := public.sa_stage2d_backfill();
  PERFORM saf.expect_eq('D0 backfill grants the Stage 2D roles', n > 0, true);
  PERFORM saf.expect_eq('D0 a second run grants nothing', public.sa_stage2d_backfill(), 0);
  PERFORM saf.expect_eq('D0 every Stage 2D permission starts in SHADOW',
    (SELECT count(*) FROM public.sa_migration_modes WHERE mode = 'SHADOW' AND permission_key IN (
      'customer.support.administer','customer.report.view','customer.messaging.manage','customer.banner.manage',
      'manufacturing.adjustment.administer','platform.user.profile_edit','hr.employee.view_internal','customer.crm.view',
      'marketing.module.view','product.catalog.view','ecommerce.module.view','ecommerce.outdoor.operate',
      'platform.notification_monitor.view'))::int, 13);
END $$;

-- D1 who holds each new permission in their own organization equals today's
-- legacy audience (computed from each fixture's current role, which earlier
-- files change), plus fixed spot checks on identities no earlier file changes.
DO $$
DECLARE v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad
  FROM public.sa_business_roles br
  JOIN public.sa_business_role_permissions rp ON rp.role_id = br.id
  JOIN public.sa_permissions p ON p.id = rp.permission_id
  CROSS JOIN public.users u
  LEFT JOIN public.roles lr ON lr.role_code = u.role_code
  LEFT JOIN public.organizations o ON o.id = u.organization_id
  WHERE br.role_key IN ('support-inbox-administrator','customer-report-viewer','customer-messaging-manager','storefront-banner-manager',
                        'adjustment-administrator','profile-administrator','hr-internal-directory-viewer','crm-viewer',
                        'marketing-viewer','catalog-viewer','ecommerce-viewer','outdoor-store-operator','notification-monitor-viewer')
    AND u.id::text LIKE '00000000-0000-0000-0000-0000000000%'
    AND (coalesce(public.sa_evaluate_permission(u.id, p.permission_key,
           jsonb_build_object('organization_id', u.organization_id), false)->>'decision', 'DENY') = 'ALLOW')
        <> (u.is_active AND u.account_scope = 'portal' AND u.organization_id IS NOT NULL
            AND EXISTS (SELECT 1 FROM public.sa_organization_memberships m
                        WHERE m.user_id = u.id AND m.organization_id = u.organization_id AND m.status = 'active')
            AND public.sa_stage2d_legacy_qualifies(br.role_key, u.role_code, lr.role_level, o.org_type_code, u.principal_type));
  PERFORM saf.expect_eq('D1 every new permission''s holders equal today''s legacy audience', v_bad, 0);

  PERFORM saf.expect_eq('D1 adjustment administration: Super Admin only',
    split_part(saf.decide(saf.uid('hq_a'), 'manufacturing.adjustment.administer', saf.ctx('hq_a')), ':', 1)
    || split_part(saf.decide(saf.uid('sa'), 'manufacturing.adjustment.administer', saf.ctx('hq_a')), ':', 1), 'DENYALLOW');
  PERFORM saf.expect_eq('D1 Outdoor store: not a warehouse manager or a distributor',
    split_part(saf.decide(saf.uid('whm_a1'), 'ecommerce.outdoor.operate', saf.ctx('wh_a1')), ':', 1)
    || split_part(saf.decide(saf.uid('dist_a'), 'ecommerce.outdoor.operate', saf.ctx('dist_a')), ':', 1), 'DENYDENY');
  PERFORM saf.expect_eq('D1 catalogue: distributors included, warehouses not',
    split_part(saf.decide(saf.uid('dist_a'), 'product.catalog.view', saf.ctx('dist_a')), ':', 1)
    || split_part(saf.decide(saf.uid('whm_a1'), 'product.catalog.view', saf.ctx('wh_a1')), ':', 1), 'ALLOWDENY');
  PERFORM saf.expect_eq('D1 monitors: not a distributor',
    split_part(saf.decide(saf.uid('dist_a'), 'platform.notification_monitor.view', saf.ctx('dist_a')), ':', 1), 'DENY');
  PERFORM saf.expect_eq('D1 consumers and inactive accounts hold none of the new permissions',
    (SELECT count(*) FROM public.sa_role_assignments a JOIN public.sa_business_roles br ON br.id = a.role_id
     WHERE a.user_id IN (saf.uid('consumer'), saf.uid('inactive')) AND a.status = 'active'
       AND br.role_key IN ('support-inbox-administrator','customer-report-viewer','customer-messaging-manager','crm-viewer',
                           'hr-internal-directory-viewer','outdoor-store-operator','notification-monitor-viewer'))::int, 0);
END $$;

-- D2 sa_readable_organizations agrees with sa_evaluate_permission everywhere
DO $$
DECLARE v_bad integer;
BEGIN
  INSERT INTO public.sa_delegations(delegator_id, delegate_id, organization_id, permission_keys, reason, effective_until, created_by)
  VALUES (saf.uid('pu_a'), saf.uid('emp_a'), saf.org('dist_a'), array['customer.messaging.manage'], 'D2 delegation test', now() + interval '1 day', saf.uid('pu_a'));

  SELECT count(*) INTO v_bad
  FROM public.users u
  CROSS JOIN unnest(array['customer.messaging.manage','inventory.report.view','hr.employee.manage','customer.crm.view',
                          'platform.data.destructive','hr.self_service.use']) AS perm
  CROSS JOIN LATERAL (SELECT public.sa_readable_organizations(u.id, perm) AS ro) r
  CROSS JOIN public.organizations o
  WHERE o.id::text LIKE '00000000-0000-0000-0000-00000000a%'
    AND ((o.id = any(r.ro))
         <> (coalesce(public.sa_evaluate_permission(u.id, perm, jsonb_build_object('organization_id', o.id), true)->>'decision','DENY') = 'ALLOW'));
  PERFORM saf.expect_eq('D2 readable organizations = evaluator ALLOW for every fixture user, org and permission', v_bad, 0);

  PERFORM saf.expect_eq('D2 an HQ scope reaches its subtree only',
    (SELECT array_agg(x ORDER BY x) FROM unnest(public.sa_readable_organizations(saf.uid('hq_a'), 'customer.messaging.manage')) x),
    (SELECT array_agg(x ORDER BY x) FROM unnest(array[saf.org('hq_a'), saf.org('wh_a1'), saf.org('dist_a'), saf.org('shop_a')]) x));
  PERFORM saf.expect_eq('D2 a delegate reaches only the delegated subtree',
    (SELECT array_agg(x ORDER BY x) FROM unnest(public.sa_readable_organizations(saf.uid('emp_a'), 'customer.messaging.manage')) x),
    (SELECT array_agg(x ORDER BY x) FROM unnest(array[saf.org('dist_a'), saf.org('shop_a')]) x));
  PERFORM saf.expect_eq('D2 delegation is ignored when excluded',
    cardinality(public.sa_readable_organizations(saf.uid('emp_a'), 'customer.messaging.manage', false)), 0);
  PERFORM saf.expect_eq('D2 an inactive account reaches nothing',
    cardinality(public.sa_readable_organizations(saf.uid('inactive'), 'hr.self_service.use')), 0);
  PERFORM saf.expect_eq('D2 a consumer reaches nothing',
    cardinality(public.sa_readable_organizations(saf.uid('consumer'), 'customer.crm.view')), 0);
  DELETE FROM public.sa_delegations WHERE reason = 'D2 delegation test';
END $$;

-- D3 target protection: the actor must hold every grant of the target
DO $$
BEGIN
  PERFORM saf.expect_eq('D3 Super Admin covers an HQ admin', public.sa_actor_dominates(saf.uid('sa'), saf.uid('hq_a')), true);
  PERFORM saf.expect_eq('D3 an HQ admin does not cover the Super Admin', public.sa_actor_dominates(saf.uid('hq_a'), saf.uid('sa')), false);
  PERFORM saf.expect_eq('D3 an HQ admin covers an employee of the same HQ', public.sa_actor_dominates(saf.uid('hq_a'), saf.uid('emp_a')), true);
  PERFORM saf.expect_eq('D3 an HQ admin does not cover another HQ''s admin', public.sa_actor_dominates(saf.uid('hq_a'), saf.uid('hq_b')), false);
  PERFORM saf.expect_eq('D3 a power user does not cover an HQ admin', public.sa_actor_dominates(saf.uid('pu_a'), saf.uid('hq_a')), false);
  PERFORM saf.expect_eq('D3 an employee covers no admin', public.sa_actor_dominates(saf.uid('emp_a'), saf.uid('pu_a')), false);
  PERFORM saf.expect_eq('D3 an inactive actor covers nobody', public.sa_actor_dominates(saf.uid('inactive'), saf.uid('consumer')), false);
  PERFORM saf.expect_eq('D3 a consumer (no enterprise grants) is covered by an HQ admin', public.sa_actor_dominates(saf.uid('hq_a'), saf.uid('consumer')), true);
END $$;

-- D4 an administrator's removal is never undone by a re-run
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.sa_role_assignments
  WHERE user_id = saf.uid('pu_a') AND role_id = saf.role('support-inbox-administrator');
  -- as an administrator's revocation leaves it (state-independent: no actor grant needed)
  UPDATE public.sa_role_assignments SET status = 'revoked', ended_reason = 'D4 no longer handles support', updated_at = now() WHERE id = v_id;
  PERFORM saf.expect_eq('D4 revoked', (SELECT status FROM public.sa_role_assignments WHERE id = v_id), 'revoked');
  PERFORM public.sa_stage2d_backfill();
  PERFORM saf.expect_eq('D4 a re-run keeps the revocation', (SELECT status FROM public.sa_role_assignments WHERE id = v_id), 'revoked');
  PERFORM saf.expect_eq('D4 access follows S&A, not the legacy role',
    split_part(saf.decide(saf.uid('pu_a'), 'customer.support.administer', saf.ctx('hq_a')), ':', 1), 'DENY');
END $$;

-- D5 privileges
DO $$
BEGIN
  PERFORM saf.expect_eq('D5 readable organizations: service role only',
    has_function_privilege('authenticated', 'public.sa_readable_organizations(uuid,text,boolean)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.sa_readable_organizations(uuid,text,boolean)', 'EXECUTE'), false);
  PERFORM saf.expect_eq('D5 readable organizations: callable by the server',
    has_function_privilege('service_role', 'public.sa_readable_organizations(uuid,text,boolean)', 'EXECUTE'), true);
  PERFORM saf.expect_eq('D5 target protection: service role only',
    has_function_privilege('authenticated', 'public.sa_actor_dominates(uuid,uuid)', 'EXECUTE'), false);
  PERFORM saf.expect_eq('D5 backfill: owner only',
    has_function_privilege('service_role', 'public.sa_stage2d_backfill()', 'EXECUTE'), false);
END $$;
