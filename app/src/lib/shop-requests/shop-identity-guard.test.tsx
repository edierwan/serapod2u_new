import { describe, expect, it } from 'vitest'

import {
    assessShopIdentity,
    classifyShopIdentityCandidates,
    decideShopCreation,
    normalizeShopAddressKey,
    shopAddressesEquivalent,
    shopNamesSimilar,
    SHOP_DIFFERENT_OUTLET_CONFIRMATION_CODE,
    SHOP_DUPLICATE_BLOCKED_CODE,
    SHOP_SIMILAR_NAME_WARNING_CODE,
} from './shop-identity-guard'
import { createFakeAdminClient, street24Outlet, VAPORWORLD_EXISTING } from './test-utils/fake-admin-client'

const vaporWordAttempt = {
    shopName: 'Vapor Word (Kepala Batas)',
    contactName: 'Tan Kee Wei',
    contactPhone: '0103659818',
    contactEmail: 'TanKeeWei07@gmail.com ',
    address: '752 , Jalan Perak 13200 Kepala Batas\nPulau Pinang',
    state: 'Pulau Pinang',
}

describe('address normalization', () => {
    it('treats commas, newlines and extra spaces as the same address', () => {
        expect(shopAddressesEquivalent(
            '752 Jalan Perak 13200 Kepala Batas Pulau Pinang',
            '752 , Jalan Perak 13200 Kepala Batas\nPulau Pinang',
        )).toBe(true)
        expect(shopAddressesEquivalent(
            'No. 12, Jln. Mawar 3,  Tmn Mawar,\r\n81100 Johor Bahru',
            'No 12 Jalan Mawar 3 Taman Mawar 81100 Johor Bahru, Malaysia',
        )).toBe(true)
    })

    it('never equates different street or unit numbers', () => {
        expect(shopAddressesEquivalent('No 35 Jalan A', 'No 53 Jalan A')).toBe(false)
        expect(shopAddressesEquivalent('Unit 3-1, Plaza X, 50000 KL', 'Unit 3-2, Plaza X, 50000 KL')).toBe(false)
        expect(shopAddressesEquivalent('Lot 12A Jalan Besar', 'Lot 12B Jalan Besar')).toBe(false)
        expect(normalizeShopAddressKey('Unit 3 - 1 Plaza X')).toBe(normalizeShopAddressKey('Unit 3-1 Plaza X'))
    })

    it('does not treat vague locality-only text as a physical address match', () => {
        expect(shopAddressesEquivalent('Kepala Batas', 'Kepala Batas')).toBe(false)
        expect(shopAddressesEquivalent('', '')).toBe(false)
    })
})

describe('shop name similarity', () => {
    it('recognises spelling variants of the same outlet name', () => {
        expect(shopNamesSimilar({ name: 'Vapor Word (Kepala Batas)' }, { name: 'Vaporworld Kepala Batas' })).toBe(true)
    })

    it('does not treat unrelated names as similar', () => {
        expect(shopNamesSimilar({ name: 'ABC Vape' }, { name: 'Cloud Nine Vapes' })).toBe(false)
    })
})

