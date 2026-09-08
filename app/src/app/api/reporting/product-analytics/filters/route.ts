import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  fetchProductOrderPeriods,
  fetchReportingCategories,
} from '@/lib/reporting/product-analytics-source'

export const dynamic = 'force-dynamic'

/**
 * GET /api/reporting/product-analytics/filters
 *
 * Everything the Product Analytics filter bar needs, in ONE request: the
 * reporting months that hold eligible order activity, and the active Product
 * Categories from canonical master data.
 *
 * Categories come from `product_categories` rather than a hard-coded list, so a
 * category management adds later appears in the dropdown with no code change.
 * Neither list is fatal on its own — the tab always offers the current month and
 * All Categories — so one failing source must not blank the other.
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [monthsResult, categoriesResult] = await Promise.allSettled([
    fetchProductOrderPeriods(supabase),
    fetchReportingCategories(supabase),
  ])

  return NextResponse.json(
    {
      months: monthsResult.status === 'fulfilled' ? monthsResult.value : [],
      categories: categoriesResult.status === 'fulfilled' ? categoriesResult.value : [],
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
