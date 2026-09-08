import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  ALL_DISTRIBUTORS,
  ALL_STATUS,
  ORDER_STATUSES,
  buildDistributorAnalyticsReport,
  currentReportingMonthKey,
  isValidMonthKey,
} from '@/lib/reporting/distributor-analytics'
import { fetchDistributorAnalyticsAggregate } from '@/lib/reporting/distributor-analytics-source'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

  const currentMonth = currentReportingMonthKey()
  const params = new URL(request.url).searchParams
  const month = params.get('month') ?? currentMonth
  if (!isValidMonthKey(month)) {
    return NextResponse.json({ error: `Invalid reporting month "${month}", expected YYYY-MM` }, { status: 400 })
  }
  // A month beyond the running Malaysia month cannot have traded.
  if (month > currentMonth) {
    return NextResponse.json({ error: `Reporting month "${month}" is in the future` }, { status: 400 })
  }

  // Stable IDs only: anything that is not the `all` sentinel must be a uuid, so
  // a distributor can never be selected by name or by free text.
  const distributor = params.get('distributor')?.trim() || ALL_DISTRIBUTORS
  if (distributor !== ALL_DISTRIBUTORS && !UUID.test(distributor)) {
    return NextResponse.json({ error: `Invalid distributor "${distributor}"` }, { status: 400 })
  }

  const status = params.get('status')?.trim() || ALL_STATUS
  if (status !== ALL_STATUS && !(ORDER_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: `Invalid order status "${status}"` }, { status: 400 })
  }

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
