import { NextRequest, NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildPendingShopRequestInsert, sanitizeShopRequestForm, validateShopRequestForm } from '@/lib/shop-requests/core'
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

async function resolveShopRequestParentOrgId(adminClient: any, organizationId?: string | null) {
    const fixedCodes = ['DH04', 'DT004']

    const { data: fixedDistributor } = await adminClient
        .from('organizations')
        .select('id')
        .eq('org_type_code', 'DIST')
        .in('org_code', fixedCodes)
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()

    if (fixedDistributor?.id) {
        return fixedDistributor.id
    }

    if (organizationId) {
        const { data: currentOrg } = await adminClient
            .from('organizations')
            .select('id, parent_org_id, org_type_code')
            .eq('id', organizationId)
            .maybeSingle()

        if (currentOrg?.org_type_code === 'DIST') {
            return currentOrg.id
        }

        if (currentOrg?.parent_org_id) {
            const { data: parentOrg } = await adminClient
                .from('organizations')
                .select('id, org_type_code')
                .eq('id', currentOrg.parent_org_id)
                .maybeSingle()

            if (parentOrg?.org_type_code === 'DIST') {
                return parentOrg.id
            }
        }
    }

    const { data: fallbackDistributor } = await adminClient
        .from('organizations')
        .select('id')
        .eq('org_type_code', 'DIST')
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()

    return fallbackDistributor?.id || null
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
        const validation = validateShopRequestForm(form)

        if (!validation.valid) {
            return NextResponse.json({ success: false, error: validation.errors[0] }, { status: 400 })
        }

        const notificationOrgId = await resolveNotificationOrgId(adminClient, requester.organization_id)
        const parentOrgId = await resolveShopRequestParentOrgId(adminClient, requester.organization_id)
        const insertPayload = buildPendingShopRequestInsert({
            notificationOrgId,
            parentOrgId,
            requesterUserId: requester.id,
            requesterName: requester.full_name || null,
            requesterPhone: requester.phone || null,
            form,
        })

        const { data: inserted, error: insertError } = await adminClient
            .from('shop_requests')
            .insert(insertPayload)
            .select('id, requested_shop_name, requested_branch, requested_contact_name, requested_contact_phone, requested_contact_email, requested_address, requested_state, requested_hot_flavour_brands, requested_sells_serapod_flavour, requested_sells_sbox, requested_sells_sbox_special_edition, notes, requester_name, requester_phone, requested_parent_org_id')
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
                    contactEmail: inserted.requested_contact_email,
                    address: inserted.requested_address,
                    state: inserted.requested_state,
                    hotFlavourBrands: inserted.requested_hot_flavour_brands,
                    sellsSerapodFlavour: inserted.requested_sells_serapod_flavour,
                    sellsSbox: inserted.requested_sells_sbox,
                    sellsSboxSpecialEdition: inserted.requested_sells_sbox_special_edition,
                    parentOrgId: inserted.requested_parent_org_id,
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