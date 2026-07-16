export interface MatchableVariant {
  id: string
  variant_name: string
  product_name: string
  product_code: string
  manufacturer_sku?: string | null
}

export type PasteMatchStatus = 'matched' | 'smart_match' | 'suggestion' | 'ambiguous' | 'not_found' | 'invalid_quantity' | 'duplicate'

export type PasteMatchMethod = 'code_or_sku' | 'exact_name' | 'keyword' | 'fuzzy'

export interface PasteMatchResult {
  line: number
  raw: string
  name: string
  normalizedName: string
  quantity: number | null
  status: PasteMatchStatus
  candidates: MatchableVariant[]
  selectedVariantId?: string
  duplicateOfLine?: number
  matchMethod?: PasteMatchMethod
}

export const normalizeOrderText = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleUpperCase()

const trailingWhatsAppMarkers = /(\d)\s*(?:(?:✅|❌|✔\uFE0F?|✖\uFE0F?|☑\uFE0F?)\s*)+$/u

export const stripTrailingWhatsAppMarkers = (value: string) => value.replace(trailingWhatsAppMarkers, '$1').trimEnd()

const splitOrderLine = (raw: string) => {
  const line = stripTrailingWhatsAppMarkers(raw).trim()
  if (!line) return null

  // Prefer explicit separators. Multiple spaces are accepted as a separator only
  // when the final token is a quantity, so flavour names can still contain spaces.
  const match = line.match(/^(.*?)\s*(?:[-–—:]|\t|\s{2,})\s*([^\s]+)\s*$/)
    // WhatsApp lists commonly omit punctuation and use a single space before the
    // final quantity (for example, "TEH TARIK 500❌"). Only a numeric final token
    // is accepted so meaningful Product Code/SKU characters remain untouched.
    || line.match(/^(.*?)\s+(\d+)\s*$/)
  return match ? { name: match[1], quantityText: match[2] } : null
}

const exactNames = (variant: MatchableVariant) => [
  variant.variant_name,
  variant.product_name,
].map(normalizeOrderText).filter(Boolean)

const exactIdentifiers = (variant: MatchableVariant) => [
  variant.product_code,
  variant.manufacturer_sku || '',
].map(normalizeOrderText).filter(Boolean)

const words = (value: string) => normalizeOrderText(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean)

const keywordScore = (query: string, variant: MatchableVariant) => {
  const queryWords = words(query)
  if (queryWords.length === 0) return 0
  const fields = [variant.variant_name, variant.product_name].map(normalizeOrderText)
  const candidateWords = fields.flatMap(words)
  const allWordsMatch = queryWords.every(queryWord => candidateWords.some(candidateWord =>
    candidateWord === queryWord
    || (queryWord.length >= 3 && candidateWord.includes(queryWord))
  ))
  if (!allWordsMatch) return 0

  const normalizedQuery = normalizeOrderText(query)
  if (fields.some(field => field.startsWith(`${normalizedQuery} `))) return 4
  if (candidateWords.includes(normalizedQuery)) return 3
  if (fields.some(field => field.includes(normalizedQuery))) return 2
  return 1
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
  const normalizedQuery = normalizeOrderText(query)
  if (normalizedQuery.length < 4) return 0
  return Math.max(...exactNames(variant).map(name => {
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
  if (identifierMatches.length > 0) return { candidates: identifierMatches.slice(0, 3), method: 'code_or_sku' as const }

  const nameMatches = variants.filter(variant => exactNames(variant).includes(normalizedName))
  if (nameMatches.length > 0) return { candidates: nameMatches.slice(0, 3), method: 'exact_name' as const }

  const keywordMatches = variants
    .map(variant => ({ variant, score: keywordScore(normalizedName, variant) }))
    .filter(result => result.score > 0)
    .sort((left, right) => right.score - left.score || left.variant.variant_name.localeCompare(right.variant.variant_name))
    .map(result => result.variant)
  if (keywordMatches.length > 0) return { candidates: keywordMatches.slice(0, 3), method: 'keyword' as const, totalMatches: keywordMatches.length }

  const fuzzyMatches = variants
    .map(variant => ({ variant, score: fuzzyScore(normalizedName, variant) }))
    .filter(result => result.score > 0)
    .sort((left, right) => right.score - left.score || left.variant.variant_name.localeCompare(right.variant.variant_name))
    .slice(0, 3)
    .map(result => result.variant)
  return { candidates: fuzzyMatches, method: fuzzyMatches.length > 0 ? 'fuzzy' as const : undefined }
}

export function matchPastedOrder(text: string, variants: MatchableVariant[]): PasteMatchResult[] {
  const firstLineByName = new Map<string, number>()
  const firstLineByVariant = new Map<string, number>()

  return text.split(/\r?\n/).flatMap((raw, index) => {
    if (!raw.trim()) return []
    const parsed = splitOrderLine(raw)
    const name = parsed?.name.trim() || raw.trim()
    const normalizedName = normalizeOrderText(name)
    const quantity = parsed && /^\d+$/.test(parsed.quantityText)
      ? Number(parsed.quantityText)
      : null
    const resolved = resolveCatalogMatch(name, variants)
    const candidates = resolved.candidates
    const autoSelectable = resolved.method !== 'fuzzy'
      && candidates.length === 1
      && (resolved.totalMatches ?? candidates.length) === 1
    const exactVariantId = autoSelectable ? candidates[0].id : undefined
    const duplicateOfLine = firstLineByName.get(normalizedName)
      ?? (exactVariantId ? firstLineByVariant.get(exactVariantId) : undefined)

    let status: PasteMatchStatus
    if (!parsed || quantity === null || quantity <= 0) status = 'invalid_quantity'
    else if (duplicateOfLine !== undefined) status = 'duplicate'
    else if (resolved.method === 'fuzzy' && candidates.length > 0) status = 'suggestion'
    else if (resolved.method === 'keyword' && autoSelectable) status = 'smart_match'
    else if (autoSelectable) status = 'matched'
    else if (candidates.length > 1 || (resolved.totalMatches || 0) > 1) status = 'ambiguous'
    else status = 'not_found'

    if (quantity !== null && quantity > 0 && duplicateOfLine === undefined) {
      firstLineByName.set(normalizedName, index + 1)
      if (exactVariantId) firstLineByVariant.set(exactVariantId, index + 1)
    }

    return [{
      line: index + 1,
      raw,
      name,
      normalizedName,
      quantity,
      status,
      candidates,
      selectedVariantId: (status === 'matched' || status === 'smart_match' || status === 'duplicate') && exactVariantId ? exactVariantId : undefined,
      duplicateOfLine,
      matchMethod: resolved.method,
    }]
  })
}
