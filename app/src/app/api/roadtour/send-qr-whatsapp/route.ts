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
import { buildRoadTourUrl } from '@/lib/roadtour/url'
import { resolveRoadtourByToken } from '@/lib/roadtour/server'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
    const reqId = Date.now().toString(36)
    console.log(`[RoadTour QR WA][${reqId}] === REQUEST START ===`)
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

        console.log(`[RoadTour QR WA][${reqId}] campaign=${campaignName} token=${token?.substring(0, 8)}... rawPhone=${phone}`)

        if (!phone || !token) {
            return NextResponse.json({ error: 'Phone and token are required' }, { status: 400 })
        }

        const config = await getWhatsAppConfig(supabase, userProfile.organization_id)
        if (!config?.baseUrl || !config?.apiKey) {
            return NextResponse.json({ error: 'WhatsApp gateway not configured' }, { status: 400 })
        }

        // Build URLs
        const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://stg.serapod2u.com'
        const qrRecord = await resolveRoadtourByToken(token)
        const scanUrl = buildRoadTourUrl(appBaseUrl, qrRecord?.canonical_path || null) || `${appBaseUrl}/scan?rt=${token}`
        const imageUrl = `${appBaseUrl}/api/roadtour/qr-image/${token}`

        const recipientDigits = String(phone).replace(/^\+/, '')
        console.log(`[RoadTour QR WA][${reqId}] imageUrl=${imageUrl}`)
        console.log(`[RoadTour QR WA][${reqId}] recipientDigits=${recipientDigits}`)
        console.log(`[RoadTour QR WA][${reqId}] gateway=${config.baseUrl} tenantId=${config.tenantId || 'none'}`)

        // Pre-flight: verify the image URL is fetchable
        try {
            const preflight = await fetch(imageUrl, { method: 'HEAD' })
            console.log(`[RoadTour QR WA][${reqId}] preflight imageUrl status=${preflight.status} content-type=${preflight.headers.get('content-type')} content-length=${preflight.headers.get('content-length')}`)
            if (!preflight.ok) {
                console.error(`[RoadTour QR WA][${reqId}] FAIL: imageUrl not accessible, status=${preflight.status}`)
                return NextResponse.json(
                    { error: `QR image endpoint returned ${preflight.status}`, step: 'image_endpoint_access' },
                    { status: 502 },
                )
            }
        } catch (preflightErr: any) {
            console.error(`[RoadTour QR WA][${reqId}] FAIL: preflight fetch error:`, preflightErr.message)
            return NextResponse.json(
                { error: `Cannot reach QR image endpoint: ${preflightErr.message}`, step: 'image_endpoint_access' },
                { status: 502 },
            )
        }

        // Caption with clickable link
        const caption = `🗺️ *Rewards Road Tour*\n\nCampaign: *${campaignName || 'RoadTour'}*\nAM: ${userName || 'Account Manager'}\n\nShow this QR to shop owners for them to scan and earn reward points.\n\n${scanUrl}`

        // Send via WhatsApp gateway (getouch uses imageUrl format)
        console.log(`[RoadTour QR WA][${reqId}] calling gateway POST /messages/send-image`)
        const result = await callGateway(
            config.baseUrl,
            config.apiKey,
            'POST',
            '/messages/send-image',
            { to: recipientDigits, imageUrl, caption },
            config.tenantId,
        )

        console.log(`[RoadTour QR WA][${reqId}] gateway response:`, JSON.stringify(result))
        console.log(`[RoadTour QR WA][${reqId}] === REQUEST END (success) ===`)

        return NextResponse.json({
            ok: true,
            messageId: result?.messageId || result?.message_id || null,
        })
    } catch (error: any) {
        console.error(`[RoadTour QR WA][${reqId}] === REQUEST END (error) ===`, error?.message || error)
        return NextResponse.json(
            { error: error?.message || 'Failed to send QR via WhatsApp', step: 'gateway_send_image' },
            { status: 500 },
        )
    }
}
