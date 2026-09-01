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

export type PasteMatchStatus =
  | 'matched'
  | 'alternative_match'
  | 'smart_match'
  | 'suggestion'
  | 'ambiguous'
  | 'not_found'
  | 'invalid_quantity'
  /** Product identified but pasted line has no quantity (e.g. "Orange-"). */
  | 'missing_quantity'
  | 'duplicate'
  /** Standalone HERO / ZERO (etc.) section title — not an order line. */
  | 'section_header'
  /** HERO/ZERO appeared with a quantity — ambiguous intent; needs human review. */
  | 'requires_review'

export type PasteMatchMethod = 'code_or_sku' | 'exact_name' | 'bracket_flavour' | 'alternative_name' | 'keyword' | 'fuzzy'

export type PasteInventoryOutcome = 'matched' | 'inventory_unclassified' | 'no_available_stock' | 'insufficient_stock'

/** Canonical Master Data product families used as paste section scopes. */
export const SECTION_PRODUCT_LINES = {
  hero: 'Cellera Hero',
  zero: 'Cellera Zero',
} as const

export type SectionProductLine =
  | typeof SECTION_PRODUCT_LINES.hero
  | typeof SECTION_PRODUCT_LINES.zero

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
  /**
   * When status is section_header: the product family this header activates.
   * When status is a product line under an active header: the section still in force
   * (for audit / Serapp conversation trail).
   */
  sectionProductLine?: SectionProductLine
}

export const normalizeOrderText = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleUpperCase()

/** Distributor notes in parentheses, e.g. "Vanilla Potato (Cultured Milk)" → "Vanilla Potato". */
export const stripParentheticalQualifiers = (value: string): string =>
  value.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()

const trailingWhatsAppMarkers = /(\d)\s*(?:(?:✅|❌|✔\uFE0F?|✖\uFE0F?|☑\uFE0F?)\s*)+$/u

export const stripTrailingWhatsAppMarkers = (value: string) => value.replace(trailingWhatsAppMarkers, '$1').trimEnd()

/** Leading list markers distributors paste from notes, WhatsApp, or sample templates. */
const LIST_MARKER_CHARS = /^[\s*•·‣◦▪▫\u2022\u2023\u25E6\u25AA\u2219\u2043\-–—]+/u
const NUMBERED_LIST_PREFIX = /^\s*\d+[.)]\s+/u

export const stripListMarkers = (value: string): string => {
  let line = value
  let prev = ''
  while (line !== prev) {
    prev = line
    line = line.replace(LIST_MARKER_CHARS, '')
    line = line.replace(NUMBERED_LIST_PREFIX, '')
  }
  return line
}

/** Drop trailing separators distributors leave when qty is missing (e.g. "Orange-"). */
export const cleanPasteSegmentName = (value: string): string =>
  value.replace(/[-–—:=]+\s*$/u, '').trim()

const INVALID_QTY_TAIL = /\s[-–—:=]+\s*(zero|none|nil|n\/a|na)\s*$/i

/** Detect lines like "MANGO - zero" where qty text is present but not numeric. */
export const splitInvalidQuantityTail = (value: string): { name: string; invalidQuantity: boolean } => {
  if (!INVALID_QTY_TAIL.test(value)) return { name: value, invalidQuantity: false }
  return { name: value.replace(INVALID_QTY_TAIL, '').trim(), invalidQuantity: true }
}

/** Distributor template rows (not products): "Available line up:", "per box", etc. */
const PASTE_TEMPLATE_HEADER = /^(?:available\s+line\s*up|line\s*up|per\s+(?:box|case|carton|ctn|pcs?)|price\s*list|product\s*list|flavour\s*list|flavor\s*list)\s*:?\s*$/i

