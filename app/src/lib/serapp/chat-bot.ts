import type { PasteMatchResult } from '@/components/orders/quick-order-matcher'
import type { SerappChatQuickReply, SerappChatSessionState } from '@/lib/serapp/chat-types'
import type { SerappPasteCheckSummary } from '@/lib/serapp/paste-check-summary'
import {
  extractProductInquiry,
  looksLikeIncompleteIntent,
  resolveNaturalOrderPasteText,
} from '@/lib/serapp/natural-order-text'

export type SerappChatIntent =
  | { type: 'greeting' }
  | { type: 'help' }
  | { type: 'order_list'; pasteText: string }
  | { type: 'product_inquiry'; query: string }
  | { type: 'incomplete_intent' }
  | { type: 'confirm' }
  | { type: 'check_again' }
  | { type: 'new_order' }
  | { type: 'repeat_last' }
  | { type: 'cancel_hold' }
  | { type: 'unknown'; text: string }

/** Shorthand sample matching production paste (variant Product Codes). */
export const SERAPP_SAMPLE_LIST = 'CV - 50\nGU - 100\nLB - 200'

/** Free-text and product questions go to AI when enabled — paste/commands stay on rules. */
export function shouldRouteToSerappAi(intent: SerappChatIntent): boolean {
  return (
    intent.type === 'unknown'
    || intent.type === 'incomplete_intent'
    || intent.type === 'product_inquiry'
    || intent.type === 'greeting'
  )
}

/**
 * After HQ/admin joins, bot stays quiet for casual chat, but still answers
 * clear order/stock intents (paste, confirm, cancel, help, product lookup).
 */
export function isAllowedDuringHumanHandoff(
  intent: SerappChatIntent,
  session: SerappChatSessionState,
): boolean {
  switch (intent.type) {
    case 'help':
    case 'new_order':
    case 'order_list':
    case 'product_inquiry':
      return true
    case 'confirm':
      return session.phase === 'checked'
    case 'cancel_hold':
      return Boolean(session.lastConfirm?.orderId)
    case 'check_again':
      return Boolean(session.pendingPasteText || session.lastCheck?.pasteText)
    case 'repeat_last':
      return Boolean(session.lastCheck?.pasteText || session.pendingPasteText)
    default:
      return false
  }
}

/**
 * Decide whether SerApp bot should reply to this sender/message.
 * HQ messages never get a bot reply; they open human handoff mode.
 */
export function shouldRunSerappBot(input: {
  isHqSender: boolean
  text: string
  session: SerappChatSessionState
}): { run: boolean; session: SerappChatSessionState } {
  if (input.isHqSender) {
    return {
      run: false,
      session: { ...input.session, humanHandoff: true },
    }
  }

  if (!input.session.humanHandoff) {
    return { run: true, session: input.session }
  }

  const intent = detectChatIntent(input.text)
  if (isAllowedDuringHumanHandoff(intent, input.session)) {
    return { run: true, session: input.session }
  }

  return { run: false, session: input.session }
}

const LINE_QTY =
  /^.+?\s*[-–—xX×]\s*\d+(\.\d+)?\s*$/m
const SECTION = /^(HERO|ZERO|CLASSIC|ICE|SERIES)\s*$/im

/**
 * Heuristic: multi-line paste that looks like a distributor order list.
 */
export function looksLikeOrderList(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.length < 2) {
    // Single product line with qty still counts
    return LINE_QTY.test(trimmed)
  }
  const productish = lines.filter((line) => LINE_QTY.test(line) || SECTION.test(line))
  return productish.length >= 2 || (productish.length >= 1 && lines.length >= 2)
}

