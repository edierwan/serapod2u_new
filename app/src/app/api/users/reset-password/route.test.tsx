import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  authGetUser: vi.fn(),
  updateUserById: vi.fn(),
  auditInsert: vi.fn(),
  currentProfile: { id: 'admin-1', email: 'admin@example.com', roles: { role_level: 10 } } as any,
  targetProfile: { id: 'target-1', email: 'target@example.com', full_name: 'Target User', role_code: 'USER', roles: { role_level: 40 } } as any,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mocks.authGetUser } }),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    auth: { admin: { updateUserById: mocks.updateUserById } },
    from: (table: string) => {
      if (table === 'audit_logs') return { insert: mocks.auditInsert }
      if (table === 'users') {
        let id = ''
        const query: any = {
          select: () => query,
          eq: (_column: string, value: string) => { id = value; return query },
          single: async () => ({ data: id === 'admin-1' ? mocks.currentProfile : mocks.targetProfile, error: null }),
        }
        return query
      }
      throw new Error(`Unexpected table ${table}`)
    },
  }),
}))

import { POST } from './route'

const request = () => new NextRequest('http://localhost/api/users/reset-password', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'user-agent': 'vitest' },
  body: JSON.stringify({ user_id: 'target-1', new_password: 'new-password' }),
})

describe('POST /api/users/reset-password', () => {
  beforeEach(() => {
    mocks.authGetUser.mockResolvedValue({ data: { user: { id: 'admin-1', email: 'admin@example.com' } }, error: null })
    mocks.currentProfile = { id: 'admin-1', email: 'admin@example.com', roles: { role_level: 10 } }
    mocks.updateUserById.mockResolvedValue({ error: null })
    mocks.auditInsert.mockResolvedValue({ error: null })
    vi.clearAllMocks()
  })

  it('allows role level 10 and records a password-free audit entry', async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(mocks.updateUserById).toHaveBeenCalledWith('target-1', { password: 'new-password' })
    expect(mocks.auditInsert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'admin-1',
      entity_id: 'target-1',
      action: 'PASSWORD_RESET',
    }))
    expect(JSON.stringify(mocks.auditInsert.mock.calls[0][0])).not.toContain('new-password')
  })

  it.each([1, 20, 30, 40])('returns 403 for direct requests from role level %s', async (roleLevel) => {
    mocks.currentProfile = { id: 'admin-1', email: 'admin@example.com', roles: { role_level: roleLevel } }
    const response = await POST(request())
    expect(response.status).toBe(403)
    expect(mocks.updateUserById).not.toHaveBeenCalled()
  })
})
