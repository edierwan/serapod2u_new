import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getWhatsAppConfig, callGateway } from '@/app/api/settings/whatsapp/_utils'

// Moltbot URL from env - server-side only
const MOLTBOT_URL = process.env.MOLTBOT_URL || 'https://bot.serapod2u.com'

interface ServiceHealth {
    up: boolean
    latencyMs: number
    error?: string
    waConnected?: boolean
}

interface StatusResponse {
    whatsappGateway: ServiceHealth
    moltbot: ServiceHealth
    checkedAt: string
}

// GET /api/settings/notifications/providers/status - Server-side health check
export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Get user org for WhatsApp config lookup
        const { data: profile } = await supabase
            .from('users')
            .select('organization_id')
            .eq('id', user.id)
            .single()

        // Check Moltbot health in parallel while we do gateway checks
        const moltbotPromise = fetchWithTimeout(`${MOLTBOT_URL}/health`, 5000)

        let gatewayHealth: ServiceHealth
        const startTime = Date.now()

        if (profile?.organization_id) {
            // Load org-specific gateway config and call /status directly
            // This avoids unreliable self-referential HTTP calls
            const config = await getWhatsAppConfig(supabase, profile.organization_id)

            if (config?.baseUrl) {
                try {
                    const gatewayStatus = await callGateway(
                        config.baseUrl,
                        config.apiKey,
                        'GET',
                        '/status',
                        undefined,
                        config.tenantId
                    )
                    const latencyMs = Date.now() - startTime
                    // Determine if the gateway is actually connected
                    const isGetouch = gatewayStatus.state !== undefined
                    const connected = isGetouch
                        ? gatewayStatus.state === 'open' && gatewayStatus.authenticated === true
                        : !!gatewayStatus.connected

                    gatewayHealth = {
                        up: true,
                        latencyMs,
                        waConnected: connected,
                    }
                } catch (err: any) {
                    const latencyMs = Date.now() - startTime
                    const isTimeout = err?.name === 'AbortError' || err?.code === 'ETIMEDOUT'
                    gatewayHealth = {
                        up: false,
                        latencyMs,
                        error: isTimeout ? 'timeout' : 'connection_failed',
                    }
                }
            } else {
                // No config found – gateway not configured
                gatewayHealth = { up: false, latencyMs: 0, error: 'not_configured' }
            }
        } else {
            // No org – fall back to generic healthz probe
            const result = await fetchWithTimeout(
                `${process.env.BAILEYS_GATEWAY_URL || process.env.NEXT_PUBLIC_GATEWAY_URL || 'https://wa.getouch.cloud'}/healthz`,
                5000
            )
            gatewayHealth = {
                up: result.ok,
                latencyMs: result.latencyMs,
                error: result.error,
            }
        }

        const moltbotResult = await moltbotPromise.catch((): FetchResult => ({ ok: false, latencyMs: 0, error: 'fetch_failed' }))

        const response: StatusResponse = {
            whatsappGateway: gatewayHealth,
            moltbot: {
                up: moltbotResult.ok,
                latencyMs: moltbotResult.latencyMs,
                error: moltbotResult.error,
            },
            checkedAt: new Date().toISOString()
        }

        return NextResponse.json(response, {
            headers: { 'Cache-Control': 'no-store, max-age=0' }
        })
    } catch (error: any) {
        console.error('Status check error:', error)
        return NextResponse.json({ error: 'Failed to check service status' }, { status: 500 })
    }
}

interface FetchResult {
    ok: boolean
    latencyMs: number
    data?: any
    error?: string
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<FetchResult> {
    const startTime = Date.now()
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            signal: controller.signal
        })

        clearTimeout(timeoutId)
        const latencyMs = Date.now() - startTime

        if (!response.ok) {
            return {
                ok: false,
                latencyMs,
                error: `HTTP ${response.status}`
            }
        }

        const data = await response.json()
        return {
            ok: true,
            latencyMs,
            data
        }
    } catch (error: any) {
        clearTimeout(timeoutId)
        const latencyMs = Date.now() - startTime

        if (error.name === 'AbortError') {
            return {
                ok: false,
                latencyMs,
                error: 'timeout'
            }
        }

        return {
            ok: false,
            latencyMs,
            error: error.code === 'ECONNREFUSED' ? 'connection_refused' : 'connection_failed'
        }
    }
}