/** Distributor paste noise: totals, brand headers, company title rows — not products. */
export const shouldSkipPastePhysicalLine = (line: string): boolean => {
  const trimmed = stripListMarkers(line).trim()
  if (!trimmed) return true
  if (/^total\s*[=:]/i.test(trimmed)) return true
  if (/^serapod\s*$/i.test(trimmed)) return true
  const withoutTrailingColon = trimmed.replace(/:\s*$/, '')
  if (PASTE_TEMPLATE_HEADER.test(withoutTrailingColon)) return true
  const normalizedHeader = normalizeOrderText(withoutTrailingColon)
  if (PASTE_TITLE_ROW.test(normalizedHeader)) return true
  if (SECTION_HEADER_ALIASES.has(normalizedHeader)) return false
  if (!/\d/.test(trimmed) && !/[-–—:=\t]/.test(trimmed)) {
    const headerCandidate = trimmed.replace(/^\(([^)]+)\)$/, '$1').trim()
    const normalized = normalizeOrderText(headerCandidate)
    if (SECTION_HEADER_ALIASES.has(normalized)) return false
    // e.g. "nfy Tech" — title row, not a product line.
    if (/[a-z]/.test(trimmed)) return true
  }
  return false
}

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
const QTY_UNITS_REGEX = String.raw`(?:PCS?|PIECES?|UNITS?|CASES?|BOX(?:ES)?|CTN|CARTONS?|KOTAK)`

const tokenizeChunk = (chunk: string, codeSet: Set<string>): OrderToken[] => {
  const tokens: OrderToken[] = []
  const entry = new RegExp(String.raw`\s*(.+?)\s*(?:[-:=]+\s*|\t+\s*|\s+)(\d+)(?:\s*${QTY_UNITS_REGEX})?(?=\s|$)`, 'iy')
  const trailingQuantity = new RegExp(String.raw`^\s*(?:[-:=]+\s*)?(\d+)(?:\s*${QTY_UNITS_REGEX})?(?=\s|$)`, 'i')
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
  const line = stripListMarkers(original)
  const work = normalizeDashes(line)
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
      const raw = line.slice(originalStart, originalEnd).trim()
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
  'PC', 'PCS', 'PIECE', 'PIECES', 'UNIT', 'UNITS', 'CASE', 'CASES', 'BOX', 'BOXES', 'CTN', 'CARTON', 'CARTONS', 'KOTAK',
  'AVAILABLE', 'AVAIL', 'STOCK', 'STOK',
])

/**
 * Exact normalized titles that act as section headers (no quantity).
 * Intentionally narrow so flavour lines like "SERAPOD HERO MANGO 4 PCS"
 * remain product entries, not headers.
 */
const SECTION_HEADER_ALIASES = new Map<string, SectionProductLine>([
  ['HERO', SECTION_PRODUCT_LINES.hero],
  ['ZERO', SECTION_PRODUCT_LINES.zero],
  ['CELLERA HERO', SECTION_PRODUCT_LINES.hero],
  ['CELLERA ZERO', SECTION_PRODUCT_LINES.zero],
  ['SERAPOD HERO', SECTION_PRODUCT_LINES.hero],
  ['SERAPOD ZERO', SECTION_PRODUCT_LINES.zero],
  ['SERAPOD CELLERA HERO', SECTION_PRODUCT_LINES.hero],
  ['SERAPOD CELLERA ZERO', SECTION_PRODUCT_LINES.zero],
  ['CELLERA CARTRIDGE', SECTION_PRODUCT_LINES.hero],
  ['CELLERA HERO CARTRIDGE', SECTION_PRODUCT_LINES.hero],
  ['FRUITY CELLERA CARTRIDGE', SECTION_PRODUCT_LINES.hero],
  ['ZERO CARTRIDGE', SECTION_PRODUCT_LINES.zero],
  ['CELLERA ZERO CARTRIDGE', SECTION_PRODUCT_LINES.zero],
])

/** Category / title rows distributors paste — never product lines. */
const PASTE_TITLE_ROW = /^(?:ORDER\s+[\d/.\-]+|SERAPOD\s+S\s+LINE(?:\s+V?\d+)?)\s*$/i

export type SectionHeaderKind = 'section_header' | 'requires_review'

export interface SectionHeaderResolution {
  kind: SectionHeaderKind
  productLine: SectionProductLine
}

/**
 * Detect HERO / ZERO family section headers.
 * - No quantity → section_header (scopes following lines).
 * - With quantity → requires_review (do not auto-ignore; user may mean a product).
 */
