import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
    sanitizeShopRequestForm,
    validateShopRequestForm,
} from '@/lib/shop-requests/core'
import { createShopOrganization, findSimilarShopSuggestions } from '@/lib/shop-requests/create-shop'

export const dynamic = 'force-dynamic'

const SHOP_CREATED_NOTIFICATION_CHANNELS = ['whatsapp', 'sms', 'email'] as const

/**
 * POST /api/shops/create
 * Directly create a new shop organization and optionally link the user.
 */
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient()
        const adminClient = createAdminClient()

        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
        }

        const { data: userRow } = await adminClient
            .from('users')
            .select('id, organization_id, full_name, phone, email')
            .eq('id', user.id)
            .single()

        if (!userRow) {
            return NextResponse.json({ success: false, error: 'User not found.' }, { status: 404 })
        }

        const rawBody = await request.json()
        const form = sanitizeShopRequestForm(rawBody)
        const validation = validateShopRequestForm(form)

        if (!validation.valid) {
            return NextResponse.json({ success: false, error: validation.errors[0] }, { status: 400 })
        }

        // --- Duplicate check ---
        const duplicates = await findSimilarShopSuggestions(adminClient, form.shopName)
        if (duplicates.length > 0 && !rawBody.confirmCreate) {
            return NextResponse.json({
                success: false,
                duplicateWarning: true,
                duplicates,
                error: 'Similar shops already exist. Please confirm creation.',
            }, { status: 409 })
        }

        let createdOrganization: { id: string; org_name: string; branch?: string | null }
        let parentOrgId: string
        try {
            const result = await createShopOrganization(adminClient, {
                form,
                createdBy: user.id,
                userOrgId: userRow.organization_id,
            })
            createdOrganization = result.organization
            parentOrgId = result.parentOrgId
        } catch (createError: any) {
            console.error('Shop create error:', createError)
            return NextResponse.json({
                success: false,
                error: createError?.message || 'Failed to create shop.',
            }, { status: 500 })
        }

        try {
            const payload = {
                shop_name: createdOrganization.org_name,
                shop_branch: createdOrganization.branch || '-',
                shop_state: form.state || '-',
                contact_name: form.contactName || '-',
                contact_phone: form.contactPhone || '-',
                contact_email: form.contactEmail || '-',
                creator_name: userRow.full_name || user.email || 'User',
                creator_email: user.email || userRow.email || '-',
                creator_phone: userRow.phone || '-',
                created_at: new Date().toLocaleString('en-GB'),
            }

            for (const channel of SHOP_CREATED_NOTIFICATION_CHANNELS) {
                await adminClient.from('notifications_outbox').insert({
                    org_id: parentOrgId,
                    event_code: 'user_created_shop',
                    channel,
                    payload_json: payload,
                    priority: 'normal',
                    status: 'queued',
                    retry_count: 0,
                    max_retries: 3,
                    created_at: new Date().toISOString(),
                })
            }

            fetch(`${request.nextUrl.origin}/api/cron/notification-outbox-worker`).catch(() => { })
        } catch (notificationError) {
            console.warn('Failed to queue shop created notification (non-blocking):', notificationError)
        }

        // --- Link user to the new shop ---
        if (rawBody.linkUser !== false) {
            const { error: linkError } = await adminClient
                .from('users')
                .update({
                    organization_id: createdOrganization.id,
                    shop_name: createdOrganization.org_name,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', user.id)

            if (linkError) {
                console.error('User link error:', linkError)
                // Shop was created but linking failed — still return success with warning
                return NextResponse.json({
                    success: true,
                    organization: createdOrganization,
                    linkError: 'Shop created but failed to link to your profile. Please update your shop in Profile.',
                })
            }
        }

        return NextResponse.json({
            success: true,
            organization: createdOrganization,
        })
    } catch (err: any) {
        console.error('Shop create error:', err)
        return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
    }
}
