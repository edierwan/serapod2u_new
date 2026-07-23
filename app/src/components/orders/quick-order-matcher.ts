import { normalizeAlternativeName } from '@/lib/products/alternative-name'

export interface MatchableVariant {
  id: string
  variant_name: string
  alternative_name?: string | null
  product_name: string
  product_code: string
  group_name?: string
  manufacturer_sku?: string | null
  available_qty?: number
  inventory_classification?: 'classified' | 'unclassified'
}

export type PasteMatchStatus = 'matched' | 'alternative_match' | 'smart_match' | 'suggestion' | 'ambiguous' | 'not_found' | 'invalid_quantity' | 'duplicate'

export type PasteMatchMethod = 'code_or_sku' | 'exact_name' | 'bracket_flavour' | 'alternative_name' | 'keyword' | 'fuzzy'

export type PasteInventoryOutcome = 'matched' | 'inventory_unclassified' | 'no_available_stock' | 'insufficient_stock'

export interface PasteMatchResult {
  /** Running 1-based index across every parsed entry (a physical line may hold several). */
  line: number
  /** Physical line (1-based) the entry was pasted on, kept for audit/display. */
  sourceLine: number
  raw: string
  name: string
  normalizedName: string
  quantity: number | null
  status: PasteMatchStatus
  candidates: MatchableVariant[]
  selectedVariantId?: string
  duplicateOfLine?: number
  matchMethod?: PasteMatchMethod
  inventoryOutcome?: PasteInventoryOutcome
}

export const normalizeOrderText = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleUpperCase()

const trailingWhatsAppMarkers = /(\d)\s*(?:(?:✅|❌|✔\uFE0F?|✖\uFE0F?|☑\uFE0F?)\s*)+$/u

export const stripTrailingWhatsAppMarkers = (value: string) => value.replace(trailingWhatsAppMarkers, '$1').trimEnd()

// Unicode dash variants (en/em/figure/quotation/minus) that users paste from
// phones and spreadsheets. All are single code points, so replacing them keeps
// string indices aligned with the untouched original used for `raw` slicing.
// Hyphen (U+2010) … horizontal bar (U+2015) plus the minus sign (U+2212).
const UNICODE_DASHES = /[‐-―−]/g

export const normalizeDashes = (value: string) => value.replace(UNICODE_DASHES, '-')

// Status emojis (✅ ❌ ✔️ ✖️ ☑️ ✓ ✗ ✘ ☒ and coloured status circles). They are
// treated purely as entry boundaries and never influence acceptance. A run of
// consecutive markers (each with an optional U+FE0F variation selector) collapses
// into a single boundary.
const buildStatusEmojiRegex = () =>
  /(?:[✅❌✔✖☑☒✓✗✘]️?|[\u{1F534}\u{1F7E2}\u{1F7E1}\u{1F7E0}\u{1F535}])+/gu

interface OrderToken {
  localStart: number
  localEnd: number
  name: string
  quantityText: string | null
}

// Consume as many "identifier + quantity" segments as a chunk contains, left to
// right. A quantity must be a digit run followed by whitespace or end-of-chunk,
// so digits embedded in a Product Code/SKU (for example "SKU-001") are not split
// off as a quantity. When the full matched slice is itself an authorized Product
// Code/SKU (for example "SKU-77"), the trailing digits stay part of the code and
// the real quantity is read from the text that follows it.
const tokenizeChunk = (chunk: string, codeSet: Set<string>): OrderToken[] => {
  const tokens: OrderToken[] = []
  const entry = /\s*(.+?)\s*(?:[-:=]+\s*|\t+\s*|\s+)(\d+)(?:\s*(?:PCS?|PIECES?|UNITS?))?(?=\s|$)/iy
  const trailingQuantity = /^\s*(?:[-:=]+\s*)?(\d+)(?:\s*(?:PCS?|PIECES?|UNITS?))?(?=\s|$)/i
  let pos = 0

  while (pos < chunk.length) {
    entry.lastIndex = pos
    const match = entry.exec(chunk)
    if (!match || match.index !== pos) break

    const matchedSlice = chunk.slice(pos, entry.lastIndex)
    if (codeSet.has(normalizeOrderText(matchedSlice))) {
      // Digits belong to the Product Code/SKU; look for the quantity after it.
      const remainder = chunk.slice(entry.lastIndex)
      const quantity = remainder.match(trailingQuantity)
      const localEnd = quantity ? entry.lastIndex + quantity[0].length : entry.lastIndex
      tokens.push({ localStart: pos, localEnd, name: matchedSlice.trim(), quantityText: quantity ? quantity[1] : null })
      pos = localEnd
      continue
    }

    tokens.push({ localStart: pos, localEnd: entry.lastIndex, name: match[1].trim(), quantityText: match[2] })
    pos = entry.lastIndex
  }

  // Anything left over could not be parsed as identifier + quantity. Keep it as a
  // standalone segment for manual review instead of dropping or merging it.
  const remainder = chunk.slice(pos)
  if (remainder.trim()) {
    tokens.push({ localStart: pos, localEnd: chunk.length, name: remainder.trim(), quantityText: null })
  }

  return tokens
}