export function detectChatIntent(raw: string): SerappChatIntent {
  const text = raw.trim()
  if (!text) return { type: 'unknown', text: '' }

  if (looksLikeOrderList(text)) {
    return { type: 'order_list', pasteText: text }
  }

  const naturalPaste = resolveNaturalOrderPasteText(text)
  if (naturalPaste) {
    return { type: 'order_list', pasteText: naturalPaste }
  }

  const normalized = text.toLowerCase().replace(/[!?.]+$/g, '').trim()

  if (
    /^(hi|hello|hey|salam|assalam|good\s*(morning|afternoon|evening)|مرحبا|اهلا|هلا)$/i.test(
      normalized,
    )
  ) {
    return { type: 'greeting' }
  }

  if (
    /^(help|menu|start|how|ماذا|مساعدة|كيف)$/i.test(normalized) ||
    normalized.includes('how do i') ||
    normalized.includes('what can you')
  ) {
    return { type: 'help' }
  }

  if (
    /^(confirm|confirm order|yes|ok|okay|send|submit|sah|sahkan|confirm kan|تأكيد|ارسل|أرسل|موافق)$/i.test(normalized) ||
    normalized === 'confirm available only' ||
    normalized === 'confirm available'
  ) {
    return { type: 'confirm' }
  }

  if (
    /^(check|check again|recheck|cek|cek semula|تحقق|افحص)$/i.test(normalized)
  ) {
    return { type: 'check_again' }
  }

  if (
    /^(new|new order|reset|clear|order baru|pesanan baru|طلب جديد|جديد)$/i.test(normalized)
  ) {
    return { type: 'new_order' }
  }

  if (
    /^(repeat|again|same|repeat last|repeat last list|ulang|كرر|نفس الطلب|نفس القائمة)$/i.test(normalized)
  ) {
    return { type: 'repeat_last' }
  }

  if (
    /^(cancel|cancel hold|cancel order|batal|batal hold|الغاء|إلغاء)$/i.test(normalized)
  ) {
    return { type: 'cancel_hold' }
  }

  const inquiry = extractProductInquiry(text)
  if (inquiry) {
    return { type: 'product_inquiry', query: inquiry.name }
  }

  if (looksLikeIncompleteIntent(text)) {
    return { type: 'incomplete_intent' }
  }

  return { type: 'unknown', text }
}

export function welcomeBotText(distributorName: string, warehouseHint?: string | null): string {
  const wh = String(warehouseHint || '').trim()
  const lines = [
    `👋 Hi **${distributorName}**`,
  ]
  if (wh && wh.toLowerCase() !== 'your warehouse') {
    lines.push(`Orders ship from: **${wh}**`)
  }
  lines.push(
    '',
    'To order, send **product code + quantity** — one line each:',
    '• **CV - 50**',
    '• **GU - 100**',
    '• **banana vanilla - 20**',
    '',
    'To check stock only, send the code alone (e.g. **CV**).',
    '',
    '👉 **Next step:** Send your list now. When stock looks good, reply **confirm**.',
  )
  return lines.join('\n')
}

export function helpBotText(): string {
  return [
    '**How to order**',
    '',
    '1. Send **code + qty** (one line per product)',
    '   • **CV - 50**',
    '   • **GU - 100**',
    '',
    '2. Or send **CV** alone to check stock first',
    '',
    '3. Reply **confirm** to place the order',
    '',
    '👉 **Next step:** Send your product list, or tap **Sample list**.',
  ].join('\n')
}

export function newOrderBotText(): string {
  return [
    'Send **code + qty** — one line per product:',
    '• **CV - 50**',
    '• **GU - 100**',
    '',
    'When stock looks good, reply **confirm**.',
  ].join('\n')
}

export function quickRepliesForPhase(
  phase: SerappChatSessionState['phase'],
  bucket?: SerappPasteCheckSummary['bucket'] | null,
): SerappChatQuickReply[] {
  if (phase === 'idle' || phase === 'awaiting_list') {
    return [
      { id: 'help', label: 'Help', sendText: 'help' },
      { id: 'sample', label: 'Sample list', sendText: SERAPP_SAMPLE_LIST },
    ]
  }

  if (phase === 'checked') {
    if (bucket === 'available' || bucket === 'partially_available') {
      return [
        {
          id: 'confirm',
          label: bucket === 'partially_available' ? 'Confirm available only' : 'Confirm order',
          sendText: 'confirm',
        },
        { id: 'new', label: 'New order', sendText: 'new order' },
        { id: 'help', label: 'Help', sendText: 'help' },
      ]
    }
    return [
      { id: 'new', label: 'Paste a new list', sendText: 'new order' },
      { id: 'help', label: 'Help', sendText: 'help' },
    ]
  }

  if (phase === 'confirmed') {
    return [
      { id: 'new', label: 'New order', sendText: 'new order' },
      { id: 'cancel', label: 'Cancel hold', sendText: 'cancel hold' },
    ]
  }

  return [{ id: 'help', label: 'Help', sendText: 'help' }]
}

