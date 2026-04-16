import { NextRequest, NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAdminUser } from '@/app/api/settings/whatsapp/_utils'
import { sendShopRequestNotifications } from '@/lib/shop-requests/notifications'

export async function POST(request: NextRequest, context: { params: Promise<{ requestId: string }> }) {
    try {
        const supabase = await createClient()
        const adminClient = createAdminClient()
        const { data: { user }, error } = await supabase.auth.getUser()

        if (error || !user || !(await isAdminUser(adminClient as any, user.id))) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
        }

        const { requestId } = await context.params
        const body = await request.json().catch(() => ({}))
        const reviewNotes = body.reviewNotes ? String(body.reviewNotes).trim() : null

        const { data: requestRow, error: requestError } = await adminClient
            .from('shop_requests')
            .select('*')
            .eq('id', requestId)
            .single()

        if (requestError || !requestRow) {
            return NextResponse.json({ success: false, error: 'Shop request not found.' }, { status: 404 })
        }

        const reviewedAt = new Date().toISOString()
        const { error: updateError } = await adminClient
            .from('shop_requests')
            .update({
                status: 'rejected',
                reviewed_by: user.id,
                reviewed_at: reviewedAt,
                review_notes: reviewNotes,
                updated_at: reviewedAt,
            })
            .eq('id', requestId)

        if (updateError) {
            return NextResponse.json({ success: false, error: updateError.message }, { status: 500 })
        }

        if (requestRow.notification_org_id) {
            const { data: settingsOrg } = await adminClient
                .from('organizations')
                .select('settings')
                .eq('id', requestRow.notification_org_id)
                .maybeSingle()

            await sendShopRequestNotifications({
                supabase: adminClient,
                orgId: requestRow.notification_org_id,
                settings: settingsOrg?.settings,
                request: {
                    id: requestRow.id,
                    shopName: requestRow.requested_shop_name,
                    branch: requestRow.requested_branch,
                    contactName: requestRow.requested_contact_name,
                    contactPhone: requestRow.requested_contact_phone,
                    address: requestRow.requested_address,
                    state: requestRow.requested_state,
                    notes: requestRow.notes,
                    requesterName: requestRow.requester_name,
                    requesterPhone: requestRow.requester_phone,
                    reviewNotes,
                },
                notificationType: 'requester_rejected',
            })
        }

        return NextResponse.json({ success: true })
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message || 'Internal server error' }, { status: 500 })
    }
}