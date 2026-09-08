// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import VariantsTab from './VariantsTab'

// The Variants table thumbnail shows the DEFAULT media and nothing else. It
// used to stack a small blue count badge on top of it whenever a variant
// carried more than one media file, which read as an unexplained number over
// the flavour image. Multiple media are still supported and still all editable
// in the Edit Variant dialog - only the badge is gone.

const PRODUCTS = [
  { id: 'product-1', product_name: 'Cellera Hero', is_active: true, product_code: 'CEL01', product_categories: { is_vape: true } },
]

// "Banana Vanilla" carries two media files, the second one flagged default.
const VARIANTS = [
  {
    id: 'variant-1',
    product_id: 'product-1',
    variant_name: 'Deluxe Cellera Cartridge [ Banana Vanilla ]',
    product_code: 'BV',
    is_active: true,
    image_url: null,
    animation_url: null,
    products: { product_name: 'Cellera Hero' },
    variant_media: [
      { id: 'm1', type: 'image', url: 'warning.png', thumbnail_url: null, sort_order: 0, is_default: false },
      { id: 'm2', type: 'image', url: 'banana-vanilla.png', thumbnail_url: null, sort_order: 1, is_default: true },
    ],
  },
  {
    id: 'variant-2',
    product_id: 'product-1',
    variant_name: 'Deluxe Cellera Cartridge [ Corn ]',
    product_code: 'CO',
    is_active: true,
    image_url: null,
    animation_url: null,
    products: { product_name: 'Cellera Hero' },
    variant_media: [
      { id: 'm3', type: 'image', url: 'corn.png', thumbnail_url: null, sort_order: 0, is_default: true },
    ],
  },
]

const supabase = {
  from: (table: string) => ({
    select: () => ({
      order: () =>
        Promise.resolve({ data: table === 'products' ? PRODUCTS : VARIANTS, error: null }),
    }),
  }),
}

vi.mock('@/lib/hooks/useSupabaseAuth', () => ({
  useSupabaseAuth: () => ({ isReady: true, supabase }),
}))

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}))

vi.mock('../dialogs/VariantDialog', () => ({
  default: () => null,
}))

describe('Product Management > Variants media thumbnail', () => {
  afterEach(cleanup)

  const renderTab = async () => {
    render(<VariantsTab userProfile={{}} onRefresh={vi.fn()} refreshTrigger={0} />)
    await waitFor(() =>
      expect(screen.getByAltText('Deluxe Cellera Cartridge [ Corn ]')).toBeTruthy(),
    )
  }

  it('shows the default media as the thumbnail for a multi-media variant', async () => {
    await renderTab()

    const thumbnail = screen.getByAltText('Deluxe Cellera Cartridge [ Banana Vanilla ]') as HTMLImageElement
    expect(thumbnail.getAttribute('src')).toContain('banana-vanilla.png')
  })

  it('renders no numeric media-count badge over any thumbnail', async () => {
    await renderTab()

    // The media cell holds the thumbnail and nothing else - the badge was the
    // only place the raw media count reached the table. (A bare queryByText('2')
    // would match the row-number column, which is unrelated.)
    const mediaCell = screen
      .getByAltText('Deluxe Cellera Cartridge [ Banana Vanilla ]')
      .closest('td') as HTMLElement
    expect(mediaCell.textContent).toBe('')
    expect(mediaCell.querySelector('span')).toBeNull()
    expect(document.querySelectorAll('.bg-blue-600').length).toBe(0)
  })

  it('still renders the thumbnail for a variant with a single media file', async () => {
    await renderTab()

    const thumbnail = screen.getByAltText('Deluxe Cellera Cartridge [ Corn ]') as HTMLImageElement
    expect(thumbnail.getAttribute('src')).toContain('corn.png')
  })
})