describe('classifyShopIdentityCandidates + decideShopCreation', () => {
    it('1. hard-blocks the confirmed Vaporworld / Vapor Word duplicate', () => {
        const assessment = classifyShopIdentityCandidates(vaporWordAttempt, [VAPORWORLD_EXISTING])
        expect(assessment.strongConflicts.map((row) => row.org_id)).toEqual(['org-vaporworld'])

        const decision = decideShopCreation(assessment, { confirmDifferentOutlet: true, confirmSimilarName: true })
        expect(decision.allowed).toBe(false)
        if (decision.allowed) return
        expect(decision.status).toBe(409)
        expect(decision.body.code).toBe(SHOP_DUPLICATE_BLOCKED_CODE)
        expect(decision.body.duplicateBlocked).toBe(true)
        expect(decision.body.duplicates[0]).toMatchObject({
            org_id: 'org-vaporworld',
            org_name: 'Vaporworld Kepala Batas',
            address: '752 Jalan Perak 13200 Kepala Batas Pulau Pinang',
            contact_email: 'tankeewei07@gmail.com',
        })
        expect(decision.body.duplicates[0].contact_phone).toContain('365 9818')
    })

    it('blocks same phone + equivalent address even when the name is completely different', () => {
        const assessment = classifyShopIdentityCandidates(
            { ...vaporWordAttempt, shopName: 'Totally New Name', contactEmail: null },
            [VAPORWORLD_EXISTING],
        )
        expect(assessment.strongConflicts).toHaveLength(1)
    })

    it('blocks same email + equivalent address', () => {
        const assessment = classifyShopIdentityCandidates(
            { ...vaporWordAttempt, contactPhone: '0199999999' },
            [VAPORWORLD_EXISTING],
        )
        expect(assessment.strongConflicts).toHaveLength(1)
    })

    it('blocks similar name + equivalent address + same state without contact match', () => {
        const assessment = classifyShopIdentityCandidates(
            { ...vaporWordAttempt, contactPhone: '0199999999', contactEmail: 'other@example.com' },
            [VAPORWORLD_EXISTING],
        )
        expect(assessment.strongConflicts).toHaveLength(1)
    })

    it('2/11. same chain phone+email at a different address requires explicit different-outlet confirmation', () => {
        const existing = [
            street24Outlet('ah', 'AH', 'No 1 Jalan Ampang Hilir 55000 Kuala Lumpur'),
            street24Outlet('bpj', 'BPJ', 'No 8 Jalan BPJ 1 47100 Puchong'),
        ]
        const attempt = {
            shopName: '24 Street Vaperz KK',
            contactName: 'HQ',
            contactPhone: '+60123456789',
            contactEmail: 'hq@24streetvaperz.com',
            address: 'Lot 22 Jalan Kota Kemuning 40460 Shah Alam',
            state: 'Selangor',
        }
        const assessment = classifyShopIdentityCandidates(attempt, existing)
        expect(assessment.strongConflicts).toHaveLength(0)
        expect(assessment.outletCandidates.map((row) => row.org_id).sort()).toEqual(['ah', 'bpj'])

        const unconfirmed = decideShopCreation(assessment, { confirmSimilarName: true })
        expect(unconfirmed.allowed).toBe(false)
        if (!unconfirmed.allowed) {
            expect(unconfirmed.body.code).toBe(SHOP_DIFFERENT_OUTLET_CONFIRMATION_CODE)
            expect(unconfirmed.body.requiresDifferentOutletConfirmation).toBe(true)
        }

        expect(decideShopCreation(assessment, { confirmDifferentOutlet: true }).allowed).toBe(true)
    })

    it('3. same phone only (different name + address) is not hard-blocked', () => {
        const assessment = classifyShopIdentityCandidates(
            {
                shopName: 'Cloud Nine Vapes',
                contactName: 'X',
                contactPhone: '+60103659818',
                address: '10 Jalan Tun Razak 50400 Kuala Lumpur',
            },
            [VAPORWORLD_EXISTING],
        )
        expect(assessment.strongConflicts).toHaveLength(0)
        expect(assessment.outletCandidates).toHaveLength(1)
        expect(decideShopCreation(assessment, { confirmDifferentOutlet: true }).allowed).toBe(true)
    })

    it('4. same email only at a different outlet is not hard-blocked', () => {
        const assessment = classifyShopIdentityCandidates(
            {
                shopName: 'Vaporworld Butterworth',
                contactName: 'X',
                contactPhone: '0111111111',
                contactEmail: 'tankeewei07@gmail.com',
                address: '5 Jalan Raja Uda 12300 Butterworth',
            },
            [VAPORWORLD_EXISTING],
        )
        expect(assessment.strongConflicts).toHaveLength(0)
        expect(assessment.outletCandidates[0].match_reasons).toEqual(['email'])
        expect(decideShopCreation(assessment, { confirmDifferentOutlet: true }).allowed).toBe(true)
    })

    it('5/12. similar name at a different address is only a suggestion (existing confirmCreate flow)', () => {
        const assessment = classifyShopIdentityCandidates(
            {
                shopName: 'Vaporworld',
                contactName: 'X',
                contactPhone: '0111111111',
                address: '5 Jalan Raja Uda 12300 Butterworth',
            },
            [VAPORWORLD_EXISTING],
            { nameSuggestionIds: ['org-vaporworld'] },
        )
        expect(assessment.strongConflicts).toHaveLength(0)
        expect(assessment.outletCandidates).toHaveLength(0)
        expect(assessment.nameSuggestions.map((row) => row.org_id)).toEqual(['org-vaporworld'])

        const decision = decideShopCreation(assessment)
        expect(decision.allowed).toBe(false)
        if (!decision.allowed) {
            expect(decision.body.code).toBe(SHOP_SIMILAR_NAME_WARNING_CODE)
            expect(decision.body.duplicateWarning).toBe(true)
        }
        expect(decideShopCreation(assessment, { confirmSimilarName: true }).allowed).toBe(true)
    })

    it('masks contact details the requester did not supply', () => {
        const assessment = classifyShopIdentityCandidates(
            {
                shopName: 'Vaporworld',
                contactName: 'X',
                contactPhone: '0111111111',
                contactEmail: 'someone@else.com',
            },
            [VAPORWORLD_EXISTING],
            { nameSuggestionIds: ['org-vaporworld'] },
        )
        const [row] = assessment.nameSuggestions
        // Name-only suggestions expose no address or contact details at all.
        expect(row.address).toBeNull()
        expect(row.contact_email).toBeNull()
        expect(row.contact_phone).toBeNull()
    })

    it('masks unmatched contact details on outlet candidates and shows only what the requester typed', () => {
        const phoneOnly = classifyShopIdentityCandidates(
            { shopName: 'Cloud Nine', contactName: 'X', contactPhone: '0103659818', contactEmail: 'me@else.com', address: '1 Jalan Lain 10000 George Town' },
            [VAPORWORLD_EXISTING],
        ).outletCandidates[0]
        expect(phoneOnly.contact_phone).toBe('+60 10-365 9818')
        expect(phoneOnly.contact_email).toBe('ta*********@gmail.com')

        const emailOnly = classifyShopIdentityCandidates(
            { shopName: 'Cloud Nine', contactName: 'X', contactPhone: '0111111111', contactEmail: 'tankeewei07@gmail.com', address: '1 Jalan Lain 10000 George Town' },
            [VAPORWORLD_EXISTING],
        ).outletCandidates[0]
        expect(emailOnly.contact_email).toBe('tankeewei07@gmail.com')
        expect(emailOnly.contact_phone).toBe('+60*****9818')
        expect(JSON.stringify(emailOnly)).not.toContain('103659818')
    })

    it('allows a brand-new shop with no matches', () => {
        const assessment = classifyShopIdentityCandidates(
            { shopName: 'Brand New', contactName: 'X', contactPhone: '0111111111' },
            [],
        )
        expect(decideShopCreation(assessment).allowed).toBe(true)
    })
})

describe('assessShopIdentity (DB candidate lookup)', () => {
    it('finds the Vaporworld record through phone/email/address lookups despite the different name', async () => {
        const { client } = createFakeAdminClient({ organizations: [{ ...VAPORWORLD_EXISTING }] })
        const assessment = await assessShopIdentity(client, vaporWordAttempt)
        expect(assessment.strongConflicts.map((row) => row.org_id)).toEqual(['org-vaporworld'])
    })

    it('matches legacy local-format phone numbers stored on existing shops', async () => {
        const { client } = createFakeAdminClient({
            organizations: [{ ...VAPORWORLD_EXISTING, contact_phone: '0103659818', contact_email: null }],
        })
        const assessment = await assessShopIdentity(client, { ...vaporWordAttempt, contactEmail: null })
        expect(assessment.strongConflicts).toHaveLength(1)
    })

    it('ignores inactive shops', async () => {
        const { client } = createFakeAdminClient({ organizations: [{ ...VAPORWORLD_EXISTING, is_active: false }] })
        const assessment = await assessShopIdentity(client, vaporWordAttempt)
        expect(assessment.strongConflicts).toHaveLength(0)
    })
})
