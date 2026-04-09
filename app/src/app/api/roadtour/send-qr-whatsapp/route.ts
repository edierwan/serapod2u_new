/**
 * RoadTour Send QR Image via WhatsApp
 * 
 * POST /api/roadtour/send-qr-whatsapp
 * Generates a QR code image and sends it via WhatsApp to the Account Manager.
 * The QR image is sent with a caption containing the clickable link.
 * 
 * Uses the local baileys-gateway directly for image sending (base64 support).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getWhatsAppConfig, isAdminUser } from '@/app/api/settings/whatsapp/_utils'
import QRCode from 'qrcode'

export const dynamic = 'force-dynamic'

// Local baileys-gateway for image sending (supports base64)
// Inside Docker, use the Docker bridge gateway IP to reach host services
const LOCAL_BAILEYS_URL = process.env.LOCAL_BAILEYS_GATEWAY_URL || 'http://10.0.1.1:3001'
const LOCAL_BAILEYS_API_KEY = process.env.LOCAL_BAILEYS_API_KEY || ''

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

        // Still need config to verify WhatsApp is configured for this org
        const config = await getWhatsAppConfig(supabase, userProfile.organization_id)
        if (!config) {
            return NextResponse.json({ error: 'WhatsApp gateway not configured' }, { status: 400 })
        }

        if (!LOCAL_BAILEYS_API_KEY) {
            return NextResponse.json({ error: 'Local baileys gateway API key not configured' }, { status: 500 })
        }

        // Build the scan URL
        const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://stg.serapod2u.com'
        const scanUrl = `${appBaseUrl}/scan?rt=${token}`

        // Generate QR code as PNG buffer (base64)
        const qrBuffer = await QRCode.toBuffer(scanUrl, {
            type: 'png',
            width: 400,
            margin: 2,
            color: { dark: '#000000', light: '#ffffff' },
        })
        const qrBase64 = qrBuffer.toString('base64')

        // Caption with clickable link
        const caption = `🗺️ *Rewards Road Tour*\n\nCampaign: *${campaignName || 'RoadTour'}*\nAM: ${userName || 'Account Manager'}\n\nShow this QR to shop owners for them to scan and earn reward points.\n\n${scanUrl}`

        const recipientDigits = String(phone).replace(/^\+/, '')

        // Call local baileys-gateway directly for image support
        const gatewayUrl = `${LOCAL_BAILEYS_URL}/messages/send-image`
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 15000) // 15s for image

        const resp = await fetch(gatewayUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': LOCAL_BAILEYS_API_KEY,
            },
            body: JSON.stringify({ to: recipientDigits, image: qrBase64, caption }),
            signal: controller.signal,
        })
        clearTimeout(timeoutId)

        if (!resp.ok) {
            const errBody = await resp.text()
            throw new Error(`Gateway error (${resp.status}): ${errBody}`)
        }

        const result = await resp.json()

        return NextResponse.json({
            ok: true,
            messageId: result?.message_id || null,
        })
    } catch (error: any) {
        console.error('[RoadTour QR WhatsApp]', error)
        return NextResponse.json(
            { error: error?.message || 'Failed to send QR via WhatsApp' },
            { status: 500 },
        )
    }
}