interface ParsedSegment {
  raw: string
  name: string
  quantity: number | null
  sourceLine: number
}

// Turn one pasted physical line into one or more order entries. Emojis split the
// line into chunks; each chunk is then tokenized into repeated identifier+quantity
// segments. `raw` is sliced from the untouched original (including its trailing
// status emoji) so the pasted text is preserved for audit/display.
const parsePhysicalLine = (original: string, sourceLine: number, codeSet: Set<string>): ParsedSegment[] => {
  const work = normalizeDashes(original)
  const emoji = buildStatusEmojiRegex()
  const boundaries: { contentStart: number; contentEnd: number; rawEnd: number }[] = []
  let last = 0
  let marker: RegExpExecArray | null
  while ((marker = emoji.exec(work)) !== null) {
    boundaries.push({ contentStart: last, contentEnd: marker.index, rawEnd: marker.index + marker[0].length })
    last = marker.index + marker[0].length
  }
  boundaries.push({ contentStart: last, contentEnd: work.length, rawEnd: work.length })

  const segments: ParsedSegment[] = []
  for (const boundary of boundaries) {
    const content = work.slice(boundary.contentStart, boundary.contentEnd)
    if (!content.trim()) continue
    const tokens = tokenizeChunk(content, codeSet)
    tokens.forEach((token, index) => {
      const originalStart = boundary.contentStart + token.localStart
      // The last token in a chunk owns the trailing status emoji for audit display.
      const originalEnd = index === tokens.length - 1 ? boundary.rawEnd : boundary.contentStart + token.localEnd
      const raw = original.slice(originalStart, originalEnd).trim()
      const quantity = token.quantityText && /^\d+$/.test(token.quantityText) ? Number(token.quantityText) : null
      segments.push({ raw, name: token.name, quantity, sourceLine })
    })
  }
  return segments
}

const normalizeMatchName = (value: unknown) => normalizeAlternativeName(value)
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const exactOfficialName = (variant: MatchableVariant) => normalizeMatchName(variant.variant_name)

const exactFallbackNames = (variant: MatchableVariant) => [
  variant.product_name,
].map(normalizeMatchName).filter(Boolean)

const exactIdentifiers = (variant: MatchableVariant) => [
  variant.product_code,
  variant.manufacturer_sku || '',
].map(normalizeOrderText).filter(Boolean)

const exactAlternativeName = (variant: MatchableVariant) => normalizeMatchName(variant.alternative_name)

const bracketFlavours = (variant: MatchableVariant) =>
  Array.from(variant.variant_name.matchAll(/\[([^\[\]]+)\]/g), match => normalizeMatchName(match[1])).filter(Boolean)

const words = (value: string) => normalizeMatchName(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean)

const GENERIC_ORDER_WORDS = new Set([
  'SERAPOD', 'CELLERA', 'FRUITY', 'CARTRIDGE', 'VAPE', 'FLAVOUR', 'FLAVOR',
  'PC', 'PCS', 'PIECE', 'PIECES', 'UNIT', 'UNITS',
])

const flavourNames = (variant: MatchableVariant) => {
  const extracted = bracketFlavours(variant)
  return extracted.length > 0 ? extracted : [exactOfficialName(variant)]
}

