/**
 * POST /api/hr/assistant/chat/stream
 *
 * SSE streaming endpoint for HR Assistant.
 * Same auth/intent routing as the batch endpoint, but streams AI responses
 * token-by-token via Server-Sent Events.
 *
 * SSE event types:
 *   - token:      { t: "partial text" }
 *   - meta:       { mode, intent, lang, suggestions, cards }
 *   - done:       { reply (full), metrics }
 *   - error:      { error: "message" }
 *   - fast:       { reply, ... } (greeting fast-path, no streaming needed)
 */
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getHrAuthContext } from '@/lib/server/hrAccess'
import { resolveHrRole, type Viewer } from '@/lib/server/hr/assistant/policy'
import { routeIntent, detectLang, getCasualResponse, type Lang } from '@/lib/server/hr/assistant/intentRouter'
import { executeTool, type ToolResult, type ToolName } from '@/lib/server/hr/assistant/tools'
import { generateSuggestions, getWelcomeSuggestions } from '@/lib/server/hr/assistant/suggestions'
import { resolveProviderConfig } from '@/lib/server/ai/providerSettings'
import { HR_SYSTEM_INSTRUCTION } from '@/lib/ai/aiGateway'
import { logAiUsage } from '@/lib/server/ai/usageLogger'
import { streamOllamaChat } from '@/lib/ai/providers/ollama-stream'
import { recordMetric, estimateTokens } from '@/lib/ai/metrics'
import { ensureWarm, touchLastRequest } from '@/lib/ai/warmup'
import type { AiProvider } from '@/lib/ai/types'

// Force Node.js runtime (needed for streaming + keep-alive agent)
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ─── Fast-path greeting regex ──────────────────────────────────────

const GREETING_RE = /^\s*(hi|hello|hey|helo|hye|yo|salam|assalamualaikum|morning|pagi|petang|malam|good\s*(morning|afternoon|evening)|apa\s*khabar|how\s*are\s*you|what'?s?\s*up|nak\s*tanya|boleh\s*tanya|saya\s*nak\s*tanya|i\s*want\s*to\s*ask)\s*[!?.…]*\s*$/i

const GREETING_REPLIES_EN = [
  'Hey there! 👋 How can I help you with HR today?',
  'Hi! 😊 Need help with leave, salary, attendance, or anything HR?',
  'Hello! Ready to help — ask me about employees, departments, payroll, and more!',
]
const GREETING_REPLIES_MS = [
  'Hai! 👋 Nak tanya apa pasal HR hari ni?',
  'Hello! 😊 Boleh bantu pasal cuti, gaji, kehadiran, atau apa-apa HR.',
  'Salam! Saya sedia membantu — tanya pasal pekerja, jabatan, payroll dan lain-lain!',
]

function pickGreeting(lang: Lang): string {
  const pool = lang === 'ms' ? GREETING_REPLIES_MS : GREETING_REPLIES_EN
  return pool[Math.floor(Math.random() * pool.length)]
}

// ─── Rate Limit ────────────────────────────────────────────────────

const rl = new Map<string, { count: number; resetAt: number }>()
const RL_WINDOW = 60_000
const RL_MAX = 20

function rateLimited(userId: string): boolean {
  const now = Date.now()
  const entry = rl.get(userId)
  if (!entry || now > entry.resetAt) {
    rl.set(userId, { count: 1, resetAt: now + RL_WINDOW })
    return false
  }
  if (entry.count >= RL_MAX) return true
  entry.count++
  return false
}

// ─── SSE helpers ───────────────────────────────────────────────────

function sseHeaders(): HeadersInit {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',        // tell nginx to disable buffering
  }
}

function sseEvent(event: string, data: any): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

// ─── Compact system prompts (performance: keep short) ──────────────

function shortSystemPrompt(lang: Lang): string {
  return `You are the Serapod2U HR Assistant. Be concise, warm, and helpful. Answer in ${lang === 'ms' ? 'Bahasa Melayu' : 'English'}. Use 1-4 sentences unless the user asks for detail. If data is unavailable, say so and suggest next steps.`
}

