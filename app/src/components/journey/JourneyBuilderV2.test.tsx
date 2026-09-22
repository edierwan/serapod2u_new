// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readFileSync } from 'node:fs'
import path from 'node:path'

import JourneyBuilderV2, { EngagementTrendChart, KpiCard } from './JourneyBuilderV2'

const fromMock = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (...args: any[]) => fromMock(...args),
  }),
}))

vi.mock('@/components/announcement-banner/MasterAnnouncementBannerView', () => ({
  default: () => <div data-testid="announcement-banner-view">Announcement Banner</div>,
}))

vi.mock('./JourneyOrderSelectorV2', () => ({
  default: ({ onOrderSelected }: { onOrderSelected: (order: any) => void }) => (
    <div data-testid="order-selector">
      <button
        onClick={() =>
          onOrderSelected({
            id: 'order-1',
            order_no: 'ORD26000015',
            order_type: 'H2M',
            status: 'approved',
            has_redeem: true,
            has_lucky_draw: false,
            company_id: 'company-1',
          })
        }
      >
        Select Order
      </button>
    </div>
  ),
}))

vi.mock('./JourneyDesignerV2', () => ({
  default: ({ order, onSuccess, onBack }: any) => (
    <div data-testid="journey-designer">
      <p>Designing for {order?.order_no}</p>
      <button onClick={onSuccess}>Create Journey</button>
      <button onClick={onBack}>Back</button>
    </div>
  ),
}))

const userProfile = {
  id: 'user-1',
  organization_id: 'org-1',
  full_name: 'Test User',
  organizations: { id: 'org-1', org_name: 'Test Org', org_type_code: 'HQ' },
}

function buildQueryChain(result: { data: any; error: any }) {
  const chain: any = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    order: vi.fn(() => Promise.resolve(result)),
    single: vi.fn(() => Promise.resolve(result)),
    delete: vi.fn(() => chain),
    insert: vi.fn(() => Promise.resolve(result)),
    then: (resolve: any) => Promise.resolve(result).then(resolve),
  }
  return chain
}

const dashboardSummary = {
  kpis: { totalJourneys: 0, totalQrGenerated: 0, totalScans: 0, pointsRedeemed: 0, failedScans: 0 },
  typeCounts: { points: 0, luckyDraw: 0, freeGift: 0 },
  journeys: [],
  topPerforming: null,
  recentActivity: [],
}

