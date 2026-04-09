import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * GET /api/admin/shop-consumers?shop_id=xxx
 * Returns consumers linked to a specific shop organization
 */
export async function GET(request: NextRequest) {
    try {
        const { createClient: createServerClient } = await import('@/lib/supabase/server')
        const supabase = await createServerClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const admin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            { auth: { autoRefreshToken: false, persistSession: false } }
        )

        // Check admin role
        const { data: profile } = await admin
            .from('users')
            .select('role_code')
            .eq('id', user.id)
            .single()

        if (!profile || !['SA', 'HQ', 'POWER_USER'].includes(profile.role_code)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        const shopId = request.nextUrl.searchParams.get('shop_id')
        if (!shopId) {
            return NextResponse.json({ error: 'shop_id is required' }, { status: 400 })
        }

        // Get consumers linked to this shop via organization_id
        const { data: consumers, error } = await admin
            .from('users')
            .select('id, full_name, phone, email, role_code, created_at')
            .eq('organization_id', shopId)
            .in('role_code', ['GUEST', 'CONSUMER', 'USER'])
            .order('full_name')

        if (error) throw error

        // Also get point balances for each consumer
        const consumerIds = consumers?.map(c => c.id) || []
        let balances: Record<string, number> = {}

        if (consumerIds.length > 0) {
            const { data: balanceData } = await admin
                .from('v_consumer_points_balance')
                .select('user_id, current_balance')
                .in('user_id', consumerIds)

            if (balanceData) {
                balances = Object.fromEntries(balanceData.map(b => [b.user_id, b.current_balance]))
            }
        }

        const result = (consumers || []).map(c => ({
            ...c,
            current_balance: balances[c.id] || 0,
        }))

        return NextResponse.json({ success: true, data: result })
    } catch (err: any) {
        console.error('shop-consumers error:', err)
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}
