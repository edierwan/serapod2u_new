import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getKpiAuthContext } from '@/lib/server/kpi/access'

export async function GET(req: NextRequest) {
    const supabase = (await createClient()) as any
    const auth = await getKpiAuthContext(supabase)
    if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

    const periodId = req.nextUrl.searchParams.get('period_id')
    const level = req.nextUrl.searchParams.get('level')
    const employeeUserId = req.nextUrl.searchParams.get('employee_user_id')
    const departmentId = req.nextUrl.searchParams.get('department_id')

    let q = supabase
        .from('hr_kpi_scorecards')
        .select('*')
        .eq('organization_id', auth.data.organizationId)
        .order('created_at', { ascending: false })
    if (periodId) q = q.eq('period_id', periodId)
    if (level) q = q.eq('scorecard_level', level)
    if (employeeUserId) q = q.eq('employee_user_id', employeeUserId)
    if (departmentId) q = q.eq('department_id', departmentId)

    const { data, error } = await q
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, data })
}
