/**
 * OpenClaw AI provider client
 *
 * Calls the OpenClaw HTTP API. Token is sent as `?token=` query param
 * (OpenClaw gateway auth). If the endpoint shape differs from what's
 * assumed here, update `OPENCLAW_CHAT_PATH` env.
 *
 * OpenClaw root `/` returns HTML (login page) when unauthenticated.
 * All API routes are gated; a valid gateway token is required.
 */
import { type AiChatRequest, type AiResponse, type AiProviderConfig } from '../types'

const TIMEOUT_MS = 30_000

// ─── Low-level request helper ──────────────────────────────────────

export interface OpenClawRawResponse {
  ok: boolean
  status: number
  statusText: string
  text: string
  json?: any
  isHtml: boolean
}

/**
 * Generic OpenClaw HTTP request. Adds `?token=` query param for auth.
 * Never relies on cookies.
 */
export async function openclawRequest(
  config: AiProviderConfig,
  path: string,
  options: {
    method?: string
    body?: any
    headers?: Record<string, string>
    timeoutMs?: number
  } = {},
): Promise<OpenClawRawResponse> {
  const url = new URL(config.baseUrl + path)
  if (config.token) {
    url.searchParams.set('token', config.token)
  }

  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? TIMEOUT_MS,
  )

  try {
    const headers: Record<string, string> = {
      ...options.headers,
    }
    if (options.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json'
    }

    const res = await fetch(url.toString(), {
      method: options.method ?? 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    })

    const text = await res.text()
    const isHtml = text.trimStart().startsWith('<!DOCTYPE') || text.trimStart().startsWith('<html')

    let json: any = undefined
    if (!isHtml) {
      try {
        json = JSON.parse(text)
      } catch {
        // not JSON
      }
    }

    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      text,
      json,
      isHtml,
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return { ok: false, status: 0, statusText: 'Timeout', text: '', isHtml: false }
    }
    return { ok: false, status: 0, statusText: err.message, text: '', isHtml: false }
  } finally {
    clearTimeout(timer)
  }
}

// ─── Health check ──────────────────────────────────────────────────

export interface OpenClawHealthResult {
  ok: boolean
  status: number
  hint: string
  authenticated: boolean
}

/**
 * Check if OpenClaw is reachable and the token is valid.
 * 
 * Strategy:
 *   1. Try a lightweight API call (POST to chat endpoint with a tiny ping).
 *      If we get a JSON response → authenticated and working.
 *   2. If that fails or returns HTML, fall back to GET / to check reachability.
 *   3. Distinguish between "unreachable", "reachable but bad token", and "fully ok".
 */
export async function checkOpenClawHealth(
  config: AiProviderConfig,
): Promise<OpenClawHealthResult> {
  if (!config.enabled || !config.baseUrl) {
    return { ok: false, status: 0, hint: 'OPENCLAW_BASE_URL not configured', authenticated: false }
  }

  try {
    // First: try a real API call to verify token works end-to-end
    const chatPath = process.env.OPENCLAW_CHAT_PATH || '/api/chat'
    const apiRes = await openclawRequest(config, chatPath, {
      method: 'POST',
      body: { message: 'ping', system: 'Reply with just the word pong.' },
      timeoutMs: 12_000,
    })

    // If we got a JSON response (even an error JSON), the token authenticated
    if (!apiRes.isHtml && apiRes.status >= 200 && apiRes.status < 500 && apiRes.json) {
      return { ok: true, status: apiRes.status, hint: 'OpenClaw online and authenticated', authenticated: true }
    }

    // Fallback: GET / to check basic reachability
    const res = await openclawRequest(config, '/', { method: 'GET', timeoutMs: 10_000 })

    if (res.status === 0) {
      return { ok: false, status: 0, hint: `Connection failed: ${res.statusText}`, authenticated: false }
    }

    const isLoginPage = res.text.includes('Enter your OpenClaw gat') || res.text.includes('action="/login"')
    const hasOpenClaw = res.text.includes('OpenClaw')

    if (!hasOpenClaw) {
      return { ok: false, status: res.status, hint: 'Response does not look like OpenClaw', authenticated: false }
    }

    // If the API call returned HTML (login page), token may be wrong
    if (apiRes.isHtml || isLoginPage) {
      // But if the API call succeeded with any non-HTML, it might still be ok
      if (!apiRes.isHtml && apiRes.status >= 200 && apiRes.status < 500) {
        return { ok: true, status: apiRes.status, hint: 'OpenClaw online and authenticated', authenticated: true }
      }
      return {
        ok: false,
        status: res.status,
        hint: config.token
          ? 'OpenClaw reachable but token may be invalid (login page returned)'
          : 'OpenClaw reachable but no OPENCLAW_TOKEN set. Set OPENCLAW_TOKEN in .env.local',
        authenticated: false,
      }
    }

    return { ok: true, status: res.status, hint: 'OpenClaw online and authenticated', authenticated: true }
  } catch (err: any) {
    return { ok: false, status: 0, hint: `Health check error: ${err.message}`, authenticated: false }
  }
}

