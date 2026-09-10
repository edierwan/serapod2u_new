// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProductsTab from './ProductsTab'
import {
  buildProductAnalyticsReport,
  resolveProductReportPeriod,
  type ProductAnalyticsAggregate,
} from '@/lib/reporting/product-analytics'

// The tab is a pure consumer of /api/reporting/product-analytics: it renders
// the report DTO and never queries Supabase itself. These tests drive it
// through that contract.
//
// jsdom applies no CSS, so the responsive layers that are mutually exclusive in
// a real browser (the `hidden md:block` desktop table and the `md:hidden`
// mobile cards) are BOTH in the tree here. Assertions therefore use
// `getAllByText` wherever a value is deliberately rendered in both layers.

const NOW = new Date('2026-09-07T10:00:00+08:00')

function reportFor(month: string, categoryId = 'all') {
  const period = resolveProductReportPeriod(month, NOW)
  const categoryName = CATEGORIES.find((c) => c.id === categoryId)?.name ?? 'All Categories'
  const isAll = categoryId === 'all'
  const aggregate: ProductAnalyticsAggregate = {
    month,
    categoryId,
    categoryName,
    current: { units: 4820, orderValue: 82340, skus: 26, orders: 0 },
    previous: { units: 4210, orderValue: 76254, skus: 23, orders: 0 },
    activeSkus: 60,
    dailyTrend: Array.from({ length: period.dayCount }, (_, i) => ({
      date: `${month}-${String(i + 1).padStart(2, '0')}`, units: 600, orderValue: 11000,
    })),
    variants: [
      {
        variantId: 'v1', productId: 'p1', categoryId: 'cat-vape', categoryName: 'Vape', productName: 'Cellera Hero',
        variantName: 'Deluxe Cellera Cartridge [ Banana Vanilla ]', productCode: 'BV', isActive: true,
        currentUnits: 820, currentValue: 13284, previousUnits: 678, previousValue: 11000,
        stockOnHand: 180, stockAvailable: 100, reorderPoint: 200, safetyStock: 50, stockValue: 1800,
        lastOrderedAt: '2026-09-05T02:00:00.000Z',
      },
      {
        variantId: 'v2', productId: 'p1', categoryId: 'cat-vape', categoryName: 'Vape', productName: 'Cellera Hero',
        variantName: 'Deluxe Cellera Cartridge [ Grape Pudina ]', productCode: 'GP', isActive: true,
        currentUnits: 0, currentValue: 0, previousUnits: 120, previousValue: 2000,
        stockOnHand: 1450, stockAvailable: 1450, reorderPoint: 100, safetyStock: 20, stockValue: 14500,
        lastOrderedAt: '2026-08-14T02:00:00.000Z',
      },
    ],
    inventory: { totalValue: 257450, totalOnHand: 1630, variantCount: 2, asOf: '2026-09-07T02:00:00.000Z' },
    // The server only emits per-category totals for the consolidated report.
    categories: isAll ? [
      { categoryId: 'cat-vape', categoryName: 'Vape', currentUnits: 2200, currentValue: 30800, currentSkus: 12, previousUnits: 1930, previousValue: 27000, previousSkus: 11, activeSkus: 18 },
      { categoryId: 'cat-pet', categoryName: 'Pet Food', currentUnits: 1120, currentValue: 18400, currentSkus: 8, previousUnits: 1037, previousValue: 17000, previousSkus: 8, activeSkus: 12 },
    ] : [],
  }
  return buildProductAnalyticsReport(aggregate, NOW)
}

const requestedMonths: string[] = []
const requestedCategories: string[] = []

const CATEGORIES = [
  { id: 'cat-elec', name: 'Electronic' },
  { id: 'cat-out', name: 'Outdoor' },
  { id: 'cat-pet', name: 'Pet Food' },
  { id: 'cat-vape', name: 'Vape' },
]

function mockFetch() {
  return vi.fn(async (input: any) => {
    const url = String(input)
    // One request supplies both filter lists.
    if (url.includes('/filters')) {
      return {
        ok: true,
        json: async () => ({
          months: [{ key: '2026-09' }, { key: '2026-08' }, { key: '2026-07' }],
          categories: CATEGORIES,
        }),
      } as any
    }
    const params = new URL(url, 'http://localhost').searchParams
    const month = params.get('month') || '2026-09'
    const category = params.get('categoryId') || 'all'
    requestedMonths.push(month)
    requestedCategories.push(category)
    return {
      ok: true,
      json: async () => ({
        report: reportFor(month, category),
        meta: { source: 'rpc', degraded: false, notice: null, generatedAt: '2026-09-07T02:00:00.000Z' },
      }),
    } as any
  })
}

