/**
 * RoadTour Send QR using the organization's configured notification route.
 * 
 * POST /api/roadtour/send-qr-whatsapp
 * The legacy URL is retained for compatibility, but delivery honors the
 * Notification Types route saved for QR notifications.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getWhatsAppConfig, isAdminUser, sendWhatsAppMessage } from '@/app/api/settings/whatsapp/_utils'
import { buildRoadTourUrl } from '@/lib/roadtour/url'
import { resolveRoadtourByToken } from '@/lib/roadtour/server'
import { resolveNotificationRoutingPreset } from '@/lib/notifications/routing'

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

        if (!token) {
            return NextResponse.json({ error: 'Token is required' }, { status: 400 })
        }

        // Build URLs
        const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://stg.serapod2u.com'
        const qrRecord = await resolveRoadtourByToken(token)
        if (!qrRecord || qrRecord.org_id !== userProfile.organization_id) {
            return NextResponse.json({ error: 'RoadTour QR not found for this organization' }, { status: 404 })
        }
        const scanUrl = buildRoadTourUrl(appBaseUrl, qrRecord?.canonical_path || null) || `${appBaseUrl}/scan?rt=${token}`
        const imageUrl = `${appBaseUrl}/api/roadtour/qr-image/${token}`

        const { data: routingSetting } = await (supabase as any)
            .from('notification_settings')
            .select('channels_enabled, recipient_config')
            .eq('org_id', userProfile.organization_id)
            .eq('event_code', 'qr_batch_generated')
            .maybeSingle()
        // RoadTour manual QR delivery has no per-event override yet, so use the
        // saved Default Delivery Method rather than borrowing QR Batch's override.
        const routingPreset = resolveNotificationRoutingPreset(routingSetting, true)

        if (routingPreset === 'email_only') {
            if (!qrRecord.account_manager_email) {
                return NextResponse.json({ error: 'Reference has no email address for Email Only delivery' }, { status: 400 })
            }

            const { data: emailProvider } = await (supabase as any)
                .from('notification_provider_configs')
                .select('provider_name')
                .eq('org_id', userProfile.organization_id)
                .eq('channel', 'email')
                .eq('is_active', true)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle()
            if (!emailProvider) {
                return NextResponse.json({ error: 'Email provider not configured' }, { status: 400 })
            }

            const { data: queued, error: queueError } = await (supabase as any)
                .from('notifications_outbox')
                .insert({
                    org_id: userProfile.organization_id,
                    event_code: 'roadtour_qr_delivery',
                    channel: 'email',
                    to_phone: null,
                    to_email: qrRecord.account_manager_email,
                    template_code: null,
                    payload_json: {
                        campaign_name: campaignName || qrRecord.campaign_name,
                        reference_name: userName || qrRecord.account_manager_name,
                        qr_url: scanUrl,
                        qr_image_url: imageUrl,
                    },
                    priority: 'normal',
                    provider_name: emailProvider.provider_name,
                    status: 'queued',
                    retry_count: 0,
                    max_retries: 3,
                })
                .select('id')
                .single()
            if (queueError || !queued) {
                return NextResponse.json({ error: queueError?.message || 'Failed to queue QR email' }, { status: 500 })
            }

            return NextResponse.json({ ok: true, channel: 'email', queued: true, recipient: qrRecord.account_manager_email })
        }

        if (routingPreset === 'sms_only') {
            return NextResponse.json({ error: 'SMS delivery is selected but no RoadTour QR SMS sender is configured' }, { status: 400 })
        }

        const effectivePhone = phone || qrRecord.account_manager_phone
        if (!effectivePhone) {
            return NextResponse.json({ error: 'Reference has no phone number for WhatsApp delivery' }, { status: 400 })
        }
        const config = await getWhatsAppConfig(supabase, userProfile.organization_id)
        if (!config) {
            return NextResponse.json({ error: 'No default WhatsApp provider configured' }, { status: 400 })
        }

        const recipientDigits = String(effectivePhone).replace(/^\+/, '')
        console.log(`[RoadTour QR WA][${reqId}] imageUrl=${imageUrl}`)
        console.log(`[RoadTour QR WA][${reqId}] recipientDigits=${recipientDigits}`)
        console.log(`[RoadTour QR WA][${reqId}] provider=${config.providerName}`)

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
        const sent = await sendWhatsAppMessage(supabase, userProfile.organization_id, {
            to: recipientDigits,
            text: caption,
            imageUrl,
            caption,
        })
        const result = sent.response

        console.log(`[RoadTour QR WA][${reqId}] gateway response:`, JSON.stringify(result))
        console.log(`[RoadTour QR WA][${reqId}] === REQUEST END (success) ===`)

        return NextResponse.json({
            ok: true,
            channel: 'whatsapp',
            recipient: effectivePhone,
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
