import { describe, expect, it } from 'vitest'

import { resolveShopLedgerOwnership } from './shop-ledger-ownership'

describe('shop-ledger ownership', () => {
    it('keeps wallet_scope=consumer rows out of the shop wallet even if legacy shop fields exist', () => {
        expect(resolveShopLedgerOwnership({
            walletScope: 'consumer',
            walletOwnerUserId: 'user-1',
            companyId: 'shop-from-company',
            derivedShopId: 'shop-from-phone',
            userId: 'legacy-user-id',
        })).toEqual({
            shopId: null,
            consumerId: 'user-1',
            source: 'consumer_wallet_isolated',
        })
    })

    it('uses explicit wallet_owner_org_id for wallet_scope=shop rows', () => {
        expect(resolveShopLedgerOwnership({
            walletScope: 'shop',
            walletOwnerOrgId: 'shop-explicit',
            companyId: 'shop-legacy',
            userId: 'user-1',
        })).toEqual({
            shopId: 'shop-explicit',
            consumerId: 'user-1',
            source: 'shop_wallet_owner',
        })
    })

    it('preserves company_id and phone/email fallback for legacy rows with wallet_scope null', () => {
        expect(resolveShopLedgerOwnership({
            walletScope: null,
            companyId: null,
            derivedShopId: 'shop-from-phone',
            userId: 'user-1',
        })).toEqual({
            shopId: 'shop-from-phone',
            consumerId: 'user-1',
            source: 'legacy_phone_email_fallback',
        })
    })
})