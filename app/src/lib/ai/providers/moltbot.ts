/**
 * Moltbot AI provider client
 *
 * Calls the Moltbot adapter service via HTTP – never SSH from the app.
 * The adapter is a small Node/Express sidecar that wraps Moltbot internally.
 */
import { type AiChatRequest, type AiResponse, type AiProviderConfig } from '../types'

const TIMEOUT_MS = 30_000

export async function callMoltbot(
  config: AiProviderConfig,
  request: AiChatRequest,
): Promise<AiResponse> {
  if (!config.enabled || !config.baseUrl) {
    return {
      provider: 'moltbot',
      message: '',
      error: 'Moltbot adapter is not configured. Set MOLTBOT_ADAPTER_URL in your environment.',
    }
  }

  const url = `${config.baseUrl}/api/chat`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (config.token) {
      headers['Authorization'] = `Bearer ${config.token}`
    }

    const body: Record<string, unknown> = {
      message: request.message,
      system: request.systemInstruction ?? undefined,
      context: request.context ?? undefined,
    }

    if (request.conversationHistory?.length) {
      body.history = request.conversationHistory
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error(`[Moltbot] ${res.status} ${res.statusText} – ${text.slice(0, 200)}`)
      return {
        provider: 'moltbot',
        message: '',
        error: `Moltbot returned ${res.status}: ${res.statusText}`,
      }
    }

    const data = await res.json()

    return {
      provider: 'moltbot',
      message:
        data.message ??
        data.response ??
        data.content ??
        data.text ??
        data.answer ??
        (typeof data === 'string' ? data : JSON.stringify(data)),
      citations: data.citations ?? data.sources ?? undefined,
      suggested_actions: data.suggested_actions ?? data.actions ?? undefined,
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return { provider: 'moltbot', message: '', error: 'Moltbot request timed out.' }
    }
    console.error('[Moltbot] Error:', err.message)
    return { provider: 'moltbot', message: '', error: `Moltbot error: ${err.message}` }
  } finally {
    clearTimeout(timer)
  }
}
