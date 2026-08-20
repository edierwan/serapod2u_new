import { sendToAi } from '@/lib/ai/aiGateway'
import { logAiUsage } from '@/lib/server/ai/usageLogger'
import { runSerappConfirmOrder, runSerappStockCheck } from '@/lib/serapp/assistant-actions'
import {
  formatCheckIntro,
  formatConfirmIntro,
  formatProductInquiryReply,
  helpBotText,
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

function buildSerappAiSystemPrompt(session: SerappChatSessionState, distributorName: string): string {
  return `You are Serapp Assistant — a smart WhatsApp-style ordering bot for Serapod2U distributors.

Capabilities (the server executes these for real):
- check_stock: live warehouse stock check from a product list
- search_catalog: look up product names / availability
- confirm: submit the last checked order (1-hour warehouse hold)
- cancel_hold: cancel the last confirmed hold in this chat
- new_order: clear this chat order state
- help: explain how ordering works
- chat: normal conversation only

Session:
${buildSessionContext(session, distributorName)}

Rules:
- Match the user's language (English / Malay / Arabic / mixed).
- Be warm, concise, WhatsApp-like (1–5 short lines).
- Never invent stock numbers, prices, or order IDs — only use session context or let the server run checks.
- When the user wants stock checked, convert their request to paste lines like "BANANA VANILLA - 100" (one per line, HERO/ZERO sections allowed).
- When they ask "do you have X" without qty → search_catalog.
- When they say confirm / yes / ok / تأكيد / confirm order and phase is checked → confirm.
- If they only say "I want" / "بدي" / "nak" without a product → ask what product & qty (chat action only).

If a server action is needed, end your message with exactly one line:
SERAPP_ACTION:{"action":"check_stock","pasteText":"BANANA VANILLA - 100\\nGUAVA - 50"}
or SERAPP_ACTION:{"action":"search_catalog","query":"mango hero"}
or SERAPP_ACTION:{"action":"confirm"}
or SERAPP_ACTION:{"action":"cancel_hold"}
or SERAPP_ACTION:{"action":"new_order"}
or SERAPP_ACTION:{"action":"help"}
For pure conversation with no server action, omit the SERAPP_ACTION line.

Write your friendly reply first, then the optional SERAPP_ACTION line last.`
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

async function postJson<T>(
  request: Request,
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; data: T & { error?: string } }> {
  const url = new URL(path, request.url)
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: request.headers.get('cookie') || '',
    },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  return { ok: res.ok, status: res.status, data }
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
  const started = Date.now()

  const aiResponse = await sendToAi(
    {
      message: input.text,
      systemInstruction: buildSerappAiSystemPrompt(input.session, input.distributorName),
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
      text: reply ? `${reply}\n\n${helpBotText()}` : helpBotText(),
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
    }
    return {
      text: reply || 'Ready for a new order — tell me what you need.',
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
      const catalogReply = formatProductInquiryReply(action.query, variants)
      return {
        text: reply ? `${reply}\n\n${catalogReply}` : catalogReply,
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
      }
      const intro = formatCheckIntro(check.summary, check.warehouseName)
      return {
        text: reply ? `${reply}\n\n${intro}` : intro,
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
    const { ok, data } = await postJson<{ error?: string }>(
      input.request,
      '/api/serapp/cancel-hold',
      { orderId },
    )
    if (!ok) {
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
    }
    return {
      text: reply || `Hold cancelled for *${orderNo}*. Ready for a new order.`,
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
