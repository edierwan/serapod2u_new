import type { SerappChatQuickReply, SerappChatSessionState } from '@/lib/serapp/chat-types'
import type { SerappPasteCheckSummary } from '@/lib/serapp/paste-check-summary'

export type SerappChatIntent =
  | { type: 'greeting' }
  | { type: 'help' }
  | { type: 'order_list'; pasteText: string }
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

  return { type: 'unknown', text }
}

export function welcomeBotText(distributorName: string, warehouseHint?: string | null): string {
  const wh = warehouseHint ? `\nWarehouse: *${warehouseHint}*` : ''
  return [
    `Hi — I'm *Serapp Assistant* for *${distributorName}*.${wh}`,
    '',
    'Chat with me like WhatsApp:',
    '1) Paste your product list (HERO / ZERO sections ok)',
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
    '• *Confirm* allocates stock and starts the 1-hour warehouse window',
    '• Delivery Order (DO) is issued automatically after warehouse acceptance — open Warehouse chat for the PDF',
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
      { id: 'new', label: 'Fix & paste again', sendText: 'new order' },
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
      : 'Fix the lines that need review / are out of stock, then paste again.',
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
    'Warehouse can accept from History. After acceptance, Delivery Order (DO) is issued automatically — ask for *do status* or open the PDF from Warehouse chat.',
    '',
    'Say *new order* to start another list, or *cancel hold* before the warehouse accepts.',
  ].join('\n')
}

export function unknownBotText(): string {
  return [
    "I didn't catch that.",
    'Paste a product list, or try: *help* · *confirm* · *new order*',
  ].join('\n')
}

export function createMessageId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
