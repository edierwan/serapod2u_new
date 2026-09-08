import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  ALL_CATEGORIES,
  buildProductAnalyticsReport,
  currentReportingMonthKey,
  isValidMonthKey,
} from '@/lib/reporting/product-analytics'
import { fetchProductAnalyticsAggregate } from '@/lib/reporting/product-analytics-source'

export const dynamic = 'force-dynamic'

/**
 * GET /api/reporting/product-analytics?month=YYYY-MM&categoryId=all|<uuid>
 *
 * Returns the whole monthly product management report as one compact DTO — a
 * few KB regardless of how many order items the month holds. No raw orders or
 * order items ever reach the browser, and the PDF generator consumes this exact
 * same report so the two can never disagree.
 *
 * `categoryId` scopes the WHOLE report — every KPI, denominator, ranking and the
 * current inventory snapshot — and is applied in the reporting layer, never by
 * filtering in the browser.
 */
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const currentMonth = currentReportingMonthKey()
  const params = new URL(request.url).searchParams
  const requested = params.get('month')
  const month = requested ?? currentMonth
  if (!isValidMonthKey(month)) {
    return NextResponse.json({ error: `Invalid reporting month "${month}", expected YYYY-MM` }, { status: 400 })
  }
  // A month beyond the running Malaysia month cannot have traded.
  if (month > currentMonth) {
    return NextResponse.json({ error: `Reporting month "${month}" is in the future` }, { status: 400 })
  }

  const requestedCategory = params.get('categoryId')?.trim() || ALL_CATEGORIES
  // Stable IDs only: anything that is not the `all` sentinel must be a uuid, so
  // a category can never be selected by name or by free text.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestedCategory)
  if (requestedCategory !== ALL_CATEGORIES && !isUuid) {
    return NextResponse.json({ error: `Invalid category "${requestedCategory}"` }, { status: 400 })
  }

  try {
    const { aggregate, source, degraded, notice } = await fetchProductAnalyticsAggregate(
      supabase, month, requestedCategory,
    )
    return NextResponse.json(
      {
        report: buildProductAnalyticsReport(aggregate),
        meta: { source, degraded, notice, generatedAt: new Date().toISOString() },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Unable to load product analytics' },
      { status: 500 },
    )
  }
}
