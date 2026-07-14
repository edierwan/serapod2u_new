import { NextRequest, NextResponse } from 'next/server'
import { getReturnContext } from '@/lib/returns/server'
import { loadReportData, parseReportRequest } from '@/lib/returns/reporting-server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/returns/reporting/summary
 *
 * Management dashboard aggregate for the Return Product report: period +
 * comparison KPIs with deltas, trend, reason/source/warehouse/product/status
 * breakdowns, deterministic key insights and slim per-case rows for the
 * detailed table. All aggregation happens server-side.
 *
 * Query params:
 *   mode=monthly|quarterly, year, month (1-12) | quarter (1-4)
 *   cmp_year + cmp_month|cmp_quarter (defaults to the previous period)
 *   source_type=shop|distributor, source=<orgId>, warehouse=<orgId>,
 *   reason=<code>, status=<return status>
 */
export async function GET(request: NextRequest) {
    const ctx = await getReturnContext()
    if (ctx instanceof NextResponse) return ctx

    try {
        const reportRequest = parseReportRequest(request.nextUrl.searchParams)
        const { summary, cases, generatedBy } = await loadReportData(ctx, reportRequest)
        return NextResponse.json({ ...summary, cases, generatedBy })
    } catch (error: any) {
        console.error('[ReturnReporting] summary failed:', error?.message || error)
        return NextResponse.json({ error: 'Failed to build the return report.' }, { status: 500 })
    }
}
