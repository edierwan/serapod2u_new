import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Gateway and Moltbot URLs from env
const GATEWAY_URL = process.env.BAILEYS_GATEWAY_URL || process.env.NEXT_PUBLIC_GATEWAY_URL || 'https://wa.serapod2u.com'
const MOLTBOT_URL = process.env.MOLTBOT_URL || 'http://localhost:4000'

// Type for user data query result
interface UserData {
    organization_id: string | null
    role_code: string | null
    is_super_admin: boolean | null
}

// GET /api/admin/whatsapp/status - Get gateway and moltbot status
export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient()

        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Get user's org
        const { data: userData } = await supabase
            .from('users')
            .select('organization_id, role_code, is_super_admin')
            .eq('id', user.id)
            .single() as { data: UserData | null, error: any }

        if (!userData?.organization_id) {
            return NextResponse.json({ error: 'No organization found' }, { status: 400 })
        }

        // Fetch gateway and moltbot status in parallel
        const [gatewayResult, moltbotResult] = await Promise.allSettled([
            fetchGatewayStatus(),
            fetchMoltbotStatus()
        ])

        const gateway = gatewayResult.status === 'fulfilled' ? gatewayResult.value : {
            status: 'error',
            error: gatewayResult.reason?.message || 'Failed to connect'
        }

        const moltbot = moltbotResult.status === 'fulfilled' ? moltbotResult.value : {
            status: 'error',
            error: moltbotResult.reason?.message || 'Failed to connect'
        }

        return NextResponse.json({
            ok: true,
            gateway,
            moltbot,
            urls: {
                gateway: GATEWAY_URL,
                moltbot: MOLTBOT_URL
            }
        })
    } catch (error: any) {
        console.error('Failed to fetch status:', error)
        return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 })
    }
}

async function fetchGatewayStatus(): Promise<any> {
    try {
        const response = await fetch(`${GATEWAY_URL}/status`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
            // 5 second timeout
            signal: AbortSignal.timeout(5000)
        })

        if (!response.ok) {
            return { status: 'error', error: `HTTP ${response.status}` }
        }

        const data = await response.json()
        return {
            status: data.connected ? 'connected' : 'disconnected',
            phone: data.phone || data.jid?.replace('@s.whatsapp.net', '') || null,
            pushName: data.pushName || data.name || null,
            connectedSince: data.connectedSince || null,
            version: data.version || null
        }
    } catch (error: any) {
        if (error.name === 'TimeoutError' || error.name === 'AbortError') {
            return { status: 'timeout', error: 'Request timed out' }
        }
        return { status: 'error', error: error.message || 'Connection failed' }
    }
}

async function fetchMoltbotStatus(): Promise<any> {
    try {
        const response = await fetch(`${MOLTBOT_URL}/health`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
            // 5 second timeout
            signal: AbortSignal.timeout(5000)
        })

        if (!response.ok) {
            return { status: 'error', error: `HTTP ${response.status}` }
        }

        const data = await response.json()
        return {
            status: data.status === 'ok' ? 'healthy' : 'degraded',
            uptime: data.uptime || null,
            version: data.version || null,
            features: data.features || null,
            llm: data.llm ? {
                provider: data.llm.provider,
                model: data.llm.model
            } : null
        }
    } catch (error: any) {
        if (error.name === 'TimeoutError' || error.name === 'AbortError') {
            return { status: 'timeout', error: 'Request timed out' }
        }
        return { status: 'error', error: error.message || 'Connection failed' }
    }
}