function mockFetch({ summary, trend }: { summary: any; trend: { ok: boolean; body: any } }) {
  global.fetch = vi.fn((url: string) => {
    if (String(url).startsWith('/api/journey/engagement-trend')) {
      return Promise.resolve({ ok: trend.ok, json: () => Promise.resolve(trend.body) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(summary) })
  }) as any
}

describe('JourneyBuilderV2', () => {
  beforeEach(() => {
    fromMock.mockReset()
    fromMock.mockImplementation((table: string) => {
      if (table === 'journey_configurations') {
        return buildQueryChain({ data: [], error: null })
      }
      if (table === 'journey_order_links') {
        return buildQueryChain({ data: [], error: null })
      }
      if (table === 'orders') {
        return buildQueryChain({ data: [], error: null })
      }
      return buildQueryChain({ data: null, error: null })
    })

    mockFetch({ summary: dashboardSummary, trend: { ok: true, body: { success: true, points: [] } } })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the loading state without crashing', () => {
    render(<JourneyBuilderV2 userProfile={userProfile} />)
    expect(screen.getByText('Journey Builder')).toBeTruthy()
  })

  it('renders the empty Existing Journeys state once loading finishes', async () => {
    render(<JourneyBuilderV2 userProfile={userProfile} />)
    await waitFor(() => expect(screen.getByText('No journeys yet')).toBeTruthy())
  })

  it('shows the order selector after switching to the Create New tab', async () => {
    render(<JourneyBuilderV2 userProfile={userProfile} />)
    const user = userEvent.setup()
    await waitFor(() => expect(screen.getByText('No journeys yet')).toBeTruthy())

    await user.click(screen.getByRole('tab', { name: 'Create New' }))
    expect(screen.getByTestId('order-selector')).toBeTruthy()
  })

  it('switches to the journey designer once an order is selected, without throwing a hooks-order error', async () => {
    render(<JourneyBuilderV2 userProfile={userProfile} />)
    const user = userEvent.setup()
    await waitFor(() => expect(screen.getByText('No journeys yet')).toBeTruthy())

    await user.click(screen.getByRole('tab', { name: 'Create New' }))
    fireEvent.click(screen.getByText('Select Order'))

    expect(screen.getByTestId('journey-designer')).toBeTruthy()
    expect(screen.getByText('Designing for ORD26000015')).toBeTruthy()
    // The dashboard shell (which uses useMemo for trend data) must not render here.
    expect(screen.queryByText('Journey Builder')).toBeNull()
  })

  it('returns to the Existing Journeys tab and reloads after a successful journey creation', async () => {
    render(<JourneyBuilderV2 userProfile={userProfile} />)
    const user = userEvent.setup()
    await waitFor(() => expect(screen.getByText('No journeys yet')).toBeTruthy())

    await user.click(screen.getByRole('tab', { name: 'Create New' }))
    fireEvent.click(screen.getByText('Select Order'))
    fireEvent.click(screen.getByText('Create Journey'))

    await waitFor(() => expect(screen.getByText('Journey Builder')).toBeTruthy())
    await waitFor(() => expect(screen.getByText('No journeys yet')).toBeTruthy())
  })

  it('handles a failed journey creation gracefully by staying on the designer', async () => {
    render(<JourneyBuilderV2 userProfile={userProfile} />)
    const user = userEvent.setup()
    await waitFor(() => expect(screen.getByText('No journeys yet')).toBeTruthy())

    await user.click(screen.getByRole('tab', { name: 'Create New' }))
    fireEvent.click(screen.getByText('Select Order'))

    // Simulate the designer not calling onSuccess on failure: clicking "Back" instead.
    fireEvent.click(screen.getByText('Back'))

    await waitFor(() => expect(screen.getByText('Journey Builder')).toBeTruthy())
  })

  it('does not throw "Rendered fewer hooks than expected" when re-rendering after creation', async () => {
    const { rerender } = render(<JourneyBuilderV2 userProfile={userProfile} />)
    const user = userEvent.setup()
    await waitFor(() => expect(screen.getByText('No journeys yet')).toBeTruthy())

    await user.click(screen.getByRole('tab', { name: 'Create New' }))
    fireEvent.click(screen.getByText('Select Order'))
    fireEvent.click(screen.getByText('Create Journey'))

    await waitFor(() => expect(screen.getByText('Journey Builder')).toBeTruthy())

    // Re-render (simulating a refresh) must not throw.
    expect(() => rerender(<JourneyBuilderV2 userProfile={userProfile} />)).not.toThrow()
  })

  it('renders the Announcement Banner tab without crashing', async () => {
    render(<JourneyBuilderV2 userProfile={userProfile} />)
    const user = userEvent.setup()
    await waitFor(() => expect(screen.getByText('No journeys yet')).toBeTruthy())

    await user.click(screen.getByRole('tab', { name: /Announcement Banner/ }))
    expect(screen.getByTestId('announcement-banner-view')).toBeTruthy()
  })

  it('renders large KPI values in full with length-aware sizing', async () => {
    mockFetch({
      summary: { ...dashboardSummary, kpis: { totalJourneys: 23, totalQrGenerated: 1372760, totalScans: 101580, pointsRedeemed: 0, failedScans: 0 } },
      trend: { ok: true, body: { success: true, points: [] } },
    })
    render(<JourneyBuilderV2 userProfile={userProfile} />)

    const generated = await screen.findByText('1,372,760')
    expect(generated.className).toContain('text-xl')
    expect(generated.className).toContain('tabular-nums')
    expect(generated.className).toContain('whitespace-nowrap')
    expect(screen.getByText('101,580').className).toContain('text-2xl')
    expect(screen.getByText('23').className).toContain('text-2xl')
    expect(screen.queryByText(/1\.37M|101\.5K|K$/)).toBeNull()
  })

  it('requests the selected trend range from the server-side trend API', async () => {
    render(<JourneyBuilderV2 userProfile={userProfile} />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/journey/engagement-trend?range=30d'))
  })

  it('shows "No engagement data yet" only when the trend loads successfully with zero activity', async () => {
    mockFetch({
      summary: dashboardSummary,
      trend: { ok: true, body: { success: true, points: [{ date: '2026-09-20', scans: 0, redeemed: 0 }] } },
    })
    render(<JourneyBuilderV2 userProfile={userProfile} />)
    await waitFor(() => expect(screen.getByText('No engagement data yet')).toBeTruthy())
    expect(screen.queryByText('Unable to load engagement trend')).toBeNull()
  })

  it('shows an error state with retry, not the empty state, when the trend API fails', async () => {
    mockFetch({ summary: dashboardSummary, trend: { ok: false, body: { success: false, error: 'boom' } } })
    render(<JourneyBuilderV2 userProfile={userProfile} />)
    await waitFor(() => expect(screen.getByText('Unable to load engagement trend')).toBeTruthy())
    expect(screen.queryByText('No engagement data yet')).toBeNull()

    mockFetch({
      summary: dashboardSummary,
      trend: { ok: true, body: { success: true, points: [{ date: '2026-09-20', scans: 0, redeemed: 0 }] } },
    })
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }))
    await waitFor(() => expect(screen.getByText('No engagement data yet')).toBeTruthy())
  })

  it('renders the chart for real trend data instead of the empty state', async () => {
    mockFetch({
      summary: { ...dashboardSummary, kpis: { ...dashboardSummary.kpis, totalScans: 101580 } },
      trend: { ok: true, body: { success: true, points: [{ date: '2026-09-19', scans: 5110, redeemed: 138 }, { date: '2026-09-20', scans: 4320, redeemed: 120 }] } },
    })
    const { container } = render(<JourneyBuilderV2 userProfile={userProfile} />)
    await waitFor(() => expect(container.querySelector('.recharts-responsive-container')).toBeTruthy())
    expect(screen.queryByText('No engagement data yet')).toBeNull()
    expect(screen.queryByText('Unable to load engagement trend')).toBeNull()
  })

  it('does not offer a fabricated "Failed" trend metric', () => {
    const source = readFileSync(path.resolve(__dirname, 'JourneyBuilderV2.tsx'), 'utf8')
    expect(source).not.toContain('<SelectItem value="failed">')
  })
})

