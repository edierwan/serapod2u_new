/**
 * update-profile must never silently move a SHOP-linked user to a different SHOP.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createFakeAdminClient } from '@/lib/shop-requests/test-utils/fake-admin-client'

const authGetUser = vi.fn()
const createServerClientMock = vi.fn()
const createAdminClientMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({ createClient: createServerClientMock }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: createAdminClientMock }))
vi.mock('@/lib/engagement/profile-link-validation', () => ({
    resolveProfileLinkValidation: vi.fn(async () => ({
        isShopLinkValid: true,
        isReferenceLinkValid: true,
        invalidShop: false,
        invalidReference: false,
    })),
}))

const SHOP_A = { id: 'shop-a', org_name: 'Vaporworld Kepala Batas', branch: null, org_type_code: 'SHOP', is_active: true }
const SHOP_B = { id: 'shop-b', org_name: 'Vapor Word', branch: 'Kepala Batas', org_type_code: 'SHOP', is_active: true }

function setup(userOverrides: Record<string, any> = {}) {
    const user = {
        id: 'user-1',
        organization_id: SHOP_A.id,
        shop_name: SHOP_A.org_name,
        referral_phone: null,
        full_name: 'Tan',
        role_code: 'GUEST',
        account_scope: 'store',
        roles: { role_level: 90 },
        organizations: { ...SHOP_A },
        ...userOverrides,
    }
    const fake = createFakeAdminClient({ users: [user], organizations: [{ ...SHOP_A }, { ...SHOP_B }] })
    fake.client.auth = { admin: { updateUserById: vi.fn(async () => ({ error: null })) } }
    createAdminClientMock.mockReturnValue(fake.client)
    return { user, fake }
}

async function post(body: Record<string, any>) {
    const { POST } = await import('./route')
    const response = await POST(new Request('http://localhost/api/user/update-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'user-1', ...body }),
    }) as any)
    return { status: response.status, body: await response.json() }
}

describe('POST /api/user/update-profile — SHOP switching', () => {
    beforeEach(() => {
        vi.resetModules()
        vi.clearAllMocks()
        createServerClientMock.mockResolvedValue({ auth: { getUser: authGetUser } })
        authGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    })

    it('blocks SHOP A -> SHOP B without explicit confirmation (structured 409, nothing written)', async () => {
        const { user, fake } = setup()
        const result = await post({ organization_id: SHOP_B.id, shop_name: 'Vapor Word (Kepala Batas)' })

        expect(result.status).toBe(409)
        expect(result.body).toMatchObject({
            success: false,
            code: 'SHOP_SWITCH_CONFIRMATION_REQUIRED',
            requiresShopSwitchConfirmation: true,
            currentShop: { org_id: 'shop-a', org_name: 'Vaporworld Kepala Batas' },
            requestedShop: { org_id: 'shop-b', org_name: 'Vapor Word' },
        })
        expect(user.organization_id).toBe(SHOP_A.id)
        expect(user.shop_name).toBe(SHOP_A.org_name)
        expect(fake.updates.filter((update) => update.table === 'users')).toHaveLength(0)
    })

    it('treats a non-true confirm flag as no confirmation', async () => {
        const { user } = setup()
        const result = await post({ organization_id: SHOP_B.id, confirmShopSwitch: 'true' })
        expect(result.status).toBe(409)
        expect(user.organization_id).toBe(SHOP_A.id)
    })

    it('allows an explicitly confirmed SHOP A -> SHOP B switch', async () => {
        const { user } = setup()
        const result = await post({
            organization_id: SHOP_B.id,
            shop_name: 'Vapor Word (Kepala Batas)',
            confirmShopSwitch: true,
        })

        expect(result.status).toBe(200)
        expect(result.body.success).toBe(true)
        expect(user.organization_id).toBe(SHOP_B.id)
        expect(user.shop_name).toBe('Vapor Word (Kepala Batas)')
    })

    it('leaves normal profile field updates unaffected for a SHOP-linked user', async () => {
        const { user } = setup()
        const result = await post({ full_name: 'Tan Kee Wei', address: '752 Jalan Perak' })

        expect(result.status).toBe(200)
        expect(user.full_name).toBe('Tan Kee Wei')
        expect((user as any).address).toBe('752 Jalan Perak')
        expect(user.organization_id).toBe(SHOP_A.id)
    })

    it('re-saving the same SHOP needs no confirmation', async () => {
        const { user } = setup()
        const result = await post({ organization_id: SHOP_A.id, shop_name: SHOP_A.org_name })
        expect(result.status).toBe(200)
        expect(user.organization_id).toBe(SHOP_A.id)
    })

    it('first-time link (user not yet on any SHOP) needs no confirmation', async () => {
        const { user } = setup({ organization_id: null, shop_name: null, organizations: null })
        const result = await post({ organization_id: SHOP_B.id, shop_name: 'Vapor Word (Kepala Batas)' })
        expect(result.status).toBe(200)
        expect(user.organization_id).toBe(SHOP_B.id)
    })
})
