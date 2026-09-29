import { describe, expect, it } from 'vitest'
import { outdoorGallery, outdoorSpecRows } from './product-page'

describe('outdoorGallery', () => {
  it('lists every variant photo and video once, in variant order', () => {
    const gallery = outdoorGallery(
      [
        {
          id: 'black',
          image_url: 'https://cdn/black.png',
          media: [
            { type: 'image', url: 'https://cdn/black.png' },
            { type: 'image', url: 'https://cdn/black-side.png' },
            { type: 'video', url: 'https://cdn/black.mp4', thumbnail_url: 'https://cdn/black-thumb.jpg' },
          ],
        },
        { id: 'red', image_url: null, media: [{ type: 'image', url: 'https://cdn/red.png' }] },
      ],
      () => null,
    )
    expect(gallery.map((item) => [item.type, item.url, item.variantIds])).toEqual([
      ['image', 'https://cdn/black.png', ['black']],
      ['image', 'https://cdn/black-side.png', ['black']],
      ['video', 'https://cdn/black.mp4', ['black']],
      ['image', 'https://cdn/red.png', ['red']],
    ])
    expect(gallery[2].thumbnailUrl).toBe('https://cdn/black-thumb.jpg')
  })

  it('puts the Outdoor photo override first and shares a photo two variants use', () => {
    const gallery = outdoorGallery(
      [
        { id: 'a', attributes: { outdoor_image: '/outdoor/products/mat-grey.png' }, media: [{ type: 'image', url: 'https://cdn/shared.png' }] },
        { id: 'b', media: [{ type: 'image', url: 'https://cdn/shared.png' }] },
      ],
      () => null,
    )
    expect(gallery.map((item) => item.url)).toEqual(['/outdoor/products/mat-grey.png', 'https://cdn/shared.png'])
    expect(gallery[1].variantIds).toEqual(['a', 'b'])
  })

  it('falls back to the product photo only for a variant with none of its own', () => {
    const gallery = outdoorGallery(
      [
        { id: 'a', media: [{ type: 'image', url: 'https://cdn/a.png' }] },
        { id: 'b', media: [] },
      ],
      (id) => (id === 'b' ? '/outdoor/products/tumbler-pink.png' : 'unused'),
    )
    expect(gallery.map((item) => item.url)).toEqual(['https://cdn/a.png', '/outdoor/products/tumbler-pink.png'])
  })
})

describe('outdoorSpecRows', () => {
  it('shows master-data attributes with readable labels', () => {
    expect(outdoorSpecRows({ colour: 'Dark Green', capacity: '1000 ml', material_type: 'Stainless steel', weight: 1.2 })).toEqual([
      { label: 'Colour', value: 'Dark Green' },
      { label: 'Capacity', value: '1000 ml' },
      { label: 'Material type', value: 'Stainless steel' },
      { label: 'Weight', value: '1.2' },
    ])
  })

  it('hides hex codes, Outdoor settings, flags and empty values', () => {
    expect(
      outdoorSpecRows({
        colour_hex: '#035F1E',
        'Colour Hex': '#035F1E',
        hex: '#000000',
        outdoor_nav: 'mat',
        outdoor_image: '/x.png',
        outdoor_hidden: true,
        is_new: true,
        nested: { a: 1 },
        blank: '  ',
      }),
    ).toEqual([])
    expect(outdoorSpecRows(null)).toEqual([])
  })
})