/** Radix Tabs respond to pointer events, which fireEvent.click does not emit. */
function pointerUser() {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
}

const props = { userProfile: { full_name: 'Admin HQ' }, chartGridColor: '#eee', chartTickColor: '#666', isDark: false }

beforeEach(() => {
  requestedMonths.length = 0
  requestedCategories.length = 0
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(NOW)
  vi.stubGlobal('fetch', mockFetch())
  // Recharts measures its container; jsdom reports zero, so give it a size.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  // Radix Select drives its listbox through Pointer Capture and scrollIntoView,
  // neither of which jsdom implements; without these the dropdown never opens.
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false)
  window.HTMLElement.prototype.setPointerCapture = vi.fn()
  window.HTMLElement.prototype.releasePointerCapture = vi.fn()
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('default entry', () => {
  it('opens on the current month with its MTD range and comparison, and no Apply button', async () => {
    render(<ProductsTab {...props} />)

    await waitFor(() => expect(screen.getByText('Monthly Summary')).toBeTruthy())

    expect(screen.getByText('September 2026')).toBeTruthy()
    expect(screen.getAllByText(/01 Sep 2026 – 07 Sep 2026/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/vs 01 Aug 2026 – 07 Aug 2026/).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /apply/i })).toBeNull()
    expect(requestedMonths).toEqual(['2026-09'])
  })

  it('renders the four monthly KPIs, using Order Value rather than Revenue', async () => {
    render(<ProductsTab {...props} />)
    await waitFor(() => expect(screen.getByText('Monthly Summary')).toBeTruthy())

    expect(screen.getAllByText('Units Ordered').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Order Value').length).toBeGreaterThan(0)
    expect(screen.getAllByText('SKUs Ordered').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Avg Value / Unit').length).toBeGreaterThan(0)
    expect(screen.queryByText(/^Revenue$/)).toBeNull()
    expect(screen.getByText('out of 60 active SKUs')).toBeTruthy()
  })

  it('carries no Turnover Ratio and no 12-month demand trend', async () => {
    render(<ProductsTab {...props} />)
    await waitFor(() => expect(screen.getByText('Monthly Summary')).toBeTruthy())

    expect(screen.queryByText(/turnover/i)).toBeNull()
    expect(screen.queryByText(/12.month|twelve.month/i)).toBeNull()
  })
})

describe('sub-navigation', () => {
  it('keeps the selected Reporting Month while switching sub-tabs', async () => {
    const user = pointerUser()
    render(<ProductsTab {...props} />)
    await waitFor(() => expect(screen.getByText('Monthly Summary')).toBeTruthy())

    // Select a historical month.
    await user.click(screen.getByTitle('Previous month'))
    await waitFor(() => expect(screen.getAllByText(/01 Aug 2026 – 31 Aug 2026/).length).toBeGreaterThan(0))

    // Overview → Performance → Inventory & Actions → Overview.
    await user.click(screen.getByRole('tab', { name: /Performance/ }))
    await waitFor(() => expect(screen.getByText(/Daily Product Demand Trend/)).toBeTruthy())
    expect(screen.getAllByText(/01 Aug 2026 – 31 Aug 2026/).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('tab', { name: /Inventory & Actions/ }))
    await waitFor(() => expect(screen.getByText('Management Action Plan')).toBeTruthy())
    expect(screen.getAllByText(/01 Aug 2026 – 31 Aug 2026/).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('tab', { name: /Overview/ }))
    await waitFor(() => expect(screen.getByText('Monthly Summary')).toBeTruthy())

    // Still August, and the month was never re-requested by a sub-tab switch.
    expect(screen.getAllByText(/01 Aug 2026 – 31 Aug 2026/).length).toBeGreaterThan(0)
    expect(requestedMonths).toEqual(['2026-09', '2026-08'])
  })

  it('offers exactly the three sub-tabs and no separate routes', async () => {
    render(<ProductsTab {...props} />)
    await waitFor(() => expect(screen.getByText('Monthly Summary')).toBeTruthy())

    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent)
    expect(tabs).toEqual(['Overview', 'Performance', 'Inventory & Actions'])
    expect(document.querySelectorAll('a[href*="/products/performance"]').length).toBe(0)
  })
})

