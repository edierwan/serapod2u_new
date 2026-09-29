import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Stage 2C: server-side legacy role decisions converted to S&A. The legacy
 * rule survives only as the `legacy` evaluator (decides in LEGACY_ENFORCED /
 * SHADOW); it is never an extra gate after, or a bypass before, the S&A
 * decision. Inventory: docs/security/IDENTITY_FOUNDATION_STAGE2C_INVENTORY.md
 */
const src = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

const RESIDUAL_GATES: Array<{ file: string; permission: string; removed: RegExp; plainGuardElsewhere?: boolean }> = [
  ...['create', 'update', 'delete', 'duplicate'].map(name => ({
    file: `app/api/journey/${name}/route.ts`,
    permission: 'customer.campaign.manage',
    removed: /if \(!roleLevel \|\| roleLevel > 30\)/,
  })),
  ...['restore-data', 'send-deletion-notification', 'export-data'].map(name => ({
    file: `app/api/admin/${name}/route.ts`,
    permission: 'platform.data.destructive',
    removed: /\n\s*if \(!profile \|\| !\(profile as any\)\.roles \|\| \(profile as any\)\.roles\.role_level !== 1\) \{/,
  })),
  ...['static-report', 'export', 'runtime-report'].map(name => ({
    file: `app/api/admin/cleanup/${name}/route.ts`,
    permission: 'platform.data.destructive',
    removed: /\n\s*if \(profileError \|\| !userProfile \|\| \(userProfile\.roles as any\)\?\.role_level !== 1\) \{/,
  })),
  { file: 'app/api/admin/upload-template-preview/route.ts', permission: 'platform.data.destructive', removed: /\n\s*if \(userError \|\| !userData\?\.roles\?\.role_level/ },
  // GET (status) keeps its plain guard; POST (run) had the residual check.
  { file: 'app/api/admin/doc-migration/route.ts', permission: 'platform.data.destructive', removed: /if \(roleLevel > 10\) \{/, plainGuardElsewhere: true },
  { file: 'app/api/admin/fix-shop-rls/route.ts', permission: 'platform.data.destructive', removed: /\n\s*if \(!profile \|\| !\['SA', 'HQ'\]\.includes\(profile\.role_code\)\) \{/ },
  { file: 'app/api/admin/states/route.ts', permission: 'platform.settings.manage', removed: /\n\s*if \(userError \|\| !userData \|\| !\['SA'/ },
  { file: 'app/api/organizations/import/route.ts', permission: 'platform.organization.manage', removed: /roleLevel > 50 && profile\.role_code !== 'MANAGER'\)\) \{/ },
  { file: 'app/api/organizations/delete/request-otp/route.ts', permission: 'platform.organization.manage', removed: /if \(profileError \|\| !canDeleteOrganizations\(profile\)\)/ },
  { file: 'app/api/organizations/delete/verify-and-delete/route.ts', permission: 'platform.data.destructive', removed: /if \(profileError \|\| !canDeleteOrganizations\(profile\)\)/ },
]

describe('Stage 2C — residual legacy gates became S&A legacy evaluators', () => {
  it.each(RESIDUAL_GATES)('$file decides $permission once, with the legacy rule as its evaluator', ({ file, permission, removed, plainGuardElsewhere }) => {
    const code = src(file)
    expect(code).not.toMatch(removed)
    const guards = code.match(new RegExp(`guardUserOperation\\(user\\.id, '${permission.replace(/\./g, '\\.')}', \\{\\n\\s*legacy: `, 'g')) ?? []
    expect(guards.length).toBeGreaterThanOrEqual(1)
    // No unconditional guard left behind that a residual check used to follow.
    if (!plainGuardElsewhere) expect(code).not.toContain(`guardUserOperation(user.id, '${permission}')\n`)
  })

  it('confirm-shipment uses the shared warehouse-context S&A guard', () => {
    const code = src('app/api/warehouse/confirm-shipment/route.ts')
    expect(code).toContain('authorizeShipmentActor(supabaseAdmin, authenticatedUser.id')
    expect(code).not.toContain('authorizeWarehouseShipment(')
  })

  it('bulk-delete-users takes the caller from the verified guard, never the body', () => {
    const code = src('app/api/admin/bulk-delete-users/route.ts')
    expect(code).not.toMatch(/\{ userIds, callerId \} = body/)
    expect(code).toContain('const callerId = guard.userId as string')
    expect(code).not.toMatch(/roleLevel !== 1 && roleLevel !== 10/)
  })

  it('KPI request-changes has no legacy HR-manager bypass before S&A', () => {
    const code = src('app/api/hr/kpi/reviews/[id]/request-changes/route.ts')
    expect(code).not.toMatch(/isKpiHrManager\(auth\.data\) \|\| \(await kpiCan/)
    expect(code).toMatch(/await kpiCan\(auth\.data, 'hr\.performance\.manage',\s*\n?\s*async \(\) => isKpiHrManager/)
  })

  it('HR cross-organization edits are decided by S&A in the target organization', () => {
    const userHr = src('app/api/users/[id]/hr/route.ts')
    const positions = src('app/api/hr/positions/[id]/route.ts')
    expect(userHr).not.toMatch(/ctx\.roleLevel === null \|\| ctx\.roleLevel > 20/)
    expect(userHr.match(/hrCanIn\(ctx, 'hr\.employee\.manage', \w+\.organization_id,/g)).toHaveLength(4)
    expect(positions).not.toMatch(/&& ctx\.roleLevel !== 1\) \{/)
    expect(positions.match(/hrCanIn\(ctx, 'hr\.employee\.manage', current\.organization_id,/g)).toHaveLength(2)
  })

  it('HR department, position and settings actions are S&A decisions', () => {
    const departments = src('lib/actions/departments.ts')
    expect(departments).toMatch(/const canManageDepartments = \(ctx: UserContext\) =>\n\s*userAllowed\(ctx\.id, 'hr\.employee\.manage', \(\) => legacyCanManageDepartments\(ctx\)/)
    expect(departments).toMatch(/const canManageOrgChart = \(ctx: UserContext\) =>\n\s*userAllowed\(ctx\.id, 'hr\.employee\.manage', \(\) => legacyCanManageOrgChart\(ctx\)/)
    expect(departments).not.toMatch(/if \(!canManageDepartments\(ctxResult\.data\)\)/)
    expect(src('lib/actions/hrPositions.ts')).toContain("return userAllowed(userId, 'hr.employee.manage', () => legacyCanManagePositions(userId, roleLevel), { organizationId })")
    expect(src('lib/actions/hrSettings.ts')).toContain("return userAllowed(userId, 'hr.settings.manage', () => legacyCanManageSettings(userId, roleLevel), { organizationId })")
  })

  it('HR→GL accounting actions are Finance S&A decisions with no role-level-only path', () => {
    const code = src('modules/hr/accounting/actions.ts')
    expect(code).not.toMatch(/role_level !== null && ctx\.data\.role_level > 20/)
    expect(code.match(/canManagePayrollIntegration\(ctx\.data, organizationId\)/g)).toHaveLength(3)
    expect(code).toContain("financeAllowed(ctx.id, 'finance.payroll_integration.manage',")
  })

  it('the HR assistant resolves its sensitive tiers through S&A', () => {
    for (const file of ['app/api/hr/assistant/chat/route.ts', 'app/api/hr/assistant/chat/stream/route.ts']) {
      const code = src(file)
      expect(code).toContain('await resolveHrRoleForCaller(ctx)')
      expect(code).not.toMatch(/resolveHrRole\(ctx\.roleCode, ctx\.roleLevel\)/)
    }
  })
})

const authorizeOperation = vi.fn()
vi.mock('@/lib/security-access/operation', () => ({
  authorizeOperation: (...args: any[]) => authorizeOperation(...args),
  organizationResource: (type: string, organizationId: string | null | undefined, extra = {}) => ({ type, organizationId: organizationId ?? null, ...extra }),
}))

describe('Stage 2C — behaviour', () => {
  const ctx = { userId: 'u-1', organizationId: 'org-a', roleCode: 'USER', roleLevel: 40 }

  beforeEach(() => {
    authorizeOperation.mockReset()
  })

  it('hrCanIn evaluates S&A against the target organization, not the caller’s', async () => {
    authorizeOperation.mockResolvedValue({ decision: 'ALLOW' })
    const { hrCanIn } = await import('@/lib/server/hrAccess')
    await expect(hrCanIn(ctx, 'hr.employee.manage', 'org-b', () => false)).resolves.toBe(true)
    expect(authorizeOperation).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'u-1', permission: 'hr.employee.manage', resource: expect.objectContaining({ organizationId: 'org-b' }),
    }))
  })

  it('hrCanIn denies when the evaluation fails', async () => {
    authorizeOperation.mockRejectedValue(new Error('down'))
    const { hrCanIn } = await import('@/lib/server/hrAccess')
    await expect(hrCanIn(ctx, 'hr.employee.manage', 'org-b', () => true)).resolves.toBe(false)
  })

  it('HR assistant: S&A compensation access gives the HR manager tier regardless of legacy level', async () => {
    authorizeOperation.mockImplementation(async (req: any) => ({ decision: req.permission === 'hr.compensation.view' ? 'ALLOW' : 'DENY' }))
    const { resolveHrRoleForCaller } = await import('@/lib/server/hr/assistant/access')
    await expect(resolveHrRoleForCaller(ctx)).resolves.toBe('HR_MANAGER')
  })

  it('HR assistant: a legacy Super Admin that S&A denies gets no sensitive tier', async () => {
    authorizeOperation.mockResolvedValue({ decision: 'DENY' })
    const { resolveHrRoleForCaller } = await import('@/lib/server/hr/assistant/access')
    await expect(resolveHrRoleForCaller({ ...ctx, roleCode: 'SA', roleLevel: 1 })).resolves.toBe('EMPLOYEE')
  })

  it('HR assistant: S&A HR management without compensation access gives the HR staff tier', async () => {
    authorizeOperation.mockImplementation(async (req: any) => ({ decision: req.permission === 'hr.employee.manage' ? 'ALLOW' : 'DENY' }))
    const { resolveHrRoleForCaller } = await import('@/lib/server/hr/assistant/access')
    await expect(resolveHrRoleForCaller(ctx)).resolves.toBe('HR_STAFF')
  })

  it('HR assistant: the line-manager tier is the S&A decision hr.employee.view_internal (Stage 2D)', async () => {
    authorizeOperation.mockImplementation(async (req: any) => ({ decision: req.permission === 'hr.employee.view_internal' ? 'ALLOW' : 'DENY' }))
    const { resolveHrRoleForCaller } = await import('@/lib/server/hr/assistant/access')
    await expect(resolveHrRoleForCaller({ ...ctx, roleCode: 'GUEST', roleLevel: 50 })).resolves.toBe('MANAGER')
    authorizeOperation.mockResolvedValue({ decision: 'DENY' })
    await expect(resolveHrRoleForCaller({ ...ctx, roleCode: 'MANAGER', roleLevel: 30 })).resolves.toBe('EMPLOYEE')
  })
})
