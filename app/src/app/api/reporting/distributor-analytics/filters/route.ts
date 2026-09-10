import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  fetchDistributorOrderPeriods,
  fetchReportingDistributors,
} from '@/lib/reporting/distributor-analytics-source'
import { ORDER_STATUSES, statusLabel } from '@/lib/reporting/distributor-analytics'

export const dynamic = 'force-dynamic'

/**
 * GET /api/reporting/distributor-analytics/filters
 *
 * Everything the Distributor Analytics filter bar needs, in ONE request: the
 * reporting months holding eligible distributor order activity, the selectable
 * distributors from canonical master data, and the order statuses.
 *
 * Neither list is fatal on its own — the tab always offers the current month,
 * All Distributors and All Status — so one failing source must not blank the
 * other.
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [monthsResult, distributorsResult] = await Promise.allSettled([
    fetchDistributorOrderPeriods(supabase),
    fetchReportingDistributors(supabase),
  ])

  return NextResponse.json(
    {
      months: monthsResult.status === 'fulfilled' ? monthsResult.value : [],
      distributors: distributorsResult.status === 'fulfilled' ? distributorsResult.value : [],
      statuses: ORDER_STATUSES.map((status) => ({ value: status, label: statusLabel(status) })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
