/**
 * POST /api/hr/assistant/chat
 *
 * Production HR Assistant endpoint.
 * Routes intent → tool → RBAC-filtered result → AI enrichment → response.
 *
 * Response shape:
 *   { success, data: { reply, lang, mode, suggestions, cards, meta } }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getHrAuthContext, hrSelfCan } from '@/lib/server/hrAccess'
import { type Viewer, type HrRole } from '@/lib/server/hr/assistant/policy'
import { resolveHrRoleForCaller } from '@/lib/server/hr/assistant/access'
import { routeIntent, detectLang, getCasualResponse, type Lang } from '@/lib/server/hr/assistant/intentRouter'
import { executeTool, type ToolResult, type ToolName } from '@/lib/server/hr/assistant/tools'
import { generateSuggestions, getWelcomeSuggestions } from '@/lib/server/hr/assistant/suggestions'
import { resolveProviderConfig } from '@/lib/server/ai/providerSettings'
import { sendToAi, HR_SYSTEM_INSTRUCTION } from '@/lib/ai/aiGateway'
import { logAiUsage } from '@/lib/server/ai/usageLogger'
import { recordMetric, estimateTokens } from '@/lib/ai/metrics'
import { ensureWarm, touchLastRequest } from '@/lib/ai/warmup'
import type { AiChatRequest, AiProvider } from '@/lib/ai/types'

// ─── Rate Limit (per user, in-memory) ──────────────────────────────

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

// ─── Handler ───────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const startMs = Date.now()
  try {
    const supabase = (await createClient()) as any

    // Auth
    const authResult = await getHrAuthContext(supabase)
    if (!authResult.success || !authResult.data) {
      return res(401, { error: authResult.error ?? 'Unauthorized' })
    }
    const ctx = authResult.data
    if (!ctx.organizationId) {
      return res(400, { error: 'Organization not found' })
    }
    // The HR assistant answers within the caller's own HR access; using it
    // requires an active employee identity (self-service baseline).
    if (!(await hrSelfCan(ctx))) return res(403, { error: 'Forbidden' })

    // Rate limit
    if (rateLimited(ctx.userId)) {
      return res(429, { error: 'Terlalu banyak request. Sila tunggu sebentar.' })
    }

    // Parse body
    const body = await request.json().catch(() => null)
    if (!body || typeof body.message !== 'string' || !body.message.trim()) {
      return res(400, { error: 'Missing "message"' })
    }

    const userMessage = body.message.trim()
    const requestedProvider = body.provider as AiProvider | undefined
    const conversationHistory = body.history ?? []

    // Build viewer
    const lang = detectLang(userMessage)
    const hrRole = await resolveHrRoleForCaller(ctx)
    const viewer: Viewer = {
      userId: ctx.userId,
      orgId: ctx.organizationId,
      roles: ctx.roleCode ? [ctx.roleCode] : [],
      hrRole,
      locale: lang,
    }

    // Route intent
    const { intent, confidence } = routeIntent(userMessage)

    // ── FAST PATH: short greetings → canned reply, no LLM call ──
    const GREETING_RE = /^\s*(hi|hello|hey|helo|hye|yo|salam|assalamualaikum|morning|pagi|petang|malam|good\s*(morning|afternoon|evening)|apa\s*khabar|how\s*are\s*you|what'?s?\s*up|nak\s*tanya|boleh\s*tanya|saya\s*nak\s*tanya|i\s*want\s*to\s*ask)\s*[!?.…]*\s*$/i
    if (userMessage.length <= 30 && GREETING_RE.test(userMessage)) {
      const greetings_en = [
        'Hey there! 👋 How can I help you with HR today?',
        'Hi! 😊 Need help with leave, salary, attendance, or anything HR?',
        'Hello! Ready to help — ask me about employees, departments, payroll, and more!',
      ]
      const greetings_ms = [
        'Hai! 👋 Nak tanya apa pasal HR hari ni?',
        'Hello! 😊 Boleh bantu pasal cuti, gaji, kehadiran, atau apa-apa HR.',
        'Salam! Saya sedia membantu — tanya pasal pekerja, jabatan, payroll dan lain-lain!',
      ]
      const pool = lang === 'ms' ? greetings_ms : greetings_en
      const reply = pool[Math.floor(Math.random() * pool.length)]
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

      return ok({
        reply,
        lang,
        mode: 'ai' as const,
        intent: 'casual',
        confidence: 'high',
        suggestions,
        cards: [],
        meta: { durationMs: Date.now() - startMs, fastPath: true },
      })
    }

    // ── Casual / Chitchat → friendly response (no DB, no AI needed) ─
    if (intent === 'casual') {
      const casualReply = getCasualResponse(userMessage, lang)
      const suggestions = generateSuggestions('general', hrRole, lang)

      // Skip AI enrichment for casual — canned response is fast and sufficient
      recordMetric({
        ts: new Date().toISOString(),
        provider: 'canned',
        model: '-',
        time_to_first_token_ms: 0,
        total_ms: Date.now() - startMs,
        tokens_out_estimate: estimateTokens(casualReply),
        error: null,
        mode: 'fast-path',
        user: ctx.userId.slice(0, 8),
      })

      return ok({
        reply: casualReply,
        lang,
        mode: 'ai' as const,
        intent: 'casual',
        confidence,
        suggestions,
        cards: [],
        meta: { durationMs: Date.now() - startMs, casual: true },
      })
    }

    // ── If intent maps to a tool, execute it ───────────────────────
    if (intent !== 'general') {
      const toolIntent = intent as ToolName
      const toolResult = await executeTool(toolIntent, viewer, supabase)
      const suggestions = generateSuggestions(toolIntent, hrRole, lang)

      // If tool errored (e.g. access denied), return refusal
      if (!toolResult.success) {
        return ok({
          reply: toolResult.summary,
          lang,
          mode: 'tool',
          intent,
          confidence,
          suggestions,
          cards: [],
          meta: { durationMs: Date.now() - startMs, tool: intent },
        })
      }

      // Return tool result directly — skip LLM enrichment to avoid hallucination with small models
      const formattedReply = formatToolAnswer(toolResult, lang)

      return ok({
        reply: formattedReply,
        lang,
        mode: 'tool',
        intent,
        confidence,
        suggestions,
        cards: toolResult.rows && toolResult.rows.length > 0
          ? [{ title: toolResult.summary, rows: toolResult.rows, deepLink: toolResult.deepLink }]
          : [],
        meta: { durationMs: Date.now() - startMs, tool: intent, totalCount: toolResult.totalCount },
      })
    }

    // ── General intent → AI with smart fallback ───────────────────

    const admin = createAdminClient()
    const resolvedConfig = await resolveProviderConfig(admin, ctx.organizationId, requestedProvider)

    if (!resolvedConfig.enabled) {
      console.warn('[HR Assistant] No AI provider available (config disabled, no env)')
      // AI totally unavailable → check if message looks HR-related
      // If HR-ish, run DB fallback; otherwise give a conversational fallback
      if (looksHrRelated(userMessage)) {
        return smartOfflineFallback(supabase, viewer, lang, hrRole, startMs)
      }
      // Non-HR general chat but AI is down
      const suggestions = generateSuggestions('general', hrRole, lang)
      return ok({
        reply: generalAiFailFallback(userMessage, lang),
        lang,
        mode: 'ai' as const,
        intent: 'general',
        confidence: 'low',
        suggestions,
        cards: [],
        meta: { durationMs: Date.now() - startMs, offline: true },
      })
    }

    // Forward to AI
    const systemInstruction = buildSystemPrompt(lang)
    const aiRequest: AiChatRequest = {
      message: userMessage,
      context: { page: 'hr_assistant', orgId: ctx.organizationId },
      provider: resolvedConfig.provider,
      systemInstruction,
      conversationHistory,
    }

    // Opportunistic warmup for cold model
    await ensureWarm()
    touchLastRequest()

    const aiResponse = await sendToAi(aiRequest, {
      userId: ctx.userId,
      provider: resolvedConfig.provider,
      configOverride: resolvedConfig,
    })

    // Log usage
    logAiUsage({
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      provider: resolvedConfig.provider ?? 'ollama',
      module: 'hr',
      model: resolvedConfig.model,
      responseMs: Date.now() - startMs,
      status: aiResponse.error ? 'error' : 'success',
      errorMessage: aiResponse.error,
      messagePreview: userMessage,
    })

    // Record in-memory metric
    recordMetric({
      ts: new Date().toISOString(),
      provider: resolvedConfig.provider ?? 'ollama',
      model: resolvedConfig.model ?? 'qwen2.5:3b',
      time_to_first_token_ms: -1, // batch mode — no streaming TTFT
      total_ms: Date.now() - startMs,
      tokens_out_estimate: estimateTokens(aiResponse.message ?? ''),
      error: aiResponse.error ?? null,
      mode: 'batch',
      user: ctx.userId.slice(0, 8),
    })

    if (aiResponse.error && !aiResponse.message) {
      console.warn('[HR Assistant] AI call failed for general intent:', aiResponse.error)
      // AI failed → HR-ish → DB fallback, non-HR → conversational fallback
      if (looksHrRelated(userMessage)) {
        return smartOfflineFallback(supabase, viewer, lang, hrRole, startMs, aiResponse.error)
      }
      // Non-HR: give a conversational response, not "AI offline"
      const suggestions = generateSuggestions('general', hrRole, lang)
      return ok({
        reply: generalAiFailFallback(userMessage, lang),
        lang,
        mode: 'ai' as const,
        intent: 'general',
        confidence: 'low',
        suggestions,
        cards: [],
        meta: { durationMs: Date.now() - startMs, aiError: aiResponse.error },
      })
    }

    const suggestions = generateSuggestions('general', hrRole, lang)
    return ok({
      reply: aiResponse.message ?? friendlyOfflineFallback(lang),
      lang,
      mode: 'ai',
      intent: 'general',
      confidence: 'low',
      suggestions,
      cards: [],
      meta: { durationMs: Date.now() - startMs },
    })
  } catch (err: any) {
    console.error('[HR Assistant] Error:', err)
    return res(500, { error: 'Internal server error' })
  }
}

// ─── Helpers ───────────────────────────────────────────────────────

function res(status: number, body: Record<string, any>) {
  return NextResponse.json({ success: false, ...body }, { status })
}

function ok(data: Record<string, any>) {
  return NextResponse.json({ success: true, data })
}

/**
 * Format a tool result as a readable text answer.
 * Filters out internal fields like settingsLink/settingsLabel from display.
 */
