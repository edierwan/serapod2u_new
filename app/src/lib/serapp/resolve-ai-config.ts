import { createAdminClient } from '@/lib/supabase/admin'
import {
  getDefaultProvider,
  getMoltbotConfig,
  getOllamaConfig,
  getOpenaiConfig,
} from '@/lib/ai/config'
import type { AiProvider, AiProviderConfig } from '@/lib/ai/types'
import { decryptSecret } from '@/lib/server/ai/secrets'

type DbProviderRow = {
  provider: string
  base_url: string | null
  token_encrypted: string | null
  model: string | null
  is_enabled: boolean
}

async function loadEnabledDbProvider(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
): Promise<AiProviderConfig | null> {
  const { data } = await admin
    .from('ai_provider_settings')
    .select('provider, base_url, token_encrypted, model, is_enabled')
    .eq('organization_id', organizationId)
    .eq('is_enabled', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const row = data as DbProviderRow | null
  if (!row?.base_url) return null

  const provider = row.provider as AiProvider
  let token = ''
  if (row.token_encrypted) {
    try {
      token = decryptSecret(row.token_encrypted)
    } catch {
      token = ''
    }
  }
  if (!token && provider === 'ollama') {
    token = process.env.OLLAMA_TOKEN || ''
  }

  return {
    provider,
    baseUrl: row.base_url.replace(/\/+$/, ''),
    token,
    enabled: true,
    model: row.model ?? undefined,
  }
}

function firstEnabledEnvProvider(): AiProviderConfig | null {
  for (const loader of [getOpenaiConfig, getOllamaConfig, getMoltbotConfig]) {
    const config = loader()
    if (config.enabled) return config
  }
  return null
}

/**
 * SerApp AI config resolution:
 * 1) Distributor org DB settings
 * 2) HQ parent DB settings (DIST only)
 * 3) .env providers (OPENAI_API_KEY, OLLAMA_BASE_URL, …)
 */
export async function resolveSerappAiConfig(organizationId: string): Promise<AiProviderConfig> {
  const admin = createAdminClient()

  const directDb = await loadEnabledDbProvider(admin, organizationId)
  if (directDb) return directDb

  const { data: org } = await admin
    .from('organizations')
    .select('parent_org_id, org_type_code')
    .eq('id', organizationId)
    .maybeSingle()

  if (org?.parent_org_id && org.org_type_code === 'DIST') {
    const hqDb = await loadEnabledDbProvider(admin, org.parent_org_id)
    if (hqDb) return hqDb
  }

  const fromEnv = firstEnabledEnvProvider()
  if (fromEnv) return fromEnv

  return {
    provider: getDefaultProvider(),
    baseUrl: '',
    token: '',
    enabled: false,
  }
}
