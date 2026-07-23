import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchAccessibleReportingPeriods } from '@/lib/reporting/reporting-period-source'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let periods
  try {
    periods = await fetchAccessibleReportingPeriods(supabase)
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Unable to load reporting periods' }, { status: 500 })
  }

  return NextResponse.json({ periods }, { headers: { 'Cache-Control': 'no-store' } })
}
