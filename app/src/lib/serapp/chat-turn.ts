import {
  detectChatIntent,
  formatCheckIntro,
  formatConfirmIntro,
  formatProductInquiryReply,
  helpBotText,
  incompleteIntentBotText,
  quickRepliesForPhase,
  shouldRouteToSerappAi,
  unknownBotText,
  welcomeBotText,
} from '@/lib/serapp/chat-bot'
import { searchSerappCatalog } from '@/lib/serapp/catalog-search'
import { runSerappStockCheck } from '@/lib/serapp/assistant-actions'
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

async function postJson<T>(
  request: Request,
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
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
      text: 'Support chat — for ordering use *Serapp Assistant*. Say *help* anytime.',
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
        '*Warehouse Desk*',
        '',
        '• Active Serapp orders have a *1-hour* acceptance hold',
        '• HQ / warehouse accepts from History',
        '• After accept, Delivery Order (DO) is issued automatically',
        '• Next step: approve in *Current Orders* (Dashboard) for SO + Invoice, then warehouse ship',
        '',
        'Place new orders in *Serapp Assistant* — this chat stays for warehouse questions.',
      ].join('\n'),
      quickReplies: replies,
      session,
    }
  }

  if (n.includes('hold') || n === 'my holds' || n.includes('accept')) {
    return {
      text: [
        'Open *History* in the bottom nav to see holds for this distributor.',
        'Active = waiting for warehouse accept. Accepted = DO issued; next approve the order in Current Orders (Dashboard).',
        session.lastConfirm
          ? `\nLast order in a linked Assistant chat: *${session.lastConfirm.orderNo}* (${session.lastConfirm.status}).`
          : '\nNo confirm recorded in this Warehouse thread — check Assistant chats or History.',
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
        text: data.error || 'Unable to load DO status right now.',
        quickReplies: replies,
        session,
      }
    }

    const stories = data.stories || []
    if (stories.length === 0) {
      return {
        text: [
          'No recent Serapp DO updates yet.',
          'Once warehouse accepts a hold, DO is issued automatically and appears here with an Open DO PDF link.',
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
        '*DO Stories (latest)*',
        '',
        ...lines,
        '',
        'Tip: open History to accept pending holds faster.',
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
    text: "Warehouse Desk here. Try *my holds*, *do status*, or *help*.",
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
        '*Latest*',
        '',
        '• Serapp Chat is live — order via Assistant like WhatsApp',
        '• 1-hour warehouse acceptance hold on confirm',
        '• Paste HERO / ZERO lists supported',
        '',
        'More HQ announcements will appear in this thread.',
      ].join('\n'),
      quickReplies: replies,
      session,
    }
  }

  return {
    text: 'This is the News thread. Tap *Latest news* or open the News tab.',
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
    session = {
      ...DEFAULT_SESSION,
      phase: 'awaiting_list',
      distributorId: input.distributorId || session.distributorId,
    }
    return {
      text: 'Ready for a new list in *this* chat — paste whenever you like.',
      quickReplies: quickRepliesForPhase('awaiting_list'),
      session,
    }
  }

  if (intent.type === 'order_list' || intent.type === 'check_again') {
    const pasteText =
      intent.type === 'order_list' ? intent.pasteText : session.pendingPasteText
    if (!pasteText) {
      return {
        text: 'Paste a list first, then I can check again.',
        quickReplies: quickRepliesForPhase('awaiting_list'),
        session: { ...session, phase: 'awaiting_list' },
      }
    }

    const lineResolutions = intent.type === 'check_again'
      ? (session.lineResolutions || [])
      : []

    try {
      const check = await runSerappStockCheck({
        pasteText,
        distributorId: input.distributorId || session.distributorId || undefined,
        lineResolutions,
      })

      session = {
        phase: 'checked',
        pendingPasteText: pasteText,
        lastCheck: check,
        lastConfirm: null,
        distributorId: input.distributorId || session.distributorId,
        lineResolutions,
      }

      return {
        text: formatCheckIntro(check.summary, check.warehouseName),
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
    if (bucket !== 'available' && bucket !== 'partially_available') {
      return {
        text: `Cannot confirm while status is *${session.lastCheck.summary.label}*. Pick the real product on unmatched lines, or paste a corrected list.`,
        quickReplies: quickRepliesForPhase('checked', bucket),
        session,
      }
    }

    const idempotencyKey =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `serapp-chat-${Date.now()}`

    const { ok, data } = await postJson<{
      order?: { id: string; order_no: string; status: string }
      hold?: { expires_at: string } | null
      confirmedLines?: number
      skippedLines?: number
      estimatedOrderValue?: number
      fulfillmentWarehouse?: { name: string | null }
      note?: string
      error?: string
    }>(input.request, '/api/serapp/confirm-order', {
      pasteText,
      acceptAvailableOnly: true,
      idempotencyKey,
      distributorId: input.distributorId || session.distributorId || undefined,
      lineResolutions: session.lineResolutions || [],
    })

    if (!ok || !data.order) {
      return {
        text: data.error || 'Confirm failed.',
        card: { kind: 'error', error: data.error || 'Confirm failed.' },
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
        text: error instanceof Error ? error.message : 'Catalog lookup failed.',
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
        text: 'No active Serapp hold in *this* chat to cancel.',
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
        text: data.error || 'Cancel failed.',
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
      text: `Hold cancelled for *${orderNo}*. Stock released. This chat is ready for a new list.`,
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
