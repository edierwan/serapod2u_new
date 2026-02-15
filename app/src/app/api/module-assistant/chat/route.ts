/**
 * POST /api/module-assistant/chat
 *
 * Generic module AI assistant endpoint (batch / non-streaming).
 * Handles Finance, Supply Chain, and Customer & Growth modules.
 *
 * Flow: Auth → Rate-limit → Smart tool (DB query) → AI fallback → response
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveProviderConfig } from '@/lib/server/ai/providerSettings'
import { sendToAi } from '@/lib/ai/aiGateway'
import { logAiUsage } from '@/lib/server/ai/usageLogger'
import { recordMetric, estimateTokens } from '@/lib/ai/metrics'
import { ensureWarm, touchLastRequest } from '@/lib/ai/warmup'
import type { AiChatRequest, AiProvider } from '@/lib/ai/types'
import { detectCGIntent, executeCGTool, CG_SUGGESTIONS } from '@/lib/server/module-assistant/tools-customer-growth'
import { detectFinIntent, executeFinTool, FIN_SUGGESTIONS } from '@/lib/server/module-assistant/tools-finance'
import { detectSCIntent, executeSCTool, SC_SUGGESTIONS } from '@/lib/server/module-assistant/tools-supply-chain'

// ─── Fast-path greeting regex ──────────────────────────────────────

const GREETING_RE = /^\s*(hi|hello|hey|helo|hye|yo|salam|assalamualaikum|morning|pagi|petang|malam|good\s*(morning|afternoon|evening)|apa\s*khabar|how\s*are\s*you|what'?s?\s*up|nak\s*tanya|boleh\s*tanya|saya\s*nak\s*tanya|i\s*want\s*to\s*ask)\s*[!?.…]*\s*$/i

const GREETING_REPLIES_EN = [
    'Hey there! 👋 How can I help you today?',
    'Hi! 😊 What would you like to know?',
    'Hello! Ready to help — just ask!',
]
const GREETING_REPLIES_MS = [
    'Hai! 👋 Nak tanya apa hari ni?',
    'Hello! 😊 Boleh bantu apa?',
    'Salam! Saya sedia membantu!',
]

// ─── Module config ─────────────────────────────────────────────────

type ModuleId = 'finance' | 'supply-chain' | 'customer-growth'

const MODULE_LABELS: Record<ModuleId, string> = {
    finance: 'Finance',
    'supply-chain': 'Supply Chain',
    'customer-growth': 'Customer & Growth',
}

function getSuggestions(moduleId: ModuleId) {
    switch (moduleId) {
        case 'finance': return FIN_SUGGESTIONS
        case 'supply-chain': return SC_SUGGESTIONS
        case 'customer-growth': return CG_SUGGESTIONS
    }
}

/** Detect intent and execute tool for a module */
async function tryToolExecution(moduleId: ModuleId, message: string, supabase: any, orgId: string) {
    switch (moduleId) {
        case 'finance': {
            const { tool } = detectFinIntent(message)
            if (tool) return { tool, result: await executeFinTool(tool, supabase, orgId) }
            return null
        }
        case 'supply-chain': {
            const { tool } = detectSCIntent(message)
            if (tool) return { tool, result: await executeSCTool(tool, supabase, orgId) }
            return null
        }
        case 'customer-growth': {
            const { tool } = detectCGIntent(message)
            if (tool) return { tool, result: await executeCGTool(tool, supabase, orgId) }
            return null
        }
    }
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

// ─── Detect language ───────────────────────────────────────────────

type Lang = 'ms' | 'en'

function detectLang(text: string): Lang {
    const msWords = /\b(saya|nak|macam|mana|berapa|ramai|ada|tak|buat|apa|ini|itu|tolong|boleh|cari|semua|dalam|untuk|dengan|kenapa|bagaimana|atau|juga|sudah|belum|banyak|sikit)\b/i
    return msWords.test(text) ? 'ms' : 'en'
}

// ─── Handler ───────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
    const startMs = Date.now()
    try {
        const supabase = (await createClient()) as any

        // Auth
        const {
            data: { user },
            error: authError,
        } = await supabase.auth.getUser()
        if (authError || !user?.id) {
            return res(401, { error: 'Unauthorized' })
        }

        // Get org
        const { data: profile } = await supabase
            .from('users')
            .select('id, organization_id, role_code')
            .eq('id', user.id)
            .single()

        if (!profile?.organization_id) {
            return res(400, { error: 'Organization not found' })
        }

        const userId = profile.id as string
        const orgId = profile.organization_id as string

        // Rate limit
        if (rateLimited(userId)) {
            return res(429, { error: 'Too many requests. Please wait a moment.' })
        }

        // Parse body
        const body = await request.json().catch(() => null)
        if (!body || typeof body.message !== 'string' || !body.message.trim()) {
            return res(400, { error: 'Missing "message"' })
        }

        const moduleId = body.moduleId as ModuleId
        if (!moduleId || !MODULE_LABELS[moduleId]) {
            return res(400, { error: 'Invalid moduleId. Expected: finance, supply-chain, customer-growth' })
        }

        const userMessage = body.message.trim()
        const conversationHistory = body.history ?? []
        const requestedProvider = body.provider as AiProvider | undefined
        const lang = detectLang(userMessage)
        const suggestions = getSuggestions(moduleId)
        const modLabel = MODULE_LABELS[moduleId]

        // ── FAST PATH: short greetings → canned reply, no LLM call ────
        if (userMessage.length <= 30 && GREETING_RE.test(userMessage)) {
            const pool = lang === 'ms' ? GREETING_REPLIES_MS : GREETING_REPLIES_EN
            const reply = pool[Math.floor(Math.random() * pool.length)]
            recordMetric({
                ts: new Date().toISOString(),
                provider: 'fast-path',
                model: '-',
                time_to_first_token_ms: 0,
                total_ms: Date.now() - startMs,
                tokens_out_estimate: estimateTokens(reply),
                error: null,
                mode: 'fast-path',
                user: userId.slice(0, 8),
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

        // ── SMART TOOL PATH: try intent-based DB query first ───────────
        const toolExec = await tryToolExecution(moduleId, userMessage, supabase, orgId)
        if (toolExec && toolExec.result.success) {
            const totalMs = Date.now() - startMs
            const reply = toolExec.result.summary
            recordMetric({
                ts: new Date().toISOString(),
                provider: 'db-tool',
                model: toolExec.tool,
                time_to_first_token_ms: 0,
                total_ms: totalMs,
                tokens_out_estimate: estimateTokens(reply),
                error: null,
                mode: 'tool',
                user: userId.slice(0, 8),
            })
            logAiUsage({
                organizationId: orgId,
                userId,
                provider: 'db-tool',
                module: moduleId,
                model: toolExec.tool,
                responseMs: totalMs,
                status: 'success',
                messagePreview: userMessage,
            })
            return ok({
                reply,
                lang,
                mode: 'ai+tool' as const,
                intent: toolExec.tool,
                confidence: 'high',
                suggestions,
                cards: toolExec.result.rows ? [{ title: toolExec.tool, rows: toolExec.result.rows }] : [],
                meta: { durationMs: totalMs, tool: toolExec.tool, totalCount: toolExec.result.totalCount },
            })
        }

        // ── Resolve AI provider ────────────────────────────────────────
        const admin = createAdminClient()
        const resolvedConfig = await resolveProviderConfig(admin, orgId, requestedProvider)
        const aiAvailable = resolvedConfig.enabled

        // ── If AI unavailable → return tool result or offline msg ──────
        if (!aiAvailable) {
            const fallbackReply = toolExec?.result?.summary
                || (lang === 'ms' ? 'AI sedang tidak tersedia. Sila cuba lagi nanti.' : 'AI is currently unavailable. Please try again shortly.')
            return ok({
                reply: fallbackReply,
                lang,
                mode: 'offline' as const,
                intent: 'general',
                confidence: 'low',
                suggestions,
                cards: toolExec?.result?.rows ? [{ title: 'Data', rows: toolExec.result.rows }] : [],
                meta: { durationMs: Date.now() - startMs, offline: true },
            })
        }

        // ── Opportunistic warmup → keep model hot ──────────────────
        await ensureWarm()
        touchLastRequest()

        // ── Build system prompt with tool context ──────────────────
        const toolContext = toolExec?.result?.summary ? `\n\n--- DB DATA ---\n${toolExec.result.summary}\n--- END ---` : ''
        const langNote = lang === 'ms'
            ? 'Jawab dalam Bahasa Melayu. Santai tapi profesional.'
            : 'Reply in English. Casual but professional.'
        const systemInstruction = `You are Serapod2U ${modLabel} Assistant. Be concise, warm, helpful. Use only provided context data. 1-4 sentences unless asked for detail. ${langNote}${toolContext}`

        const aiRequest: AiChatRequest = {
            message: userMessage,
            context: { page: `${moduleId}_assistant`, orgId },
            provider: resolvedConfig.provider,
            systemInstruction,
            conversationHistory: conversationHistory.slice(-6),
        }

        const aiResponse = await sendToAi(aiRequest, {
            userId,
            provider: resolvedConfig.provider,
            configOverride: resolvedConfig,
        })

        // Log usage
        const totalMs = Date.now() - startMs
        logAiUsage({
            organizationId: orgId,
            userId,
            provider: resolvedConfig.provider ?? 'ollama',
            module: moduleId,
            model: resolvedConfig.model,
            responseMs: totalMs,
            status: aiResponse.error ? 'error' : 'success',
            errorMessage: aiResponse.error,
            messagePreview: userMessage,
        })

        recordMetric({
            ts: new Date().toISOString(),
            provider: resolvedConfig.provider ?? 'ollama',
            model: resolvedConfig.model ?? 'qwen2.5:3b',
            time_to_first_token_ms: -1,
            total_ms: totalMs,
            tokens_out_estimate: estimateTokens(aiResponse.message ?? ''),
            error: aiResponse.error ?? null,
            mode: 'batch',
            user: userId.slice(0, 8),
        })

        if (aiResponse.error && !aiResponse.message) {
            const fallbackReply = toolExec?.result?.summary
                || (lang === 'ms' ? 'AI sedang tidak tersedia. Sila cuba lagi nanti.' : 'AI is currently unavailable. Please try again shortly.')
            return ok({
                reply: fallbackReply,
                lang,
                mode: 'offline' as const,
                intent: 'general',
                confidence: 'low',
                suggestions,
                cards: toolExec?.result?.rows ? [{ title: 'Data', rows: toolExec.result.rows }] : [],
                meta: { durationMs: totalMs, offline: true, aiError: aiResponse.error },
            })
        }

        return ok({
            reply: aiResponse.message ?? (lang === 'ms' ? 'AI sedang tidak tersedia.' : 'AI is currently unavailable.'),
            lang,
            mode: toolContext ? ('ai+tool' as const) : ('ai' as const),
            intent: 'general',
            confidence: 'medium',
            suggestions,
            cards: [],
            meta: { durationMs: totalMs, dbContextUsed: !!toolContext },
        })
    } catch (err: any) {
        console.error('[Module Assistant] Error:', err)
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