const detectProductLine = (query: string, variants: MatchableVariant[]): string | undefined => {
  const queryWords = new Set(words(query))
  const productLines = Array.from(new Set(variants.map(variant => variant.product_name).filter(Boolean)))
  const matches = productLines.filter(productName => {
    const distinctiveWords = words(productName).filter(word => !GENERIC_ORDER_WORDS.has(word))
    return distinctiveWords.length > 0 && distinctiveWords.every(word => queryWords.has(word))
  })
  return matches.length === 1 ? matches[0] : undefined
}

const extractFlavourQuery = (query: string, productLine?: string) => {
  const productWords = new Set(productLine ? words(productLine) : [])
  return words(query)
    .filter(word => !GENERIC_ORDER_WORDS.has(word) && !productWords.has(word))
    .join(' ')
}

const relevanceScore = (query: string, variant: MatchableVariant) => {
  if (/\bDEVICE\b/i.test(variant.group_name || '')) return 0
  const queryWords = words(query)
  if (queryWords.length === 0) return 0

  return Math.max(...flavourNames(variant).map(flavour => {
    const candidateWords = words(flavour)
    const overlap = queryWords.filter(word => candidateWords.includes(word))
    if (overlap.length === 0) return 0
    const queryCoverage = overlap.length / queryWords.length
    const candidateCoverage = overlap.length / candidateWords.length
    const exactPhraseBonus = normalizeMatchName(flavour).startsWith(`${normalizeMatchName(query)} `) ? 10 : 0
    return (overlap.length * 100) + (queryCoverage * 40) + (candidateCoverage * 30) + exactPhraseBonus
  }))
}

const levenshteinDistance = (left: string, right: string) => {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      )
    }
    previous.splice(0, previous.length, ...current)
  }
  return previous[right.length]
}

const fuzzyScore = (query: string, variant: MatchableVariant) => {
  if (/\bDEVICE\b/i.test(variant.group_name || '')) return 0
  const normalizedQuery = normalizeMatchName(query)
  if (normalizedQuery.length < 4) return 0
  return Math.max(...[...flavourNames(variant), exactAlternativeName(variant)].filter(Boolean).map(name => {
    const distance = levenshteinDistance(normalizedQuery, name)
    const longest = Math.max(normalizedQuery.length, name.length)
    const similarity = longest === 0 ? 0 : 1 - (distance / longest)
    const allowedDistance = Math.max(2, Math.floor(longest * 0.25))
    return distance <= allowedDistance && similarity >= 0.65 ? similarity : 0
  }))
}

export function resolveCatalogMatch(name: string, variants: MatchableVariant[]) {
  const normalizedName = normalizeOrderText(name)
  const identifierMatches = variants.filter(variant => exactIdentifiers(variant).includes(normalizedName))
  if (identifierMatches.length > 0) return { candidates: identifierMatches.slice(0, 8), method: 'code_or_sku' as const, totalMatches: identifierMatches.length }

  const normalizedMatchName = normalizeMatchName(name)
  const productLine = detectProductLine(name, variants)
  const scopedVariants = productLine ? variants.filter(variant => variant.product_name === productLine) : variants
  const flavourQuery = extractFlavourQuery(name, productLine) || normalizedMatchName

  const nameMatches = scopedVariants.filter(variant => exactOfficialName(variant) === normalizedMatchName)
  if (nameMatches.length > 0) return { candidates: nameMatches.slice(0, 8), method: 'exact_name' as const, totalMatches: nameMatches.length }

  const bracketMatches = scopedVariants.filter(variant => bracketFlavours(variant).includes(flavourQuery))
  if (bracketMatches.length > 0) {
    return { candidates: bracketMatches.slice(0, 8), method: 'bracket_flavour' as const, totalMatches: bracketMatches.length }
  }

  const normalizedAlternativeName = flavourQuery
  const alternativeMatches = normalizedAlternativeName
    ? scopedVariants.filter(variant => exactAlternativeName(variant) === normalizedAlternativeName)
    : []
  if (alternativeMatches.length > 0) {
    return { candidates: alternativeMatches.slice(0, 8), method: 'alternative_name' as const, totalMatches: alternativeMatches.length }
  }

  const fallbackNameMatches = scopedVariants.filter(variant => exactFallbackNames(variant).includes(normalizedMatchName))
  if (fallbackNameMatches.length > 0) {
    return { candidates: fallbackNameMatches.slice(0, 8), method: 'exact_name' as const, totalMatches: fallbackNameMatches.length }
  }

  const keywordMatches = scopedVariants
    .map(variant => ({ variant, score: relevanceScore(flavourQuery, variant) }))
    .filter(result => result.score > 0)
    .sort((left, right) => right.score - left.score || left.variant.variant_name.localeCompare(right.variant.variant_name))
  if (keywordMatches.length > 0) {
    return { candidates: keywordMatches.slice(0, 8).map(result => result.variant), method: 'keyword' as const, totalMatches: keywordMatches.length }
  }

  const fuzzyMatches = scopedVariants
    .map(variant => ({ variant, score: fuzzyScore(flavourQuery, variant) }))
    .filter(result => result.score > 0)
    .sort((left, right) => right.score - left.score || left.variant.variant_name.localeCompare(right.variant.variant_name))
  return {
    candidates: fuzzyMatches.slice(0, 8).map(result => result.variant),
    method: fuzzyMatches.length > 0 ? 'fuzzy' as const : undefined,
    totalMatches: fuzzyMatches.length,
  }
}

