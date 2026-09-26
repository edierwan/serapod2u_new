import { beforeEach, describe, expect, it, vi } from 'vitest'

const authGetUser = vi.fn()
const checkPermissionForUser = vi.fn()
const usersUpdateEq = vi.fn()
const usersUpdate = vi.fn(() => ({ eq: usersUpdateEq }))
const updateUserById = vi.fn()
const createAuthUser = vi.fn()
const deleteAuthUser = vi.fn()
const adminRpc = vi.fn()

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: authGetUser } })),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    auth: { admin: { updateUserById, createUser: createAuthUser, deleteUser: deleteAuthUser } },
    rpc: adminRpc,
    from: (table: string) => {
      if (table !== 'users') throw new Error(`Unexpected table: ${table}`)
      return { update: usersUpdate }
    },
  })),
}))
vi.mock('@/lib/server/permissions', () => ({ checkPermissionForUser }))

describe('updateUserWithAuth Phase 0A authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usersUpdateEq.mockResolvedValue({ error: null })
    updateUserById.mockResolvedValue({ data: { user: {} }, error: null })
    createAuthUser.mockResolvedValue({ data: { user: { id: 'new-user' } }, error: null })
    deleteAuthUser.mockResolvedValue({ error: null })
    adminRpc.mockResolvedValue({ data: null, error: null })
  })

  it('allows a legitimate self-service personal profile change', async () => {
    authGetUser.mockResolvedValue({ data: { user: { id: 'self' } }, error: null })
    checkPermissionForUser.mockResolvedValue({ allowed: false, context: { role_level: 50 } })
    const { updateUserWithAuth } = await import('./actions')

    const result = await updateUserWithAuth('self', { full_name: 'Liza', address: 'KL' })

    expect(result).toEqual({ success: true })
    expect(usersUpdate).toHaveBeenCalledWith(expect.objectContaining({ full_name: 'Liza', address: 'KL' }))
  })

  it.each(['role_code', 'organization_id', 'is_active', 'department_id', 'employment_status'])(
    'denies a self-service %s change',
    async (field) => {
      authGetUser.mockResolvedValue({ data: { user: { id: 'self' } }, error: null })
      checkPermissionForUser.mockResolvedValue({ allowed: false, context: { role_level: 50 } })
      const { updateUserWithAuth } = await import('./actions')

      const result = await updateUserWithAuth('self', { [field]: 'attacker-value' } as any)

      expect(result.success).toBe(false)
      expect(result.error).toContain(field)
      expect(usersUpdate).not.toHaveBeenCalled()
    },
  )

  it('preserves authorized User Management role changes', async () => {
    authGetUser.mockResolvedValue({ data: { user: { id: 'admin' } }, error: null })
    checkPermissionForUser.mockResolvedValue({ allowed: true, context: { role_level: 10 } })
    const { updateUserWithAuth } = await import('./actions')

    const result = await updateUserWithAuth('target', { role_code: 'MANAGER' })

    expect(result).toEqual({ success: true })
    expect(usersUpdate).toHaveBeenCalledWith({ role_code: 'MANAGER' })
  })

  it('denies an unauthorized cross-user update', async () => {
    authGetUser.mockResolvedValue({ data: { user: { id: 'ordinary' } }, error: null })
    checkPermissionForUser.mockResolvedValue({ allowed: false, context: { role_level: 50 } })
    const { updateUserWithAuth } = await import('./actions')

    const result = await updateUserWithAuth('target', { role_code: 'SA' })

    expect(result.success).toBe(false)
    expect(usersUpdate).not.toHaveBeenCalled()
  })

  it('does not trust callerInfo when there is no authenticated session', async () => {
    authGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'missing session' } })
    const { updateUserWithAuth } = await import('./actions')

    const result = await updateUserWithAuth(
      'target',
      { role_code: 'SA' },
      { id: 'spoofed-super-admin', role_code: 'SA' },
    )

    expect(result.success).toBe(false)
    expect(checkPermissionForUser).not.toHaveBeenCalled()
    expect(usersUpdate).not.toHaveBeenCalled()
  })

  it('rolls back the Auth identity when privileged profile provisioning fails', async () => {
    authGetUser.mockResolvedValue({ data: { user: { id: 'admin' } }, error: null })
    checkPermissionForUser.mockResolvedValue({ allowed: true, context: { role_level: 10 } })
    adminRpc.mockResolvedValue({ data: null, error: { message: 'sync denied' } })
    const { createUserWithAuth } = await import('./actions')

    const result = await createUserWithAuth({
      email: 'new@example.com',
      password: 'temporary-password',
      full_name: 'New User',
      role_code: 'USER',
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('sync denied')
    expect(deleteAuthUser).toHaveBeenCalledWith('new-user')
  })
})
