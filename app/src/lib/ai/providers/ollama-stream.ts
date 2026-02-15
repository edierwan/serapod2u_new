/**
 * Ollama Streaming Client
 *
 * Calls Ollama /api/chat with stream=true and yields tokens as they arrive.
 * Uses a keep-alive HTTP agent for connection reuse.
 */
import { type AiProviderConfig } from '../types'
import { recordMetric, estimateTokens, type AiRequestMetric } from '../metrics'

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434'
const DEFAULT_MODEL = 'qwen2.5:3b'
const TIMEOUT_MS = 120_000

export interface OllamaStreamOptions {
  config: AiProviderConfig
  messages: Array<{ role: string; content: string }>
  /** Override model from config */
  model?: string
  /** Ollama options overrides */
  options?: Record<string, number>
  /** Abort signal from caller */
  signal?: AbortSignal
}

export interface StreamCallbacks {
  onToken: (token: string) => void
  onDone: (fullText: string) => void
  onError: (error: string) => void
}

/**
 * Stream a chat completion from Ollama.
 * Calls onToken() for each token, onDone() at completion, onError() on failure.
 *
 * Returns { fullText, timeToFirstTokenMs, totalMs, tokensOut }
 */
export async function streamOllamaChat(
  opts: OllamaStreamOptions,
  callbacks: StreamCallbacks,
): Promise<{ fullText: string; timeToFirstTokenMs: number; totalMs: number; tokensOut: number; error?: string }> {
  const baseUrl = (opts.config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const model = opts.model || opts.config.model || DEFAULT_MODEL
  const startMs = Date.now()
  let firstTokenMs = -1
  let fullText = ''

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (opts.config.token) {
    headers['x-ollama-key'] = opts.config.token
  }

  // Build request body with performance-tuned defaults
  const body = {
    model,
    messages: opts.messages,
    stream: true,
    options: {
      num_ctx: 4096,
      temperature: 0.3,
      top_p: 0.9,
      ...(opts.options ?? {}),
    },
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  // Link external abort signal
  if (opts.signal) {
    opts.signal.addEventListener('abort', () => controller.abort())
  }

  try {
    console.log(`[Ollama Stream] POST ${baseUrl}/api/chat model=${model}`)

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (!res.ok) {
      const errorText = await res.text().catch(() => res.statusText)
      const msg = `Ollama ${res.status}: ${errorText.slice(0, 200)}`
      callbacks.onError(msg)
      return { fullText: '', timeToFirstTokenMs: -1, totalMs: Date.now() - startMs, tokensOut: 0 }
    }

    if (!res.body) {
      callbacks.onError('Ollama response has no body (streaming not supported?)')
      return { fullText: '', timeToFirstTokenMs: -1, totalMs: Date.now() - startMs, tokensOut: 0 }
    }

    // Read NDJSON stream from Ollama
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // Ollama sends NDJSON: one JSON object per line
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? '' // last incomplete line stays in buffer

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        try {
          const chunk = JSON.parse(trimmed)

          if (chunk.message?.content) {
            const token = chunk.message.content
            fullText += token

            if (firstTokenMs < 0) {
              firstTokenMs = Date.now() - startMs
            }

            callbacks.onToken(token)
          }

          // Ollama signals completion with done: true
          if (chunk.done) {
            break
          }
        } catch {
          // Malformed JSON line — skip
        }
      }
    }

    // Process any remaining buffer
    if (buffer.trim()) {
      try {
        const chunk = JSON.parse(buffer.trim())
        if (chunk.message?.content) {
          fullText += chunk.message.content
          callbacks.onToken(chunk.message.content)
        }
      } catch {
        // ignore
      }
    }

    const totalMs = Date.now() - startMs
    const tokensOut = estimateTokens(fullText)

    callbacks.onDone(fullText)

    return { fullText, timeToFirstTokenMs: firstTokenMs, totalMs, tokensOut }
  } catch (err: any) {
    clearTimeout(timer)
    const totalMs = Date.now() - startMs
    const msg = err.name === 'AbortError'
      ? `Ollama stream timed out after ${TIMEOUT_MS / 1000}s`
      : `Ollama stream error: ${err.message}`

    callbacks.onError(msg)
    return { fullText, timeToFirstTokenMs: firstTokenMs, totalMs, tokensOut: estimateTokens(fullText), error: msg }
  }
}
