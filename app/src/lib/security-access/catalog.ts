/**
 * Enterprise operation catalog — the single source of truth for Final Wave
 * permissions. The Final Wave migrations seed sa_permissions,
 * sa_migration_modes and sa_legacy_compat_rules from exactly this list
 * (catalog-migration.test.ts keeps them in lock-step).
 *
 * A permission answers "may this actor attempt this action on this scoped
 * resource?". Workflow validity, calculations and state transitions stay in
 * the owning module.
 *
 * `compat` describes which LEGACY role definitions reproduce today's access
 * for the permission. It is used only to grant the permission to the
 * generated compatibility roles (legacy-<role_code>), so that SHADOW parity
 * is meaningful and NEW_ENFORCED preserves behaviour. It never decides at
 * runtime. Removing a compatibility grant is an explicit, audited S&A change.
 */

export type CatalogSensitivity = 'ordinary' | 'security_sensitive'

export interface CompatRule {
  /** Legacy roles with role_level <= this value receive the permission. */
  maxRoleLevel?: number
  /** Legacy role codes that receive the permission regardless of level. */
  roleCodes?: string[]
  /** Legacy roles whose roles.permissions grant any of these keys receive it. */
  legacyPermissions?: string[]
}

export interface CatalogEntry {
  key: string
  description: string
  sensitivity: CatalogSensitivity
  compat: CompatRule
  /** Granted to the Employee Self-Service baseline role (own_record scope). */
  employeeBaseline?: boolean
}

const HR_MANAGER: CompatRule = {
  maxRoleLevel: 20,
  roleCodes: ['HR_MANAGER'],
  legacyPermissions: ['manage_org_chart', 'edit_org_settings'],
}
const HR_ENTRY: CompatRule = {
  maxRoleLevel: 20,
  roleCodes: ['HR_MANAGER'],
  legacyPermissions: ['view_users', 'view_settings', 'manage_org_chart', 'edit_org_settings'],
}
const SUPER_ADMIN: CompatRule = { maxRoleLevel: 1 }
const HQ_ADMIN: CompatRule = { maxRoleLevel: 10 }
const ADMIN: CompatRule = { maxRoleLevel: 20 }
const MANAGER: CompatRule = { maxRoleLevel: 30 }
const STAFF: CompatRule = { maxRoleLevel: 40 }
const MEMBER: CompatRule = { maxRoleLevel: 50 }

const e = (key: string, description: string, sensitivity: CatalogSensitivity, compat: CompatRule, extra: Partial<CatalogEntry> = {}): CatalogEntry =>
  ({ key, description, sensitivity, compat, ...extra })
const S: CatalogSensitivity = 'security_sensitive'
const O: CatalogSensitivity = 'ordinary'

