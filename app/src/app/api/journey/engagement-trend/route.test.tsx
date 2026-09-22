import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const rpc = vi.fn()
const from = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser }, rpc, from })),
}))

import { GET } from './route'

function req(query = '') {
    return new NextRequest(`http://localhost/api/journey/engagement-trend${query}`)
}

describe('GET /api/journey/engagement-trend', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.useFakeTimers()
        // 21 Sep 2026 00:30 MYT
        vi.setSystemTime(new Date('2026-09-20T16:30:00Z'))
        getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('queries only the selected MYT window through one server-side aggregate RPC', async () => {
        rpc.mockResolvedValue({
            data: [
                { day: '2026-09-15', scans: 4320, redeemed: 120 },
                { day: '2026-09-21', scans: 5110, redeemed: 138 },
            ],
            error: null,
        })

        const res = await GET(req('?range=7d'))
        const body = await res.json()

        expect(res.status).toBe(200)
        expect(rpc).toHaveBeenCalledTimes(1)
        expect(rpc).toHaveBeenCalledWith('get_journey_engagement_trend', {
            p_start_date: '2026-09-15',
            p_end_date: '2026-09-21',
        })
        // No QR-code or scan rows are pulled into the route.
        expect(from).not.toHaveBeenCalled()
        expect(body).toMatchObject({ success: true, range: '7d', timeZone: 'Asia/Kuala_Lumpur' })
        expect(body.points).toHaveLength(7)
        expect(body.points[0]).toEqual({ date: '2026-09-15', scans: 4320, redeemed: 120 })
        expect(body.points[6]).toEqual({ date: '2026-09-21', scans: 5110, redeemed: 138 })
        expect(body.points.some((p: any) => 'failed' in p)).toBe(false)
    })

    it('defaults to 30 days and returns a zero-filled series for successful empty activity', async () => {
        rpc.mockResolvedValue({ data: [], error: null })
        const res = await GET(req())
        const body = await res.json()
        expect(res.status).toBe(200)
        expect(body.success).toBe(true)
        expect(body.points).toHaveLength(30)
        expect(body.points.every((p: any) => p.scans === 0 && p.redeemed === 0)).toBe(true)
    })

    it('reports RPC failures as errors instead of fake zero data', async () => {
        rpc.mockResolvedValue({ data: null, error: { code: '42883', message: 'function does not exist' } })
        const res = await GET(req('?range=30d'))
        const body = await res.json()
        expect(res.status).toBe(500)
        expect(body.success).toBe(false)
        expect(body.points).toBeUndefined()
    })

    it('rejects unknown ranges and unauthenticated callers', async () => {
        expect((await GET(req('?range=forever'))).status).toBe(400)
        getUser.mockResolvedValue({ data: { user: null } })
        expect((await GET(req('?range=7d'))).status).toBe(401)
        expect(rpc).not.toHaveBeenCalled()
    })
})
