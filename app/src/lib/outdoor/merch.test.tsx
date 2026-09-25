import { describe, expect, it } from 'vitest'
import { outdoorColorFromText, outdoorSpecLabel, outdoorStaticImage, outdoorSwatchesFromVariants } from '@/lib/outdoor/merch'
import { mergeStructuredAttributes } from '@/lib/products/structured-attributes'

describe('outdoor merch appearance', () => {
  it('maps named colours to the official Pantone swatches', () => {
    expect(outdoorColorFromText('Burgundy Sand')?.hex).toBe('#76232F')
    expect(outdoorColorFromText('Matcha Berry')?.hex).toBe('#5E6738')
    expect(outdoorColorFromText('Pink frame')?.hex).toBe('#5E6738')
    expect(outdoorStaticImage('Moonchair', '#76232F')).toBe('/outdoor/products/chair-burgundy.png')
  })

  it('dedupes swatches and prefers official packshots over CMS images', () => {
    const swatches = outdoorSwatchesFromVariants(
      [
        { variant_name: 'Moonchair Low Burgundy Sand', image_url: '/b.jpg' },
        { variant_name: 'Moonchair High Burgundy Sand', image_url: '/b2.jpg' },
        { variant_name: 'Moonchair Low Matcha Berry', image_url: '/g.jpg' },
      ],
      'Serapod Camping Chair',
    )
    expect(swatches.map((s) => s.hex)).toEqual(['#76232F', '#5E6738'])
    expect(swatches[0].imageUrl).toBe('/outdoor/products/chair-burgundy.png')
    expect(swatches[1].imageUrl).toBe('/outdoor/products/chair-pink.png')
  })

  it('keeps ready-made products on their packshots when the variant is not a colour', () => {
    expect(outdoorStaticImage('Serapod Camping Mat', '#112233')).toBe('/outdoor/products/mat-pink.png')
    expect(
      outdoorSwatchesFromVariants(
        [{ id: 'v1', variant_name: 'Default', image_url: 'https://cdn.example/broken.jpg', price: 70 }],
        'Serapod Camping Mat',
      ),
    ).toEqual([])
  })

  it('keeps a separate price for colours that have no packshot', () => {
    const swatches = outdoorSwatchesFromVariants(
      [
        { id: 'blue', variant_name: 'blue', price: 90, is_default: true },
        { id: 'red', variant_name: 'red', price: 80 },
      ],
      'product test',
    )
    expect(swatches.map((swatch) => [swatch.label, swatch.price, swatch.variantId])).toEqual([
      ['Blue', 90, 'blue'],
      ['Red', 80, 'red'],
    ])
    expect(swatches.every((swatch) => !String(swatch.imageUrl || '').includes('/outdoor/products/'))).toBe(true)
  })

  it('reads capacity and chair height from names', () => {
    expect(outdoorSpecLabel('Tumbler 1.2L', null)).toBe('1200ml')
    expect(outdoorSpecLabel('Moonchair', 'Low Burgundy')).toBe('Low')
  })

  it('prefers structured Colour, Colour Hex, and Capacity attributes', () => {
    const attributes = mergeStructuredAttributes(
      { color: 'Red', capacity: '500ml' },
      [
        { attribute_name: 'Colour', attribute_value: 'Black', unit_of_measure: null },
        { attribute_name: 'Colour Hex', attribute_value: '#0D0D0D', unit_of_measure: null },
        { attribute_name: 'Capacity', attribute_value: '1', unit_of_measure: 'L' },
      ],
    )
    expect(outdoorSwatchesFromVariants([{ variant_name: 'Legacy Red', attributes }])[0]).toMatchObject({
      hex: '#0D0D0D',
      label: 'Black',
    })
    expect(outdoorSpecLabel('Thermal Bottle', 'Black / 1L', attributes)).toBe('1 L')
  })

  it('falls back through legacy JSONB and then legacy Variant Name parsing', () => {
    expect(outdoorSwatchesFromVariants([{ variant_name: 'Ignored', attributes: { color: '#FB0909' } }])[0].hex).toBe('#FB0909')
    expect(outdoorSwatchesFromVariants([{ variant_name: '#0D0D0D', attributes: {} }])[0].hex).toBe('#0D0D0D')
    expect(outdoorSpecLabel('Tumbler', 'Legacy', { volume: '750ml' })).toBe('750ml')
  })
})
