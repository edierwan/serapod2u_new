import { NextRequest, NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAdminUser } from '@/app/api/settings/whatsapp/_utils'

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient()
        const adminClient = createAdminClient()
        const { data: { user }, error } = await supabase.auth.getUser()

        if (error || !user || !(await isAdminUser(adminClient as any, user.id))) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
        }

        const status = request.nextUrl.searchParams.get('status')?.trim() || 'pending'
        const query = adminClient
            .from('shop_requests')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(200)

        if (status !== 'all') {
            query.eq('status', status)
        }

        const { data, error: listError } = await query
        if (listError) {
            return NextResponse.json({ success: false, error: listError.message }, { status: 500 })
        }

        return NextResponse.json({ success: true, requests: data || [] })
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message || 'Internal server error' }, { status: 500 })
    }
}