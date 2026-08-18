// @vitest-environment jsdom

import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import QuickOrderGrid from './QuickOrderGrid'

const variants = [
  {
    id: 'teh', product_id: 'product-1', product_name: 'Cellera Hero', product_code: 'CEL-TEH',
    variant_product_code: 'TT', group_name: 'Cartridge', variant_name: 'Teh Tarik', manufacturer_sku: 'SKU-HIDDEN-TEH',
    distributor_price: 32, available_qty: 100,
  },
  {
    id: 'mango', product_id: 'product-2', product_name: 'Cellera Zero', product_code: 'CEL-MANGO',
    variant_product_code: 'MP', alternative_name: 'Sunset Mango', group_name: 'Cartridge',
    variant_name: 'Fruity Cellera Cartridge [ Mango Peach ]', manufacturer_sku: 'SKU-HIDDEN-MANGO',
    distributor_price: 30, available_qty: 50,
  },
  {
    id: 'guava', product_id: 'product-3', product_name: 'Cellera Hero', product_code: 'CEL-GUAVA',
    group_name: 'Cartridge', variant_name: 'Fruity Cellera Cartridge [ Guava ]', alternative_name: null,
    manufacturer_sku: 'SKU-HIDDEN-GUAVA', distributor_price: 30, available_qty: 0,
    inventory_classification: 'unclassified' as const,
  },
  {
    id: 'double-mango', product_id: 'product-4', product_name: 'Cellera Hero', product_code: 'CEL-DOUBLE-MANGO',
    group_name: 'Cartridge', variant_name: 'Fruity Cellera Cartridge [ Double Mango ]',
    manufacturer_sku: 'SKU-DOUBLE-MANGO', distributor_price: 30, available_qty: 200,
    inventory_classification: 'classified' as const,
  },
  {
    id: 'mango-smoothie', product_id: 'product-5', product_name: 'Cellera Hero', product_code: 'CEL-MANGO-SMOOTHIE',
    group_name: 'Cartridge', variant_name: 'Fruity Cellera Cartridge [ Mango Smoothie ]',
    manufacturer_sku: 'SKU-MANGO-SMOOTHIE', distributor_price: 30, available_qty: 120,
    inventory_classification: 'classified' as const,
  },
  {
    id: 'strawberry', product_id: 'product-6', product_name: 'Cellera Hero', product_code: 'CEL-STRAWBERRY',
    group_name: 'Cartridge', variant_name: 'Fruity Cellera Cartridge [ Strawberry ]',
    manufacturer_sku: 'SKU-STRAWBERRY', distributor_price: 30, available_qty: 80,
    inventory_classification: 'classified' as const,
  },
  {
    id: 'device', product_id: 'product-7', product_name: 'S.Box', product_code: 'DEVICE-BLACK',
    group_name: 'Device', variant_name: 'Black Edition Device', manufacturer_sku: 'SKU-DEVICE-BLACK',
    distributor_price: 100, available_qty: 20, inventory_classification: 'classified' as const,
  },
]

afterEach(cleanup)

