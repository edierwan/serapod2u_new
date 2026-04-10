/**
 * RoadTour Send QR Image via WhatsApp
 * 
 * POST /api/roadtour/send-qr-whatsapp
 * Sends a QR code image via WhatsApp using the app's own public QR image
 * endpoint (/api/roadtour/qr-image/[token]) as the imageUrl.
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
        const { phone, token, campaignName, userName } = body

        if (!phone || !token) {
            return NextResponse.json({ error: 'Phone and token are required' }, { status: 400 })
        }

        const config = await getWhatsAppConfig(supabase, userProfile.organization_id)
        if (!config?.baseUrl || !config?.apiKey) {
            return NextResponse.json({ error: 'WhatsApp gateway not configured' }, { status: 400 })
        }

        // Build URLs
        const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://stg.serapod2u.com'
        const scanUrl = `${appBaseUrl}/scan?rt=${token}`
        const imageUrl = `${appBaseUrl}/api/roadtour/qr-image/${token}`

        // Caption with clickable link
        const caption = `🗺️ *Rewards Road Tour*\n\nCampaign: *${campaignName || 'RoadTour'}*\nAM: ${userName || 'Account Manager'}\n\nShow this QR to shop owners for them to scan and earn reward points.\n\n${scanUrl}`

        const recipientDigits = String(phone).replace(/^\+/, '')

        // Send via WhatsApp gateway (getouch uses imageUrl format)
        const result = await callGateway(
            config.baseUrl,
            config.apiKey,
            'POST',
            '/messages/send-image',
            { to: recipientDigits, imageUrl, caption },
            config.tenantId,
        )

        return NextResponse.json({
            ok: true,
            messageId: result?.messageId || result?.message_id || null,
        })
    } catch (error: any) {
        console.error('[RoadTour QR WhatsApp]', error)
        return NextResponse.json(
            { error: error?.message || 'Failed to send QR via WhatsApp' },
            { status: 500 },
        )
    }
}
