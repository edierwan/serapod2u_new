import { NextRequest, NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAdminUser } from '@/app/api/settings/whatsapp/_utils'
import { buildApprovedShopOrganization } from '@/lib/shop-requests/core'
import { sendShopRequestNotifications } from '@/lib/shop-requests/notifications'

async function resolveStateId(adminClient: any, stateName?: string | null) {
    const normalized = String(stateName || '').trim()
    if (!normalized) return null

    const { data } = await adminClient
        .from('states')
        .select('id')
        .ilike('state_name', normalized)
        .limit(1)
        .maybeSingle()

    return data?.id || null
}

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

        const { data: requestRow, error: requestError } = await adminClient
            .from('shop_requests')
            .select('*')
            .eq('id', requestId)
            .single()

        if (requestError || !requestRow) {
            return NextResponse.json({ success: false, error: 'Shop request not found.' }, { status: 404 })
        }

        if (requestRow.status !== 'pending') {
            return NextResponse.json({ success: false, error: 'Only pending requests can be approved.' }, { status: 400 })
        }

        const stateId = await resolveStateId(adminClient, body.state || requestRow.requested_state)

        const orgInsert = buildApprovedShopOrganization({
            request: {
                id: requestRow.id,
                shopName: body.shopName || requestRow.requested_shop_name,
                branch: body.branch || requestRow.requested_branch,
                contactName: body.contactName || requestRow.requested_contact_name,
                contactPhone: body.contactPhone || requestRow.requested_contact_phone,
                address: body.address || requestRow.requested_address,
                state: body.state || requestRow.requested_state,
                notes: requestRow.notes,
                requesterName: requestRow.requester_name,
                requesterPhone: requestRow.requester_phone,
            },
            parentOrgId: requestRow.notification_org_id,
            stateId,
            createdBy: user.id,
        })

        const { data: createdOrg, error: createError } = await adminClient
            .from('organizations')
            .insert(orgInsert)
            .select('id, org_name, branch')
            .single()

        if (createError || !createdOrg) {
            return NextResponse.json({ success: false, error: createError?.message || 'Failed to create shop organization.' }, { status: 500 })
        }

        const reviewNotes = body.reviewNotes ? String(body.reviewNotes).trim() : null
        const approvedAt = new Date().toISOString()

        const { error: updateError } = await adminClient
            .from('shop_requests')
            .update({
                status: 'approved',
                reviewed_by: user.id,
                reviewed_at: approvedAt,
                review_notes: reviewNotes,
                approved_organization_id: createdOrg.id,
                approved_organization_name: createdOrg.org_name,
                updated_at: approvedAt,
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
                    shopName: createdOrg.org_name,
                    branch: createdOrg.branch,
                    contactName: body.contactName || requestRow.requested_contact_name,
                    contactPhone: body.contactPhone || requestRow.requested_contact_phone,
                    address: body.address || requestRow.requested_address,
                    state: body.state || requestRow.requested_state,
                    notes: requestRow.notes,
                    requesterName: requestRow.requester_name,
                    requesterPhone: requestRow.requester_phone,
                    reviewNotes,
                },
                notificationType: 'requester_approved',
            })
        }

        return NextResponse.json({ success: true, organization: createdOrg })
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message || 'Internal server error' }, { status: 500 })
    }
}