function casualSystemPrompt(lang: Lang): string {
  return `You are a friendly HR chatbot. Keep replies to 1-2 sentences. Be warm and casual. Reply in ${lang === 'ms' ? 'Bahasa Melayu' : 'English'}.`
}

// ─── Handler ───────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const startMs = Date.now()

  try {
    const supabase = (await createClient()) as any

    // Auth
    const authResult = await getHrAuthContext(supabase)
    if (!authResult.success || !authResult.data) {
      return new Response(
        sseEvent('error', { error: authResult.error ?? 'Unauthorized' }),
        { status: 401, headers: sseHeaders() },
      )
    }
    const ctx = authResult.data
    if (!ctx.organizationId) {
      return new Response(
        sseEvent('error', { error: 'Organization not found' }),
        { status: 400, headers: sseHeaders() },
      )
    }

    // Rate limit
    if (rateLimited(ctx.userId)) {
      return new Response(
        sseEvent('error', { error: 'Terlalu banyak request. Sila tunggu sebentar.' }),
        { status: 429, headers: sseHeaders() },
      )
    }

    // Parse body
    const body = await request.json().catch(() => null)
    if (!body || typeof body.message !== 'string' || !body.message.trim()) {
      return new Response(
        sseEvent('error', { error: 'Missing "message"' }),
        { status: 400, headers: sseHeaders() },
      )
    }

    const userMessage = body.message.trim()
    const requestedProvider = body.provider as AiProvider | undefined
    const conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = body.history ?? []

    const lang = detectLang(userMessage)
    const hrRole = resolveHrRole(ctx.roleCode, ctx.roleLevel)
    const viewer: Viewer = {
      userId: ctx.userId,
      orgId: ctx.organizationId,
      roles: ctx.roleCode ? [ctx.roleCode] : [],
      hrRole,
      locale: lang,
    }

    // ── FAST PATH: greetings ─────────────────────────────────────
    if (userMessage.length <= 30 && GREETING_RE.test(userMessage)) {
      const reply = pickGreeting(lang)
      const suggestions = generateSuggestions('general', hrRole, lang)

      recordMetric({
        ts: new Date().toISOString(),
        provider: 'fast-path',
        model: '-',
        time_to_first_token_ms: 0,
        total_ms: Date.now() - startMs,
        tokens_out_estimate: estimateTokens(reply),
        error: null,
        mode: 'fast-path',
        user: ctx.userId.slice(0, 8),
      })

      return new Response(
        sseEvent('fast', {
          reply,
          lang,
          mode: 'ai',
          intent: 'casual',
          confidence: 'high',
          suggestions,
          cards: [],
          meta: { durationMs: Date.now() - startMs, fastPath: true },
        }),
        { status: 200, headers: sseHeaders() },
      )
    }

    // ── Intent routing ───────────────────────────────────────────
    const { intent, confidence } = routeIntent(userMessage)

    // ── Casual with canned reply (no AI needed) ──────────────────
    if (intent === 'casual') {
      const reply = getCasualResponse(userMessage, lang)
      const suggestions = generateSuggestions('general', hrRole, lang)

      recordMetric({
        ts: new Date().toISOString(),
        provider: 'canned',
        model: '-',
        time_to_first_token_ms: 0,
        total_ms: Date.now() - startMs,
        tokens_out_estimate: estimateTokens(reply),
        error: null,
        mode: 'fast-path',
        user: ctx.userId.slice(0, 8),
      })

      return new Response(
        sseEvent('fast', {
          reply,
          lang,
          mode: 'ai',
          intent: 'casual',
          confidence,
          suggestions,
          cards: [],
          meta: { durationMs: Date.now() - startMs, casual: true },
        }),
        { status: 200, headers: sseHeaders() },
      )
    }

    // ── Tool-based intents (DB query, no streaming needed) ───────
    if (intent !== 'general') {
      const toolIntent = intent as ToolName
      const toolResult = await executeTool(toolIntent, viewer, supabase)
      const suggestions = generateSuggestions(toolIntent, hrRole, lang)

      if (!toolResult.success) {
        return new Response(
          sseEvent('fast', {
            reply: toolResult.summary,
            lang,
            mode: 'tool',
            intent,
            confidence,
            suggestions,
            cards: [],
            meta: { durationMs: Date.now() - startMs, tool: intent },
          }),
          { status: 200, headers: sseHeaders() },
        )
      }

      // Return tool result directly — skip LLM enrichment to avoid hallucination
      const formattedReply = formatToolAnswer(toolResult, lang)
      const totalMs = Date.now() - startMs

      recordMetric({
        ts: new Date().toISOString(),
        provider: 'db-tool',
        model: intent,
        time_to_first_token_ms: 0,
        total_ms: totalMs,
        tokens_out_estimate: estimateTokens(formattedReply),
        error: null,
        mode: 'tool',
        user: ctx.userId.slice(0, 8),
      })

      return new Response(
        sseEvent('fast', {
          reply: formattedReply,
          lang,
          mode: 'tool',
          intent,
          confidence,
          suggestions,
          cards: buildCards(toolResult),
          meta: { durationMs: totalMs, tool: intent, totalCount: toolResult.totalCount },
        }),
        { status: 200, headers: sseHeaders() },
      )
    }

    // ── General intent → stream from Ollama ──────────────────────
    const admin = createAdminClient()
    const resolvedConfig = await resolveProviderConfig(admin, ctx.organizationId, requestedProvider)

    if (!resolvedConfig.enabled) {
      // Offline fallback — same logic as batch endpoint
      const suggestions = generateSuggestions('general', hrRole, lang)
      const reply = lang === 'ms'
        ? 'AI sedang offline. Gunakan suggestion button di bawah untuk soalan HR biasa.'
        : 'AI is offline. Use the suggestion buttons below for common HR questions.'
      return new Response(
        sseEvent('fast', {
          reply,
          lang,
          mode: 'offline',
          intent: 'general',
          confidence: 'low',
          suggestions,
          cards: [],
          meta: { durationMs: Date.now() - startMs, offline: true },
        }),
        { status: 200, headers: sseHeaders() },
      )
    }

    // Non-Ollama providers don't support streaming → fall back to batch-style
    if (resolvedConfig.provider === 'moltbot') {
      // TODO: batch call moltbot, wrap in SSE
      const suggestions = generateSuggestions('general', hrRole, lang)
      return new Response(
        sseEvent('fast', {
          reply: 'Moltbot provider does not support streaming. Use the standard endpoint.',
          lang,
          mode: 'ai',
          intent: 'general',
          confidence: 'low',
          suggestions,
          cards: [],
          meta: { durationMs: Date.now() - startMs },
        }),
        { status: 200, headers: sseHeaders() },
      )
    }

    // Opportunistic warmup
    await ensureWarm()
    touchLastRequest()

    const suggestions = generateSuggestions('general', hrRole, lang)
    const messages = [
      { role: 'system', content: shortSystemPrompt(lang) },
      ...conversationHistory.slice(-6).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: userMessage },
    ]

    return streamResponse({
      config: resolvedConfig,
      messages,
      ollamaOptions: { temperature: 0.3, top_p: 0.9, num_predict: 512 },
      meta: { lang, mode: 'ai', intent: 'general', confidence: 'low', suggestions, cards: [] },
      ctx: { userId: ctx.userId, organizationId: ctx.organizationId! },
      startMs,
    })
  } catch (err: any) {
    console.error('[HR Assistant Stream] Error:', err)
    return new Response(
      sseEvent('error', { error: 'Internal server error' }),
      { status: 500, headers: sseHeaders() },
    )
  }
}

