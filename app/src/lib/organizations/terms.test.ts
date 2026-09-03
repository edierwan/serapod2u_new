import { describe, expect, it } from 'vitest'
import {
  TERMS_SETTINGS_KEY,
  getOrganizationTerms,
  hasOrganizationTerms,
  resolveOrganizationTerms,
  wrapTermsLines,
} from './terms'

const TERMS = 'Payment to be made to:\n(Maybank)\nGETOUCH SDN BHD\n5123 4567 8901'

describe('organization Terms & Conditions storage', () => {
  it('reads the value out of the organizations.settings blob', () => {
    expect(getOrganizationTerms({ settings: { [TERMS_SETTINGS_KEY]: TERMS } })).toBe(TERMS)
  })

  it('reads it just the same when PostgREST hands settings back as a JSON string', () => {
    const org = { settings: JSON.stringify({ [TERMS_SETTINGS_KEY]: TERMS }) }
    expect(getOrganizationTerms(org)).toBe(TERMS)
  })

  it('returns an empty string rather than throwing on absent or malformed settings', () => {
    expect(getOrganizationTerms(null)).toBe('')
    expect(getOrganizationTerms({})).toBe('')
    expect(getOrganizationTerms({ settings: null })).toBe('')
    expect(getOrganizationTerms({ settings: 'not json' })).toBe('')
    expect(getOrganizationTerms({ settings: { [TERMS_SETTINGS_KEY]: 42 } })).toBe('')
  })

  it('never confuses the organization terms with the order payment_terms', () => {
    const org = {
      settings: {
        [TERMS_SETTINGS_KEY]: TERMS,
        payment_terms: { deposit_pct: 50, balance_pct: 50 },
      },
    }
    expect(getOrganizationTerms(org)).toBe(TERMS)
    expect(getOrganizationTerms(org)).not.toContain('50')
    // A payment schedule alone is not organization terms.
    expect(getOrganizationTerms({ settings: { payment_terms: { deposit_pct: 50 } } })).toBe('')
  })

  it('preserves the stored text byte for byte, including trailing spaces', () => {
    const messy = '  Indented clause\n\n\tTabbed clause   \n'
    expect(getOrganizationTerms({ settings: { [TERMS_SETTINGS_KEY]: messy } })).toBe(messy)
  })

  it('treats whitespace-only terms as nothing to render', () => {
    expect(hasOrganizationTerms({ settings: { [TERMS_SETTINGS_KEY]: '   \n\n  ' } })).toBe(false)
    expect(resolveOrganizationTerms({ settings: { [TERMS_SETTINGS_KEY]: '   \n\n  ' } })).toBe('')
    expect(hasOrganizationTerms({ settings: { [TERMS_SETTINGS_KEY]: TERMS } })).toBe(true)
    expect(resolveOrganizationTerms({ settings: { [TERMS_SETTINGS_KEY]: TERMS } })).toBe(TERMS)
  })
})

describe('laying the terms out for a PDF', () => {
  // Stand-in for jsPDF: breaks on a fixed character budget.
  const wrapAt = (width: number) => (text: string, indent: string) => {
    const budget = Math.max(width - indent.length, 1)
    const out: string[] = []
    let rest = text
    while (rest.length > budget) {
      out.push(rest.slice(0, budget))
      rest = rest.slice(budget)
    }
    out.push(rest)
    return out
  }

  it('renders nothing for empty terms', () => {
    expect(wrapTermsLines('', wrapAt(40))).toEqual([])
  })

  it('keeps every line of a multiline value in order', () => {
    expect(wrapTermsLines(TERMS, wrapAt(80))).toEqual([
      'Payment to be made to:',
      '(Maybank)',
      'GETOUCH SDN BHD',
      '5123 4567 8901',
    ])
  })

  it('preserves blank lines as blank lines', () => {
    expect(wrapTermsLines('One\n\n\nTwo', wrapAt(80))).toEqual(['One', '', '', 'Two'])
  })

  it('preserves leading indentation on the line and on its wrapped continuations', () => {
    const lines = wrapTermsLines('    abcdefghij', wrapAt(9))
    expect(lines).toEqual(['    abcde', '    fghij'])
  })

  it('keeps tab indentation', () => {
    expect(wrapTermsLines('\tTabbed', wrapAt(80))).toEqual(['\tTabbed'])
  })

  it('normalizes CRLF without losing a line', () => {
    expect(wrapTermsLines('One\r\nTwo\rThree', wrapAt(80))).toEqual(['One', 'Two', 'Three'])
  })

  it('treats a whitespace-only line as blank rather than indenting nothing', () => {
    expect(wrapTermsLines('One\n   \nTwo', wrapAt(80))).toEqual(['One', '', 'Two'])
  })

  it('falls back to the raw line when the wrapper returns nothing', () => {
    expect(wrapTermsLines('  Clause', () => [])).toEqual(['  Clause'])
  })
})
