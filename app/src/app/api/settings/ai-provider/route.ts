import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getHrAuthContext, canManageHr } from '@/lib/server/hrAccess'
import { getProviderSettings, getActiveProviderForOrg } from '@/lib/server/ai/providerSettings'
import { encryptSecret, buildTokenHint } from '@/lib/server/ai/secrets'

export const dynamic = 'force-dynamic'

// ── GET: Return current org AI provider settings (no token) ──────

export async function GET() {
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

    // Must be admin
    const isAdmin = await canManageHr(ctx)
    if (!isAdmin) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const admin = createAdminClient()

    // Get the ACTIVE provider (most recently saved) for this org
    const settings = await getActiveProviderForOrg(admin, ctx.organizationId)

    if (!settings) {
      return NextResponse.json({
        provider: 'openclaw',
        baseUrl: null,
        tokenHint: null,
        chatPath: null,
        model: null,
        enabled: false,
        source: 'none',
      })
    }

    return NextResponse.json(settings)
  } catch (err: any) {
    console.error('[AI Provider Settings GET]', err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// ── POST: Create or update AI provider settings ──────────────────

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
    const {
      provider = 'openclaw',
      baseUrl,
      token,
      chatPath,
      model,
      enabled = true,
      clearToken = false,
    } = body as {
      provider?: string
      baseUrl?: string
      token?: string
      chatPath?: string
      model?: string
      enabled?: boolean
      clearToken?: boolean
    }

    // Validate provider
    const validProviders = ['openclaw', 'moltbot', 'openai', 'ollama']
    if (!validProviders.includes(provider)) {
      return NextResponse.json({ error: 'Invalid provider' }, { status: 400 })
    }

    // Validate baseUrl format (if provided)
    if (baseUrl) {
      try {
        new URL(baseUrl)
      } catch {
        return NextResponse.json({ error: 'Invalid base URL format' }, { status: 400 })
      }
    }

    const admin = createAdminClient()

    // Build upsert payload
    const upsertData: Record<string, unknown> = {
      organization_id: ctx.organizationId,
      provider,
      base_url: baseUrl ?? null,
      chat_path: chatPath ?? null,
      model: model ?? null,
      is_enabled: enabled,
      updated_by: ctx.userId,
    }

    // Handle token
    if (clearToken) {
      upsertData.token_encrypted = null
      upsertData.token_hint = null
    } else if (token && token.trim().length > 0) {
      // Encrypt and store
      upsertData.token_encrypted = encryptSecret(token.trim())
      upsertData.token_hint = buildTokenHint(token.trim())
    }
    // If token is empty string and clearToken is false, don't touch token columns

    // Cast to any because types/database.ts hasn't been regenerated yet
    const { error: upsertError } = await (admin as any)
      .from('ai_provider_settings')
      .upsert(upsertData, {
        onConflict: 'organization_id,provider',
      })

    if (upsertError) {
      console.error('[AI Provider Settings POST] Upsert error:', upsertError.message)
      return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 })
    }

    // Return updated settings (without token)
    const updated = await getProviderSettings(admin, ctx.organizationId, provider)

    return NextResponse.json({
      success: true,
      data: updated,
    })
  } catch (err: any) {
    console.error('[AI Provider Settings POST]', err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