describe('historical month selection', () => {
  it('reloads automatically and shows full-month ranges for a completed month', async () => {
    render(<ProductsTab {...props} />)
    await waitFor(() => expect(screen.getByText('Monthly Summary')).toBeTruthy())

    fireEvent.click(screen.getByTitle('Previous month'))

    await waitFor(() => {
      expect(screen.getAllByText(/01 Aug 2026 – 31 Aug 2026/).length).toBeGreaterThan(0)
      expect(screen.getAllByText(/vs 01 Jul 2026 – 31 Jul 2026/).length).toBeGreaterThan(0)
    })
    // Auto-reload: the month change alone triggered the fetch.
    expect(requestedMonths).toEqual(['2026-09', '2026-08'])
  })
})

describe('strategy insights', () => {
  it('opens the matching detail list when a card is clicked', async () => {
    render(<ProductsTab {...props} />)
    await waitFor(() => expect(screen.getByText('Product Strategy Insights')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /At Risk/ }))

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    const dialog = within(screen.getByRole('dialog'))
    // Grape Pudina lost all its demand against a real baseline.
    expect(dialog.getAllByText('Cellera Hero / Grape Pudina – GP').length).toBeGreaterThan(0)
  })
})

describe('inventory & actions', () => {
  it('labels the stock position as current and independent of the reporting month', async () => {
    const user = pointerUser()
    render(<ProductsTab {...props} />)
    await waitFor(() => expect(screen.getByText('Monthly Summary')).toBeTruthy())

    await user.click(screen.getByRole('tab', { name: /Inventory & Actions/ }))
    await waitFor(() => expect(screen.getByText('Current Inventory Snapshot')).toBeTruthy())

    expect(screen.getByText(/independent of the selected reporting month/)).toBeTruthy()
    expect(screen.getByText('Total Inventory Value')).toBeTruthy()
  })

  it('filters the action list when an action card is selected, matching its count', async () => {
    const user = pointerUser()
    render(<ProductsTab {...props} />)
    await waitFor(() => expect(screen.getByText('Monthly Summary')).toBeTruthy())
    await user.click(screen.getByRole('tab', { name: /Inventory & Actions/ }))
    await waitFor(() => expect(screen.getByText('Management Action Plan')).toBeTruthy())

    // Grape Pudina: no demand on top of a large stock position → Promote.
    fireEvent.click(screen.getByRole('button', { name: /Promote \/ Reduce Stock/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Clear filter/ })).toBeTruthy())

    expect(screen.getAllByText('Cellera Hero / Grape Pudina – GP').length).toBeGreaterThan(0)
    expect(screen.queryByText('Cellera Hero / Banana Vanilla – BV')).toBeNull()
  })
})

describe('empty month', () => {
  it('states there was no activity without NaN, Infinity or a false -100%', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: any) => {
      const url = String(input)
      if (url.includes('/filters')) return { ok: true, json: async () => ({ months: [], categories: CATEGORIES }) } as any
      const period = resolveProductReportPeriod('2026-09', NOW)
      const empty: ProductAnalyticsAggregate = {
        month: '2026-09',
        categoryId: 'all',
        categoryName: 'All Categories',
        current: { units: 0, orderValue: 0, skus: 0, orders: 0 },
        previous: { units: 0, orderValue: 0, skus: 0, orders: 0 },
        activeSkus: 60,
        dailyTrend: Array.from({ length: period.dayCount }, (_, i) => ({
          date: `2026-09-${String(i + 1).padStart(2, '0')}`, units: 0, orderValue: 0,
        })),
        variants: [],
        inventory: { totalValue: 257450, totalOnHand: 1630, variantCount: 2, asOf: '2026-09-07T02:00:00.000Z' },
        categories: [],
      }
      return {
        ok: true,
        json: async () => ({
          report: buildProductAnalyticsReport(empty, NOW),
          meta: { source: 'rpc', degraded: false, notice: null, generatedAt: '2026-09-07T02:00:00.000Z' },
        }),
      } as any
    }))

    render(<ProductsTab {...props} />)
    await waitFor(() => expect(screen.getByText(/No product order activity recorded for September 2026/)).toBeTruthy())

    const body = document.body.textContent || ''
    expect(body).not.toMatch(/NaN|Infinity/)
    expect(body).not.toMatch(/-100\.0%/)
    // The Download PDF control stays available; the snapshot is still real.
    expect(screen.getByRole('button', { name: /Download PDF/ })).toBeTruthy()
  })
})

