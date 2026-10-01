-- ============================================================================
-- Identity Foundation Stage 2C — staging UAT, part A (decision matrix)
-- ----------------------------------------------------------------------------
-- READ-ONLY. Run inside: BEGIN; SET TRANSACTION READ ONLY; ... ROLLBACK;
-- For each of the 45 converted decisions, evaluates the exact S&A question the
-- converted code now asks (permission + resource context) for one
-- representative active user per role@org-type, and compares it with the
-- legacy rule the code used to apply. Prints role labels only (no identities).
--
--   expect = 'LEGACY'    the legacy rule was the whole decision (legacy-only or
--                        a bypass): S&A must equal it; narrower only for
--                        MISSING_MEMBERSHIP / MISSING_CONTEXT
--   expect = 'RESIDUAL'  S&A already decided first and the legacy rule was an
--                        extra gate: the conversion must not widen access
--                        (S&A ALLOW where the legacy rule denied)
--   expect = 'ALLOW'/'DENY'  a fixed expectation (e.g. cross-organization)
--   ok     = S&A result meets the expectation
--
-- Part B (signed-in probes) and part C (decision-log verification) are in
-- docs/security/IDENTITY_FOUNDATION_STAGE2C_UAT.md.
-- ============================================================================
with actor as (
  select distinct on (label) label, id, org, lvl, role_code, ot, scope from (
    select coalesce(case when u.email like 'qa-idf2-%-e@%' then 'QA-E(GUEST baseline)'
                         when u.email like 'qa-idf2-%-f@%' then 'QA-F(USER@HQ)'
                         when u.email like 'qa-idf-%-h@%'  then 'QA-H(consumer)' end,
                    u.role_code || '@' || coalesce(o.org_type_code, '-')) label,
           u.id, u.organization_id org, r.role_level lvl, u.role_code, o.org_type_code ot, u.account_scope scope
    from public.users u
    left join public.roles r on r.role_code = u.role_code
    left join public.organizations o on o.id = u.organization_id
    where u.is_active and u.account_status = 'ACTIVE'
      and (u.account_scope = 'portal' or u.email like 'qa-idf-%-h@%')
  ) x
  where label in ('SA@HQ','HQ@HQ','POWER_USER@HQ','MANAGER@HQ','USER@HQ','USER@WH','HQ@MFG','MANAGER@DIST',
                  'QA-E(GUEST baseline)','QA-F(USER@HQ)','QA-H(consumer)')
  order by label, id
), org as (
  select
    (select id from public.organizations where org_type_code = 'HQ' and parent_org_id is null and is_active order by id limit 1) hq,
    (select id from public.organizations where org_type_code = 'DIST' and parent_org_id is not null and is_active order by id limit 1) dist_child,
    (select id from public.organizations where org_type_code = 'MFG' and parent_org_id is null and is_active order by id limit 1) mfg_unrelated,
    (select id from public.organizations where org_type_code = 'WH' and is_active order by id limit 1) wh
), wh_chain as (
  -- warehouse ancestry, as resolveWarehouseResourceContext loads it
  with recursive c(id, parent, depth) as (
    select o.id, o.parent_org_id, 0 from public.organizations o, org where o.id = org.wh
    union all
    select o.id, o.parent_org_id, c.depth + 1 from public.organizations o join c on o.id = c.parent where c.depth < 8
  ) select array_agg(id order by depth) chain from c
), checks(grp, decision, perm, ctx_kind, expect_kind) as (values
  ('HR',      'departments / org chart / positions actions', 'hr.employee.manage',                 'own',      'LEGACY:hr_admin'),
  ('HR',      'HR settings action',                          'hr.settings.manage',                 'own',      'LEGACY:le20'),
  ('HR',      'cross-org edit, descendant org',               'hr.employee.manage',                 'dist',     'LEGACY:hr_admin'),
  ('HR',      'cross-org edit, unrelated org',                'hr.employee.manage',                 'mfg',      'DENY'),
  ('HR',      'assistant HR_MANAGER tier',                    'hr.compensation.view',               'own',      'LEGACY:hr_admin'),
  ('HR',      'assistant HR_STAFF tier',                      'hr.employee.manage',                 'own',      'LEGACY:hr_admin'),
  ('HR',      'KPI request-changes',                          'hr.performance.manage',              'own',      'LEGACY:hr_admin'),
  ('FINANCE', 'HR->GL actions, own company',                  'finance.payroll_integration.manage', 'hq',       'LEGACY:le20'),
  ('FINANCE', 'HR->GL actions, unrelated company',            'finance.payroll_integration.manage', 'mfg',      'DENY'),
  ('SUPPLY',  'confirm-shipment, warehouse context',          'warehouse.shipment.manage',          'wh',       'RESIDUAL:shipment'),
  ('CRM',     'journey create/update/delete/duplicate',       'customer.campaign.manage',           'own',      'RESIDUAL:le30'),
  ('PLATFORM','Super Admin data ops / bulk delete / org verify-delete', 'platform.data.destructive', 'own',     'RESIDUAL:le10'),
  ('PLATFORM','admin states',                                 'platform.settings.manage',           'own',      'RESIDUAL:admin_list'),
  ('PLATFORM','organization delete request',                  'platform.organization.manage',       'own',      'RESIDUAL:le10'),
  ('PLATFORM','organization import',                          'platform.organization.manage',       'own',      'RESIDUAL:le50_or_manager')
), eval as (
  select c.grp, c.decision, c.perm, c.expect_kind, a.label,
    public.sa_evaluate_permission(a.id, c.perm,
      case c.ctx_kind
        when 'own'  then jsonb_build_object('organization_id', a.org)
        when 'hq'   then jsonb_build_object('organization_id', org.hq)
        when 'dist' then jsonb_build_object('organization_id', org.dist_child)
        when 'mfg'  then jsonb_build_object('organization_id', org.mfg_unrelated)
        when 'wh'   then jsonb_build_object('warehouse_id', org.wh, 'organization_id',
                           case when a.org = any(wh_chain.chain) then a.org else wh_chain.chain[array_length(wh_chain.chain, 1)] end)
      end, true) r,
    case split_part(c.expect_kind, ':', 2)
      when 'hr_admin'  then a.scope = 'portal' and coalesce(a.lvl <= 20, false)
      when 'le20'      then a.scope = 'portal' and coalesce(a.lvl <= 20, false)
      when 'le30'      then a.scope = 'portal' and coalesce(a.lvl <= 30, false)
      when 'le10'      then a.scope = 'portal' and coalesce(a.lvl <= 10, false)
      when 'le50_or_manager' then a.scope = 'portal' and (coalesce(a.lvl <= 50, false) or a.role_code = 'MANAGER')
      when 'admin_list' then a.scope = 'portal' and a.role_code in ('SA','HQ','POWER_USER')
      when 'shipment'  then a.scope = 'portal' and coalesce(a.lvl <= 40, false) and a.ot in ('HQ','WH')
    end legacy
  from checks c cross join actor a cross join org cross join wh_chain
)
select grp, decision, perm, label,
  r->>'decision' sa, r->>'reason_code' reason,
  case when expect_kind like 'LEGACY:%' then case when legacy then 'ALLOW' else 'DENY' end
       when expect_kind like 'RESIDUAL:%' then case when legacy then 'ANY' else 'DENY' end
       else expect_kind end expected,
  case
    when expect_kind like 'LEGACY:%' then (r->>'decision' = 'ALLOW') = legacy
                                        -- a narrower S&A answer is accepted only for the documented cases
                                        or (legacy and r->>'decision' = 'DENY' and r->>'reason_code' in ('MISSING_MEMBERSHIP','MISSING_CONTEXT'))
    when expect_kind like 'RESIDUAL:%' then not (r->>'decision' = 'ALLOW' and not legacy)
    else r->>'decision' = expect_kind
  end ok
from eval
order by grp, decision, label;

-- Pass criterion: no row with ok = false.
