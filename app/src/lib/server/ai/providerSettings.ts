/**
 * Resolve AI provider settings for an organization.
 *
 * Priority:
 *   1. DB row in `ai_provider_settings` for the org (if enabled)
 *   2. Fallback to .env values (OLLAMA_BASE_URL, etc.)
 *
 * Token is decrypted server-side and NEVER returned to the client.
 */
import 'server-only'
import { type AiProviderConfig, type AiProvider } from '@/lib/ai/types'
import { getMoltbotConfig, getOllamaConfig, getDefaultProvider } from '@/lib/ai/config'
import { decryptSecret } from './secrets'

export interface DbProviderRow {
  id: string
  organization_id: string
  provider: string
  base_url: string | null
  token_encrypted: string | null
  token_hint: string | null
  chat_path: string | null
  model: string | null
  is_enabled: boolean
  updated_at: string
}

/**
 * Resolve an AiProviderConfig for a specific org.
 * Uses service-role client to bypass RLS and read encrypted token.
 * If no provider is specified, auto-detects the active (most recently saved) provider.
 *
 * STRICT RESOLUTION ORDER:
 *   1. DB row in `ai_provider_settings` for the org (if enabled)
 *   2. Fallback to .env values ONLY for the same provider (never swap provider)
 *   3. If provider not enabled in .env either → return disabled config
 */
export async function resolveProviderConfig(
  adminClient: any, // SupabaseClient with service-role
  organizationId: string,
  provider?: AiProvider,
): Promise<AiProviderConfig> {
  // If no provider specified, auto-detect from DB (most recently saved)
  let targetProvider = provider
  let resolvedFromDb = false

  if (!targetProvider) {
    try {
      const { data: activeRow } = await (adminClient as any)
        .from('ai_provider_settings')
        .select('provider, is_enabled')
        .eq('organization_id', organizationId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .single()

      if (activeRow?.provider) {
        targetProvider = activeRow.provider as AiProvider

        // If admin explicitly disabled AI assistant, return disabled config immediately
        if (!activeRow.is_enabled) {
          console.log(`[AI Settings] Provider ${targetProvider} is DISABLED by admin for org ${organizationId.slice(0, 8)}…`)
          return {
            provider: targetProvider,
            baseUrl: '',
            token: '',
            enabled: false,
          }
        }
      }
    } catch {
      // no rows — fall through to env default
    }
  }

  if (!targetProvider) {
    targetProvider = getDefaultProvider()
    console.log(`[AI Settings] No DB provider for org ${organizationId.slice(0, 8)}… — using env default: ${targetProvider}`)
  }

  // Try to get full config from DB
  try {
    const { data, error } = await (adminClient as any)
      .from('ai_provider_settings')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('provider', targetProvider)
      .eq('is_enabled', true)
      .single()

    if (!error && data && data.base_url) {
      const row = data as DbProviderRow
      let token = ''
      if (row.token_encrypted) {
        try {
          token = decryptSecret(row.token_encrypted)
        } catch (err) {
          console.error('[AI Settings] Failed to decrypt token for org', organizationId.slice(0, 8))
        }
      }

      resolvedFromDb = true
      console.log(`[AI Settings] Resolved ${targetProvider} from DB for org ${organizationId.slice(0, 8)}… baseUrl=${row.base_url?.slice(0, 40)}`)

      return {
        provider: targetProvider,
        baseUrl: (row.base_url ?? '').replace(/\/+$/, ''),
        token,
        enabled: true,
        model: row.model ?? undefined,
      }
    }
  } catch {
    // DB lookup failed, fall through to env
  }

  // Fallback to .env — but ONLY for the SAME provider, never swap
  console.log(`[AI Settings] No DB config for ${targetProvider}, falling back to .env`)
  if (targetProvider === 'moltbot') return getMoltbotConfig()
  return getOllamaConfig()
}

/**
 * Get the DB settings row for display (no decrypted token).
 * Returns null if no row exists.
 */
export async function getProviderSettings(
  adminClient: any,
  organizationId: string,
  provider?: string,
): Promise<{
  provider: string
  baseUrl: string | null
  tokenHint: string | null
  chatPath: string | null
  model: string | null
  enabled: boolean
  updatedAt: string | null
  source: 'db' | 'env'
} | null> {
  const targetProvider = provider ?? getDefaultProvider()

  try {
    const { data, error } = await (adminClient as any)
      .from('ai_provider_settings')
      .select('provider, base_url, token_hint, chat_path, model, is_enabled, updated_at')
      .eq('organization_id', organizationId)
      .eq('provider', targetProvider)
      .single()

    if (!error && data) {
      return {
        provider: data.provider,
        baseUrl: data.base_url,
        tokenHint: data.token_hint,
        chatPath: data.chat_path,
        model: data.model ?? null,
        enabled: data.is_enabled,
        updatedAt: data.updated_at,
        source: 'db',
      }
    }
  } catch {
    // no row
  }

  // Return env-based defaults
  if (targetProvider === 'ollama') {
    const envConfig = getOllamaConfig()
    return {
      provider: targetProvider,
      baseUrl: envConfig.baseUrl || null,
      tokenHint: null,
      chatPath: null,
      model: envConfig.model || 'qwen2.5:3b',
      enabled: envConfig.enabled,
      updatedAt: null,
      source: 'env',
    }
  }

  const envConfig = targetProvider === 'moltbot' ? getMoltbotConfig() : getOllamaConfig()
  if (envConfig.enabled) {
    return {
      provider: targetProvider,
      baseUrl: envConfig.baseUrl || null,
      tokenHint: envConfig.token ? '****' + envConfig.token.slice(-4) : null,
      chatPath: null,
      model: null,
      enabled: true,
      updatedAt: null,
      source: 'env',
    }
  }

  return null
}

/**
 * Get the ACTIVE (most recently updated) provider for an org.
 * This is used by the GET endpoint and by module assistants to determine
 * which provider the admin selected, regardless of env defaults.
 */
export async function getActiveProviderForOrg(
  adminClient: any,
  organizationId: string,
): Promise<{
  provider: string
  baseUrl: string | null
  tokenHint: string | null
  chatPath: string | null
  model: string | null
  enabled: boolean
  updatedAt: string | null
  source: 'db' | 'env' | 'none'
} | null> {
  try {
    // Get the most recently updated provider row for this org
    const { data, error } = await (adminClient as any)
      .from('ai_provider_settings')
      .select('provider, base_url, token_hint, chat_path, model, is_enabled, updated_at')
      .eq('organization_id', organizationId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single()

    if (!error && data) {
      return {
        provider: data.provider,
        baseUrl: data.base_url,
        tokenHint: data.token_hint,
        chatPath: data.chat_path,
        model: data.model ?? null,
        enabled: data.is_enabled,
        updatedAt: data.updated_at,
        source: 'db',
      }
    }
  } catch {
    // no rows
  }

  // Fallback: check env defaults
  const defaultProv = getDefaultProvider()
  const fallback = await getProviderSettings(adminClient, organizationId, defaultProv)
  return fallback
}

/**
 * Resolve the active provider name for an org (for module assistants).
 * Returns the provider string from the most recent DB row, or env default.
 */
export async function resolveActiveProvider(
  adminClient: any,
  organizationId: string,
): Promise<AiProvider> {
  try {
    const { data, error } = await (adminClient as any)
      .from('ai_provider_settings')
      .select('provider')
      .eq('organization_id', organizationId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single()

    if (!error && data?.provider) {
      return data.provider as AiProvider
    }
  } catch {
    // no rows
  }

  return getDefaultProvider()
}
