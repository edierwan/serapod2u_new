import {
  ackBotText,
  canShowSerappConfirmButton,
  detectChatIntent,
  formatCheckIntro,
  formatConfirmIntro,
  formatProductInquiryReply,
  helpBotText,
  incompleteIntentBotText,
  newOrderBotText,
  quickRepliesForPhase,
  shouldRouteToSerappAi,
  unknownBotText,
  welcomeBotText,
} from '@/lib/serapp/chat-bot'
import { searchSerappCatalog } from '@/lib/serapp/catalog-search'
import { runSerappCancelHold, runSerappConfirmOrder, runSerappStockCheck } from '@/lib/serapp/assistant-actions'
import type {
  SerappChatCheckPayload,
  SerappChatConfirmPayload,
  SerappDoStoryItem,
  SerappChatQuickReply,
  SerappChatSessionState,
  ChatTurnBotReply,
} from '@/lib/serapp/chat-types'
import { DEFAULT_SESSION } from '@/lib/serapp/conversation-types'
import type { SerappConversationKind } from '@/lib/serapp/conversation-types'
import { trySerappAiTurn } from '@/lib/serapp/serapp-ai-turn'

export type { ChatTurnBotReply } from '@/lib/serapp/chat-types'

async function getJson<T>(
  request: Request,
  path: string,
): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  const url = new URL(path, request.url)
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      cookie: request.headers.get('cookie') || '',
    },
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  return { ok: res.ok, status: res.status, data }
}

export async function processSerappChatTurn(input: {
  request: Request
  kind: SerappConversationKind
  text: string
  session: SerappChatSessionState
  distributorName: string
  distributorId?: string | null
  userId?: string | null
  orgId?: string | null
  conversationId?: string | null
}): Promise<ChatTurnBotReply> {
  const { kind, text, session, distributorName, distributorId, request } = input

  if (kind === 'warehouse') {
    return warehouseTurn(request, text, session)
  }
  if (kind === 'news') {
    return newsTurn(text, session)
  }
  if (kind === 'support') {
    return {
      text: [
        '🧩 **HQ / Accounts Support**',
        '',
        `Use **Serapp Assistant** for orders.`,
        `Select distributor under your organization first.`,
        `Shorthand works from **Master Data**.`,
        `Example:`,
        `**CV - 50**`,
        `**GU - 100**`,
      ].join('\n'),
      quickReplies: [{ id: 'help', label: 'Help', sendText: 'help' }],
      session,
    }
  }

  return assistantTurn({
    request,
    text,
    session,
    distributorName,
    distributorId,
    userId: input.userId,
    orgId: input.orgId,
    conversationId: input.conversationId,
  })
}

async function warehouseTurn(
  request: Request,
  text: string,
  session: SerappChatSessionState,
): Promise<ChatTurnBotReply> {
  const n = text.trim().toLowerCase()
  const replies: SerappChatQuickReply[] = [
    { id: 'holds', label: 'My holds', sendText: 'my holds' },
    { id: 'do', label: 'DO status', sendText: 'do status' },
    { id: 'help', label: 'Help', sendText: 'help' },
  ]

  if (n === 'help' || n.includes('how')) {
    return {
      text: [
        '🏭 **Warehouse Desk**',
        '',
        `**Hold:** 1 hour`,
        `**Accept:** from History`,
        `**After accept:** DO auto-issued`,
        `**Next:** approve in Current Orders`,
      ].join('\n'),
      quickReplies: replies,
      session,
    }
  }

  if (n.includes('hold') || n === 'my holds' || n.includes('accept')) {
    return {
      text: [
        `📦 **Holds**`,
        `Open **History** to view holds.`,
        `**Active:** waiting accept`,
        `**Accepted:** DO issued`,
        `**Next:** approve in Current Orders`,
        session.lastConfirm
          ? `\n**Last order:** ${session.lastConfirm.orderNo} (${session.lastConfirm.status})`
          : '\n**Last order:** none in this thread',
      ].join('\n'),
      quickReplies: replies,
      session,
    }
  }

  if (n.includes('do') || n.includes('delivery')) {
    const { ok, data } = await getJson<{
      stories?: SerappDoStoryItem[]
      error?: string
    }>(request, '/api/serapp/do-status?limit=5')

    if (!ok) {
      return {
        text: data.error || '❗ **Cannot load DO status now**',
        quickReplies: replies,
        session,
      }
    }

    const stories = data.stories || []
    if (stories.length === 0) {
      return {
        text: [
          `📄 **DO status**`,
          `No recent updates.`,
          `After warehouse accepts, DO appears here.`,
        ].join('\n'),
        quickReplies: replies,
        session,
      }
    }

    const lines = stories.map((s, idx) => {
      const doRef = s.do ? (s.do.displayDocNo || s.do.docNo) : null
      const doPart = doRef ? ` DO: ${doRef} (${String(s.do?.status || '').toLowerCase() || 'ready'})` : ''
      return `${idx + 1}) ${s.orderLabel} · hold ${s.holdStatus}${doPart}`
    })

    return {
      text: [
        '📄 **DO status (latest)**',
        '',
        ...lines,
      ].join('\n'),
      card: {
        kind: 'do_stories',
        doStories: stories,
      },
      quickReplies: replies,
      session,
    }
  }

  return {
    text: '🏭 **Warehouse Desk**\nTry: **my holds** · **do status** · **help**',
    quickReplies: replies,
    session,
  }
}