describe('report controls', () => {
  it('exposes Refresh and Download PDF alongside the month selector', async () => {
    render(<ProductsTab {...props} />)
    await waitFor(() => expect(screen.getByText('Monthly Summary')).toBeTruthy())

    expect(screen.getByRole('button', { name: /Refresh/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Download PDF/ })).toBeTruthy()
    expect(screen.getByLabelText('Reporting Month')).toBeTruthy()
  })
})

// ── Category filtering ─────────────────────────────────────────────────────

describe('product category selector', () => {
  it('defaults to All Categories and loads without making the user choose first', async () => {
    render(<ProductsTab {...props} />)
    await waitFor(() => expect(screen.getByText('Monthly Summary')).toBeTruthy())

    expect(screen.getByLabelText('Product Category')).toBeTruthy()
    expect(screen.getByText('All Categories')).toBeTruthy()
    expect(requestedCategories).toEqual(['all'])
    expect(screen.queryByRole('button', { name: /apply/i })).toBeNull()
  })

  it('lists the categories supplied by master data rather than a hard-coded set', async () => {
    const user = pointerUser()
    render(<ProductsTab {...props} />)
    await waitFor(() => expect(screen.getByText('Monthly Summary')).toBeTruthy())

    await user.click(screen.getByLabelText('Product Category'))
    await waitFor(() => expect(screen.getByRole('option', { name: 'Vape' })).toBeTruthy())
    for (const category of CATEGORIES) {
      expect(screen.getByRole('option', { name: category.name })).toBeTruthy()
    }
  })

  it('reloads automatically with the selected category id', async () => {
    const user = pointerUser()
    render(<ProductsTab {...props} />)
    await waitFor(() => expect(screen.getByText('Monthly Summary')).toBeTruthy())

    await user.click(screen.getByLabelText('Product Category'))
    await user.click(await screen.findByRole('option', { name: 'Vape' }))

    await waitFor(() => expect(requestedCategories).toEqual(['all', 'cat-vape']))
    // Stable IDs travel over the wire, names are display only.
    expect(requestedCategories.at(-1)).toBe('cat-vape')
  })

  it('keeps month AND category while switching sub-tabs', async () => {
    const user = pointerUser()
    render(<ProductsTab {...props} />)
    await waitFor(() => expect(screen.getByText('Monthly Summary')).toBeTruthy())

    await user.click(screen.getByTitle('Previous month'))
    await waitFor(() => expect(screen.getAllByText(/01 Aug 2026 – 31 Aug 2026/).length).toBeGreaterThan(0))

    await user.click(screen.getByLabelText('Product Category'))
    await user.click(await screen.findByRole('option', { name: 'Pet Food' }))
    await waitFor(() => expect(requestedCategories.at(-1)).toBe('cat-pet'))

    const requestsBefore = requestedCategories.length

    await user.click(screen.getByRole('tab', { name: /Performance/ }))
    await waitFor(() => expect(screen.getByText(/Daily Product Demand Trend/)).toBeTruthy())
    await user.click(screen.getByRole('tab', { name: /Inventory & Actions/ }))
    await waitFor(() => expect(screen.getByText('Management Action Plan')).toBeTruthy())
    await user.click(screen.getByRole('tab', { name: /Overview/ }))
    await waitFor(() => expect(screen.getByText('Monthly Summary')).toBeTruthy())

    // Both filters survived, and no sub-tab switch triggered a refetch.
    expect(screen.getAllByText(/01 Aug 2026 – 31 Aug 2026/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Pet Food').length).toBeGreaterThan(0)
    expect(requestedCategories.length).toBe(requestsBefore)
    expect(requestedMonths.at(-1)).toBe('2026-08')
  })

  it('refresh reloads the same month and category, never resetting to All', async () => {
    const user = pointerUser()
    render(<ProductsTab {...props} />)
    await waitFor(() => expect(screen.getByText('Monthly Summary')).toBeTruthy())

    await user.click(screen.getByLabelText('Product Category'))
    await user.click(await screen.findByRole('option', { name: 'Vape' }))
    await waitFor(() => expect(requestedCategories.at(-1)).toBe('cat-vape'))

    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }))

    await waitFor(() => expect(requestedCategories.length).toBe(3))
    expect(requestedCategories.at(-1)).toBe('cat-vape')
    expect(requestedMonths.at(-1)).toBe('2026-09')
  })
})

