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
  | { type: 'cancel_hold' }
  | { type: 'unknown'; text: string }

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
  const wh = warehouseHint ? `\nWarehouse: *${warehouseHint}*` : ''
  return [
    `Hi — I'm *Serapp Assistant* for *${distributorName}*.${wh}`,
    '',
    'Chat with me like WhatsApp:',
    '1) Paste a list *or* type naturally — e.g. *banana 100*, *100 guava*, *ada stok mango?*',
    '2) I check live warehouse stock',
    '3) You confirm → order goes to Current Order Module with a 1-hour warehouse hold',
    '',
    'Tap a quick reply or just paste your list.',
  ].join('\n')
}

export function helpBotText(): string {
  return [
    '*How ordering works*',
    '',
    '• Paste a list, e.g.',
    'HERO',
    'BANANA VANILLA - 100',
    'ZERO',
    'ALMOND - 100',
    '',
    '• I reply with Available / Partial / Out of Stock / Needs Review',
    '• If a line is unmatched, pick the real catalog item in the card',
    '• *Confirm* allocates stock and starts the 1-hour warehouse window',
    '• Delivery Order (DO) is issued automatically after warehouse acceptance — open Warehouse chat for the PDF',
    '• Or chat naturally: *banana 100*, *100 guava*, *ada stok mango?*, *do you have almond*',
    '• Ask free-text questions anytime — I use smart reply from your latest check/hold context',
    '',
    'Commands: *confirm* · *new order* · *help*',
  ].join('\n')
}

export function quickRepliesForPhase(
  phase: SerappChatSessionState['phase'],
  bucket?: SerappPasteCheckSummary['bucket'] | null,
): SerappChatQuickReply[] {
  if (phase === 'idle' || phase === 'awaiting_list') {
    return [
      { id: 'help', label: 'Help', sendText: 'help' },
      { id: 'sample', label: 'Sample list', sendText: 'HERO\nBANANA VANILLA - 100\nGUAVA - 200\n\nZERO\nALMOND - 100\nTEA - 200' },
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
  const wh = warehouseName ? ` at *${warehouseName}*` : ''
  return [
    `Stock check${wh}: *${summary.label}*`,
    '',
    `${summary.availableLines} available · ${summary.partialLines} partial · ${summary.outOfStockLines} out of stock · ${summary.reviewLines} need review`,
    '',
    summary.bucket === 'available' || summary.bucket === 'partially_available'
      ? 'Reply *confirm* to send this to the warehouse hold window.'
      : 'Tap a real product on unmatched lines below, or paste a corrected list.',
  ].join('\n')
}

export function formatConfirmIntro(orderNo: string, expiresAt?: string | null): string {
  const hold = expiresAt
    ? `\n1-hour warehouse acceptance hold until ${new Date(expiresAt).toLocaleString()}.`
    : ''
  return [
    `✅ Order *${orderNo}* submitted & stock allocated.`,
    hold,
    '',
    'Warehouse can accept from History. After acceptance, Delivery Order (DO) is issued automatically — then approve in Current Orders (Dashboard). Ask for *do status* or open the PDF from Warehouse chat.',
    '',
    'Say *new order* to start another list, or *cancel hold* before the warehouse accepts.',
  ].join('\n')
}

export function incompleteIntentBotText(): string {
  return [
    'Tell me the product and quantity.',
    'Examples: *banana 100* · *100 guava* · *ada stok mango?*',
    'أو اكتب: *موز 50* · *بدي banana vanilla 100*',
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
      `No catalog match for *${query}*.`,
      'Try a clearer name (e.g. BANANA VANILLA), paste a full list, or pick from suggestions when checking stock.',
    ].join('\n')
  }

  const lines = variants.slice(0, 5).map((variant, index) => {
    const label = `${variant.product_name} — ${variant.variant_name} (${variant.product_code})`
    const qty = typeof variant.available_qty === 'number' ? variant.available_qty : null
    const stock = qty === null
      ? 'stock unknown'
      : qty > 0
        ? `*${qty}* available`
        : 'out of stock'
    const unclassified = variant.inventory_classification === 'unclassified' ? ' · unclassified' : ''
    return `${index + 1}) ${label} · ${stock}${unclassified}`
  })

  return [
    `Matches for *${query}*:`,
    '',
    ...lines,
    '',
    'Reply with a quantity to check & hold, e.g. *banana vanilla 100*.',
  ].join('\n')
}

export function unknownBotText(): string {
  return [
    "I didn't catch that.",
    'Try: *banana 100* · *100 guava* · paste a list · *help*',
  ].join('\n')
}

export function createMessageId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