function formatToolAnswer(result: ToolResult, lang: Lang): string {
  const lines: string[] = [result.summary]
  const internalFields = ['settingsLink', 'settingsLabel']

  if (result.rows && result.rows.length > 0) {
    lines.push('')
    for (const row of result.rows.slice(0, 20)) {
      const displayParts = Object.entries(row)
        .filter(([key]) => !internalFields.includes(key))
        .map(([, val]) => String(val))
      let line = `• ${displayParts.join(' — ')}`
      // If row has a settings link, append it
      if (row.settingsLink) {
        line += ` → [${row.settingsLabel ?? 'Fix'}](${row.settingsLink})`
      }
      lines.push(line)
    }
    if (result.truncated || (result.rows.length > 20)) {
      lines.push(lang === 'ms' ? `\n…dan lagi ${(result.totalCount ?? 0) - 20}` : `\n…and ${(result.totalCount ?? 0) - 20} more`)
    }
  }

  if (result.deepLink) {
    lines.push(lang === 'ms' ? `\n🔗 Lihat penuh: ${result.deepLink}` : `\n🔗 View full list: ${result.deepLink}`)
  }

  return lines.join('\n')
}

/**
 * Try to enrich a tool result through the AI for a natural language response.
 * Returns null if AI is unavailable.
 */
