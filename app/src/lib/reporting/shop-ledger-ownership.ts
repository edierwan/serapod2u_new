export interface ShopLedgerOwnershipInput {
  walletScope?: 'consumer' | 'shop' | null
  walletOwnerOrgId?: string | null
  walletOwnerUserId?: string | null
  companyId?: string | null
  derivedShopId?: string | null
  userId?: string | null
}

export interface ResolvedShopLedgerOwnership {
  shopId: string | null
  consumerId: string | null
  source: 'consumer_wallet_isolated' | 'shop_wallet_owner' | 'legacy_company_id' | 'legacy_phone_email_fallback' | 'none'
}

export function resolveShopLedgerOwnership(input: ShopLedgerOwnershipInput): ResolvedShopLedgerOwnership {
  const consumerId = input.walletOwnerUserId || input.userId || null

  if (input.walletScope === 'consumer') {
    return {
      shopId: null,
      consumerId,
      source: 'consumer_wallet_isolated',
    }
  }

  if (input.walletScope === 'shop') {
    return {
      shopId: input.walletOwnerOrgId || input.companyId || null,
      consumerId,
      source: input.walletOwnerOrgId || input.companyId ? 'shop_wallet_owner' : 'none',
    }
  }

  if (input.companyId) {
    return {
      shopId: input.companyId,
      consumerId,
      source: 'legacy_company_id',
    }
  }

  if (input.derivedShopId) {
    return {
      shopId: input.derivedShopId,
      consumerId,
      source: 'legacy_phone_email_fallback',
    }
  }

  return {
    shopId: null,
    consumerId,
    source: 'none',
  }
}