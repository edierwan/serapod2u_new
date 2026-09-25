// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ProductManagement from './ProductManagement'

vi.mock('./tabs/CategoriesTab', () => ({ default: () => <div>Categories content</div> }))
vi.mock('./tabs/BrandsTab', () => ({ default: () => <div>Brands content</div> }))
vi.mock('./tabs/GroupsTab', () => ({ default: () => <div>Groups content</div> }))
vi.mock('./tabs/SubGroupsTab', () => ({ default: () => <div>Sub-Groups content</div> }))
vi.mock('./tabs/VariantsTab', () => ({ default: () => <div>Variants content</div> }))

afterEach(cleanup)

describe('ProductManagement navigation', () => {
  it('renders New Product as navigation to the existing add-product view', async () => {
    const onViewChange = vi.fn()
    const user = userEvent.setup()
    render(<ProductManagement userProfile={{}} onViewChange={onViewChange} />)

    await user.click(screen.getByRole('tab', { name: 'New Product' }))

    expect(onViewChange).toHaveBeenCalledWith('add-product')
    expect(onViewChange.mock.calls.every(([view]) => view === 'add-product')).toBe(true)
    expect(screen.queryByText('Create New Product')).toBeNull()
    expect(screen.queryByText(/After setting up master data/)).toBeNull()
  })

  it.each([
    ['Categories', 'Categories content'],
    ['Brands', 'Brands content'],
    ['Groups', 'Groups content'],
    ['Sub-Groups', 'Sub-Groups content'],
    ['Variants', 'Variants content'],
  ])('keeps the %s tab working', async (tabName, content) => {
    const user = userEvent.setup()
    render(<ProductManagement userProfile={{}} onViewChange={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: tabName }))
    expect(screen.getByText(content)).not.toBeNull()
  })
})
