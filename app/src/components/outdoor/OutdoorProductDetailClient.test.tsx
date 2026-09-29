// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StorefrontProductDetail, StorefrontVariant } from '@/lib/storefront/products'

const addItem = vi.fn()
vi.mock('@/lib/storefront/cart-context', () => ({ useCart: () => ({ addItem }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

import OutdoorProductDetailClient from './OutdoorProductDetailClient'

afterEach(() => {
  cleanup()
  addItem.mockReset()
})

const variant = (extra: Partial<StorefrontVariant>): StorefrontVariant => ({
  id: 'v',
  variant_name: 'Variant',
  variant_code: 'SKU-V',
  image_url: null,
  animation_url: null,
  suggested_retail_price: 70,
  base_cost: null,
  is_active: true,
  is_default: false,
  attributes: {},
  barcode: null,
  sort_order: 0,
  media: [],
  available: null,
  ...extra,
})

const mat: StorefrontProductDetail = {
  id: 'p1',
  product_name: 'Serapod Camping Mat',
  product_code: 'MAT',
  product_description: 'Made from durable, water-resistant materials.',
  short_description: null,
  is_active: true,
  category_name: 'Outdoor',
  brand_name: 'Sera Outdoor',
  image_url: null,
  variants: [
    variant({
      id: 'green',
      variant_name: 'Dark Green',
      variant_code: 'SER-GREEN',
      barcode: '9555001',
      is_default: true,
      attributes: { colour: 'Dark Green', colour_hex: '#035F1E', size: '200cm x 200cm', outdoor_nav: 'mat' },
      media: [
        { id: 'm1', type: 'image', url: 'https://cdn/green.png', thumbnail_url: null, sort_order: 0, is_default: true },
        { id: 'm2', type: 'image', url: 'https://cdn/green-rolled.png', thumbnail_url: null, sort_order: 1, is_default: false },
      ],
    }),
    variant({
      id: 'grey',
      variant_name: 'Grey',
      variant_code: 'SER-GREY',
      available: 0,
      attributes: { colour: 'Grey', colour_hex: '#7C878E' },
      media: [{ id: 'm3', type: 'image', url: 'https://cdn/grey.png', thumbnail_url: null, sort_order: 0, is_default: true }],
    }),
  ],
}

describe('OutdoorProductDetailClient', () => {
  it('shows thumbnails for every master-data photo', () => {
    render(<OutdoorProductDetailClient product={mat} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByText('1/3')).toBeTruthy()
  })

  it('shows the variants, the specifications and the SKU of the chosen variant', () => {
    render(<OutdoorProductDetailClient product={mat} />)
    expect(screen.getByRole('button', { name: 'Dark Green', pressed: true })).toBeTruthy()
    expect(screen.getByText('Specifications')).toBeTruthy()
    expect(screen.getByText('Size').nextElementSibling?.textContent).toBe('200cm x 200cm')
    expect(screen.getByText('Colour').nextElementSibling?.textContent).toBe('Dark Green')
    expect(screen.queryByText('#035F1E')).toBeNull()
    expect(screen.queryByText('mat')).toBeNull()
    expect(screen.getByText('SKU: SER-GREEN')).toBeTruthy()
    expect(screen.getByText('Barcode: 9555001')).toBeTruthy()
  })

  it('picking a variant jumps to its photo and shows it sold out', () => {
    render(<OutdoorProductDetailClient product={mat} />)
    fireEvent.click(screen.getByRole('button', { name: /^Grey/, pressed: false }))
    expect(screen.getByText('3/3')).toBeTruthy()
    expect(screen.getByText('SKU: SER-GREY')).toBeTruthy()
    expect(screen.getAllByText('Sold out').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Out of stock' })).toBeTruthy()
  })

  it('tapping a photo of another colour selects that colour', () => {
    render(<OutdoorProductDetailClient product={mat} />)
    fireEvent.click(screen.getByRole('listitem', { name: 'Show photo 3' }))
    expect(screen.getByText('SKU: SER-GREY')).toBeTruthy()
    fireEvent.click(screen.getByRole('listitem', { name: 'Show photo 2' }))
    expect(screen.getByText('SKU: SER-GREEN')).toBeTruthy()
    expect(screen.getByText('2/3')).toBeTruthy()
  })

  it('adds the variant on screen to the cart', () => {
    render(<OutdoorProductDetailClient product={mat} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    expect(addItem).toHaveBeenCalledWith(
      expect.objectContaining({ variantId: 'green', variantName: 'Dark Green', price: 70, imageUrl: 'https://cdn/green.png' }),
      1,
    )
  })
})
