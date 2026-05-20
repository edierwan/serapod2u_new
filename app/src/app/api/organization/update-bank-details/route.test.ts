import { beforeEach, describe, expect, it, vi } from 'vitest'

const authGetUser = vi.fn()
const userRoleSingle = vi.fn()
const orgUpdateEq = vi.fn()
const organizationsUpdate = vi.fn()
const createServerClientMock = vi.fn()
const createAdminClientMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: createServerClientMock,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: createAdminClientMock,
}))

describe('POST /api/organization/update-bank-details', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    createServerClientMock.mockResolvedValue({
      auth: {
        getUser: authGetUser,
      },
      from: (table: string) => {
        if (table === 'users') {
          return {
            select: () => ({
              eq: () => ({
                single: userRoleSingle,
              }),
            }),
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      },
    })

    organizationsUpdate.mockImplementation(() => ({
      eq: orgUpdateEq,
    }))

    createAdminClientMock.mockReturnValue({
      from: (table: string) => {
        if (table === 'organizations') {
          return {
            update: organizationsUpdate,
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      },
    })
  })

  it('keeps organization bank updates writing organizations.bank_id', async () => {
    authGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'admin-1',
        },
      },
      error: null,
    })

    userRoleSingle.mockResolvedValue({
      data: {
        role_code: 'SUPERADMIN',
        roles: {
          role_level: 10,
        },
      },
      error: null,
    })

    orgUpdateEq.mockResolvedValue({ error: null })

    const { POST } = await import('./route')
    const response = await POST(new Request('http://localhost/api/organization/update-bank-details', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        organizationId: 'org-1',
        bankId: 'bank-1',
        bankAccountNumber: '557175482611',
        bankAccountHolderName: 'Evape Sdn Bhd',
      }),
    }) as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(organizationsUpdate).toHaveBeenCalledWith({
      bank_id: 'bank-1',
      bank_account_number: '557175482611',
      bank_account_holder_name: 'Evape Sdn Bhd',
    })
  })
})
