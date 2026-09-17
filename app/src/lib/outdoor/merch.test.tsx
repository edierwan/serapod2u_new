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

  it('reads capacity and chair height from names', () => {
    expect(outdoorSpecLabel('Tumbler 1.2L', null)).toBe('1200ml')
    expect(outdoorSpecLabel('Moonchair', 'Low Burgundy')).toBe('Low')
  })
})