async function tryAiEnrich(
  userMessage: string,
  toolResult: ToolResult,
  viewer: Viewer,
  history: any[],
  provider?: AiProvider,
): Promise<string | null> {
  try {
    const admin = createAdminClient()
    const resolvedConfig = await resolveProviderConfig(admin, viewer.orgId, provider)
    if (!resolvedConfig.enabled) return null

    const prompt = `User asked: "${userMessage}"\n\nHere is the data from our database:\n${JSON.stringify(toolResult, null, 2)}\n\nSummarize this data naturally for the user. Be concise. If relevant, mention the deep link. Reply in ${viewer.locale === 'ms' ? 'Bahasa Melayu' : 'English'}.`

    const aiReq: AiChatRequest = {
      message: prompt,
      context: { page: 'hr_assistant', orgId: viewer.orgId },
      provider: resolvedConfig.provider,
      systemInstruction: buildSystemPrompt(viewer.locale),
      conversationHistory: history.slice(-4), // keep context small
    }

    const aiRes = await sendToAi(aiReq, {
      userId: viewer.userId,
      provider: resolvedConfig.provider,
      configOverride: resolvedConfig,
    })

    if (aiRes.error || !aiRes.message) return null
    return aiRes.message
  } catch {
    return null
  }
}

function buildSystemPrompt(lang: Lang): string {
  // COMPACT system prompt — keep short for faster inference on CPU-only VPS
  const langNote = lang === 'ms'
    ? 'Jawab dalam Bahasa Melayu. Santai tapi profesional.'
    : 'Reply in English. Casual but professional tone.'
  return `You are Serapod2U HR Assistant. Be concise, warm, helpful. Use only provided context data. If data unavailable, say so. 1-4 sentences unless asked for detail. ${langNote}`
}