export function resolvePasteInventoryOutcome(
  quantity: number | null,
  variant?: MatchableVariant,
): PasteInventoryOutcome | undefined {
  if (!variant || quantity === null || quantity <= 0) return undefined
  if (variant.inventory_classification === 'unclassified') return 'inventory_unclassified'
  if (variant.available_qty === undefined) return 'matched'
  if (variant.available_qty <= 0) return 'no_available_stock'
  if (quantity > variant.available_qty) return 'insufficient_stock'
  return 'matched'
}

export function matchPastedOrder(text: string, variants: MatchableVariant[]): PasteMatchResult[] {
  const codeSet = new Set(variants.flatMap(exactIdentifiers))
  const firstLineByName = new Map<string, number>()
  const firstLineByVariant = new Map<string, number>()
  const results: PasteMatchResult[] = []
  let entryNumber = 0

  text.split(/\r?\n/).forEach((physicalLine, index) => {
    if (!physicalLine.trim()) return

    for (const segment of parsePhysicalLine(physicalLine, index + 1, codeSet)) {
      entryNumber += 1
      const line = entryNumber
      const name = segment.name.trim() || segment.raw.trim()
      const normalizedName = normalizeOrderText(name)
      const quantity = segment.quantity
      const resolved = resolveCatalogMatch(name, variants)
      const candidates = resolved.candidates
      const confidentMethod = resolved.method === 'code_or_sku'
        || resolved.method === 'exact_name'
        || resolved.method === 'bracket_flavour'
        || resolved.method === 'alternative_name'
      const autoSelectable = confidentMethod
        && candidates.length === 1
        && (resolved.totalMatches ?? candidates.length) === 1
      const exactVariantId = autoSelectable ? candidates[0].id : undefined
      const duplicateOfLine = firstLineByName.get(normalizedName)
        ?? (exactVariantId ? firstLineByVariant.get(exactVariantId) : undefined)

      let status: PasteMatchStatus
      if (quantity === null || quantity <= 0) status = 'invalid_quantity'
      else if (duplicateOfLine !== undefined) status = 'duplicate'
      else if (resolved.method === 'alternative_name' && autoSelectable) status = 'alternative_match'
      else if (autoSelectable) status = 'matched'
      else if (candidates.length > 1 || (resolved.totalMatches || 0) > 1) status = 'ambiguous'
      else if (candidates.length === 1) status = 'suggestion'
      else status = 'not_found'

      if (quantity !== null && quantity > 0 && duplicateOfLine === undefined) {
        firstLineByName.set(normalizedName, line)
        if (exactVariantId) firstLineByVariant.set(exactVariantId, line)
      }

      results.push({
        line,
        sourceLine: segment.sourceLine,
        raw: segment.raw,
        name,
        normalizedName,
        quantity,
        status,
        candidates,
        selectedVariantId: (status === 'matched' || status === 'alternative_match' || status === 'duplicate') && exactVariantId ? exactVariantId : undefined,
        duplicateOfLine,
        matchMethod: resolved.method,
        inventoryOutcome: duplicateOfLine === undefined
          ? resolvePasteInventoryOutcome(quantity, exactVariantId ? candidates[0] : undefined)
          : undefined,
      })
    }
  })

  return results
}
