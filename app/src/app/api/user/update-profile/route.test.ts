import { beforeEach, describe, expect, it, vi } from 'vitest'

const authGetUser = vi.fn()
const userUpdateEq = vi.fn()
const usersUpdate = vi.fn()
const organizationUpdate = vi.fn()
const bankRuleMaybeSingle = vi.fn()
const createServerClientMock = vi.fn()
const createAdminClientMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: createServerClientMock,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: createAdminClientMock,
}))

describe('POST /api/user/update-profile', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    createServerClientMock.mockResolvedValue({
      auth: {
        getUser: authGetUser,
      },
    })

    usersUpdate.mockImplementation(() => ({
      eq: userUpdateEq,
    }))

    createAdminClientMock.mockReturnValue({
      from: (table: string) => {
        if (table === 'msia_banks') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: bankRuleMaybeSingle,
              }),
            }),
          }
        }

        if (table === 'users') {
          return {
            update: usersUpdate,
          }
        }

        if (table === 'organizations') {
          return {
            update: organizationUpdate,
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      },
      auth: {
        admin: {
          updateUserById: vi.fn(),
          listUsers: vi.fn(),
        },
      },
    })
  })

  it('writes personal bank fields to users and does not touch organizations for shop-linked users', async () => {
    authGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
        },
      },
      error: null,
    })

    bankRuleMaybeSingle.mockResolvedValue({
      data: {
        id: 'bank-1',
        short_name: 'Maybank',
        min_account_length: 12,
        max_account_length: 12,
        is_numeric_only: true,
        is_active: true,
      },
      error: null,
    })

    userUpdateEq.mockResolvedValue({ error: null })

    const { POST } = await import('./route')
    const response = await POST(new Request('http://localhost/api/user/update-profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: 'user-1',
        bank_id: 'bank-1',
        bank_account_number: '557175482611',
        bank_account_holder_name: 'Muhammad Safwan Bin Abdullah',
      }),
    }) as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(usersUpdate).toHaveBeenCalledTimes(1)
    expect(usersUpdate.mock.calls[0][0]).toMatchObject({
      bank_id: 'bank-1',
      bank_account_number: '557175482611',
      bank_account_holder_name: 'Muhammad Safwan Bin Abdullah',
    })
    expect(usersUpdate.mock.calls[0][0]).not.toHaveProperty('bank_name')
    expect(organizationUpdate).not.toHaveBeenCalled()
  })
})