/**
 * System prompt optimized for casual/chitchat — warm and conversational.
 */
function buildCasualSystemPrompt(lang: Lang): string {
  const langNote = lang === 'ms'
    ? 'Jawab dalam Bahasa Melayu. Santai macam kawan.'
    : 'Reply in English. Casual and friendly.'
  return `You are a friendly HR chatbot. Keep replies to 1-2 sentences. Be warm. ${langNote}`
}

/**
 * Friendly offline fallback — doesn't dump DB data, just a warm message.
 */
function friendlyOfflineFallback(lang: Lang): string {
  if (lang === 'ms') {
    return 'Maaf, AI sedang tak available sekarang. 😅 Tapi awak masih boleh guna suggestion button di bawah untuk soalan HR biasa, atau cuba lagi nanti!'
  }
  return 'Sorry, AI is temporarily unavailable. 😅 But you can still use the suggestion buttons below for common HR questions, or try again shortly!'
}

function offlineFallback(lang: Lang): string {
  if (lang === 'ms') {
    return 'AI sedang offline. Sila gunakan cadangan di bawah untuk soalan biasa, atau cuba lagi nanti.'
  }
  return 'AI is currently offline. Use the suggestions below for common questions, or try again later.'
}

/**
 * Check if a message looks HR-related even though it didn't match specific intents.
 * Used to decide whether to run DB fallback or just give a friendly message.
 */
function looksHrRelated(text: string): boolean {
  const hrKeywords = /\b(gaji|salary|cuti|leave|pekerja|employee|staff|worker|jabatan|department|kehadiran|attendance|payroll|manager|pengurus|jawatan|position|ot|overtime|epf|socso|eis|pcb|elaun|allowance|potongan|deduction|shift|syif|audit|config|setup|setting|hr|baki|balance|mohon|apply|permohonan|request|approval|kelulusan|holiday|public\s*holiday|cuti\s*umum|pay\s*day|hari\s*gaji|compensation|benefit)\b/i
  return hrKeywords.test(text)
}

/**
 * When AI fails for a non-HR general message, give a conversational response
 * instead of saying "AI offline". This makes the bot feel alive even when
 * the AI backend is down.
 */
