import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  products: [] as any[],
  variants: [] as any[],
  stock: null as Map<string, number> | null,
  stockAsked: [] as string[][],
  counts: {} as Record<string, number>,
  countErrors: {} as Record<string, boolean>,
  sales: [] as any[],
  queries: [] as Array<{ table: string; filters: any[] }>,
}))

vi.mock('@/lib/outdoor/catalog', () => ({
  listOutdoorProducts: async () => ({ products: state.products }),
}))
vi.mock('@/lib/outdoor/notify-subscribers', () => ({ countOutdoorSubscribers: async () => 7 }))
vi.mock('@/lib/storefront/order-stock', () => ({
  sellableStock: async (_admin: any, ids: string[]) => {
    state.stockAsked.push(ids)
    return state.stock
  },
}))

function fakeAdmin() {
  return {
    from: (table: string) => {
      const query = { table, filters: [] as any[], head: false }
      state.queries.push(query)
      const key = () => `${table}:${JSON.stringify(query.filters)}`
      const chain: any = {
        select: (_cols: string, opts?: any) => {
          query.head = Boolean(opts?.head)
          return chain
        },
        eq: (col: string, value: any) => (query.filters.push(['eq', col, value]), chain),
        in: (col: string, value: any) => (query.filters.push(['in', col, value]), chain),
        gte: (col: string, value: any) => (query.filters.push(['gte', col, value]), chain),
        limit: () => chain,
        then: (resolve: any) => {
          if (table === 'product_variants') return resolve({ data: state.variants, error: null })
          if (!query.head) return resolve({ data: state.sales, error: null })
          if (state.countErrors[table]) return resolve({ count: null, error: { message: 'missing' } })
          return resolve({ count: state.counts[key()] ?? 0, error: null })
        },
      }
      return chain
    },
  }
}

import { loadOutdoorDesk, startOfMonthMyt } from './desk-server'

const product = (id: string, extra: any = {}) => ({
  id,
  product_name: `Product ${id}`,
  product_code: id.toUpperCase(),
  image_url: `https://cdn.example.com/${id}.png`,
  starting_price: 49,
  display_price: 49,
  variant_count: 2,
  sold_out: false,
  ...extra,
})

beforeEach(() => {
  state.products = []
  state.variants = []
  state.stock = new Map()
  state.stockAsked = []
  state.counts = {}
  state.countErrors = {}
  state.sales = []
  state.queries = []
})

describe('startOfMonthMyt', () => {
  it('starts the month at midnight Malaysia time', () => {
    expect(startOfMonthMyt(new Date('2026-09-29T06:00:00Z'))).toBe('2026-08-31T16:00:00.000Z')
    // 1 Oct 02:00 in Malaysia is still 30 Sep in UTC.
    expect(startOfMonthMyt(new Date('2026-09-30T18:00:00Z'))).toBe('2026-09-30T16:00:00.000Z')
  })
})

describe('loadOutdoorDesk', () => {
  it('counts only Outdoor orders and sums this month’s paid sales', async () => {
    const outdoorOrders = (status: any) => `storefront_orders:${JSON.stringify([['eq', 'sales_channel', 'outdoor'], status])}`
    state.counts[outdoorOrders(['in', 'status', ['paid', 'processing']])] = 3
    state.counts[outdoorOrders(['eq', 'status', 'pending_payment'])] = 2
    state.sales = [{ total_amount: '120.50' }, { total_amount: 79.5 }]

    const desk = await loadOutdoorDesk(fakeAdmin())

    expect(desk.subscribers).toBe(7)
    expect(desk.summary.toSend).toBe(3)
    expect(desk.summary.awaitingPayment).toBe(2)
    expect(desk.summary.salesThisMonth).toEqual({ orders: 2, amount: 200 })
    const salesQuery = state.queries.find((q) => q.table === 'storefront_orders' && q.filters.some((f) => f[0] === 'gte'))
    expect(salesQuery?.filters).toContainEqual(['eq', 'sales_channel', 'outdoor'])
    expect(salesQuery?.filters).toContainEqual(['in', 'status', ['paid', 'processing', 'shipped', 'delivered']])
  })

  it('shows unknown request and message counts as null instead of zero', async () => {
    state.countErrors.storefront_order_requests = true
    state.countErrors.outdoor_contact_messages = true
    const desk = await loadOutdoorDesk(fakeAdmin())
    expect(desk.summary.openRequests).toBeNull()
    expect(desk.summary.messagesThisWeek).toBeNull()
  })

  it('sums sellable stock per product, skipping Outdoor-only and hidden variants', async () => {
    state.products = [
      product('p1'),
      product('p2', { image_url: '/outdoor/products/tumbler-black.png' }),
      product('p3', { starting_price: 0, display_price: 0 }),
    ]
    state.variants = [
      { id: 'v1', product_id: 'p1', attributes: {} },
      { id: 'v2', product_id: 'p1', attributes: {} },
      { id: 'v3', product_id: 'p1', attributes: { outdoor_hidden: true } },
      { id: 'v4', product_id: 'p2', attributes: {} },
      { id: 'v5', product_id: 'p3', attributes: { outdoor_only_variant: true } },
    ]
    state.stock = new Map([
      ['v1', 4],
      ['v2', 6],
      ['v3', 50],
      ['v4', 0],
    ])

    const { products } = await loadOutdoorDesk(fakeAdmin())

    expect(state.stockAsked[0]).toEqual(['v1', 'v2', 'v4'])
    expect(products.map((p) => [p.id, p.stock, p.status, p.hasOwnPhoto])).toEqual([
      ['p1', 10, 'live', true],
      ['p2', 0, 'sold_out', false],
      ['p3', 0, 'hidden_no_price', true],
    ])
  })

  it('reports stock as unknown when it cannot be read', async () => {
    state.products = [product('p1', { sold_out: false })]
    state.variants = [{ id: 'v1', product_id: 'p1', attributes: {} }]
    state.stock = null
    const { products } = await loadOutdoorDesk(fakeAdmin())
    expect(products[0].stock).toBeNull()
    expect(products[0].status).toBe('live')
  })
})
