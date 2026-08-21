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

/** Free-text only — structured paste/commands stay on the fast rules path. */
export function shouldRouteToSerappAi(intent: SerappChatIntent): boolean {
  return intent.type === 'unknown' || intent.type === 'incomplete_intent'
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
    /^(confirm|confirm order|yes|ok|okay|send|submit|تأكيد|ارسل|أرسل|موافق)$/i.test(normalized) ||
    normalized === 'confirm available only' ||
    normalized === 'confirm available'
  ) {
    return { type: 'confirm' }
  }

  if (
    /^(check|check again|recheck|تحقق|افحص)$/i.test(normalized)
  ) {
    return { type: 'check_again' }
  }

  if (
    /^(new|new order|reset|clear|طلب جديد|جديد)$/i.test(normalized)
  ) {
    return { type: 'new_order' }
  }

  if (
    /^(repeat|again|same|repeat last|repeat last list|كرر|نفس الطلب|نفس القائمة)$/i.test(normalized)
  ) {
    return { type: 'repeat_last' }
  }

  if (
    /^(cancel|cancel hold|cancel order|الغاء|إلغاء)$/i.test(normalized)
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
  const wh = warehouseHint || 'Selected warehouse'
  return [
    `👋 **Serapp Assistant**`,
    `**Distributor:** ${distributorName}`,
    `**Warehouse:** ${wh}`,
    '',
    `Send list like: **CV - 50**`,
    `Then reply: **confirm**`,
  ].join('\n')
}

export function helpBotText(): string {
  return [
    '🧭 **How to order**',
    '',
    `1) Paste list`,
    `   Example: **CV - 50**`,
    `   Example: **GU - 100**`,
    '',
    `2) Review result`,
    `   If needed: pick match or paste fix`,
    '',
    `3) Reply **confirm**`,
    `   Hold window: **1 hour**`,
    '',
    `Commands: **confirm** · **new order** · **help**`,
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
  const wh = warehouseName || 'Selected warehouse'
  if (summary.bucket === 'available') {
    return [
      `✅ **Ready to confirm**`,
      `**Warehouse:** ${wh}`,
      ``,
      `All items are available.`,
      `**Next:** Reply **confirm**`,
    ].join('\n')
  }

  if (summary.bucket === 'partially_available') {
    return [
      `🟡 **Partially available**`,
      `**Warehouse:** ${wh}`,
      ``,
      `Some items are available, some are not.`,
      `**Next:** Reply **confirm** for available items only`,
    ].join('\n')
  }

  if (summary.bucket === 'out_of_stock') {
    return [
      `🔴 **Out of stock**`,
      `**Warehouse:** ${wh}`,
      ``,
      `No items are currently available.`,
      `**Next:** Paste a new list`,
    ].join('\n')
  }

  return [
    `🟠 **Needs review**`,
    `**Warehouse:** ${wh}`,
    ``,
    `Some item names need correction.`,
    `**Next:** Pick match or paste corrected list`,
  ].join('\n')
}

export function formatConfirmIntro(orderNo: string, expiresAt?: string | null): string {
  const holdLine = expiresAt
    ? new Date(expiresAt).toLocaleString()
    : '1-hour hold active'
  return [
    `✅ **Submitted**`,
    `**Order:** ${orderNo}`,
    `**Hold:** ${holdLine}`,
    `**Next:** Warehouse accept`,
    `**Then:** DO auto-issued`,
  ].join('\n')
}

export function incompleteIntentBotText(): string {
  return [
    `❗ **Need item + qty**`,
    `Example: **CV - 50**`,
    `Example: **banana vanilla - 100**`,
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
      `🔎 **No match found**`,
      `**Search:** ${query}`,
      ``,
      `Try a clearer name.`,
      `Example: **BANANA VANILLA**`,
      `**Next:** Paste item + qty`,
    ].join('\n')
  }

  const lines = variants.slice(0, 5).map((variant, index) => {
    const label = `${variant.product_name} — ${variant.variant_name}`
    const qty = typeof variant.available_qty === 'number' ? variant.available_qty : null
    const stock = qty === null
      ? 'Stock unknown'
      : qty > 0
        ? `${qty} available`
        : 'Out of stock'
    const unclassified = variant.inventory_classification === 'unclassified' ? ' · Unclassified' : ''
    return [
      `${index + 1}) **${label}**`,
      `   **Code:** ${variant.product_code}`,
      `   **Stock:** ${stock}${unclassified}`,
    ].join('\n')
  })

  return [
    `✅ **Match found**`,
    `**Search:** ${query}`,
    '',
    ...lines,
    '',
    `**Next:** Send item + qty`,
    `Example: **BANANA VANILLA - 100**`,
  ].join('\n')
}

export function unknownBotText(): string {
  return [
    `❗ **Not clear**`,
    `Try: **CV - 50**`,
    `Or type: **help**`,
  ].join('\n')
}

export function createMessageId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
