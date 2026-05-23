import { describe, expect, it } from 'vitest'

import { classifyMobileConsumerWallet } from './qr-resolver'

describe('qr-resolver mobile wallet classification', () => {
    it('keeps USER linked to SHOP on the individual consumer wallet for mobile rewards', () => {
        expect(classifyMobileConsumerWallet({
            userId: 'user-1',
            roleCode: 'USER',
            organizationId: 'shop-1',
            organizationTypeCode: 'SHOP',
        })).toEqual({
            wallet_scope: 'consumer',
            owner_type: 'user',
            owner_id: 'user-1',
            wallet_owner_user_id: 'user-1',
            wallet_owner_org_id: null,
            reporting_shop_id: 'shop-1',
            ledger_source: 'consumer_wallet',
            role_classification_reason: 'mobile_consumer_routes_use_individual_wallet:USER:SHOP',
        })
    })

    it('does not attach a reporting shop for independent users', () => {
        expect(classifyMobileConsumerWallet({
            userId: 'user-2',
            roleCode: 'GUEST',
            organizationId: null,
            organizationTypeCode: null,
        }).reporting_shop_id).toBeNull()
    })
})