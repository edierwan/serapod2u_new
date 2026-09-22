/**
 * Regression tests: every self-service SHOP creation path goes through the same
 * shop identity guard, and /api/shops/create never silently re-points
 * users.organization_id from an existing SHOP.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
    createFakeAdminClient,
    DIST_ROW,
    street24Outlet,
    VAPORWORLD_EXISTING,
} from './test-utils/fake-admin-client'

const authGetUser = vi.fn()
const createServerClientMock = vi.fn()
const createAdminClientMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({ createClient: createServerClientMock }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: createAdminClientMock }))
vi.mock('@/lib/server/loyalty-memberships', () => ({
    upsertOrganizationProgramMembership: vi.fn(async () => undefined),
    upsertUserProgramMembership: vi.fn(async () => undefined),
}))
vi.mock('@/lib/notifications/supplyChainEventQueue', () => ({
    queueNotificationEvent: vi.fn(async () => undefined),
}))

const vaporWordForm = {
    shopName: 'Vapor Word (Kepala Batas)',
    contactName: 'Tan Kee Wei',
    contactPhone: '0103659818',
    contactEmail: 'tankeewei07@gmail.com',
    address: '752 , Jalan Perak 13200 Kepala Batas\nPulau Pinang',
    state: 'Pulau Pinang',
}

function jsonRequest(url: string, body: unknown) {
    return new NextRequest(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    })
}

function tanKeeWeiUser(overrides: Record<string, any> = {}) {
    return {
        id: 'user-tan',
        organization_id: null,
        full_name: 'TANKEEWEI',
        phone: '+60103659818',
        email: 'tankeewei07@gmail.com',
        role_code: 'GUEST',
        account_scope: 'store',
        roles: { role_level: 90 },
        organizations: null,
        ...overrides,
    }
}

function verifiedShopContactCode(form: Record<string, any>, extraMeta: Record<string, any> = {}) {
    return {
        id: 'code-1',
        reset_token: 'token-1',
        purpose: 'shop_contact_verification',
        channel: 'email',
        used_at: null,
        invalidated_at: null,
        reset_token_expires: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        phone_normalized: '+60103659818',
        meta: { org_id: 'owner-org', shop_request: form, email: form.contactEmail, ...extraMeta },
    }
}

async function callAuthenticatedCreate(body: Record<string, any>) {
    const { POST } = await import('@/app/api/shops/create/route')
    const response = await POST(jsonRequest('http://localhost/api/shops/create', body))
    return { status: response.status, body: await response.json() }
}

async function callContactVerificationCreate() {
    const { POST } = await import('@/app/api/shops/contact-verification/create/route')
    const response = await POST(jsonRequest('http://localhost/api/shops/contact-verification/create', {
        verificationToken: 'token-1',
    }))
    return { status: response.status, body: await response.json() }
}

describe('shop creation paths share one identity guard', () => {
    beforeEach(() => {
        vi.resetModules()
        vi.clearAllMocks()
        createServerClientMock.mockResolvedValue({ auth: { getUser: authGetUser } })
        authGetUser.mockResolvedValue({ data: { user: { id: 'user-tan', email: 'tankeewei07@gmail.com' } }, error: null })
    })

    it('1/8. QR contact-verification path and authenticated /api/shops/create return the same strong conflict', async () => {
        const authed = createFakeAdminClient({
            organizations: [{ ...VAPORWORLD_EXISTING }, { ...DIST_ROW }],
            users: [tanKeeWeiUser()],
        })
        createAdminClientMock.mockReturnValue(authed.client)
        // Even with every confirmation flag set, a strong duplicate cannot be overridden.
        const authedResult = await callAuthenticatedCreate({
            ...vaporWordForm,
            confirmCreate: true,
            confirmDifferentOutlet: true,
        })

        const qr = createFakeAdminClient({
            organizations: [{ ...VAPORWORLD_EXISTING }, { ...DIST_ROW }],
            auth_verification_codes: [verifiedShopContactCode(vaporWordForm, {
                identity_confirmations: { confirmDifferentOutlet: true },
            })],
        })
        createAdminClientMock.mockReturnValue(qr.client)
        const qrResult = await callContactVerificationCreate()

        expect(authedResult.status).toBe(409)
        expect(qrResult.status).toBe(409)
        expect(authedResult.body.code).toBe('SHOP_DUPLICATE_BLOCKED')
        expect(qrResult.body).toEqual(authedResult.body)
        expect(authedResult.body.duplicates[0].org_id).toBe('org-vaporworld')

        expect(authed.inserts.organizations).toBeUndefined()
        expect(qr.inserts.organizations).toBeUndefined()
    })

    it('2. a duplicate conflict releases the claim — the verification session is NOT consumed', async () => {
        const code = verifiedShopContactCode(vaporWordForm)
        const qr = createFakeAdminClient({
            organizations: [{ ...VAPORWORLD_EXISTING }, { ...DIST_ROW }],
            auth_verification_codes: [code],
        })
        createAdminClientMock.mockReturnValue(qr.client)

        const blocked = await callContactVerificationCreate()
        expect(blocked.status).toBe(409)
        expect(blocked.body.code).toBe('SHOP_DUPLICATE_BLOCKED')
        expect(code.used_at).toBeNull()

        // Token is still a live verified session (not burned by the blocked attempt).
        const { findVerifiedShopContactCode } = await import('@/server/auth/shopContactVerificationService')
        expect(await findVerifiedShopContactCode(qr.client, 'token-1')).toMatchObject({ id: 'code-1' })

        // Replaying it is harmless: still blocked, still nothing inserted, still not consumed.
        const replay = await callContactVerificationCreate()
        expect(replay.body.code).toBe('SHOP_DUPLICATE_BLOCKED')
        expect(code.used_at).toBeNull()
        expect(qr.inserts.organizations).toBeUndefined()
    })

    it('1. concurrent requests with the same verification token create exactly one shop', async () => {
        const form = {
            shopName: 'Brand New Vape Hub',
            contactName: 'X',
            contactPhone: '0111111111',
            contactEmail: 'new@hub.com',
            address: '9 Jalan Baru 13000 Butterworth',
        }
        const code = verifiedShopContactCode(form)
        const qr = createFakeAdminClient({
            organizations: [{ ...DIST_ROW }],
            auth_verification_codes: [code],
        })
        createAdminClientMock.mockReturnValue(qr.client)

        const results = await Promise.all([
            callContactVerificationCreate(),
            callContactVerificationCreate(),
            callContactVerificationCreate(),
        ])

        const statuses = results.map((result) => result.status).sort()
        expect(statuses).toEqual([200, 409, 409])
        expect(results.filter((result) => result.status === 409).every(
            (result) => result.body.code === 'SHOP_VERIFICATION_ALREADY_USED',
        )).toBe(true)
        expect(qr.inserts.organizations).toHaveLength(1)
        expect(code.used_at).not.toBeNull()
    })

    it('claim only succeeds for an unused, non-invalidated, unexpired token; release never re-opens another claim', async () => {
        const { claimVerifiedShopContactCode, releaseShopContactCodeClaim } = await import('@/server/auth/shopContactVerificationService')
        const used = { ...verifiedShopContactCode(vaporWordForm), id: 'used', used_at: '2026-01-01T00:00:00.000Z' }
        const invalidated = { ...verifiedShopContactCode(vaporWordForm), id: 'inv', invalidated_at: '2026-01-01T00:00:00.000Z' }
        const expired = { ...verifiedShopContactCode(vaporWordForm), id: 'exp', reset_token_expires: '2020-01-01T00:00:00.000Z' }
        const wrongToken = { ...verifiedShopContactCode(vaporWordForm), id: 'tok' }
        const live = verifiedShopContactCode(vaporWordForm)
        const fake = createFakeAdminClient({ auth_verification_codes: [used, invalidated, expired, wrongToken, live] })

        expect(await claimVerifiedShopContactCode(fake.client, used)).toBeNull()
        expect(await claimVerifiedShopContactCode(fake.client, invalidated)).toBeNull()
        expect(await claimVerifiedShopContactCode(fake.client, expired)).toBeNull()
        expect(await claimVerifiedShopContactCode(fake.client, { id: 'tok', reset_token: 'other-token' })).toBeNull()

        const claimedAt = await claimVerifiedShopContactCode(fake.client, live)
        expect(claimedAt).toBeTruthy()
        expect(await claimVerifiedShopContactCode(fake.client, live)).toBeNull()

        // A release with someone else's timestamp is a no-op.
        await releaseShopContactCodeClaim(fake.client, live.id, '1999-01-01T00:00:00.000Z')
        expect(live.used_at).toBe(claimedAt)
        await releaseShopContactCodeClaim(fake.client, used.id, claimedAt as string)
        expect(used.used_at).toBe('2026-01-01T00:00:00.000Z')

        await releaseShopContactCodeClaim(fake.client, live.id, claimedAt as string)
        expect(live.used_at).toBeNull()
    })

    it('2/11. legitimate chain outlet: blocked until the user confirms a different outlet, then created', async () => {
        const chain = [
            street24Outlet('ah', 'AH', 'No 1 Jalan Ampang Hilir 55000 Kuala Lumpur'),
            street24Outlet('bpj', 'BPJ', 'No 8 Jalan BPJ 1 47100 Puchong'),
        ]
        const form = {
            shopName: '24 Street Vaperz GC',
            contactName: 'HQ',
            contactPhone: '0123456789',
            contactEmail: 'hq@24streetvaperz.com',
            address: 'Lot 3 Jalan Gombak Central 53100 Gombak',
            state: 'Selangor',
        }
        const fake = createFakeAdminClient({
            organizations: [...chain, { ...DIST_ROW }],
            users: [tanKeeWeiUser()],
        })
        createAdminClientMock.mockReturnValue(fake.client)

        const first = await callAuthenticatedCreate({ ...form, confirmCreate: true })
        expect(first.status).toBe(409)
        expect(first.body.code).toBe('SHOP_DIFFERENT_OUTLET_CONFIRMATION_REQUIRED')
        expect(first.body.duplicates.map((row: any) => row.org_id).sort()).toEqual(['ah', 'bpj'])
        expect(fake.inserts.organizations).toBeUndefined()

        const second = await callAuthenticatedCreate({ ...form, confirmDifferentOutlet: true })
        expect(second.status).toBe(200)
        expect(second.body.success).toBe(true)
        expect(fake.inserts.organizations).toHaveLength(1)
        expect(fake.inserts.organizations[0]).toMatchObject({ org_name: '24 Street Vaperz GC', contact_phone: '+60123456789' })
    })

    it('QR path replays the stored different-outlet confirmation for chain outlets', async () => {
        const form = {
            shopName: '24 Street Vaperz KK',
            contactName: 'HQ',
            contactPhone: '0123456789',
            contactEmail: 'hq@24streetvaperz.com',
            address: 'Lot 22 Jalan Kota Kemuning 40460 Shah Alam',
            state: 'Selangor',
        }
        const unconfirmed = createFakeAdminClient({
            organizations: [street24Outlet('ah', 'AH', 'No 1 Jalan Ampang Hilir 55000 Kuala Lumpur'), { ...DIST_ROW }],
            auth_verification_codes: [verifiedShopContactCode(form)],
        })
        createAdminClientMock.mockReturnValue(unconfirmed.client)
        const blocked = await callContactVerificationCreate()
        expect(blocked.status).toBe(409)
        expect(blocked.body.code).toBe('SHOP_DIFFERENT_OUTLET_CONFIRMATION_REQUIRED')

        const confirmed = createFakeAdminClient({
            organizations: [street24Outlet('ah', 'AH', 'No 1 Jalan Ampang Hilir 55000 Kuala Lumpur'), { ...DIST_ROW }],
            auth_verification_codes: [verifiedShopContactCode(form, { identity_confirmations: { confirmDifferentOutlet: true } })],
        })
        createAdminClientMock.mockReturnValue(confirmed.client)
        const created = await callContactVerificationCreate()
        expect(created.status).toBe(200)
        expect(confirmed.inserts.organizations).toHaveLength(1)
        // Code is consumed, so a replayed token cannot create a second shop.
        const replay = await callContactVerificationCreate()
        expect(replay.body.success).toBe(false)
        expect(confirmed.inserts.organizations).toHaveLength(1)
    })

    it('12. authenticated create keeps the existing similar-name confirmCreate flow', async () => {
        const fake = createFakeAdminClient({
            organizations: [{ ...VAPORWORLD_EXISTING }, { ...DIST_ROW }],
            users: [tanKeeWeiUser()],
        })
        createAdminClientMock.mockReturnValue(fake.client)
        const form = {
            shopName: 'Vaporworld',
            contactName: 'X',
            contactPhone: '0111111111',
            address: '5 Jalan Raja Uda 12300 Butterworth',
        }

        const warned = await callAuthenticatedCreate(form)
        expect(warned.status).toBe(409)
        expect(warned.body.duplicateWarning).toBe(true)
        expect(warned.body.code).toBe('SHOP_SIMILAR_NAME_WARNING')

        const created = await callAuthenticatedCreate({ ...form, confirmCreate: true })
        expect(created.status).toBe(200)
        expect(fake.inserts.organizations).toHaveLength(1)
    })

    it('10. user linked to SHOP A creating SHOP B is not silently re-linked', async () => {
        const shopA = { ...VAPORWORLD_EXISTING }
        const user = tanKeeWeiUser({
            organization_id: shopA.id,
            organizations: { id: shopA.id, org_name: shopA.org_name, branch: null, org_type_code: 'SHOP' },
        })
        const fake = createFakeAdminClient({ organizations: [shopA, { ...DIST_ROW }], users: [user] })
        createAdminClientMock.mockReturnValue(fake.client)
        const shopB = {
            shopName: 'Brand New Vape Hub',
            contactName: 'X',
            contactPhone: '0111111111',
            address: '9 Jalan Baru 13000 Butterworth',
        }

        // linkUser without explicit switch confirmation → refused before anything is created.
        const refused = await callAuthenticatedCreate({ ...shopB, linkUser: true })
        expect(refused.status).toBe(409)
        expect(refused.body.code).toBe('SHOP_LINK_SWITCH_CONFIRMATION_REQUIRED')
        expect(refused.body.currentShop.org_id).toBe(shopA.id)
        expect(fake.inserts.organizations).toBeUndefined()
        expect(user.organization_id).toBe(shopA.id)

        // Default (no linkUser) creates the shop but leaves the user's organization untouched.
        const created = await callAuthenticatedCreate(shopB)
        expect(created.status).toBe(200)
        expect(fake.inserts.organizations).toHaveLength(1)
        expect(user.organization_id).toBe(shopA.id)
        expect(fake.updates.filter((update) => update.table === 'users')).toHaveLength(0)
    })

    it('10b. explicit confirmSwitchLinkedShop is the only way to move a SHOP-linked user', async () => {
        const shopA = { ...VAPORWORLD_EXISTING }
        const user = tanKeeWeiUser({
            organization_id: shopA.id,
            organizations: { id: shopA.id, org_name: shopA.org_name, branch: null, org_type_code: 'SHOP' },
        })
        const fake = createFakeAdminClient({ organizations: [shopA, { ...DIST_ROW }], users: [user] })
        createAdminClientMock.mockReturnValue(fake.client)

        const result = await callAuthenticatedCreate({
            shopName: 'Brand New Vape Hub',
            contactName: 'X',
            contactPhone: '0111111111',
            address: '9 Jalan Baru 13000 Butterworth',
            linkUser: true,
            confirmSwitchLinkedShop: true,
        })
        expect(result.status).toBe(200)
        expect(user.organization_id).toBe(result.body.organization.id)
    })
})

describe('createShopOrganization enforces the guard for every caller (incl. registration pending-shop)', () => {
    beforeEach(() => {
        vi.resetModules()
        vi.clearAllMocks()
    })

    it('9. throws a ShopIdentityConflictError and inserts nothing for a strong duplicate', async () => {
        const { createShopOrganization } = await import('./create-shop')
        const { isShopIdentityConflictError } = await import('./shop-identity-guard')
        const fake = createFakeAdminClient({ organizations: [{ ...VAPORWORLD_EXISTING }, { ...DIST_ROW }] })

        const error = await createShopOrganization(fake.client, {
            form: vaporWordForm,
            createdBy: 'new-user',
            // Same confirmations the registration pending-shop path passes.
            identityConfirmations: { confirmDifferentOutlet: false, confirmSimilarName: true },
        }).catch((caught) => caught)

        expect(isShopIdentityConflictError(error)).toBe(true)
        expect(error.decision.body.code).toBe('SHOP_DUPLICATE_BLOCKED')
        expect(fake.inserts.organizations).toBeUndefined()
    })

    it('9b. registration pending-shop cannot silently create an outlet that shares contacts', async () => {
        const { createShopOrganization } = await import('./create-shop')
        const fake = createFakeAdminClient({
            organizations: [street24Outlet('ah', 'AH', 'No 1 Jalan Ampang Hilir 55000 Kuala Lumpur'), { ...DIST_ROW }],
        })

        await expect(createShopOrganization(fake.client, {
            form: {
                shopName: '24 Street Vaperz KK',
                contactName: 'HQ',
                contactPhone: '0123456789',
                address: 'Lot 22 Jalan Kota Kemuning 40460 Shah Alam',
            },
            identityConfirmations: { confirmDifferentOutlet: false, confirmSimilarName: true },
        })).rejects.toThrow(/different outlet/i)
        expect(fake.inserts.organizations).toBeUndefined()
    })
})