// ─── Stream AI response as SSE ─────────────────────────────────────

interface StreamParams {
  config: any
  messages: Array<{ role: string; content: string }>
  ollamaOptions: Record<string, number>
  meta: Record<string, any>
  ctx: { userId: string; organizationId: string }
  startMs: number
}

function streamResponse(params: StreamParams): Response {
  const { config, messages, ollamaOptions, meta, ctx, startMs } = params

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      // Send meta immediately so UI can update mode/suggestions
      controller.enqueue(encoder.encode(sseEvent('meta', meta)))

      try {
        let streamError = ''
        const result = await streamOllamaChat(
          {
            config,
            messages,
            model: config.model,
            options: ollamaOptions,
          },
          {
            onToken(token) {
              // Flush each token immediately
              controller.enqueue(encoder.encode(sseEvent('token', { t: token })))
            },
            onDone(_fullText) {
              // Handled after streamOllamaChat resolves (below)
            },
            onError(err) {
              streamError = err
              console.error('[HR Stream] Ollama error:', err)
            },
          },
        )

        // streamOllamaChat has resolved — result is fully available
        const totalMs = Date.now() - startMs

        if (result.fullText) {
          controller.enqueue(
            encoder.encode(
              sseEvent('done', {
                reply: result.fullText,
                metrics: {
                  total_ms: totalMs,
                  time_to_first_token_ms: result.timeToFirstTokenMs,
                  tokens_out_estimate: result.tokensOut,
                },
              }),
            ),
          )

          recordMetric({
            ts: new Date().toISOString(),
            provider: config.provider ?? 'ollama',
            model: config.model ?? 'qwen2.5:3b',
            time_to_first_token_ms: result.timeToFirstTokenMs,
            total_ms: totalMs,
            tokens_out_estimate: result.tokensOut,
            error: null,
            mode: 'stream',
            user: ctx.userId.slice(0, 8),
          })

          logAiUsage({
            organizationId: ctx.organizationId,
            userId: ctx.userId,
            provider: config.provider ?? 'ollama',
            module: 'hr',
            model: config.model,
            responseMs: totalMs,
            status: 'success',
            messagePreview: messages[messages.length - 1]?.content,
          })
        } else {
          // No text produced — treat as error
          const errMsg = streamError || result.error || 'Ollama returned empty response'
          console.error('[HR Stream] Empty response. Detail:', errMsg)
          controller.enqueue(encoder.encode(sseEvent('error', { error: errMsg })))

          recordMetric({
            ts: new Date().toISOString(),
            provider: config.provider ?? 'ollama',
            model: config.model ?? 'qwen2.5:3b',
            time_to_first_token_ms: -1,
            total_ms: totalMs,
            tokens_out_estimate: 0,
            error: errMsg,
            mode: 'stream',
            user: ctx.userId.slice(0, 8),
          })

          logAiUsage({
            organizationId: ctx.organizationId,
            userId: ctx.userId,
            provider: config.provider ?? 'ollama',
            module: 'hr',
            model: config.model,
            responseMs: totalMs,
            status: 'error',
            errorMessage: errMsg,
            messagePreview: messages[messages.length - 1]?.content,
          })
        }

        controller.close()
      } catch (err: any) {
        controller.enqueue(encoder.encode(sseEvent('error', { error: err.message })))
        controller.close()
      }
    },
  })

  return new Response(stream, { status: 200, headers: sseHeaders() })
}

