import fs from 'fs'
import { createClient } from '@supabase/supabase-js'

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^([^=]+)=(.*)$/)
    if (!m) continue
    env[m[1].trim()] = m[2].trim()
  }
  return env
}

async function main() {
  const env = loadEnv()
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

  const { data: distOrg } = await admin
    .from('organizations')
    .select('id, org_code, parent_org_id')
    .eq('org_code', 'DIST-TESTAPP')
    .maybeSingle()

  console.log('DIST-TESTAPP:', distOrg)

  const orgIds = [distOrg?.id, distOrg?.parent_org_id].filter(Boolean) as string[]
  for (const orgId of orgIds) {
    const { data } = await admin
      .from('ai_provider_settings')
      .select('organization_id, provider, is_enabled, base_url, model, updated_at')
      .eq('organization_id', orgId)
    console.log(`ai_provider_settings (${orgId}):`, data)
  }

  console.log('Env:')
  console.log('  OLLAMA_BASE_URL:', env.OLLAMA_BASE_URL || '(not set)')
  console.log('  AI_DEFAULT_PROVIDER:', env.AI_DEFAULT_PROVIDER || '(not set)')
  console.log('  OPENAI_API_KEY:', env.OPENAI_API_KEY ? '(set)' : '(not set)')

  if (env.OLLAMA_BASE_URL) {
    try {
      const res = await fetch(`${env.OLLAMA_BASE_URL.replace(/\/+$/, '')}/api/tags`)
      const body = await res.json().catch(() => ({}))
      console.log('Ollama /api/tags:', res.status, res.ok, 'models:', (body.models || []).map((m: { name: string }) => m.name).slice(0, 5))
    } catch (error) {
      console.log('Ollama unreachable:', error instanceof Error ? error.message : error)
    }
  }

  if (distOrg?.id) {
    const { resolveSerappAiConfig } = await import('../src/lib/serapp/resolve-ai-config')
    const resolved = await resolveSerappAiConfig(distOrg.id)
    console.log('resolveSerappAiConfig:', {
      enabled: resolved.enabled,
      provider: resolved.provider,
      baseUrl: resolved.baseUrl,
      model: resolved.model,
      hasToken: Boolean(resolved.token),
    })
  }
}

main().catch(console.error)