export function resolveSectionHeader(
  name: string,
  quantity: number | null,
): SectionHeaderResolution | null {
  const unwrapped = stripListMarkers(name).trim().replace(/^\(([^)]+)\)$/, '$1').trim()
  const normalized = normalizeOrderText(unwrapped)
  const productLine = SECTION_HEADER_ALIASES.get(normalized)
  if (!productLine) return null

  if (quantity !== null && quantity > 0) {
    return { kind: 'requires_review', productLine }
  }

  return { kind: 'section_header', productLine }
}

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

const compactMatchName = (value: string) => normalizeMatchName(value).replace(/\s+/g, '')

const flavourWordBag = (flavour: string) => words(flavour)
  .filter(word => !GENERIC_ORDER_WORDS.has(word))
  .sort()
  .join(' ')

const queryWordBag = (query: string, productLine?: string) => {
  const baseQuery = stripParentheticalQualifiers(query)
  const flavourQuery = extractFlavourQuery(baseQuery, productLine) || normalizeMatchName(baseQuery)
  return words(flavourQuery)
    .filter(word => !GENERIC_ORDER_WORDS.has(word))
    .sort()
    .join(' ')
}

/** All catalog flavour words appear in the pasted query (after stripping parenthetical notes). */
const fullContainmentScore = (
  query: string,
  variant: MatchableVariant,
  productLine?: string,
): number => {
  const baseQuery = stripParentheticalQualifiers(query)
  const queryWordSet = new Set(
    words(extractFlavourQuery(baseQuery, productLine) || normalizeMatchName(baseQuery))
      .filter(word => !GENERIC_ORDER_WORDS.has(word)),
  )
  if (queryWordSet.size === 0) return 0

  return Math.max(...flavourNames(variant).map((flavour) => {
    const flavourWordList = words(flavour).filter(word => !GENERIC_ORDER_WORDS.has(word))
    if (flavourWordList.length === 0) return 0
    const fullyContained = flavourWordList.every(word => queryWordSet.has(word))
    return fullyContained ? flavourWordList.length : 0
  }))
}

/** When several keyword hits exist, auto-select the one whose full flavour is in the paste. */
const pickUniqueFullContainmentWinner = (
  candidates: MatchableVariant[],
  query: string,
  productLine?: string,
): MatchableVariant | undefined => {
  const scored = candidates
    .map(variant => ({ variant, score: fullContainmentScore(query, variant, productLine) }))
    .filter(entry => entry.score > 0)
  if (scored.length === 0) return undefined

  const maxScore = Math.max(...scored.map(entry => entry.score))
  const winners = scored.filter(entry => entry.score === maxScore)
  return winners.length === 1 ? winners[0].variant : undefined
}

/**
 * True when the pasted flavour words exactly match a catalog flavour (any order).
 * Used for Peach Mango ↔ Mango Peach, exact Strawberry Vanilla, etc.
 */
const isExactFlavourWordBagMatch = (
  query: string,
  variant: MatchableVariant,
  productLine?: string,
): boolean => {
  const bag = queryWordBag(query, productLine)
  if (!bag) return false
  return flavourNames(variant).some(flavour => flavourWordBag(flavour) === bag)
}

const wordsMatchRegardlessOfOrder = isExactFlavourWordBagMatch

const matchesAlternativeCompact = (query: string, variant: MatchableVariant, productLine?: string): boolean => {
  const queryCompact = compactMatchName(extractFlavourQuery(query, productLine) || query)
  const alt = exactAlternativeName(variant)
  if (!queryCompact || queryCompact.length < 4 || !alt) return false
  return alt.replace(/\s+/g, '') === queryCompact
}

const isStrongFuzzySingleMatch = (query: string, variant: MatchableVariant, productLine?: string): boolean => {
  const flavourQuery = extractFlavourQuery(query, productLine) || normalizeMatchName(query)
  return fuzzyScore(flavourQuery, variant) >= 0.82
}