// ─── Chat completions ──────────────────────────────────────────────

/** Configurable chat endpoint path */
function getChatPath(): string {
  return process.env.OPENCLAW_CHAT_PATH || '/api/chat'
}

export async function callOpenClaw(
  config: AiProviderConfig,
  request: AiChatRequest,
): Promise<AiResponse> {
  if (!config.enabled || !config.baseUrl) {
    return {
      provider: 'openclaw',
      message: '',
      error: 'OpenClaw is not configured. Set OPENCLAW_BASE_URL in your environment.',
    }
  }

  const chatPath = getChatPath()

  try {
    const body: Record<string, unknown> = {
      message: request.message,
      system: request.systemInstruction ?? undefined,
      context: request.context ?? undefined,
    }

    if (request.conversationHistory?.length) {
      body.history = request.conversationHistory
    }

    const res = await openclawRequest(config, chatPath, {
      method: 'POST',
      body,
    })

    // If we got HTML back, the token might be wrong or the path doesn't exist
    if (res.isHtml) {
      // Try fallback path if primary returned HTML
      const fallbackPath = chatPath === '/api/chat' ? '/chat' : '/api/chat'
      const res2 = await openclawRequest(config, fallbackPath, {
        method: 'POST',
        body,
      })

      if (res2.isHtml) {
        const isLoginPage = res2.text.includes('action="/login"')
        if (isLoginPage) {
          return {
            provider: 'openclaw',
            message: '',
            error: 'OpenClaw authentication failed. Check OPENCLAW_TOKEN is set correctly.',
          }
        }
        return {
          provider: 'openclaw',
          message: '',
          error: `OpenClaw returned HTML instead of JSON. Tried ${chatPath} and ${fallbackPath}. Update OPENCLAW_CHAT_PATH env.`,
        }
      }

      if (!res2.ok) {
        return {
          provider: 'openclaw',
          message: '',
          error: `OpenClaw returned ${res2.status}: ${res2.statusText}`,
        }
      }

      return normalizeResponse(res2.json)
    }

    if (!res.ok) {
      console.error(`[OpenClaw] ${res.status} ${res.statusText} – ${res.text.slice(0, 200)}`)
      return {
        provider: 'openclaw',
        message: '',
        error: `OpenClaw returned ${res.status}: ${res.statusText}`,
      }
    }

    return normalizeResponse(res.json ?? res.text)
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return { provider: 'openclaw', message: '', error: 'OpenClaw request timed out.' }
    }
    console.error('[OpenClaw] Error:', err.message)
    return { provider: 'openclaw', message: '', error: `OpenClaw error: ${err.message}` }
  }
}

function normalizeResponse(data: any): AiResponse {
  if (!data) {
    return { provider: 'openclaw', message: '', error: 'Empty response from OpenClaw' }
  }

  if (typeof data === 'string') {
    return { provider: 'openclaw', message: data }
  }

  return {
    provider: 'openclaw',
    message:
      data.message ??
      data.response ??
      data.content ??
      data.text ??
      data.answer ??
      // OpenAI-compatible format
      data.choices?.[0]?.message?.content ??
      JSON.stringify(data),
    citations: data.citations ?? data.sources ?? undefined,
    suggested_actions: data.suggested_actions ?? data.actions ?? undefined,
  }
}
