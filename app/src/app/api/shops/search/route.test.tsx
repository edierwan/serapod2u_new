import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createFakeAdminClient } from '@/lib/shop-requests/test-utils/fake-admin-client'

const createAdminClientMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: createAdminClientMock }))

const SHOPS = [
    {
        id: 'shop-1',
        org_name: 'Vaporworld Kepala Batas',
        org_type_code: 'SHOP',
        is_active: true,
        branch: 'Kepala Batas',
        contact_name: 'Tan Kee Wei',
        contact_phone: '+60103659818',
        contact_email: 'tankeewei07@gmail.com',
        address: '752 Jalan Perak 13200 Kepala Batas',
        states: { state_name: 'Pulau Pinang' },
    },
    {
        id: 'shop-2',
        org_name: 'Vaporworld Butterworth',
        org_type_code: 'SHOP',
        is_active: true,
        branch: null,
        contact_name: 'Ali',
        contact_phone: null,
        states: null,
    },
    {
        id: 'shop-inactive',
        org_name: 'Vaporworld Old',
        org_type_code: 'SHOP',
        is_active: false,
        contact_phone: '+60111111111',
    },
]

async function search(q: string) {
    const { GET } = await import('./route')
    const response = await GET(new NextRequest(`http://localhost/api/shops/search?q=${encodeURIComponent(q)}`))
    return { status: response.status, body: await response.json() }
}

describe('GET /api/shops/search (public)', () => {
    beforeEach(() => {
        vi.resetModules()
        createAdminClientMock.mockReturnValue(createFakeAdminClient({ organizations: SHOPS.map((row) => ({ ...row })) }).client)
    })

    it('never returns contact_name or the full contact_phone', async () => {
        const { status, body } = await search('Vaporworld')
        expect(status).toBe(200)
        const serialized = JSON.stringify(body)

        expect(serialized).not.toContain('Tan Kee Wei')
        expect(serialized).not.toContain('103659818')
        expect(serialized).not.toContain('tankeewei07')
        expect(serialized).not.toContain('Jalan Perak')
        for (const row of body.results) {
            expect(row).not.toHaveProperty('contact_name')
            expect(row).not.toHaveProperty('contact_phone')
        }
        expect(body.results[0].contact_phone_masked).toBe('+60*****9818')
        expect(body.results[1].contact_phone_masked).toBeNull()
    })

    it('still returns org id, name, branch, state and display label for active shops', async () => {
        const { body } = await search('vaporworld')
        expect(body.results).toEqual([
            {
                org_id: 'shop-1',
                org_name: 'Vaporworld Kepala Batas',
                branch: 'Kepala Batas',
                state_name: 'Pulau Pinang',
                display_label: 'Vaporworld Kepala Batas (Kepala Batas)',
                contact_phone_masked: '+60*****9818',
            },
            {
                org_id: 'shop-2',
                org_name: 'Vaporworld Butterworth',
                branch: null,
                state_name: null,
                display_label: 'Vaporworld Butterworth',
                contact_phone_masked: null,
            },
        ])
    })

    it('returns no results for an empty query', async () => {
        const { body } = await search('   ')
        expect(body).toEqual({ success: true, results: [] })
    })
})
