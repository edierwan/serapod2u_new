import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const rpc = vi.fn()
const fromCalls: string[] = []

const tables: Record<string, any> = {
    users: { data: { organization_id: 'org-1' }, error: null },
    journey_configurations: {
        data: [
            { id: 'j-1', name: 'Journey A', is_active: true, points_enabled: true, lucky_draw_enabled: false, redemption_enabled: false, created_at: '2026-09-10T00:00:00Z' },
            { id: 'j-2', name: 'Journey B', is_active: true, points_enabled: true, lucky_draw_enabled: false, redemption_enabled: true, created_at: '2026-09-01T00:00:00Z' },
        ],
        error: null,
    },
    journey_order_links: {
        data: [
            { journey_config_id: 'j-1', order_id: 'order-1' },
            { journey_config_id: 'j-2', order_id: 'order-2' },
        ],
        error: null,
    },
    orders: { data: { display_doc_no: 'SO26000002', order_no: 'ORD-2' }, error: null },
}

function chain(result: any) {
    const c: any = {
        select: () => c, eq: () => c, in: () => c, order: () => c, limit: () => c,
        single: () => Promise.resolve(result),
        then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
    }
    return c
}

vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({
        auth: { getUser },
        from: (table: string) => { fromCalls.push(table); return chain(tables[table] ?? { data: null, error: null }) },
        rpc: (...args: any[]) => rpc(...args),
    })),
}))

import { GET } from './route'

const scanStats: Record<string, any> = {
    'order-1': { total_qr_codes: 1_262_760, unique_consumer_scans: 90_331, redemptions: 0, lucky_draw_entries: 0, points_collected_count: 88_000 },
    'order-2': { total_qr_codes: 110_000, unique_consumer_scans: 11_249, redemptions: 500, lucky_draw_entries: 0, points_collected_count: 10_856 },
}

describe('GET /api/journey/dashboard-summary', () => {
    beforeEach(() => {
        fromCalls.length = 0
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-09-21T04:00:00Z'))
        getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
        rpc.mockImplementation((fn: string, args: any) => {
            if (fn === 'get_consumer_scan_stats') {
                return { single: () => Promise.resolve({ data: scanStats[args.p_order_id], error: null }) }
            }
            if (fn === 'get_journey_engagement_trend') {
                return Promise.resolve({ data: [{ day: '2026-09-21', scans: 42, redeemed: 3 }], error: null })
            }
            throw new Error(`unexpected rpc ${fn}`)
        })
    })

    afterEach(() => { vi.useRealTimers() })

    it('keeps KPI totals on get_consumer_scan_stats semantics across multiple journeys', async () => {
        const res = await GET(new NextRequest('http://localhost/api/journey/dashboard-summary'))
        const body = await res.json()

        expect(res.status).toBe(200)
        expect(body.kpis).toEqual({
            totalJourneys: 2,
            totalQrGenerated: 1_372_760,
            totalScans: 101_580,
            pointsRedeemed: 500,
            failedScans: 0,
        })
        expect(body.journeys).toHaveLength(2)
        expect(body.recentActivity.map((a: any) => a.id)).toEqual(['j-1', 'j-2'])
    })

    it('no longer loads QR codes or scan rows into the route (no 50k cap, no IN lists)', async () => {
        await GET(new NextRequest('http://localhost/api/journey/dashboard-summary'))
        expect(fromCalls).not.toContain('qr_codes')
        expect(fromCalls).not.toContain('consumer_qr_scans')
    })

    it('builds the Top Performing sparkline from the server-side trend RPC (14 MYT days)', async () => {
        const res = await GET(new NextRequest('http://localhost/api/journey/dashboard-summary'))
        const body = await res.json()

        expect(rpc).toHaveBeenCalledWith('get_journey_engagement_trend', { p_start_date: '2026-09-08', p_end_date: '2026-09-21' })
        expect(body.topPerforming).toMatchObject({ id: 'j-1', scans: 90_331, order_no: 'SO26000002' })
        expect(body.topPerforming.sparkline).toHaveLength(14)
        expect(body.topPerforming.sparkline.at(-1)).toBe(42)
        expect(body.trend).toBeUndefined()
    })
})