describe('Quick Order product display and hidden identifier search', () => {
  it('combines flavour, code, product and alternative name in one Product column', () => {
    render(<QuickOrderGrid variants={variants} items={[]} formatCurrency={amount => amount.toFixed(2)} onQuantityChange={vi.fn()} onClear={vi.fn()} />)
    // The Product column drops the words shared across the group and shows the
    // remainder in caps, so the Cartridge rows read "HERO"/"ZERO" rather than
    // repeating "Cellera"; the Alternative Name follows only when there is one.
    expect(screen.getByText('ZERO · Sunset Mango')).not.toBeNull()
    expect(screen.getAllByText('HERO').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Mango Peach')).not.toBeNull()
    expect(screen.getByText('MP')).not.toBeNull()
    expect(screen.queryByText('Cellera Hero')).toBeNull()
    expect(screen.queryByText('CEL-TEH')).toBeNull()
    expect(screen.queryByText('SKU-HIDDEN-TEH')).toBeNull()
  })

  it('keeps the catalog to six columns and labels quantities in cases per row', () => {
    render(<QuickOrderGrid variants={variants} items={[]} formatCurrency={amount => amount.toFixed(2)} onQuantityChange={vi.fn()} onClear={vi.fn()} />)
    expect(screen.getAllByRole('columnheader').map(header => header.textContent))
      .toEqual(['Product', 'Stock', 'Qty', 'Price', 'Total', 'Status'])
    expect(screen.getAllByText('cases').length).toBe(variants.length)
  })

  it('corrects the master-data group spelling on the tabs only', () => {
    const misspelled = variants.map(variant => ({ ...variant, group_name: variant.group_name === 'Cartridge' ? 'Catridge' : variant.group_name }))
    render(<QuickOrderGrid variants={misspelled} items={[]} formatCurrency={amount => amount.toFixed(2)} onQuantityChange={vi.fn()} onClear={vi.fn()} />)
    expect(screen.getByRole('tab', { name: /Cartridge 6/ })).not.toBeNull()
    expect(screen.queryByRole('tab', { name: /Catridge/ })).toBeNull()
  })

  it('shows a compact status marker instead of a repeated badge', () => {
    render(<QuickOrderGrid variants={variants} items={[]} formatCurrency={amount => amount.toFixed(2)} onQuantityChange={vi.fn()} onClear={vi.fn()} />)
    expect(screen.getByText('Unclassified')).not.toBeNull()
    expect(screen.getAllByText('Available').length).toBeGreaterThanOrEqual(5)
    expect(screen.queryByText('Inventory Unclassified')).toBeNull()
  })

  it('still searches by hidden Product Code and SKU', async () => {
    const user = userEvent.setup()
    render(<QuickOrderGrid variants={variants} items={[]} formatCurrency={amount => amount.toFixed(2)} onQuantityChange={vi.fn()} onClear={vi.fn()} />)
    const search = screen.getByPlaceholderText('Search flavour, product or Product Code')

    await user.type(search, 'SKU-HIDDEN-TEH')
    expect(screen.getByText('Teh Tarik')).not.toBeNull()
    expect(screen.queryByText('Mango Peach')).toBeNull()

    await user.clear(search)
    await user.type(search, 'CEL-MANGO')
    expect(screen.getByText('Mango Peach')).not.toBeNull()
    expect(screen.getByText('Mango Smoothie')).not.toBeNull()
    expect(screen.queryByText('Teh Tarik')).toBeNull()
  })

  it('displays matched inventory and stock outcomes separately from product identity', async () => {
    const user = userEvent.setup()
    render(<QuickOrderGrid variants={variants} items={[]} formatCurrency={amount => amount.toFixed(2)} onQuantityChange={vi.fn()} onClear={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Paste list' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByRole('textbox'), 'GUAVA - 300\nMANGO PEACH - 100\nUNKNOWN FLAVOUR - 1')
    await user.click(within(dialog).getByRole('button', { name: 'Review matches' }))

    // The Result column speaks the same status vocabulary as the catalog rows.
    expect(within(dialog).getByText('Unclassified')).not.toBeNull()
    expect(within(dialog).getByText('Insufficient')).not.toBeNull()
    expect(within(dialog).getByText('Product Not Found')).not.toBeNull()
    expect(within(dialog).queryByText('Matched — Inventory Unclassified')).toBeNull()
    expect(within(dialog).getByText('Cellera Hero - [ Guava ]')).not.toBeNull()
    expect(within(dialog).getByText('Cellera Zero - [ Mango Peach ] - MP')).not.toBeNull()
    expect(within(dialog).getByText('Alternative: Sunset Mango')).not.toBeNull()
    expect(within(dialog).queryByText('Fruity Cellera Cartridge [ Guava ]')).toBeNull()
    expect(within(dialog).getByText('0 available')).not.toBeNull()
    expect(within(dialog).queryByText(/Legacy \/ Unclassified/)).toBeNull()
    expect(within(dialog).queryByText('Clear selection')).toBeNull()
    expect(within(dialog).queryByPlaceholderText('Search full active Product Master')).toBeNull()
    expect((within(dialog).getByRole('button', { name: 'Apply reviewed quantities' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows ranked Mango suggestions, blocks unresolved rows, and recalculates after selection', async () => {
    const user = userEvent.setup()
    render(<QuickOrderGrid variants={variants} items={[]} formatCurrency={amount => amount.toFixed(2)} onQuantityChange={vi.fn()} onClear={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Paste list' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByRole('textbox'), 'MANGO - 1000')
    await user.click(within(dialog).getByRole('button', { name: 'Review matches' }))

    expect(within(dialog).getByText('Multiple Matches — Selection Required')).not.toBeNull()
    expect(within(dialog).getByText('Cellera Hero - [ Mango Smoothie ]')).not.toBeNull()
    expect(within(dialog).getByText('Cellera Hero - [ Double Mango ]')).not.toBeNull()
    expect(within(dialog).getByText('120 available')).not.toBeNull()
    expect(within(dialog).queryByText('CEL-MANGO-SMOOTHIE')).toBeNull()
    expect(within(dialog).queryByText('SKU-MANGO-SMOOTHIE')).toBeNull()
    expect(within(dialog).queryByText('[ Strawberry ]')).toBeNull()
    expect(within(dialog).queryByText('Black Edition Device')).toBeNull()
    expect((within(dialog).getByRole('button', { name: 'Apply reviewed quantities' }) as HTMLButtonElement).disabled).toBe(true)

    await user.click(within(dialog).getByRole('button', { name: /Mango Smoothie/ }))
    expect(within(dialog).getByText('Insufficient')).not.toBeNull()
    expect(within(dialog).queryByText('Clear selection')).toBeNull()
  })

  it('allows a sufficient resolution only from relevant suggestions', async () => {
    const user = userEvent.setup()
    const onQuantityChange = vi.fn()
    render(<QuickOrderGrid variants={variants} items={[]} formatCurrency={amount => amount.toFixed(2)} onQuantityChange={onQuantityChange} onClear={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Paste list' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByRole('textbox'), 'MANGO - 20')
    await user.click(within(dialog).getByRole('button', { name: 'Review matches' }))

    expect(within(dialog).queryByPlaceholderText('Search full active Product Master')).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: /Mango Smoothie/ }))

    expect(within(dialog).getByText('Available')).not.toBeNull()
    const apply = within(dialog).getByRole('button', { name: 'Apply reviewed quantities' }) as HTMLButtonElement
    expect(apply.disabled).toBe(false)
    await user.click(apply)
    expect(onQuantityChange).toHaveBeenCalledWith('mango-smoothie', 20)
  })

  it('shows just the applied rows after Apply, whatever filters were set before', async () => {
    const user = userEvent.setup()
    render(<QuickOrderGrid variants={variants} items={[]} formatCurrency={amount => amount.toFixed(2)} onQuantityChange={vi.fn()} onClear={vi.fn()} />)

    // Filters that would otherwise hide what was just applied.
    await user.click(screen.getByRole('tab', { name: /Device/ }))
    await user.type(screen.getByPlaceholderText('Search flavour, product or Product Code'), 'black')

    await user.click(screen.getByRole('button', { name: 'Paste list' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByRole('textbox'), 'MANGO PEACH - 10')
    await user.click(within(dialog).getByRole('button', { name: 'Review matches' }))
    await user.click(within(dialog).getByRole('button', { name: 'Apply reviewed quantities' }))

    expect(screen.getByRole('button', { name: 'Selected' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('tab', { name: /All/ }).getAttribute('aria-selected')).toBe('true')
    expect((screen.getByPlaceholderText('Search flavour, product or Product Code') as HTMLInputElement).value).toBe('')
  })

  it('requires explicit confirmation for a single low-confidence possible match', async () => {
    const user = userEvent.setup()
    render(<QuickOrderGrid variants={variants} items={[]} formatCurrency={amount => amount.toFixed(2)} onQuantityChange={vi.fn()} onClear={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Paste list' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByRole('textbox'), 'TEH - 20')
    await user.click(within(dialog).getByRole('button', { name: 'Review matches' }))

    expect(within(dialog).getByText('Possible Match — Review Required')).not.toBeNull()
    expect(within(dialog).getByText('Cellera Hero - [ Teh Tarik ] - TT')).not.toBeNull()
    expect((within(dialog).getByRole('button', { name: 'Apply reviewed quantities' }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(within(dialog).getByRole('button', { name: /Teh Tarik/ }))
    expect(within(dialog).getByText('Available')).not.toBeNull()
    expect((within(dialog).getByRole('button', { name: 'Apply reviewed quantities' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('Paste review presentation and WhatsApp reply', () => {
  it('keeps the sender marks out of Entry and reports the system verdict in Result', async () => {
    const user = userEvent.setup()
    render(<QuickOrderGrid variants={variants} items={[]} formatCurrency={amount => amount.toFixed(2)} onQuantityChange={vi.fn()} onClear={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Paste list' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByRole('textbox'), 'MANGO PEACH - 10\u2705\nGUAVA - 300\u2705')
    await user.click(within(dialog).getByRole('button', { name: 'Review matches' }))

    // The distributor's own tick is stripped from the echoed entry text.
    expect(within(dialog).getByText('Original: MANGO PEACH - 10')).not.toBeNull()
    expect(within(dialog).queryByText(/Original: MANGO PEACH - 10\u2705/)).toBeNull()

    // Guava is unclassified with 0 available, so the system says no. The
    // Result reads in the same words as the catalog rows, no marks repeated.
    expect(within(dialog).getByText('Unclassified')).not.toBeNull()
    expect(within(dialog).getByText('Available')).not.toBeNull()
    expect(within(dialog).queryByText(/\u2705Matched/)).toBeNull()

    // Qty is labelled in cases without crowding the header.
    expect(within(dialog).getByText('(Cases)')).not.toBeNull()
  })

  it('copies a WhatsApp reply grouped by product', async () => {
    const user = userEvent.setup()
    // Installed after setup(): userEvent stubs navigator.clipboard itself.
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<QuickOrderGrid variants={variants} items={[]} formatCurrency={amount => amount.toFixed(2)} onQuantityChange={vi.fn()} onClear={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Paste list' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByRole('textbox'), 'MANGO PEACH - 10\nDOUBLE MANGO - 20\nGUAVA - 300')
    await user.click(within(dialog).getByRole('button', { name: 'Review matches' }))
    await user.click(within(dialog).getByRole('button', { name: /Copy Result/ }))

    expect(writeText).toHaveBeenCalledTimes(1)
    const reply = writeText.mock.calls[0][0] as string
    expect(reply.split('\n').slice(0, 8)).toEqual(
      [
        'Cellera Zero (Cases)',
        '',
        'Mango Peach (MP) 10 \u2705',
        '',
        'Cellera Hero (Cases)',
        '',
        'Double Mango 20 \u2705',
        'Guava 300 \u274c',
      ],
    )
    // Stamped with the moment it was copied, so the date is matched by shape.
    // Only Mango Peach (10) and Double Mango (20) are fillable; Guava is not.
    expect(reply).toMatch(
      /\n\n\u{1F6E1}\u{FE0F} Verified by Serapod2U\nTotal Cases : 30\nTotal Box : 1\n\d{1,2} [A-Za-z]+ \d{4} · \d{1,2}:\d{2} (AM|PM)$/u,
    )
    expect(await within(dialog).findByText('Copied')).not.toBeNull()
  })

  it('previews the copied reply, then clears it on its own', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
      render(<QuickOrderGrid variants={variants} items={[]} formatCurrency={amount => amount.toFixed(2)} onQuantityChange={vi.fn()} onClear={vi.fn()} />)

      await user.click(screen.getByRole('button', { name: 'Paste list' }))
      const dialog = await screen.findByRole('dialog')
      await user.type(within(dialog).getByRole('textbox'), 'MANGO PEACH - 10')
      await user.click(within(dialog).getByRole('button', { name: 'Review matches' }))
      await user.click(within(dialog).getByRole('button', { name: /Copy Result/ }))

      // The operator sees the exact clipboard text before leaving for WhatsApp.
      const preview = await within(dialog).findByRole('status')
      expect(preview.textContent).toContain('Cellera Zero (Cases)')
      expect(preview.textContent).toContain('Mango Peach (MP) 10 ✅')
      expect(preview.textContent).toContain('Verified by Serapod2U')

      await act(async () => { vi.advanceTimersByTime(5000) })
      expect(within(dialog).queryByRole('status')).toBeNull()
      expect(within(dialog).getByRole('button', { name: /Copy Result/ })).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  // Production regression (2026-08-18): "Deluxe Cellera Cartridge [Orange]" was
  // active with 3,259 sellable cases but no Distributor Price, and the paste
  // review answered "Product Not Found" — the operator had no way to tell an
  // unknown flavour from one whose price field was simply empty.
  it('names a missing Distributor Price instead of reporting the variant as not found', async () => {
    const user = userEvent.setup()
    const unpriced = [{
      id: 'orange', product_id: 'product-8', product_name: 'Cellera Hero', product_code: 'CELVA9464',
      variant_product_code: 'OR', alternative_name: 'OREN', group_name: 'Cartridge',
      variant_name: 'Deluxe Cellera Cartridge [Orange]', distributor_price: 0, available_qty: 3259,
      inventory_classification: 'classified' as const, pricing_status: 'price_missing' as const,
    }]
    render(<QuickOrderGrid variants={unpriced} items={[]} formatCurrency={amount => amount.toFixed(2)} onQuantityChange={vi.fn()} onClear={vi.fn()} />)

    // The catalog row states the reason and refuses a quantity rather than
    // pricing the line at RM 0.
    expect(screen.getAllByText('Price Not Set').length).toBe(1)
    expect(screen.getByText('Not set')).not.toBeNull()
    expect((screen.getByLabelText('Order quantity in cases for Deluxe Cellera Cartridge [Orange]') as HTMLInputElement).disabled).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Paste list' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByRole('textbox'), 'Orange - 50')
    await user.click(within(dialog).getByRole('button', { name: 'Review matches' }))

    expect(within(dialog).queryByText('Product Not Found')).toBeNull()
    expect(within(dialog).getByText('Price Not Set')).not.toBeNull()
    expect(within(dialog).getByText('Cellera Hero - [ Orange ] - OR')).not.toBeNull()
    expect(within(dialog).getByText('Distributor Price not set in Product Management')).not.toBeNull()
    expect((within(dialog).getByRole('button', { name: 'Apply reviewed quantities' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
