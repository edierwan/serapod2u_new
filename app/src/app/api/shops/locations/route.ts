import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function GET() {
    try {
        const adminClient = createAdminClient()
        const [{ data: states, error: statesError }, { data: districts, error: districtsError }] = await Promise.all([
            adminClient.from('states').select('id, state_name').eq('is_active', true).order('state_name'),
            adminClient.from('districts').select('id, district_name, state_id').eq('is_active', true).order('district_name'),
        ])

        if (statesError) throw statesError
        if (districtsError) throw districtsError

        return NextResponse.json({
            success: true,
            states: states || [],
            districts: districts || [],
        })
    } catch (error) {
        console.error('Shop locations load error:', error)
        return NextResponse.json({ success: false, error: 'Unable to load shop location options.' }, { status: 500 })
    }
}
