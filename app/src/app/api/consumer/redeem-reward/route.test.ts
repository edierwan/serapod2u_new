import { beforeEach, describe, expect, it, vi } from 'vitest'

const authGetUser = vi.fn()
const userSingle = vi.fn()
const orgSingle = vi.fn()
const rewardSingle = vi.fn()
const pointsInsertSingle = vi.fn()
const pointsUpdateEq = vi.fn()
const bankMaybeSingle = vi.fn()
const createServerClientMock = vi.fn()
const createSupabaseClientMock = vi.fn()
const resolveWalletContextMock = vi.fn()
const buildConsumerRewardRedemptionPlanMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: createServerClientMock,
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: createSupabaseClientMock,
}))

vi.mock('@/lib/utils/qr-resolver', () => ({
  resolveMobileConsumerWalletContext: resolveWalletContextMock,
}))

vi.mock('@/lib/engagement/consumer-reward-wallet', () => ({
  buildConsumerRewardRedemptionPlan: buildConsumerRewardRedemptionPlanMock,
}))

describe('POST /api/consumer/redeem-reward', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.test'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

    createServerClientMock.mockResolvedValue({
      auth: {
        getUser: authGetUser,
      },
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

        if (table === 'redeem_items') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  single: rewardSingle,
                }),
              }),
            }),
          }
        }

        if (table === 'points_transactions') {
          return {
            insert: () => ({
              select: () => ({
                single: pointsInsertSingle,
              }),
            }),
            update: () => ({
              eq: pointsUpdateEq,
            }),
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      },
    })

    createSupabaseClientMock.mockReturnValue({
      from: (table: string) => {
        if (table === 'msia_banks') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: bankMaybeSingle,
              }),
            }),
          }
        }

        throw new Error(`Unexpected admin table: ${table}`)
      },
    })

    resolveWalletContextMock.mockResolvedValue({
      balance: 6090,
      wallet_scope: 'consumer',
      owner_type: 'user',
      owner_id: 'user-1',
      wallet_owner_user_id: 'user-1',
      wallet_owner_org_id: null,
      reporting_shop_id: 'org-1',
      balance_source: 'consumer_view',
      ledger_source: 'consumer_wallet',
      role_classification_reason: 'mobile_consumer_routes_use_individual_wallet:GUEST:SHOP',
    })

    buildConsumerRewardRedemptionPlanMock.mockReturnValue({
      success: true,
      walletScope: 'consumer',
      walletOwnerUserId: 'user-1',
      walletOwnerOrgId: null,
      reportingShopId: 'org-1',
      balanceSource: 'consumer_view',
      requiredPoints: 5000,
      pointsChange: -5000,
      currentBalance: 6090,
      newBalance: 1090,
      transactionInsert: {
        redeem_item_id: 'reward-1',
        consumer_phone: '+60136960042',
        wallet_scope: 'consumer',
        wallet_owner_user_id: 'user-1',
        wallet_owner_org_id: null,
        reporting_shop_id: 'org-1',
        wallet_balance_after: 1090,
        balance_after: 1090,
      },
    })

    pointsInsertSingle.mockResolvedValue({
      data: {
        id: 'txn-1-abcdef',
      },
      error: null,
    })

    pointsUpdateEq.mockResolvedValue({ error: null })

    orgSingle.mockResolvedValue({
      data: {
        id: 'org-1',
        org_type_code: 'SHOP',
        org_name: 'Evape',
      },
      error: null,
    })

    rewardSingle.mockResolvedValue({
      data: {
        id: 'reward-1',
        item_name: 'RM500 Cashback',
        item_code: 'cashback-rm500',
        category: 'cash',
        point_offer: 5000,
        points_required: 5000,
        wallet_scope: 'consumer',
        stock_quantity: null,
        max_redemptions_per_consumer: null,
        per_user_limit: false,
      },
      error: null,
    })
  })

  it('accepts cashback redemption for a shop-linked guest when the user row has a valid personal bank account', async () => {
    authGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
        },
      },
      error: null,
    })

    userSingle.mockResolvedValue({
      data: {
        id: 'user-1',
        organization_id: 'org-1',
        phone: '+60136960042',
        email: 'safwan@example.com',
        role_code: 'GUEST',
        bank_id: 'bank-1',
        bank_account_number: '557175482611',
      },
      error: null,
    })

    bankMaybeSingle.mockResolvedValue({
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

    const { POST } = await import('./route')
    const response = await POST(new Request('http://localhost/api/consumer/redeem-reward', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        reward_id: 'reward-1',
      }),
    }) as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(pointsInsertSingle).toHaveBeenCalledTimes(1)
  })

  it('rejects cashback redemption when the personal bank_id is missing even if the account number exists', async () => {
    authGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
        },
      },
      error: null,
    })

    userSingle.mockResolvedValue({
      data: {
        id: 'user-1',
        organization_id: 'org-1',
        phone: '+60136960042',
        email: 'safwan@example.com',
        role_code: 'GUEST',
        bank_id: null,
        bank_account_number: '557175482611',
      },
      error: null,
    })

    const { POST } = await import('./route')
    const response = await POST(new Request('http://localhost/api/consumer/redeem-reward', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        reward_id: 'reward-1',
      }),
    }) as any)
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.success).toBe(false)
    expect(payload.error).toBe('Please save a valid personal bank account before redeeming cashback.')
    expect(pointsInsertSingle).not.toHaveBeenCalled()
  })
})
