import { describe, expect, it } from 'vitest'
import { selectStorefrontProductMedia } from './products'

describe('selectStorefrontProductMedia', () => {
  it('uses the primary product image before variant media', () => {
    expect(selectStorefrontProductMedia(
      [
        { image_url: 'product-secondary.jpg', sort_order: 0 },
        { image_url: 'product-primary.jpg', is_primary: true, sort_order: 10 },
      ],
      [{ image_url: 'variant.jpg', is_active: true }]
    )).toEqual({
      imageUrl: 'product-primary.jpg',
      animationUrl: null,
    })
  })

  it('falls back to the first valid active variant image', () => {
    expect(selectStorefrontProductMedia(
      [{ image_url: '   ', is_primary: true }],
      [
        { image_url: '', is_default: true, is_active: true },
        { image_url: 'variant-fallback.jpg', sort_order: 1, is_active: true },
      ]
    )).toEqual({
      imageUrl: 'variant-fallback.jpg',
      animationUrl: null,
    })
  })

  it('uses variant_media when legacy variant fields are empty', () => {
    expect(selectStorefrontProductMedia([], [{
      is_active: true,
      variant_media: [
        { type: 'video', url: 'variant.mp4', sort_order: 1 },
        { type: 'image', url: 'variant-media.jpg', is_default: true, sort_order: 2 },
      ],
    }])).toEqual({
      imageUrl: 'variant-media.jpg',
      animationUrl: 'variant.mp4',
    })
  })

  it('ignores inactive and blank image records', () => {
    expect(selectStorefrontProductMedia(
      [
        { image_url: 'inactive.jpg', is_primary: true, is_active: false },
        { image_url: '  ' },
      ],
      [{ image_url: 'inactive-variant.jpg', is_active: false }]
    )).toEqual({
      imageUrl: null,
      animationUrl: null,
    })
  })
})
