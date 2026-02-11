import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getHrAuthContext, canManageHr } from '@/lib/server/hrAccess'
import { checkOpenClawHealth } from '@/lib/ai/providers/openclaw'
import { checkOllamaHealth } from '@/lib/ai/providers/ollama'

export const dynamic = 'force-dynamic'

/**
 * POST /api/settings/ai-provider/test
 *
 * Test connection using the form values sent from the UI,
 * NOT the saved DB config. This lets users test before saving.
 */
export async function POST(request: Request) {
    try {
        const supabase = await createClient()
        const authResult = await getHrAuthContext(supabase)
        if (!authResult.success || !authResult.data) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const ctx = authResult.data
        if (!ctx.organizationId) {
            return NextResponse.json({ error: 'No organization' }, { status: 400 })
        }

        const isAdmin = await canManageHr(ctx)
        if (!isAdmin) {
            return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
        }

        const body = await request.json()
        const { provider, baseUrl, token, model } = body as {
            provider: string
            baseUrl?: string
            token?: string
            model?: string
        }

        if (!provider) {
            return NextResponse.json({ error: 'Provider is required' }, { status: 400 })
        }

        // ── Ollama test ──────────────────────────────────────────────
        if (provider === 'ollama') {
            const testUrl = (baseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '')
            const testModel = model || 'qwen2.5:3b'

            const health = await checkOllamaHealth({
                provider: 'ollama',
                baseUrl: testUrl,
                token: token || '',  // Proxy auth token (x-ollama-key)
                enabled: true,
                model: testModel,
            })

            return NextResponse.json({
                ok: health.ok,
                provider: 'ollama',
                hint: health.hint,
                models: health.models,
                baseUrl: testUrl,
                model: testModel,
            })
        }

        // ── OpenClaw test ────────────────────────────────────────────
        if (provider === 'openclaw') {
            const testUrl = (baseUrl || '').replace(/\/+$/, '')
            if (!testUrl) {
                return NextResponse.json({
                    ok: false,
                    provider: 'openclaw',
                    hint: 'Base URL is required for OpenClaw.',
                })
            }

            const health = await checkOpenClawHealth({
                provider: 'openclaw',
                baseUrl: testUrl,
                token: token || '',
                enabled: true,
            })

            return NextResponse.json({
                ok: health.ok,
                provider: 'openclaw',
                hint: health.hint,
                authenticated: health.authenticated,
                baseUrl: testUrl,
            })
        }

        return NextResponse.json({
            ok: false,
            provider,
            hint: `Provider "${provider}" does not support test connection yet.`,
        })
    } catch (err: any) {
        console.error('[AI Provider Test]', err.message)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
