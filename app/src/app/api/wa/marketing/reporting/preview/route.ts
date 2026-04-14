import { NextRequest, NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import {
  buildDailyReportingData,
  normalizeDailyReportingConfig,
  renderDailyReportingMessage,
} from '@/lib/reporting/dailyReporting'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const config = normalizeDailyReportingConfig(body)
    const referenceDate = body?.referenceDate ? new Date(body.referenceDate) : new Date()
    const reportData = await buildDailyReportingData(supabase as any, {
      reportType: config.reportType,
      referenceDate,
    })

    return NextResponse.json({
      config,
      report: reportData,
      message: renderDailyReportingMessage(reportData, config.enableReplyAction),
    })
  } catch (error: any) {
    console.error('Daily Reporting preview error:', error)
    return NextResponse.json({ error: error.message || 'Failed to build report preview' }, { status: 500 })
  }
}