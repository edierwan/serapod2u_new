import { describe, expect, it } from 'vitest'
import { outdoorColorFromText, outdoorSpecLabel, outdoorStaticImage, outdoorSwatchesFromVariants } from '@/lib/outdoor/merch'

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
})
