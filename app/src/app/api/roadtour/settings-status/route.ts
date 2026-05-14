/**
 * RoadTour Settings Status
 *
 * GET /api/roadtour/settings-status
 * Returns the lightweight readiness flags shown on the simplified RoadTour
 * Settings page (RoadTour program enabled, WhatsApp gateway configured/healthy).
 *
 * Read-only. Requires authenticated org user.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getWhatsAppConfig, callGateway } from '@/app/api/settings/whatsapp/_utils'

export const dynamic = 'force-dynamic'

type WhatsappStatus = 'ready' | 'not_configured' | 'session_issue'

export async function GET() {
    try {
        const supabase = await createClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { data: profile } = await supabase
            .from('users')
            .select('organization_id')
            .eq('id', user.id)
            .single()

        const orgId = profile?.organization_id
        if (!orgId) {
            return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
        }

        const { data: settings } = await (supabase as any)
            .from('roadtour_settings')
            .select('is_enabled, whatsapp_send_enabled')
            .eq('org_id', orgId)
            .maybeSingle()

        const isEnabled = settings?.is_enabled !== false
        const whatsappFlag = settings?.whatsapp_send_enabled !== false

        let whatsappStatus: WhatsappStatus = 'not_configured'
        let whatsappError: string | null = null

        try {
            const config = await getWhatsAppConfig(supabase, orgId)
            if (!config?.baseUrl || !config?.apiKey) {
                whatsappStatus = 'not_configured'
            } else {
                // Best-effort session probe; do not fail the request on probe error.
                try {
                    const result: any = await callGateway(
                        config.baseUrl,
                        config.apiKey,
                        'GET',
                        '/status',
                        undefined,
                        config.tenantId,
                    )

                    const isGetouchGateway = result?.state !== undefined
                    const connected = isGetouchGateway
                        ? result?.state === 'open' && result?.authenticated === true
                        : result?.connected === true || result?.pairing_state === 'connected'

                    whatsappStatus = connected ? 'ready' : 'session_issue'
                } catch (probeErr: any) {
                    whatsappStatus = 'session_issue'
                    whatsappError = probeErr?.message || 'Unable to reach WhatsApp gateway'
                }
            }
        } catch (err: any) {
            whatsappStatus = 'not_configured'
            whatsappError = err?.message || null
        }

        return NextResponse.json({
            roadtour: {
                enabled: isEnabled,
                system_defaults: 'enabled',
            },
            whatsapp: {
                send_enabled_flag: whatsappFlag,
                status: whatsappStatus,
                error: whatsappError,
            },
            geolocation: { status: 'enabled' },
            secure_claim: { status: 'login_and_shop_required' },
            locked_defaults: {
                qr_mode: 'persistent',
                duplicate_rule_reward: 'one_per_user_per_campaign',
                official_visit_rule: 'one_per_shop_per_am_per_day',
                require_login: true,
                require_shop_context: true,
                require_geolocation: true,
                whatsapp_send_enabled: true,
            },
        })
    } catch (err: any) {
        return NextResponse.json({ error: err?.message || 'Failed to load status' }, { status: 500 })
    }
}
