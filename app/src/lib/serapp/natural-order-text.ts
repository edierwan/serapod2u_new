/**
 * Turn casual chat (EN / MS / AR) into paste-check lines the matcher already understands.
 * Does not change inventory rules — only normalizes free-text before matchPastedOrder.
 */

export type NaturalOrderLine = { name: string; qty: number }

const QTY_UNIT = String.raw`(?:pcs?|pieces?|units?|unit|kotak|kotak?|box(?:es)?|cases?|ctn|carton?s?|buah|unit)?`

const STRIP_PREFIX = new RegExp(
  String.raw`^(?:please|pls|can you|could you|i need|i want|need|want|order|get me|give me|`
  + String.raw`nak|nak order|boleh|boleh tak|ada|ada tak|mahu|hendak|`
  + String.raw`أريد|اريد|بدي|ابغى|ابغي|عايز|محتاج|`
  + String.raw`do you have|have you got|is there|any|check|cek|check stock|cek stok|`
  + String.raw`berapa|berapa banyak|`
  + String.raw`stock|stok|available|availability|`
  + String.raw`(?:ada\s+)?stok)\s+`,
  'iu',
)

const STRIP_SUFFIX = new RegExp(
  String.raw`\s*(?:\?|!|\.)?$|` +
  String.raw`\s*(?:available|avail|in stock|stok|stock|ada tak|tak|ke|kah|`
  + String.raw`متوفر|موجود|available\?)\s*(?:\?|!|\.)?$`,
  'iu',
)

const SECTION_ONLY = /^(HERO|ZERO|CLASSIC|ICE|SERIES)$/i

const INTENT_ONLY = new RegExp(
  String.raw`^(?:please|pls|`
  + String.raw`i need|i want|need|want|order|get me|give me|`
  + String.raw`nak|mahu|hendak|boleh|`
  + String.raw`أريد|اريد|بدي|ابغى|ابغي|عايز|محتاج|`
  + String.raw`do you have|have you got|is there|any|check|cek|`
  + String.raw`stock|stok|available|availability|`
  + String.raw`help|menu|confirm|cancel|new|reset|hello|hi|hey|salam|thanks|ok|okay|yes|no)$`,
  'iu',
)

export function looksLikeIncompleteIntent(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return true
  return INTENT_ONLY.test(trimmed)
}

/** Conversational availability question without a usable quantity. */
export function extractProductInquiry(text: string): { name: string } | null {
  const cleaned = cleanChatText(text)
  if (!cleaned || looksLikeCommandOnly(cleaned) || looksLikeIncompleteIntent(cleaned)) return null

  const inquiryPatterns = [
    new RegExp(
      String.raw`^(?:do you have|have you got|is there|any|check|cek|ada(?:\s+stok)?|boleh(?:\s+dapat)?|`
      + String.raw`متوفر|موجود|عندكم|عندك|في\s+المخزون)\s+(.+)$`,
      'iu',
    ),
    /^(.+?)\s+(?:available|in stock|ada tak|stok ok|got stock|متوفر|موجود)\??$/iu,
    /^(?:stok|stock)\s+(.+?)(?:\s+tak|\?)?$/iu,
  ]

  for (const pattern of inquiryPatterns) {
    const match = cleaned.match(pattern)
    const name = (match?.[1] || '').trim()
    if (name.length >= 2 && !SECTION_ONLY.test(name)) {
      return { name: stripSectionHint(name) }
    }
  }

  // Name only, no digits — treat as stock lookup (e.g. "banana vanilla", "mango hero")
  if (!/\d/.test(cleaned) && cleaned.length >= 3 && !SECTION_ONLY.test(cleaned)) {
    return { name: stripSectionHint(cleaned) }
  }

  return null
}

/** Parse one or more product + qty pairs from a single chat message. */
export function extractOrderLinesFromNaturalText(text: string): NaturalOrderLine[] | null {
  const cleaned = cleanChatText(text)
  if (!cleaned || looksLikeCommandOnly(cleaned)) return null

  const chunks = splitMultiProduct(cleaned)
  const lines: NaturalOrderLine[] = []

  for (const chunk of chunks) {
    const parsed = parseSingleChunk(chunk)
    if (parsed) lines.push(parsed)
  }

  return lines.length > 0 ? lines : null
}