function newsTurn(text: string, session: SerappChatSessionState): ChatTurnBotReply {
  const n = text.trim().toLowerCase()
  const replies: SerappChatQuickReply[] = [
    { id: 'latest', label: 'Latest news', sendText: 'latest' },
    { id: 'help', label: 'Help', sendText: 'help' },
  ]

  if (n === 'latest' || n.includes('news') || n.includes('update')) {
    return {
      text: [
        '📢 **Latest news**',
        '',
        'Serapp chat is live.',
        'Confirm starts 1-hour hold.',
        'More updates will appear here.',
      ].join('\n'),
      quickReplies: replies,
      session,
    }
  }

  return {
    text: '📢 **News thread**\nTap **Latest news**',
    quickReplies: replies,
    session,
  }
}

async function assistantTurn(input: {
  request: Request
  text: string
  session: SerappChatSessionState
  distributorName: string
  distributorId?: string | null
  userId?: string | null
  orgId?: string | null
  conversationId?: string | null
}): Promise<ChatTurnBotReply> {
  const intent = detectChatIntent(input.text)
  let session = { ...input.session }

  if (input.userId && input.orgId && shouldRouteToSerappAi(intent)) {
    const aiReply = await trySerappAiTurn({
      request: input.request,
      text: input.text,
      session: input.session,
      distributorName: input.distributorName,
      distributorId: input.distributorId,
      userId: input.userId,
      orgId: input.orgId,
      conversationId: input.conversationId,
    })
    if (aiReply) return aiReply
  }

  if (intent.type === 'greeting') {
    return {
      text: welcomeBotText(input.distributorName),
      quickReplies: quickRepliesForPhase(
        session.phase === 'idle' ? 'awaiting_list' : session.phase,
        session.lastCheck?.summary.bucket,
      ),
      session,
    }
  }

  if (intent.type === 'help') {
    return {
      text: helpBotText(),
      quickReplies: quickRepliesForPhase(
        session.phase === 'idle' ? 'awaiting_list' : session.phase,
        session.lastCheck?.summary.bucket,
      ),
      session,
    }
  }

  if (intent.type === 'new_order') {
    const lastPaste = session.lastCheck?.pasteText || session.pendingPasteText
    session = {
      ...DEFAULT_SESSION,
      phase: 'awaiting_list',
      distributorId: input.distributorId || session.distributorId,
      pendingPasteText: lastPaste,
      humanHandoff: session.humanHandoff,
    }
    return {
      text: newOrderBotText(),
      quickReplies: quickRepliesForPhase('awaiting_list'),
      session,
    }
  }

  if (intent.type === 'repeat_last') {
    const pasteText = session.lastCheck?.pasteText || session.pendingPasteText
    if (!pasteText) {
      return {
        text: '❗ **No previous list**\nPaste one first, e.g.\n**CV - 50**\n**GU - 100**',
        quickReplies: quickRepliesForPhase('awaiting_list'),
        session: { ...session, phase: 'awaiting_list' },
      }
    }
    return assistantTurn({
      ...input,
      text: pasteText,
      session,
    })
  }

  if (intent.type === 'order_list' || intent.type === 'check_again') {
    const pasteText =
      intent.type === 'order_list' ? intent.pasteText : session.pendingPasteText
    if (!pasteText) {
      return {
        text: '❗ **No list found**\nPaste list first.',
        quickReplies: quickRepliesForPhase('awaiting_list'),
        session: { ...session, phase: 'awaiting_list' },
      }
    }

    const lineResolutions = intent.type === 'check_again'
      ? (session.lineResolutions || [])
      : []
    const quantityResolutions = intent.type === 'check_again'
      ? (session.quantityResolutions || [])
      : []

    try {
      const check = await runSerappStockCheck({
        pasteText,
        distributorId: input.distributorId || session.distributorId || undefined,
        lineResolutions,
        quantityResolutions,
      })

      session = {
        phase: 'checked',
        pendingPasteText: pasteText,
        lastCheck: check,
        lastConfirm: null,
        distributorId: input.distributorId || session.distributorId,
        lineResolutions,
        quantityResolutions,
        humanHandoff: session.humanHandoff,
      }

      return {
        text: formatCheckIntro(check.summary, check.warehouseName, {
          estimatedOrderValue: check.estimatedOrderValue,
          results: check.results,
        }),
        card: { kind: 'check_summary', check },
        quickReplies: quickRepliesForPhase('checked', check.summary.bucket),
        session,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Stock check failed.'
      return {
        text: message,
        card: { kind: 'error', error: message },
        quickReplies: quickRepliesForPhase('awaiting_list'),
        session: { ...session, phase: 'awaiting_list' },
      }
    }
  }

  if (intent.type === 'ack') {
    return {
      text: ackBotText(session),
      quickReplies: quickRepliesForPhase(
        session.phase === 'idle' ? 'awaiting_list' : session.phase,
        session.lastCheck?.summary.bucket,
      ),
      session,
    }
  }

  if (intent.type === 'confirm') {
    const pasteText = session.pendingPasteText
    if (!pasteText || !session.lastCheck) {
      return {
        text: 'Paste an order list first so I can check stock, then confirm.',
        quickReplies: quickRepliesForPhase('awaiting_list'),
        session,
      }
    }

    const bucket = session.lastCheck.summary.bucket
    const { results } = session.lastCheck
    if (!canShowSerappConfirmButton(session.lastCheck.summary, results)) {
      return {
        text: `❗ **Cannot confirm**\n**Status:** ${session.lastCheck.summary.label}\n**Next:** Pick match or paste fix`,
        quickReplies: quickRepliesForPhase('checked', bucket, results),
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
      quantityResolutions: session.quantityResolutions || [],
      request: input.request,
    })

    if (!data.ok || !data.order) {
      return {
        text: (!data.ok && data.error) || '❗ **Confirm failed**',
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

    session = {
      ...session,
      phase: 'confirmed',
      lastConfirm: confirm,
    }

    return {
      text: formatConfirmIntro(confirm.orderNo, confirm.holdExpiresAt),
      card: { kind: 'order_confirmed', confirm },
      quickReplies: quickRepliesForPhase('confirmed'),
      session,
    }
  }

  if (intent.type === 'incomplete_intent') {
    return {
      text: incompleteIntentBotText(),
      quickReplies: quickRepliesForPhase(
        session.phase === 'idle' ? 'awaiting_list' : session.phase,
        session.lastCheck?.summary.bucket,
      ),
      session,
    }
  }

  if (intent.type === 'product_inquiry') {
    try {
      const { variants } = await searchSerappCatalog({
        query: intent.query,
        distributorId: input.distributorId || session.distributorId || undefined,
      })

      return {
        text: formatProductInquiryReply(intent.query, variants),
        quickReplies: quickRepliesForPhase(
          session.phase === 'idle' ? 'awaiting_list' : session.phase,
          session.lastCheck?.summary.bucket,
        ),
        session,
      }
    } catch (error) {
      return {
        text: error instanceof Error ? error.message : '❗ **Catalog lookup failed**',
        quickReplies: quickRepliesForPhase(
          session.phase === 'idle' ? 'awaiting_list' : session.phase,
          session.lastCheck?.summary.bucket,
        ),
        session,
      }
    }
  }

  if (intent.type === 'cancel_hold') {
    const orderId = session.lastConfirm?.orderId
    if (!orderId) {
      return {
        text: '❗ **No active hold** in this chat.',
        quickReplies: quickRepliesForPhase(session.phase, session.lastCheck?.summary.bucket),
        session,
      }
    }

    const data = await runSerappCancelHold({
      orderId,
      notifyChat: false,
      request: input.request,
    })

    if (!data.ok) {
      return {
        text: data.error || '❗ **Cancel failed**',
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
      text: [
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

  // AI disabled or unavailable — rule-based fallback below.
  return {
    text: unknownBotText(),
    quickReplies: quickRepliesForPhase(
      session.phase === 'idle' ? 'awaiting_list' : session.phase,
      session.lastCheck?.summary.bucket,
    ),
    session,
  }
}
