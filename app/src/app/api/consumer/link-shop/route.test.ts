/**
 * Consumer shop linking: the dedicated, narrowly authorized replacement for
 * the organization_id write that Phase 0 removed from profile self-service.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createFakeAdminClient } from '@/lib/shop-requests/test-utils/fake-admin-client'

const authGetUser = vi.fn()
const createServerClientMock = vi.fn()
const createAdminClientMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({ createClient: createServerClientMock }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: createAdminClientMock }))

const SHOP_A = { id: 'shop-a', org_name: 'Shop A', branch: null, org_type_code: 'SHOP', is_active: true }
const SHOP_B = { id: 'shop-b', org_name: 'Shop B', branch: 'Penang', org_type_code: 'SHOP', is_active: true }
const SHOP_OFF = { id: 'shop-off', org_name: 'Closed Shop', branch: null, org_type_code: 'SHOP', is_active: false }
const HQ = { id: 'hq-1', org_name: 'HQ', branch: null, org_type_code: 'HQ', is_active: true }
const DIST = { id: 'dist-1', org_name: 'Distributor', branch: null, org_type_code: 'DIST', is_active: true }

function setup(userOverrides: Record<string, any> = {}) {
    const user = {
        id: 'user-1',
        is_active: true,
        account_scope: 'store',
        role_code: 'GUEST',
        organization_id: null,
        shop_name: null,
        ...userOverrides,
    }
    const fake = createFakeAdminClient({
        users: [user],
        roles: [
            { role_code: 'GUEST', role_level: 50 },
            { role_code: 'HQ', role_level: 10 },
            { role_code: 'USER', role_level: 40 },
        ],
        organizations: [{ ...SHOP_A }, { ...SHOP_B }, { ...SHOP_OFF }, { ...HQ }, { ...DIST }],
    })
    createAdminClientMock.mockReturnValue(fake.client)
    return { user, fake }
}

async function post(body: unknown) {
    const { POST } = await import('./route')
    const response = await POST(new Request('http://localhost/api/consumer/link-shop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    }) as any)
    return { status: response.status, body: await response.json() }
}

function writesTo(fake: ReturnType<typeof setup>['fake']) {
    return {
        users: fake.updates.filter((u) => u.table === 'users'),
        other: [
            ...fake.updates.filter((u) => u.table !== 'users').map((u) => u.table),
            ...Object.keys(fake.inserts),
        ],
    }
}

describe('POST /api/consumer/link-shop', () => {
    beforeEach(() => {
        vi.resetModules()
        vi.clearAllMocks()
        createServerClientMock.mockResolvedValue({ auth: { getUser: authGetUser } })
        authGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    })

    it('links a new consumer to an active SHOP and writes only organization_id', async () => {
        const { user, fake } = setup()
        const result = await post({ organization_id: SHOP_A.id })

        expect(result.status).toBe(200)
        expect(result.body).toMatchObject({ success: true, changed: true, switched: false, shop: { org_id: 'shop-a' } })
        expect(user.organization_id).toBe(SHOP_A.id)
        const writes = writesTo(fake)
        expect(writes.users).toHaveLength(1)
        expect(Object.keys(writes.users[0].values).sort()).toEqual(['organization_id', 'updated_at'])
        // Consumer affiliation never touches enterprise access or authority.
        expect(writes.other).toEqual([])
        expect(user.role_code).toBe('GUEST')
        expect(user.account_scope).toBe('store')
    })

    it('requires confirmation to switch SHOP A -> SHOP B, then switches', async () => {
        const { user } = setup({ organization_id: SHOP_A.id })

        const first = await post({ organization_id: SHOP_B.id })
        expect(first.status).toBe(409)
        expect(first.body).toMatchObject({
            success: false,
            code: 'SHOP_SWITCH_CONFIRMATION_REQUIRED',
            requiresShopSwitchConfirmation: true,
            currentShop: { org_id: 'shop-a', org_name: 'Shop A' },
            requestedShop: { org_id: 'shop-b', org_name: 'Shop B' },
        })
        expect(user.organization_id).toBe(SHOP_A.id)

        const confirmed = await post({ organization_id: SHOP_B.id, confirmShopSwitch: true })
        expect(confirmed.status).toBe(200)
        expect(confirmed.body).toMatchObject({ success: true, changed: true, switched: true })
        expect(user.organization_id).toBe(SHOP_B.id)
    })

    it('does not accept a truthy string as switch confirmation', async () => {
        const { user } = setup({ organization_id: SHOP_A.id })
        const result = await post({ organization_id: SHOP_B.id, confirmShopSwitch: 'true' })
        expect(result.status).toBe(409)
        expect(user.organization_id).toBe(SHOP_A.id)
    })

    it('rejects an inactive SHOP', async () => {
        const { user, fake } = setup()
        const result = await post({ organization_id: SHOP_OFF.id })
        expect(result.status).toBe(400)
        expect(result.body.code).toBe('SHOP_INACTIVE')
        expect(user.organization_id).toBeNull()
        expect(writesTo(fake).users).toHaveLength(0)
    })

    it.each([HQ, DIST])('rejects a non-SHOP organization ($org_type_code)', async (org) => {
        const { user } = setup()
        const result = await post({ organization_id: org.id })
        expect(result.status).toBe(400)
        expect(result.body.code).toBe('NOT_A_SHOP')
        expect(user.organization_id).toBeNull()
    })

    it('rejects portal / staff / business identities', async () => {
        const { user: portal } = setup({ account_scope: 'portal', role_code: 'USER', organization_id: null })
        expect((await post({ organization_id: SHOP_A.id })).body.code).toBe('NOT_CONSUMER_ACCOUNT')
        expect(portal.organization_id).toBeNull()

        const { user: hqAdmin } = setup({ account_scope: 'portal', role_code: 'HQ', organization_id: HQ.id })
        const result = await post({ organization_id: SHOP_A.id, confirmShopSwitch: true })
        expect(result.status).toBe(403)
        expect(hqAdmin.organization_id).toBe(HQ.id)
    })

    it('keeps the blocked reassignment guard: a store profile inside HQ is never moved', async () => {
        const { user } = setup({ organization_id: HQ.id })
        const result = await post({ organization_id: SHOP_A.id, confirmShopSwitch: true })
        expect(result.status).toBe(403)
        expect(user.organization_id).toBe(HQ.id)
    })

    it('rejects inactive accounts', async () => {
        const { user } = setup({ is_active: false })
        expect((await post({ organization_id: SHOP_A.id })).body.code).toBe('ACCOUNT_INACTIVE')
        expect(user.organization_id).toBeNull()
    })

    it.each([
        { role_code: 'SA' }, { role_level: 1 }, { account_scope: 'portal' }, { userId: 'someone-else' },
        { is_active: true }, { employment_status: 'active' },
    ])('never accepts authority or actor fields (%o)', async (extra) => {
        const { user, fake } = setup()
        const result = await post({ organization_id: SHOP_A.id, ...extra })
        expect(result.status).toBe(400)
        expect(result.body.code).toBe('UNSUPPORTED_FIELD')
        expect(user.organization_id).toBeNull()
        expect(writesTo(fake).users).toHaveLength(0)
    })

    it('derives the actor from the session only', async () => {
        const { user } = setup()
        authGetUser.mockResolvedValue({ data: { user: null }, error: null })
        expect((await post({ organization_id: SHOP_A.id })).status).toBe(401)
        expect(user.organization_id).toBeNull()
    })

    it('requires a shop', async () => {
        setup()
        expect((await post({})).body.code).toBe('SHOP_REQUIRED')
    })
})
