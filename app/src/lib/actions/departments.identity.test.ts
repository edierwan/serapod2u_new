import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/security-access/operation', async () => (await import('@/test-support/sa-legacy-mode')).operationModule)

const provisionIdentity = vi.fn()
const usersUpdate = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }))
let caller: { id: string; organization_id: string; role_code: string; roles: { role_level: number } }

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/identity/provisioning', () => ({ provisionIdentity }))
vi.mock('@/lib/server/permissions', () => ({ checkPermissionForUser: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: caller.id } }, error: null }) },
    from: (table: string) => {
      if (table === 'users') {
        return {
          select: () => ({ eq: () => ({ single: async () => ({ data: caller, error: null }) }) }),
          update: usersUpdate,
        }
      }
      if (table === 'departments') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'dept-1', organization_id: 'org-a' }, error: null }) }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  })),
}))

describe('createUserForDepartment (legacy HR/department path)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    caller = { id: 'hr-1', organization_id: 'org-a', role_code: 'HR_MANAGER', roles: { role_level: 30 } }
  })

  it('routes identity creation through canonical provisioning with employee-management authority only', async () => {
    provisionIdentity.mockResolvedValue({ ok: true, userId: 'u-1', outcome: 'CREATED', tempPassword: 'T3mp-Pass-word' })
    const { createUserForDepartment } = await import('./departments')

    const result = await createUserForDepartment('dept-1', { email: 'new@x.test', full_name: 'New', role_code: 'USER' })

    expect(result).toMatchObject({ success: true, userId: 'u-1', tempPassword: 'T3mp-Pass-word' })
    expect(provisionIdentity).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'hr-1', organizationId: 'org-a', authorizingPermission: 'hr.employee.manage',
      source: 'department', accountScope: 'portal', hr: expect.objectContaining({ departmentId: 'dept-1' }),
    }))
  })

  it('cannot create a Super Admin: the privileged role is refused by provisioning (database ceiling)', async () => {
    provisionIdentity.mockResolvedValue({ ok: false, code: 'ROLE_GRANT_NOT_ALLOWED', status: 403, message: 'That role cannot be granted' })
    const { createUserForDepartment } = await import('./departments')

    const result = await createUserForDepartment('dept-1', { email: 'boss@x.test', full_name: 'Boss', role_code: 'SA' })

    expect(result.success).toBe(false)
    expect(provisionIdentity.mock.calls[0][0]).toMatchObject({ legacyRoleCode: 'SA', authorizingPermission: 'hr.employee.manage' })
  })

  it('denies callers without employee-management authority before provisioning', async () => {
    caller = { id: 'emp-1', organization_id: 'org-a', role_code: 'USER', roles: { role_level: 40 } }
    const { createUserForDepartment } = await import('./departments')

    const result = await createUserForDepartment('dept-1', { email: 'x@x.test', full_name: 'X', role_code: 'USER' })

    expect(result).toMatchObject({ success: false, error: 'Unauthorized' })
    expect(provisionIdentity).not.toHaveBeenCalled()
  })

  it('denies a department manager of another organization (legacy scope)', async () => {
    caller = { id: 'hr-b', organization_id: 'org-b', role_code: 'HR_MANAGER', roles: { role_level: 30 } }
    const { createUserForDepartment } = await import('./departments')

    const result = await createUserForDepartment('dept-1', { email: 'x@x.test', full_name: 'X', role_code: 'USER' })

    expect(result.success).toBe(false)
    expect(provisionIdentity).not.toHaveBeenCalled()
  })

  it('reuses an existing identity in the organization instead of creating a duplicate', async () => {
    provisionIdentity.mockResolvedValue({ ok: true, userId: 'existing', outcome: 'REUSED' })
    const { createUserForDepartment } = await import('./departments')

    const result = await createUserForDepartment('dept-1', { email: 'known@x.test', full_name: 'Known', role_code: 'USER' })

    expect(result).toMatchObject({ success: true, userId: 'existing', reused: true, tempPassword: undefined })
    expect(usersUpdate).toHaveBeenCalledWith({ department_id: 'dept-1', manager_user_id: null })
  })
})
