-- Identity Foundation — account lifecycle, access administration, principals

-- Account lifecycle (identity_set_account_status → lifecycle JML)
DO $$
BEGIN
  PERFORM public.identity_set_account_status(saf.uid('hq_a'), saf.uid('emp_a2'), 'DISABLED', 'Left the company');
  PERFORM saf.expect_eq('L1 disabled: status', (SELECT account_status FROM public.users WHERE id = saf.uid('emp_a2')), 'DISABLED');
  PERFORM saf.expect_eq('L1 disabled: compatibility flag', (SELECT is_active FROM public.users WHERE id = saf.uid('emp_a2')), false);
  PERFORM saf.expect_eq('L1 disabled: no active membership',
    (SELECT count(*) FROM public.sa_organization_memberships WHERE user_id = saf.uid('emp_a2') AND status = 'active')::int, 0);
  PERFORM saf.expect_eq('L1 disabled: no active assignment',
    (SELECT count(*) FROM public.sa_role_assignments WHERE user_id = saf.uid('emp_a2') AND status = 'active')::int, 0);
  PERFORM saf.expect_eq('L1 audited', (SELECT count(*) FROM public.sa_access_change_log
    WHERE action = 'identity.status_changed' AND target_user_id = saf.uid('emp_a2'))::int, 1);

  PERFORM public.identity_set_account_status(saf.uid('hq_a'), saf.uid('emp_a2'), 'ACTIVE', 'Rehired');
  PERFORM saf.expect_eq('L2 reactivated', (SELECT account_status || ':' || is_active FROM public.users WHERE id = saf.uid('emp_a2')), 'ACTIVE:true');
  PERFORM saf.expect_eq('L2 membership restored by the lifecycle',
    (SELECT count(*) FROM public.sa_organization_memberships WHERE user_id = saf.uid('emp_a2') AND status = 'active')::int, 1);

  PERFORM saf.expect_raise('L3 no self status change',
    format('select public.identity_set_account_status(%L, %L, %L, %L)', saf.uid('hq_a'), saf.uid('hq_a'), 'DISABLED', 'myself'),
    'identity_self_status_change_prohibited');
  PERFORM saf.expect_raise('L3b ordinary employee cannot disable others',
    format('select public.identity_set_account_status(%L, %L, %L, %L)', saf.uid('emp_a'), saf.uid('emp_a2'), 'DISABLED', 'not mine'),
    'sa_authorization_required');

  PERFORM public.identity_set_account_status(saf.uid('hq_a'), saf.uid('emp_a2'), 'SUSPENDED', 'Investigation');
  PERFORM saf.expect_eq('L4 suspended blocks access', (SELECT account_status || ':' || is_active FROM public.users WHERE id = saf.uid('emp_a2')), 'SUSPENDED:false');
  PERFORM public.identity_set_account_status(saf.uid('hq_a'), saf.uid('emp_a2'), 'ACTIVE', 'Cleared');

  PERFORM saf.expect_raise('L5 archiving requires platform.identity.delete (Super Admin in legacy modes)',
    format('select public.identity_set_account_status(%L, %L, %L, %L)', saf.uid('hq_a'), saf.uid('pu_a2'), 'ARCHIVED', 'Remove account'),
    'sa_authorization_required');
  PERFORM public.identity_set_account_status(saf.uid('sa'), saf.uid('pu_a2'), 'ARCHIVED', 'Remove account');
  PERFORM saf.expect_eq('L5 archived', (SELECT account_status || ':' || is_active FROM public.users WHERE id = saf.uid('pu_a2')), 'ARCHIVED:false');
  PERFORM saf.expect_eq('L5 archived identity keeps its row (history resolves)', (SELECT full_name FROM public.users WHERE id = saf.uid('pu_a2')), 'Power User A2');
  PERFORM saf.expect_raise('L5 archived is terminal (lifecycle)',
    format('select public.identity_set_account_status(%L, %L, %L, %L)', saf.uid('sa'), saf.uid('pu_a2'), 'ACTIVE', 'Bring back'),
    'identity_archived_is_terminal');
  PERFORM saf.expect_raise('L5 archived is terminal (legacy is_active writer)',
    format('update public.users set is_active = true where id = %L', saf.uid('pu_a2')), 'identity_archived_is_terminal');

  -- Legacy writers that only toggle is_active map onto the canonical status.
  UPDATE public.users SET is_active = false WHERE id = saf.uid('whm_a1');
  PERFORM saf.expect_eq('L6 legacy toggle off → DISABLED', (SELECT account_status FROM public.users WHERE id = saf.uid('whm_a1')), 'DISABLED');
  UPDATE public.users SET is_active = true WHERE id = saf.uid('whm_a1');
  PERFORM saf.expect_eq('L6 legacy toggle on → ACTIVE', (SELECT account_status FROM public.users WHERE id = saf.uid('whm_a1')), 'ACTIVE');
  UPDATE public.users SET account_status = 'DISABLED', is_active = true WHERE id = saf.uid('whm_a1');
  PERFORM saf.expect_eq('L6 canonical status wins over a contradictory flag',
    (SELECT account_status || ':' || is_active FROM public.users WHERE id = saf.uid('whm_a1')), 'DISABLED:false');
  UPDATE public.users SET account_status = 'ACTIVE' WHERE id = saf.uid('whm_a1');
  PERFORM saf.expect_eq('L6 constraint keeps them consistent in every row',
    (SELECT count(*) FROM public.users WHERE is_active IS DISTINCT FROM (account_status IN ('ACTIVE','INVITED')))::int, 0);
