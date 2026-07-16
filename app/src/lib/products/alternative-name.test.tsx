import { describe, expect, it } from 'vitest'
import {
  ALTERNATIVE_NAME_DUPLICATE_MESSAGE,
  cleanAlternativeName,
  isAlternativeNameDuplicateError,
  normalizeAlternativeName,
} from './alternative-name'

describe('product variant Alternative Name', () => {
  it('normalizes case, whitespace, and common separator differences', () => {
    expect(normalizeAlternativeName('  Banana   Vanilla ')).toBe('BANANA VANILLA')
    expect(normalizeAlternativeName('banana-vanilla')).toBe('BANANA VANILLA')
    expect(normalizeAlternativeName('BANANA/VANILLA')).toBe('BANANA VANILLA')
  })

  it('cleans saved values and permits blank input', () => {
    expect(cleanAlternativeName(' Banana   Vanilla ')).toBe('Banana Vanilla')
    expect(cleanAlternativeName('   ')).toBeNull()
  })

  it('recognizes the database uniqueness constraint', () => {
    expect(isAlternativeNameDuplicateError({
      code: '23505',
      details: 'Key violates product_variants_product_alternative_name_active_key',
    })).toBe(true)
    expect(ALTERNATIVE_NAME_DUPLICATE_MESSAGE).toBe('This alternative name is already used by another variant.')
  })
})
