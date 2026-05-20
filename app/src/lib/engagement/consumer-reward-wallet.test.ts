import { describe, expect, it } from 'vitest'

import { buildConsumerRewardRedemptionPlan } from './consumer-reward-wallet'

const consumerWallet = {
  balance: 6090,
  wallet_scope: 'consumer' as const,
  owner_type: 'user' as const,
  owner_id: 'user-1',
  wallet_owner_user_id: 'user-1',
  wallet_owner_org_id: null,
  reporting_shop_id: 'shop-1',
  balance_source: 'consumer_view' as const,
  ledger_source: 'consumer_wallet' as const,
  role_classification_reason: 'mobile_consumer_routes_use_individual_wallet:USER:SHOP',
}

describe('consumer-reward-wallet', () => {
  it('plans a shop-linked USER redemption from the individual wallet only', () => {
    const plan = buildConsumerRewardRedemptionPlan({
      wallet: consumerWallet,
      reward: {
        id: 'reward-1',
        itemName: 'RM500 CASH',
        pointsRequired: 5000,
        walletScope: 'consumer',
      },
      user: {
        id: 'user-1',
        phone: '+60164481776',
        email: 'allfan@example.com',
      },
      now: '2026-05-20T00:00:00.000Z',
    })

    expect(plan.success).toBe(true)
    expect(plan.newBalance).toBe(1090)
    expect(plan.transactionInsert).toMatchObject({
      company_id: null,
      wallet_scope: 'consumer',
      wallet_owner_user_id: 'user-1',
      wallet_owner_org_id: null,
      reporting_shop_id: 'shop-1',
      wallet_balance_after: 1090,
      balance_after: 1090,
      point_category: 'redemption',
      point_direction: 'debit',
    })
  })

  it('rejects mobile redemption when the individual wallet is insufficient', () => {
    const plan = buildConsumerRewardRedemptionPlan({
      wallet: {
        ...consumerWallet,
        balance: 100,
      },
      reward: {
        id: 'reward-1',
        itemName: 'RM500 CASH',
        pointsRequired: 5000,
        walletScope: 'consumer',
      },
      user: {
        id: 'user-1',
        phone: '+60164481776',
      },
    })

    expect(plan.success).toBe(false)
    expect(plan.status).toBe(400)
    expect(plan.currentBalance).toBe(100)
    expect(plan.requiredPoints).toBe(5000)
    expect(plan.transactionInsert).toBeUndefined()
  })
})