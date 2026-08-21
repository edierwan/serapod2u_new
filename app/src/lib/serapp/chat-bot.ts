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
  const wh = warehouseHint || 'your warehouse'
  return [
    `👋 Hi **${distributorName}**`,
    `Warehouse: ${wh}`,
    ``,
    `Order with **code + qty**. Examples:`,
    `**CV - 50**`,
    `**GU - 100**`,
    `**banana vanilla - 20**`,
    ``,
    `Or send a code only (e.g. **CV**) to check stock, then add qty.`,
    `When ready: **confirm**`,
  ].join('\n')
}

export function helpBotText(): string {
  return [
    `How to order:`,
    `1) Send **code + qty** (or a list)`,
    `   **CV - 50**`,
    `   **GU - 100**`,
    `   **banana vanilla - 20**`,
    `2) Or send **CV** alone → I show stock, then you add qty`,
    `3) Reply **confirm** (hold 1 hour)`,
    ``,
    `Also: **new order** · **cancel hold**`,
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

export function formatCheckIntro(summary: SerappPasteCheckSummary, warehouseName?: string | null): string {
  const wh = warehouseName || 'Warehouse'
  if (summary.bucket === 'available') {
    return [
      `✅ **Ready to confirm**`,
      `**Warehouse:** ${wh}`,
      `**Next:** **confirm**`,
    ].join('\n')
  }

  if (summary.bucket === 'partially_available') {
    return [
      `🟡 **Partially available**`,
      `**Warehouse:** ${wh}`,
      `**Next:** **confirm** (available only)`,
    ].join('\n')
  }

  if (summary.bucket === 'out_of_stock') {
    return [
      `🔴 **Out of stock**`,
      `**Warehouse:** ${wh}`,
      `**Next:** Paste a new list`,
    ].join('\n')
  }

  return [
    `🟠 **Needs review**`,
    `**Warehouse:** ${wh}`,
    `**Next:** Pick match or fix list`,
  ].join('\n')
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
  const lines = top.map((variant) => {
    const qty = typeof variant.available_qty === 'number' ? variant.available_qty : null
    const stock = qty === null ? 'stock ?' : qty > 0 ? `${qty} available` : 'out of stock'
    const flavour = variant.variant_name.replace(/^Deluxe Cellera Cartridge\s*/i, '').trim()
      || variant.variant_name
    return `**${variant.product_code}** · ${flavour} · ${stock}`
  })

  const bestCode = top[0]?.product_code || query.toUpperCase()
  return [
    `✅ Found for **${query}**`,
    ...lines,
    ``,
    `To order, add qty:`,
    `**${bestCode} - 50**`,
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
