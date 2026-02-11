/**
 * AI Gateway – unified interface for all AI providers
 *
 * The gateway selects the provider, normalises request/response, and logs
 * (redacted) usage for auditing. This is the ONLY entry-point the rest of
 * the Serapod app should use to talk to AI backends.
 *
 * STRICT PROVIDER ENFORCEMENT:
 *   If the admin selected a provider in the DB settings, we MUST use that
 *   provider exclusively. No silent fallback to another provider (e.g.
 *   OpenClaw) is allowed — that would incur unexpected API costs.
 */
import { type AiChatRequest, type AiResponse, type AiProvider } from './types'
import { getProviderConfig, getDefaultProvider } from './config'
import { callOpenClaw } from './providers/openclaw'
import { callMoltbot } from './providers/moltbot'
import { callOllama } from './providers/ollama'

// ─── Rate limiting (simple in-memory, per deployment) ──────────────

const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_WINDOW_MS = 60_000 // 1 min
const RATE_LIMIT_MAX = 30 // requests per window

function checkRateLimit(userId: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(userId)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }
  if (entry.count >= RATE_LIMIT_MAX) return false
  entry.count++
  return true
}

// ─── Audit logging (redacted) ──────────────────────────────────────

function logAiRequest(
  provider: AiProvider,
  userId: string,
  messagePreview: string,
  ok: boolean,
  source: string,
) {
  const truncated = messagePreview.slice(0, 80).replace(/\n/g, ' ')
  console.log(
    `[AI Gateway] provider=${provider} source=${source} user=${userId.slice(0, 8)}… msg="${truncated}" ok=${ok}`,
  )
}

// ─── System instruction ────────────────────────────────────────────

export const HR_SYSTEM_INSTRUCTION = `You are the HR Readiness Assistant for Serapod2U.
Use ONLY the provided context data to answer questions. Do NOT invent or hallucinate data.
When the user asks to fix something, respond with suggested_actions containing confirm_required=true.
Format your responses clearly with sections and bullet points where appropriate.
If data is unavailable, say so honestly and suggest what the admin should configure.
Always be helpful, concise, and action-oriented.`

// ─── Gateway ───────────────────────────────────────────────────────

export interface GatewayOptions {
  userId: string
  provider?: AiProvider
  /** If provided, overrides env-based config (used for DB-resolved settings) */
  configOverride?: import('./types').AiProviderConfig
}

export async function sendToAi(
  request: AiChatRequest,
  options: GatewayOptions,
): Promise<AiResponse> {
  // Rate-limit check
  if (!checkRateLimit(options.userId)) {
    return {
      provider: (options.provider ?? getDefaultProvider()),
      message: 'You are sending messages too quickly. Please wait a moment and try again.',
      error: 'rate_limited',
    }
  }

  // ── STRICT PROVIDER RESOLUTION ─────────────────────────────────
  // Priority: options.configOverride > options.provider > request.provider > env default
  // Once a configOverride is supplied (from DB settings), we NEVER fall
  // back to a different provider — even if the override says enabled=false.
  const hasDbConfig = !!options.configOverride
  const provider = options.provider ?? request.provider ?? getDefaultProvider()
  const config = options.configOverride ?? getProviderConfig(provider)
  const source = hasDbConfig ? 'db' : 'env'

  // If the admin‐selected provider is disabled, refuse — don't swap.
  if (!config.enabled) {
    console.warn(
      `[AI Gateway] BLOCKED: provider=${provider} source=${source} enabled=false — refusing to call any provider`,
    )
    return {
      provider,
      message: '',
      error: `AI provider "${provider}" is not enabled or not reachable. Please check AI Provider Settings and ensure the provider (${provider}) is running.`,
    }
  }

  console.log(
    `[AI Gateway] ROUTING: provider=${provider} source=${source} baseUrl=${config.baseUrl?.slice(0, 40)}…`,
  )

  // Inject system instruction if not already set
  const enrichedRequest: AiChatRequest = {
    ...request,
    systemInstruction: request.systemInstruction ?? HR_SYSTEM_INSTRUCTION,
  }

  let response: AiResponse

  try {
    if (provider === 'moltbot') {
      response = await callMoltbot(config, enrichedRequest)
    } else if (provider === 'ollama') {
      response = await callOllama(config, enrichedRequest)
    } else {
      response = await callOpenClaw(config, enrichedRequest)
    }
  } catch (err: any) {
    response = {
      provider,
      message: '',
      error: `Gateway error: ${err.message}`,
    }
  }

  logAiRequest(provider, options.userId, request.message, !response.error, source)

  // Log a warning if the response errored (for debugging)
  if (response.error) {
    console.warn(
      `[AI Gateway] ERROR: provider=${provider} error="${response.error?.slice(0, 150)}"`,
    )
  }

  return response
}

/**
 * Returns a fallback offline response when all providers are unavailable.
 * Includes audit data so the user still gets value.
 */
export function buildOfflineResponse(auditMessage: string): AiResponse {
  return {
    provider: 'ollama', // Use the actual default, not hardcoded 'openclaw'
    message: auditMessage,
    suggested_actions: [
      { key: 'retry', label: 'Retry AI connection', confirm_required: false },
    ],
  }
}

