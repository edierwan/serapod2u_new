/**
 * Organization Terms & Conditions live in the existing `organizations.settings`
 * JSONB blob, alongside the other organization metadata already kept there
 * (branding, journey_builder_activation, require_payment_proof). No dedicated
 * column is needed.
 *
 * The value is stored exactly as the user typed it - newlines, blank lines and
 * indentation included - and is only ever trimmed to decide whether there is
 * anything worth rendering. Callers must render it with a whitespace-preserving
 * style; never reformat the string itself.
 */

const TERMS_SETTINGS_KEY = 'terms_conditions'

function readSettings(org: unknown): Record<string, unknown> {
  const settings = (org as { settings?: unknown } | null | undefined)?.settings

  if (typeof settings === 'string') {
    try {
      const parsed = JSON.parse(settings)
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }

  return settings && typeof settings === 'object' ? (settings as Record<string, unknown>) : {}
}

/** The raw stored value, unmodified. Empty string when nothing is stored. */
export function getOrganizationTerms(org: unknown): string {
  const value = readSettings(org)[TERMS_SETTINGS_KEY]
  return typeof value === 'string' ? value : ''
}

/** True only when the stored terms contain something other than whitespace. */
export function hasOrganizationTerms(org: unknown): boolean {
  return getOrganizationTerms(org).trim().length > 0
}

/**
 * The value to render on a document: the untouched stored string when it has
 * meaningful content, otherwise an empty string so the section can be skipped.
 */
export function resolveOrganizationTerms(org: unknown): string {
  const terms = getOrganizationTerms(org)
  return terms.trim() ? terms : ''
}

export { TERMS_SETTINGS_KEY }

/**
 * Lay the stored terms out for a fixed-width renderer (the PDF documents).
 *
 * Blank lines survive as empty entries and every line keeps its own leading
 * indentation - including the wrapped continuations of a long line, so an
 * indented or numbered clause stays visually aligned instead of snapping back
 * to the margin on its second line.
 *
 * `wrap` receives the line with its indent already removed, plus that indent,
 * and returns the text broken to the available width. Injecting it keeps this
 * function pure and testable without a jsPDF document.
 */
export function wrapTermsLines(
  terms: string,
  wrap: (text: string, indent: string) => string[],
): string[] {
  if (!terms) return []

  const lines: string[] = []

  for (const raw of terms.replace(/\r\n?/g, '\n').split('\n')) {
    if (!raw.trim()) {
      lines.push('')
      continue
    }

    const indent = /^[ \t]*/.exec(raw)?.[0] ?? ''
    const body = raw.slice(indent.length)
    const wrapped = wrap(body, indent)

    if (wrapped.length === 0) {
      lines.push(indent + body)
      continue
    }

    for (const piece of wrapped) lines.push(indent + piece)
  }

  return lines
}
