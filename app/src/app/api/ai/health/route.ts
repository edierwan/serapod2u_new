import { NextResponse } from 'next/server'
import { getMoltbotConfig, getOllamaConfig, getDefaultProvider } from '@/lib/ai/config'
import { checkOllamaHealth } from '@/lib/ai/providers/ollama'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getHrAuthContext } from '@/lib/server/hrAccess'
import { resolveProviderConfig } from '@/lib/server/ai/providerSettings'

export const dynamic = 'force-dynamic'

/**
 * GET /api/ai/health
 *
 * Returns the connectivity status of configured AI providers.
 * Resolves settings from DB first, then falls back to .env.
 * Does NOT expose tokens — only base URLs and boolean status.
 */
export async function GET() {
  const defaultProvider = getDefaultProvider()

  // Try to resolve org-specific settings from DB
  let resolvedOllamaCfg = getOllamaConfig()
  let ollamaSettingsSource: 'db' | 'env' = 'env'

  try {
    const supabase = await createClient()
    const authResult = await getHrAuthContext(supabase)
    if (authResult.success && authResult.data?.organizationId) {
      const admin = createAdminClient()

      // Resolve Ollama config
      const dbOllamaConfig = await resolveProviderConfig(admin, authResult.data.organizationId, 'ollama')
      if (dbOllamaConfig.enabled && dbOllamaConfig.baseUrl) {
        resolvedOllamaCfg = dbOllamaConfig
        ollamaSettingsSource = 'db'
      }
    }
  } catch {
    // Fallback to .env — no-op
  }

  const moltbotCfg = getMoltbotConfig()

  // --- Ollama health ---
  let ollama: {
    configured: boolean
    ok: boolean
    hint: string
    baseUrl: string | null
    model: string | null
    models: string[]
    source: string
  } = {
    configured: resolvedOllamaCfg.enabled,
    ok: false,
    hint: 'Not configured',
    baseUrl: resolvedOllamaCfg.baseUrl || null,
    model: resolvedOllamaCfg.model || null,
    models: [],
    source: ollamaSettingsSource,
  }

  if (resolvedOllamaCfg.enabled) {
    const health = await checkOllamaHealth(resolvedOllamaCfg)
    ollama = {
      configured: true,
      ok: health.ok,
      hint: health.hint,
      baseUrl: resolvedOllamaCfg.baseUrl || null,
      model: resolvedOllamaCfg.model || null,
      models: health.models,
      source: ollamaSettingsSource,
    }
  }

  // --- Moltbot health (simple config check for now) ---
  const moltbot = {
    configured: moltbotCfg.enabled,
    ok: moltbotCfg.enabled,
    hint: moltbotCfg.enabled ? 'Configured' : 'Not configured',
    baseUrl: moltbotCfg.baseUrl || null,
  }

  const anyAvailable = moltbotCfg.enabled || resolvedOllamaCfg.enabled

  // Overall status — check the currently selected default provider
  const overallOk =
    (defaultProvider === 'moltbot' && moltbot.ok) ||
    (defaultProvider === 'ollama' && ollama.ok) ||
    (moltbot.ok || ollama.ok)

  return NextResponse.json({
    ok: overallOk,
    defaultProvider,
    anyProviderAvailable: anyAvailable,
    providers: {
      moltbot,
      ollama,
    },
    ts: new Date().toISOString(),
  })
}
