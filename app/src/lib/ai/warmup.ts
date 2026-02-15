/**
 * Ollama warm-up & keep-warm logic.
 *
 * Forces model into GPU/RAM on first request and periodically pings to
 * prevent unloading. Safe on Vercel: uses "opportunistic warmup" triggered
 * by incoming requests rather than background intervals.
 *
 * On a traditional Node server (self-hosted), also supports setInterval.
 */
import { getOllamaConfig } from './config'

// ─── State ─────────────────────────────────────────────────────────

let warmStatus: 'cold' | 'warming' | 'warm' = 'cold'
let lastWarmAt = 0          // epoch ms
let lastRealRequestAt = 0   // epoch ms

const KEEP_WARM_INTERVAL_MS = 10 * 60 * 1_000 // 10 minutes
const WARM_PROMPT = 'hi'                        // minimal prompt to load model

// ─── Public API ────────────────────────────────────────────────────

export function getWarmStatus() {
  return { status: warmStatus, lastWarmAt, lastRealRequestAt }
}

/** Mark that a real user request just happened. */
export function touchLastRequest() {
  lastRealRequestAt = Date.now()
}

/**
 * Opportunistic warmup: call this at the top of any AI request handler.
 * If the model has been idle > KEEP_WARM_INTERVAL_MS, fire a tiny warmup
 * request *before* (or in parallel with) the real request.
 *
 * Returns true if warmup was triggered (caller may want to log it).
 */
export async function ensureWarm(): Promise<boolean> {
  const now = Date.now()
  const idleMs = now - Math.max(lastWarmAt, lastRealRequestAt)

  // If warm recently, skip
  if (warmStatus === 'warm' && idleMs < KEEP_WARM_INTERVAL_MS) {
    return false
  }

  // If already warming (another concurrent request), skip
  if (warmStatus === 'warming') {
    return false
  }

  warmStatus = 'warming'
  console.log(`[Warmup] Model idle for ${Math.round(idleMs / 1000)}s — sending warm-up ping`)

  try {
    await sendWarmupPing()
    warmStatus = 'warm'
    lastWarmAt = Date.now()
    console.log(`[Warmup] Model warm in ${Date.now() - now}ms`)
    return true
  } catch (err: any) {
    console.warn(`[Warmup] Failed: ${err.message}`)
    warmStatus = 'cold'
    return false
  }
}

/**
 * Start a background keep-warm interval (self-hosted Node only).
 * On Vercel / edge, this is a no-op because intervals are unreliable.
 * Call once at server boot.
 */
export function startKeepWarmInterval(): (() => void) | null {
  // Only run if we detect a long-running Node process (not serverless)
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    console.log('[Warmup] Serverless detected — using opportunistic warmup only')
    return null
  }

  console.log('[Warmup] Starting keep-warm interval (every 10 min)')

  // Initial warmup
  ensureWarm().catch(() => {})

  const iv = setInterval(async () => {
    const now = Date.now()
    const idleSinceLastRequest = now - lastRealRequestAt

    // Only ping if idle > 10 min (no real requests recently)
    if (idleSinceLastRequest > KEEP_WARM_INTERVAL_MS) {
      try {
        await sendWarmupPing()
        warmStatus = 'warm'
        lastWarmAt = Date.now()
        console.log('[Warmup] Keep-warm ping OK')
      } catch (err: any) {
        console.warn('[Warmup] Keep-warm ping failed:', err.message)
        warmStatus = 'cold'
      }
    }
  }, KEEP_WARM_INTERVAL_MS)

  return () => clearInterval(iv)
}

// ─── Internal ──────────────────────────────────────────────────────

async function sendWarmupPing(): Promise<void> {
  const config = getOllamaConfig()
  if (!config.enabled) {
    throw new Error('Ollama not configured')
  }

  const baseUrl = config.baseUrl.replace(/\/+$/, '')
  const model = config.model || 'qwen2.5:3b'

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (config.token) {
    headers['x-ollama-key'] = config.token
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000) // 30s for cold load

  const res = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      prompt: WARM_PROMPT,
      stream: false,
      options: {
        num_ctx: 256,
        num_predict: 1,    // Produce exactly 1 token — just enough to load model
        temperature: 0,
      },
    }),
    signal: controller.signal,
  })
  clearTimeout(timer)

  if (!res.ok) {
    throw new Error(`Warmup returned HTTP ${res.status}`)
  }

  // Consume body to close connection
  await res.text()
}
