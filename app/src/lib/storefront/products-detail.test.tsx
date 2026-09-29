import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ selects: [] as string[] }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => {
      const chain: any = {
        select: (columns: string) => {
          state.selects.push(columns)
          return chain
        },
        eq: () => chain,
        single: async () => ({
          data: {
            id: 'p1',
            product_name: 'Moon Chair',
            product_code: 'MC',
            is_active: true,
            product_variants: [
              { id: 'v1', variant_name: 'Red', variant_code: 'MC-R', suggested_retail_price: 70, base_cost: 21.5, is_active: true },
            ],
          },
          error: null,
        }),
      }
      return chain
    },
  }),
}))
vi.mock('@/lib/storefront/order-stock', () => ({ sellableStock: async () => null }))

import { getProductDetail } from './products'

describe('getProductDetail', () => {
  it('never asks for or returns the cost price to shoppers', async () => {
    const product = await getProductDetail('p1')
    expect(state.selects.join(' ')).not.toContain('base_cost')
    expect(product?.variants[0].suggested_retail_price).toBe(70)
    expect(product?.variants[0]).not.toHaveProperty('base_cost')
    expect(JSON.stringify(product)).not.toContain('21.5')
  })
})
