import { beforeEach, describe, expect, it, vi } from 'vitest'

const authGetUser = vi.fn()
const userSingle = vi.fn()
const orgSingle = vi.fn()
const createServerClientMock = vi.fn()
const createSupabaseClientMock = vi.fn()
const resolveWalletContextMock = vi.fn()
const resolveProfileLinkValidationMock = vi.fn()
const getIncompleteProfileMessageMock = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: createSupabaseClientMock,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: createServerClientMock,
}))

vi.mock('@/lib/utils/qr-resolver', () => ({
  resolveMobileConsumerWalletContext: resolveWalletContextMock,
}))

vi.mock('@/lib/engagement/profile-link-validation', () => ({
  resolveProfileLinkValidation: resolveProfileLinkValidationMock,
}))

vi.mock('@/lib/engagement/profile-completion', () => ({
  getIncompleteProfileMessage: getIncompleteProfileMessageMock,
}))

describe('GET /api/user/profile', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.test'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

    createServerClientMock.mockResolvedValue({
      auth: {
        getUser: authGetUser,
      },
    })

    createSupabaseClientMock.mockReturnValue({
      from: (table: string) => {
        if (table === 'users') {
          return {
            select: () => ({
              eq: () => ({
                single: userSingle,
              }),
            }),
          }
        }

        if (table === 'organizations') {
          return {
            select: () => ({
              eq: () => ({
                single: orgSingle,
              }),
            }),
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      },
    })

    resolveProfileLinkValidationMock.mockResolvedValue({
      organizationName: 'Evape',
      referenceDisplayName: 'Ref User',
      referenceUserId: 'ref-1',
      invalidReference: false,
      invalidShop: false,
      isReferenceLinkValid: true,
      isShopLinkValid: true,
      hasShopValue: true,
      hasReferenceValue: true,
    })

    resolveWalletContextMock.mockResolvedValue({
      balance: 6090,
      wallet_scope: 'consumer',
      wallet_owner_user_id: 'user-1',
      wallet_owner_org_id: null,
      reporting_shop_id: 'org-1',
      balance_source: 'consumer_view',
      owner_type: 'user',
      owner_id: 'user-1',
      role_classification_reason: 'mobile_consumer_routes_use_individual_wallet:GUEST:SHOP',
    })

    getIncompleteProfileMessageMock.mockReturnValue('')
  })

  it('returns personal bank details for a shop-linked user', async () => {
    authGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'safwan@example.com',
        },
      },
      error: null,
    })

    userSingle.mockResolvedValue({
      data: {
        id: 'user-1',
        email: 'safwan@example.com',
        full_name: 'Muhammad Safwan Bin Abdullah',
        call_name: 'Safwan',
        avatar_url: null,
        phone: '+60136960042',
        referral_phone: '+60123456789',
        address: 'Somewhere',
        shop_name: 'Evape',
        consumer_claim_confirmed_at: null,
        role_code: 'GUEST',
        organization_id: 'org-1',
        bank_id: 'bank-1',
        bank_account_number: '557175482611',
        bank_account_holder_name: 'Muhammad Safwan Bin Abdullah',
        msia_banks: {
          id: 'bank-1',
          short_name: 'Maybank',
        },
      },
      error: null,
    })

    orgSingle.mockResolvedValue({
      data: {
        org_type_code: 'SHOP',
        org_name: 'Evape',
      },
      error: null,
    })

    const { GET } = await import('./route')
    const response = await GET(new Request('http://localhost/api/user/profile') as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.profile.isShop).toBe(true)
    expect(payload.profile.orgName).toBe('Evape')
    expect(payload.profile.bankId).toBe('bank-1')
    expect(payload.profile.bankName).toBe('Maybank')
    expect(payload.profile.bankAccountNumber).toBe('557175482611')
    expect(payload.profile.bankAccountHolderName).toBe('Muhammad Safwan Bin Abdullah')
  })
})
