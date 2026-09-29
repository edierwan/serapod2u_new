-- ============================================================================
-- Identity Foundation Stage 2C — S&A vs legacy parity for residual role gates
-- ----------------------------------------------------------------------------
-- READ-ONLY. Run inside: BEGIN; SET TRANSACTION READ ONLY; ... ROLLBACK;
-- For each legacy role rule that still gates a route after (or instead of) its
-- S&A decision, counts active users where
--   both_allow          S&A and the legacy rule both allow
--   widen_if_converted  S&A allows but the legacy rule denies — removing the
--                       legacy gate would widen access for these users
--   sa_narrower         the legacy rule allows but S&A denies — already denied
--                       today where the S&A guard runs first
-- widen_who lists role@org-type pairs only (no identities, no PII).
-- A gate is safe to convert when widen_if_converted = 0 in the environment.
-- Staging result (2026-09-29): see docs/security/IDENTITY_FOUNDATION_STAGE2C_INVENTORY.md
-- ============================================================================
with u as (
  select u.id, u.role_code, r.role_level lvl, o.org_type_code ot, false isa, u.organization_id org, u.account_scope sc
  from public.users u left join public.roles r on r.role_code=u.role_code left join public.organizations o on o.id=u.organization_id
  where u.is_active
), g(gate, perm, legacy_sql) as (values
  ('support_admin','customer.support.manage', 'rc_in:SA,HQ,POWER_USER,HQ_ADMIN,admin,super_admin,hq_admin'),
  ('crm_reports','customer.consumer.view','rc_in:SA,HQ,POWER_USER'),
  ('journey','customer.campaign.manage','lvl_le:30'),
  ('master_banner','customer.campaign.manage','hq_lvl_le_nullok:30'),
  ('message_setup','customer.campaign.manage','lvl_le:20'),
  ('wa_audience','customer.campaign.manage','rc_in:SA,HQ,POWER_USER'),
  ('states','platform.settings.manage','rc_in:SA,HQ,POWER_USER,HQ_ADMIN,admin,super_admin,hq_admin'),
  ('wa_admin','platform.settings.manage','isa_or_rc:ADMIN,HQ,SUPER'),
  ('destructive_sa','platform.data.destructive','lvl_eq:1'),
  ('destructive_le10','platform.data.destructive','lvl_le:10'),
  ('fix_shop_rls','platform.data.destructive','rc_in:SA,HQ'),
  ('org_delete','platform.organization.manage','lvl_le:10'),
  ('org_import','platform.organization.manage','lvl_le_or_mgr:50'),
  ('bank_details','platform.organization.manage','lvl_in:1,10'),
  ('ecom_store','ecommerce.store.manage','hq_lvl_le:30'),
  ('confirm_shipment','warehouse.shipment.manage','lvl_le:40'),
  ('hr_accounting','finance.payroll_integration.manage','lvl_le_nullok:20'),
  ('hr_depts','hr.employee.manage','lvl_le_or_hrm:20'),
  ('hr_settings','hr.settings.manage','lvl_le:20'),
  ('email_monitor','platform.settings.manage','staff_hq_or_le20'),
  ('user_create','platform.user.manage','lvl_le:30'),
  ('profile_admin','platform.user.manage','lvl_in:1,10'),
  ('ai_hrmgr_comp','hr.compensation.view','lvl_le_or_hrm:20'),
  ('ai_hrstaff_empmanage','hr.employee.manage','lvl_le_or_hrm:20'),
  ('ai_manager_empview','hr.employee.view','lvl_le_or_mgr:50'),
  ('kpi_hrmgr','hr.performance.manage','lvl_le_or_hrm:20'),
  ('crm_module_viaconsumer','customer.consumer.view','hq_lvl_le:50'),
  ('ecom_page','ecommerce.store.manage','hq_lvl_le:30'),
  ('journey_page','customer.campaign.manage','lvl_le:30'),
  ('mfg_quality_page','manufacturing.adjustment.manage','rc_in:SA')
), e as (
  select g.gate, u.*, (public.sa_evaluate_permission(u.id, g.perm, jsonb_build_object('organization_id', u.org), true)->>'decision')='ALLOW' as sa,
    case split_part(g.legacy_sql,':',1)
      when 'rc_in' then u.role_code = any(string_to_array(split_part(g.legacy_sql,':',2),','))
      when 'lvl_le' then coalesce(u.lvl <= split_part(g.legacy_sql,':',2)::int,false)
      when 'lvl_le_nullok' then (u.lvl is null or u.lvl <= split_part(g.legacy_sql,':',2)::int)
      when 'lvl_eq' then coalesce(u.lvl = split_part(g.legacy_sql,':',2)::int,false)
      when 'lvl_in' then coalesce(u.lvl = any(string_to_array(split_part(g.legacy_sql,':',2),',')::int[]),false)
      when 'hq_lvl_le_nullok' then u.ot='HQ' and (u.lvl is null or u.lvl <= split_part(g.legacy_sql,':',2)::int)
      when 'hq_lvl_le' then u.ot='HQ' and coalesce(u.lvl <= split_part(g.legacy_sql,':',2)::int,false)
      when 'isa_or_rc' then u.isa or u.role_code = any(string_to_array(split_part(g.legacy_sql,':',2),','))
      when 'lvl_le_or_mgr' then coalesce(u.lvl <= split_part(g.legacy_sql,':',2)::int,false) or u.role_code='MANAGER'
      when 'lvl_le_or_hrm' then coalesce(u.lvl <= split_part(g.legacy_sql,':',2)::int,false) or u.role_code='HR_MANAGER'
      when 'staff_hq_or_le20' then u.sc='portal' and coalesce(u.lvl<=40,false) and (u.lvl<=20 or u.ot='HQ')
    end as legacy
  from g cross join u
)
select gate, count(*) filter (where sa and legacy) both_allow,
  count(*) filter (where sa and not legacy) widen_if_converted,
  count(*) filter (where not sa and legacy) sa_narrower,
  string_agg(distinct case when sa and not legacy then coalesce(role_code,'∅')||'@'||coalesce(ot,'∅') end, ',') widen_who
from e group by gate order by gate;