describe('Category Performance section', () => {
  it('appears in Overview for All Categories', async () => {
    render(<ProductsTab {...props} />)
    await waitFor(() => expect(screen.getByText('Category Performance')).toBeTruthy())

    // Rendered after the period comparison, and carrying real category rows.
    expect(screen.getAllByText('Vape').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Pet Food').length).toBeGreaterThan(0)
  })

  it('is hidden once a specific category is selected', async () => {
    const user = pointerUser()
    render(<ProductsTab {...props} />)
    await waitFor(() => expect(screen.getByText('Category Performance')).toBeTruthy())

    await user.click(screen.getByLabelText('Product Category'))
    await user.click(await screen.findByRole('option', { name: 'Vape' }))

    await waitFor(() => expect(screen.queryByText('Category Performance')).toBeNull())
  })
})

describe('empty category month', () => {
  it('scopes the empty message to the category instead of the whole report', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: any) => {
      const url = String(input)
      if (url.includes('/filters')) {
        return { ok: true, json: async () => ({ months: [], categories: CATEGORIES }) } as any
      }
      const period = resolveProductReportPeriod('2026-03', NOW)
      const empty: ProductAnalyticsAggregate = {
        month: '2026-03',
        categoryId: 'cat-pet',
        categoryName: 'Pet Food',
        current: { units: 0, orderValue: 0, skus: 0, orders: 0 },
        previous: { units: 0, orderValue: 0, skus: 0, orders: 0 },
        activeSkus: 12,
        dailyTrend: Array.from({ length: period.dayCount }, (_, i) => ({
          date: `2026-03-${String(i + 1).padStart(2, '0')}`, units: 0, orderValue: 0,
        })),
        variants: [],
        inventory: { totalValue: 9000, totalOnHand: 900, variantCount: 1, asOf: '2026-09-07T02:00:00.000Z' },
        categories: [],
      }
      return {
        ok: true,
        json: async () => ({
          report: buildProductAnalyticsReport(empty, NOW),
          meta: { source: 'rpc', degraded: false, notice: null, generatedAt: '2026-09-07T02:00:00.000Z' },
        }),
      } as any
    }))

    render(<ProductsTab {...props} />)
    await waitFor(() =>
      expect(screen.getByText(/No Pet Food order activity recorded for March 2026/)).toBeTruthy())

    // It must not read as though the whole report has no data.
    expect(screen.queryByText(/No product order activity recorded/)).toBeNull()
    expect(document.body.textContent || '').not.toMatch(/NaN|Infinity/)
  })
})

// ── Product Contribution drill-down ────────────────────────────────────────

/** Open Performance and wait for the Product Contribution section. */
async function openContribution(user: ReturnType<typeof pointerUser>) {
  await waitFor(() => expect(screen.getByText('Monthly Summary')).toBeTruthy())
  await user.click(screen.getByRole('tab', { name: /Performance/ }))
  await waitFor(() => expect(screen.getByText('Product Contribution')).toBeTruthy())
}

