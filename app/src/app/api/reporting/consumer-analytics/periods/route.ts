import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchConsumerScanPeriods } from '@/lib/reporting/consumer-analytics-source'

export const dynamic = 'force-dynamic'

/**
 * Reporting months that hold consumer scan activity. Unlike the shop reports
 * this does not require `shop_id`, because a consumer scan is a valid reporting
 * event with or without a shop attached.
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const periods = await fetchConsumerScanPeriods(supabase)
    return NextResponse.json({ periods }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Unable to load reporting periods' },
      { status: 500 },
    )
  }
}
