import { NextRequest, NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sanitizeShopRequestForm } from '@/lib/shop-requests/core'
import { sendShopRequestNotifications } from '@/lib/shop-requests/notifications'

async function resolveNotificationOrgId(adminClient: any, organizationId?: string | null) {
    if (organizationId) {
        const { data: org } = await adminClient
            .from('organizations')
            .select('id, parent_org_id, org_type_code')
            .eq('id', organizationId)
            .maybeSingle()

        if (org?.parent_org_id) {
            return org.parent_org_id
        }

        if (org?.id) {
            return org.id
        }
    }

    const { data: fallbackOrg } = await adminClient
        .from('organizations')
        .select('id')
        .eq('org_type_code', 'HQ')
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()

    return fallbackOrg?.id || null
}

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient()
        const adminClient = createAdminClient()

        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
        }

        const { data: requester } = await adminClient
            .from('users')
            .select('id, full_name, phone, organization_id')
            .eq('id', user.id)
            .single()

        if (!requester) {
            return NextResponse.json({ success: false, error: 'User profile not found.' }, { status: 404 })
        }

        const rawBody = await request.json()
        const form = sanitizeShopRequestForm(rawBody)

        if (!form.shopName) {
            return NextResponse.json({ success: false, error: 'Shop name is required.' }, { status: 400 })
        }

        const notificationOrgId = await resolveNotificationOrgId(adminClient, requester.organization_id)

        const { data: inserted, error: insertError } = await adminClient
            .from('shop_requests')
            .insert({
                notification_org_id: notificationOrgId,
                requester_user_id: requester.id,
                requester_name: requester.full_name || null,
                requester_phone: requester.phone || null,
                requested_shop_name: form.shopName,
                requested_branch: form.branch || null,
                requested_contact_name: form.contactName || null,
                requested_contact_phone: form.contactPhone || null,
                requested_address: form.address || null,
                requested_state: form.state || null,
                notes: form.notes || null,
                status: 'pending',
            })
            .select('id, requested_shop_name, requested_branch, requested_contact_name, requested_contact_phone, requested_address, requested_state, notes, requester_name, requester_phone')
            .single()

        if (insertError || !inserted) {
            return NextResponse.json({ success: false, error: insertError?.message || 'Failed to submit shop request.' }, { status: 500 })
        }

        if (notificationOrgId) {
            const { data: notificationOrg } = await adminClient
                .from('organizations')
                .select('settings')
                .eq('id', notificationOrgId)
                .maybeSingle()

            await sendShopRequestNotifications({
                supabase: adminClient,
                orgId: notificationOrgId,
                settings: notificationOrg?.settings,
                request: {
                    id: inserted.id,
                    shopName: inserted.requested_shop_name,
                    branch: inserted.requested_branch,
                    contactName: inserted.requested_contact_name,
                    contactPhone: inserted.requested_contact_phone,
                    address: inserted.requested_address,
                    state: inserted.requested_state,
                    notes: inserted.notes,
                    requesterName: inserted.requester_name,
                    requesterPhone: inserted.requester_phone,
                },
                notificationType: 'admin_request',
            })
        }

        return NextResponse.json({ success: true, requestId: inserted.id, status: 'pending' })
    } catch (error: any) {
        console.error('Error submitting shop request:', error)
        return NextResponse.json({ success: false, error: error.message || 'Internal server error' }, { status: 500 })
    }
}