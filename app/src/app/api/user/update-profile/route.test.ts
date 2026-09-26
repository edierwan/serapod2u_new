import { beforeEach, describe, expect, it, vi } from 'vitest'

const authGetUser = vi.fn()
const userUpdateEq = vi.fn()
const usersUpdate = vi.fn()
const organizationUpdate = vi.fn()
const bankRuleMaybeSingle = vi.fn()
const createServerClientMock = vi.fn()
const createAdminClientMock = vi.fn()
const authGetUserById = vi.fn()
const authUpdateUserById = vi.fn()
const authListUsers = vi.fn()

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
          getUserById: authGetUserById,
          updateUserById: authUpdateUserById,
          listUsers: authListUsers,
        },
      },
    })

    authGetUserById.mockResolvedValue({
      data: { user: { user_metadata: { existing_key: 'keep-me' } } },
      error: null,
    })
    authUpdateUserById.mockResolvedValue({ data: { user: {} }, error: null })
    authListUsers.mockResolvedValue({ data: { users: [] }, error: null })
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

  it('uses the authenticated user when a normal profile client omits userId', async () => {
    authGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    userUpdateEq.mockResolvedValue({ error: null })

    const { POST } = await import('./route')
    const response = await POST(new Request('http://localhost/api/user/update-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: 'Kuala Lumpur' }),
    }) as any)

    expect(response.status).toBe(200)
    expect(userUpdateEq).toHaveBeenCalledWith('id', 'user-1')
  })

  it('updates outdoor_phone as storefront metadata and preserves unrelated metadata', async () => {
    authGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })

    const { POST } = await import('./route')
    const response = await POST(new Request('http://localhost/api/user/update-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'user-1', outdoor_phone: '012-345 6789' }),
    }) as any)

    expect(response.status).toBe(200)
    expect(authUpdateUserById).toHaveBeenCalledWith('user-1', {
      user_metadata: {
        existing_key: 'keep-me',
        outdoor_phone: '+60123456789',
      },
    })
    expect(usersUpdate).not.toHaveBeenCalled()
  })

  it('updates outdoor_location as storefront metadata and preserves unrelated metadata', async () => {
    authGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })

    const { POST } = await import('./route')
    const response = await POST(new Request('http://localhost/api/user/update-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'user-1', outdoor_location: '  Shah Alam  ' }),
    }) as any)

    expect(response.status).toBe(200)
    expect(authUpdateUserById).toHaveBeenCalledWith('user-1', {
      user_metadata: {
        existing_key: 'keep-me',
        outdoor_location: 'Shah Alam',
      },
    })
    expect(usersUpdate).not.toHaveBeenCalled()
  })

  it('preserves existing Auth metadata when updating full_name', async () => {
    authGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    userUpdateEq.mockResolvedValue({ error: null })

    const { POST } = await import('./route')
    const response = await POST(new Request('http://localhost/api/user/update-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'user-1', full_name: 'Updated Name' }),
    }) as any)

    expect(response.status).toBe(200)
    expect(authUpdateUserById).toHaveBeenCalledWith('user-1', {
      user_metadata: {
        existing_key: 'keep-me',
        full_name: 'Updated Name',
      },
    })
  })

  it.each([
    'role_code',
    'organization_id',
    'account_scope',
    'is_active',
    'department_id',
    'manager_user_id',
    'position_id',
    'employment_type',
    'join_date',
    'employment_status',
  ])('rejects protected self-service field %s', async (field) => {
    authGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })

    const { POST } = await import('./route')
    const response = await POST(new Request('http://localhost/api/user/update-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'user-1', [field]: 'attacker-value' }),
    }) as any)
    const payload = await response.json()

    expect(response.status).toBe(403)
    expect(payload.code).toBe('PROTECTED_PROFILE_FIELD')
    expect(usersUpdate).not.toHaveBeenCalled()
  })
})
