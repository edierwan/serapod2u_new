import type { ResolvedWalletContext } from '@/lib/utils/qr-resolver'

export type RewardWalletScope = 'consumer' | 'shop'

export interface ConsumerRewardDefinition {
  id: string
  itemName: string
  category?: string | null
  pointsRequired: number
  pointOffer?: number | null
  pointRewardAmount?: number | null
  walletScope?: RewardWalletScope | null
}

export interface ConsumerRewardUser {
  id: string
  phone?: string | null
  email?: string | null
}

export interface ConsumerRewardTransactionInsert {
  company_id: null
  consumer_phone: string
  consumer_email: string | null
  transaction_type: 'earn' | 'redeem'
  points_amount: number
  balance_after: number
  wallet_scope: 'consumer'
  wallet_owner_user_id: string
  wallet_owner_org_id: null
  reporting_shop_id: string | null
  wallet_balance_after: number
  wallet_source: 'mobile_consumer_reward'
  redeem_item_id: string
  description: string
  transaction_date: string
  fulfillment_status: 'fulfilled' | 'pending'
  redemption_code: string
  user_id: string
  point_category: 'bonus' | 'redemption'
  point_indicator: 'point_reward' | 'physical_reward'
  point_owner_type: 'consumer'
  point_direction: 'earn' | 'debit'
}

export interface ConsumerRewardRedemptionPlan {
  success: boolean
  status: number
  error?: string
  currentBalance: number
  requiredPoints: number
  pointsChange: number
  newBalance: number
  isBonusPoints: boolean
  walletScope: 'consumer'
  walletOwnerUserId: string | null
  walletOwnerOrgId: string | null
  reportingShopId: string | null
  balanceSource: ResolvedWalletContext['balance_source']
  roleClassificationReason: string
  transactionInsert?: ConsumerRewardTransactionInsert
}

export function buildConsumerRewardRedemptionPlan(input: {
  wallet: ResolvedWalletContext
  reward: ConsumerRewardDefinition
  user: ConsumerRewardUser
  now?: string
}): ConsumerRewardRedemptionPlan {
  const rewardWalletScope = input.reward.walletScope || 'consumer'
  const isBonusPoints = input.reward.category === 'point'
  const requiredPoints = isBonusPoints
    ? 0
    : Number(input.reward.pointOffer ?? input.reward.pointsRequired ?? 0)

  if (rewardWalletScope !== 'consumer') {
    return {
      success: false,
      status: 403,
      error: 'Shop wallet rewards are disabled for mobile redemption.',
      currentBalance: input.wallet.balance,
      requiredPoints,
      pointsChange: 0,
      newBalance: input.wallet.balance,
      isBonusPoints,
      walletScope: 'consumer',
      walletOwnerUserId: input.wallet.wallet_owner_user_id,
      walletOwnerOrgId: input.wallet.wallet_owner_org_id,
      reportingShopId: input.wallet.reporting_shop_id,
      balanceSource: input.wallet.balance_source,
      roleClassificationReason: input.wallet.role_classification_reason,
    }
  }

  if (input.wallet.wallet_scope !== 'consumer' || !input.wallet.wallet_owner_user_id) {
    return {
      success: false,
      status: 500,
      error: 'Consumer wallet resolution is invalid for mobile redemption.',
      currentBalance: input.wallet.balance,
      requiredPoints,
      pointsChange: 0,
      newBalance: input.wallet.balance,
      isBonusPoints,
      walletScope: 'consumer',
      walletOwnerUserId: input.wallet.wallet_owner_user_id,
      walletOwnerOrgId: input.wallet.wallet_owner_org_id,
      reportingShopId: input.wallet.reporting_shop_id,
      balanceSource: input.wallet.balance_source,
      roleClassificationReason: input.wallet.role_classification_reason,
    }
  }

  if (!isBonusPoints && input.wallet.balance < requiredPoints) {
    return {
      success: false,
      status: 400,
      error: `Insufficient points. You need ${requiredPoints} points but have ${input.wallet.balance}.`,
      currentBalance: input.wallet.balance,
      requiredPoints,
      pointsChange: 0,
      newBalance: input.wallet.balance,
      isBonusPoints,
      walletScope: 'consumer',
      walletOwnerUserId: input.wallet.wallet_owner_user_id,
      walletOwnerOrgId: input.wallet.wallet_owner_org_id,
      reportingShopId: input.wallet.reporting_shop_id,
      balanceSource: input.wallet.balance_source,
      roleClassificationReason: input.wallet.role_classification_reason,
    }
  }

  const pointRewardAmount = Number(input.reward.pointRewardAmount || 0)
  const pointsChange = isBonusPoints ? pointRewardAmount : -requiredPoints
  const newBalance = input.wallet.balance + pointsChange
  const transactionDate = input.now || new Date().toISOString()
  const redemptionCodePrefix = isBonusPoints ? 'BONUS' : 'RED'
  const tempRedemptionCode = `${redemptionCodePrefix}-${Date.now().toString(36).toUpperCase()}`

  return {
    success: true,
    status: 200,
    currentBalance: input.wallet.balance,
    requiredPoints,
    pointsChange,
    newBalance,
    isBonusPoints,
    walletScope: 'consumer',
    walletOwnerUserId: input.wallet.wallet_owner_user_id,
    walletOwnerOrgId: input.wallet.wallet_owner_org_id,
    reportingShopId: input.wallet.reporting_shop_id,
    balanceSource: input.wallet.balance_source,
    roleClassificationReason: input.wallet.role_classification_reason,
    transactionInsert: {
      company_id: null,
      consumer_phone: input.user.phone || '',
      consumer_email: input.user.email || null,
      transaction_type: isBonusPoints ? 'earn' : 'redeem',
      points_amount: pointsChange,
      balance_after: newBalance,
      wallet_scope: 'consumer',
      wallet_owner_user_id: input.wallet.wallet_owner_user_id,
      wallet_owner_org_id: null,
      reporting_shop_id: input.wallet.reporting_shop_id,
      wallet_balance_after: newBalance,
      wallet_source: 'mobile_consumer_reward',
      redeem_item_id: input.reward.id,
      description: isBonusPoints
        ? `Bonus Points: ${input.reward.itemName}`
        : `Redeemed: ${input.reward.itemName}`,
      transaction_date: transactionDate,
      fulfillment_status: isBonusPoints ? 'fulfilled' : 'pending',
      redemption_code: tempRedemptionCode,
      user_id: input.user.id,
      point_category: isBonusPoints ? 'bonus' : 'redemption',
      point_indicator: isBonusPoints ? 'point_reward' : 'physical_reward',
      point_owner_type: 'consumer',
      point_direction: isBonusPoints ? 'earn' : 'debit',
    },
  }
}