export function formatCheckIntro(
  summary: SerappPasteCheckSummary,
  _warehouseName?: string | null,
  _options?: {
    estimatedOrderValue?: number
    results?: PasteMatchResult[]
  },
): string {
  // Details (qty / warehouse / price / next step) live in the check card — keep intro short.
  if (summary.bucket === 'available') return '✅ **Ready to order**'
  if (summary.bucket === 'partially_available') return '🟡 **Partially available**'
  if (summary.bucket === 'out_of_stock') return '🔴 **Out of stock**'
  return '⚠️ **Please clarify some items**'
}

export function formatConfirmIntro(orderNo: string, expiresAt?: string | null): string {
  const holdLine = expiresAt
    ? new Date(expiresAt).toLocaleString()
    : '1-hour hold'
  return [
    `✅ **Submitted** · **${orderNo}**`,
    `Hold until: ${holdLine}`,
    `Next: warehouse accept → DO`,
  ].join('\n')
}

export function incompleteIntentBotText(): string {
  return [
    `Need **item + qty**. Examples:`,
    `**CV - 50**`,
    `**GU - 100**`,
    `Or send **CV** first to check stock.`,
  ].join('\n')
}

export function formatProductInquiryReply(
  query: string,
  variants: Array<{
    product_name: string
    variant_name: string
    product_code: string
    available_qty?: number
    inventory_classification?: string
  }>,
): string {
  if (variants.length === 0) {
    return [
      `🔎 No items for **${query}**`,
      `Try another code/name, or order like:`,
      `**CV - 50**`,
      `**GU - 100**`,
    ].join('\n')
  }

  const top = variants.slice(0, 3)
  const bestCode = top[0]?.product_code || query.toUpperCase()

  const shortLabel = (variantName: string) => {
    const bracket = variantName.match(/\[\s*([^\]]+?)\s*\]/)
    if (bracket?.[1]) return bracket[1].trim()
    return variantName
      .replace(/^(Deluxe|Fruity)\s+Cellera\s+Cartridge\s*/i, '')
      .trim() || variantName
  }

  const stockLabel = (qty: number | null | undefined) => {
    if (typeof qty !== 'number') return 'stock unknown'
    if (qty <= 0) return 'out of stock'
    return `${qty.toLocaleString('en-US')} in stock`
  }

  const itemLine = (variant: (typeof top)[number]) => {
    const label = shortLabel(variant.variant_name)
    const stock = stockLabel(variant.available_qty)
    return `• **${variant.product_code}** — ${label} · ${stock}`
  }

  if (top.length === 1) {
    const only = top[0]
    const label = shortLabel(only.variant_name)
    const stock = stockLabel(only.available_qty)
    return [
      `✅ **${only.product_code}** — ${label} · ${stock}`,
      '',
      `👉 To order, send **code + qty** in one message — e.g. **${only.product_code} - 50**`,
    ].join('\n')
  }

  return [
    `✅ **${query}**`,
    ...top.map(itemLine),
    '',
    `👉 To order, send **code + qty** in one message — e.g. **${bestCode} - 50**`,
  ].join('\n')
}

export function unknownBotText(): string {
  return [
    `❗ Not clear. Try:`,
    `**CV - 50**`,
    `**GU - 100**`,
    `Or **CV** to check stock · **help** for more`,
  ].join('\n')
}

export function createMessageId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
