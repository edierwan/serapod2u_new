/**
 * POST /api/module-assistant/chat
 *
 * Generic module AI assistant endpoint.
 * Handles Finance, Supply Chain, and Customer & Growth modules.
 *
 * Accepts { message, history, moduleId } where moduleId ∈
 *   ['finance', 'supply-chain', 'customer-growth']
 *
 * Flow: Auth → Rate-limit → DB context fetch → AI call → response
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveProviderConfig } from '@/lib/server/ai/providerSettings'
import { sendToAi } from '@/lib/ai/aiGateway'
import { logAiUsage } from '@/lib/server/ai/usageLogger'
import type { AiChatRequest, AiProvider } from '@/lib/ai/types'

// ─── Module definitions ────────────────────────────────────────────

type ModuleId = 'finance' | 'supply-chain' | 'customer-growth'

interface ModuleConfig {
    label: string
    /** Key tables this assistant may query for context */
    contextTables: string[]
    /** System instruction additions describing the module scope */
    systemScope: string
    /** Keywords used to detect module-related messages (BM + EN) */
    keywords: RegExp
    /** Offline fallback queries – quick DB stats to show if AI is down */
    fallbackQueries: Array<{
        label: string
        table: string
        select: string
        limit: number
    }>
}

const MODULE_CONFIGS: Record<ModuleId, ModuleConfig> = {
    finance: {
        label: 'Finance',
        contextTables: [
            'gl_accounts',
            'gl_journals',
            'gl_journal_lines',
            'documents',
            'fiscal_years',
            'fiscal_periods',
            'bank_accounts',
            'tax_codes',
            'payment_terms',
            'gl_budgets',
        ],
        systemScope: `You are the Finance Assistant for Serapod2U.
You specialise in GL (General Ledger), journals, chart of accounts, invoices, bills, payments, credit notes, 
fiscal years/periods, bank accounts, tax codes, budgets, and financial reports.
Tables accessible: gl_accounts, gl_journals, gl_journal_lines, documents (invoices/bills), fiscal_years, 
fiscal_periods, bank_accounts, tax_codes, payment_terms, gl_budgets, gl_budget_lines, exchange_rates.
When asked about specific records, provide numbers and summaries. Be concise and accurate.`,
        keywords:
            /\b(gl|journal|ledger|akaun|account|invoice|invois|bill|payment|bayaran|tax|cukai|budget|bajet|fiscal|kewangan|finance|bank|reconcil|credit\s*note|debit\s*note|ap|ar|receivable|payable|hutang|piutang|posting|chart\s*of\s*accounts)\b/i,
        fallbackQueries: [
            { label: 'GL Accounts', table: 'gl_accounts', select: 'id, account_code, account_name, account_type, is_active', limit: 10 },
            { label: 'Recent Journals', table: 'gl_journals', select: 'id, journal_number, description, status, total_debit, journal_date', limit: 5 },
            { label: 'Documents', table: 'documents', select: 'id, doc_number, doc_type, status, total_amount, created_at', limit: 5 },
        ],
    },

    'supply-chain': {
        label: 'Supply Chain',
        contextTables: [
            'products',
            'product_variants',
            'product_categories',
            'orders',
            'order_items',
            'organizations',
            'qr_batches',
            'qr_codes',
            'stock_movements',
            'stock_adjustments',
        ],
        systemScope: `You are the Supply Chain Assistant for Serapod2U.
You specialise in products, product variants/SKUs, orders (sales orders, purchase orders), inventory, 
QR code tracking, stock movements, warehouses, shipments, and organizations.
Tables accessible: products, product_variants, product_categories, orders, order_items, organizations, 
qr_batches, qr_codes, qr_movements, stock_movements, stock_adjustments, brands, product_inventory.
When asked about specific records, provide numbers and summaries. Be concise and accurate.`,
        keywords:
            /\b(product|produk|order|pesanan|inventory|inventori|stock|stok|qr|batch|warehouse|gudang|shipment|penghantaran|variant|sku|category|kategori|brand|jenama|movement|adjustment|transfer|organization|organisasi)\b/i,
        fallbackQueries: [
            { label: 'Products', table: 'products', select: 'id, name, sku, status, created_at', limit: 5 },
            { label: 'Recent Orders', table: 'orders', select: 'id, order_number, status, total_amount, created_at', limit: 5 },
            { label: 'QR Batches', table: 'qr_batches', select: 'id, batch_number, quantity, status, created_at', limit: 5 },
        ],
    },

    'customer-growth': {
        label: 'Customer & Growth',
        contextTables: [
            'consumer_qr_scans',
            'consumer_activations',
            'consumer_feedback',
            'points_transactions',
            'points_rules',
            'marketing_campaigns',
            'marketing_templates',
            'lucky_draw_campaigns',
            'support_conversations',
            'short_links',
        ],
        systemScope: `You are the Customer & Growth Assistant for Serapod2U.
You specialise in CRM, consumer engagement, loyalty programs, marketing campaigns, gamification 
(lucky draw, scratch cards, spin wheel, daily quizzes), support conversations, and notifications.
Tables accessible: consumer_qr_scans, consumer_activations, consumer_feedback, points_transactions, 
points_rules, point_rewards, marketing_campaigns, marketing_templates, lucky_draw_campaigns, 
scratch_card_campaigns, spin_wheel_campaigns, support_conversations, short_links, short_link_clicks, 
notification_logs, master_banner_configs.
When asked about specific records, provide numbers and summaries. Be concise and accurate.`,
        keywords:
            /\b(consumer|pengguna|pelanggan|customer|crm|marketing|pemasaran|campaign|kempen|loyalty|kesetiaan|point|mata|redeem|tebus|lucky\s*draw|scratch|spin|quiz|kuiz|support|sokongan|banner|notification|notifikasi|activation|pengaktifan|feedback|maklum\s*balas|gamif)\b/i,
        fallbackQueries: [
            { label: 'Consumer Activations', table: 'consumer_activations', select: 'id, product_name, consumer_phone, activated_at', limit: 5 },
            { label: 'Points Transactions', table: 'points_transactions', select: 'id, type, points, description, created_at', limit: 5 },
            { label: 'Marketing Campaigns', table: 'marketing_campaigns', select: 'id, name, status, created_at', limit: 5 },
        ],
    },
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
        if (!moduleId || !MODULE_CONFIGS[moduleId]) {
            return res(400, { error: 'Invalid moduleId. Expected: finance, supply-chain, customer-growth' })
        }

        const userMessage = body.message.trim()
        const conversationHistory = body.history ?? []
        const requestedProvider = body.provider as AiProvider | undefined
        const lang = detectLang(userMessage)
        const modCfg = MODULE_CONFIGS[moduleId]

        // ── Resolve AI provider ────────────────────────────────────────
        const admin = createAdminClient()
        const resolvedConfig = await resolveProviderConfig(admin, orgId, requestedProvider)
        // Strict enforcement: only use the DB-selected provider, never silently
        // fall back to another provider that may incur costs.
        const aiAvailable = resolvedConfig.enabled

        // ── If module-specific message → fetch DB context first ────────
        let dbContext = ''
        if (modCfg.keywords.test(userMessage)) {
            dbContext = await fetchModuleContext(supabase, orgId, modCfg, userMessage)
        }

        // ── If AI unavailable → return DB fallback ─────────────────────
        if (!aiAvailable) {
            const fallback = await buildOfflineFallback(supabase, orgId, modCfg, lang)
            return ok({
                reply: fallback.reply,
                lang,
                mode: 'offline' as const,
                intent: 'general',
                confidence: 'low',
                suggestions: getModuleSuggestions(moduleId),
                cards: fallback.cards,
                meta: { durationMs: Date.now() - startMs, offline: true },
            })
        }

        // ── Build system prompt ────────────────────────────────────────
        const systemInstruction = buildSystemPrompt(modCfg, lang, dbContext)

        const aiRequest: AiChatRequest = {
            message: userMessage,
            context: { page: `${moduleId}_assistant`, orgId },
            provider: resolvedConfig.provider,
            systemInstruction,
            conversationHistory,
        }

        const aiResponse = await sendToAi(aiRequest, {
            userId,
            provider: resolvedConfig.provider,
            configOverride: resolvedConfig,
        })

        // Log usage
        logAiUsage({
            organizationId: orgId,
            userId,
            provider: resolvedConfig.provider ?? 'ollama',
            module: moduleId,
            model: resolvedConfig.model,
            responseMs: Date.now() - startMs,
            status: aiResponse.error ? 'error' : 'success',
            errorMessage: aiResponse.error,
            messagePreview: userMessage,
        })

        if (aiResponse.error && !aiResponse.message) {
            // AI failed → try offline fallback
            const fallback = await buildOfflineFallback(supabase, orgId, modCfg, lang)
            return ok({
                reply: fallback.reply,
                lang,
                mode: 'offline' as const,
                intent: 'general',
                confidence: 'low',
                suggestions: getModuleSuggestions(moduleId),
                cards: fallback.cards,
                meta: { durationMs: Date.now() - startMs, offline: true, aiError: aiResponse.error },
            })
        }

        return ok({
            reply: aiResponse.message ?? offlineFallbackText(lang),
            lang,
            mode: dbContext ? ('ai+tool' as const) : ('ai' as const),
            intent: 'general',
            confidence: 'medium',
            suggestions: getModuleSuggestions(moduleId),
            cards: [],
            meta: { durationMs: Date.now() - startMs, dbContextUsed: !!dbContext },
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

/**
 * Fetch quick DB stats to inject into the AI system prompt as context.
 */
async function fetchModuleContext(
    supabase: any,
    orgId: string,
    modCfg: ModuleConfig,
    _userMessage: string,
): Promise<string> {
    const parts: string[] = []

    for (const q of modCfg.fallbackQueries) {
        try {
            const { data, error, count } = await supabase
                .from(q.table)
                .select(q.select, { count: 'exact' })
                .limit(q.limit)

            if (!error && data) {
                parts.push(`## ${q.label} (total: ${count ?? data.length})\n${JSON.stringify(data, null, 2)}`)
            }
        } catch {
            // skip failed queries
        }
    }

    return parts.length > 0
        ? `\n\n--- DATABASE CONTEXT (live data from org) ---\n${parts.join('\n\n')}\n--- END DB CONTEXT ---`
        : ''
}

/**
 * Build a rich system prompt with module scope + optional DB context.
 */
function buildSystemPrompt(modCfg: ModuleConfig, lang: Lang, dbContext: string): string {
    const personality = `

IMPORTANT GUIDELINES:
- Be conversational, warm, and friendly — like a helpful colleague.
- When you detect the topic is related to ${modCfg.label}, provide data-driven answers using the DB context below.
- You can handle small talk — respond warmly, then gently guide toward ${modCfg.label} topics.
- Use ONLY the provided context data to answer questions. Do NOT invent or hallucinate data.
- Format your responses clearly with sections and bullet points where appropriate.
- Be concise and action-oriented.`

    const langNote =
        lang === 'ms'
            ? '\n\nReply in Bahasa Melayu. Gunakan bahasa santai tapi profesional.'
            : '\n\nReply in English. Use a casual yet professional tone.'

    return modCfg.systemScope + personality + dbContext + langNote
}

/**
 * Build offline fallback with DB data.
 */
async function buildOfflineFallback(
    supabase: any,
    orgId: string,
    modCfg: ModuleConfig,
    lang: Lang,
): Promise<{ reply: string; cards: any[] }> {
    const cards: any[] = []
    const lines: string[] = []

    lines.push(
        lang === 'ms'
            ? `**AI sedang offline** — berikut data ${modCfg.label} dari DB anda:`
            : `**AI is offline** — here's ${modCfg.label} data from your database:`,
    )
    lines.push('')

    for (const q of modCfg.fallbackQueries) {
        try {
            const { data, error, count } = await supabase
                .from(q.table)
                .select(q.select, { count: 'exact' })
                .limit(q.limit)

            if (!error && data && data.length > 0) {
                lines.push(`📊 **${q.label}**: ${count ?? data.length} record(s)`)
                cards.push({ title: q.label, rows: data })
            }
        } catch {
            // skip
        }
    }

    return { reply: lines.join('\n'), cards }
}

function offlineFallbackText(lang: Lang): string {
    return lang === 'ms'
        ? 'AI sedang tidak tersedia. Sila cuba lagi nanti.'
        : 'AI is currently unavailable. Please try again shortly.'
}

/**
 * Quick suggestions per module.
 */
function getModuleSuggestions(moduleId: ModuleId) {
    const suggestions: Record<ModuleId, Array<{ label: string; intent: string }>> = {
        finance: [
            { label: 'Trial balance summary?', intent: 'general' },
            { label: 'Total GL accounts?', intent: 'general' },
            { label: 'Pending journals?', intent: 'general' },
            { label: 'Outstanding invoices?', intent: 'general' },
        ],
        'supply-chain': [
            { label: 'Total products?', intent: 'general' },
            { label: 'Recent orders?', intent: 'general' },
            { label: 'Low stock items?', intent: 'general' },
            { label: 'QR batch status?', intent: 'general' },
        ],
        'customer-growth': [
            { label: 'Total consumers?', intent: 'general' },
            { label: 'Recent activations?', intent: 'general' },
            { label: 'Active campaigns?', intent: 'general' },
            { label: 'Points summary?', intent: 'general' },
        ],
    }
    return suggestions[moduleId] ?? []
}