// ─── Helpers ───────────────────────────────────────────────────────

function buildCards(toolResult: ToolResult) {
  if (toolResult.rows && toolResult.rows.length > 0) {
    return [{ title: toolResult.summary, rows: toolResult.rows, deepLink: toolResult.deepLink }]
  }
  return []
}

function formatToolAnswer(result: ToolResult, lang: Lang): string {
  const internalFields = ['settingsLink', 'settingsLabel']
  const lines: string[] = [result.summary]

  if (result.rows && result.rows.length > 0) {
    lines.push('')
    for (const row of result.rows.slice(0, 20)) {
      const displayParts = Object.entries(row)
        .filter(([key]) => !internalFields.includes(key))
        .map(([, val]) => String(val))
      let line = `• ${displayParts.join(' — ')}`
      if (row.settingsLink) {
        line += ` → [${row.settingsLabel ?? 'Fix'}](${row.settingsLink})`
      }
      lines.push(line)
    }
    if (result.truncated || result.rows.length > 20) {
      const remaining = (result.totalCount ?? 0) - 20
      lines.push(lang === 'ms' ? `\n…dan lagi ${remaining}` : `\n…and ${remaining} more`)
    }
  }

  if (result.deepLink) {
    lines.push(lang === 'ms' ? `\n🔗 Lihat penuh: ${result.deepLink}` : `\n🔗 View full list: ${result.deepLink}`)
  }

  return lines.join('\n')
}
