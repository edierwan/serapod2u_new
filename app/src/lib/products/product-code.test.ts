import { describe, expect, it } from 'vitest'
import {
  PRODUCT_CODE_DUPLICATE_MESSAGE,
  isProductCodeDuplicateError,
  normalizeProductCode,
  validateProductCode,
} from './product-code'

describe('Product Code rules', () => {
  it('trims and normalizes values to uppercase', () => {
    expect(normalizeProductCode('  a001 ')).toBe('A001')
  })

  it('converts blank and non-string values to null', () => {
    expect(normalizeProductCode('   ')).toBeNull()
    expect(normalizeProductCode(null)).toBeNull()
  })

  it('allows up to five characters and rejects longer values', () => {
    expect(validateProductCode('A0001')).toBeNull()
    expect(validateProductCode('A00001')).toBe('Product Code must be 5 characters or fewer.')
  })

  it('recognizes the database duplicate error without masking other unique errors', () => {
    expect(isProductCodeDuplicateError({ message: PRODUCT_CODE_DUPLICATE_MESSAGE })).toBe(true)
    expect(
      isProductCodeDuplicateError({
        message: 'This Product Code is already used by another variant under this brand.',
      }),
    ).toBe(true)
    expect(isProductCodeDuplicateError({ details: 'product_variants_brand_product_code_key' })).toBe(true)
    expect(isProductCodeDuplicateError({ code: '23505', message: 'barcode already exists' })).toBe(false)
  })
})
