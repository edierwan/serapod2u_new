// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { StorefrontProduct } from '@/lib/storefront/products'
import OutdoorProductCard from './OutdoorProductCard'

afterEach(cleanup)

const tumbler = (extra: Partial<StorefrontProduct> = {}): StorefrontProduct => ({
  id: 'p1',
  product_name: 'SERAPOD® TUMBLER',
  product_code: 'TMB',
  product_description: null,
  short_description: null,
  is_active: true,
  category_id: null,
  brand_id: null,
  category_name: null,
  image_url: '/tumbler.png',
  animation_url: null,
  media_type: 'image',
  starting_price: 2,
  display_price: 2,
  variant_count: 2,
  tags: [],
  colorSwatches: [
    { label: 'Black', hex: '#1f1f1f', imageUrl: '/black.png', variantId: 'v-black', isDefault: true, isColour: true },
    { label: 'Burgundy', hex: '#5a1420', imageUrl: '/burgundy.png', variantId: 'v-burgundy', isColour: true },
  ],
  ...extra,
} as StorefrontProduct)

describe('OutdoorProductCard sold-out look', () => {
  it('shows Sold out only while the colour on screen is sold out', () => {
    render(<OutdoorProductCard product={tumbler({ sold_out_variant_ids: ['v-burgundy'] })} />)
    expect(screen.queryByText('Sold out')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Burgundy' }))
    expect(screen.getByText('Sold out')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Sold out/ }).className).toContain('out-sold-out')

    fireEvent.click(screen.getByRole('button', { name: 'Black' }))
    expect(screen.queryByText('Sold out')).toBeNull()
  })

  it('keeps every colour sold out when the whole product is', () => {
    render(<OutdoorProductCard product={tumbler({ sold_out: true, sold_out_variant_ids: ['v-black', 'v-burgundy'] })} />)
    expect(screen.getByText('Sold out')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Burgundy' }))
    expect(screen.getByText('Sold out')).toBeTruthy()
  })

  it('looks normal when stock is unknown or everything is in stock', () => {
    render(<OutdoorProductCard product={tumbler()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Burgundy' }))
    expect(screen.queryByText('Sold out')).toBeNull()
  })
})