describe('EngagementTrendChart', () => {
  afterEach(() => cleanup())

  it('shows a loading state while the trend is in flight', () => {
    render(<EngagementTrendChart state={{ status: 'loading', points: [] }} metric="scans" onRetry={() => {}} />)
    expect(screen.getByText(/Loading engagement trend/)).toBeTruthy()
  })

  it('treats redeemed-only activity as empty for the scans metric and as data for redeemed', () => {
    const points = [{ date: '2026-09-20', scans: 0, redeemed: 4 }]
    const { container, rerender } = render(<EngagementTrendChart state={{ status: 'ready', points }} metric="scans" onRetry={() => {}} />)
    expect(screen.getByText('No engagement data yet')).toBeTruthy()
    rerender(<EngagementTrendChart state={{ status: 'ready', points }} metric="redeemed" onRetry={() => {}} />)
    expect(container.querySelector('.recharts-responsive-container')).toBeTruthy()
  })
})

describe('KpiCard', () => {
  afterEach(() => cleanup())

  it('keeps 10,000,000+ visible in full with a smaller step and a title tooltip', () => {
    render(<KpiCard tone="indigo" icon={null} label="Total QR Generated" value="10,000,000" />)
    const value = screen.getByTestId('kpi-value')
    expect(value.textContent).toBe('10,000,000')
    expect(value.getAttribute('title')).toBe('10,000,000')
    expect(value.className).toContain('text-lg')
  })
})
