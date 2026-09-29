import { describe, expect, it, vi } from 'vitest'
import {
  FALLBACK_COLOUR_REFERENCE,
  deltaE76,
  hexToRgb,
  loadColourReferencePalette,
  nearestColour,
  resetColourReferenceCacheForTests,
  rgbToHex,
  rgbToLab,
} from './colour-reference'
import { validateStructuredAttributes } from './structured-attributes'

describe('colour reference helpers', () => {
  it('converts HEX and RGB in both directions with normalized uppercase output', () => {
    expect(hexToRgb('#3854a8')).toEqual({ red: 56, green: 84, blue: 168 })
    expect(rgbToHex({ red: 56, green: 84, blue: 168 })).toBe('#3854A8')
    expect(hexToRgb('#123')).toBeNull()
    expect(rgbToHex({ red: 256, green: 0, blue: 0 })).toBeNull()
  })

  it('uses CIELAB Delta E 76 to choose the nearest standard colour', () => {
    const royalBlue = hexToRgb('#4169E1')!
    expect(nearestColour(royalBlue)?.colour_name).toBe('Royal Blue')
    expect(deltaE76(rgbToLab(royalBlue), rgbToLab(royalBlue))).toBe(0)
  })

  it('normalizes a valid structured Colour Hex and rejects an invalid one', () => {
    const base = { attribute_name: 'Colour Hex', attribute_type: 'TEXT' as const, unit_of_measure: null, display_order: 0 }
    expect(validateStructuredAttributes([{ ...base, attribute_value: '#3854a8' }]).attributes[0].attribute_value).toBe('#3854A8')
    expect(validateStructuredAttributes([{ ...base, attribute_value: '#385' }])).toMatchObject({
      isValid: false,
      errors: { 0: 'HEX must use #RRGGBB.' },
    })
  })

  it('falls back safely when the reference table is missing', async () => {
    resetColourReferenceCacheForTests()
    let orderCalls = 0
    const missingTable = Promise.resolve({ data: null, error: { code: '42P01', message: 'relation does not exist' } })
    const query: any = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      order: vi.fn(() => (++orderCalls === 2 ? missingTable : query)),
    }
    const client = { from: vi.fn(() => query) }
    await expect(loadColourReferencePalette(client)).resolves.toEqual(FALLBACK_COLOUR_REFERENCE)
    expect(client.from).toHaveBeenCalledWith('product_colour_reference')
  })
})
