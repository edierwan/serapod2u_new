/**
 * Phase 0A: profile self-service must never change authorization organization.
 * Shop association now requires a separately authorized administrative/provisioning flow.
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
    fake.client.auth = {
        admin: {
            getUserById: vi.fn(async () => ({ data: { user: { user_metadata: {} } }, error: null })),
            updateUserById: vi.fn(async () => ({ error: null })),
        },
    }
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

describe('POST /api/user/update-profile — protected organization field', () => {
    beforeEach(() => {
        vi.resetModules()
        vi.clearAllMocks()
        createServerClientMock.mockResolvedValue({ auth: { getUser: authGetUser } })
        authGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    })

    it('blocks SHOP A -> SHOP B and writes nothing', async () => {
        const { user, fake } = setup()
        const result = await post({ organization_id: SHOP_B.id, shop_name: 'Vapor Word (Kepala Batas)' })

        expect(result.status).toBe(403)
        expect(result.body).toMatchObject({
            success: false,
            code: 'PROTECTED_PROFILE_FIELD',
        })
        expect(user.organization_id).toBe(SHOP_A.id)
        expect(user.shop_name).toBe(SHOP_A.org_name)
        expect(fake.updates.filter((update) => update.table === 'users')).toHaveLength(0)
    })

    it('rejects legacy confirmation flags rather than treating them as authority', async () => {
        const { user } = setup()
        const result = await post({ organization_id: SHOP_B.id, confirmShopSwitch: 'true' })
        expect(result.status).toBe(403)
        expect(user.organization_id).toBe(SHOP_A.id)
    })

    it('does not allow an explicitly confirmed self-service switch', async () => {
        const { user, fake } = setup()
        const result = await post({
            organization_id: SHOP_B.id,
            shop_name: 'Vapor Word (Kepala Batas)',
            confirmShopSwitch: true,
        })

        expect(result.status).toBe(403)
        expect(result.body.code).toBe('PROTECTED_PROFILE_FIELD')
        expect(user.organization_id).toBe(SHOP_A.id)
        expect(user.shop_name).toBe(SHOP_A.org_name)
        expect(fake.updates.filter((update) => update.table === 'users')).toHaveLength(0)
    })

    it('leaves normal profile field updates unaffected for a SHOP-linked user', async () => {
        const { user } = setup()
        const result = await post({ full_name: 'Tan Kee Wei', address: '752 Jalan Perak' })

        expect(result.status).toBe(200)
        expect(user.full_name).toBe('Tan Kee Wei')
        expect((user as any).address).toBe('752 Jalan Perak')
        expect(user.organization_id).toBe(SHOP_A.id)
    })

    it('rejects re-saving the same organization because the field is protected', async () => {
        const { user } = setup()
        const result = await post({ organization_id: SHOP_A.id, shop_name: SHOP_A.org_name })
        expect(result.status).toBe(403)
        expect(user.organization_id).toBe(SHOP_A.id)
    })

    it('rejects first-time organization linking through profile self-service', async () => {
        const { user } = setup({ organization_id: null, shop_name: null, organizations: null })
        const result = await post({ organization_id: SHOP_B.id, shop_name: 'Vapor Word (Kepala Batas)' })
        expect(result.status).toBe(403)
        expect(user.organization_id).toBeNull()
    })

    it.each([
        { role_code: 'SA' }, { role_level: 1 }, { account_scope: 'portal' }, { is_active: false },
        { employment_status: 'active' }, { employment_type: 'Full-time' }, { department_id: 'dept-1' },
        { manager_user_id: 'user-2' }, { can_be_reference: true },
    ])('keeps authority and employment fields protected (%o)', async (field) => {
        const { user, fake } = setup()
        const result = await post({ full_name: 'Changed', ...field })
        expect(result.status).toBe(403)
        expect(result.body.code).toBe('PROTECTED_PROFILE_FIELD')
        expect(user.full_name).toBe('Tan')
        expect(user.role_code).toBe('GUEST')
        expect(user.account_scope).toBe('store')
        expect(fake.updates.filter((update) => update.table === 'users')).toHaveLength(0)
    })

    it('saves the shop name once the shop was linked through /api/consumer/link-shop', async () => {
        const { user } = setup({ organization_id: SHOP_B.id, organizations: { ...SHOP_B } })
        const result = await post({ shop_name: 'Vapor Word (Kepala Batas)', full_name: 'Tan Kee Wei' })
        expect(result.status).toBe(200)
        expect(user.shop_name).toBe('Vapor Word (Kepala Batas)')
        expect(user.organization_id).toBe(SHOP_B.id)
    })

    it('lets an unlinked consumer with a free-text shop name edit other profile fields', async () => {
        const { user } = setup({ organization_id: null, organizations: null, shop_name: 'Kedai Lama' })
        const result = await post({ full_name: 'Tan Kee Wei', phone: undefined })
        expect(result.status).toBe(200)
        expect(user.full_name).toBe('Tan Kee Wei')
        expect(user.shop_name).toBe('Kedai Lama')
    })
})
