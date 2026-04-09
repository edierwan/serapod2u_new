/**
 * WhatsApp Send Message API
 * 
 * POST /api/settings/whatsapp/send
 * Sends a WhatsApp message to a specific phone number.
 * Used by RoadTour QR distribution and other admin features.
 * 
 * Security: Admin-only (authenticated user with admin-level role)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getWhatsAppConfig, isAdminUser, callGateway } from '@/app/api/settings/whatsapp/_utils'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient()

        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const isAdmin = await isAdminUser(supabase, user.id)
        if (!isAdmin) {
            return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 })
        }

        const { data: userProfile } = await supabase
            .from('users')
            .select('organization_id')
            .eq('id', user.id)
            .single()

        if (!userProfile?.organization_id) {
            return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
        }

        const body = await request.json()
        const { phone, message } = body

        if (!phone || !message) {
            return NextResponse.json({ error: 'Phone and message are required' }, { status: 400 })
        }

        const config = await getWhatsAppConfig(supabase, userProfile.organization_id)
        if (!config?.baseUrl || !config?.apiKey) {
            return NextResponse.json({ error: 'WhatsApp gateway not configured' }, { status: 400 })
        }

        const recipientDigits = String(phone).replace(/^\+/, '')

        const result = await callGateway(
            config.baseUrl,
            config.apiKey,
            'POST',
            '/messages/send',
            { to: recipientDigits, text: message },
            config.tenantId,
        )

        return NextResponse.json({
            ok: true,
            messageId: result?.key?.id || result?.messageId || null,
        })
    } catch (error: any) {
        console.error('[WhatsApp Send]', error)
        return NextResponse.json(
            { error: error?.message || 'Failed to send WhatsApp message' },
            { status: 500 },
        )
    }
}
