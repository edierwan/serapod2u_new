/**
 * OpenAI / ChatGPT provider for the AI gateway.
 */
import { type AiChatRequest, type AiResponse, type AiProviderConfig } from '../types'

const DEFAULT_MODEL = 'gpt-4o-mini'
const TIMEOUT_MS = 45_000

export async function callOpenai(
  config: AiProviderConfig,
  request: AiChatRequest,
): Promise<AiResponse> {
  const apiKey = config.token || process.env.OPENAI_API_KEY || ''
  if (!config.enabled || !apiKey) {
    return {
      provider: 'openai',
      message: '',
      error: 'OpenAI is not configured. Set OPENAI_API_KEY or add a token in AI Provider Settings.',
    }
  }

  const model = config.model || DEFAULT_MODEL
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []

  if (request.systemInstruction) {
    messages.push({ role: 'system', content: request.systemInstruction })
  }
  for (const entry of request.conversationHistory || []) {
    messages.push({ role: entry.role, content: entry.content })
  }
  messages.push({ role: 'user', content: request.message })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.4,
        max_tokens: 700,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText)
      return {
        provider: 'openai',
        message: '',
        error: `OpenAI returned ${res.status}: ${text.slice(0, 200)}`,
      }
    }

    const data = await res.json()
    const message = (data.choices?.[0]?.message?.content || '').trim()
    if (!message) {
      return { provider: 'openai', message: '', error: 'OpenAI returned an empty response.' }
    }
    return { provider: 'openai', message }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { provider: 'openai', message: '', error: 'OpenAI request timed out.' }
    }
    return {
      provider: 'openai',
      message: '',
      error: error instanceof Error ? error.message : 'OpenAI request failed.',
    }
  } finally {
    clearTimeout(timer)
  }
}