describe('contribution drill-down', () => {
  it('opens the Top 5 band with its SKUs, without leaving Product Analytics', async () => {
    const user = pointerUser()
    render(<ProductsTab {...props} />)
    await openContribution(user)

    await user.click(screen.getByRole('button', { name: /View the .* SKUs in Top 5 SKUs/ }))

    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByText(/Top 5 SKUs Contribution/i)).toBeTruthy()
    // Ranked SKU rows, using the canonical label.
    expect(within(sheet).getByText('Cellera Hero / Banana Vanilla – BV')).toBeTruthy()
    // Still inside the Performance sub-tab behind the sheet.
    expect(screen.getByText('Product Contribution')).toBeTruthy()
  })

  it('shows the period, comparison and category scope in the band header', async () => {
    const user = pointerUser()
    render(<ProductsTab {...props} />)
    await openContribution(user)
    await user.click(screen.getByRole('button', { name: /View the .* SKUs in Top 5 SKUs/ }))

    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByText(/September 2026/)).toBeTruthy()
    expect(within(sheet).getByText(/01 Sep 2026 – 07 Sep 2026/)).toBeTruthy()
    expect(within(sheet).getByText(/All Categories/)).toBeTruthy()
  })

  it('states the management interpretation factually', async () => {
    const user = pointerUser()
    render(<ProductsTab {...props} />)
    await openContribution(user)
    await user.click(screen.getByRole('button', { name: /View the .* SKUs in Top 5 SKUs/ }))

    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByText(/contribute .*% of selected-period Order Value/)).toBeTruthy()
  })

  it('does not open a band that holds no SKUs', async () => {
    const user = pointerUser()
    render(<ProductsTab {...props} />)
    await openContribution(user)

    // The fixture has 1 ordered SKU, so Next 5 and Remaining are empty.
    const nextFive = screen.getByRole('button', { name: /View the 0 SKUs in Next 5 SKUs/ })
    expect(nextFive).toHaveProperty('disabled', true)
    await user.click(nextFive).catch(() => undefined)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens an individual SKU detail and returns with Back', async () => {
    const user = pointerUser()
    render(<ProductsTab {...props} />)
    await openContribution(user)
    await user.click(screen.getByRole('button', { name: /View the .* SKUs in Top 5 SKUs/ }))

    const sheet = await screen.findByRole('dialog')
    await user.click(within(sheet).getByText('Cellera Hero / Banana Vanilla – BV'))

    await waitFor(() => expect(screen.getByText('Recommended Action')).toBeTruthy())
    expect(screen.getByText(/Selected Period ·/)).toBeTruthy()
    expect(screen.getByText(/Comparison Period ·/)).toBeTruthy()

    // Back returns to the band list without closing the sheet.
    await user.click(screen.getByRole('button', { name: /Back to Top 5 SKUs/ }))
    await waitFor(() => expect(screen.queryByText('Recommended Action')).toBeNull())
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('labels SKU inventory as a current snapshot even for a historical month', async () => {
    const user = pointerUser()
    render(<ProductsTab {...props} />)
    await waitFor(() => expect(screen.getByText('Monthly Summary')).toBeTruthy())

    // Select a historical month first.
    await user.click(screen.getByTitle('Previous month'))
    await waitFor(() => expect(screen.getAllByText(/01 Aug 2026 – 31 Aug 2026/).length).toBeGreaterThan(0))

    await user.click(screen.getByRole('tab', { name: /Performance/ }))
    await waitFor(() => expect(screen.getByText('Product Contribution')).toBeTruthy())
    await user.click(screen.getByRole('button', { name: /View the .* SKUs in Top 5 SKUs/ }))
    const sheet = await screen.findByRole('dialog')
    await user.click(within(sheet).getByText('Cellera Hero / Banana Vanilla – BV'))

    await waitFor(() => expect(screen.getByText('Current Inventory Snapshot')).toBeTruthy())
    expect(screen.getByText(/independent of the selected reporting month/)).toBeTruthy()
  })

  it('closing the drawer preserves month, category and sub-tab', async () => {
    const user = pointerUser()
    render(<ProductsTab {...props} />)
    await waitFor(() => expect(screen.getByText('Monthly Summary')).toBeTruthy())

    await user.click(screen.getByLabelText('Product Category'))
    await user.click(await screen.findByRole('option', { name: 'Vape' }))
    await waitFor(() => expect(requestedCategories.at(-1)).toBe('cat-vape'))
    await user.click(screen.getByRole('tab', { name: /Performance/ }))
    await waitFor(() => expect(screen.getByText('Product Contribution')).toBeTruthy())

    const requestsBefore = requestedCategories.length
    await user.click(screen.getByRole('button', { name: /View the .* SKUs in Top 5 SKUs/ }))
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    // Same Performance view, same filters, and nothing was refetched.
    expect(screen.getByText('Product Contribution')).toBeTruthy()
    expect(screen.getAllByText('Vape').length).toBeGreaterThan(0)
    expect(requestedCategories.length).toBe(requestsBefore)
    expect(requestedMonths.at(-1)).toBe('2026-09')
  })

  it('inherits the selected category in the drawer', async () => {
    const user = pointerUser()
    render(<ProductsTab {...props} />)
    await waitFor(() => expect(screen.getByText('Monthly Summary')).toBeTruthy())

    await user.click(screen.getByLabelText('Product Category'))
    await user.click(await screen.findByRole('option', { name: 'Vape' }))
    await waitFor(() => expect(requestedCategories.at(-1)).toBe('cat-vape'))

    await user.click(screen.getByRole('tab', { name: /Performance/ }))
    await waitFor(() => expect(screen.getByText('Product Contribution')).toBeTruthy())
    await user.click(screen.getByRole('button', { name: /View the .* SKUs in Top 5 SKUs/ }))

    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByText(/Vape/)).toBeTruthy()
  })

  it('signals that the bands are interactive', async () => {
    const user = pointerUser()
    render(<ProductsTab {...props} />)
    await openContribution(user)

    expect(screen.getByText('Click a band to view the SKUs inside it.')).toBeTruthy()
    const top = screen.getByRole('button', { name: /View the .* SKUs in Top 5 SKUs/ })
    expect(top.className).toContain('cursor-pointer')
  })
})
