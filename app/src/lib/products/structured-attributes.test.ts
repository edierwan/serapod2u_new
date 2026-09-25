import { describe, expect, it } from 'vitest'
import {
  attributeInsertRows,
  emptyStructuredAttribute,
  isRawHexVariantName,
  mergeStructuredAttributes,
  validateStructuredAttributes,
  type StructuredAttribute,
} from './structured-attributes'

const attribute = (name: string, value: string, unit: string | null = null): StructuredAttribute => ({
  attribute_name: name,
  attribute_value: value,
  attribute_type: 'TEXT',
  unit_of_measure: unit,
  display_order: 0,
})

describe('structured Product and Variant attributes', () => {
  it('allows Products and Variants with no attributes', () => {
    expect(attributeInsertRows({ productId: 'product-1' }, [])).toEqual([])
    expect(attributeInsertRows({ variantId: 'variant-1' }, [])).toEqual([])
  })

  it('persists Product attributes with product_id only', () => {
    expect(attributeInsertRows({ productId: 'product-1' }, [attribute('Material', 'Stainless Steel')])[0]).toMatchObject({
      product_id: 'product-1',
      variant_id: null,
      attribute_name: 'Material',
      attribute_value: 'Stainless Steel',
    })
  })

  it('persists Variant attributes with variant_id only', () => {
    expect(attributeInsertRows({ variantId: 'variant-1' }, [attribute('Colour', 'Black')])[0]).toMatchObject({
      product_id: null,
      variant_id: 'variant-1',
      attribute_name: 'Colour',
      attribute_value: 'Black',
    })
  })

  it('ignores wholly blank rows without persisting them', () => {
    expect(attributeInsertRows({ productId: 'product-1' }, [emptyStructuredAttribute()])).toEqual([])
  })

  it('rejects partial and case-insensitive duplicate attribute rows', () => {
    expect(validateStructuredAttributes([attribute('', 'Black')]).isValid).toBe(false)
    const duplicate = validateStructuredAttributes([attribute(' Colour ', 'Black'), attribute('colour', 'Red')])
    expect(duplicate.isValid).toBe(false)
    expect(duplicate.errors).toEqual({ 0: 'Attribute names must be unique.', 1: 'Attribute names must be unique.' })
  })

  it('allows Colour and Colour Hex to coexist', () => {
    const result = validateStructuredAttributes([
      attribute('Colour', 'Black'),
      attribute('Colour Hex', '#0D0D0D'),
    ])
    expect(result.isValid).toBe(true)
    expect(result.attributes).toHaveLength(2)
  })

  it('preserves Capacity value, unit, and display order', () => {
    const row = attributeInsertRows({ variantId: 'variant-1' }, [attribute('Capacity', '1', 'L')])[0]
    expect(row).toMatchObject({ attribute_value: '1', unit_of_measure: 'L', display_order: 0 })
  })

  it('recognises only raw six-digit hex Variant Names as invalid', () => {
    expect(isRawHexVariantName('#0D0D0D')).toBe(true)
    expect(isRawHexVariantName('Black')).toBe(false)
    expect(isRawHexVariantName('Black / 1L')).toBe(false)
  })

  it('prefers structured values while retaining unrelated legacy compatibility data', () => {
    expect(mergeStructuredAttributes(
      { color: 'Red', capacity: '500ml', outdoor_hidden: true },
      [attribute('Colour', 'Black'), attribute('Colour Hex', '#0D0D0D'), attribute('Capacity', '1', 'L')],
    )).toEqual({
      colour: 'Black',
      colour_hex: '#0D0D0D',
      capacity: '1 L',
      outdoor_hidden: true,
    })
  })
})
