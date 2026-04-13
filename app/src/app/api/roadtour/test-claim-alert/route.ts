import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAdminUser } from '@/app/api/settings/whatsapp/_utils'
import { sendRoadtourClaimNotifications } from '@/lib/roadtour/notifications'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const isAdmin = await isAdminUser(supabase as any, user.id)
        if (!isAdmin) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        const { data: profile } = await supabase
            .from('users')
            .select('organization_id, full_name')
            .eq('id', user.id)
            .single()

        if (!profile?.organization_id) {
            return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
        }

        const body = await request.json().catch(() => ({}))
        const requestedStatus = body?.status === 'success' ? 'success' : 'failed'

        const { data: campaign } = await (supabase as any)
            .from('roadtour_campaigns')
            .select('id, name')
            .eq('org_id', profile.organization_id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()

        if (!campaign?.id) {
            return NextResponse.json({ error: 'Create at least one RoadTour campaign before sending a test alert.' }, { status: 400 })
        }

        await sendRoadtourClaimNotifications({
            supabase,
            orgId: profile.organization_id,
            campaignId: campaign.id,
            notificationType: requestedStatus,
            forceSend: true,
            campaignName: campaign.name || 'RoadTour',
            referenceName: profile.full_name || 'Reference',
            shopName: 'Demo Shop',
            consumerName: 'Demo Consumer',
            pointsAwarded: requestedStatus === 'success' ? 20 : 0,
            balanceAfter: requestedStatus === 'success' ? 280 : 0,
            message: requestedStatus === 'success' ? 'Reward claimed successfully.' : 'Profile or reward validation failed.',
        })

        return NextResponse.json({ ok: true })
    } catch (error: any) {
        return NextResponse.json({ error: error?.message || 'Failed to send RoadTour test alert.' }, { status: 500 })
    }
}