function generalAiFailFallback(userMessage: string, lang: Lang): string {
  // Try to give a relevant conversational response based on what they asked
  const lower = userMessage.toLowerCase()

  // Questions about world/general topics
  if (/\b(dunia|world|news|berita|politik|weather|cuaca)\b/i.test(lower)) {
    return lang === 'ms'
      ? 'Hehe, saya ni pakar HR je. 😄 Hal dunia tu bukan bidang saya, tapi kalau nak tanya pasal pekerja, gaji, cuti, atau HR setting — memang saya boleh bantu!'
      : 'Haha, I\'m an HR specialist! 😄 World topics aren\'t my area, but I can definitely help with employees, salary, leave, or HR settings!'
  }

  // Questions about why offline / status
  if (/\b(kenapa|why|offline|down|error|tak jalan|rosak)\b/i.test(lower)) {
    return lang === 'ms'
      ? 'Saya sebenarnya online! 😊 Mungkin tadi ada gangguan sekejap. Cuba tanya soalan HR — contohnya "berapa ramai pekerja?" atau "status payroll".'
      : 'I\'m actually online! 😊 There might have been a brief hiccup. Try asking an HR question — like "how many employees?" or "payroll status".'
  }

  // Default: gentle redirect to HR topics
  return lang === 'ms'
    ? 'Hmm, saya tak pasti macam mana nak bantu untuk soalan ni. 🤔 Saya lebih mahir pasal HR — gaji, cuti, pekerja, jabatan. Cuba tanya pasal benda tu!'
    : 'Hmm, I\'m not sure how to help with that one. 🤔 I\'m best with HR topics — salary, leave, employees, departments. Try asking about those!'
}

/**
 * When AI is offline or fails, run hrConfigAudit + orgSummary as a rich fallback
 * so the user still gets useful data (like the old behaviour).
 */
async function smartOfflineFallback(
  supabase: any,
  viewer: Viewer,
  lang: Lang,
  hrRole: HrRole,
  startMs: number,
  aiError?: string,
) {
  try {
    const [auditResult, summaryResult] = await Promise.all([
      executeTool('hrConfigAudit', viewer, supabase),
      executeTool('orgSummary', viewer, supabase),
    ])

    const lines: string[] = []

    if (lang === 'ms') {
      lines.push('**AI sedang offline** — berikut data dari DB anda:')
    } else {
      lines.push('**AI is offline** — here is data from your database:')
    }
    lines.push('')

    // Org summary
    if (summaryResult.success) {
      lines.push(`📊 ${summaryResult.summary}`)
      lines.push('')
    }

    // Audit summary
    if (auditResult.success) {
      lines.push(`📋 ${auditResult.summary}`)
      if (auditResult.rows && auditResult.rows.length > 0) {
        lines.push('')
        lines.push(lang === 'ms' ? '**Isu kritikal:**' : '**Critical issues:**')
        for (const row of auditResult.rows.slice(0, 10)) {
          lines.push(`• ${row.issue ?? Object.values(row).join(' — ')}`)
        }
      }
    }

    const suggestions = generateSuggestions('hrConfigAudit', hrRole, lang)
    const cards: any[] = []
    if (auditResult.rows && auditResult.rows.length > 0) {
      cards.push({ title: auditResult.summary, rows: auditResult.rows })
    }

    return ok({
      reply: lines.join('\n'),
      lang,
      mode: 'tool' as const,
      intent: 'hrConfigAudit',
      confidence: 'medium',
      suggestions,
      cards,
      meta: { durationMs: Date.now() - startMs, offline: true, aiError, smartFallback: true },
    })
  } catch {
    // If even tools fail, return basic offline message
    const suggestions = getWelcomeSuggestions(hrRole, lang)
    return ok({
      reply: offlineFallback(lang),
      lang,
      mode: 'offline' as const,
      intent: 'general',
      confidence: 'low',
      suggestions,
      cards: [],
      meta: { durationMs: Date.now() - startMs, offline: true, aiError },
    })
  }
}