export function normalizeToPasteText(lines: NaturalOrderLine[]): string {
  return lines
    .map((line) => {
      const section = detectInlineSection(line.name)
      if (section) return section
      return `${line.name.trim()} - ${line.qty}`
    })
    .join('\n')
}

export function resolveNaturalOrderPasteText(text: string): string | null {
  const lines = extractOrderLinesFromNaturalText(text)
  if (!lines?.length) return null
  return normalizeToPasteText(lines)
}

function cleanChatText(text: string): string {
  let cleaned = text
    .trim()
    .replace(/["""]/g, '')
    .replace(/\s+/g, ' ')
  for (let pass = 0; pass < 4; pass += 1) {
    const next = cleaned.replace(STRIP_PREFIX, '').replace(STRIP_SUFFIX, '').trim()
    if (next === cleaned) break
    cleaned = next
  }
  return cleaned
}

function looksLikeCommandOnly(text: string): boolean {
  return /^(confirm|help|cancel|new order|check again|hello|hi|hey|salam|thanks|thank you|ok|okay|yes|no)$/i.test(text)
}

function splitMultiProduct(text: string): string[] {
  const byAnd = text.split(/\s+(?:and|&|dan|و|،)\s+/i).map((part) => part.trim()).filter(Boolean)
  return byAnd.length > 1 ? byAnd : [text]
}

function parseSingleChunk(chunk: string): NaturalOrderLine | null {
  const section = chunk.match(/^(HERO|ZERO)\s+(.+)$/i)
  if (section) {
    const rest = section[2].trim()
    const inner = parseQuantityPair(rest)
    if (inner) return { name: `${section[1].toUpperCase()} ${inner.name}`, qty: inner.qty }
  }

  const patterns: Array<{ re: RegExp; nameIdx: number; qtyIdx: number }> = [
    // banana vanilla - 100 / banana x 50 / banana:100
    { re: new RegExp(String.raw`^(.+?)\s*[-–—:=x×]\s*(\d+(?:\.\d+)?)\s*${QTY_UNIT}?\s*$`, 'i'), nameIdx: 1, qtyIdx: 2 },
    // 100 banana / 50 pcs guava / nak 30 mango
    { re: new RegExp(String.raw`^(\d+(?:\.\d+)?)\s*${QTY_UNIT}?\s*(?:of\s+)?(.+)$`, 'i'), nameIdx: 2, qtyIdx: 1 },
    // banana 100 / mango vanilla 50 pcs
    { re: new RegExp(String.raw`^(.+?)\s+(\d+(?:\.\d+)?)\s*${QTY_UNIT}?\s*$`, 'i'), nameIdx: 1, qtyIdx: 2 },
    // order 50 banana
    { re: /^order\s+(\d+(?:\.\d+)?)\s+(.+)$/i, nameIdx: 2, qtyIdx: 1 },
  ]

  for (const { re, nameIdx, qtyIdx } of patterns) {
    const match = chunk.match(re)
    if (!match) continue
    const name = stripSectionHint(String(match[nameIdx] || '').trim())
    const qty = Math.trunc(Number(match[qtyIdx]))
    if (name.length >= 2 && qty > 0 && !SECTION_ONLY.test(name)) {
      return { name, qty }
    }
  }

  return null
}

function stripSectionHint(name: string): string {
  return name.replace(/^(?:hero|zero)\s+/i, '').trim() || name
}

function detectInlineSection(name: string): string | null {
  if (/^HERO$/i.test(name.trim())) return 'HERO'
  if (/^ZERO$/i.test(name.trim())) return 'ZERO'
  return null
}

function parseQuantityPair(text: string): NaturalOrderLine | null {
  const m = text.match(new RegExp(String.raw`^(.+?)\s+(\d+(?:\.\d+)?)\s*${QTY_UNIT}?\s*$`, 'i'))
    || text.match(new RegExp(String.raw`^(\d+(?:\.\d+)?)\s*${QTY_UNIT}?\s+(.+)$`, 'i'))
  if (!m) return null
  const name = (m[1]?.match(/\d/) ? m[2] : m[1])?.trim()
  const qtyRaw = m[1]?.match(/\d/) ? m[1] : m[2]
  const qty = Math.trunc(Number(qtyRaw))
  if (!name || qty <= 0) return null
  return { name, qty }
}
