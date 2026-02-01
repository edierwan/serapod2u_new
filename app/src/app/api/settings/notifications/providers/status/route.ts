import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Gateway and Moltbot URLs from env - server-side only
const GATEWAY_URL = process.env.BAILEYS_GATEWAY_URL || process.env.NEXT_PUBLIC_GATEWAY_URL || 'https://wa.serapod2u.com'
const MOLTBOT_URL = process.env.MOLTBOT_URL || 'https://bot.serapod2u.com'

interface ServiceHealth {
    up: boolean
    latencyMs: number
    error?: string
}

interface StatusResponse {
    whatsappGateway: ServiceHealth
    moltbot: ServiceHealth
    checkedAt: string
}

// GET /api/settings/notifications/providers/status - Server-side health check
export async function GET(request: NextRequest) {
    try {
        // Authenticate user (optional but good practice)
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Fetch both health endpoints in parallel with timeout
        const [gatewayResult, moltbotResult] = await Promise.allSettled([
            fetchWithTimeout(`${GATEWAY_URL}/health`, 5000),
            fetchWithTimeout(`${MOLTBOT_URL}/health`, 5000)
        ])

        const response: StatusResponse = {
            whatsappGateway: processResult(gatewayResult),
            moltbot: processResult(moltbotResult),
            checkedAt: new Date().toISOString()
        }

        // Set cache headers - no store to prevent caching
        return NextResponse.json(response, {
            headers: {
                'Cache-Control': 'no-store, max-age=0'
            }
        })
    } catch (error: any) {
        console.error('Status check error:', error)
        return NextResponse.json({
            error: 'Failed to check service status'
        }, { status: 500 })
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

function processResult(result: PromiseSettledResult<FetchResult>): ServiceHealth {
    if (result.status === 'fulfilled') {
        return {
            up: result.value.ok,
            latencyMs: result.value.latencyMs,
            error: result.value.error
        }
    }

    return {
        up: false,
        latencyMs: 0,
        error: 'fetch_failed'
    }
}
