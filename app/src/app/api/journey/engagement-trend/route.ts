import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
    buildTrendSeries,
    isTrendRange,
    resolveTrendWindow,
    TREND_TIME_ZONE,
} from '@/lib/journey/engagement-trend'

/**
 * GET /api/journey/engagement-trend?range=30d
 *
 * Daily QR engagement for the caller's organization journeys, aggregated in
 * Postgres by get_journey_engagement_trend (Asia/Kuala_Lumpur days). Only the
 * selected window is queried; no QR ids are loaded into the route.
 *
 * 200 { success: true, range, startDate, endDate, timeZone, points: [{ date, scans, redeemed }] }
 * 4xx/5xx { success: false, error }  -- never converted into zero data.
 */
export async function GET(req: NextRequest) {
    const rangeParam = req.nextUrl.searchParams.get('range') || '30d'
    if (!isTrendRange(rangeParam)) {
        return NextResponse.json({ success: false, error: 'Invalid range' }, { status: 400 })
    }

    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

        const window = resolveTrendWindow(rangeParam)
        const { data, error } = await (supabase as any).rpc('get_journey_engagement_trend', {
            p_start_date: window.startDate,
            p_end_date: window.endDate,
        })

        if (error) {
            console.error('[engagement-trend] rpc error', error)
            return NextResponse.json(
                { success: false, error: 'Failed to load engagement trend' },
                { status: 500 },
            )
        }

        return NextResponse.json({
            success: true,
            range: window.range,
            startDate: window.startDate,
            endDate: window.endDate,
            timeZone: TREND_TIME_ZONE,
            points: buildTrendSeries(data as any[], window.startDate, window.endDate),
        })
    } catch (err: any) {
        console.error('[engagement-trend] error', err)
        return NextResponse.json({ success: false, error: 'Failed to load engagement trend' }, { status: 500 })
    }
}