export const FINAL_WAVE_CATALOG: readonly CatalogEntry[] = [
  // ── Security & Access administration ─────────────────────────────────
  e('security.role.manage', 'Create and edit new-model business roles and their permissions', S, SUPER_ADMIN),
  e('security.scope.manage', 'Create and retire typed scope definitions', S, SUPER_ADMIN),
  e('security.policy.manage', 'Manage authority policies, segregation-of-duties rules and mitigations', S, SUPER_ADMIN),
  e('security.audit.view', 'View authorization decisions, access changes and privileged actions', S, SUPER_ADMIN),
  e('security.access_request.approve', 'Approve or deny access requests in an authorized scope', S, SUPER_ADMIN),
  e('security.access_review.manage', 'Run access review campaigns and certify assignments', S, SUPER_ADMIN),
  e('security.delegation.manage', 'Create or revoke delegations on behalf of other users', S, SUPER_ADMIN),
  e('security.service_identity.manage', 'Register and manage non-human service identities (never secret values)', S, SUPER_ADMIN),
  e('security.emergency_access.grant', 'Grant time-boxed emergency access (requires MFA step-up)', S, SUPER_ADMIN),

  // ── Finance ───────────────────────────────────────────────────────────
  e('finance.module.view', 'Open the Finance module and its status overview', S, { maxRoleLevel: 40, legacyPermissions: ['view_settings'] }),
  e('finance.ledger.view', 'View GL journals, journal detail, pending postings and document GL status', S, STAFF),
  e('finance.report.view_sensitive', 'View trial balance, profit & loss, balance sheet, GL detail and cashflow', S, STAFF),
  e('finance.receivable.view', 'View AR invoices, receipts and receivable aging', S, STAFF),
  e('finance.payable.view', 'View AP bills, supplier payments and payable aging', S, STAFF),
  e('finance.cash.view', 'View bank accounts and reconciliation status', S, STAFF),
  e('finance.reconciliation.perform', 'Maintain bank accounts and perform bank reconciliation', S, ADMIN),
  e('finance.journal.post', 'Post a supported business document to the General Ledger', S, HQ_ADMIN),
  e('finance.account.manage', 'Manage the chart of accounts', S, HQ_ADMIN),
  e('finance.settings.manage', 'Manage accounting settings, posting rules, currencies and fiscal periods', S, HQ_ADMIN),
  e('finance.data.reset', 'Reset accounting data for an organization (destructive)', S, ADMIN),
  e('finance.payment.approve', 'Approve a supplier balance payment request', S, ADMIN),
  e('finance.payroll_integration.manage', 'Manage payroll/benefit GL mappings and control accounts', S, HR_MANAGER),

  // ── HR ────────────────────────────────────────────────────────────────
  e('hr.module.view', 'Open the HR module', O, HR_ENTRY),
  e('hr.employee.view', 'View the employee directory of an organization', O, HR_ENTRY),
  e('hr.employee.manage', 'Create and maintain employee master data and positions', S, HR_MANAGER),
  e('hr.attendance.manage', 'Manage attendance policy, shifts, corrections, overtime and timesheets', O, HR_MANAGER),
  e('hr.leave.approve', 'Approve or reject leave requests and manage leave configuration', S, HR_MANAGER),
  e('hr.payroll.view', 'View payroll runs and payroll line items', S, HR_MANAGER),
  e('hr.payroll.prepare', 'Create and calculate payroll runs', S, HR_MANAGER),
  e('hr.payroll.approve', 'Approve a calculated payroll run', S, HR_MANAGER),
  e('hr.payroll.release', 'Post an approved payroll run to the General Ledger or reverse it', S, ADMIN),
  e('hr.compensation.view', 'View employee compensation, allowances and deductions', S, HR_MANAGER),
  e('hr.compensation.manage', 'Manage compensation, salary bands, allowances, deductions and statutory settings', S, HR_MANAGER),
  e('hr.contract.view', 'View employment contracts', S, HR_MANAGER),
  e('hr.contract.manage', 'Manage employment contracts', S, HR_MANAGER),
  e('hr.benefits.manage', 'Manage benefit plans, providers, enrollments and contribution runs', S, HR_MANAGER),
  e('hr.learning.manage', 'Manage courses, enrollments and certifications', O, HR_MANAGER),
  e('hr.onboarding.manage', 'Manage onboarding templates, instances and tasks', O, HR_MANAGER),
  e('hr.recruitment.manage', 'Manage job postings, applicants, interviews and offers', S, HR_MANAGER),
  e('hr.policy.manage', 'Manage HR policies and acknowledgements', O, HR_MANAGER),
  e('hr.performance.manage', 'Manage appraisals, performance reviews, templates and KPI programmes', O, HR_MANAGER),
  e('hr.expense.manage', 'Manage timesheet entries and expense claims', S, HR_MANAGER),
  e('hr.analytics.view', 'View HR analytics, snapshots and the HR AI audit', S, HR_MANAGER),
  e('hr.settings.manage', 'Manage HR configuration, public holidays and HR setup', O, HR_MANAGER),
  e('hr.ai.use', 'Use the HR AI assistant and its actions', S, HR_MANAGER),
  e('hr.self_service.use', 'Use employee self-service for the employee\'s own record', S, {}, { employeeBaseline: true }),

  // ── Supply Chain ─────────────────────────────────────────────────────
  e('supply_chain.order.create', 'Create and submit orders', O, { maxRoleLevel: 40, legacyPermissions: ['create_orders'] }),
  e('supply_chain.order.approve', 'Approve a submitted order', S, { maxRoleLevel: 30, legacyPermissions: ['approve_orders'] }),
  e('supply_chain.order.cancel', 'Cancel an order before fulfilment', S, { maxRoleLevel: 40, legacyPermissions: ['create_orders', 'cancel_orders'] }),
  e('supply_chain.document.acknowledge', 'Acknowledge PO, invoice and payment documents', O, STAFF),
  e('supply_chain.document.manage', 'Generate and upload supply chain documents', O, STAFF),
  e('inventory.transfer.cancel', 'Cancel a stock transfer before dispatch', O, MEMBER),
  e('inventory.adjustment.post', 'Post manual stock additions, adjustments and reversals', S, { maxRoleLevel: 30, legacyPermissions: ['adjust_stock', 'manage_inventory'] }),
  e('inventory.opening_balance.manage', 'Run inventory opening balance and classification cut-offs', S, HQ_ADMIN),
  e('inventory.stock_config.manage', 'Manage variant stock configurations', O, HQ_ADMIN),
  e('inventory.return.request', 'Request a product return for the own organization', O, { maxRoleLevel: 40, roleCodes: ['SHOP'] }),
  e('inventory.return.manage', 'Manage, receive and report on return cases (non-shop organizations)', O, { maxRoleLevel: 30, roleCodes: ['USER'] }),
  e('inventory.report.view', 'View inventory movements and stock reports', O, STAFF),
  e('warehouse.receipt.post', 'Receive goods into a warehouse', O, { maxRoleLevel: 40, legacyPermissions: ['receive_goods', 'manage_inventory'] }),
  e('warehouse.shipment.manage', 'Start, scan, confirm, complete and cancel warehouse shipments', O, { maxRoleLevel: 40, legacyPermissions: ['ship_goods', 'manage_inventory'] }),
  e('manufacturing.production.manage', 'Pack, link and complete production batches', O, STAFF),
  e('manufacturing.adjustment.manage', 'Manage manufacturer quality adjustments', O, STAFF),
  e('manufacturing.scan.reverse', 'Reverse or delete production scan history', S, STAFF),
  e('qr.batch.manage', 'Generate, process and download QR batches', O, STAFF),
  e('product.catalog.manage', 'Manage products, variants and product documents', O, ADMIN),

  // ── RoadTour ─────────────────────────────────────────────────────────
  e('roadtour.campaign.manage', 'Manage RoadTour events, settings and QR distribution', O, MANAGER),
  e('roadtour.kpi.manage', 'Manage RoadTour KPI plans, cycles, teams and rules', O, ADMIN),
  e('roadtour.report.view', 'View RoadTour KPI and performance reports', O, STAFF),
  e('roadtour.visit.manage', 'Manage RoadTour visits and participants', O, STAFF),

  // ── Customer & Growth ────────────────────────────────────────────────
  e('customer.loyalty.adjust', 'Manually adjust consumer or shop point balances', S, STAFF),
  e('customer.reward.manage', 'Manage reward catalogue, categories and loyalty settings', O, STAFF),
  e('customer.redemption.manage', 'Review and update reward redemptions', S, STAFF),
  e('customer.program.manage', 'Manage loyalty programme memberships and mappings', S, STAFF),
  e('customer.consumer.view', 'Look up consumers and consumer activity for support', S, STAFF),
  e('customer.shop.manage', 'Approve shop requests and manage shop/reference mappings', S, ADMIN),
  e('customer.campaign.manage', 'Manage journeys, landing pages, games and marketing campaigns', O, MANAGER),
  e('customer.support.manage', 'Handle support conversations and messaging administration', O, STAFF),

  // ── E-Commerce ───────────────────────────────────────────────────────
  e('ecommerce.store.manage', 'Manage storefront configuration and banners', O, ADMIN),
  e('ecommerce.order.manage', 'Manage storefront orders and fulfilment', S, ADMIN),
  e('ecommerce.channel.manage', 'Manage e-commerce channel connections (metadata only)', S, SUPER_ADMIN),

  // ── Platform administration ─────────────────────────────────────────
  e('platform.settings.manage', 'Manage platform integrations, notification providers and AI settings', S, HQ_ADMIN),
  e('platform.organization.manage', 'Import, configure and remove organizations', S, HQ_ADMIN),
  e('platform.user.manage', 'Administer user profiles, credentials resets and phone changes', S, { maxRoleLevel: 30, legacyPermissions: ['edit_users', 'create_users'] }),
  e('platform.data.destructive', 'Run destructive data maintenance (environment-gated)', S, SUPER_ADMIN),
  e('reporting.analytics.view', 'View cross-module business analytics', O, STAFF),
] as const

export const FINAL_WAVE_PERMISSION_KEYS = FINAL_WAVE_CATALOG.map(entry => entry.key)

export function catalogEntry(key: string): CatalogEntry | undefined {
  return FINAL_WAVE_CATALOG.find(entry => entry.key === key)
}

/** Legacy role definition → does the compatibility rule grant the permission? */
export function compatGrants(entry: Pick<CatalogEntry, 'compat' | 'employeeBaseline'>, role: { roleCode: string; roleLevel: number | null; permissions: string[] }): boolean {
  // Own-record permissions come only from the baseline role (own_record scope).
  if (entry.employeeBaseline) return false
  const rule = entry.compat
  if (role.roleLevel === 1) return true
  if (rule.maxRoleLevel !== undefined && role.roleLevel !== null && role.roleLevel <= rule.maxRoleLevel) return true
  if (rule.roleCodes?.includes(role.roleCode.toUpperCase())) return true
  return !!rule.legacyPermissions?.some(p => role.permissions.includes(p))
}