const isStrongSingleCandidateMatch = (
  query: string,
  variant: MatchableVariant,
  method?: PasteMatchMethod,
  productLine?: string,
): boolean => {
  if (isExactFlavourWordBagMatch(query, variant, productLine)) return true
  if (matchesAlternativeCompact(query, variant, productLine)) return true
  if ((method === 'fuzzy' || method === 'keyword') && isStrongFuzzySingleMatch(query, variant, productLine)) return true
  return false
}

/** One catalog hit and the pasted flavour words match exactly — safe to auto-select. */
const isObviousSingleCatalogMatch = (
  query: string,
  candidates: MatchableVariant[],
  totalMatches: number,
  productLine?: string,
): MatchableVariant | undefined => {
  if (candidates.length !== 1 || totalMatches !== 1 || !candidates[0]) return undefined
  return isExactFlavourWordBagMatch(query, candidates[0], productLine) ? candidates[0] : undefined
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

export function resolveCatalogMatch(
  name: string,
  variants: MatchableVariant[],
  /**
   * When set (active paste section), matching is restricted to that Master Data
   * product family until another section header appears.
   */
  forcedProductLine?: SectionProductLine,
) {
  const pool = forcedProductLine
    ? variants.filter(variant => variant.product_name === forcedProductLine)
    : variants

  const normalizedName = normalizeOrderText(name)
  const identifierMatches = pool.filter(variant => exactIdentifiers(variant).includes(normalizedName))
  if (identifierMatches.length > 0) return { candidates: identifierMatches.slice(0, 8), method: 'code_or_sku' as const, totalMatches: identifierMatches.length }

  const matchingName = stripParentheticalQualifiers(name)
  const normalizedMatchName = normalizeMatchName(matchingName)
  // Under an active section, do not re-detect a different product line from the
  // flavour text — the section header already owns the scope.
  const productLine = forcedProductLine || detectProductLine(matchingName, pool)
  const scopedVariants = productLine ? pool.filter(variant => variant.product_name === productLine) : pool
  const flavourQuery = extractFlavourQuery(matchingName, productLine) || normalizedMatchName

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

  const compactQuery = compactMatchName(flavourQuery)
  const compactAlternativeMatches = compactQuery
    ? scopedVariants.filter((variant) => {
        const alt = exactAlternativeName(variant)
        return Boolean(alt) && alt.replace(/\s+/g, '') === compactQuery
      })
    : []
  if (compactAlternativeMatches.length > 0) {
    return {
      candidates: compactAlternativeMatches.slice(0, 8),
      method: 'alternative_name' as const,
      totalMatches: compactAlternativeMatches.length,
    }
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
  /** Active section scope; null means use the existing global matching rules. */
  let activeSection: SectionProductLine | null = null

  text.split(/\r?\n/).forEach((physicalLine, index) => {
    if (shouldSkipPastePhysicalLine(physicalLine)) return

    for (const segment of parsePhysicalLine(physicalLine, index + 1, codeSet)) {
      entryNumber += 1
      const line = entryNumber
      let name = cleanPasteSegmentName(segment.name.trim() || segment.raw.trim())
      const invalidQuantityTail = splitInvalidQuantityTail(name)
      name = invalidQuantityTail.name
      const normalizedName = normalizeOrderText(name)
      const quantity = segment.quantity

      const section = resolveSectionHeader(name, quantity)
      if (section?.kind === 'section_header') {
        activeSection = section.productLine
        results.push({
          line,
          sourceLine: segment.sourceLine,
          raw: segment.raw,
          name,
          normalizedName,
          quantity: null,
          status: 'section_header',
          candidates: [],
          sectionProductLine: section.productLine,
        })
        continue
      }

      if (section?.kind === 'requires_review') {
        // Do not change activeSection — a quantified HERO/ZERO is not a header.
        results.push({
          line,
          sourceLine: segment.sourceLine,
          raw: segment.raw,
          name,
          normalizedName,
          quantity,
          status: 'requires_review',
          candidates: [],
          sectionProductLine: section.productLine,
        })
        continue
      }

      let resolved = resolveCatalogMatch(
        name,
        variants,
        activeSection || undefined,
      )
      // Section scope (ZERO CARTRIDGE / HERO) may not list every flavour — fall back globally.
      if (
        activeSection
        && resolved.candidates.length === 0
        && (resolved.totalMatches ?? 0) === 0
      ) {
        resolved = resolveCatalogMatch(name, variants, undefined)
      }
      const candidates = resolved.candidates
      const confidentMethod = resolved.method === 'code_or_sku'
        || resolved.method === 'exact_name'
        || resolved.method === 'bracket_flavour'
        || resolved.method === 'alternative_name'
      const singleCandidate = candidates.length === 1 && (resolved.totalMatches ?? candidates.length) === 1
      const scopedProductLine = activeSection || undefined
      const wordBagWinners = candidates.filter((candidate) =>
        isExactFlavourWordBagMatch(name, candidate, scopedProductLine),
      )
      const hasWordBagWinner = wordBagWinners.length === 1
      const fuzzyWinners = candidates.filter((candidate) =>
        isStrongFuzzySingleMatch(name, candidate, scopedProductLine),
      )
      const hasFuzzyWinner = fuzzyWinners.length === 1
      const fullContainmentWinner = pickUniqueFullContainmentWinner(candidates, name, scopedProductLine)
      const obviousSingleMatch = isObviousSingleCatalogMatch(
        name,
        candidates,
        resolved.totalMatches ?? candidates.length,
        scopedProductLine,
      )
      const strongSingleMatch = Boolean(
        singleCandidate
        && candidates[0]
        && isStrongSingleCandidateMatch(name, candidates[0], resolved.method, scopedProductLine),
      )
      const autoSelectCandidate = hasWordBagWinner
        ? wordBagWinners[0]
        : fullContainmentWinner
          ?? (hasFuzzyWinner
            ? fuzzyWinners[0]
            : obviousSingleMatch
              ?? ((confidentMethod && singleCandidate) || strongSingleMatch
                ? candidates[0]
                : undefined))
      const autoSelectable = Boolean(autoSelectCandidate)
      const exactVariantId = autoSelectCandidate?.id
      // Duplicate keys are section-aware so the same flavour can appear once under
      // HERO and once under ZERO without being treated as a paste duplicate.
      const sectionKey = activeSection || 'global'
      const nameDuplicateKey = `${sectionKey}::${normalizedName}`
      const variantDuplicateKey = exactVariantId ? `${sectionKey}::${exactVariantId}` : undefined
      const duplicateOfLine = firstLineByName.get(nameDuplicateKey)
        ?? (variantDuplicateKey ? firstLineByVariant.get(variantDuplicateKey) : undefined)

      let status: PasteMatchStatus
      if (invalidQuantityTail.invalidQuantity || (quantity !== null && quantity <= 0)) status = 'invalid_quantity'
      else if (quantity === null) {
        if (autoSelectable) status = 'missing_quantity'
        else if (candidates.length > 1 || (resolved.totalMatches || 0) > 1) status = 'ambiguous'
        else if (candidates.length === 1) status = 'missing_quantity'
        else status = 'not_found'
      } else if (duplicateOfLine !== undefined) status = 'duplicate'
      else if (resolved.method === 'alternative_name' && autoSelectable) status = 'alternative_match'
      else if (autoSelectable) status = 'matched'
      else if (candidates.length > 1 || (resolved.totalMatches || 0) > 1) status = 'ambiguous'
      else if (candidates.length === 1) status = 'suggestion'
      else status = 'not_found'

      if (quantity !== null && quantity > 0 && duplicateOfLine === undefined) {
        firstLineByName.set(nameDuplicateKey, line)
        if (variantDuplicateKey) firstLineByVariant.set(variantDuplicateKey, line)
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
        selectedVariantId: (
          status === 'matched'
          || status === 'alternative_match'
          || status === 'duplicate'
          || status === 'missing_quantity'
        ) && exactVariantId ? exactVariantId : undefined,
        duplicateOfLine,
        matchMethod: resolved.method,
        inventoryOutcome: duplicateOfLine === undefined
          ? resolvePasteInventoryOutcome(
            quantity,
            exactVariantId ? candidates.find((candidate) => candidate.id === exactVariantId) : undefined,
          )
          : undefined,
        sectionProductLine: activeSection || undefined,
      })
    }
  })

  return results
}
