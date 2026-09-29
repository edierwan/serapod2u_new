import { beforeEach, describe, expect, it, vi } from 'vitest'

// Stage 2C: HR→GL configuration is decided by S&A
// (finance.payroll_integration.manage) for the organization being configured.
const financeAllowed = vi.fn()
vi.mock('@/lib/security-access/finance', () => ({ financeAllowed: (...args: any[]) => financeAllowed(...args) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const rpc = vi.fn()
let profile: any
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u-1' } }, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: profile, error: null }) }) }) }),
    rpc,
  })),
}))

describe('HR accounting actions authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rpc.mockResolvedValue({ data: null, error: { message: 'stop here' } })
  })

  it('asks S&A for the target organization and stops when it denies', async () => {
    profile = { id: 'u-1', organization_id: 'org-a', roles: { role_level: 1 } }
    financeAllowed.mockResolvedValue(false)
    const { applyHrCoaTemplate, setupDefaultHrGlMappings, saveHrGlMapping } = await import('./actions')

    await expect(applyHrCoaTemplate('org-b')).resolves.toEqual({ success: false, error: 'Insufficient permissions' })
    await expect(setupDefaultHrGlMappings('org-b')).resolves.toEqual({ success: false, error: 'Insufficient permissions' })
    await expect(saveHrGlMapping('org-b', 'PAYROLL_RUN', 'SALARY_EXPENSE', null, 'debit')).resolves.toEqual({ success: false, error: 'Insufficient permissions' })
    expect(financeAllowed).toHaveBeenCalledTimes(3)
    for (const call of financeAllowed.mock.calls) {
      expect(call[0]).toBe('u-1')
      expect(call[1]).toBe('finance.payroll_integration.manage')
      expect(call[3]).toBe('org-b')
    }
    expect(rpc).not.toHaveBeenCalled()
  })

  it('proceeds past authorization when S&A allows, whatever the legacy level', async () => {
    profile = { id: 'u-1', organization_id: 'org-a', roles: { role_level: 40 } }
    financeAllowed.mockResolvedValue(true)
    const { applyHrCoaTemplate } = await import('./actions')
    await applyHrCoaTemplate('org-a')
    expect(rpc).toHaveBeenCalled()
  })

  it('the legacy evaluator no longer lets a missing role level through', async () => {
    profile = { id: 'u-1', organization_id: 'org-a', roles: null }
    financeAllowed.mockImplementation(async (_u: string, _p: string, legacy: () => boolean) => legacy())
    const { applyHrCoaTemplate } = await import('./actions')
    await expect(applyHrCoaTemplate('org-a')).resolves.toEqual({ success: false, error: 'Insufficient permissions' })
  })
})
