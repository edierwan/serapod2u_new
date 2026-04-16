import { NextRequest, NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAdminUser } from '@/app/api/settings/whatsapp/_utils'
import {
    normalizeShopRequestNotificationSettings,
    serializeShopRequestNotificationSettings,
} from '@/lib/engagement/shop-request-settings'

async function resolveAdminOrgId(adminClient: any, userId: string) {
    const { data: userProfile } = await adminClient
        .from('users')
        .select('organization_id')
        .eq('id', userId)
        .maybeSingle()

    if (userProfile?.organization_id) {
        return userProfile.organization_id
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

export async function GET() {
    try {
        const supabase = await createClient()
        const adminClient = createAdminClient()
        const { data: { user }, error } = await supabase.auth.getUser()

        if (error || !user || !(await isAdminUser(adminClient as any, user.id))) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
        }

        const orgId = await resolveAdminOrgId(adminClient, user.id)
        if (!orgId) {
            return NextResponse.json({ success: false, error: 'Organization not found.' }, { status: 404 })
        }

        const { data: orgData } = await adminClient
            .from('organizations')
            .select('settings')
            .eq('id', orgId)
            .maybeSingle()

        return NextResponse.json({
            success: true,
            orgId,
            settings: normalizeShopRequestNotificationSettings(orgData?.settings),
        })
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message || 'Internal server error' }, { status: 500 })
    }
}

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient()
        const adminClient = createAdminClient()
        const { data: { user }, error } = await supabase.auth.getUser()

        if (error || !user || !(await isAdminUser(adminClient as any, user.id))) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
        }

        const orgId = await resolveAdminOrgId(adminClient, user.id)
        if (!orgId) {
            return NextResponse.json({ success: false, error: 'Organization not found.' }, { status: 404 })
        }

        const body = await request.json()
        const nextSettings = normalizeShopRequestNotificationSettings(body)

        const { data: orgData } = await adminClient
            .from('organizations')
            .select('settings')
            .eq('id', orgId)
            .single()

        const mergedSettings = {
            ...((orgData?.settings as any) || {}),
            shop_request_notifications: serializeShopRequestNotificationSettings(nextSettings),
        }

        const { error: updateError } = await adminClient
            .from('organizations')
            .update({ settings: mergedSettings, updated_at: new Date().toISOString(), updated_by: user.id })
            .eq('id', orgId)

        if (updateError) {
            return NextResponse.json({ success: false, error: updateError.message }, { status: 500 })
        }

        return NextResponse.json({ success: true, settings: nextSettings })
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message || 'Internal server error' }, { status: 500 })
    }
}