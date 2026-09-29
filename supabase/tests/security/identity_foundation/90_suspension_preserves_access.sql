-- Identity Foundation Stage 2 — SUSPENDED is a hold (restored exactly), not a leaver
DO $$
DECLARE v_manual uuid; v_scope uuid;
BEGIN
  SELECT id INTO v_scope FROM public.sa_scope_definitions
  WHERE organization_id = saf.org('hq_a') AND scope_value = saf.org('hq_a')::text AND scope_type = 'organization' AND status = 'active';
  v_manual := public.sa_assign_role(saf.uid('sa'), saf.uid('pu_a'), saf.role('order-approver'), saf.org('hq_a'), array[v_scope],
                                    now(), NULL, 'Order approval duty');
  PERFORM saf.set_mode('supply_chain.order.approve', 'NEW_ENFORCED');
  PERFORM saf.expect_eq('P0 manual business role is effective', saf.decide(saf.uid('pu_a'), 'supply_chain.order.approve', saf.ctx('hq_a')), 'ALLOW:ALLOWED_BY_ASSIGNMENT');

  PERFORM public.identity_set_account_status(saf.uid('hq_a'), saf.uid('pu_a'), 'SUSPENDED', 'Investigation');
  PERFORM saf.expect_eq('P1 suspended: the manual role is suspended, not revoked',
    (SELECT status FROM public.sa_role_assignments WHERE id = v_manual), 'suspended');
  PERFORM saf.expect_eq('P1 suspended: no active assignment remains',
    (SELECT count(*) FROM public.sa_role_assignments WHERE user_id = saf.uid('pu_a') AND status = 'active')::int, 0);
  PERFORM saf.expect_eq('P1 suspended: membership suspended',
    (SELECT string_agg(status, ',') FROM public.sa_organization_memberships WHERE user_id = saf.uid('pu_a')), 'suspended');
  PERFORM saf.expect_eq('P1 suspended: access stops immediately',
    split_part(saf.decide(saf.uid('pu_a'), 'supply_chain.order.approve', saf.ctx('hq_a')), ':', 1), 'DENY');
  PERFORM saf.expect_eq('P1 suspension audited',
    (SELECT count(*) FROM public.sa_access_change_log WHERE action = 'lifecycle.suspended' AND target_user_id = saf.uid('pu_a'))::int, 1);

  PERFORM public.identity_set_account_status(saf.uid('hq_a'), saf.uid('pu_a'), 'ACTIVE', 'Cleared');
  PERFORM saf.expect_eq('P2 reactivated: the same manual role is back',
    (SELECT status FROM public.sa_role_assignments WHERE id = v_manual), 'active');
  PERFORM saf.expect_eq('P2 reactivated: access restored', saf.decide(saf.uid('pu_a'), 'supply_chain.order.approve', saf.ctx('hq_a')), 'ALLOW:ALLOWED_BY_ASSIGNMENT');
  PERFORM saf.expect_eq('P2 reactivated: membership active',
    (SELECT count(*) FROM public.sa_organization_memberships WHERE user_id = saf.uid('pu_a') AND status = 'active')::int, 1);

  -- Suspended, then disabled: suspended rows end like active ones
  PERFORM public.identity_set_account_status(saf.uid('hq_a'), saf.uid('pu_a'), 'SUSPENDED', 'Investigation 2');
  PERFORM public.identity_set_account_status(saf.uid('hq_a'), saf.uid('pu_a'), 'DISABLED', 'Left the company');
  PERFORM saf.expect_eq('P3 disabled after suspension: manual role revoked',
    (SELECT status FROM public.sa_role_assignments WHERE id = v_manual), 'revoked');
  PERFORM saf.expect_eq('P3 disabled after suspension: nothing left suspended',
    (SELECT count(*) FROM public.sa_role_assignments WHERE user_id = saf.uid('pu_a') AND status = 'suspended')::int
    + (SELECT count(*) FROM public.sa_organization_memberships WHERE user_id = saf.uid('pu_a') AND status = 'suspended')::int, 0);
  PERFORM public.identity_set_account_status(saf.uid('hq_a'), saf.uid('pu_a'), 'ACTIVE', 'Rehired');
  PERFORM saf.expect_eq('P3 a leaver''s revoked manual role is not resurrected',
    (SELECT status FROM public.sa_role_assignments WHERE id = v_manual), 'revoked');
  PERFORM saf.set_mode('supply_chain.order.approve', 'SHADOW');
END $$;