END $$;

-- Access administration (identity_admin_update_access)
DO $$
BEGIN
  PERFORM saf.expect_raise('L7 power user cannot place a role above own level',
    format('select public.identity_admin_update_access(%L, %L, %L, null, false, %L)', saf.uid('pu_a'), saf.uid('emp_a'), 'HQ', 'promotion'),
    'identity_role_grant_not_allowed');
  PERFORM saf.expect_raise('L7b employee manager (level 20) is not an access administrator',
    format('select public.identity_admin_update_access(%L, %L, %L, null, false, %L)', saf.uid('pu_a'), saf.uid('emp_a'), 'MANAGER', 'promotion'),
    'sa_authorization_required');
  PERFORM saf.expect_raise('L7c HR manager is not an access administrator',
    format('select public.identity_admin_update_access(%L, %L, %L, null, false, %L)', saf.uid('hr_a'), saf.uid('emp_a'), 'MANAGER', 'promotion'),
    'sa_authorization_required');

  PERFORM public.identity_admin_update_access(saf.uid('hq_a'), saf.uid('emp_a'), 'MANAGER', null, false, 'Promotion to manager');
  PERFORM saf.expect_eq('L7d HQ admin changes the legacy role', (SELECT role_code FROM public.users WHERE id = saf.uid('emp_a')), 'MANAGER');
  PERFORM saf.expect_eq('L7d lifecycle swaps the compatibility role',
    (SELECT string_agg(br.role_key, ',' ORDER BY br.role_key) FROM public.sa_role_assignments a
       JOIN public.sa_business_roles br ON br.id = a.role_id WHERE a.user_id = saf.uid('emp_a') AND a.status = 'active'),
    'employee-self-service,legacy-manager');
  PERFORM saf.expect_eq('L7d audited', (SELECT count(*) FROM public.sa_access_change_log
    WHERE action = 'identity.access_changed' AND target_user_id = saf.uid('emp_a'))::int, 1);

  PERFORM saf.expect_raise('L8 HQ admin cannot demote/alter a Super Admin',
    format('select public.identity_admin_update_access(%L, %L, %L, null, false, %L)', saf.uid('hq_a'), saf.uid('sa'), 'USER', 'demotion'),
    'identity_role_change_not_allowed');
  PERFORM saf.expect_raise('L8b no self access change',
    format('select public.identity_admin_update_access(%L, %L, %L, null, false, %L)', saf.uid('hq_a'), saf.uid('hq_a'), 'SA', 'self'),
    'identity_self_access_change_prohibited');

  -- NEW_ENFORCED: destination organization must be in the administrator's scope.
  PERFORM saf.set_mode('platform.identity_access.manage', 'NEW_ENFORCED');
  PERFORM saf.expect_raise('L9 NEW_ENFORCED: cannot move an identity into an organization outside scope',
    format('select public.identity_admin_update_access(%L, %L, null, %L, true, %L)', saf.uid('hq_a'), saf.uid('emp_a'), saf.org('hq_b'), 'transfer'),
    'sa_authorization_required');
  PERFORM public.identity_admin_update_access(saf.uid('hq_a'), saf.uid('emp_a'), null, saf.org('dist_a'), true, 'Seconded to distributor');
  PERFORM saf.expect_eq('L10 move within scope re-derives the principal', (SELECT principal_type FROM public.users WHERE id = saf.uid('emp_a')), 'DISTRIBUTOR_USER');
  PERFORM saf.expect_eq('L10 lifecycle mover: membership follows',
    (SELECT organization_id FROM public.sa_organization_memberships WHERE user_id = saf.uid('emp_a') AND status = 'active' AND is_primary), saf.org('dist_a'));
  PERFORM public.identity_admin_update_access(saf.uid('hq_a'), saf.uid('emp_a'), null, saf.org('hq_a'), true, 'Back to HQ');
  PERFORM saf.set_mode('platform.identity_access.manage', 'SHADOW');
END $$;

-- Principals: consumers outside RBAC; service identities are never humans
DO $$
BEGIN
  UPDATE public.users SET is_active = false WHERE id = saf.uid('consumer');
  UPDATE public.users SET is_active = true WHERE id = saf.uid('consumer');
  PERFORM saf.expect_eq('L11 consumer lifecycle never creates enterprise access',
    (SELECT count(*) FROM public.sa_organization_memberships WHERE user_id = saf.uid('consumer'))::int
    + (SELECT count(*) FROM public.sa_role_assignments WHERE user_id = saf.uid('consumer'))::int, 0);
  PERFORM saf.expect_raise('L12 a human identity cannot be typed as a service principal',
    format('update public.users set principal_type = %L where id = %L', 'SERVICE_IDENTITY', saf.uid('emp_a2')),
    'identity_principal_type_mismatch');
  PERFORM saf.expect_raise('L12b principal type cannot contradict account scope',
    format('update public.users set principal_type = %L where id = %L', 'CONSUMER', saf.uid('emp_a2')),
    'identity_principal_type_mismatch');
  PERFORM saf.expect_eq('L13 service identities carry a non-human principal type',
    (SELECT count(*) FROM public.sa_service_identities WHERE principal_type NOT IN ('SERVICE_IDENTITY','INTEGRATION_PRINCIPAL'))::int, 0);
  PERFORM saf.expect_eq('L13b no service identity is a user row',
    (SELECT count(*) FROM public.sa_service_identities s JOIN public.users u ON u.id::text = s.identity_key)::int, 0);
END $$;
