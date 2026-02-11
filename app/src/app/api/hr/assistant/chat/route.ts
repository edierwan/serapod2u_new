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
import { getHrAuthContext } from '@/lib/server/hrAccess'
import { resolveHrRole, type Viewer, type HrRole } from '@/lib/server/hr/assistant/policy'
import { routeIntent, detectLang, getCasualResponse, type Lang } from '@/lib/server/hr/assistant/intentRouter'
import { executeTool, type ToolResult, type ToolName } from '@/lib/server/hr/assistant/tools'
import { generateSuggestions, getWelcomeSuggestions } from '@/lib/server/hr/assistant/suggestions'
import { resolveProviderConfig } from '@/lib/server/ai/providerSettings'
import { sendToAi, HR_SYSTEM_INSTRUCTION } from '@/lib/ai/aiGateway'
import { logAiUsage } from '@/lib/server/ai/usageLogger'
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
    const hrRole = resolveHrRole(ctx.roleCode, ctx.roleLevel)
    const viewer: Viewer = {
      userId: ctx.userId,
      orgId: ctx.organizationId,
      roles: ctx.roleCode ? [ctx.roleCode] : [],
      hrRole,
      locale: lang,
    }

    // Route intent
    const { intent, confidence } = routeIntent(userMessage)

    // ── Casual / Chitchat → friendly response (no DB, no AI needed) ─
    if (intent === 'casual') {
      const casualReply = getCasualResponse(userMessage, lang)
      const suggestions = generateSuggestions('general', hrRole, lang)

      // Optionally try AI enrichment for a more natural feel
      let reply = casualReply
      try {
        const admin = createAdminClient()
        const resolvedConfig = await resolveProviderConfig(admin, ctx.organizationId, requestedProvider)
        if (resolvedConfig.enabled) {
          const aiReq: AiChatRequest = {
            message: userMessage,
            context: { page: 'hr_assistant', orgId: ctx.organizationId },
            provider: resolvedConfig.provider,
            systemInstruction: buildCasualSystemPrompt(lang),
            conversationHistory: conversationHistory.slice(-6),
          }
          const aiRes = await sendToAi(aiReq, {
            userId: ctx.userId,
            provider: resolvedConfig.provider,
            configOverride: resolvedConfig,
          })
          if (aiRes.message && !aiRes.error) {
            reply = aiRes.message
          }
        }
      } catch {
        // AI failed → use canned response, which is totally fine
      }

      return ok({
        reply,
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

      // Try to enrich through AI for a natural language summary
      const enriched = await tryAiEnrich(
        userMessage,
        toolResult,
        viewer,
        conversationHistory,
        requestedProvider,
      )

      return ok({
        reply: enriched ?? formatToolAnswer(toolResult, lang),
        lang,
        mode: enriched ? 'ai+tool' : 'tool',
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
  const base = HR_SYSTEM_INSTRUCTION
  const personality = `

IMPORTANT PERSONALITY GUIDELINES:
- Be conversational, warm, and friendly — like a helpful colleague, not a robot.
- If the user asks a general/casual question, reply naturally and conversationally first.
- When you detect the topic is HR-related (salary, leave, attendance, employees, payroll, etc.), then provide data-driven answers.
- You can handle small talk — respond warmly, then gently guide toward HR if appropriate.
- Never dump raw audit data unless specifically asked for an audit.
- Use a mix of casual tone with professional accuracy when discussing HR data.`

  const langNote = lang === 'ms'
    ? '\n\nReply in Bahasa Melayu. Gunakan bahasa santai tapi profesional, macam kawan sekerja.'
    : '\n\nReply in English. Use a casual yet professional tone, like a helpful coworker.'
  return base + personality + langNote
}

/**
 * System prompt optimized for casual/chitchat — warm and conversational.
 */
function buildCasualSystemPrompt(lang: Lang): string {
  const base = `You are a friendly HR Assistant chatbot for Serapod2U.
You're having a casual conversation with a user. Be warm, natural, and approachable.
If they're just saying hello or making small talk, respond naturally — like a friendly colleague.
Gently let them know you can help with HR topics (employees, salary, leave, attendance, payroll, etc.).
Keep responses SHORT (1-3 sentences max). Don't dump data unless asked.
Never mention you're an AI unless directly asked. Just be helpful and human-like.`

  const langNote = lang === 'ms'
    ? '\n\nJawab dalam Bahasa Melayu. Guna bahasa santai macam kawan baik.'
    : '\n\nReply in English. Keep it casual and friendly.'
  return base + langNote
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
