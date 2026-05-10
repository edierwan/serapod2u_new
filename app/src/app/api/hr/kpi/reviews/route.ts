import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getKpiAuthContext } from '@/lib/server/kpi/access'

export async function GET(req: NextRequest) {
    const supabase = (await createClient()) as any
    const auth = await getKpiAuthContext(supabase)
    if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

    const stage = req.nextUrl.searchParams.get('stage')
    const scorecardId = req.nextUrl.searchParams.get('scorecard_id')
    const employeeUserId = req.nextUrl.searchParams.get('employee_user_id')

    let q = supabase
        .from('hr_kpi_reviews')
        .select('*')
        .eq('organization_id', auth.data.organizationId)
        .order('created_at', { ascending: false })
    if (stage) q = q.eq('review_stage', stage)
    if (scorecardId) q = q.eq('scorecard_id', scorecardId)
    if (employeeUserId) q = q.eq('employee_user_id', employeeUserId)

    const { data, error } = await q
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, data })
}
