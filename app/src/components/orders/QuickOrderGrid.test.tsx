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
    group_name: 'Cartridge', variant_name: 'Mango', manufacturer_sku: 'SKU-HIDDEN-MANGO',
    distributor_price: 30, available_qty: 50,
  },
  {
    id: 'guava', product_id: 'product-3', product_name: 'Cellera Hero', product_code: 'CEL-GUAVA',
    group_name: 'Cartridge', variant_name: 'Fruity Cellera Cartridge [ Guava ]', alternative_name: null,
    manufacturer_sku: 'SKU-HIDDEN-GUAVA', distributor_price: 30, available_qty: 0,
    inventory_classification: 'unclassified' as const,
  },
]

afterEach(cleanup)

describe('Quick Order product display and hidden identifier search', () => {
  it('shows clean product names without rendering Product Code or SKU in product rows', () => {
    render(<QuickOrderGrid variants={variants} items={[]} formatCurrency={amount => amount.toFixed(2)} onQuantityChange={vi.fn()} onClear={vi.fn()} />)
    expect(screen.getAllByText('Cellera Hero')).toHaveLength(2)
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
    expect(screen.getByText('Mango')).not.toBeNull()
    expect(screen.queryByText('Teh Tarik')).toBeNull()
  })

  it('displays matched inventory and stock outcomes separately from product identity', async () => {
    const user = userEvent.setup()
    render(<QuickOrderGrid variants={variants} items={[]} formatCurrency={amount => amount.toFixed(2)} onQuantityChange={vi.fn()} onClear={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Paste Order List' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByRole('textbox'), 'GUAVA - 300\nMANGO - 100\nUNKNOWN FLAVOUR - 1')
    await user.click(within(dialog).getByRole('button', { name: 'Review matches' }))

    expect(screen.getByText('Matched — Inventory Unclassified')).not.toBeNull()
    expect(screen.getByText('Matched — Insufficient Stock')).not.toBeNull()
    expect(screen.getByText('Product Not Found')).not.toBeNull()
  })
})
