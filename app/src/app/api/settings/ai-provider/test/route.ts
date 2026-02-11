import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getHrAuthContext, canManageHr } from '@/lib/server/hrAccess'
import { checkOllamaHealth } from '@/lib/ai/providers/ollama'
import { decryptSecret } from '@/lib/server/ai/secrets'

export const dynamic = 'force-dynamic'

/**
 * POST /api/settings/ai-provider/test
 *
 * Test connection using the form values sent from the UI.
 * If no token is provided in the form, falls back to the saved
 * encrypted token from the DB (so "Test Connection" works after saving).
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

        // If no token provided in form, try to retrieve saved token from DB
        let resolvedToken = token || ''
        if (!resolvedToken) {
            try {
                const admin = createAdminClient()
                const { data: row } = await (admin as any)
                    .from('ai_provider_settings')
                    .select('token_encrypted')
                    .eq('organization_id', ctx.organizationId)
                    .eq('provider', provider)
                    .maybeSingle()

                if (row?.token_encrypted) {
                    resolvedToken = decryptSecret(row.token_encrypted)
                }
            } catch (e: any) {
                console.warn('[AI Provider Test] Could not load saved token:', e.message)
            }
        }

        // ── Ollama test ──────────────────────────────────────────────
        if (provider === 'ollama') {
            const testUrl = (baseUrl || 'https://bot.serapod2u.com/ollama').replace(/\/+$/, '')
            const testModel = model || 'qwen2.5:3b'

            const health = await checkOllamaHealth({
                provider: 'ollama',
                baseUrl: testUrl,
                token: resolvedToken,  // Proxy auth token (x-ollama-key) — from form or DB
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
