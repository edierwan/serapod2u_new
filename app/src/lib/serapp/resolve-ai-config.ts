import { createAdminClient } from '@/lib/supabase/admin'
import { getOpenaiConfig, getDefaultProvider } from '@/lib/ai/config'
import { resolveProviderConfig } from '@/lib/server/ai/providerSettings'
import type { AiProviderConfig } from '@/lib/ai/types'

/**
 * SerApp distributors inherit HQ AI settings when their own org has none.
 */
export async function resolveSerappAiConfig(organizationId: string): Promise<AiProviderConfig> {
  const admin = createAdminClient()

  const direct = await resolveProviderConfig(admin, organizationId)
  if (direct.enabled) return direct

  const { data: org } = await admin
    .from('organizations')
    .select('parent_org_id, org_type_code')
    .eq('id', organizationId)
    .maybeSingle()

  if (org?.parent_org_id && org.org_type_code === 'DIST') {
    const hqConfig = await resolveProviderConfig(admin, org.parent_org_id)
    if (hqConfig.enabled) return hqConfig
  }

  // Last resort: env OpenAI key for dev/staging
  const openai = getOpenaiConfig()
  if (openai.enabled) return openai

  return {
    provider: getDefaultProvider(),
    baseUrl: '',
    token: '',
    enabled: false,
  }
}
