/**
 * Ollama AI provider client
 *
 * Calls the Ollama HTTP API — either on localhost or via an
 * authenticated nginx proxy (x-ollama-key header).
 * When running through a proxy (e.g. https://bot.serapod2u.com/ollama),
 * the token from config is sent as x-ollama-key for authentication.
 *
 * API docs: https://github.com/ollama/ollama/blob/main/docs/api.md
 */
import { type AiChatRequest, type AiResponse, type AiProviderConfig } from '../types'
import { keepAliveAgent } from './ollama-agent'

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434'
const DEFAULT_MODEL = 'qwen2.5:3b'
const TIMEOUT_MS = 120_000 // 2 min — Ollama on small VPS can be slow (model loading)

// ─── Health check ──────────────────────────────────────────────────

export interface OllamaHealthResult {
    ok: boolean
    status: number
    hint: string
    models: string[]
}

/**
 * Check if Ollama is reachable and has models available.
 * Calls GET /api/tags to list available models.
 */
export async function checkOllamaHealth(
    config: AiProviderConfig,
): Promise<OllamaHealthResult> {
    const baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')

    // Build headers — include auth token if configured (proxy mode)
    const headers: Record<string, string> = {}
    if (config.token) {
        headers['x-ollama-key'] = config.token
    }

    try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 15_000)

        const res = await fetch(`${baseUrl}/api/tags`, {
            method: 'GET',
            headers,
            signal: controller.signal,
        })
        clearTimeout(timer)

        if (!res.ok) {
            return {
                ok: false,
                status: res.status,
                hint: `Ollama returned HTTP ${res.status}: ${res.statusText}`,
                models: [],
            }
        }

        const data = await res.json()
        const models: string[] = (data.models ?? []).map((m: any) => m.name ?? m.model ?? 'unknown')

        if (models.length === 0) {
            return {
                ok: true,
                status: 200,
                hint: 'Ollama is running but no models are pulled. Run: ollama pull qwen2.5:3b-instruct',
                models: [],
            }
        }

        const targetModel = config.model || DEFAULT_MODEL
        const hasTargetModel = models.some(
            (m) => m === targetModel || m.startsWith(targetModel.split(':')[0])
        )

        return {
            ok: true,
            status: 200,
            hint: hasTargetModel
                ? `Ollama online — model "${targetModel}" available (${models.length} model${models.length > 1 ? 's' : ''} total)`
                : `Ollama online — ${models.length} model(s) available but "${targetModel}" not found. Available: ${models.join(', ')}`,
            models,
        }
    } catch (err: any) {
        if (err.name === 'AbortError') {
            return { ok: false, status: 0, hint: 'Ollama connection timed out (10s)', models: [] }
        }
        return {
            ok: false,
            status: 0,
            hint: `Cannot reach Ollama at ${baseUrl}: ${err.message}`,
            models: [],
        }
    }
}

// ─── Chat completions ──────────────────────────────────────────────

/**
 * Send a chat request to Ollama using /api/chat endpoint.
 * Uses non-streaming mode (stream: false) for simplicity.
 */
export async function callOllama(
    config: AiProviderConfig,
    request: AiChatRequest,
): Promise<AiResponse> {
    const baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')
    const model = config.model || DEFAULT_MODEL

    if (!config.enabled) {
        return {
            provider: 'ollama',
            message: '',
            error: 'Ollama provider is not enabled.',
        }
    }

    try {
        // Build messages array in Ollama format
        const messages: Array<{ role: string; content: string }> = []

        // System instruction
        if (request.systemInstruction) {
            messages.push({ role: 'system', content: request.systemInstruction })
        }

        // Conversation history
        if (request.conversationHistory?.length) {
            for (const msg of request.conversationHistory) {
                messages.push({ role: msg.role, content: msg.content })
            }
        }

        // Current user message
        messages.push({ role: 'user', content: request.message })

        // Build headers — include auth token if configured (proxy mode)
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        }
        if (config.token) {
            headers['x-ollama-key'] = config.token
        }

        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

        console.log(`[Ollama] Calling ${baseUrl}/api/chat model=${model} proxy=${!!config.token}`)

        const res = await fetch(`${baseUrl}/api/chat`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model,
                messages,
                stream: false,
                options: {
                    // Performance-tuned defaults for CPU-only VPS
                    num_ctx: 4096,
                    temperature: 0.3,
                    top_p: 0.9,
                },
            }),
            signal: controller.signal,
        })
        clearTimeout(timer)

        if (!res.ok) {
            const errorText = await res.text().catch(() => res.statusText)
            console.error(`[Ollama] ${res.status} ${res.statusText} – ${errorText.slice(0, 200)}`)

            // Check for model not found error
            if (res.status === 404 || errorText.includes('model') && errorText.includes('not found')) {
                return {
                    provider: 'ollama',
                    message: '',
                    error: `Ollama model "${model}" not found. Run: ollama pull ${model}`,
                }
            }

            return {
                provider: 'ollama',
                message: '',
                error: `Ollama returned ${res.status}: ${errorText.slice(0, 200)}`,
            }
        }

        const data = await res.json()

        // Ollama response format: { message: { role, content }, ... }
        const content =
            data.message?.content ??
            data.response ??
            data.content ??
            ''

        if (!content) {
            return {
                provider: 'ollama',
                message: '',
                error: 'Ollama returned an empty response. The model may be loading or out of memory.',
            }
        }

        return {
            provider: 'ollama',
            message: content,
        }
    } catch (err: any) {
        if (err.name === 'AbortError') {
            return {
                provider: 'ollama',
                message: '',
                error: `Ollama request timed out after ${TIMEOUT_MS / 1000}s. The model may be too large for this server. Try a smaller model like qwen2.5:3b-instruct.`,
            }
        }
        console.error('[Ollama] Error:', err.message)
        return {
            provider: 'ollama',
            message: '',
            error: `Cannot reach Ollama: ${err.message}. Is Ollama running? Check: systemctl status ollama`,
        }
    }
}
