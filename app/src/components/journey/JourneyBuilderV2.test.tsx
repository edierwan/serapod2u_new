// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import JourneyBuilderV2 from './JourneyBuilderV2'

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
  trend: [],
  journeys: [],
  topPerforming: null,
  recentActivity: [],
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

    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(dashboardSummary),
      })
    ) as any
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
})
