import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  buildConsumerAnalyticsReport,
  currentReportingMonthKey,
  isValidMonthKey,
} from '@/lib/reporting/consumer-analytics'
import { fetchConsumerAnalyticsAggregate } from '@/lib/reporting/consumer-analytics-source'

export const dynamic = 'force-dynamic'

/**
 * GET /api/reporting/consumer-analytics?month=YYYY-MM
 *
 * Returns the whole monthly management report as one compact DTO — a few KB
 * regardless of how many scans the month holds. No raw scan rows ever reach the
 * browser.
 */
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const requested = new URL(request.url).searchParams.get('month')
  const month = requested ?? currentReportingMonthKey()
  if (!isValidMonthKey(month)) {
    return NextResponse.json({ error: `Invalid reporting month "${month}", expected YYYY-MM` }, { status: 400 })
  }

  try {
    const { aggregate, source, degraded, notice } = await fetchConsumerAnalyticsAggregate(supabase, month)
    return NextResponse.json(
      {
        report: buildConsumerAnalyticsReport(aggregate),
        meta: { source, degraded, notice, generatedAt: new Date().toISOString() },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Unable to load consumer analytics' },
      { status: 500 },
    )
  }
}
