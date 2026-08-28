import { sendToAi } from '@/lib/ai/aiGateway'
import { logAiUsage } from '@/lib/server/ai/usageLogger'
import { runSerappCancelHold, runSerappConfirmOrder, runSerappStockCheck } from '@/lib/serapp/assistant-actions'
import {
  formatCheckIntro,
  formatConfirmIntro,
  formatProductInquiryReply,
  helpBotText,
  newOrderBotText,
  quickRepliesForPhase,
  welcomeBotText,
} from '@/lib/serapp/chat-bot'
import type { ChatTurnBotReply } from '@/lib/serapp/chat-types'
import { searchSerappCatalog } from '@/lib/serapp/catalog-search'
import { createAdminClient } from '@/lib/supabase/admin'
import { listMessages } from '@/lib/serapp/conversation-service'
import { resolveSerappAiConfig } from '@/lib/serapp/resolve-ai-config'
import type {
  SerappChatConfirmPayload,
  SerappChatSessionState,
} from '@/lib/serapp/chat-types'
import { DEFAULT_SESSION } from '@/lib/serapp/conversation-types'

import { parseSerappAiAction } from '@/lib/serapp/serapp-ai-parse'

function buildSessionContext(session: SerappChatSessionState, distributorName: string): string {
  const lines = [
    `Distributor: ${distributorName}`,
    `Phase: ${session.phase}`,
  ]
  if (session.lastCheck) {
    const s = session.lastCheck.summary
    lines.push(
      `Last check: ${s.label} (${s.availableLines} avail / ${s.partialLines} partial / ${s.outOfStockLines} OOS / ${s.reviewLines} review)`,
      `Estimated value: ${session.lastCheck.estimatedOrderValue || 0}`,
    )
    if (session.pendingPasteText) {
      lines.push(`Pending list preview:\n${session.pendingPasteText.slice(0, 400)}`)
    }
  }
  if (session.lastConfirm) {
    lines.push(`Last order: ${session.lastConfirm.orderNo} (${session.lastConfirm.status})`)
  }
  return lines.join('\n')
}

function formatCatalogGrounding(
  variants: Array<{
    product_code: string
    product_name: string
    variant_name: string
    available_qty?: number | null
  }>,
): string {
  if (variants.length === 0) return 'No catalog hits for this message yet.'
  return variants.slice(0, 8).map((variant, index) => {
    const qty = typeof variant.available_qty === 'number' ? variant.available_qty : '?'
    return `${index + 1}. code=${variant.product_code} | ${variant.variant_name} | stock=${qty}`
  }).join('\n')
}

function buildSerappAiSystemPrompt(
  session: SerappChatSessionState,
  distributorName: string,
  catalogGrounding: string,
): string {
  return `You are Serapp Assistant for Serapod2U distributors in Malaysia.

Goal: help them order fast with almost no words.

You understand English and simple Bahasa Malaysia (nak, ada stok, boleh, berapa, order baru, batal, sah).
Reply in English by default. Use short BM only if the user writes mainly in BM.

System facts:
- Ordering uses product code (or name) + qty. Examples:
  CV - 50
  GU - 100
  banana vanilla - 20
- Code alone (e.g. CV) is a stock lookup — show match, then ask for qty.
- Flow: paste/check → confirm → 1-hour warehouse hold → DO
- Never invent stock, prices, or order IDs. Use SESSION + LIVE CATALOG only.
- CV/GU/LB are examples only — any valid catalog code/name works.

SESSION:
${buildSessionContext(session, distributorName)}

LIVE CATALOG HITS (for this message):
${catalogGrounding}

Style:
- Max 2 short lines when possible (never more than 4).
- Prefer product codes over long names.
- If they send a code/name without qty → search_catalog, then tell them to reply with CODE - QTY.
- If stock question → search_catalog (or use catalog hits below).
- If they give product + qty → check_stock with paste lines like "BANANA VANILLA - 100".
- If ready to submit and phase is checked → only emit confirm when the user clearly says *confirm* / *sahkan* / *تأكيد*. Never confirm on ok/yes/okay/sure.
- If unclear → ask for code/name + qty in one short line. Show 2–3 example formats, not one only.

Actions (server executes). End with exactly one line when needed:
SERAPP_ACTION:{"action":"check_stock","pasteText":"CV - 50"}
SERAPP_ACTION:{"action":"search_catalog","query":"banana"}
SERAPP_ACTION:{"action":"confirm"}
SERAPP_ACTION:{"action":"cancel_hold"}
SERAPP_ACTION:{"action":"new_order"}
SERAPP_ACTION:{"action":"help"}
For chat-only, omit SERAPP_ACTION.

Write the short reply first, then optional SERAPP_ACTION last.`
}

async function loadConversationHistory(conversationId?: string | null) {
  if (!conversationId) return []
  const admin = createAdminClient()
  const rows = await listMessages(admin, conversationId, 12)
  return rows
    .filter((row) => row.role === 'user' || row.role === 'bot')
    .slice(-8)
    .map((row) => ({
      role: row.role === 'bot' ? 'assistant' as const : 'user' as const,
      content: row.body,
    }))
}

