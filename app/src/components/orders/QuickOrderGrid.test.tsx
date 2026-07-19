// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import QuickOrderGrid from './QuickOrderGrid'

const variants = [
  {
    id: 'teh', product_id: 'product-1', product_name: 'Cellera Hero', product_code: 'CEL-TEH',
    group_name: 'Cartridge', variant_name: 'Teh Tarik', manufacturer_sku: 'SKU-HIDDEN-TEH',
    distributor_price: 32, available_qty: 100,
  },
  {
    id: 'mango', product_id: 'product-2', product_name: 'Cellera Zero', product_code: 'CEL-MANGO',
    group_name: 'Cartridge', variant_name: 'Fruity Cellera Cartridge [ Mango Peach ]', manufacturer_sku: 'SKU-HIDDEN-MANGO',
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
  it('shows clean product names without rendering Product Code or SKU in product rows', () => {
    render(<QuickOrderGrid variants={variants} items={[]} formatCurrency={amount => amount.toFixed(2)} onQuantityChange={vi.fn()} onClear={vi.fn()} />)
    expect(screen.getAllByText('Cellera Hero').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Cellera Zero')).not.toBeNull()
    expect(screen.queryByText('CEL-TEH')).toBeNull()
    expect(screen.queryByText('SKU-HIDDEN-TEH')).toBeNull()
  })

  it('still searches by hidden Product Code and SKU', async () => {
    const user = userEvent.setup()
    render(<QuickOrderGrid variants={variants} items={[]} formatCurrency={amount => amount.toFixed(2)} onQuantityChange={vi.fn()} onClear={vi.fn()} />)
    const search = screen.getByPlaceholderText('Search flavour, product or Product Code')

    await user.type(search, 'SKU-HIDDEN-TEH')
    expect(screen.getByText('Teh Tarik')).not.toBeNull()
    expect(screen.queryByText('Mango')).toBeNull()

    await user.clear(search)
    await user.type(search, 'CEL-MANGO')
    expect(screen.getByText('Fruity Cellera Cartridge [ Mango Peach ]')).not.toBeNull()
    expect(screen.getByText('Fruity Cellera Cartridge [ Mango Smoothie ]')).not.toBeNull()
    expect(screen.queryByText('Teh Tarik')).toBeNull()
  })

  it('displays matched inventory and stock outcomes separately from product identity', async () => {
    const user = userEvent.setup()
    render(<QuickOrderGrid variants={variants} items={[]} formatCurrency={amount => amount.toFixed(2)} onQuantityChange={vi.fn()} onClear={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Paste Order List' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByRole('textbox'), 'GUAVA - 300\nMANGO PEACH - 100\nUNKNOWN FLAVOUR - 1')
    await user.click(within(dialog).getByRole('button', { name: 'Review matches' }))

    expect(screen.getByText('Matched — Inventory Unclassified')).not.toBeNull()
    expect(screen.getByText('Matched — Insufficient Stock')).not.toBeNull()
    expect(screen.getByText('Product Not Found')).not.toBeNull()
    expect(within(dialog).getByText('[ Guava ]')).not.toBeNull()
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

    await user.click(screen.getByRole('button', { name: 'Paste Order List' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByRole('textbox'), 'MANGO - 1000')
    await user.click(within(dialog).getByRole('button', { name: 'Review matches' }))

    expect(within(dialog).getByText('Multiple Matches — Selection Required')).not.toBeNull()
    expect(within(dialog).getByText('[ Mango Smoothie ]')).not.toBeNull()
    expect(within(dialog).getByText('[ Double Mango ]')).not.toBeNull()
    expect(within(dialog).getByText('120 available')).not.toBeNull()
    expect(within(dialog).queryByText('CEL-MANGO-SMOOTHIE')).toBeNull()
    expect(within(dialog).queryByText('SKU-MANGO-SMOOTHIE')).toBeNull()
    expect(within(dialog).queryByText('[ Strawberry ]')).toBeNull()
    expect(within(dialog).queryByText('Black Edition Device')).toBeNull()
    expect((within(dialog).getByRole('button', { name: 'Apply reviewed quantities' }) as HTMLButtonElement).disabled).toBe(true)

    await user.click(within(dialog).getByRole('button', { name: /Mango Smoothie/ }))
    expect(within(dialog).getByText('Matched — Insufficient Stock')).not.toBeNull()
    expect(within(dialog).queryByText('Clear selection')).toBeNull()
  })

  it('allows a sufficient resolution only from relevant suggestions', async () => {
    const user = userEvent.setup()
    const onQuantityChange = vi.fn()
    render(<QuickOrderGrid variants={variants} items={[]} formatCurrency={amount => amount.toFixed(2)} onQuantityChange={onQuantityChange} onClear={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Paste Order List' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByRole('textbox'), 'MANGO - 20')
    await user.click(within(dialog).getByRole('button', { name: 'Review matches' }))

    expect(within(dialog).queryByPlaceholderText('Search full active Product Master')).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: /Mango Smoothie/ }))

    expect(within(dialog).getByText('Matched')).not.toBeNull()
    const apply = within(dialog).getByRole('button', { name: 'Apply reviewed quantities' }) as HTMLButtonElement
    expect(apply.disabled).toBe(false)
    await user.click(apply)
    expect(onQuantityChange).toHaveBeenCalledWith('mango-smoothie', 20)
  })

  it('requires explicit confirmation for a single low-confidence possible match', async () => {
    const user = userEvent.setup()
    render(<QuickOrderGrid variants={variants} items={[]} formatCurrency={amount => amount.toFixed(2)} onQuantityChange={vi.fn()} onClear={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Paste Order List' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByRole('textbox'), 'TEH - 20')
    await user.click(within(dialog).getByRole('button', { name: 'Review matches' }))

    expect(within(dialog).getByText('Possible Match — Review Required')).not.toBeNull()
    expect(within(dialog).getByText('Teh Tarik')).not.toBeNull()
    expect((within(dialog).getByRole('button', { name: 'Apply reviewed quantities' }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(within(dialog).getByRole('button', { name: /Teh Tarik/ }))
    expect(within(dialog).getByText('Matched')).not.toBeNull()
    expect((within(dialog).getByRole('button', { name: 'Apply reviewed quantities' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
