/**
 * AI Provider configuration and environment validation
 */
import { type AiProvider, type AiProviderConfig } from './types'

// ─── Environment helpers ───────────────────────────────────────────

function env(key: string): string {
  return process.env[key] ?? ''
}

function envRequired(key: string, context: string): string {
  const val = process.env[key]
  if (!val) {
    console.warn(`[AI Config] Missing env var ${key} for ${context}`)
  }
  return val ?? ''
}

// ─── Provider configs ──────────────────────────────────────────────

export function getMoltbotConfig(): AiProviderConfig {
  const baseUrl = env('MOLTBOT_ADAPTER_URL')
  const token = env('MOLTBOT_ADAPTER_TOKEN')
  return {
    provider: 'moltbot',
    baseUrl: baseUrl.replace(/\/+$/, ''),
    token,
    enabled: !!baseUrl,
  }
}

export function getOllamaConfig(): AiProviderConfig {
  const baseUrl = env('OLLAMA_BASE_URL') || 'http://127.0.0.1:11434'
  const model = env('OLLAMA_MODEL') || 'qwen2.5:3b'
  const token = env('OLLAMA_TOKEN') // Auth token for Ollama proxy (x-ollama-key header)
  return {
    provider: 'ollama',
    baseUrl: baseUrl.replace(/\/+$/, ''),
    token,
    enabled: !!env('OLLAMA_BASE_URL'),
    model,
  }
}

// ─── Default provider selection ────────────────────────────────────

/**
 * Override per-tenant or per-request.
 * Priority: explicit > env AI_DEFAULT_PROVIDER > first available
 */
export function getDefaultProvider(): AiProvider {
  const explicit = env('AI_DEFAULT_PROVIDER') as AiProvider
  if (explicit === 'moltbot' || explicit === 'ollama') return explicit

  const ol = getOllamaConfig()
  if (ol.enabled) return 'ollama'

  const mb = getMoltbotConfig()
  if (mb.enabled) return 'moltbot'

  return 'ollama' // fallback — Ollama is the only supported provider
}

export function getProviderConfig(provider?: AiProvider): AiProviderConfig {
  const p = provider ?? getDefaultProvider()
  if (p === 'moltbot') return getMoltbotConfig()
  return getOllamaConfig()
}

export function isAnyProviderAvailable(): boolean {
  return getMoltbotConfig().enabled || getOllamaConfig().enabled
}
