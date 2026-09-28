import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const provisionIdentity = vi.fn()
const hrCan = vi.fn()
const usersInsert = vi.fn()

vi.mock('@/lib/identity/provisioning', () => ({ provisionIdentity }))
vi.mock('@/lib/server/hrAccess', () => ({ hrCan }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'hr-1' } }, error: null }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { id: 'u-1', organization_id: 'org-a', roles: { role_level: 20 }, full_name: 'New', email: 'new@x.test' }, error: null }),
        }),
      }),
      insert: usersInsert,
    }),
  })),
}))

const post = (body: Record<string, unknown>) =>
  new NextRequest('http://localhost/api/hr/employees', { method: 'POST', body: JSON.stringify(body) })

describe('POST /api/hr/employees (HR never owns login or identity)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hrCan.mockResolvedValue(true)
  })

  it('provisions through the canonical service with HR authority and employment facts only', async () => {
    provisionIdentity.mockResolvedValue({ ok: true, userId: 'u-1', outcome: 'CREATED', tempPassword: 'Temp-Pass-1234' })
    const { POST } = await import('./route')

    const res = await POST(post({ full_name: 'New', email: 'new@x.test', role_code: 'staff', department_id: 'd-1', join_date: '2026-10-01' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toMatchObject({ outcome: 'CREATED', temp_password: 'Temp-Pass-1234' })
    expect(provisionIdentity).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'hr-1', organizationId: 'org-a', authorizingPermission: 'hr.employee.manage', source: 'hr',
      legacyRoleCode: null, hr: expect.objectContaining({ departmentId: 'd-1', joinDate: '2026-10-01' }),
    }))
  })

  it('never inserts a login-less duplicate user row, even when create_login is false', async () => {
    provisionIdentity.mockResolvedValue({ ok: true, userId: 'u-1', outcome: 'REUSED' })
    const { POST } = await import('./route')

    const res = await POST(post({ full_name: 'Existing', email: 'existing@x.test', create_login: false }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toMatchObject({ outcome: 'REUSED', temp_password: null })
    expect(usersInsert).not.toHaveBeenCalled()
  })

  it('returns the identity conflict instead of creating anything', async () => {
    provisionIdentity.mockResolvedValue({ ok: false, code: 'IDENTITY_CONFLICT', status: 409, message: 'conflict' })
    const { POST } = await import('./route')

    const res = await POST(post({ full_name: 'Dup', email: 'dup@x.test', phone: '0123456789' }))

    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('IDENTITY_CONFLICT')
  })

  it('is refused without HR employee-management authority', async () => {
    hrCan.mockResolvedValue(false)
    const { POST } = await import('./route')

    const res = await POST(post({ full_name: 'X', email: 'x@x.test' }))

    expect(res.status).toBe(403)
    expect(provisionIdentity).not.toHaveBeenCalled()
  })
})
