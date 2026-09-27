import { describe, expect, it } from 'vitest'
import { decideConsumerShopLink, type ShopLinkActor, type ShopLinkOrganization } from './shop-link'
import { hasLinkedShopProfile, resolveClaimLaneExperience } from '@/lib/engagement/point-claim-settings'

const SHOP_A: ShopLinkOrganization = { id: 'shop-a', org_name: 'Shop A', branch: null, org_type_code: 'SHOP', is_active: true }
const SHOP_B: ShopLinkOrganization = { id: 'shop-b', org_name: 'Shop B', branch: 'Penang', org_type_code: 'SHOP', is_active: true }
const HQ: ShopLinkOrganization = { id: 'hq', org_name: 'HQ', branch: null, org_type_code: 'HQ', is_active: true }

function consumer(overrides: Partial<ShopLinkActor> = {}): ShopLinkActor {
    return { id: 'u1', is_active: true, account_scope: 'store', role_code: 'GUEST', role_level: 50, organization_id: null, ...overrides }
}

function decide(actor: ShopLinkActor | null, target: ShopLinkOrganization | null, current: ShopLinkOrganization | null = null, confirm = false) {
    return decideConsumerShopLink({ actor, target, currentOrganization: current, confirmShopSwitch: confirm })
}

describe('decideConsumerShopLink', () => {
    it('allows a consumer without a shop to link an active SHOP', () => {
        expect(decide(consumer(), SHOP_A)).toEqual({ ok: true, unchanged: false, switching: false })
    })

    it('requires explicit confirmation to switch shops, then allows it', () => {
        const actor = consumer({ organization_id: SHOP_A.id })
        expect(decide(actor, SHOP_B, SHOP_A)).toMatchObject({
            ok: false, status: 409, code: 'SHOP_SWITCH_CONFIRMATION_REQUIRED',
            currentShop: { org_id: 'shop-a' }, requestedShop: { org_id: 'shop-b' },
        })
        expect(decide(actor, SHOP_B, SHOP_A, true)).toEqual({ ok: true, unchanged: false, switching: true })
    })

    it('treats re-selecting the current shop as unchanged', () => {
        expect(decide(consumer({ organization_id: SHOP_A.id }), SHOP_A, SHOP_A)).toEqual({ ok: true, unchanged: true, switching: false })
    })

    it('rejects an inactive shop', () => {
        expect(decide(consumer(), { ...SHOP_A, is_active: false })).toMatchObject({ ok: false, code: 'SHOP_INACTIVE' })
    })

    it.each(['HQ', 'DIST', 'MFG', 'WH', 'END_USER'])('rejects a %s organization as the target', (type) => {
        expect(decide(consumer(), { ...SHOP_A, org_type_code: type })).toMatchObject({ ok: false, code: 'NOT_A_SHOP' })
    })

    it('rejects a missing target', () => {
        expect(decide(consumer(), null)).toMatchObject({ ok: false, code: 'SHOP_NOT_FOUND' })
    })

    it('rejects portal, staff and business identities', () => {
        expect(decide(consumer({ account_scope: 'portal' }), SHOP_A)).toMatchObject({ ok: false, status: 403, code: 'NOT_CONSUMER_ACCOUNT' })
        expect(decide(consumer({ role_code: 'HQ', role_level: 10 }), SHOP_A)).toMatchObject({ ok: false, code: 'NOT_CONSUMER_ACCOUNT' })
        expect(decide(consumer({ role_code: 'USER', role_level: 40 }), SHOP_A)).toMatchObject({ ok: false, code: 'NOT_CONSUMER_ACCOUNT' })
        expect(decide(consumer({ account_scope: null }), SHOP_A)).toMatchObject({ ok: false, code: 'NOT_CONSUMER_ACCOUNT' })
    })

    it('rejects inactive and unknown accounts', () => {
        expect(decide(consumer({ is_active: false }), SHOP_A)).toMatchObject({ ok: false, code: 'ACCOUNT_INACTIVE' })
        expect(decide(null, SHOP_A)).toMatchObject({ ok: false, code: 'PROFILE_NOT_FOUND' })
    })

    it('never moves a profile whose current organization is not a shop, even when confirmed', () => {
        const actor = consumer({ organization_id: HQ.id })
        expect(decide(actor, SHOP_A, HQ, true)).toMatchObject({ ok: false, code: 'CURRENT_ORGANIZATION_NOT_SHOP' })
        expect(decide(consumer({ organization_id: 'gone' }), SHOP_A, null, true)).toMatchObject({ ok: false, code: 'CURRENT_ORGANIZATION_NOT_SHOP' })
    })

    it('keeps the staff/business reassignment guard in force', () => {
        const blocked = decideConsumerShopLink({
            actor: consumer({ organization_id: 'wh-1' }),
            currentOrganization: { id: 'wh-1', org_name: 'WH', branch: null, org_type_code: 'WH', is_active: true },
            target: SHOP_A,
            confirmShopSwitch: true,
        })
        expect(blocked.ok).toBe(false)
    })

    it('a linked shop makes the consumer eligible for the shop points lane', () => {
        const profile = {
            organization_id: SHOP_A.id,
            organizationTypeCode: 'SHOP',
            shop_name: 'Shop A',
            referral_phone: '+60123456789',
            isShopLinkValid: true,
            isReferenceLinkValid: true,
        }
        expect(hasLinkedShopProfile(profile)).toBe(true)
        expect(resolveClaimLaneExperience({ ...profile, claimMode: 'dual' } as any).claimLane).toBeDefined()
    })
})
