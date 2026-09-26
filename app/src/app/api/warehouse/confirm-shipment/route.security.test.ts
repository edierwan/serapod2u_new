import { beforeEach, describe, expect, it, vi } from 'vitest'

const authGetUser = vi.fn()
const sessionSingle = vi.fn()
const actorSingle = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: authGetUser } })),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: table === 'qr_validation_reports' ? sessionSingle : actorSingle,
        }),
      }),
    }),
  })),
}))

const request = (body: Record<string, unknown>) => new Request(
  'http://localhost/api/warehouse/confirm-shipment',
  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
)

describe('POST /api/warehouse/confirm-shipment security boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionSingle.mockResolvedValue({
      data: {
        id: 'session-1',
        warehouse_org_id: 'warehouse-1',
        company_id: 'hq-1',
        validation_status: 'approved',
        master_codes_scanned: [],
        unique_codes_scanned: [],
      },
      error: null,
    })
  })

  it('rejects anonymous requests with 401', async () => {
    authGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'missing' } })
    const { POST } = await import('./route')

    const response = await POST(request({ session_id: 'session-1', user_id: 'spoofed-admin' }) as any)
    expect(response.status).toBe(401)
    expect(sessionSingle).not.toHaveBeenCalled()
  })

  it('rejects an authenticated actor from another warehouse', async () => {
    authGetUser.mockResolvedValue({ data: { user: { id: 'real-user' } }, error: null })
    actorSingle.mockResolvedValue({
      data: {
        id: 'real-user', organization_id: 'warehouse-2', is_active: true,
        roles: { role_level: 30 }, organizations: { org_type_code: 'WH' },
      },
      error: null,
    })
    const { POST } = await import('./route')

    const response = await POST(request({ session_id: 'session-1' }) as any)
    expect(response.status).toBe(403)
  })

  it('accepts the authorization boundary for an in-scope warehouse actor', async () => {
    authGetUser.mockResolvedValue({ data: { user: { id: 'real-user' } }, error: null })
    actorSingle.mockResolvedValue({
      data: {
        id: 'real-user', organization_id: 'warehouse-1', is_active: true,
        roles: { role_level: 40 }, organizations: { org_type_code: 'WH' },
      },
      error: null,
    })
    const { POST } = await import('./route')

    // The approved-session response proves authorization passed without executing mutations.
    const response = await POST(request({ session_id: 'session-1', user_id: 'spoofed-admin' }) as any)
    expect(response.status).toBe(400)
    const payload = await response.json()
    expect(payload.error).toContain('already confirmed')
  })
})
