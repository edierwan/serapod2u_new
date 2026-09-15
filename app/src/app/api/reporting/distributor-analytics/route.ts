import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildDistributorAnalyticsReport } from '@/lib/reporting/distributor-analytics'
import { parseDistributorReportParams } from '@/lib/reporting/distributor-report-params'
import { fetchDistributorAnalyticsAggregate } from '@/lib/reporting/distributor-analytics-source'

export const dynamic = 'force-dynamic'

/**
 * GET /api/reporting/distributor-analytics
 *     ?month=YYYY-MM&distributor=all|<uuid>&status=all|<order_status>
 *
 * Returns the whole monthly distributor management report as one compact DTO —
 * a few KB regardless of how many orders the month holds. No raw order
 * population reaches the browser, and the PDF generator consumes this exact
 * same report so the two can never disagree.
 *
 * `distributor` scopes the WHOLE report — every KPI, denominator, trend and
 * ranking — and `status` is applied identically to the report window and its
 * comparison window, so the two are never measured on different populations.
 */
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const params = parseDistributorReportParams(new URL(request.url).searchParams)
  if (!params.ok) return NextResponse.json({ error: params.error }, { status: 400 })
  const { month, distributor, status } = params

  try {
    const { aggregate, source, degraded, notice } = await fetchDistributorAnalyticsAggregate(
      supabase, month, distributor, status,
    )
    return NextResponse.json(
      {
        report: buildDistributorAnalyticsReport(aggregate),
        meta: { source, degraded, notice, generatedAt: new Date().toISOString() },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Unable to load distributor analytics' },
      { status: 500 },
    )
  }
}
