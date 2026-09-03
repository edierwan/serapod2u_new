import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Production regression (2026-08-20): the route looked up shop names with a single
 * `.in('id', shopOrgIds)`. With 279 shop organizations PostgREST built an 11,000-character
 * URL and the gateway answered 414 "URI too long", so the whole endpoint 500'd and the
 * Shop Staff Performance tab rendered "No shop staff found" for every user.
 */

// nginx/Kong reject a request line over 8 KB; stay well under it.
const URI_LIMIT = 8000

const mocks = vi.hoisted(() => ({
    users: [] as any[],
    organizations: [] as any[],
    scans: [] as any[],
    transactions: [] as any[],
    inFilterSizes: [] as Array<{ table: string; column: string; count: number; uriLength: number }>,
}))

function rowsFor(table: string) {
    if (table === 'organizations') return mocks.organizations
    if (table === 'users') return mocks.users
    if (table === 'consumer_qr_scans') return mocks.scans
    if (table === 'points_transactions') return mocks.transactions
    return []
}

/** Mimics the PostgREST query string supabase-js would generate for `column=in.(...)`. */
function uriLengthFor(table: string, column: string, values: string[]) {
    const base = `https://example.supabase.co/rest/v1/${table}?select=*&${column}=in.(`
    return base.length + values.map((value) => `%22${value}%22`).join(',').length + 1
}

function builder(table: string) {
    let rows: any[] = rowsFor(table)
    let count: number | null = rows.length

    const chain: any = {
        select: (_columns?: string, options?: any) => {
            if (options?.count === 'exact') count = rows.length
            return chain
        },
        eq: (column: string, value: any) => {
            rows = rows.filter((row) => row[column] === value)
            return chain
        },
        order: () => chain,
        range: (from: number, to: number) => {
            rows = rows.slice(from, to + 1)
            return chain
        },
        or: () => chain,
        in: (column: string, values: string[]) => {
            mocks.inFilterSizes.push({
                table,
                column,
                count: values.length,
                uriLength: uriLengthFor(table, column, values),
            })
            rows = rows.filter((row) => values.includes(row[column]))
            return chain
        },
        single: async () => ({ data: rows[0] ?? null, error: null }),
        then: (resolve: (value: any) => void) => resolve({ data: rows, error: null, count }),
    }

    return chain
}

vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: 'admin-1' } }, error: null }) },
    }),
}))

vi.mock('@supabase/supabase-js', () => ({
    createClient: () => ({
        from: (table: string) => {
            if (table === 'users') {
                const chain = builder('users')
                const originalSingle = chain.single
                chain.single = async () => {
                    const profile = mocks.users.find((row) => row.id === 'admin-1')
                    return profile ? { data: profile, error: null } : originalSingle()
                }
                return chain
            }
            return builder(table)
        },
    }),
}))

import { GET } from './route'

const SHOP_ORG_COUNT = 279

beforeEach(() => {
    mocks.inFilterSizes = []
    mocks.scans = []
    mocks.transactions = []

    mocks.organizations = Array.from({ length: SHOP_ORG_COUNT }, (_, index) => ({
        id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
        org_name: `Shop ${index}`,
        org_type_code: 'SHOP',
        is_active: true,
        state_id: 'state-1',
        states: { state_name: 'Selangor' },
    }))

    mocks.users = [
        { id: 'admin-1', role_code: 'SA', organization_id: null, phone: null, referral_phone: null, full_name: 'Super Admin', email: 'admin@example.com', is_active: true, created_at: '2026-01-01', roles: { role_level: 1 } },
        ...mocks.organizations.map((org, index) => ({
            id: `staff-${index}`,
            email: `staff${index}@example.com`,
            full_name: `Staff ${index}`,
            phone: `+6011700007${String(index).padStart(2, '0')}`,
            referral_phone: null,
            is_active: true,
            role_code: 'GUEST',
            organization_id: org.id,
            created_at: '2026-01-01',
            roles: { role_level: 999 },
        })),
    ]
})

describe('shop staff performance id filters', () => {
    it('never puts enough ids in one request to trip the gateway URI limit', async () => {
        const response = await GET({} as any)

        expect(response.status).toBe(200)
        expect(mocks.inFilterSizes.length).toBeGreaterThan(0)

        const worst = Math.max(...mocks.inFilterSizes.map((entry) => entry.uriLength))
        expect(worst).toBeLessThan(URI_LIMIT)
    })

    it('returns every shop staff row with its shop resolved across chunk boundaries', async () => {
        const response = await GET({} as any)
        const body = await response.json()

        expect(body.data).toHaveLength(SHOP_ORG_COUNT)
        expect(body.data.every((row: any) => row.consumer_shop_name)).toBe(true)

        // A staff member from the last chunk still resolves, not just the first 50.
        const last = body.data.find((row: any) => row.consumer_name === `Staff ${SHOP_ORG_COUNT - 1}`)
        expect(last?.consumer_shop_name).toBe(`Shop ${SHOP_ORG_COUNT - 1}`)
        expect(last?.consumer_location).toBe('Selangor')
    })

    it('sums scans and transactions into the balance the tab shows', async () => {
        mocks.scans = [
            { consumer_id: 'staff-0', collected_points: true, points_amount: 40, points_collected_at: '2026-08-19T06:34:11Z', is_manual_adjustment: false },
        ]
        mocks.transactions = [
            { user_id: 'staff-0', transaction_type: 'earn', points_amount: 2, transaction_date: '2026-08-01T00:00:00Z' },
            { user_id: 'staff-0', transaction_type: 'MIGRATION', points_amount: 990, transaction_date: '2026-07-01T00:00:00Z' },
            { user_id: 'staff-0', transaction_type: 'roadtour_survey', points_amount: 100, transaction_date: '2026-06-01T00:00:00Z' },
        ]

        const body = await (await GET({} as any)).json()
        const row = body.data.find((item: any) => item.user_id === 'staff-0')

        expect(row.current_balance).toBe(1132)
        expect(row.user_id).toBe('staff-0')
    })
})