async function prefetchCatalogForMessage(input: {
  text: string
  distributorId?: string | null
  sessionDistributorId?: string | null
}) {
  const query = input.text.trim().slice(0, 80)
  if (query.length < 2) return []
  // Skip pure commands — no need to hit catalog.
  if (/^(help|confirm|cancel|new order|hi|hello|hey|salam|ok|okay|yes|no|thanks|terima kasih)$/i.test(query)) {
    return []
  }
  try {
    const { variants } = await searchSerappCatalog({
      query,
      distributorId: input.distributorId || input.sessionDistributorId || undefined,
      limit: 8,
    })
    return variants
  } catch {
    return []
  }
}

/**
 * AI-first SerApp assistant turn. Returns null when AI is disabled → caller uses rules fallback.
 */
export async function trySerappAiTurn(input: {
  request: Request
  text: string
  session: SerappChatSessionState
  distributorName: string
  distributorId?: string | null
  userId: string
  orgId: string
  conversationId?: string | null
}): Promise<ChatTurnBotReply | null> {
  const aiConfig = await resolveSerappAiConfig(input.orgId)
  if (!aiConfig.enabled) return null

  const history = await loadConversationHistory(input.conversationId)
  const catalogHits = await prefetchCatalogForMessage({
    text: input.text,
    distributorId: input.distributorId,
    sessionDistributorId: input.session.distributorId,
  })
  const started = Date.now()

  const aiResponse = await sendToAi(
    {
      message: input.text,
      systemInstruction: buildSerappAiSystemPrompt(
        input.session,
        input.distributorName,
        formatCatalogGrounding(catalogHits),
      ),
      conversationHistory: history,
      context: { page: 'serapp_assistant', orgId: input.orgId },
      provider: aiConfig.provider,
    },
    {
      userId: input.userId,
      provider: aiConfig.provider,
      configOverride: aiConfig,
    },
  )

  logAiUsage({
    organizationId: input.orgId,
    userId: input.userId,
    provider: aiConfig.provider,
    module: 'serapp',
    model: aiConfig.model,
    responseMs: Date.now() - started,
    status: aiResponse.error ? 'error' : 'success',
    errorMessage: aiResponse.error,
    messagePreview: input.text,
  })

  if (aiResponse.error && !aiResponse.message) {
    console.warn('[serapp/ai-turn] AI unavailable, using rules fallback:', aiResponse.error)
    return null
  }

  const { reply, action } = parseSerappAiAction(aiResponse.message || '')
  let session = { ...input.session }

  if (!action || action.action === 'chat') {
    // If AI chatted but we already have catalog hits for a product-ish message, prefer short stock card.
    if (catalogHits.length > 0 && /[a-zA-Z\u0600-\u06FF]{2,}/.test(input.text) && !/\d/.test(input.text)) {
      return {
        text: formatProductInquiryReply(input.text.trim(), catalogHits),
        quickReplies: quickRepliesForPhase(
          session.phase === 'idle' ? 'awaiting_list' : session.phase,
          session.lastCheck?.summary.bucket,
        ),
        session,
      }
    }
    return {
      text: reply || aiResponse.message || '…',
      quickReplies: quickRepliesForPhase(
        session.phase === 'idle' ? 'awaiting_list' : session.phase,
        session.lastCheck?.summary.bucket,
      ),
      session,
    }
  }

  if (action.action === 'help') {
    return {
      text: helpBotText(),
      quickReplies: quickRepliesForPhase(
        session.phase === 'idle' ? 'awaiting_list' : session.phase,
        session.lastCheck?.summary.bucket,
      ),
      session,
    }
  }

  if (action.action === 'new_order') {
    session = {
      ...DEFAULT_SESSION,
      phase: 'awaiting_list',
      distributorId: input.distributorId || session.distributorId,
      humanHandoff: session.humanHandoff,
    }
    return {
      text: reply || newOrderBotText(),
      quickReplies: quickRepliesForPhase('awaiting_list'),
      session,
    }
  }

  if (action.action === 'search_catalog') {
    try {
      const { variants } = await searchSerappCatalog({
        query: action.query,
        distributorId: input.distributorId || session.distributorId || undefined,
      })
      return {
        text: formatProductInquiryReply(action.query, variants),
        quickReplies: quickRepliesForPhase(
          session.phase === 'idle' ? 'awaiting_list' : session.phase,
          session.lastCheck?.summary.bucket,
        ),
        session,
      }
    } catch (error) {
      return {
        text: reply || (error instanceof Error ? error.message : 'Catalog lookup failed.'),
        quickReplies: quickRepliesForPhase(
          session.phase === 'idle' ? 'awaiting_list' : session.phase,
          session.lastCheck?.summary.bucket,
        ),
        session,
      }
    }
  }

  if (action.action === 'check_stock') {
    try {
      const check = await runSerappStockCheck({
        pasteText: action.pasteText,
        distributorId: input.distributorId || session.distributorId || undefined,
        lineResolutions: session.lineResolutions,
      })
      session = {
        phase: 'checked',
        pendingPasteText: action.pasteText,
        lastCheck: check,
        lastConfirm: null,
        distributorId: input.distributorId || session.distributorId,
        lineResolutions: session.lineResolutions || [],
        humanHandoff: session.humanHandoff,
      }
      const intro = formatCheckIntro(check.summary, check.warehouseName, {
        estimatedOrderValue: check.estimatedOrderValue,
        results: check.results,
      })
      return {
        text: intro,
        card: { kind: 'check_summary', check },
        quickReplies: quickRepliesForPhase('checked', check.summary.bucket),
        session,
      }
    } catch (error) {
      return {
        text: reply || (error instanceof Error ? error.message : 'Stock check failed.'),
        card: { kind: 'error', error: error instanceof Error ? error.message : 'Stock check failed.' },
        quickReplies: quickRepliesForPhase('awaiting_list'),
        session: { ...session, phase: 'awaiting_list' },
      }
    }
  }

  if (action.action === 'confirm') {
    const pasteText = session.pendingPasteText
    if (!pasteText || !session.lastCheck) {
      return {
        text: reply || 'Paste or tell me products first, then I can confirm.',
        quickReplies: quickRepliesForPhase('awaiting_list'),
        session,
      }
    }
    const bucket = session.lastCheck.summary.bucket
    if (bucket !== 'available' && bucket !== 'partially_available') {
      return {
        text: reply || `Cannot confirm while status is *${session.lastCheck.summary.label}*.`,
        quickReplies: quickRepliesForPhase('checked', bucket),
        session,
      }
    }

    const idempotencyKey =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `serapp-chat-${Date.now()}`

    const data = await runSerappConfirmOrder({
      pasteText,
      acceptAvailableOnly: true,
      idempotencyKey,
      distributorId: input.distributorId || session.distributorId || undefined,
      lineResolutions: session.lineResolutions || [],
      request: input.request,
    })

    if (!data.ok || !data.order) {
      return {
        text: reply || (!data.ok && data.error) || 'Confirm failed.',
        card: { kind: 'error', error: (!data.ok && data.error) || 'Confirm failed.' },
        quickReplies: quickRepliesForPhase('checked', bucket),
        session,
      }
    }

    const confirm: SerappChatConfirmPayload = {
      orderNo: data.order.order_no,
      orderId: data.order.id,
      status: data.order.status,
      holdExpiresAt: data.hold?.expires_at || null,
      confirmedLines: data.confirmedLines || 0,
      skippedLines: data.skippedLines || 0,
      estimatedOrderValue: data.estimatedOrderValue || 0,
      warehouseName: data.fulfillmentWarehouse?.name,
      note: data.note,
    }
    session = { ...session, phase: 'confirmed', lastConfirm: confirm }
    const intro = formatConfirmIntro(confirm.orderNo, confirm.holdExpiresAt)
    return {
      text: reply ? `${reply}\n\n${intro}` : intro,
      card: { kind: 'order_confirmed', confirm },
      quickReplies: quickRepliesForPhase('confirmed'),
      session,
    }
  }

  if (action.action === 'cancel_hold') {
    const orderId = session.lastConfirm?.orderId
    if (!orderId) {
      return {
        text: reply || 'No active hold in this chat to cancel.',
        quickReplies: quickRepliesForPhase(session.phase, session.lastCheck?.summary.bucket),
        session,
      }
    }
    const data = await runSerappCancelHold({ orderId })
    if (!data.ok) {
      return {
        text: reply || data.error || 'Cancel failed.',
        quickReplies: quickRepliesForPhase('confirmed'),
        session,
      }
    }
    const orderNo = session.lastConfirm?.orderNo
    session = {
      ...DEFAULT_SESSION,
      phase: 'awaiting_list',
      distributorId: input.distributorId || session.distributorId,
      humanHandoff: session.humanHandoff,
    }
    return {
      text: reply || [
        `✅ **Order cancelled** · **${orderNo}**`,
        '',
        'This order is stopped. The products are no longer reserved for you.',
        '',
        '👉 **Next step:** Send a new product list to order again.',
      ].join('\n'),
      quickReplies: quickRepliesForPhase('awaiting_list'),
      session,
    }
  }

  return {
    text: reply || aiResponse.message || '…',
    quickReplies: quickRepliesForPhase(
      session.phase === 'idle' ? 'awaiting_list' : session.phase,
      session.lastCheck?.summary.bucket,
    ),
    session,
  }
}

export function greetingViaAiFallback(distributorName: string): ChatTurnBotReply {
  return {
    text: welcomeBotText(distributorName),
    quickReplies: quickRepliesForPhase('awaiting_list'),
    session: DEFAULT_SESSION,
  }
}
