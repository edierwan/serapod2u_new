// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ProductsView from './ProductsView'

const products = [
  { id: '08fdbbde-b7c1-41ad-b65f-6a187cf028b7', product_name: 'Cellera Hero' },
  { id: 'c80a657a-76a7-4691-a174-41e8c3296ee9', product_name: 'Cellera Zero' },
  { id: 'a744da84-fe0c-4ff5-99f4-80efa4f935f5', product_name: 'Ellbow Cat Treat' },
  { id: '26745a4f-f0e5-47aa-88d4-42bf0f76fcae', product_name: 'Serapod Camping Chair' },
  { id: 'ea1856fb-d2be-4885-bebb-f54b4ebbc2ec', product_name: 'Serapod Camping Mat' },
  { id: 'f2a9823a-2771-46cd-b475-472a332a8afa', product_name: 'Serapod Device S.Box' },
  { id: '9a5adc0d-3ad3-4dbf-b7e2-9e1841d19873', product_name: 'Serapod Device S.Line' },
  { id: 'd1172e5c-fca1-49cd-acd0-c927c717c65a', product_name: 'Serapod Portable Speaker' },
  { id: '08064f4a-38da-4a1d-a59b-8287a995b51b', product_name: 'SERAPOD® TUMBLER' },
].map((product) => ({
  ...product,
  product_code: product.id.slice(0, 8),
  product_description: null,
  is_vape: false,
  is_active: true,
  age_restriction: null,
  manufacturer_id: null,
  brands: null,
  product_categories: null,
  manufacturers: null,
  product_images: [],
}))

function queryResult(data: unknown[]) {
  const query: Record<string, any> = {}
  for (const method of ['select', 'order', 'eq', 'in', 'or', 'not', 'range']) {
    query[method] = vi.fn(() => query)
  }
  query.then = (resolve: (value: unknown) => void) => resolve({ data, error: null })
  return query
}

const supabase = {
  from: vi.fn((table: string) => queryResult(table === 'products' ? products : [])),
}

vi.mock('@/lib/hooks/useSupabaseAuth', () => ({
  useSupabaseAuth: () => ({ isReady: true, supabase }),
}))

vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>()
  return { ...actual, getStorageUrl: (path: string) => path }
})

afterEach(() => {
  cleanup()
  sessionStorage.clear()
  vi.clearAllMocks()
})

describe('Product List detail navigation', () => {
  it('opens view-product with the selected ID for every localhost product', async () => {
    const onViewChange = vi.fn()

    render(
      <ProductsView
        userProfile={{
          organization_id: 'e08f8574-e787-482b-b9fc-2b1551720056',
          organizations: { org_type_code: 'HQ' },
          roles: { role_level: 10 },
        }}
        onViewChange={onViewChange}
      />,
    )

    await waitFor(() => expect(screen.getByText('9 products found')).toBeTruthy())

    for (const product of products) {
      onViewChange.mockClear()
      fireEvent.click(screen.getByRole('button', { name: product.product_name }))

      expect(sessionStorage.getItem('selectedProductId')).toBe(product.id)
      expect(onViewChange).toHaveBeenCalledOnce()
      expect(onViewChange).toHaveBeenCalledWith('view-product')
    }
  })
})
